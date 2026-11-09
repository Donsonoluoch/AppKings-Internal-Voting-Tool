const express = require('express');
const { z } = require('zod');

const config = require('../config');
const prisma = require('../lib/prisma');
const { errors } = require('../lib/errors');
const { audit, ACTIONS } = require('../lib/audit');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { requirePhase } = require('../middleware/phase');
const { clientIp } = require('../middleware/audit');
const asyncHandler = require('../middleware/asyncHandler');
const { computeResults, computeMyResults } = require('../lib/scoring');
const { computePhase1Tally, computePhase2Tally, presentPhaseResults } = require('../lib/tally');

const router = express.Router();
router.use(requireAuth);

const categorySelect = { id: true, name: true, criteria: true, forTeams: true, sortOrder: true };

// GET /api/categories — any phase
router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      orderBy: { sortOrder: 'asc' },
      select: categorySelect,
    });
    res.json({ categories });
  })
);

// GET /api/colleagues — names and departments only (§13: no phone numbers ever leave this endpoint)
router.get(
  '/colleagues',
  asyncHandler(async (req, res) => {
    const [employees, departments] = await Promise.all([
      prisma.employee.findMany({
        where: { eligible: true, active: true },
        orderBy: { fullName: 'asc' },
        select: {
          id: true,
          fullName: true,
          departmentId: true,
          department: { select: { name: true } },
        },
      }),
      prisma.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ]);

    res.json({
      colleagues: employees.map((employee) => ({
        id: employee.id,
        fullName: employee.fullName,
        department: employee.department?.name ?? null,
        isSelf: employee.id === req.user.id,
      })),
      teams: departments.map((team) => ({ id: team.id, name: team.name })),
    });
  })
);

// GET /api/nominations/summary — how many self-nominations this employee has used (§1)
router.get(
  '/nominations/summary',
  asyncHandler(async (req, res) => {
    const [selfNominated, total, byCategory] = await Promise.all([
      prisma.nomination.count({ where: { nominatorId: req.user.id, isSelf: true } }),
      prisma.nomination.count({ where: { nominatorId: req.user.id } }),
      prisma.nomination.groupBy({
        by: ['categoryId'],
        where: { nominatorId: req.user.id },
        _count: { _all: true },
      }),
    ]);
    const selfLimit = config.rules.selfNominationLimit;

    res.json({
      total,
      selfNominated,
      selfNominationsRemaining: Math.max(0, selfLimit - selfNominated),
      selfNominationLimit: selfLimit,
      byCategory: Object.fromEntries(byCategory.map((row) => [row.categoryId, row._count._all])),
    });
  })
);

const nominationSchema = z
  .object({
    categoryId: z.string().min(1),
    nomineeId: z.string().min(1).optional().nullable(),
    nomineeDeptId: z.string().min(1).optional().nullable(),
    justification: z.string().trim().optional(),
  })
  .refine((value) => Boolean(value.nomineeId) !== Boolean(value.nomineeDeptId), {
    message: 'Pick one nominee: an employee, or a team for Team of the Year.',
  });

