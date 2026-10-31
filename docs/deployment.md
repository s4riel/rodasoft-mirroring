# Despliegue a producción: Vercel + Railway

Guía para publicar Rodasoft con **Vercel** (ERP y sitio web) y **Railway** (API, worker, PostgreSQL y Redis).
Fecha de redacción: 28 oct 2026. Los precios y límites de los proveedores cambian: verifícalos antes de contratar.

> Estado: **nada de esto se ha probado todavía.** El código y los archivos de despliegue se escribieron sin compilar ni desplegar. Cuenta con ajustes en el primer despliegue. Lo marcado **[VERIFICAR]** son puntos que no pude confirmar en la documentación y se deben probar.

---

## 1. Arquitectura

```
                       Navegador
       ┌─────────────────┼──────────────────┐
       ▼                 ▼                  ▼
 rodalaser.erp.X    X / www.X          api.X (Google OAuth)
 company2.erp.X     dominio empresa 2        │
  Vercel (ERP)      Vercel (web + tienda)    │
       │ /api/* (rewrite)  │ SSR → API        │
       └──────────────┬────┴──────────────────┘
                      ▼
               Railway · API (NestJS)  ──►  PostgreSQL
                      │                      ▲
                      └──► Redis ◄── Worker ─┘
```

| Pieza | Dónde | Notas |
|---|---|---|
| ERP (Angular, estático) | Vercel, proyecto `rodasoft-erp` | Una URL por empresa: `rodalaser.erp.X`, `company2.erp.X` |
| Web y tienda (Angular SSR) | Vercel, proyecto `rodasoft-web` | Ver §4.3 (no confirmado) y el plan B en Railway |
| API (NestJS) | Railway, servicio `api` | Dominio `api.X` |
| Worker (BullMQ) | Railway, servicio `worker` | **Una sola réplica** (outbox) |
| PostgreSQL 16 | Railway | Red privada; sin acceso público |
| Redis | Railway | Para BullMQ |
| Caddy / docker-compose.prod | **No se usan** | Vercel y Railway terminan el TLS. Quedan en `infra/` como plan B en un VPS |

`X` = tu dominio (aún sin definir). Mientras no tengas dominio puedes desplegar en `*.vercel.app` y `*.up.railway.app` (§8).

---

## 2. Cambios de código necesarios antes de desplegar

Pídele a Claude Code que los haga en una rama (ver el prompt al final).

1. **Puerto de la API.** Railway entrega el puerto en la variable `PORT`, pero la API lee `API_PORT` (`apps/api/src/config/env.ts`). Cambiar para que use `PORT` cuando exista.
2. **Un Dockerfile por servicio.** Railway **no permite elegir el target** de un Dockerfile multi-etapa. El `infra/docker/Dockerfile` actual usa targets (`api`, `worker`, `web`, `migrate`, `gateway`). Hay que dividirlo en `infra/docker/api.Dockerfile`, `worker.Dockerfile` (y `web.Dockerfile` si el sitio va en Railway). En Railway se apunta a cada uno con la variable `RAILWAY_DOCKERFILE_PATH`.
3. **Migraciones.** Railway permite un *pre-deploy command* que corre antes de cada despliegue. La imagen final de la API hoy **no incluye** el CLI de Prisma (se poda con `pnpm prune --prod`). Solución: dejar `prisma` instalado en la imagen y correr `prisma migrate deploy --schema ...` como pre-deploy command.
4. **Extensiones de PostgreSQL.** `pg_trgm`, `unaccent` y `citext` hoy se crean con `infra/postgres/init/01-extensions.sql`, que **solo corre en el Postgres local de Docker**. Pasarlas a la primera migración con `CREATE EXTENSION IF NOT EXISTS ...`. **[VERIFICAR]** que el Postgres de Railway las permite: la documentación de Railway no lo confirma (solo dice que no añadirá extensiones extra a su plantilla por defecto).
5. **`trust proxy`.** `main.ts` usa `trust proxy = 1` (pensado para Caddy). Con Vercel → Railway hay más saltos; ajustar para que la IP real llegue a auditoría y al limitador de peticiones (`@nestjs/throttler`).
6. **ERP: URL de la API.** `apps/erp/src/environments/environment.prod.ts` tiene `apiPublicUrl: 'https://api.rodalaser.com.bo'` con un `TODO`. Poner el dominio real (se usa para el login con Google).
7. **Archivo `vercel.json` del ERP** con el rewrite de `/api/*` hacia la API (§4.2).
8. **Worker y `SECRETS_KEY`.** El esquema de variables del worker no incluye `SECRETS_KEY`. Cuando `siat.processor` descifre credenciales SIAT, el worker la necesitará.
9. **Correo.** **[VERIFICAR]** si Railway permite SMTP saliente en tu plan (se ha reportado que algunos planes lo bloquean). Si no, usar un proveedor de correo por API HTTP; eso exige cambiar `mail.processor.ts`.

