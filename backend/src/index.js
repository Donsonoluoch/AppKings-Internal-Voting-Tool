const config = require('./config');
const { createApp } = require('./app');
const prisma = require('./lib/prisma');

if (config.isProduction && (
  config.jwtSecret.length < 32 ||
  config.jwtSecret.startsWith('dev-only') ||
  config.jwtSecret.startsWith('change-me')
)) {
  throw new Error('Production requires a unique JWT_SECRET of at least 32 characters.');
}
if (config.isProduction && !config.cookieSecure) {
  throw new Error('Production requires COOKIE_SECURE=true and HTTPS.');
}

const app = createApp();

// API_HOST lets the API-only container bind 0.0.0.0; everywhere else the default keeps it
// on loopback, so only the Next.js proxy reaches it.
const host = process.env.API_HOST || undefined;

// 1. ONLY start the persistent server if we are NOT running on Vercel.
// Vercel automatically sets process.env.VERCEL="1" when deployed.
if (!process.env.VERCEL) {
  const server = app.listen(config.port, host, async () => {
    console.log(`[api] listening on http://${host || 'localhost'}:${config.port} (${config.env})`);
    console.log(`[api] web app origin: ${config.frontendUrls.join(', ')}`);
    if (config.jwtSecret.startsWith('dev-only') || config.jwtSecret.startsWith('change-me')) {
      console.warn('[api] WARNING: JWT_SECRET is still the default. Change it before deploying.');
    }
    // Fail loudly at boot rather than on the first login if the database is unreachable.
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log('[api] database connection OK');
    } catch (error) {
      console.error('[api] database connection FAILED:', error.message);
      console.error('[api] check DATABASE_URL in .env (host, user, password, database name).');
    }
  });
}

// 2. Export the app so Vercel can consume it as a Serverless Function
module.exports = app;

async function shutdown(signal) {
  console.log(`[api] ${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
