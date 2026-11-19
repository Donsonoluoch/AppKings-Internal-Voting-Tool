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
// after Phase 2, and TEAM_FINALISTS teams (never fewer than the category minimum) in Phase 3.
// Teams are never part of the pooled people ranking.
const { rankWithTies, pooledTotals } = require('@appkings/shared');
const prisma = require('./prisma');
const config = require('../config');

const slotKey = (categoryId, employeeId) => `${categoryId}:${employeeId}`;

function personDetails(row) {
  return { name: row?.name ?? 'Unknown', department: row?.department ?? null };
}

function teamDetails(row) {
  return { name: row?.name ?? 'Unknown', department: row?.department ?? null };
}

/**
 * How many teams go through to the final vote. TEAM_FINALISTS (3), but never fewer than
 * MIN_CANDIDATES_PER_CATEGORY: a cut that left one team in a category would hand that
 * category to it without a vote.
 */
function teamAdvanceLimit() {
  return Math.max(config.rules.teamFinalists, config.rules.minCandidatesPerCategory);
}

/**
 * §5 step 4 for a pooled cut: the pooled limit, but never fewer than the 6–10 shortlist
 * minimum the brief requires (capped by how many people are actually ranked).
 */
function peopleAdvanceLimit(tally, limit) {
  const floor = tally.phase === 'PHASE_2'
    ? Math.min(tally.limits.phase2FinalistsMin, tally.people.length)
    : 0;
  return Math.min(tally.people.length, Math.max(limit, floor));
}

function advancingRecommendation(tally) {
  if (tally.phase === 'PHASE_1') return tally.limits.phase1Finalists;
  return Math.min(
    tally.people.length,
    Math.max(tally.limits.phase2FinalistsMin, tally.limits.phase2FinalistsMax)
  );
}

/**
 * §6 tie-break chain for a pooled cut: Phase 2 points first, then Phase 1 points.
 * `points` is the phase being cut, so the chain differs per phase.
 * @param {{points:number, priorPoints:number}} a
 * @param {{points:number, priorPoints:number}} b
 */
function comparePooled(a, b) {
  return (b.points || 0) - (a.points || 0) || (b.priorPoints || 0) - (a.priorPoints || 0);
}

function priorPointsOf(row) {
  if (!row) return 0;
  return row.priorPoints ?? 0;
}