---

## 3. Railway (API, worker, base de datos)

### 3.1 Plan y costos (datos de la documentación de Railway, oct 2026)

- Planes: **Hobby US$5/mes** y **Pro US$20/mes**; cada uno incluye ese mismo monto en uso.
- Uso: RAM US$10/GB/mes, CPU US$20/vCPU/mes, salida de red US$0,05/GB, volumen US$0,15/GB/mes.
- Hobby limita los volúmenes a **5 GB**. Para una base de datos de producción conviene **Pro**.
- Estimación propia (no medida): API + worker + Postgres + Redis, con poco tráfico, entre unos US$20 y US$40 al mes en total. Medir en staging.

### 3.2 Región

Railway tiene 4 regiones: **US West (California), US East (Virginia), EU West (Ámsterdam) y Sudeste Asiático (Singapur).** No hay Sudamérica. Elige **US East (Virginia)**: es la más cercana a Bolivia y coincide con la región por defecto de las funciones de Vercel (`iad1`). Mide la latencia hacia el SIAT en el spike antes de decidir.

### 3.3 Pasos

1. Crear cuenta en Railway, plan **Pro**. Crear un proyecto con dos entornos: `staging` y `production`.
2. Añadir **PostgreSQL** (plantilla de Railway) y **Redis**. Dejar sin acceso público.
3. Añadir el servicio **api**: desde el repositorio **espejo de GitHub** (§6.1), rama `main`.
   - Variable `RAILWAY_DOCKERFILE_PATH=infra/docker/api.Dockerfile`.
   - Health check: `/api/v1/health/live`.
   - Pre-deploy command: migraciones de Prisma (§2.3).
   - Dominio: generar el de Railway y luego añadir `api.X` (CNAME en tu DNS).
4. Añadir el servicio **worker**: mismo repo, `RAILWAY_DOCKERFILE_PATH=infra/docker/worker.Dockerfile`, **1 réplica**, sin dominio público.
5. Cargar las variables de entorno (§3.4). Para referenciar la base de datos y Redis entre servicios, Railway permite referencias del estilo `${{Postgres.DATABASE_URL}}` y `${{Redis.REDIS_URL}}` **[VERIFICAR el nombre exacto de los servicios y variables en tu proyecto]**.
6. Desplegar, revisar los logs, y correr el seed de producción una sola vez (§3.5).
7. **Redis y BullMQ:** comprobar con `CONFIG GET maxmemory-policy` que no hay política de expulsión de claves (`noeviction`), como pide el compose actual.

### 3.4 Variables de entorno

**API**

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | la entrega Railway (ver §2.1) |
| `API_PUBLIC_URL` | `https://api.X` |
| `CORS_ORIGINS` | `https://rodalaser.erp.X,https://company2.erp.X` |
| `DATABASE_URL` | referencia a Postgres (red privada) |
| `REDIS_URL` | referencia a Redis |
| `JWT_ACCESS_SECRET` | 48+ caracteres aleatorios (`openssl rand -base64 48`) |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL_DAYS` | `15m` / `7` |
| `COOKIE_SECURE` | `true` |
| `COOKIE_DOMAIN` | vacío (la cookie queda en el host del ERP, una sesión por empresa) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | de Google Cloud Console |
| `GOOGLE_CALLBACK_URL` | `https://api.X/api/v1/auth/google/callback` |
| `GOOGLE_ALLOWED_HD` | dominio de Workspace, si aplica |
| `ERP_PUBLIC_URL` | `https://{company}.erp.X` |
| `SECRETS_KEY` | clave de cifrado de credenciales SIAT. **Guárdala fuera de Railway** (gestor de contraseñas): si se pierde no se pueden descifrar |
| `SMTP_URL` / `MAIL_FROM` | proveedor de correo (ver §2.9) |

