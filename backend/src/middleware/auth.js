const config = require('../config');
const prisma = require('../lib/prisma');
const { verifySession } = require('../lib/session');
const { errors } = require('../lib/errors');

/** Loads req.user from the session cookie. Never trusts the cookie alone — the DB is checked. */
async function loadUser(req, _res, next) {
  try {
    const token = req.cookies?.[config.cookieName];
    if (!token) return next();

    let payload;
    try {
      payload = verifySession(token);
    } catch {
      return next();
    }

    const employee = await prisma.employee.findUnique({
      where: { id: payload.sub },
      include: { department: { select: { id: true, name: true } } },
    });
    if (!employee || !employee.active) return next();

    req.user = employee;
    req.session = payload;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(errors.unauthenticated());
  return next();
}

module.exports = { loadUser, requireAuth };