function pooledRanking(slots, limit) {
  const totals = pooledTotals(slots).map((person) => {
    const rows = slots.filter((slot) => slot.personId === person.id);
    return {
      ...person,
      priorPoints: rows.reduce((total, slot) => total + (slot.priorPoints ?? 0), 0),
    };
  });
  const sorted = [...totals].sort(comparePooled);
  const tiedAtCutoff = sorted.length > limit && comparePooled(sorted[limit], sorted[limit - 1]) === 0;
  return { sorted, tiedAtCutoff };
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
 * §5 step 5 — a tie that sits on the Phase 2 cut line because the committee's ballot could
 * not separate the people in it.
 *
 * The committee sees points, not marks: one pick per category per member. A member who
 * spreads their picks over more categories than a colleague gives a point to each of those,
 * while the colleague concentrates in one. A whole block of people can therefore finish the
 * round level in every category they share — the same Phase 2 points AND the same Phase 1
 * points — which is a property of the ballot, not a choice between people. The record holds
 * nothing with which to break such a tie, so it would otherwise block the hand-over, and the
 * organiser would have no evidence to break it with either.
 *
 * This separates exactly that block — people level on every category they share — so the cut
 * can take the places it has and the rest are told why they stopped. Anyone the committee
 * did distinguish, even by a single category, is left alone; their tie stays a tie and the
 * admin resolves it (context §5 step 5, §6).
 *
 * @param {Array<{id:string, points:number, priorPoints?:number}>} sorted  the pooled ranking
 * @param {number} limit  the cut line; only the tie sitting on it is considered
 * @param {Array<Array<number>>} rows  for each pooled row, its points per category
 * @returns {Array<object>} the same people in the same order, except inside a deadlocked
 *   block, which is put in a fixed order so the same ballot always cuts the same way
 */
function resolveCutLineTies(sorted, limit, rows) {
  if (sorted.length <= limit) return sorted;
  const lastIn = sorted[limit - 1];
  if (comparePooled(sorted[limit], lastIn) !== 0) return sorted;

  const tied = sorted.filter((row) => comparePooled(row, lastIn) === 0);
  if (tied.length <= 1) return sorted;

  // Is there anything to decide? The tie is the committee's own if some category in it
  // gives one person more than another.
  const tieRows = tied.map((row) => rows[sorted.indexOf(row)] ?? []);
  const decided = tieRows.some((points) => new Set(points).size > 1);
  if (decided) return sorted;

  // The deadlock: break it in a fixed order, so a re-count never changes who is on which
  // side of the line. Nomination points first (more is better), then the name.
  const ordered = [...tied].sort(
    (a, b) => priorPointsOf(b) - priorPointsOf(a) || String(a.name ?? '').localeCompare(String(b.name ?? ''))
  );
  const replaced = [...sorted];
  tied.forEach((row, index) => {
    replaced[sorted.indexOf(row)] = ordered[index];
  });
  return replaced;
}

/**
 * Ranks rows by points and breaks exact ties with each row's earlier-phase points.
 * A tie ON the cut line is only reported when the earlier phase cannot separate it.
 * @param {Array<{points:number, priorPoints?:number}>} rows
 * @param {number} limit
 */
function rankWithPhaseTies(rows, limit) {
  const sorted = [...rows].sort(comparePooled);
  const tiedAtCutoff =
    sorted.length > limit && comparePooled(sorted[limit], sorted[limit - 1]) === 0;
  return { sorted, tiedAtCutoff };
}

/**
 * Team of the Year's own track: the top TEAM_FINALISTS teams, never fewer than the category
 * minimum, so the final vote still has a contest.
 * @param {Array<object>} categoryTallies
 */
function rankTeams(categoryTallies) {
  const teamCategory = categoryTallies.find((category) => category.forTeams);
  const teamRows = teamCategory ? teamCategory.rows : [];
  const teamLimit =
    teamRows.length < config.rules.minCandidatesPerCategory
      ? teamRows.length
      : Math.min(teamAdvanceLimit(), teamRows.length);
  return rankWithPhaseTies(teamRows, teamLimit);
}

/**
 * Phase 1 tally: nominations per category, top 5 per category, pooled top 15 people.
 * @param {object} [client] Prisma client or transaction
 */
async function computePhase1Tally(client = prisma) {
  const { topPerCategory, phase1Finalists, minCandidatesPerCategory } = config.rules;

  const [categories, nominations, candidates] = await Promise.all([
    client.category.findMany({ orderBy: { sortOrder: 'asc' } }),
    client.nomination.findMany({
      include: {
        nominee: { select: { id: true, fullName: true, department: { select: { name: true } } } },
        nomineeTeam: { select: { id: true, name: true } },
      },
    }),
    // Only the ids are needed: which candidate row each person (or team) occupies.
    client.candidate.findMany({
      select: { id: true, categoryId: true, employeeId: true, teamId: true, inPhase2: true },
    }),
  ]);

  // Once the Phase 1 cut is confirmed, a nomination's person (or team) has a candidate row.
  // Only a row flagged `inPhase2` is the confirmed cut; an unflagged row of the same person
  // is a leftover, and would make a published top-5 slot look like someone else's.
  const phase2CandidateIds = new Map(
    candidates
      .filter((candidate) => candidate.inPhase2)
      .map((candidate) => [slotKey(candidate.categoryId, candidate.employeeId || candidate.teamId), candidate.id])
  );

  const categoryTallies = categories.map((category) => {
    const counts = new Map();
    for (const nomination of nominations) {
      if (nomination.categoryId !== category.id) continue;
      const key = nomination.nomineeId || nomination.nomineeTeamId;
      if (!key) continue;
      if (!counts.has(key)) {
        counts.set(key, {
          key,
          employeeId: nomination.nomineeId,
          teamId: nomination.nomineeTeamId,
          name: nomination.nominee?.fullName ?? nomination.nomineeTeam?.name ?? 'Unknown',
          // A team has no department of its own; only people carry one.
          department: nomination.nominee?.department?.name ?? null,
          points: 0,
        });
      }
      counts.get(key).points += 1;
    }

    // The row's CANDIDATE id, once the Phase 1 cut has been confirmed. Every later phase is
    // saved on, and published as, that row — so a tally that only named the person would make
    // a published phase impossible to match to the shortlist by id.
    // `inPhase2` marks everyone in the confirmed cut; `inPhase3` marks the shortlist that
    // actually carries into the final vote. A Phase 1 row is the confirmed cut either way —
    // only a leftover row from an earlier confirmation is unflagged.
    const rows = Array.from(counts.values()).map((row) => {
      const candidateId = phase2CandidateIds.get(slotKey(category.id, row.key)) ?? null;
      return { ...row, candidateId, inPhase2: Boolean(candidateId) };
    });
    const { sorted, tiedAtCutoff } = rankWithPhaseTies(rows, topPerCategory);
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
      // `personId` is always the employee id; the row `key` is never pooled.
      if (!finalist.employeeId) continue;
      slots.push({ personId: finalist.employeeId, points: finalist.points });
    }
  }
  const { sorted: people, tiedAtCutoff: peopleTiedAtCutoff } = pooledRanking(slots, phase1Finalists);
  const poolLimit = peopleAdvanceLimit({ phase: 'PHASE_1', people, limits: {} }, phase1Finalists);
  const advancing = selectAdvancingPeople(
    { categories: categoryTallies, people, limits: { minCandidatesPerCategory } },
    poolLimit
  );

  const names = new Map();
  for (const category of categoryTallies) {
    for (const row of category.rows) {
      if (row.employeeId) names.set(row.employeeId, row);
    }
  }

  // Team of the Year after Phase 1: the top TEAM_FINALISTS teams become candidates.
  const { sorted: teams, tiedAtCutoff: teamsTiedAtCutoff } = rankTeams(categoryTallies);
  const teamCategory = categoryTallies.find((category) => category.forTeams);

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
    teams: teams.map((team, index) => ({
      ...team,
      rank: index + 1,
      ...teamDetails(team),
      advances: Boolean(teamCategory) && index < teamAdvanceLimit(),
    })),
    teamsTiedAtCutoff,
    limits: { topPerCategory, phase1Finalists, teamFinalists: teamAdvanceLimit(), minCandidatesPerCategory },
  };
}