**Worker:** `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, `SMTP_URL`, `MAIL_FROM`, `OUTBOX_BATCH` (y `SECRETS_KEY` cuando use SIAT).

### 3.5 Seed de producción

El seed actual crea las empresas de ejemplo y al administrador con la contraseña por defecto `Rodalaser.2026`. **No uses eso en producción.** Define `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` fuertes, o crea un seed de producción aparte con los datos reales (NIT, sucursales, almacenes). Ejecútalo una vez, con `railway run` o desde una máquina con acceso a la base, y cambia la contraseña en el primer ingreso.

### 3.6 Respaldos

Railway tiene funciones de respaldos y recuperación a un punto en el tiempo (páginas *Backups* y *Point-in-Time Recovery* de su documentación); **[VERIFICAR]** qué plan las incluye y su retención. Aparte, mantén un `pg_dump` diario hacia un almacenamiento externo (Cloudflare R2 o S3) y **prueba la restauración cada mes** (el contrato lo exige). Los scripts `infra/scripts/backup-offsite.sh` y `restore.sh` sirven de base.

---

## 4. Vercel (ERP y sitio web)

### 4.1 Plan

El plan **Hobby es solo para uso personal y no comercial**; este proyecto necesita **Pro** (US$20 por usuario con permisos de desarrollo al mes, según su documentación). Crear un *team* Pro con la cuenta del proyecto (idealmente con el correo del negocio).

### 4.2 ERP (`rodasoft-erp`)

1. *Import Project* desde el repositorio. Vercel detecta Nx; el proyecto compila con librerías compartidas del monorepo, así que debe poder leer archivos fuera del directorio raíz de la app.
2. Ajustes de compilación **[VERIFICAR en el primer despliegue; con monorepo Nx suele requerir ajustar rutas]**:
   - Install: `pnpm install --frozen-lockfile`
   - Build: `pnpm nx build erp --configuration=production`
   - Output: `dist/apps/erp/browser`
3. `vercel.json` del ERP. El orden importa: primero el proxy de la API, luego el *fallback* de la SPA:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://api.X/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

   Por qué: el ERP llama a `/api/...` con rutas relativas y la cookie de refresco (`rs_refresh`) se guarda en el host del ERP. Con el rewrite, el navegador sigue viendo una sola URL por empresa, igual que con Caddy. La API sabe qué empresa es por la cabecera `X-Company` que el ERP ya envía. **[VERIFICAR]** que la cookie `Set-Cookie` de la API se conserva a través del rewrite de Vercel. **Plan B** si no: llamar a la API con URL absoluta, activar `credentials`, poner `COOKIE_DOMAIN=.X` y ajustar `cookies.ts` (el `path` actual es `/api/v1/auth`).
4. **Dominios** (solo después de tener dominio): añadir `rodalaser.erp.X` y `company2.erp.X` al proyecto. La empresa se deduce del subdominio (`companySlugFromHost`). En `*.vercel.app` no hay subdominio de empresa y el ERP usa la empresa por defecto (`rodalaser`).

### 4.3 Sitio web y tienda (`rodasoft-web`)

El sitio es **Angular SSR** (Express en `apps/web/src/server.ts`, que exporta `reqHandler`). La marca se decide por el dominio, así que el servidor debe recibir el `Host` original.

- Hay un patrón conocido para Vercel: una función `api/index.js` que importa `reqHandler` desde `dist/.../server/server.mjs` y un `vercel.json` que reescribe todo a esa función e incluye los archivos compilados. Lo encontré en un artículo comunitario, **no en la documentación oficial de Vercel**, y usaba Angular con otra estructura de compilación (`@angular/build:application` con `outputMode: server`, como el de este repo, no estaba confirmado). **[VERIFICAR con un despliegue de prueba antes de comprometerse.]**
- **Plan B recomendado si falla:** desplegar el sitio como tercer servicio en **Railway** (`web.Dockerfile`; el servidor ya lee `PORT`). Se pierde la CDN de Vercel para las páginas dinámicas, pero los archivos estáticos siguen cacheados. Es más simple y ya está casi listo.
- Dominios: `X`, `www.X` y el dominio de la segunda empresa.
- Región de las funciones: la predeterminada de Vercel es `iad1` (Washington D. C.), cercana a Railway US East.

---

## 5. Dominio y DNS

Con dominio propio (por ejemplo un `.com.bo`):

| Registro | Destino |
|---|---|
| `api.X` | Railway (servicio `api`) |
| `rodalaser.erp.X`, `company2.erp.X` | Vercel (proyecto ERP) |
| `X`, `www.X`, dominio de la empresa 2 | Vercel (proyecto web) |

Cada proveedor indica el registro exacto (CNAME o A) al añadir el dominio. El TLS lo emiten ellos automáticamente. Hay que declarar **cada subdominio** de empresa; no se usa comodín.

---

## 6. CI/CD con GitLab, mirror a GitHub y los dos proveedores

Decisión del proyecto: el repositorio principal está en **GitLab**; **Vercel** despliega desde GitLab y **Railway** despliega desde un **espejo (mirror) en GitHub**.

```
 tú ──push──► GitLab (repo principal)
                 │  CI (.gitlab-ci.yml) en cada merge request
                 │  main protegida: merge solo con pipeline en verde
                 ├────────► Vercel (integración nativa con GitLab)  → ERP y web
                 └─ push mirror ──► GitHub (solo lectura) ──► Railway → API y worker