// PUT /api/nominations — Phase 1 only. One nomination per category; replaces the earlier
// choice until Phase 1 closes (§5, §10).
router.put(
  '/nominations',
  requirePhase('PHASE_1'),
  validate(nominationSchema),
  asyncHandler(async (req, res) => {
    const { categoryId, nomineeId, nomineeDeptId } = req.validated;
    const justification = (req.validated.justification || '').trim();
    const { minJustification } = config.rules;

    if (justification.length < minJustification) {
      throw errors.validation(`Please write at least ${minJustification} characters.`, [
        { path: 'justification', message: 'Too short' },
      ]);
    }
    if (justification.length > 1000) {
      throw errors.validation('Keep the justification under 1000 characters.');
    }

    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) throw errors.notFound('Category not found.');
    if (category.forTeams && !nomineeDeptId) {
      throw errors.validation('Team of the Year nominees must be a team.');
    }
    if (!category.forTeams && !nomineeId) {
      throw errors.validation('Pick a colleague for this category.');
    }

    if (nomineeId) {
      const nominee = await prisma.employee.findUnique({ where: { id: nomineeId } });
      if (!nominee) throw errors.notFound('Nominee not found.');
      if (!nominee.eligible) throw errors.validation('That employee is not eligible to be nominated.');
      if (!nominee.active) throw errors.validation('That employee is not active.');
    }
    if (nomineeDeptId) {
      const team = await prisma.department.findUnique({ where: { id: nomineeDeptId } });
      if (!team) throw errors.notFound('Team not found.');
    }

    const isSelf = Boolean(nomineeId) && nomineeId === req.user.id;

    const nomination = await prisma.$transaction(async (tx) => {
      // §11 — the self-nomination check runs inside the same transaction as the write.
      // Replacing a self-nomination in the same category does not use a second one.
      if (isSelf) {
        const used = await tx.nomination.count({
          where: { nominatorId: req.user.id, isSelf: true, NOT: { categoryId } },
        });
        if (used >= config.rules.selfNominationLimit) {
          throw errors.conflict(
            config.rules.selfNominationLimit === 0
              ? 'Self-nomination is not allowed.'
              : 'You have already used your one self-nomination. Nominate a colleague instead.'
          );
        }
      }

      const data = {
        nomineeId: nomineeId || null,
        nomineeDeptId: nomineeDeptId || null,
        justification,
        isSelf,
      };

      return tx.nomination.upsert({
        where: { categoryId_nominatorId: { categoryId, nominatorId: req.user.id } },
        update: data,
        create: { categoryId, nominatorId: req.user.id, ...data },
        include: {
          nominee: { select: { id: true, fullName: true } },
          nomineeDept: { select: { id: true, name: true } },
        },
      });
    });

    await audit({
      actorId: req.user.id,
      action: ACTIONS.NOMINATE,
      details: {
        categoryId,
        nomineeId: nomineeId || null,
        nomineeDeptId: nomineeDeptId || null,
        isSelf,
      },
      ip: clientIp(req),
    });

    res.json({
      nomination: {
        id: nomination.id,
        categoryId: nomination.categoryId,
        nominee: nomination.nominee?.fullName ?? nomination.nomineeDept?.name ?? null,
        justification: nomination.justification,
        isSelf: nomination.isSelf,
        createdAt: nomination.createdAt,
      },
    });
  })
);

// GET /api/nominations/mine — any phase
router.get(
  '/nominations/mine',
  asyncHandler(async (req, res) => {
    const nominations = await prisma.nomination.findMany({
      where: { nominatorId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        category: { select: categorySelect },
        nominee: { select: { id: true, fullName: true } },
        nomineeDept: { select: { id: true, name: true } },
      },
    });

    res.json({
      nominations: nominations.map((nomination) => ({
        id: nomination.id,
        categoryId: nomination.categoryId,
        categoryName: nomination.category.name,
        nomineeId: nomination.nomineeId,
        nomineeDeptId: nomination.nomineeDeptId,
        nominee: nomination.nominee?.fullName ?? nomination.nomineeDept?.name ?? null,
        justification: nomination.justification,
        isSelf: nomination.isSelf,
        createdAt: nomination.createdAt,
      })),
    });
  })
);