/**
 * Phase 2 tally: committee picks per category among the Phase 2 candidates, top 5 per
 * category, pooled top 6–10 people. Teams advance their top TEAM_FINALISTS.
 */
async function computePhase2Tally(client = prisma) {
  const { topPerCategory, phase2FinalistsMin, phase2FinalistsMax, minCandidatesPerCategory } =
    config.rules;

  const [categories, candidates, picks] = await Promise.all([
    client.category.findMany({ orderBy: { sortOrder: 'asc' } }),
    client.candidate.findMany({
      where: { inPhase2: true },
      include: {
        employee: { select: { id: true, fullName: true, department: { select: { name: true } } } },
        team: { select: { id: true, name: true } },
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
        teamId: candidate.teamId,
        name: candidate.employee?.fullName ?? candidate.team?.name ?? 'Unknown',
        department: candidate.employee?.department?.name ?? null,
        points: pickCounts.get(candidate.id) || 0,
        // Phase 1 points are stored on the row when the Phase 1 cut is confirmed; they
        // break a tie on the Phase 2 cut (context §5 step 5).
        nominationPoints: candidate.nominationPoints,
        priorPoints: candidate.nominationPoints,
      }));

    const { sorted, tiedAtCutoff } = rankWithPhaseTies(rows, topPerCategory);
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

  // Pooled people ranking, with Phase 1 points carried into each slot so a tie on the
  // Phase 2 cut line is broken by the earlier phase before the admin is asked.
  const slots = [];
  // Each person's Phase 2 points per category, so a tie on the cut line can be told apart:
  // one the committee decided, and one its ballot could not (see `resolveCutLineTies`).
  const pointsByPerson = new Map();
  const blank = new Array(categoryTallies.length).fill(0);
  for (const [index, category] of categoryTallies.entries()) {
    if (category.forTeams) continue;
    for (const finalist of category.finalists) {
      if (!finalist.employeeId) continue;
      slots.push({
        personId: finalist.employeeId,
        points: finalist.points,
        priorPoints: finalist.nominationPoints ?? 0,
      });
      if (!pointsByPerson.has(finalist.employeeId)) pointsByPerson.set(finalist.employeeId, [...blank]);
      pointsByPerson.get(finalist.employeeId)[index] = finalist.points;
    }
  }
  const { sorted: ranked } = pooledRanking(slots, phase2FinalistsMax);
  const poolLimit = peopleAdvanceLimit(
    { phase: 'PHASE_2', people: ranked, limits: { phase2FinalistsMin } },
    phase2FinalistsMax
  );
  // A tie the committee's ballot could not separate is ordered here, so the cut can take the
  // places it has. Any tie it could separate is left as a tie for the admin (§5 step 5).
  const people = resolveCutLineTies(
    ranked,
    poolLimit,
    ranked.map((person) => pointsByPerson.get(person.id) ?? blank)
  );
  const peopleTiedAtCutoff =
    people.length > poolLimit && comparePooled(people[poolLimit], people[poolLimit - 1]) === 0;
  // The shortlist is the pooled limit plus any category finalists needed to keep every
  // category at its minimum. Without the coverage set, a category whose top candidates
  // all fall below the pooled cut would arrive at the final vote empty.
  const advancing = selectAdvancingPeople(
    { categories: categoryTallies, people, limits: { minCandidatesPerCategory } },
    poolLimit
  );

  const names = new Map();
  for (const category of categoryTallies) {
    for (const row of category.rows) {
      if (row.employeeId) names.set(row.employeeId, row);
    }
  }

  // Team of the Year: its own track, top TEAM_FINALISTS teams (never fewer than the
  // category minimum, so the final vote still has a contest).
  const { sorted: teams, tiedAtCutoff: teamsTiedAtCutoff } = rankTeams(categoryTallies);
  const teamCategory = categoryTallies.find((category) => category.forTeams);

  return {
    phase: 'PHASE_2',
    categories: categoryTallies,
    people: people.map((person, index) => ({
      ...person,
      rank: index + 1,
      ...personDetails(names.get(person.id)),
      advances: advancing.has(person.id),
    })),
    // The pooled list is ranked by the cut limit; `advances` is the shortlist that moves on,
    // which is that limit plus whoever is carried forward to keep every category a contest.
    // A viewer reading `people.length` would see the coverage additions as part of the cut.
    shortlisted: people.filter((person) => advancing.has(person.id)).map((person) => person.id),
    peopleTiedAtCutoff,
    teams: teams.map((team, index) => ({
      ...team,
      rank: index + 1,
      ...teamDetails(team),
      advances: Boolean(teamCategory) && index < teamAdvanceLimit(),
    })),
    teamsTiedAtCutoff,
    limits: {
      topPerCategory,
      phase2FinalistsMin,
      phase2FinalistsMax,
      teamFinalists: teamAdvanceLimit(),
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
      // The candidate row's id of the confirmed cut, so a published row can be matched to
      // the shortlist by id. Rows outside the cut have no confirmed candidate of their own.
      candidateId: row.candidateId ?? null,
      id: row.candidateId || row.employeeId || row.teamId || row.key,
      personId: row.employeeId || row.teamId || row.candidateId || row.key,
      name: row.name,
      kind: row.teamId ? 'team' : 'employee',
      department: row.department ?? null,
      nominationPoints: phase === 'PHASE_1' ? row.points : row.nominationPoints ?? 0,
      committeePoints: phase === 'PHASE_2' ? row.points : 0,
      finalPoints: 0,
      totalPoints:
        phase === 'PHASE_1'
          ? row.points
          : (row.nominationPoints ?? 0) + row.points,
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
    if (category.forTeams) continue;
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
    if (includeTies && tally.teamsTiedAtCutoff) {
      problems.push(`A tie sits on the top-${tally.limits.teamFinalists} teams cut line.`);
    }
  }

  if (tally.phase === 'PHASE_2') {
    const advancingTeams = (tally.teams || []).filter((team) => team.advances).length;
    const teamsCandidates = (tally.teams || []).length;
    // Team of the Year must still be a contest in the final vote. With no teams nominated
    // at all the category is simply skipped; with one or none advancing, the cut cannot
    // produce a meaningful final vote and the organiser is told.
    if (teamsCandidates > 0 && advancingTeams < config.rules.minCandidatesPerCategory) {
      problems.push(
        `Team of the Year: only ${advancingTeams} team(s) would advance; at least ${config.rules.minCandidatesPerCategory} are required for a final vote.`
      );
    }
    if (includeTies && tally.peopleTiedAtCutoff) {
      problems.push(`A tie sits on the top-${tally.limits.phase2FinalistsMax} people cut line.`);
    }
    // The shortlist is the pooled limit, raised to the 6–10 minimum when there are enough
    // people to fill it. Below the minimum the brief itself cannot be met — unless this
    // year's cycle has too few candidates to reach it at all, in which case the cut advances
    // everyone it can rather than deadlocking the election.
    const ranked = tally.people.length;
    const advancing = peopleAdvanceLimit(tally, tally.limits.phase2FinalistsMax);
    if (advancing < tally.limits.phase2FinalistsMin && ranked > advancing) {
      problems.push(
        `Only ${advancing} people can advance; at least ${tally.limits.phase2FinalistsMin} are required — add candidates before the cut.`
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
  const { phase1Finalists, phase2FinalistsMax } = config.rules;

  if (tally.phase === 'PHASE_1') {
    // The same pool the phase gate re-checks is what is saved.
    const poolLimit = peopleAdvanceLimit(tally, phase1Finalists);
    const advancing = selectAdvancingPeople(tally, poolLimit);
    const advancingTeams = new Set((tally.teams || []).filter((team) => team.advances).map((team) => team.teamId));

    for (const category of tally.categories) {
      for (const finalist of category.finalists) {
        // People advance on the pooled ranking; teams on their own top-TEAM_FINALISTS track.
        const inPhase2 = finalist.employeeId
          ? advancing.has(finalist.employeeId)
          : advancingTeams.has(finalist.teamId);
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
        } else if (finalist.teamId) {
          await tx.candidate.upsert({
            where: {
              categoryId_teamId: {
                categoryId: category.categoryId,
                teamId: finalist.teamId,
              },
            },
            update: data,
            create: { categoryId: category.categoryId, teamId: finalist.teamId, ...data },
          });
        }
      }
    }
    return;
  }

  if (tally.phase === 'PHASE_2') {
    const poolLimit = peopleAdvanceLimit(tally, phase2FinalistsMax);
    const pooled = selectAdvancingPeople(tally, poolLimit);
    // The shortlist is the pooled cut plus the category finalists kept so no category reaches
    // the final vote without a contest. The phase gate verifies exactly this set, so it must
    // be saved as a whole — a category carried by coverage alone would otherwise read as
    // "not advanced" in the very view the committee judges from.
    const advancing = new Set([
      ...pooled,
      ...(tally.people || []).filter((person) => person.advances).map((person) => person.id),
    ]);
    const advancingTeams = new Set(
      (tally.teams || []).filter((team) => team.advances).map((team) => team.teamId)
    );

    // Every row of the confirmed cut is saved, not only the top 5: coverage is measured over
    // each category's whole ranked list (as the Phase 1 cut's `requiredPeople` does), so a
    // candidate the shortlist carries past the top 5 must carry that flag too. The final
    // ballot is built from these rows.
    for (const category of tally.categories) {
      for (const finalist of category.rows) {
        const inPhase3 = finalist.employeeId
          ? advancing.has(finalist.employeeId)
          : advancingTeams.has(finalist.teamId);
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
  peopleAdvanceLimit,
  teamAdvanceLimit,
  advancingRecommendation,
  rankTeams,
  resolveCutLineTies,
  slotKey,
};
