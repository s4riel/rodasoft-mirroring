# Rodasoft

**Rodalaser S.R.L.** platform: multi-company ERP (2 companies, multi-branch), **SIAT** electronic invoicing, online store and website.

| Layer | Technology |
|---|---|
| ERP | Angular 20 (standalone, signals, zoneless) + NgRx SignalStore |
| Website and store | Angular 20 SSR (a single app for both brands) |
| API | NestJS 11 (modular monolith) + Prisma 6 + PostgreSQL 16 |
| Background jobs | NestJS worker + BullMQ + Redis 7 (SIAT, emails, journal entries) |
| Monorepo | Nx 21 + pnpm |
| Production | Docker Compose on a VPS + Caddy (automatic TLS) |

Full plan: [`docs/implementation-plan.md`](docs/implementation-plan.md). Code naming rules (everything in English): [`docs/naming-conventions.md`](docs/naming-conventions.md). UI library and Figma: [`docs/ui-library.md`](docs/ui-library.md).

---

## 1. Requirements

- **Node.js 22.12+** (`nvm use` reads `.nvmrc`) and **pnpm 10** (`corepack enable`).
- **Docker Desktop** (PostgreSQL, Redis and Mailpit locally).
- On Windows: use Git Bash or PowerShell; cloning into a short path is recommended (e.g. `D:\Rodalaser\coding\rodasoft`).

## 2. Getting started

```bash
corepack enable
pnpm install                       # installs and generates the Prisma client
cp .env.example .env               # fill in JWT_ACCESS_SECRET and SECRETS_KEY (see comments)
pnpm dev:infra                     # PostgreSQL :5432, Redis :6379, Mailpit :8025
pnpm db:migrate --name init        # creates the first migration (commit it)
pnpm db:seed                       # 2 companies, 3 branches, roles and admin
pnpm dev                           # api + worker + erp in parallel
pnpm dev:web                       # website (separate)
```

After the first `pnpm install`, **commit `pnpm-lock.yaml`** (CI installs with `--frozen-lockfile`).

### Development URLs

| What | URL |
|---|---|
| ERP · Rodalaser | http://rodalaser.localhost:4200 |
| ERP · Company 2 / `company2` (green brand) | http://company2.localhost:4200 |
| Website | http://rodalaser.localhost:4300 · http://company2.localhost:4300 |
| API | http://localhost:3000/api/v1 |
| API documentation (Swagger) | http://localhost:3000/api/docs |
| Test emails (Mailpit) | http://localhost:8025 |

