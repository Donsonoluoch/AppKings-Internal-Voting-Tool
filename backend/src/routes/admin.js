const express = require('express');
const { z } = require('zod');
const { Role, Phase } = require('@prisma/client');
const { canMoveTo, PHASE_META, PHASES } = require('@appkings/shared');

const config = require('../config');
const prisma = require('../lib/prisma');
const { errors } = require('../lib/errors');
const { audit, ACTIONS } = require('../lib/audit');
const { normalizePhone } = require('../lib/phone');
const { parseCsv } = require('../lib/csv');
const { computeResults } = require('../lib/scoring');
const {
  computePhase1Tally,
  computePhase2Tally,
  presentPhaseResults,
  cutProblems,
  applyCut,
} = require('../lib/tally');
const { validate } = require('../middleware/validate');
const { requireRole } = require('../middleware/role');
const { clientIp } = require('../middleware/audit');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requireRole('ADMIN'));

/**
 * Preview of the next phase transition.
 *
 * This mirrors the guards in POST /phase rather than re-implementing them: it
 * runs the same `computePhase1Tally` / `computePhase2Tally` and the same
 * `cutProblems`. If the rules change, this follows automatically — a preview
 * that could disagree with the real move would be worse than none.
 */
async function buildReadiness(phase, categories) {
  const next = PHASES[PHASES.indexOf(phase) + 1] || null;
  if (!next) return { next: null, canAdvance: true, steps: [], blockedCategories: [] };

  const steps = [];
  const blocked = [];

  if (phase === 'PHASE_1' && next === 'PHASE_2') {
    const confirmed = await prisma.candidate.count({ where: { inPhase2: true } });
    if (confirmed === 0) {
      steps.push({ ok: false, label: 'Confirm the Phase 1 cut (top 5 per category, top 15 overall)' });
    } else {
      steps.push({ ok: true, label: `Phase 1 cut confirmed for ${confirmed} candidate(s)` });
      const problems = cutProblems(await computePhase1Tally(), { includeTies: false });
      for (const problem of problems) {
        steps.push({ ok: false, label: problem });
        blocked.push(problem);
      }
      if (problems.length === 0) steps.push({ ok: true, label: 'Every category keeps its minimum candidates' });
    }
  }

  if (phase === 'PHASE_2' && next === 'PHASE_3') {
    const confirmed = await prisma.candidate.count({ where: { inPhase3: true } });
    if (confirmed === 0) {
      steps.push({ ok: false, label: 'Confirm the Phase 2 cut (top 6\u201310 overall)' });
    } else {
      steps.push({ ok: true, label: `Phase 2 cut confirmed for ${confirmed} candidate(s)` });
      const problems = cutProblems(await computePhase2Tally(), { includeTies: false });
      for (const problem of problems) {
        steps.push({ ok: false, label: problem });
        blocked.push(problem);
      }
      if (problems.length === 0) steps.push({ ok: true, label: 'Every category still has at least 2 candidates' });
    }
  }

  if (phase === 'PHASE_3' && next === 'CLOSED') {
    const votes = await prisma.vote.count();
    steps.push({
      ok: true,
      label: `Closing saves the final points from ${votes} vote(s). Each phase's results can be published after it closes.`,
    });
  }

  if (steps.length === 0) {
    steps.push({ ok: true, label: 'No checks are required for this move.' });
  }

  return {
    next,
    canAdvance: steps.every((step) => step.ok),
    steps,
    blockedCategories: blocked,
    categories: categories.length,
  };
}
// ---------------------------------------------------------------- dashboard

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const [employees, categories, candidateGroups, phase2Groups, phase3Groups, receipts, employeesMissingDepartment] =
      await Promise.all([
        prisma.employee.count({ where: { active: true } }),
        prisma.category.findMany({ orderBy: { sortOrder: 'asc' } }),
        prisma.candidate.groupBy({ by: ['categoryId'], _count: { _all: true } }),
        prisma.candidate.groupBy({ by: ['categoryId'], where: { inPhase2: true }, _count: { _all: true } }),
        prisma.candidate.groupBy({ by: ['categoryId'], where: { inPhase3: true }, _count: { _all: true } }),
        prisma.voteReceipt.groupBy({ by: ['categoryId'], _count: { _all: true } }),
        prisma.employee.count({ where: { departmentId: null, active: true } }),
      ]);

    const candidateCounts = new Map(candidateGroups.map((g) => [g.categoryId, g._count._all]));
    const phase2Counts = new Map(phase2Groups.map((g) => [g.categoryId, g._count._all]));
    const phase3Counts = new Map(phase3Groups.map((g) => [g.categoryId, g._count._all]));
    const voters = new Map(receipts.map((g) => [g.categoryId, g._count._all]));
    const readiness = await buildReadiness(req.phase, categories);

    res.json({
      phase: req.phase,
      phaseMeta: PHASE_META[req.phase],
      resultsPublic: req.settings?.resultsPublic ?? false,
      activeEmployees: employees,
      employeesMissingDepartment,
      rules: config.rules,
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        candidates: candidateCounts.get(category.id) || 0,
        inPhase2: phase2Counts.get(category.id) || 0,
        inPhase3: phase3Counts.get(category.id) || 0,
        voters: voters.get(category.id) || 0,
      })),
      nextPhase: PHASES[PHASES.indexOf(req.phase) + 1] || null,
      // What the NEXT transition will do, computed with the same helpers the
      // transition endpoint uses. The admin screen shows this before the
      // button is pressed, so an organiser can see that a cut is unconfirmed
      // or a category is short of candidates, and fix it first.
      readiness,
    });
  })
);

