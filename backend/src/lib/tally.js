// §5 — how a cut works. One implementation, used by the admin tally view, the cut
// confirmation and the phase gates, so the numbers can never disagree.
//
//   1. Tally per category (Phase 1: nominations, Phase 2: committee picks).
//   2. Category finalists: the top TOP_PER_CATEGORY (5) per category.
//   3. Pooled ranking: each person's total is the sum of their points across the
//      categories where they made the top 5.
//   4. Advance the pooled top PHASE1_FINALISTS (15) or PHASE2_FINALISTS_MAX (10),
//      plus category finalists needed to preserve minimum coverage.
//   5. Ties across a cut line are flagged, never auto-resolved.
//   6. Safety check: every category keeps at least MIN_CANDIDATES_PER_CATEGORY (2).
//
// Team of the Year runs as its own track: top 5 teams after Phase 1, top TEAM_FINALISTS (3)
// after Phase 2. Teams are never part of the pooled people ranking.
const { rankWithTies, pooledTotals } = require('@appkings/shared');
const prisma = require('./prisma');
const config = require('../config');

const slotKey = (categoryId, employeeId) => `${categoryId}:${employeeId}`;

function personDetails(row) {
  return { name: row?.name ?? 'Unknown', department: row?.department ?? null };
}

function requiredPeople(tally) {
  const required = new Set();
  for (const category of tally.categories) {
    if (category.forTeams) continue;
    for (const finalist of category.finalists.slice(0, tally.limits.minCandidatesPerCategory)) {
      if (finalist.employeeId) required.add(finalist.employeeId);
    }
  }
  return required;
}

function selectAdvancingPeople(tally, limit) {
  const advancing = new Set(tally.people.slice(0, limit).map((person) => person.id));
  for (const personId of requiredPeople(tally)) advancing.add(personId);
  return advancing;
}

/**
 * Phase 1 tally: nominations per category, top 5 per category, pooled top 15 people.
 * @param {object} [client] Prisma client or transaction
 */
async function computePhase1Tally(client = prisma) {
  const { topPerCategory, phase1Finalists, minCandidatesPerCategory } = config.rules;

  const [categories, nominations] = await Promise.all([
    client.category.findMany({ orderBy: { sortOrder: 'asc' } }),
    client.nomination.findMany({
      include: {
        nominee: { select: { id: true, fullName: true, department: { select: { name: true } } } },
        nomineeDept: { select: { id: true, name: true } },
      },
    }),
  ]);

  const categoryTallies = categories.map((category) => {
    const counts = new Map();
    for (const nomination of nominations) {
      if (nomination.categoryId !== category.id) continue;
      const key = nomination.nomineeId || nomination.nomineeDeptId;
      if (!key) continue;
      if (!counts.has(key)) {
        counts.set(key, {
          key,
          employeeId: nomination.nomineeId,
          departmentId: nomination.nomineeDeptId,
          name: nomination.nominee?.fullName ?? nomination.nomineeDept?.name ?? 'Unknown',
          department: nomination.nominee?.department?.name ?? null,
          points: 0,
        });
      }
      counts.get(key).points += 1;
    }

    const rows = Array.from(counts.values());
    const { sorted, tiedAtCutoff } = rankWithTies(rows, topPerCategory);
    const finalists = sorted.slice(0, topPerCategory);

    return {
      categoryId: category.id,
      categoryName: category.name,
      forTeams: category.forTeams,
      rows: sorted,
      finalists,
      tiedAtCutoff,
      shortOfMinimum: finalists.length < minCandidatesPerCategory,
    };
  });

  // Pooled people ranking: only people (not teams) in the top 5 of a category.
  const slots = [];
  for (const category of categoryTallies) {
    if (category.forTeams) continue;
    for (const finalist of category.finalists) {
      if (!finalist.employeeId) continue;
      slots.push({ personId: finalist.employeeId, points: finalist.points });
    }
  }
  const pooled = pooledTotals(slots);
  const { sorted: people, tiedAtCutoff: peopleTiedAtCutoff } = rankWithTies(
    pooled,
    phase1Finalists
  );
  const advancing = selectAdvancingPeople(
    { categories: categoryTallies, people: pooled, limits: { minCandidatesPerCategory } },
    phase1Finalists
  );

  const names = new Map();
  for (const category of categoryTallies) {
    for (const row of category.rows) {
      if (row.employeeId) names.set(row.employeeId, row);
    }
  }

  return {
    phase: 'PHASE_1',
    categories: categoryTallies,
    people: people.map((person, index) => ({
      ...person,
      rank: index + 1,
      ...personDetails(names.get(person.id)),
      advances: advancing.has(person.id),
    })),
    peopleTiedAtCutoff,
    limits: { topPerCategory, phase1Finalists, minCandidatesPerCategory },
  };
}

