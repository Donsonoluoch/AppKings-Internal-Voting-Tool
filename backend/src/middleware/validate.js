const { errors } = require('../lib/errors');

/** §13 — validate all input with zod. Returns the parsed value as req.validated. */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return next(errors.validation(details[0]?.message || 'Invalid request.', details));
    }
    req.validated = result.data;
    return next();
  };
}

module.exports = { validate };