// ---------------------------------------------------------------- employees

const employeeInclude = { department: { select: { id: true, name: true } } };

function presentEmployee(employee) {
  return {
    id: employee.id,
    fullName: employee.fullName,
    phone: employee.phone,
    role: employee.role,
    eligible: employee.eligible,
    active: employee.active,
    department: employee.department?.name ?? null,
    departmentId: employee.departmentId,
  };
}

// GET /api/admin/employees — list (admin may see phone numbers; employees never do)
router.get(
  '/employees',
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || '').trim();
    const employees = await prisma.employee.findMany({
      where: search
        ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
          ],
        }
        : undefined,
      orderBy: { fullName: 'asc' },
      include: employeeInclude,
    });
    res.json({ employees: employees.map(presentEmployee) });
  })
);

const importSchema = z.object({
  csv: z.string().min(1, 'Paste a CSV or upload a file.').max(1_000_000),
  dryRun: z.boolean().optional().default(false),
});

// POST /api/admin/employees/import — body { csv, dryRun } with columns fullName,phone,department,role
router.post(
  '/employees/import',
  validate(importSchema),
  asyncHandler(async (req, res) => {
    const rows = parseCsv(req.validated.csv);
    if (rows.length === 0) throw errors.validation('The CSV has no data rows.');
    if (rows.length > 500) throw errors.validation('Import at most 500 rows at a time.');

    // Values: existing slug -> id (string), or { name } for departments created by this import.
    const departments = new Map(
      (await prisma.department.findMany()).map((department) => [department.name.toLowerCase(), department.id])
    );

    const report = { created: 0, updated: 0, skipped: [], departmentsCreated: [] };
    const pending = [];

    for (const [index, row] of rows.entries()) {
      const line = index + 2; // header is line 1
      const fullName = (row.fullName || '').trim();
      const phone = normalizePhone(row.phone);
      const roleValue = (row.role || 'EMPLOYEE').trim().toUpperCase();
      const departmentName = (row.department || '').trim();

      if (!fullName) {
        report.skipped.push({ line, reason: 'Missing full name' });
        continue;
      }
      if (!phone) {
        report.skipped.push({ line, reason: `Invalid phone: ${row.phone || '(empty)'}` });
        continue;
      }
      if (!Object.values(Role).includes(roleValue)) {
        report.skipped.push({ line, reason: `Unknown role: ${row.role}` });
        continue;
      }

      const departmentKey = departmentName ? departmentName.toLowerCase() : null;
      if (departmentKey && !departments.has(departmentKey)) {
        departments.set(departmentKey, { name: departmentName });
        report.departmentsCreated.push(departmentName);
      }

      pending.push({ fullName, phone, role: roleValue, departmentKey });
    }

    if (req.validated.dryRun) {
      return res.json({ dryRun: true, ...report, valid: pending.length });
    }

    await prisma.$transaction(async (tx) => {
      // Create any missing departments first, then resolve ids.
      for (const name of report.departmentsCreated) {
        const department = await tx.department.upsert({
          where: { name },
          update: {},
          create: { name },
        });
        departments.set(name.toLowerCase(), department.id);
      }

      for (const person of pending) {
        const mapped = person.departmentKey ? departments.get(person.departmentKey) : null;
        const departmentId = typeof mapped === 'string' ? mapped : null;

        const existing = await tx.employee.findUnique({ where: { phone: person.phone } });
        if (existing) {
          await tx.employee.update({
            where: { id: existing.id },
            data: { fullName: person.fullName, role: person.role, departmentId },
          });
          report.updated += 1;
        } else {
          await tx.employee.create({
            data: {
              fullName: person.fullName,
              phone: person.phone,
              role: person.role,
              departmentId,
            },
          });
          report.created += 1;
        }
      }
    });

    await audit({
      actorId: req.user.id,
      action: ACTIONS.EMPLOYEE_IMPORTED,
      details: { created: report.created, updated: report.updated, skipped: report.skipped.length },
      ip: clientIp(req),
    });

    res.json(report);
  })
);

const patchEmployeeSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  role: z.nativeEnum(Role).optional(),
  eligible: z.boolean().optional(),
  active: z.boolean().optional(),
  departmentId: z.string().nullable().optional(),
});

// PATCH /api/admin/employees/:id
router.patch(
  '/employees/:id',
  validate(patchEmployeeSchema),
  asyncHandler(async (req, res) => {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) throw errors.notFound('Employee not found.');

    const updated = await prisma.employee.update({
      where: { id: employee.id },
      data: req.validated,
      include: employeeInclude,
    });

    await audit({
      actorId: req.user.id,
      action: ACTIONS.EMPLOYEE_UPDATED,
      details: { employeeId: employee.id, changes: req.validated },
      ip: clientIp(req),
    });

    res.json({ employee: presentEmployee(updated) });
  })
);

// ---------------------------------------------------------------- departments

router.get(
  '/departments',
  asyncHandler(async (_req, res) => {
    const departments = await prisma.department.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: true } } },
    });
    res.json({
      departments: departments.map((department) => ({
        id: department.id,
        name: department.name,
        employees: department._count.employees,
      })),
    });
  })
);

router.post(
  '/departments',
  validate(z.object({ name: z.string().trim().min(2).max(80) })),
  asyncHandler(async (req, res) => {
    try {
      const department = await prisma.department.create({ data: { name: req.validated.name } });
      await audit({
        actorId: req.user.id,
        action: ACTIONS.DEPARTMENT_CREATED,
        details: { departmentId: department.id, name: department.name },
        ip: clientIp(req),
      });
      res.status(201).json({ department });
    } catch (error) {
      if (error.code === 'P2002') throw errors.conflict('A department with that name already exists.');
      throw error;
    }
  })
);

// ---------------------------------------------------------------- tally & cuts

