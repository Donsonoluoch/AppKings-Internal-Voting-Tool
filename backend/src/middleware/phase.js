const { PHASES } = require('@appkings/shared');
const { getSettings } = require('../lib/settings');
const { errors } = require('../lib/errors');

/** Attaches the current phase to every request (used by the UI's phase banner too). */
async function attachPhase(req, _res, next) {
  try {
    const settings = await getSettings();
    req.settings = settings;
    req.phase = settings.phase;
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * §11 — phase gating on the server, never just the UI.
 * Accepts one or more phases (whitelist). Anything else returns 409 PHASE_CLOSED.
 */
function requirePhase(...phases) {
  return (req, _res, next) => {
    if (phases.includes(req.phase)) return next();
    const current = req.phase || 'NOT_STARTED';
    return next(
      errors.phaseClosed(
        `This action is only available in ${phases.join(' or ')}. The current phase is ${current}.`
      )
    );
  };
}

module.exports = { attachPhase, requirePhase, PHASES };
