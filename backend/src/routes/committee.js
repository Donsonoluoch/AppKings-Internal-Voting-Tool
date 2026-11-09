const express = require('express');
const { z } = require('zod');

const config = require('../config');
const prisma = require('../lib/prisma');
const { errors } = require('../lib/errors');
const { audit, ACTIONS } = require('../lib/audit');
const { validate } = require('../middleware/validate');
const { requireRole } = require('../middleware/role');
const { requirePhase } = require('../middleware/phase');
const { clientIp } = require('../middleware/audit');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requireRole('COMMITTEE'));

const categorySelect = { id: true, name: true, criteria: true, forTeams: true, sortOrder: true };

const candidateInclude = {
  category: { select: categorySelect },
  employee: {
    select: {
      id: true,
      fullName: true,
      eligible: true,
      active: true,
      department: { select: { name: true } },
    },
  },
  department: { select: { id: true, name: true } },
  committeeVotes: { select: { memberId: true } },
  conflicts: { select: { memberId: true, reason: true } },
};

function presentCandidate(candidate, memberId) {
  const picks = candidate.committeeVotes || [];
  const conflicts = candidate.conflicts || [];
  return {
    id: candidate.id,
    categoryId: candidate.categoryId,
    name: candidate.employee ? candidate.employee.fullName : candidate.department?.name,
    kind: candidate.employee ? 'employee' : 'team',
    department: candidate.employee?.department?.name ?? null,
    eligible: candidate.employee ? candidate.employee.eligible && candidate.employee.active : true,
    nominationPoints: candidate.nominationPoints,
    inPhase2: candidate.inPhase2,
    inPhase3: candidate.inPhase3,
    // Only the member's own pick is ever exposed — never other members' picks or tallies.
    myPick: picks.some((pick) => pick.memberId === memberId),
    hasConflict: conflicts.some((conflict) => conflict.memberId === memberId),
    conflictReason: conflicts.find((conflict) => conflict.memberId === memberId)?.reason ?? null,
  };
}

// GET /api/committee/nominations — Phase 1 and 2: nominations grouped by category and nominee.
router.get(
  '/nominations',
  requirePhase('PHASE_1', 'PHASE_2'),
  asyncHandler(async (_req, res) => {
    const [categories, nominations, candidateRows] = await Promise.all([
      prisma.category.findMany({ orderBy: { sortOrder: 'asc' }, select: categorySelect }),
      prisma.nomination.findMany({
        include: {
          nominator: { select: { fullName: true } },
          nominee: { select: { id: true, fullName: true, department: { select: { name: true } } } },
          nomineeDept: { select: { id: true, name: true } },
        },
      }),
      prisma.candidate.findMany({
        select: { categoryId: true, employeeId: true, departmentId: true, inPhase2: true },
      }),
    ]);

    const madeCandidate = new Set(
      candidateRows.map((row) => `${row.categoryId}:${row.employeeId || row.departmentId}`)
    );

    const grouped = categories.map((category) => {
      const byNominee = new Map();
      for (const nomination of nominations.filter((n) => n.categoryId === category.id)) {
        const nomineeKey = nomination.nomineeId || nomination.nomineeDeptId;
        if (!byNominee.has(nomineeKey)) {
          byNominee.set(nomineeKey, {
            nomineeId: nomination.nomineeId,
            nomineeDeptId: nomination.nomineeDeptId,
            name: nomination.nominee?.fullName ?? nomination.nomineeDept?.name ?? 'Unknown',
            department: nomination.nominee?.department?.name ?? null,
            nominationCount: 0,
            nominators: [],
            justifications: [],
            isCandidate: madeCandidate.has(`${category.id}:${nomineeKey}`),
          });
        }
        const entry = byNominee.get(nomineeKey);
        entry.nominationCount += 1;
        entry.nominators.push(nomination.nominator.fullName);
        entry.justifications.push({
          nominator: nomination.nominator.fullName,
          justification: nomination.justification,
          isSelf: nomination.isSelf,
          createdAt: nomination.createdAt,
        });
      }
      return {
        ...category,
        nominees: Array.from(byNominee.values()).sort(
          (a, b) => b.nominationCount - a.nominationCount || a.name.localeCompare(b.name)
        ),
      };
    });

    res.json({ categories: grouped });
  })
);

// GET /api/committee/candidates — Phase 2: the top 15 people, shown per category.
router.get(
  '/candidates',
  requirePhase('PHASE_2'),
  asyncHandler(async (req, res) => {
    const [categories, candidates] = await Promise.all([
      prisma.category.findMany({ orderBy: { sortOrder: 'asc' }, select: categorySelect }),
      prisma.candidate.findMany({ where: { inPhase2: true }, include: candidateInclude }),
    ]);

    res.json({
      categories: categories.map((category) => ({
        ...category,
        candidates: candidates
          .filter((candidate) => candidate.categoryId === category.id)
          .map((candidate) => presentCandidate(candidate, req.user.id))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })),
      picksPerCategory: config.rules.committeePicksPerCategory,
    });
  })
);

