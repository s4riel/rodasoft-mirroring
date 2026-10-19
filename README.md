# Rodasoft

Plataforma de **Rodalaser S.R.L.**: ERP multiempresa (2 empresas, multisucursal), facturación electrónica **SIAT**, tienda en línea y sitio web.

| Capa | Tecnología |
|---|---|
| ERP | Angular 20 (standalone, signals, zoneless) + NgRx SignalStore |
| Sitio web y tienda | Angular 20 SSR (una sola app para las dos marcas) |
| API | NestJS 11 (monolito modular) + Prisma 6 + PostgreSQL 16 |
| Tareas en segundo plano | Worker NestJS + BullMQ + Redis 7 (SIAT, correos, asientos) |
| Monorepo | Nx 21 + pnpm |
| Producción | Docker Compose en un VPS + Caddy (TLS automático) |

Plan completo: documento `claude/plan-implementacion-codigo.md` del proyecto.

---

## 1. Requisitos

- **Node.js 22.12+** (`nvm use` lee `.nvmrc`) y **pnpm 10** (`corepack enable`).
- **Docker Desktop** (PostgreSQL, Redis y Mailpit en local).
- En Windows: usar Git Bash o PowerShell; recomendado clonar en una ruta corta (p. ej. `D:\Rodalaser\coding\rodasoft`).

## 2. Primeros pasos

```bash
corepack enable
pnpm install                       # instala y genera el cliente de Prisma
cp .env.example .env               # completar JWT_ACCESS_SECRET y SECRETS_KEY (ver comentarios)
pnpm dev:infra                     # PostgreSQL :5432, Redis :6379, Mailpit :8025
pnpm db:migrate --name init        # crea la primera migración (commitearla)
pnpm db:seed                       # 2 empresas, 3 sucursales, roles y admin
pnpm dev                           # api + worker + erp en paralelo
pnpm dev:web                       # sitio web (aparte)
```

Después de `pnpm install` por primera vez, **commitear `pnpm-lock.yaml`** (la CI instala con `--frozen-lockfile`).

### URLs en desarrollo

| Qué | URL |
|---|---|
| ERP · Rodalaser | http://rodalaser.localhost:4200 |
| ERP · Empresa 2 (marca verde) | http://empresa2.localhost:4200 |
| Sitio web | http://rodalaser.localhost:4300 · http://empresa2.localhost:4300 |
| API | http://localhost:3000/api/v1 |
| Documentación de la API (Swagger) | http://localhost:3000/api/docs |
| Correos de prueba (Mailpit) | http://localhost:8025 |

Usuario inicial: `admin@rodalaser.local` / `Rodalaser.2026` (cambiar con `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`).

> `*.localhost` resuelve a 127.0.0.1 en Chrome, Edge y Firefox sin tocar el archivo `hosts`.

## 3. Estructura

```
apps/
  api/        NestJS: auth, empresas, permisos, contexto, salud (+ módulos por sprint)
    prisma/   schema.prisma, migraciones y seed
  worker/     NestJS sin HTTP: outbox → BullMQ → correo / SIAT / contabilidad
  erp/        Angular: login (correo y Google), shell, inicio y marcadores de módulos
  web/        Angular SSR: sitio + tienda, marca según el dominio
libs/
  domain/     TS puro compartido: Decimal (dinero), permisos, máquinas de estado, NIT, contratos
  siat/       Integración SIAT: CUF + módulo 11, firma XMLDSig, paquetes, cliente SOAP de códigos
  ui/         Design System en Angular (tokens de Figma + componentes)
  api-client/ Tipos generados desde OpenAPI (pnpm api:client)
tools/
  siat-spike/ Prueba contra el ambiente piloto del SIN (S0)
infra/        Docker, Caddy, compose de producción, respaldos
```

### Reglas de dependencias (las hace cumplir ESLint)

| Etiqueta | Puede usar |
|---|---|
| `scope:shared` (domain) | solo `scope:shared` |
| `scope:backend` (api, worker, siat) | `scope:backend` + `scope:shared` |
| `scope:frontend` (erp, web, ui, api-client) | `scope:frontend` + `scope:shared` |

## 4. Decisiones de arquitectura clave

