// Thin fetch wrapper. The session lives in an httpOnly cookie, so every call must use
// credentials: 'include'.

// Always call the app's own origin: /api/* is proxied to the Express API by
// app/api/[...path]/route.js, which keeps the session cookie first-party.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export class ApiError extends Error {
  constructor(message, code, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = payload?.error || {};
    throw new ApiError(
      error.message || 'Request failed. Please try again.',
      error.code || 'ERROR',
      response.status,
      error.details
    );
  }

  return payload;
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body });
export const put = (path, body) => api(path, { method: 'PUT', body });
export const patch = (path, body) => api(path, { method: 'PATCH', body });

/** Login uses a registered number and collects a department only if the roster has none. */
export function login(phone, departmentId) {
  return api('/auth/login', {
    method: 'POST',
    body: { phone, ...(departmentId ? { departmentId } : {}) },
  });
}

export function roleHome(role) {
  if (role === 'ADMIN') return '/admin';
  if (role === 'COMMITTEE') return '/committee';
  return '/employee';
}