/**
 * Phase 2 tally: committee picks per category among the Phase 2 candidates, top 5 per
 * category, pooled top 6–10 people. Teams advance their top TEAM_FINALISTS.
 */
async function computePhase2Tally(client = prisma) {
  const { topPerCategory, phase2FinalistsMin, phase2FinalistsMax, teamFinalists, minCandidatesPerCategory } =
    config.rules;

  const [categories, candidates, picks] = await Promise.all([
    client.category.findMany({ orderBy: { sortOrder: 'asc' } }),
    client.candidate.findMany({
      where: { inPhase2: true },
      include: {
        employee: { select: { id: true, fullName: true, department: { select: { name: true } } } },
        department: { select: { id: true, name: true } },
      },
    }),
    client.committeeVote.groupBy({ by: ['candidateId'], _count: { _all: true } }),
  ]);

  const pickCounts = new Map(picks.map((row) => [row.candidateId, row._count._all]));

  const categoryTallies = categories.map((category) => {
    const rows = candidates
      .filter((candidate) => candidate.categoryId === category.id)
      .map((candidate) => ({
        candidateId: candidate.id,
        employeeId: candidate.employeeId,
        departmentId: candidate.departmentId,
        name: candidate.employee?.fullName ?? candidate.department?.name ?? 'Unknown',
        department: candidate.employee?.department?.name ?? null,
        points: pickCounts.get(candidate.id) || 0,
      }));

    const { sorted, tiedAtCutoff } = rankWithTies(rows, topPerCategory);
    const finalists = sorted.slice(0, topPerCategory);

    return {
      categoryId: category.id,
      categoryName: category.name,
      forTeams: category.forTeams,
      rows: sorted,
      finalists,
      tiedAtCutoff,
      shortOfMinimum: finalists.length < minCandidatesPerCategory,
    };
  });

  const slots = [];
  for (const category of categoryTallies) {
    if (category.forTeams) continue;
    for (const finalist of category.finalists) {
      if (!finalist.employeeId) continue;
      slots.push({ personId: finalist.employeeId, points: finalist.points });
    }
  }
  const pooled = pooledTotals(slots);
  const { sorted: people, tiedAtCutoff: peopleTiedAtCutoff } = rankWithTies(
    pooled,
    phase2FinalistsMax
  );
  const advancing = selectAdvancingPeople(
    { categories: categoryTallies, people: pooled, limits: { minCandidatesPerCategory } },
    phase2FinalistsMax
  );

  const names = new Map();
  for (const category of categoryTallies) {
    for (const row of category.rows) {
      if (row.employeeId) names.set(row.employeeId, row);
    }
  }

  // Team of the Year: its own track, top TEAM_FINALISTS teams.
  const teamCategory = categoryTallies.find((category) => category.forTeams);
  const teamRows = teamCategory ? teamCategory.rows : [];
  const { sorted: teams, tiedAtCutoff: teamsTiedAtCutoff } = rankWithTies(teamRows, teamFinalists);

  return {
    phase: 'PHASE_2',
    categories: categoryTallies,
    people: people.map((person, index) => ({
      ...person,
      rank: index + 1,
      ...personDetails(names.get(person.id)),
      advances: advancing.has(person.id),
    })),
    peopleTiedAtCutoff,
    teams: teams.map((team, index) => ({ ...team, rank: index + 1, advances: index < teamFinalists })),
    teamsTiedAtCutoff,
    limits: {
      topPerCategory,
      phase2FinalistsMin,
      phase2FinalistsMax,
      teamFinalists,
      minCandidatesPerCategory,
    },
  };
}

function presentPhaseResults(tally, phase) {
  return tally.categories.map((category) => ({
    categoryId: category.categoryId,
    categoryName: category.categoryName,
    winnerId: null,
    tiebreakRequired: false,
    results: category.rows.map((row) => ({
      id: row.candidateId || row.employeeId || row.departmentId || row.key,
      name: row.name,
      kind: category.forTeams ? 'team' : 'employee',
      department: row.department ?? null,
      nominationPoints: phase === 'PHASE_1' ? row.points : 0,
      committeePoints: phase === 'PHASE_2' ? row.points : 0,
      finalPoints: 0,
      totalPoints: row.points,
    })),
  }));
}

