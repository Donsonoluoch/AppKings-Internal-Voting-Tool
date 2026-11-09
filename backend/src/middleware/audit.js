const { audit } = require('../lib/audit');

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;
}

/** Middleware form: record one action for the current actor. */
function auditAction(action, detailsFn) {
  return async (req, _res, next) => {
    await audit({
      actorId: req.user?.id ?? null,
      action,
      details: detailsFn ? detailsFn(req) : { method: req.method, path: req.path },
      ip: clientIp(req),
    });
    next();
  };
}

module.exports = { auditAction, clientIp };