// GET /api/committee/candidates/:id — Phase 2 detail: justifications + evidence.
router.get(
  '/candidates/:id',
  requirePhase('PHASE_2'),
  asyncHandler(async (req, res) => {
    const candidate = await prisma.candidate.findUnique({
      where: { id: req.params.id },
      include: candidateInclude,
    });
    if (!candidate) throw errors.notFound('Candidate not found.');

    const nominations = await prisma.nomination.findMany({
      where: {
        categoryId: candidate.categoryId,
        ...(candidate.employeeId
          ? { nomineeId: candidate.employeeId }
          : { nomineeDeptId: candidate.departmentId }),
      },
      include: { nominator: { select: { fullName: true } } },
      orderBy: { createdAt: 'asc' },
    });

    res.json({
      candidate: presentCandidate(candidate, req.user.id),
      justifications: nominations.map((nomination) => ({
        nominator: nomination.nominator.fullName,
        justification: nomination.justification,
        isSelf: nomination.isSelf,
        createdAt: nomination.createdAt,
      })),
    });
  })
);

const picksSchema = z.object({
  categoryId: z.string().min(1),
  candidateIds: z.array(z.string().min(1)).max(10, 'Too many picks.'),
});

// PUT /api/committee/picks — Phase 2. Up to COMMITTEE_PICKS_PER_CATEGORY picks per
// category, 1 point each, no duplicates, blocked on a declared conflict. Replaces the
// member's previous picks for that category.
router.put(
  '/picks',
  requirePhase('PHASE_2'),
  validate(picksSchema),
  asyncHandler(async (req, res) => {
    const { categoryId } = req.validated;
    const candidateIds = Array.from(new Set(req.validated.candidateIds));
    const maxPicks = config.rules.committeePicksPerCategory;

    if (candidateIds.length > maxPicks) {
      throw errors.validation(
        `You can pick at most ${maxPicks} candidate${maxPicks === 1 ? '' : 's'} per category.`
      );
    }

    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) throw errors.notFound('Category not found.');

    const candidates = await prisma.candidate.findMany({
      where: { id: { in: candidateIds } },
      include: { conflicts: { where: { memberId: req.user.id } } },
    });
    if (candidates.length !== candidateIds.length) {
      throw errors.validation('One or more candidates do not exist.');
    }
    if (candidates.some((candidate) => candidate.categoryId !== categoryId)) {
      throw errors.validation('All candidates must belong to the selected category.');
    }
    if (candidates.some((candidate) => !candidate.inPhase2)) {
      throw errors.validation('That candidate is not in the Phase 2 shortlist.');
    }
    // §11 — a member with a declared conflict cannot pick that candidate.
    if (candidates.some((candidate) => candidate.conflicts.length > 0)) {
      throw errors.forbidden('You cannot pick a candidate you declared a conflict of interest on.');
    }

    await prisma.$transaction([
      prisma.committeeVote.deleteMany({ where: { categoryId, memberId: req.user.id } }),
      ...candidateIds.map((candidateId) =>
        prisma.committeeVote.create({ data: { categoryId, candidateId, memberId: req.user.id } })
      ),
    ]);

    await audit({
      actorId: req.user.id,
      action: ACTIONS.COMMITTEE_PICK,
      details: { categoryId, count: candidateIds.length },
      ip: clientIp(req),
    });

    res.json({ ok: true, categoryId, count: candidateIds.length });
  })
);

// GET /api/committee/picks — the member's own picks only.
router.get(
  '/picks',
  requirePhase('PHASE_2'),
  asyncHandler(async (req, res) => {
    const picks = await prisma.committeeVote.findMany({
      where: { memberId: req.user.id },
      select: { categoryId: true, candidateId: true },
    });

    const byCategory = {};
    for (const pick of picks) {
      if (!byCategory[pick.categoryId]) byCategory[pick.categoryId] = [];
      byCategory[pick.categoryId].push(pick.candidateId);
    }

    res.json({ picks: byCategory, picksPerCategory: config.rules.committeePicksPerCategory });
  })
);

const conflictSchema = z.object({
  candidateId: z.string().min(1),
  reason: z.string().trim().max(300).optional().nullable(),
});

// POST /api/committee/conflicts — declaring a conflict also removes any pick already made.
router.post(
  '/conflicts',
  requirePhase('PHASE_2'),
  validate(conflictSchema),
  asyncHandler(async (req, res) => {
    const { candidateId, reason } = req.validated;

    const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!candidate) throw errors.notFound('Candidate not found.');

    await prisma.$transaction([
      prisma.conflict.upsert({
        where: { candidateId_memberId: { candidateId, memberId: req.user.id } },
        update: { reason: reason || null },
        create: { candidateId, memberId: req.user.id, reason: reason || null },
      }),
      prisma.committeeVote.deleteMany({ where: { candidateId, memberId: req.user.id } }),
    ]);

    await audit({
      actorId: req.user.id,
      action: ACTIONS.CONFLICT_DECLARED,
      details: { candidateId },
      ip: clientIp(req),
    });

    res.status(201).json({ ok: true });
  })
);

module.exports = { router };
