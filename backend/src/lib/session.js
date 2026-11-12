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
  cookieOptions,
};
