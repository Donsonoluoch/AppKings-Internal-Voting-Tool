import { apiTarget } from '@/lib/server-env';

/**
 * Same-origin proxy: the browser calls /api/*, this route forwards to Express with the
 * original cookie and streams the response (including Set-Cookie) back.
 *
 * Why: an httpOnly, SameSite=Lax session cookie is only reliably stored when the web app
 * and the API look like one origin. This keeps the deployment simple (one public port).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  // `expect: 100-continue` is a hop-by-hop header. Forwarding it makes Node's
  // fetch (undici) throw "expect header not supported", so EVERY POST through
  // this proxy failed with a 500 — login included. The body is already fully
  // buffered below, so the header has no meaning upstream anyway.
  'expect',
]);

async function proxy(request, { params }) {
  const { path } = await params;
  const search = new URL(request.url).search;
  const target = `${apiTarget()}/${(path || []).join('/')}${search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (key === 'host' || key === 'expect' || HOP_BY_HOP.has(key) || key === 'content-length') return;
    headers.set(key, value);
  });
  headers.set('x-forwarded-host', new URL(request.url).host);

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
    cache: 'no-store',
  });

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (key === 'content-encoding' || key === 'content-length' || HOP_BY_HOP.has(key)) return;
    if (key === 'set-cookie') return; // handled below, may be several values
    responseHeaders.set(key, value);
  });
  const cookies = upstream.headers.getSetCookie?.() || [];
  for (const cookie of cookies) responseHeaders.append('set-cookie', cookie);

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
