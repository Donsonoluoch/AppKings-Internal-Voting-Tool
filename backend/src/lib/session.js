const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

function signSession(employee) {
  return jwt.sign(
    { sub: employee.id, role: employee.role, phone: employee.phone },
    config.jwtSecret,
    { expiresIn: `${config.sessionHours}h` }
  );
}

function verifySession(token) {
  return jwt.verify(token, config.jwtSecret);
}

/** §13 — device tokens are hashed (SHA-256) before storage; the raw token only lives on the device. */
function newDeviceToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashDeviceToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'lax', // Lax lets the browser send the cookie on top-level navigation from the web app
  maxAge: config.sessionHours * 60 * 60 * 1000,
  path: '/',
});

module.exports = {
  signSession,
  verifySession,
  newDeviceToken,
  hashDeviceToken,
  safeEqual,
  cookieOptions,
};