// GET /api/shortlist — Phase 3 onwards (and to admins at any time)
router.get(
  '/shortlist',
  asyncHandler(async (req, res) => {
    const allowed = ['PHASE_3', 'CLOSED', 'PUBLISHED'].includes(req.phase) || req.user.role === 'ADMIN';
    if (!allowed) {
      throw errors.phaseClosed('The shortlist is released when final voting opens.');
    }

    const [categories, candidates, receipts] = await Promise.all([
      prisma.category.findMany({ orderBy: { sortOrder: 'asc' }, select: categorySelect }),
      prisma.candidate.findMany({
        where: { inPhase3: true },
        include: {
          employee: {
            select: { id: true, fullName: true, department: { select: { name: true } } },
          },
          department: { select: { id: true, name: true } },
        },
      }),
      prisma.voteReceipt.findMany({ where: { voterId: req.user.id }, select: { categoryId: true } }),
    ]);

    const votedIn = new Set(receipts.map((receipt) => receipt.categoryId));

    res.json({
      categories: categories
        .map((category) => ({
          ...category,
          candidates: candidates
            .filter((candidate) => candidate.categoryId === category.id)
            .map((candidate) => ({
              id: candidate.id,
              name: candidate.employee ? candidate.employee.fullName : candidate.department?.name,
              kind: candidate.employee ? 'employee' : 'team',
              department: candidate.employee?.department?.name ?? null,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          hasVoted: votedIn.has(category.id),
        }))
        .filter((category) => category.candidates.length > 0),
    });
  })
);

const voteSchema = z.object({
  categoryId: z.string().min(1),
  candidateId: z.string().min(1),
});

// POST /api/votes — Phase 3 only, confidential, final (§9)
router.post(
  '/votes',
  requirePhase('PHASE_3'),
  validate(voteSchema),
  asyncHandler(async (req, res) => {
    const { categoryId, candidateId } = req.validated;

    const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!candidate || candidate.categoryId !== categoryId || !candidate.inPhase3) {
      throw errors.validation('That candidate is not on the shortlist for this category.');
    }

    await prisma.$transaction(async (tx) => {
      // The unique (voterId, categoryId) index is the real guard: two parallel requests
      // cannot both insert a receipt.
      try {
        await tx.voteReceipt.create({ data: { voterId: req.user.id, categoryId } });
      } catch (error) {
        if (error.code === 'P2002') {
          throw errors.conflict('You have already voted in this category. Votes are final.');
        }
        throw error;
      }
      // Confidential: the vote carries no voter id.
      await tx.vote.create({ data: { categoryId, candidateId, voterId: null } });
    });

    // §9 — audit records the category only, never the candidate.
    await audit({
      actorId: req.user.id,
      action: ACTIONS.VOTE_CAST,
      details: { categoryId },
      ip: clientIp(req),
    });

    res.status(201).json({ ok: true, categoryId });
  })
);

// GET /api/votes/status — which categories this user has already voted in
router.get(
  '/votes/status',
  asyncHandler(async (req, res) => {
    const receipts = await prisma.voteReceipt.findMany({
      where: { voterId: req.user.id },
      select: { categoryId: true, createdAt: true },
    });
    res.json({
      voted: receipts.map((receipt) => ({
        categoryId: receipt.categoryId,
        createdAt: receipt.createdAt,
      })),
    });
  })
);

// GET /api/results — published phase results, for non-admins
router.get(
  '/results',
  asyncHandler(async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const publications = {
      phase1: req.settings?.phase1ResultsPublic ?? false,
      phase2: req.settings?.phase2ResultsPublic ?? false,
      phase3: req.settings?.resultsPublic ?? false,
    };
    if (!isAdmin && !Object.values(publications).some(Boolean)) {
      throw errors.phaseClosed('Results have not been published yet.');
    }
    const [phase1, phase2, finalResults] = await Promise.all([
      isAdmin || publications.phase1 ? computePhase1Tally() : null,
      isAdmin || publications.phase2 ? computePhase2Tally() : null,
      isAdmin || publications.phase3 ? computeResults() : null,
    ]);
    const results = publications.phase3 || isAdmin ? finalResults : null;
    res.json({
      published: publications.phase3,
      publications,
      phaseResults: {
        phase1: phase1 && (isAdmin || publications.phase1)
          ? presentPhaseResults(phase1, 'PHASE_1')
          : null,
        phase2: phase2 && (isAdmin || publications.phase2)
          ? presentPhaseResults(phase2, 'PHASE_2')
          : null,
      },
      results: results ?? [],
      // The single overall winner across every category.
      overall: results?.overall ?? null,
    });
  })
);

// GET /api/results/me — the caller's own points per phase, per category and overall
router.get(
  '/results/me',
  asyncHandler(async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    if (!isAdmin && !req.settings?.resultsPublic) {
      throw errors.phaseClosed('Results have not been published yet.');
    }
    const mine = await computeMyResults(req.user.id);
    res.json({ published: req.settings?.resultsPublic ?? false, ...mine });
  })
);

module.exports = { router };
