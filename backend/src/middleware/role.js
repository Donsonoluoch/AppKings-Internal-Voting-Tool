const { errors } = require('../lib/errors');

/**
 * Roles are additive (§3): ADMIN can use the committee portal, COMMITTEE can use the
 * employee portal. `requireRole('COMMITTEE')` therefore means "committee or above".
 */
const RANK = { EMPLOYEE: 1, COMMITTEE: 2, ADMIN: 3 };

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(errors.unauthenticated());
    const needed = Math.max(...roles.map((role) => RANK[role] ?? 99));
    if ((RANK[req.user.role] ?? 0) >= needed) return next();
    return next(errors.forbidden('This area is for the committee / administrators.'));
  };
}

module.exports = { requireRole, RANK };