// GET /api/admin/tally — per-category ranking, the pooled people ranking and tie flags
// for the phase that is being closed. Tallies are admin-only and only after the phase closes.
router.get(
  '/tally',
  asyncHandler(async (req, res) => {
    const phase = req.phase;
    if (phase === 'PHASE_1') {
      const tally = await computePhase1Tally();
      return res.json({ phase, tally, problems: cutProblems(tally) });
    }
    if (phase === 'PHASE_2') {
      const tally = await computePhase2Tally();
      return res.json({ phase, tally, problems: cutProblems(tally) });
    }
    return res.json({
      phase,
      tally: null,
      problems: [],
      message: 'Tallies are available while Phase 1 or Phase 2 is open.',
    });
  })
);

const confirmSchema = z.object({
  ids: z.array(z.string().min(1)).optional(),
  resolveTies: z.boolean().optional().default(false),
});

// POST /api/admin/candidates/confirm — confirms the top 5 per category and pooled
// limit, adding category finalists as needed to preserve minimum coverage.
router.post(
  '/candidates/confirm',
  validate(confirmSchema),
  asyncHandler(async (req, res) => {
    const phase = req.phase;
    if (!['PHASE_1', 'PHASE_2'].includes(phase)) {
      throw errors.phaseClosed('A cut can only be confirmed while Phase 1 or Phase 2 is open.');
    }

    const tally = phase === 'PHASE_1' ? await computePhase1Tally() : await computePhase2Tally();
    const problems = cutProblems(tally);

    // A tie across the cut line blocks the cut until the admin explicitly resolves it.
    if (problems.length > 0 && !req.validated.resolveTies) {
      throw errors.tieUnresolved(problems.join(' '));
    }

    await prisma.$transaction(async (tx) => {
      await applyCut(tx, tally);
    });

    await audit({
      actorId: req.user.id,
      action: ACTIONS.CUT_CONFIRMED,
      details: {
        phase,
        people: tally.people.filter((person) => person.advances).length,
        teams: (tally.teams || []).filter((team) => team.advances).length,
        resolvedTies: problems.length > 0,
      },
      ip: clientIp(req),
    });

    res.json({
      ok: true,
      phase,
      people: tally.people.filter((person) => person.advances).map((person) => person.id),
      teams: (tally.teams || []).filter((team) => team.advances).map((team) => team.departmentId),
      resolvedTies: problems,
    });
  })
);

