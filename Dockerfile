# AppKings 2026 Employee Awards — one image, both apps.
#
#   web + api together : docker build -t appkings-voting .   → served on APP_PORT (default 3000)
#   api only           : docker build --target backend ...   → served on PORT (default 4000), no Next.js
#
# The browser only ever talks to the web port: Next.js serves the pages and proxies /api/*
# to Express on 127.0.0.1:4000 inside the same container. The session cookie therefore
# stays first-party. `APP_ROLE` (set by the entrypoint) decides which processes supervisord
# starts, so one image can also run as just the API.
#
#   APP_ROLE=all     api + web (default)
#   APP_ROLE=web     web only — point API_INTERNAL_URL at a separate API container
#   APP_ROLE=api     api only

# ---------- deps: install every workspace once ----------
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund

# ---------- build: Prisma client + Next.js standalone ----------
FROM deps AS build
WORKDIR /app
COPY packages/shared packages/shared
COPY backend backend
COPY frontend frontend
# The browser calls its own origin (/api), so this default is correct behind the proxy.
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
# The generated client is copied into the runtime stage explicitly (the API runs from /app).
RUN cd backend && npx prisma generate
RUN cd frontend && npx next build

# ---------- api image (backend only) ----------
FROM node:22-alpine AS backend
WORKDIR /app
RUN apk add --no-cache openssl tini postgresql16 postgresql16-client su-exec
ENV NODE_ENV=production
ENV PORT=4000
ENV API_HOST=0.0.0.0

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/backend ./backend
COPY backend/docker-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN chmod +x /usr/local/bin/api-entrypoint.sh

WORKDIR /app/backend
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=10 \
  CMD wget -q --spider http://127.0.0.1:4000/api/health/ready >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/api-entrypoint.sh"]
CMD ["node", "src/index.js"]

# ---------- runtime: api + web in one container ----------
FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl tini supervisor wget && \
  rm -f /etc/supervisor/conf.d/*.conf 2>/dev/null || true

ENV NODE_ENV=production
ENV APP_ROLE=all
# Both processes read one PORT variable, so supervisord gives each program its own copy:
# the web app takes PORT, the API takes API_PORT, and the proxy target is a plain default
# that compose can override with a real environment variable.
ENV PORT=3000
ENV APP_PORT=3000
ENV API_PORT=4000
ENV API_INTERNAL_URL=http://127.0.0.1:4000/api
# supervisord reads %(ENV_API_HOST)s, so it must exist even in all-in-one mode (loopback).
ENV API_HOST=127.0.0.1
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# API process tree
# The root package.json marks /app as the workspace root so the standalone Next.js server
# and the API resolve node_modules relative to it.
COPY --from=build /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/backend ./backend

# Web process tree (standalone output already bundles its own node_modules).
# frontend/public is kept in the repo (with a .gitkeep) so this COPY always resolves.
COPY --from=build /app/frontend/.next/standalone ./web
COPY --from=build /app/frontend/.next/static ./web/frontend/.next/static
COPY --from=build /app/frontend/public ./web/frontend/public

COPY infra/supervisord.conf /etc/supervisor/conf.d/appkings.conf
COPY backend/docker-entrypoint.sh /usr/local/bin/app-entrypoint.sh
RUN chmod +x /usr/local/bin/app-entrypoint.sh

# Migrations and seeding run from the backend workspace (schema.prisma, prisma/seed.js).
WORKDIR /app/backend

# The API target above already publishes the API port; this target is the web-facing one.
# Without this line the tag-level EXPOSE 4000 leaks in and Docker publishes it in modes
# that should not expose the API (e.g. a web container with `network_mode: host`).
EXPOSE 3000

# Web is the public port; the API listens on 127.0.0.1:4000 (APP_ROLE=all) or another
# container (APP_ROLE=web) and is reached through the proxy. Use `wget --spider`: it waits
# for already-received headers, so an unreachable API fails the check fast instead of
# hanging until the timeout.
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=10 \
  CMD wget -q --spider http://127.0.0.1:${APP_PORT}/api/health/ready >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/app-entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/appkings.conf"]