```

### 6.1 Espejo de GitLab a GitHub (para Railway)

1. En GitHub crea un repositorio **privado vacío** (idealmente en la organización de Rodalaser) y conecta la **app de Railway** a ese repositorio.
2. Crea un *fine-grained personal access token* de GitHub con permiso de lectura y escritura sobre el contenido del repositorio (y de *Workflows* si el repo tuviera `.github/workflows`).
3. En GitLab: **Settings > Repository > Mirroring repositories**. URL `https://github.com/ORG/REPO.git`, dirección **Push**, usuario y token. Activa **Only mirror protected branches**.
4. Nunca hagas push directo al espejo de GitHub: el espejo se sobrescribe y se rompe si diverge.
5. Según la documentación de GitLab, el push mirror está disponible en el plan Free; los cambios llegan al espejo en unos 5 minutos (1 minuto con *Only mirror protected branches*). Vigila el error de *Mirroring repositories* si una rama diverge.

Consecuencias:

- Railway despliega la rama configurada (`main`) cuando llega al espejo, con un retraso de uno a cinco minutos. **Vercel despliega al instante desde GitLab**, así que ERP y API no se actualizan al mismo tiempo. Haz los cambios de la API **compatibles hacia atrás** (primero se despliega la API, luego el ERP) para que nunca queden versiones incompatibles.
- La función *Wait for CI* de Railway solo mira **GitHub Actions**. Como el CI corre en GitLab, no la usarás; la protección es esta regla: **`main` protegida y merge requests con "Pipelines must succeed"**. Así al espejo solo llega código ya verificado.
- Si el repo contiene `.github/workflows`, esos flujos se ejecutarán también en GitHub. Para no duplicar CI, **borra `.github/workflows/ci.yml` y `deploy.yml`** (el segundo desplegaba por SSH a un VPS, que ya no se usa).

### 6.2 CI en GitLab

El archivo `.gitlab-ci.yml` de la raíz reemplaza a `ci.yml`: corre en cada merge request y en `main`, levanta PostgreSQL y Redis, aplica las migraciones y ejecuta `nx affected` (lint, typecheck, test y build). **[VERIFICAR]** en el primer pipeline: las rutas del store de pnpm, la variable `DATABASE_URL` con host `postgres`, y que `CI_COMMIT_BEFORE_SHA` funcione bien con tu estrategia de merge.

Configuración en GitLab (Settings > Merge requests y Repository > Branch rules):

- `main` protegida: solo se entra por merge request; nadie hace push directo.
- *Pipelines must succeed* activado.
- Preferible *squash* para que la historia de `main` sea limpia.

### 6.3 Vercel desde GitLab

- Al importar el proyecto necesitas acceso **Maintainer** en el repositorio (y en el grupo si lo hay) para que Vercel configure el webhook.
- Vercel despliega cada push y crea una **URL de previsualización por merge request**; la rama de producción (`main`) publica en los dominios.
- Hay un aviso conocido en la documentación de Vercel: en GitLab a veces un pipeline de merge falla mientras el de rama pasa, lo que permite fusionar con pruebas fallando. Revisa que *Pipelines must succeed* use el pipeline de merge request y, si te preocupa, despliega con la CLI de Vercel desde el pipeline.
- Vercel despliega al hacer push aunque el CI aún no termine; el despliegue de **producción** solo ocurre al llegar a `main`, que ya pasó el CI.

### 6.4 Flujo diario

