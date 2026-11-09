// Thin fetch wrapper. The session lives in an httpOnly cookie, so every call must use
// credentials: 'include'. The device token is the only thing kept in localStorage.

// Always call the app's own origin: /api/* is proxied to the Express API by
// app/api/[...path]/route.js, which keeps the session cookie first-party.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
export const DEVICE_TOKEN_KEY = 'appkings.deviceToken';

export class ApiError extends Error {
  constructor(message, code, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function readDeviceToken() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(DEVICE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveDeviceToken(token) {
  if (typeof window === 'undefined' || !token) return;
  try {
    window.localStorage.setItem(DEVICE_TOKEN_KEY, token);
  } catch {
    /* storage blocked — the browser will look like a new device */
  }
}

export function clearDeviceToken() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DEVICE_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export async function api(path, { method = 'GET', body, deviceToken } = {}) {
  const token = deviceToken !== undefined ? deviceToken : readDeviceToken();

  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Device-Token': token } : {}),
    },
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

/** Login is special: the device token also travels in the body, wrapped in the phone schema. */
export async function login(phone) {
  const deviceToken = readDeviceToken();
  const result = await api('/auth/login', {
    method: 'POST',
    body: { phone, deviceToken },
    deviceToken: null,
  });
  if (result.deviceToken) saveDeviceToken(result.deviceToken);
  return result;
}

export function roleHome(role) {
  if (role === 'ADMIN') return '/admin';
  if (role === 'COMMITTEE') return '/committee';
  return '/employee';
}
