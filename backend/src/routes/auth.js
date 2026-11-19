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
const { PHASE_META, DEPARTMENTS } = require('@appkings/shared');

const router = express.Router();

// Two routes can protect the sign-in flow:
//   * department — by IP: that is a mistake, not an attack, and a whole office shares one IP;
//   * loginBurst — by PHONE: 20 attempts per number per 10 minutes. This is what actually
//     slows down someone guessing through the roster, while never locking out a colleague.
const phoneKey = (req) => normalizePhone(req.body?.phone) || req.ip;

/** §7 — phone numbers are public within the company, so a failed-attempt limiter is the
 *  only thing standing between a guesser and any account. Counts failed logins per number. */
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.env === 'test',
  skipSuccessfulRequests: true,
  keyGenerator: phoneKey,
  handler: (_req, res) =>
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many attempts for this number. Try again in a few minutes.' },
    }),
});

/** A soft per-IP guard: only someone typing garbage at scale reaches it. */
const loginBurst = rateLimit({
  windowMs: config.loginWindowMinutes * 60 * 1000,
  limit: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.env === 'test',
  skipSuccessfulRequests: true,
  handler: (_req, res) =>
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' },
    }),
});

const loginSchema = z.object({
  phone: z.string().min(9, 'Enter your phone number.'),
  departmentId: z.string().min(1).optional(),
});

const userInclude = {
  department: { select: { id: true, name: true } },
  team: { select: { id: true, name: true, code: true } },
};

const publicUser = (employee) => ({
  id: employee.id,
  fullName: employee.fullName,
  phone: employee.phone,
  role: employee.role,
  department: employee.department?.name ?? null,
  team: employee.team?.name ?? null,
  teamCode: employee.team?.code ?? null,
});

// POST /api/auth/login — staff sign in with their registered phone number.
router.post(
  '/login',
  loginBurst,
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

// §7 — the ONLY thing an employee chooses at sign-in is their department. A person's team is
// staff data an administrator sets, never something the employee is asked to know.
    const { departmentId } = req.validated;
    if (!employee.departmentId && !departmentId) {
      const departments = await prisma.department.findMany({ select: { id: true, name: true } });
      // Configured order (packages/shared/constants.js), not alphabetical: the list the
      // employee sees matches the list the system validates against.
      const departmentOrder = (name) => {
        const index = DEPARTMENTS.indexOf(name);
        return index === -1 ? DEPARTMENTS.length : index;
      };
      return res.json({
        requiresDepartment: true,
        departments: [...departments].sort((a, b) => departmentOrder(a.name) - departmentOrder(b.name)),
      });
    }

    const profile = {};

    // The department chosen at sign-in is a profile label (§8): it is set once for a brand-new
    // account, and a later sign-in never fails because of it. If someone picks a different one,
    // the choice is honoured (and audited) — guessing a phone number still only gets you into an
    // account you cannot use, and an admin can see the change in the audit log.
    if (departmentId) {
      const department = await prisma.department.findUnique({ where: { id: departmentId } });
      if (!department) throw errors.validation('Choose a valid department.');
      if (employee.departmentId !== departmentId) profile.departmentId = departmentId;
    }

    if (Object.keys(profile).length > 0) {
      // A brand-new account signing in before the cycle opens is doing its first sign-in; it
      // is labelled as onboarding so the audit trail separates it from a later department
      // change. Either way the row records exactly what changed.
      const firstSignIn = req.phase === 'NOT_STARTED' && !employee.departmentId;
      const previousDepartmentId = employee.departmentId ?? null;
      employee = await prisma.employee.update({
        where: { id: employee.id },
        data: profile,
        include: userInclude,
      });
      await audit({
        actorId: employee.id,
        action: firstSignIn ? ACTIONS.ONBOARDING_COMPLETED : ACTIONS.DEPARTMENT_ASSIGNED,
        details: { ...profile, previousDepartmentId },
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
