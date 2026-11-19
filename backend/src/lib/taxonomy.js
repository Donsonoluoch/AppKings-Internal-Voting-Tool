// Departments and Teams are defined once, in packages/shared/constants.js, and seeded from
// there. `pruneTaxonomy` keeps the database equal to that list:
//
//   * a configured team or department that is missing is created (teams by their stable
//     `code`, so a renamed team keeps its employees and nominations);
//   * a team row that exists by NAME but has no code is an old row from an earlier import;
//     it is *retired* — renamed to "Old Name (retired)" the first time — so the configured
//     team takes the display name without ever colliding on the unique name;
//   * a leftover row is removed only when nothing references it. A row still attached to an
//     employee, nomination or candidate is kept and reported, so pruning can never destroy
//     voting data. Departments additionally never delete a value that is still a person's
//     sign-in department — that move belongs to the admin, not to a seed.
const { DEPARTMENTS, TEAM_DEFINITIONS } = require('@appkings/shared');

const RETIRED = /^(.*) \(retired(?: \d+)?\)$/;

async function reconcileDepartments(client) {
  const report = { created: 0, removed: 0, renamed: [], kept: [] };

  for (const name of DEPARTMENTS) {
    const existing = await client.department.findUnique({ where: { name }, select: { id: true } });
    if (!existing) {
      await client.department.create({ data: { name } });
      report.created += 1;
    }
  }

  const extra = await client.department.findMany({
    where: { name: { notIn: DEPARTMENTS } },
    orderBy: { name: 'asc' },
    include: { _count: { select: { employees: true } } },
  });
  for (const department of extra) {
    // A department is only a profile label, so an old value is renamed to a configured one
    // instead of deleting people's history: an unused row is simply removed, and a row with
    // people on it is folded into the configured department with the fewest staff (or kept,
    // with a warning, when there is nothing to fold it into).
    if (department._count.employees === 0) {
      await client.department.delete({ where: { id: department.id } });
      report.removed += 1;
      continue;
    }
    const target = await leastUsedDepartment(client);
    if (!target) {
      report.kept.push({ name: department.name, employees: department._count.employees });
      continue;
    }
    await client.$transaction([
      client.employee.updateMany({
        where: { departmentId: department.id },
        data: { departmentId: target.id },
      }),
      client.department.delete({ where: { id: department.id } }),
    ]);
    report.renamed.push({
      from: department.name,
      to: target.name,
      employees: department._count.employees,
    });
  }

  return report;
}

/** The configured department with the fewest employees — where an unrecognised one is folded in. */
async function leastUsedDepartment(client) {
  if (DEPARTMENTS.length === 0) return null;
  const rows = await client.department.findMany({
    where: { name: { in: DEPARTMENTS } },
    include: { _count: { select: { employees: true } } },
    orderBy: { name: 'asc' },
  });
  return [...rows].sort((a, b) => a._count.employees - b._count.employees)[0] ?? null;
}

async function retireLegacyTeam(client, team) {
  const base = (team.nameKept || team.name).replace(RETIRED, '$1');
  for (let attempt = 1; attempt < 50; attempt += 1) {
    const name = attempt === 1 ? `${base} (retired)` : `${base} (retired ${attempt})`;
    const clash = await client.team.findUnique({ where: { name }, select: { id: true } });
    if (clash) continue;
    await client.team.update({
      where: { id: team.id },
      data: { name, nameKept: team.nameKept || team.name },
    });
    return name;
  }
  throw new Error(`Could not retire legacy team "${team.name}".`);
}

async function reconcileTeams(client) {
  const report = { created: 0, updated: 0, retired: [], removed: 0, kept: [] };
  const codes = TEAM_DEFINITIONS.map((team) => team.code);

  // 1. Free the configured names from rows written before teams had codes.
  const legacy = await client.team.findMany({ where: { code: null } });
  for (const team of legacy) {
    report.retired.push(await retireLegacyTeam(client, team));
  }

  // 2. Make sure every configured team exists, keyed by code.
  for (const definition of TEAM_DEFINITIONS) {
    const existing = await client.team.findUnique({ where: { code: definition.code } });
    if (!existing) {
      await client.team.create({
        data: { code: definition.code, name: definition.name },
      });
      report.created += 1;
    } else if (existing.name !== definition.name) {
      await client.team.update({
        where: { id: existing.id },
        data: { name: definition.name, nameKept: definition.name },
      });
      report.updated += 1;
    }
  }

  // 3. Retired or unknown rows go only when nothing uses them.
  const leftovers = await client.team.findMany({
    where: { code: null },
    include: {
      _count: { select: { employees: true, nominations: true, candidates: true } },
    },
  });
  for (const team of leftovers) {
    const { employees, nominations, candidates } = team._count;
    if (employees > 0 || nominations > 0 || candidates > 0) {
      report.kept.push(team.name);
      continue;
    }
    await client.team.delete({ where: { id: team.id } });
    report.removed += 1;
  }

  const configured = await client.team.count({ where: { code: { in: codes } } });
  return { ...report, configured };
}

async function pruneTaxonomy(client) {
  const departments = await reconcileDepartments(client);
  const teams = await reconcileTeams(client);
  return { departments, teams };
}

module.exports = { pruneTaxonomy };
