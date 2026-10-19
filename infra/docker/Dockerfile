# syntax=docker/dockerfile:1.7
# Imagen multi-etapa para todo el monorepo. Targets: migrate, api, worker, web, gateway (Caddy + ERP estático).
#   docker build -f infra/docker/Dockerfile --target api -t rodasoft-api .

ARG NODE_VERSION=22.12.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NX_DAEMON=false
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# ── dependencias ──
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY apps/api/prisma ./apps/api/prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ── build de todo ──
FROM deps AS builder
COPY . .
RUN pnpm db:generate && pnpm nx run-many -t build -p api worker erp web --configuration=production

# ── migraciones (se corre una vez por despliegue) ──
FROM builder AS migrate
CMD ["pnpm", "db:deploy"]

# ── node_modules de producción ──
# Verificar en el primer build que el cliente generado de Prisma sobrevive al prune:
#   docker run --rm <imagen-api> node -e "require('@prisma/client')"
FROM builder AS prod-deps
RUN pnpm prune --prod --ignore-scripts

# ── API ──
FROM node:${NODE_VERSION}-bookworm-slim AS api
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=America/La_Paz
WORKDIR /app
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=builder /repo/dist/apps/api ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD curl -fsS http://localhost:3000/api/v1/health/live || exit 1
CMD ["node", "main.js"]

# ── Worker ──
FROM node:${NODE_VERSION}-bookworm-slim AS worker
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=America/La_Paz
WORKDIR /app
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=builder /repo/dist/apps/worker ./
USER node
CMD ["node", "main.js"]

# ── Sitio web + tienda (Angular SSR) ──
FROM node:${NODE_VERSION}-bookworm-slim AS web
ENV NODE_ENV=production PORT=4000 TZ=America/La_Paz
WORKDIR /app
COPY --from=builder /repo/dist/apps/web ./
USER node
EXPOSE 4000
CMD ["node", "server/server.mjs"]

# ── Gateway: Caddy con TLS automático + ERP estático ──
FROM caddy:2-alpine AS gateway
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /repo/dist/apps/erp/browser /srv/erp