1. Rama → `/story-plan` y `/story-build` → push a GitLab → merge request.
2. El pipeline corre; Vercel publica la previsualización del ERP/web; revisas.
3. Merge a `main` (solo con pipeline en verde).
4. Vercel publica producción al instante; el espejo envía `main` a GitHub; Railway despliega la API y el worker (con las migraciones en el *pre-deploy command*).
5. Las migraciones son hacia adelante: **haz un respaldo antes de desplegar una migración en producción.**
6. Entornos: Railway tiene `staging` y `production`. Un posible esquema es que `main` despliegue `staging` y una rama o etiqueta de producción despliegue `production` (decídelo antes de configurar los espejos; solo se espeja lo protegido).

---

## 7. SIAT en producción

- Cargar por empresa la firma digital, el token y el código de sistema (cifrados con `SECRETS_KEY`).
- Pasar la certificación en el ambiente piloto y la homologación; cambiar a `PRODUCTION` solo después.
- IP de salida: las IP de Railway pueden cambiar **[VERIFICAR]** si Railway ofrece IP de salida fija en tu plan, por si el SIN o la pasarela de pago exigieran lista blanca.
- Medir la latencia desde Railway US East hacia el SIAT.

---

## 8. Probar sin dominio (staging)

Puedes desplegar hoy con las URL gratuitas:

- ERP en `rodasoft-erp.vercel.app`, API en `api-staging.up.railway.app`.
- Funciona una sola empresa (`rodalaser`) porque no hay subdominios.
- El login con Google puede no aceptar estas URL **[VERIFICAR]**; usa correo y contraseña.
- `COOKIE_SECURE=true` funciona porque ambos son HTTPS.

---

## 9. Operación

- **Reversa:** Railway permite volver a un despliegue anterior; Vercel permite promover uno anterior. Si hubo migración, restaurar primero el respaldo.
- **Monitoreo:** chequeo externo sobre `/api/v1/health/live`, alertas de Railway por uso y fallos, y alertas de gasto en ambos proveedores.
- **Costos mensuales estimados** (sin medir): Vercel Pro US$20 por usuario + Railway Pro US$20 más uso, es decir, unos US$50 a US$80 al mes en total; en 12 meses, US$600 a US$960 del presupuesto de US$3.500. Compáralo con un VPS único (US$25 a US$45).

## 10. Lista de verificación

- [ ] Cambios de código de §2 hechos y probados en tu PC
- [ ] Dockerfiles separados que compilan (`docker build` de cada uno)
- [ ] Migración con extensiones probada en Railway
- [ ] Railway: Postgres, Redis, API y worker en `staging` funcionando
- [ ] Vercel: ERP desplegado, login y `/api` funcionando (cookie incluida)
- [ ] Vercel o Railway: sitio web SSR funcionando con la marca correcta
- [ ] GitLab: `main` protegida, pipeline verde obligatorio, `.gitlab-ci.yml` funcionando
- [ ] Espejo GitLab → GitHub activo y Railway conectado al espejo
- [ ] Borrados `.github/workflows/ci.yml` y `deploy.yml`
- [ ] Dominio, DNS y TLS
- [ ] Correo real, Google OAuth, `COOKIE_SECURE=true`
- [ ] Seed de producción sin datos de ejemplo
- [ ] Respaldo externo diario y restauración probada
- [ ] Alertas de gasto y monitoreo
- [ ] Credenciales SIAT y certificación por empresa
- [ ] Ensayo de migración de datos reales (2 ensayos)

## 11. Prompt para Claude Code

> Lee `CLAUDE.md` y `docs/deployment.md`. Estamos pasando el despliegue a Vercel (ERP y web) y Railway (API, worker, Postgres, Redis). Trabaja en una rama y **no hagas commits**. Haz, en este orden, y muéstrame el plan antes de empezar: (1) hacer que la API use `PORT`; (2) dividir `infra/docker/Dockerfile` en `api.Dockerfile` y `worker.Dockerfile` que compilen por separado y dejar el original sin tocar; (3) incluir el CLI de Prisma en la imagen de la API para el pre-deploy de migraciones; (4) mover `CREATE EXTENSION pg_trgm/unaccent/citext` a la primera migración; (5) ajustar `trust proxy`; (6) crear `apps/erp/vercel.json` con los rewrites; (7) un spike para desplegar `apps/web` en Vercel con una función que use `reqHandler`, y si no es viable, crear `web.Dockerfile` para Railway. Verifica cada Dockerfile con `docker build` y reporta resultados reales.