// POST /api/admin/candidates/:id/remove — the admin can remove an ineligible candidate
// before the cut (§5, Phase 2).
router.post(
  '/candidates/:id/remove',
  asyncHandler(async (req, res) => {
    if (!['PHASE_1', 'PHASE_2'].includes(req.phase)) {
      throw errors.phaseClosed('Candidates can only be removed before the final vote opens.');
    }
    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!candidate) throw errors.notFound('Candidate not found.');

    await prisma.candidate.delete({ where: { id: candidate.id } });

    await audit({
      actorId: req.user.id,
      action: ACTIONS.CANDIDATE_REMOVED,
      details: { candidateId: candidate.id, categoryId: candidate.categoryId },
      ip: clientIp(req),
    });

    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- phases

const phaseSchema = z.object({
  phase: z.enum(PHASES),
  confirm: z.boolean().optional().default(false),
});

// POST /api/admin/phase — forward only, with the cut gates (§11)
router.post(
  '/phase',
  validate(phaseSchema),
  asyncHandler(async (req, res) => {
    const { phase: next, confirm } = req.validated;
    const current = req.phase;

    const move = canMoveTo(current, next);
    if (!move.ok) throw errors.phaseClosed(move.reason);
    if (!confirm) throw errors.validation('Confirm the phase change to continue.');

    // Phase 1 → 2: the top 15 must be confirmed, no tie unresolved, every category keeps
    // at least MIN_CANDIDATES_PER_CATEGORY candidates.
    if (current === 'PHASE_1' && next === 'PHASE_2') {
      const confirmed = await prisma.candidate.count({ where: { inPhase2: true } });
      if (confirmed === 0) {
        throw errors.cutNotConfirmed('Confirm the Phase 1 cut (top 5 per category, top 15 overall) first.');
      }
      // Ties were resolved when the admin confirmed the cut, so only the hard checks remain.
      const tally = await computePhase1Tally();
      const problems = cutProblems(tally, { includeTies: false });
      if (problems.length > 0) throw errors.conflict(problems.join(' '));
    }

    // Phase 2 → 3: 6–10 people shortlisted overall, no tie unresolved, every category
    // still has at least 2 candidates.
    if (current === 'PHASE_2' && next === 'PHASE_3') {
      const confirmed = await prisma.candidate.count({ where: { inPhase3: true } });
      if (confirmed === 0) {
        throw errors.cutNotConfirmed('Confirm the Phase 2 cut (top 6–10 overall) first.');
      }
      const tally = await computePhase2Tally();
      const problems = cutProblems(tally, { includeTies: false });
      if (problems.length > 0) throw errors.conflict(problems.join(' '));
    }

    // Closing the final vote: save the Phase 3 points on each candidate row.
    if (current === 'PHASE_3' && next === 'CLOSED') {
      const voteGroups = await prisma.vote.groupBy({
        by: ['candidateId'],
        _count: { _all: true },
      });
      await prisma.$transaction(
        voteGroups.map((group) =>
          prisma.candidate.update({
            where: { id: group.candidateId },
            data: { finalPoints: group._count._all },
          })
        )
      );
    }

    await prisma.settings.update({ where: { id: 1 }, data: { phase: next } });

    await audit({
      actorId: req.user.id,
      action: ACTIONS.PHASE_CHANGE,
      details: { from: current, to: next },
      ip: clientIp(req),
    });

    res.json({ phase: next, phaseMeta: PHASE_META[next] });
  })
);

// ---------------------------------------------------------------- audit log

router.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 50));
    const action = req.query.action ? String(req.query.action) : undefined;

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: action ? { action } : undefined,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where: action ? { action } : undefined }),
    ]);

    const actors = await prisma.employee.findMany({
      where: { id: { in: entries.map((entry) => entry.actorId).filter(Boolean) } },
      select: { id: true, fullName: true },
    });
    const actorNames = new Map(actors.map((actor) => [actor.id, actor.fullName]));

    res.json({
      page,
      pageSize,
      total,
      entries: entries.map((entry) => ({
        ...entry,
        actorName: entry.actorId ? actorNames.get(entry.actorId) ?? 'Deleted user' : 'System',
      })),
    });
  })
);

// ---------------------------------------------------------------- results

// GET /api/admin/results — phase tallies and final totals for the admin
router.get(
  '/results',
  asyncHandler(async (req, res) => {
    const [phase1, phase2, results] = await Promise.all([
      computePhase1Tally(),
      computePhase2Tally(),
      computeResults(),
    ]);
    res.json({
      phase: req.phase,
      published: req.settings?.resultsPublic ?? false,
      publications: {
        phase1: req.settings?.phase1ResultsPublic ?? false,
        phase2: req.settings?.phase2ResultsPublic ?? false,
        phase3: req.settings?.resultsPublic ?? false,
      },
      phaseResults: {
        phase1: presentPhaseResults(phase1, 'PHASE_1'),
        phase2: presentPhaseResults(phase2, 'PHASE_2'),
      },
      results,
      rules: config.rules,
    });
  })
);

