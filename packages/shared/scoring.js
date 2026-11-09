// §6 — points only. Nothing is converted to a percentage and there is no MAX_SCORE.
//
// Every phase works the same way: each voter makes one pick per category, each pick is
// worth 1 point, and points are simply added up.
//
//   Phase 1  nominations  → top 5 per category → pooled top 15 people overall
//   Phase 2  committee    → top 6–10 people overall (pooled again)
//   Phase 3  final vote   → most points in a category wins
//
// The pure math lives here so the API and the web app agree; the database assembly is in
// backend/src/lib/tally.js.

/**
 * Ranks rows by points, highest first.
 * @param {Array<{id:string, points:number}>} rows
 * @param {number} limit  the cut line (e.g. 15 people, 5 per category)
 * @returns {{sorted: Array, tiedAtCutoff: boolean}} `tiedAtCutoff` is true when the row
 *   sitting on the cut line has the same points as the row just above it — the admin must
 *   resolve that tie before the phase can move on.
 */
function rankWithTies(rows, limit) {
  const sorted = [...rows].sort((a, b) => b.points - a.points);
  const tiedAtCutoff =
    sorted.length > limit && sorted[limit].points === sorted[limit - 1].points;
  return { sorted, tiedAtCutoff };
}

/**
 * Pools a person's points across the categories where they are a finalist.
 * @param {Array<{personId:string, points:number}>} slots  one entry per category slot
 * @returns {Array<{id:string, points:number}>} each person's total, highest first
 */
function pooledTotals(slots) {
  const totals = new Map();
  for (const s of slots) {
    totals.set(s.personId, (totals.get(s.personId) || 0) + s.points);
  }
  return [...totals]
    .map(([id, points]) => ({ id, points }))
    .sort((a, b) => b.points - a.points);
}

/**
 * §6 tie-break chain: this phase's points, then the earlier phases' points (Phase 2, then
 * Phase 1), then the admin decides. Never auto-resolve the final tie.
 *
 * @param {object} a  { finalPoints, committeePoints, nominationPoints }
 * @param {object} b  same shape
 * @returns {number} negative when `a` ranks first, positive when `b` does, 0 when tied
 */
function compareByTieBreak(a, b) {
  return (
    (b.finalPoints || 0) - (a.finalPoints || 0) ||
    (b.committeePoints || 0) - (a.committeePoints || 0) ||
    (b.nominationPoints || 0) - (a.nominationPoints || 0)
  );
}

/**
 * Ranks one category's candidates for the final vote.
 * @param {Array<{id:string, finalPoints:number, committeePoints:number, nominationPoints:number}>} candidates
 * @returns {{rows: Array, winnerId: string|null, tiebreakRequired: boolean}}
 *   `tiebreakRequired` is true when the top two cannot be separated by the tie-break chain.
 */
function rankCategory(candidates) {
  const rows = [...candidates].sort(compareByTieBreak);
  const top = rows[0];
  const tiebreakRequired = rows.length > 1 && compareByTieBreak(rows[0], rows[1]) === 0;
  return { rows, winnerId: top ? top.id : null, tiebreakRequired };
}

/**
 * The single overall winner across every category.
 *
 * Each category crowns its own winner; this answers the other question — who had the
 * best year overall. A person's score is the sum of their total points in every
 * category they were a finalist in, so someone shortlisted in three categories can
 * outrank a single-category winner. Teams are excluded: the overall title is for a
 * person.
 *
 * Ties are never broken automatically. `tiebreakRequired` is true when the top two
 * cannot be separated by the same chain the categories use, and the organiser decides.
 *
 * @param {Array<{id:string, name:string, kind:string, department:string|null,
 *   nominationPoints:number, committeePoints:number, finalPoints:number, totalPoints:number}>} rows
 *   every finalist row from every category
 * @returns {{rows: Array, winnerId: string|null, tiebreakRequired: boolean}}
 */
function overallChampion(rows) {
  const people = new Map();
  for (const row of rows) {
    if (row.kind !== 'employee') continue;
    // Group by the PERSON, not the candidate row: someone shortlisted in two
    // categories must appear once, with their points from both.
    const personId = row.personId ?? row.id;
    const current = people.get(personId) ?? {
      id: personId,
      name: row.name,
      department: row.department ?? null,
      categories: 0,
      nominationPoints: 0,
      committeePoints: 0,
      finalPoints: 0,
      totalPoints: 0,
    };
    current.categories += 1;
    current.nominationPoints += row.nominationPoints || 0;
    current.committeePoints += row.committeePoints || 0;
    current.finalPoints += row.finalPoints || 0;
    current.totalPoints += row.totalPoints || 0;
    people.set(personId, current);
  }

  const compareOverall = (a, b) =>
    (b.totalPoints || 0) - (a.totalPoints || 0) || compareByTieBreak(a, b);
  const ranked = [...people.values()].sort(compareOverall);
  const top = ranked[0];

  // Keep the display order stable, but only treat a complete score tie as unresolved.
  const tiedAtTop = ranked.filter((row) => compareOverall(row, top) === 0);
  const tiebreakRequired = tiedAtTop.length > 1;

  return {
    rows: ranked,
    winnerId: tiebreakRequired ? null : top ? top.id : null,
    tiebreakRequired,
    tiedIds: tiebreakRequired ? tiedAtTop.map((row) => row.id) : [],
  };
}

module.exports = { rankWithTies, pooledTotals, compareByTieBreak, rankCategory, overallChampion };
