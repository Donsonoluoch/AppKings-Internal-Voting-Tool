const { ERRORS } = require('@appkings/shared');

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const errors = {
  unauthenticated: (message = 'Please sign in.') =>
    new ApiError(401, ERRORS.UNAUTHENTICATED, message),
  forbidden: (message = 'You do not have access to this.') =>
    new ApiError(403, ERRORS.FORBIDDEN, message),
  deviceMismatch: () =>
    new ApiError(
      403,
      ERRORS.DEVICE_MISMATCH,
      'This number is registered to another device. Contact an administrator.'
    ),
  inactive: () => new ApiError(403, ERRORS.ACCOUNT_INACTIVE, 'This account is not active.'),
  phaseClosed: (message = 'This action is not available in the current phase.') =>
    new ApiError(409, ERRORS.PHASE_CLOSED, message),
  validation: (message = 'Invalid request.', details) =>
    new ApiError(400, ERRORS.VALIDATION, message, details),
  notFound: (message = 'Not found.') => new ApiError(404, ERRORS.NOT_FOUND, message),
  conflict: (message = 'Conflict.') => new ApiError(409, ERRORS.CONFLICT, message),
  tieUnresolved: (message = 'A tie across the cut line must be resolved by the admin first.') =>
    new ApiError(409, ERRORS.TIE_UNRESOLVED, message),
  cutNotConfirmed: (message = 'Confirm the cut before moving to the next phase.') =>
    new ApiError(409, ERRORS.CUT_NOT_CONFIRMED, message),
  internal: (message = 'Something went wrong.') =>
    new ApiError(500, ERRORS.INTERNAL, message),
};

module.exports = { ApiError, errors };