/**
 * §11 — the checks that block a phase change. Returns a list of human-readable problems;
 * an empty list means the cut is safe to confirm.
 *
 * `includeTies: false` leaves out tie flags once the admin has already resolved them by
 * confirming the cut: the counts are then the durable facts.
 */
function cutProblems(tally, { includeTies = true } = {}) {
  const problems = [];
  const { minCandidatesPerCategory } = config.rules;   

  for (const category of tally.categories) {
    if (includeTies && category.tiedAtCutoff) {
      problems.push(`${category.categoryName}: a tie sits on the top-${tally.limits.topPerCategory} cut line.`);
    }
    if (category.finalists.length < minCandidatesPerCategory) {
      problems.push(
        `${category.categoryName}: only ${category.finalists.length} candidate(s); at least ${minCandidatesPerCategory} are required.`
      );
    }
  }

  if (tally.phase === 'PHASE_1') {
    if (includeTies && tally.peopleTiedAtCutoff) {
      problems.push(`A tie sits on the top-${tally.limits.phase1Finalists} people cut line.`);
    }
    if (tally.people.length < tally.limits.phase1Finalists) {
      problems.push(
        `Only ${tally.people.length} people are in the pooled ranking; ${tally.limits.phase1Finalists} are required.`
      );
    }
  }

  if (tally.phase === 'PHASE_2') {
    if (includeTies && tally.peopleTiedAtCutoff) {
      problems.push(`A tie sits on the top-${tally.limits.phase2FinalistsMax} people cut line.`);
    }
    // `advances` is already capped at PHASE2_FINALISTS_MAX; the count below is the cut size.
    const advancing = Math.min(tally.people.length, tally.limits.phase2FinalistsMax);
    if (advancing < tally.limits.phase2FinalistsMin) {
      problems.push(
        `Only ${advancing} people would advance; at least ${tally.limits.phase2FinalistsMin} are required.`
      );
    }
    if (includeTies && tally.teamsTiedAtCutoff) {
      problems.push(`A tie sits on the top-${tally.limits.teamFinalists} teams cut line.`);
    }
  }

  return problems;
}

/**
 * §5 step 7 — saves the confirmed cut on the Candidate rows so results can't change later.
 * Phase 1: creates the top-5 slots, stores nomination points, flags the top 15 people.
 * Phase 2: stores committee points and flags the 6–10 shortlist (and the top 3 teams).
 */
async function applyCut(tx, tally) {
  const { phase1Finalists, phase2FinalistsMax, teamFinalists } = config.rules;

  if (tally.phase === 'PHASE_1') {
    const advancing = selectAdvancingPeople(tally, phase1Finalists);

    for (const category of tally.categories) {
      for (const finalist of category.finalists) {
        const inPhase2 = finalist.employeeId ? advancing.has(finalist.employeeId) : true;
        const data = {
          nominationPoints: finalist.points,
          inPhase2,
          inPhase3: false,
          committeePoints: 0,
          finalPoints: 0,
        };
        if (finalist.employeeId) {
          await tx.candidate.upsert({
            where: {
              categoryId_employeeId: { categoryId: category.categoryId, employeeId: finalist.employeeId },
            },
            update: data,
            create: { categoryId: category.categoryId, employeeId: finalist.employeeId, ...data },
          });
        } else if (finalist.departmentId) {
          await tx.candidate.upsert({
            where: {
              categoryId_departmentId: {
                categoryId: category.categoryId,
                departmentId: finalist.departmentId,
              },
            },
            update: data,
            create: { categoryId: category.categoryId, departmentId: finalist.departmentId, ...data },
          });
        }
      }
    }
    return;
  }

  if (tally.phase === 'PHASE_2') {
    const advancing = selectAdvancingPeople(tally, phase2FinalistsMax);
    const advancingTeams = new Set(tally.teams.slice(0, teamFinalists).map((team) => team.departmentId));

    for (const category of tally.categories) {
      for (const finalist of category.finalists) {
        const inPhase3 = finalist.employeeId
          ? advancing.has(finalist.employeeId)
          : advancingTeams.has(finalist.departmentId);
        await tx.candidate.update({
          where: { id: finalist.candidateId },
          data: { committeePoints: finalist.points, inPhase3 },
        });
      }
    }
  }
}

module.exports = {
  computePhase1Tally,
  computePhase2Tally,
  presentPhaseResults,
  cutProblems,
  applyCut,
  selectAdvancingPeople,
  slotKey,
};
