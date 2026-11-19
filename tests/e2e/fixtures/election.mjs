// The spec's own record of an election, kept independently of the API.
//
// Points are counted the way the brief counts them — one pick per voter per category,
// 1 point each, summed — but from the spec's own picks rather than the API's answer.
// Keeping this separate is what lets the suite catch the API counting something it should
// not, instead of echoing whatever the server said.
//
// Nomination and committee buckets are keyed by the PERSON (or team) being named, because
// that is the answer to "who did this voter name" and does not change between phases. The
// final vote is keyed by the CANDIDATE row, the same row that carries the shortlist flags
// and the frozen points the results page ranks.

export class ExpectedElection {
  constructor() {
    /** @type {Map<string, Map<string, Set<string>>>} categoryId → personId/teamId → voter ids */
    this.nominations = new Map();
    /** @type {Map<string, Map<string, Set<string>>>} categoryId → candidateId → member ids */
    this.committee = new Map();
    /** @type {Map<string, Map<string, number>>} categoryId → candidateId → final votes */
    this.finalVotes = new Map();
    /**
     * The committee's points per category, keyed by the person (or team) the pick names:
     * categoryId → personId → points. `committee` above is keyed the same way but counts
     * across the whole tally, so a person shortlisted in two categories has one total there
     * and is credited in each of them here.
     * @type {Map<string, Map<string, number>>}
     */
    this.categorySplit = new Map();
  }

  /** Records one voter's pick. Ids throughout — two employees can share a full name. */
  static add(bucket, categoryId, key, by) {
    if (!bucket.has(categoryId)) bucket.set(categoryId, new Map());
    const category = bucket.get(categoryId);
    if (!category.has(key)) category.set(key, new Set());
    category.get(key).add(by);
  }

  /** Removes one voter's pick, for a pick that is replaced rather than added. */
  static remove(bucket, categoryId, voterId) {
    for (const voters of bucket.get(categoryId)?.values() ?? []) voters.delete(voterId);
  }

  static tally(bucket, categoryId) {
    return [...(bucket.get(categoryId)?.entries() ?? [])].map(([key, voters]) => ({
      key,
      points: voters.size,
    }));
  }

  addNomination(categoryId, nomineeKey, voterId) {
    ExpectedElection.add(this.nominations, categoryId, nomineeKey, voterId);
  }

  addCommitteePick(categoryId, candidateId, memberId) {
    ExpectedElection.add(this.committee, categoryId, candidateId, memberId);
  }

  replaceNomination(categoryId, nomineeId, voterId) {
    ExpectedElection.remove(this.nominations, categoryId, voterId);
    this.addNomination(categoryId, nomineeId, voterId);
  }

  addFinalVote(categoryId, candidateId) {
    if (!this.finalVotes.has(categoryId)) this.finalVotes.set(categoryId, new Map());
    const votes = this.finalVotes.get(categoryId);
    votes.set(candidateId, (votes.get(candidateId) || 0) + 1);
  }

  /** Every nomination in a category, by person (or team), highest first. */
  nominationTally(categoryId) {
    return ExpectedElection.tally(this.nominations, categoryId).sort((a, b) => b.points - a.points);
  }

  nominationPoints(categoryId, personId) {
    return ExpectedElection.tally(this.nominations, categoryId).find((row) => row.key === personId)?.points ?? 0;
  }

  /** Phase 2 points, by person (or team) — the committee picks tracked above. */
  committeePoints(categoryId, personId) {
    return ExpectedElection.tally(this.committee, categoryId).find((row) => row.key === personId)?.points ?? 0;
  }

  finalVoteCount(categoryId) {
    return [...(this.finalVotes.get(categoryId)?.values() ?? [])].reduce((sum, n) => sum + n, 0);
  }

  finalPoints(categoryId, candidateId) {
    return this.finalVotes.get(categoryId)?.get(candidateId) ?? 0;
  }

  /** The final votes this spec cast in a category: candidateId → votes. */
  finalVotesFor(categoryId) {
    return new Map(this.finalVotes.get(categoryId) ?? []);
  }
}

/**
 * The documented tie-break chain (§6): this round's points, then the earlier rounds' points.
 * @param {{finalPoints?: number, committeePoints?: number, nominationPoints?: number}} a
 * @param {object} b
 */
export function byTieBreakChain(a, b) {
  return (
    (b.finalPoints || 0) - (a.finalPoints || 0) ||
    (b.committeePoints || 0) - (a.committeePoints || 0) ||
    (b.nominationPoints || 0) - (a.nominationPoints || 0)
  );
}

/**
 * Who should win a category, recounted from the final votes this spec cast.
 * Highest final points wins. Only when finalists are level does the chain decide, and a
 * complete tie is reported as a tie — never as a winner.
 *
 * @param {Array<{candidateId: string, finalPoints: number, committeePoints: number, nominationPoints: number}>} rows
 * @returns {{ type: 'winner', row: object } | { type: 'tie', rows: object[] }}
 */
export function expectedWinner(rows) {
  const ranked = [...rows].sort(byTieBreakChain);
  const tied = ranked.filter((row) => byTieBreakChain(row, ranked[0]) === 0);
  return tied.length === 1 ? { type: 'winner', row: ranked[0] } : { type: 'tie', rows: tied };
}

/**
 * The same recount for the overall title: each person's points summed across every
 * category they were a finalist in. Teams are not people and never rank here.
 * @param {Array<{id: string, kind: string, finalPoints: number,
 *   committeePoints: number, nominationPoints: number}>} rows  every category's finalists
 */
export function expectedOverall(rows) {
  const people = new Map();
  for (const row of rows) {
    if (row.kind !== 'employee') continue;
    const person = people.get(row.id) ?? {
      id: row.id,
      finalPoints: 0,
      committeePoints: 0,
      nominationPoints: 0,
    };
    person.finalPoints += row.finalPoints;
    person.committeePoints += row.committeePoints;
    person.nominationPoints += row.nominationPoints;
    people.set(row.id, person);
  }
  const ranked = [...people.values()]
    .map((person) => ({
      ...person,
      totalPoints: person.finalPoints + person.committeePoints + person.nominationPoints,
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints || byTieBreakChain(a, b));
  const tied = ranked.filter((row) => byTieBreakChain(row, ranked[0]) === 0);
  return { tied: tied.length > 1, rows: ranked, id: ranked[0]?.id };
}

/**
 * A small reproducible random stream, so a failing run can be replayed exactly.
 * Pass E2E_RANDOM_SEED to replay another run; the seed used is printed in the annotations.
 */
export function createRandom(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    pick: (items) => items[Math.floor(next() * items.length)],
    /** Uniform draw of `count` distinct items, via Fisher–Yates over a copy. */
    sample: (items, count) => {
      const pool = [...items];
      for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, count);
    },
  };
}
