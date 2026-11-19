// Helpers for driving the real voting API from the Playwright runner.
//
// Every test signs in with a registered phone number, exactly as the browser does: the
// httpOnly session cookie is captured per context and replayed on later requests. Nothing
// here reaches into Prisma for the rules under test; the database is used only to *read*
// the 58 seeded accounts and to check afterwards that nothing was skipped.
//
// APPKINGS_URL         where the app is (the Next.js proxy on :3000, or the API directly)
// APPKINGS_API_URL     optional API origin, if the browser port is not the API's port
// TEST_DATABASE_URL    the disposable database the API itself is connected to
//
// Sign-in overwrites every account's department and team, so the API and this client must
// point at the same database.

/**
 * @returns {string} the URL of the running app (web proxy or API directly)
 */
/**
 * The application origin. `APPKINGS_URL` first; otherwise the web port the stack publishes.
 * The e2e runner sets it explicitly — the production compose default is also :3000, so a
 * default here would silently point a run at a live deployment on this machine.
 */
export function appUrl() {
  const configured = process.env.APPKINGS_URL || process.env.APPKINGS_API_URL;
  if (!configured) {
    throw new Error('Set APPKINGS_URL (or use `npm run test:e2e`, which starts a stack).');
  }
  return configured.replace(/\/$/, '');
}

/** Fails the whole suite when the URL is not local, so a real election is never touched. */
export function assertLocalUrl(url) {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1'].includes(host)) {
    throw new Error(`The e2e voting suite only runs against a local URL (got ${url}).`);
  }
}

/**
 * Fails the whole suite unless TEST_DATABASE_URL is a local database that is obviously a
 * test database: its name carries `_test`/`_dev` (as `npm run test:e2e` creates), or it is
 * the development compose database on port 5442. The production database is neither.
 */
export function assertDisposableDatabase(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`TEST_DATABASE_URL is not a PostgreSQL URL: ${url}`);
  }
  if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error(`The e2e voting suite only runs against a local database (got ${parsed.host}).`);
  }
  const name = decodeURIComponent(parsed.pathname.slice(1));
  const isTestDatabase = /(?:^|[_-])(test|dev)(?:[_-]|$)/i.test(name);
  if (!isTestDatabase && parsed.port !== '5442') {
    throw new Error(
      `Refusing to run against database "${name}": this suite changes election data. ` +
        'Use a disposable database whose name contains test or dev (npm run test:e2e creates one), ' +
        'or the development compose database on port 5442.',
    );
  }
}

export function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

/** `fetch` with a timeout so a hung request fails fast instead of stalling the run. */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads the session cookie from Set-Cookie headers. It is the only cookie the app sets,
 * so the first one is the session.
 * @param {string[]} setCookies
 * @returns {string} the `name=value` pair, or '' when the response did not sign anyone in
 */
export function sessionCookieFrom(setCookies) {
  for (const header of setCookies) {
    const pair = header.split(';')[0].trim();
    if (pair.includes('=') && !pair.startsWith('Max-Age=0')) return pair;
  }
  return '';
}

/**
 * A person's private API session, signed in by phone number.
 * `request()` sends the session cookie and returns `{ status, body }`.
 */
export class Voter {
  /**
   * @param {{ phone: string, fullName?: string }} person
   * @param {string} apiOrigin  e.g. http://localhost:4000
   * @param {string} [label]
   */
  constructor(person, apiOrigin, label = '') {
    this.person = person;
    this.apiOrigin = apiOrigin;
    this.label = label || person.phone;
    this.cookie = '';
    this.user = null;
    this.signedIn = false;
  }

  /** Sends a request; `body` is JSON-encoded when present. */
  async request(method, path, body) {
    const headers = { 'content-type': 'application/json' };
    if (this.cookie) headers.cookie = this.cookie;
    const response = await fetchWithTimeout(`${this.apiOrigin}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const setCookies = response.headers.getSetCookie?.() ?? [];
    const cookie = sessionCookieFrom(setCookies);
    if (cookie) this.cookie = cookie;
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: response.status, ok: response.ok, body: parsed };
  }

  /**
   * Signs in. The roster has no departments yet, so the first request asks which
   * department to save and the second one signs in. Repeating the same department and
   * team is how the seeded account becomes votable without touching the database.
   */
  async signIn({ departmentId, teamId } = {}) {
    const phone = this.person.phone.replace(/^\+254/, '');
    let result = await this.request('POST', '/api/auth/login', { phone });
    if (result.status !== 200) {
      throw new Error(`sign-in failed for ${this.label}: ${result.status} ${JSON.stringify(result.body)}`);
    }
    if (result.body?.requiresDepartment) {
      const chosenDepartment = departmentId ?? result.body.departments?.[0]?.id;
      if (!chosenDepartment) {
        throw new Error(`no department is available for the first sign-in of ${this.label}`);
      }
      result = await this.request('POST', '/api/auth/login', {
        phone,
        departmentId: chosenDepartment,
        ...(teamId ? { teamId } : {}),
      });
      if (result.status !== 200) {
        throw new Error(
          `department sign-in failed for ${this.label}: ${result.status} ${JSON.stringify(result.body)}`,
        );
      }
    }
    this.user = result.body.user;
    this.signedIn = true;
    return this.user;
  }
}

/**
 * A short, readable description of a failed response, for assertion messages.
 * @param {{ status: number, body: unknown }} response
 */
export function failure(response) {
  const error = response?.body?.error;
  if (error) return `${response.status} ${error.code}: ${error.message}`;
  return `${response?.status} ${JSON.stringify(response?.body)?.slice(0, 160)}`;
}
