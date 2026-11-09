const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config');
const { ApiError } = require('./lib/errors');
const { getSettings } = require('./lib/settings');
const { loadUser } = require('./middleware/auth');
const { attachPhase } = require('./middleware/phase');
const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employee');
const committeeRoutes = require('./routes/committee');
const adminRoutes = require('./routes/admin');

function createApp() {
  const app = express();

  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  // §13 — helmet, CORS restricted to the web app origin, with credentials.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin / server-to-server requests have no Origin header.
        if (!origin || config.frontendUrls.includes(origin)) return callback(null, true);
        return callback(new ApiError(403, 'FORBIDDEN', 'Origin not allowed'));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '2mb' })); // CSV import posts JSON, not multipart
  app.use(cookieParser());
  if (config.env !== 'test') {
    app.use(morgan(config.isProduction ? 'combined' : 'dev'));
  }

  // Health checks: /health is liveness (process up), /health/ready also checks the database.
  // Both are used by Docker healthchecks and the deploy runbook (docs/deploy.md).
  app.get('/api/health', (_req, res) => res.json({ ok: true, env: config.env }));
  app.get('/api/health/ready', async (_req, res) => {
    try {
      const settings = await getSettings();
      res.json({ ok: true, db: 'up', phase: settings.phase });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  // Everything below needs the current phase and (optionally) a session.
  app.use('/api', attachPhase, loadUser);

  app.use('/api/auth', authRoutes.router);
  app.use('/api', employeeRoutes.router);
  app.use('/api/committee', committeeRoutes.router);
  app.use('/api/admin', adminRoutes.router);

  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown route.' } }));

  // Central error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, _next) => {
    if (error instanceof ApiError) {
      return res.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    if (error.code === 'P2025') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    }
    console.error('[api] unhandled error', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
    });
  });

  return app;
}

module.exports = { createApp };
