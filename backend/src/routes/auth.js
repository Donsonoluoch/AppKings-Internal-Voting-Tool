const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const config = require('../config');
const prisma = require('../lib/prisma');
const { errors } = require('../lib/errors');
const { normalizePhone } = require('../lib/phone');
const {
  signSession,
  newDeviceToken,
  hashDeviceToken,
  safeEqual,
  cookieOptions,
} = require('../lib/session');
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
  // The device token is sent by the browser when it already has one (§7 rules 2–4).
  deviceToken: z.string().min(16).max(128).optional().nullable(),
});

const publicUser = (employee) => ({
  id: employee.id,
  fullName: employee.fullName,
  phone: employee.phone,
  role: employee.role,
  department: employee.department?.name ?? null,
  hasDevice: Boolean(employee.deviceHash),
});

// POST /api/auth/login — phone + device binding. No password: the device is the credential.
router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const phone = normalizePhone(req.validated.phone);
    const ip = clientIp(req);

    if (!phone) throw errors.validation('Enter a valid Kenyan number, e.g. 712 345 678.');

    const employee = await prisma.employee.findUnique({
      where: { phone },
      include: { department: { select: { id: true, name: true } } },
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

    let rawDeviceToken = null;

    if (!employee.deviceHash) {
      // First login: this browser becomes the registered device.
      rawDeviceToken = newDeviceToken();
      await prisma.employee.update({
        where: { id: employee.id },
        data: { deviceHash: hashDeviceToken(rawDeviceToken), deviceRegisteredAt: new Date() },
      });
    } else {
      const candidateHash = req.validated.deviceToken
        ? hashDeviceToken(req.validated.deviceToken)
        : null;
      if (!safeEqual(candidateHash, employee.deviceHash)) {
        if (employee.deviceRegisteredAt && !req.validated.deviceToken) {
          await audit({
            actorId: employee.id,
            action: ACTIONS.LOGIN_FAILED,
            details: { reason: 'NO_DEVICE_TOKEN' },
            ip,
          });
        } else {
          await audit({
            actorId: employee.id,
            action: ACTIONS.LOGIN_FAILED,
            details: { reason: 'DEVICE_MISMATCH' },
            ip,
          });
        }
        throw errors.deviceMismatch();
      }
    }

    const token = signSession(employee);
    res.cookie(config.cookieName, token, cookieOptions());

    await audit({ actorId: employee.id, action: ACTIONS.LOGIN, details: { phone }, ip });

    return res.json({
      user: publicUser(employee),
      // Returned once, on first registration only. The browser keeps it in localStorage.
      deviceToken: rawDeviceToken,
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