// POST /api/admin/reset-cycle — reset election progress from any phase.
// Employee accounts, roles, departments, categories and the audit log are retained.
router.post(
  '/reset-cycle',
  validate(z.object({ confirm: z.literal('RESET') })),
  asyncHandler(async (req, res) => {
    const deleted = await prisma.$transaction(async (tx) => {
      const votes = await tx.vote.deleteMany();
      const committeeVotes = await tx.committeeVote.deleteMany();
      const nominations = await tx.nomination.deleteMany();
      const voteReceipts = await tx.voteReceipt.deleteMany();
      const conflicts = await tx.conflict.deleteMany();
      const candidates = await tx.candidate.deleteMany();
      await tx.settings.update({
        where: { id: 1 },
        data: {
          phase: Phase.NOT_STARTED,
          phase1ResultsPublic: false,
          phase2ResultsPublic: false,
          resultsPublic: false,
        },
      });
      return {
        votes: votes.count,
        committeeVotes: committeeVotes.count,
        nominations: nominations.count,
        voteReceipts: voteReceipts.count,
        conflicts: conflicts.count,
        candidates: candidates.count,
      };
    });

    await audit({
      actorId: req.user.id,
      action: ACTIONS.CYCLE_RESET,
      details: { deleted },
      ip: clientIp(req),
    });

    res.json({ ok: true, phase: Phase.NOT_STARTED, deleted });
  })
);
const publishSchema = z.object({
  stage: z.enum(['PHASE_1', 'PHASE_2', 'PHASE_3']).optional().default('PHASE_3'),
  acknowledgeTies: z.boolean().optional().default(false),
  decidedCategoryIds: z.array(z.string().min(1)).optional().default([]),
});

// POST /api/admin/publish — releases a closed phase's results to everyone
router.post(
  '/publish',
  validate(publishSchema),
  asyncHandler(async (req, res) => {
    const { stage, acknowledgeTies, decidedCategoryIds } = req.validated;
    const phaseIndex = PHASES.indexOf(req.phase);
    const publication = {
      PHASE_1: {
        available: phaseIndex >= PHASES.indexOf('PHASE_2'),
        field: 'phase1ResultsPublic',
        confirmed: () => prisma.candidate.count({ where: { inPhase2: true } }),
        message: 'Close Phase 1 by advancing to Phase 2 before publishing its results.',
      },
      PHASE_2: {
        available: phaseIndex >= PHASES.indexOf('PHASE_3'),
        field: 'phase2ResultsPublic',
        confirmed: () => prisma.candidate.count({ where: { inPhase3: true } }),
        message: 'Close Phase 2 by advancing to Phase 3 before publishing its results.',
      },
      PHASE_3: {
        available: ['CLOSED', 'PUBLISHED'].includes(req.phase),
        field: 'resultsPublic',
        message: 'Close Phase 3 voting before publishing its results.',
      },
    }[stage];

    if (!publication.available) {
      throw errors.phaseClosed(publication.message);
    }

    if (publication.confirmed && (await publication.confirmed()) === 0) {
      throw errors.cutNotConfirmed(`Confirm the ${stage.replace('_', ' ')} cut before publishing results.`);
    }

    if (stage === 'PHASE_3') {
      // Only a category whose top two have equal points in every phase needs a decision.
      const results = await computeResults();
      const ties = results.filter(
        (category) =>
          category.tiebreakRequired && !decidedCategoryIds.includes(category.categoryId)
      );
      if (ties.length > 0 && !acknowledgeTies) {
        throw errors.conflict(
          `Manual decision needed: ${ties
            .map((category) => category.categoryName)
            .join(', ')} ended in a tie that the earlier phases could not break. Re-submit with { "acknowledgeTies": true } to publish anyway.`
        );
      }
    }

    await prisma.settings.update({
      where: { id: 1 },
      data: {
        [publication.field]: true,
        ...(stage === 'PHASE_3' ? { phase: Phase.PUBLISHED } : {}),
      },
    });

    await audit({
      actorId: req.user.id,
      action: ACTIONS.RESULTS_PUBLISHED,
      details: { stage, from: req.phase },
      ip: clientIp(req),
    });

    res.json({
      ok: true,
      stage,
      phase: stage === 'PHASE_3' ? Phase.PUBLISHED : req.phase,
      publications: {
        phase1: stage === 'PHASE_1' || (req.settings?.phase1ResultsPublic ?? false),
        phase2: stage === 'PHASE_2' || (req.settings?.phase2ResultsPublic ?? false),
        phase3: stage === 'PHASE_3' || (req.settings?.resultsPublic ?? false),
      },
    });
  })
);

module.exports = { router };