Initial user: `admin@rodalaser.local` / `Rodalaser.2026` (change with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`).

> `*.localhost` resolves to 127.0.0.1 in Chrome, Edge and Firefox without touching the `hosts` file.

## 3. Structure

```
apps/
  api/        NestJS: auth, companies, permissions, context, health (+ modules per sprint)
    prisma/   schema.prisma, migrations and seed
  worker/     NestJS without HTTP: outbox → BullMQ → email / SIAT / accounting
  erp/        Angular: login (email and Google), shell, home and module placeholders
  web/        Angular SSR: website + store, brand depending on the domain
libs/
  domain/     Shared pure TS: Decimal (money), permissions, state machines, NIT, contracts
  siat/       SIAT integration: CUF + modulo 11, XMLDSig signing, packages, SOAP codes client
  ui/         Design System in Angular (Figma tokens + components)
  api-client/ Types generated from OpenAPI (pnpm api:client)
tools/
  siat-spike/ Test against the SIN pilot environment (S0)
infra/        Docker, Caddy, production compose, backups
```

### Dependency rules (enforced by ESLint)

| Tag | May use |
|---|---|
| `scope:shared` (domain) | only `scope:shared` |
| `scope:backend` (api, worker, siat) | `scope:backend` + `scope:shared` |
| `scope:frontend` (erp, web, ui, api-client) | `scope:frontend` + `scope:shared` |

## 4. Key architecture decisions

- **Company by URL.** The subdomain (`rodalaser.erp.<domain>`) defines the company; there is no selector. The ERP also sends `X-Company`. The access token is bound to one company and `TenantGuard` rejects using it on the other URL.
- **Multi-tenant on a shared schema.** Every business table has `company_id`. Use **`prisma.tenant.<model>`** in modules: it filters and fills in `companyId` automatically. When creating a business model, add it to `TENANT_MODELS` (`apps/api/src/common/prisma/tenant.extension.ts`).
- **Session.** 15-minute JWT access token in memory + refresh in an httpOnly cookie with rotation and reuse detection. Google OAuth: the API validates and hands out a one-time code that the ERP redeems at `/auth/google/exchange`. Only **invited** emails get in (pending confirmation with the client).
- **Permissions.** Catalog in `libs/domain/src/lib/permissions.ts` (source of truth). Backend: `@RequirePermissions('sales.cancellations.approve')`. ERP: `*rsCan="'sales.cancellations.approve'"` (UX only).
- **Money.** Never `number`: `Decimal` from `@rodasoft/domain` (bigint, HALF_UP rounding) and `Decimal(14,2)` / `Decimal(14,4)` in the DB.
- **Transactional outbox.** Side effects (SIAT, emails, journal entries) are published with `OutboxService.publish(..., { tx })` inside the change's transaction; the worker delivers them to BullMQ with retries.
- **Errors.** Every error response is `{ status, code, message, details }` (`ApiProblem`) with `code` and `message` in English. The ERP translates `code` into Spanish messages (`apps/erp/src/app/core/api-error.ts`).
- **SIAT secrets** (token, .p12 and password) encrypted with AES-256-GCM (`SecretsService`), key in `SECRETS_KEY`.

### UI component catalog

With `pnpm dev`, open http://rodalaser.localhost:4200/design-system (development only): it shows every `libs/ui` component
with its variants and states, with a Light/Dark mode and Company 1/Company 2 switcher, to compare it against Figma.

## 5. Useful commands

| Command | What it does |
|---|---|
| `pnpm test` / `pnpm lint` / `pnpm typecheck` | Tests, lint and types for the whole monorepo |
| `pnpm affected` | Only what changed relative to `main` |
| `pnpm db:studio` | DB explorer |
| `pnpm api:client` | Exports OpenAPI and regenerates `libs/api-client` |
| `pnpm siat:spike [--sign]` | Tests CUIS, CUFD, CUF and signing against the SIAT pilot (see `tools/siat-spike/README.md`) |
| `pnpm nx graph` | Monorepo dependency graph |
| `pnpm nx migrate latest` | Update Nx/Angular/Nest to the latest compatible version |

### Local staging

An empty environment next to dev: database `rodasoft_staging` in the same Postgres, Redis DB 1, API on `:3001`, ERP on `:4201`. Two companies, each with its own administrator and no business data (no catalog, stock or documents).

1. Create `.env.staging` (not committed) from the "Local staging" block at the end of `.env.example`: uncomment the lines and set your own `JWT_ACCESS_SECRET` and admin passwords. It only holds the overrides on top of `.env`.
2. `pnpm staging:reset`: drops and recreates the database, applies the migrations and seeds it (`pnpm staging:db:seed` alone is idempotent).
3. `pnpm staging`: API, worker and ERP with `-c staging`. Nx loads `.env.staging` on top of `.env` for that configuration; the Prisma scripts go through `tools/staging/with-env.mjs` because the Prisma CLI only reads `.env`.

| Company | URL | Administrator |
|---|---|---|
| Rodalaser | http://rodalaser.localhost:4201 | `admin@rodalaser.local` |
| Rodamentin | http://rodamentin.localhost:4201 | `admin@rodamentin.local` |

Passwords are the ones in `.env.staging`. Each administrator only has access to its own company. Don't run `pnpm dev` and `pnpm staging` at the same time: both serve from the same `dist/` build.

## 6. Production

```bash
cp infra/env.prod.example infra/.env.prod      # fill in
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod build
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod run --rm migrate
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d
```

DNS: `api.`, `rodalaser.erp.`, `company2.erp.`, the root domain and `www.` pointing to the VPS. Daily backups in `infra/backups` + `infra/scripts/backup-offsite.sh`; test the restore every month with `infra/scripts/restore.sh`.

## 7. Week S0 checklist (19 Oct – 1 Nov)

- [x] Nx monorepo with api, worker, erp, web and libraries
- [x] Multi-company by URL, branches and warehouses, roles and permissions
- [x] Email login, refresh with rotation, password recovery, Google OAuth
- [x] ERP shell (Sidebar, ContextBar, PageHeader) with Design System tokens
- [x] SSR website with brand per domain
- [x] Outbox + worker + queues; CI and Docker deployment
- [ ] `pnpm install`, first migration and `pnpm-lock.yaml` committed
- [ ] Google OAuth credentials (Cloud Console) in `.env`
- [ ] **SIAT spike** on pilot: CUIS + CUFD + signing (needs the client's token, system code and .p12)
- [ ] Staging VPS with the production compose
- [ ] Validate the CUF against the SIN's official example (`libs/siat/src/lib/cuf.spec.ts`)

## 8. Pending items that depend on the client (Phase 0)

NIT and real data of both companies · name, branches and domain of the 2nd company · Google: Workspace only or also Gmail, and invited users only · digital signature and SIAT credentials · payment gateway · approval limits per role.
