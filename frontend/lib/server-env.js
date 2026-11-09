// Server-side only: where the Next.js server proxies /api requests to.
// Keeping the browser on the same origin as the web app means the session cookie is
// first-party and SameSite=Lax keeps working behind a proxy or on a single domain.
export function apiTarget() {
  return (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(
    /\/$/,
    ''
  );
}