- **Empresa por URL.** El subdominio (`rodalaser.erp.<dominio>`) define la empresa; no hay selector. El ERP manda además `X-Empresa`. El token de acceso está atado a una empresa y `TenantGuard` rechaza usarlo en la otra URL.
- **Multi-tenant en esquema compartido.** Toda tabla de negocio tiene `empresa_id`. Usar **`prisma.tenant.<modelo>`** en los módulos: filtra y completa `empresaId` solo. Al crear un modelo de negocio, agregarlo a `TENANT_MODELS` (`apps/api/src/common/prisma/tenant.extension.ts`).
- **Sesión.** Token de acceso JWT de 15 min en memoria + refresh en cookie httpOnly con rotación y detección de reutilización. Google OAuth: la API valida y entrega un código de un solo uso que el ERP canjea en `/auth/google/exchange`. Solo entran correos **invitados** (pendiente de confirmar con el cliente).
- **Permisos.** Catálogo en `libs/domain/src/lib/permissions.ts` (fuente de verdad). Backend: `@RequirePermissions('ventas.anulaciones.aprobar')`. ERP: `*rsCan="'ventas.anulaciones.aprobar'"` (solo UX).
- **Dinero.** Nunca `number`: `Decimal` de `@rodasoft/domain` (bigint, redondeo HALF_UP) y `Decimal(14,2)` / `Decimal(14,4)` en BD.
- **Outbox transaccional.** Los efectos secundarios (SIAT, correos, asientos) se publican con `OutboxService.publish(..., { tx })` dentro de la transacción del cambio; el worker los entrega a BullMQ con reintentos.
- **Errores.** Toda respuesta de error es `{ status, code, message, details }` (`ApiProblem`). El ERP traduce `code` a mensajes (`apps/erp/src/app/core/api-error.ts`).
- **Secretos SIAT** (token, .p12 y contraseña) cifrados con AES-256-GCM (`SecretsService`), clave en `SECRETS_KEY`.

## 5. Comandos útiles

| Comando | Qué hace |
|---|---|
| `pnpm test` / `pnpm lint` / `pnpm typecheck` | Pruebas, lint y tipos de todo el monorepo |
| `pnpm affected` | Solo lo que cambió respecto a `main` |
| `pnpm db:studio` | Explorador de la BD |
| `pnpm api:client` | Exporta OpenAPI y regenera `libs/api-client` |
| `pnpm siat:spike [--firmar]` | Prueba CUIS, CUFD, CUF y firma contra el SIAT piloto (ver `tools/siat-spike/README.md`) |
| `pnpm nx graph` | Grafo de dependencias del monorepo |
| `pnpm nx migrate latest` | Actualizar Nx/Angular/Nest a la última versión compatible |

## 6. Producción

```bash
cp infra/env.prod.example infra/.env.prod      # completar
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod build
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod run --rm migrate
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d
```

DNS: `api.`, `rodalaser.erp.`, `empresa2.erp.`, el dominio raíz y `www.` apuntando al VPS. Respaldos diarios en `infra/backups` + `infra/scripts/backup-offsite.sh`; probar restauración cada mes con `infra/scripts/restore.sh`.

## 7. Checklist de la semana S0 (19 oct – 1 nov)

- [x] Monorepo Nx con api, worker, erp, web y librerías
- [x] Multiempresa por URL, sucursales y almacenes, roles y permisos
- [x] Login con correo, refresh con rotación, recuperación de contraseña, Google OAuth
- [x] Shell del ERP (Sidebar, ContextBar, PageHeader) con tokens del Design System
- [x] Sitio web SSR con marca por dominio
- [x] Outbox + worker + colas; CI y despliegue con Docker
- [ ] `pnpm install`, primera migración y `pnpm-lock.yaml` commiteados
- [ ] Credenciales de Google OAuth (Cloud Console) en `.env`
- [ ] **Spike SIAT** en piloto: CUIS + CUFD + firma (necesita token, código de sistema y .p12 del cliente)
- [ ] VPS de staging con el compose de producción
- [ ] Validar el CUF contra el ejemplo oficial del SIN (`libs/siat/src/lib/cuf.spec.ts`)

## 8. Pendientes que dependen del cliente (Fase 0)

NIT y datos reales de ambas empresas · nombre, sucursales y dominio de la 2.ª empresa · Google: solo Workspace o también Gmail, y solo invitados · firma digital y credenciales SIAT · pasarela de pago · límites de aprobación por rol.
