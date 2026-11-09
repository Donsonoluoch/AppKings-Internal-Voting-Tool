// §6 — points only. Nothing is converted to a percentage.
//
// The pure math lives in @appkings/shared/scoring.js so the web app can render the same
// numbers; this module only assembles the data from the database.
const { rankCategory, overallChampion } = require('@appkings/shared');
const prisma = require('./prisma');

function presentCandidate(candidate) {
  return {
    id: candidate.id,
    // The person (or team) this row is about. `id` is the CANDIDATE row, so the
    // same employee shortlisted in two categories has two different ids — which
    // is why the overall ranking listed them twice. Grouping must use this.
    personId: candidate.employeeId ?? candidate.departmentId ?? candidate.id,
    name: candidate.employee ? candidate.employee.fullName : candidate.department?.name,
    kind: candidate.employee ? 'employee' : 'team',
    department: candidate.employee?.department?.name ?? null,
    nominationPoints: candidate.nominationPoints,
    committeePoints: candidate.committeePoints,
    finalPoints: candidate.finalPoints,
    totalPoints: candidate.nominationPoints + candidate.committeePoints + candidate.finalPoints,
  };
}

/**
 * Results for every category with shortlisted candidates.
 * Admin view and published view use the same function — only who may call it differs.
 */
async function computeResults(client = prisma) {
  const [categories, candidates] = await Promise.all([
    client.category.findMany({ orderBy: { sortOrder: 'asc' } }),
    client.candidate.findMany({
      where: { inPhase3: true },
      include: {
        employee: { select: { id: true, fullName: true, department: { select: { name: true } } } },
        department: { select: { id: true, name: true } },
      },
    }),
  ]);

  const results = categories
    .map((category) => {
      const rows = candidates
        .filter((candidate) => candidate.categoryId === category.id)
        .map(presentCandidate);
      const { rows: ranked, winnerId, tiebreakRequired } = rankCategory(rows);
      return {
        categoryId: category.id,
        categoryName: category.name,
        sortOrder: category.sortOrder,
        forTeams: category.forTeams,
        winnerId,
        tiebreakRequired,
        results: ranked,
      };
    })
    .filter((category) => category.results.length > 0);

  // The single overall winner, across every category. Attached to the array so
  // existing callers that iterate categories are unaffected.
  const allRows = results.flatMap((category) => category.results);
  const overall = overallChampion(allRows);
  Object.defineProperty(results, 'overall', {
    value: {
      winnerId: overall.winnerId,
      tiebreakRequired: overall.tiebreakRequired,
      rows: overall.rows,
    },
    enumerable: true,
  });

  return results;
}

async function computeMyResults(employeeId, client = prisma) {
  const candidates = await client.candidate.findMany({
    where: { employeeId },
    include: { category: { select: { id: true, name: true, sortOrder: true } } },
    orderBy: { category: { sortOrder: 'asc' } },
  });

  const categories = candidates.map((candidate) => ({
    categoryId: candidate.categoryId,
    categoryName: candidate.category.name,
    nominationPoints: candidate.nominationPoints,
    committeePoints: candidate.committeePoints,
    finalPoints: candidate.finalPoints,
    totalPoints: candidate.nominationPoints + candidate.committeePoints + candidate.finalPoints,
    inPhase2: candidate.inPhase2,
    inPhase3: candidate.inPhase3,
  }));

  const sum = (key) => categories.reduce((total, row) => total + row[key], 0);

  return {
    categories,
    totals: {
      nominationPoints: sum('nominationPoints'),
      committeePoints: sum('committeePoints'),
      finalPoints: sum('finalPoints'),
      totalPoints: sum('totalPoints'),
    },
  };
}

module.exports = { computeResults, computeMyResults };
