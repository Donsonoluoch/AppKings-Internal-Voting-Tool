const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const config = require('../config');
const prisma = require('../lib/prisma');
const { errors } = require('../lib/errors');
const { normalizePhone } = require('../lib/phone');
const { signSession, cookieOptions } = require('../lib/session');
const { audit, ACTIONS } = require('../lib/audit');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { clientIp } = require('../middleware/audit');
const asyncHandler = require('../middleware/asyncHandler');
const { PHASE_META } = require('@appkings/shared');

const router = express.Router();

/** §7 rule 8 — rate limit login attempts (default 10 per 15 min per IP). */
const loginLimiter = rateLimit({
  windowMs: config.loginWindowMinutes * 60 * 1000,
  limit: config.loginMaxPerWindow,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.env === 'test',
  // Count failed attempts only. 60 people behind one office IP would otherwise lock each
  // other out mid go-live; guessing wrong still counts (the handler below does the work).
  skipSuccessfulRequests: true,
  handler: (_req, res) =>
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' },
    }),
});

const loginSchema = z.object({
  phone: z.string().min(9, 'Enter your phone number.'),
  departmentId: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
});

const userInclude = {
  department: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
};

const publicUser = (employee) => ({
  id: employee.id,
  fullName: employee.fullName,
  phone: employee.phone,
  role: employee.role,
  department: employee.department?.name ?? null,
  team: employee.team?.name ?? null,
});

// POST /api/auth/login — staff sign in with their registered phone number.
router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const phone = normalizePhone(req.validated.phone);
    const ip = clientIp(req);

    if (!phone) throw errors.validation('Enter a valid Kenyan number, e.g. 712 345 678.');

    let employee = await prisma.employee.findUnique({
      where: { phone },
      include: userInclude,
    });

    if (!employee) {
      await audit({ action: ACTIONS.LOGIN_FAILED, details: { reason: 'UNKNOWN_NUMBER' }, ip });
      throw errors.forbidden('This number is not registered. Contact an administrator.');
    }
    if (!employee.active) {
      await audit({
        actorId: employee.id,
        action: ACTIONS.LOGIN_FAILED,
        details: { reason: 'INACTIVE' },
        ip,
      });
      throw errors.inactive();
    }

    const { departmentId, teamId } = req.validated;
    if ((!employee.departmentId && !departmentId) || (!employee.teamId && !teamId)) {
      const [departments, teams] = await Promise.all([
        prisma.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
        prisma.team.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      ]);
      return res.json({
        requiresDepartment: !employee.departmentId && !departmentId,
        departments,
        requiresTeam: !employee.teamId && !teamId,
        teams,
      });
    }

    const profile = {};

    if (departmentId) {
      const department = await prisma.department.findUnique({ where: { id: departmentId } });
      if (!department) throw errors.validation('Choose a valid department.');
      if (employee.departmentId && employee.departmentId !== departmentId) {
        throw errors.validation('Your department is already set. Contact an administrator to change it.');
      }
      if (!employee.departmentId) profile.departmentId = departmentId;
    }

    if (teamId) {
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) throw errors.validation('Choose a valid team.');
      if (employee.teamId && employee.teamId !== teamId) {
        throw errors.validation('Your team is already set. Contact an administrator to change it.');
      }
      if (!employee.teamId) profile.teamId = teamId;
    }

    if (Object.keys(profile).length > 0) {
      employee = await prisma.employee.update({
        where: { id: employee.id },
        data: profile,
        include: userInclude,
      });
      await audit({
        actorId: employee.id,
        action: ACTIONS.DEPARTMENT_ASSIGNED,
        details: profile,
        ip,
      });
    }

    const token = signSession(employee);
    res.cookie(config.cookieName, token, cookieOptions());

    await audit({ actorId: employee.id, action: ACTIONS.LOGIN, details: { phone }, ip });

    return res.json({
      user: publicUser(employee),
      phase: req.phase,
    });
  })
);

// POST /api/auth/logout
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    res.clearCookie(config.cookieName, { ...cookieOptions(), maxAge: undefined });
    if (req.user) {
      await audit({ actorId: req.user.id, action: ACTIONS.LOGOUT, ip: clientIp(req) });
    }
    res.json({ ok: true });
  })
);

// GET /api/auth/me — current user + phase + the rules the UI needs to render itself.
router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: publicUser(req.user),
    phase: req.phase,
    phaseMeta: PHASE_META[req.phase],
    resultsPublic: req.settings?.resultsPublic ?? false,
    rules: config.rules,
  });
});

module.exports = { router, publicUser };
