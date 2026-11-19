# HU-FAC-21 … 27 · Closing VAT periods and fiscal configuration — plan

> Approved 16 Nov 2026. Build with `/story-build HU-FAC-21 HU-FAC-22 HU-FAC-23 HU-FAC-24 HU-FAC-25 HU-FAC-26 HU-FAC-27`.

## Context

HU-FAC-01…20 issue invoices and notes and show the VAT books against a `SiatGateway` port with a simulator. Still missing: closing a VAT period (a period is only "draft while its month has not ended"), and the whole "Configuración fiscal" section — the fiscal data today exists only as seed rows (`siat_settings`, `siat_points_of_sale`), legends and reasons are constants, and products carry no SIN code.

- **Story source:** the Sheet "Rodalaser Product Backlog v2" (rows HU-FAC-21…27). `docs/backlog/invoicing.md` only lists 01–20; the build adds these seven rows. None is retired.
- **Decided in planning (16 Nov):**
  1. **Port + simulator only.** The port and the simulator gain the new operations; the real SOAP adapter is a later story (needs pilot credentials). XML stays unsigned and "PROVISIONAL".
  2. **A closed period locks its books and its cancellations**: an invoice issued in a closed period is corrected with a credit note, not cancelled.
  3. **Period states `OPEN → CLOSED → FILED`**, with reopen of a `CLOSED` period (reason required, audited).
  4. **Homologation is configurable**, off by default (`invoicing.requireHomologation`).
- **Contingency is retired**, so the HU-FAC-21 criterion "facturas en contingencia" becomes "invoices and notes not issued in the SIAT".
- **Branch:** `feat/hu-fac-21-27`, cut from `feat/hu-fac-11-20` (develop does not have `20261116120000_invoicing_notes_books` yet).
- **Figma** (`JYULL6jvXiwNP8UVvEF7tl`, page `136:8992`): FS-37 `136:11249`, FS-40 `136:11314`, FS-07 `136:11392`, FS-31 `136:11469`, FS-32 `136:11491`, FS-33 `136:11557`, FS-34 `136:11635`, FS-35 `136:11708`, FS-36 `136:11790`. Read each with `get_design_context` before building its screen.

## Acceptance criteria → concrete checks

| Story | Criterion | Proof |
|---|---|---|
| 21 | List of periods with status | Int: `GET invoicing/vat-periods` → one row per La Paz month from the first document to today, `OPEN/CLOSED/FILED`, totals, KPIs (current period, last close, filed n of m). Page spec FS-37 |
| 21 | Not closed with documents not issued or observed purchases; the pending are shown | Domain `periodCloseBlockers`; Int: close → 409 `PERIOD_HAS_PENDING` with counts and the items; after fixing them → `CLOSED` with snapshot totals. Dialog spec FS-40 |
| 21 | No changes after closing | Int: `verify-nit` on an entry of a closed period → 409 `PERIOD_CLOSED`; cancellation request/approval of an invoice issued in it → `PERIOD_CLOSED`, nothing moved; export of a closed period has no "BORRADOR". **Concurrency:** close vs cancellation approval of the same period → exactly one wins |
| 21 | Order and moves | Int: month not ended → `PERIOD_NOT_ENDED`; earlier period open → `PREVIOUS_PERIOD_OPEN`; `file` only from `CLOSED`; reopen needs a reason, refused when `FILED` or a later period is closed |
| 22 | Environment, signature, credentials and catalogues with their status | Int: `GET invoicing/fiscal-settings` (status per section, checklist rows, never a secret in the payload). Page spec FS-07 |
| 22 | Access to each section | Page spec: each checklist row links to its page |
| 23 | Certificate and expiry | Int: upload a test `.p12` → holder and expiry read with `loadP12`, stored encrypted; wrong password → 400 `SIGNATURE_INVALID`; expired → `SIGNATURE_EXPIRED` |
| 23 | Warning before expiry | Domain `expiryHealth(expiresAt, now, warnDays)`; Int: inside `invoicing.signatureWarnDays` → `EXPIRING` for signature and token. Page spec FS-31 note |
| 23 | Test connection | Existing `POST invoicing/test-connection` from FS-31 (page spec; int spec exists) |
| 24 | List with registers and last invoice | Int: `GET invoicing/points-of-sale` → branch, code, register, last invoice, CUIS health, status; KPIs. Page spec FS-32 |
| 24 | New point of sale is registered in the SIAT | Int: `POST invoicing/points-of-sale` online → SIN code + CUIS + cash register created; offline → 503 `SIAT_UNAVAILABLE`, nothing saved; two concurrent creations → distinct codes. Dialog spec FS-33 |
| 25 | Tables synced, with date | Int: `GET invoicing/catalogs` → activities and legends with `syncedAt`. Page spec FS-34 |
| 25 | Sync button | Int: `POST invoicing/catalogs/sync` online → rows replaced, missing ones inactive; offline → 503, old rows kept. Worker int: a new invoice prints a synced legend of the main activity |
| 26 | Progress of homologated products | Domain `homologationProgress`; Int: `GET invoicing/homologation` KPIs equal the row counts |
| 26 | Status per product | Int: filter `status=PENDING|DONE`; `PUT …/products/:id` with an unknown SIN code → 409 `SIN_CODE_UNKNOWN`. Page spec FS-35 |
| 26 | Import from Excel | Int: preview (row errors) and apply (all-or-nothing, audited). E2E |
| 26 | Configurable block | Worker int: setting on + product without code → invoice stays `PENDING` with `PRODUCT_NOT_HOMOLOGATED`; off → issued with the default code |
| 27 | Disabled while requirements are missing | Domain `productionReadiness`; Int: 409 `PRODUCTION_REQUIREMENTS_MISSING` with the list. Dialog spec FS-36: button disabled |
| 27 | Confirmation typing PRODUCCIÓN | Int: other text → 400 `CONFIRMATION_MISMATCH`; exact → `environment = PRODUCTION`, audited; again → `ALREADY_PRODUCTION` |

## Model

Migration **`20261117120000_invoicing_fiscal_config`** (after `20261116120000_invoicing_notes_books`; no other local branch has a later migration).

- **`VatPeriod`** (`vat_periods`): `period` (`YYYY-MM`), `status VatPeriodStatus { OPEN, CLOSED, FILED }`, `closedAt/closedById`, `filedAt/filedById`, `reopenedAt/reopenedById/reopenReason`, snapshot `salesTotal`, `fiscalDebit`, `purchasesTotal`, `vatCredit` (`Decimal(14,2)`, null while open). `@@unique([companyId, period])`. A month without a row is `OPEN`.
- **`SiatCatalogEntry`** (`siat_catalog_entries`): `catalog SiatCatalog { ACTIVITY, LEGEND, PRODUCT_SERVICE, UNIT_OF_MEASURE, CANCELLATION_REASON, CREDIT_NOTE_REASON, POINT_OF_SALE_TYPE }`, `code`, `description`, `activityCode @default("")`, `active`, `syncedAt`. `@@unique([companyId, catalog, activityCode, code])`.
- **`SiatCatalogSync`** (`siat_catalog_syncs`): `catalog`, `syncedAt`, `entryCount`; `@@unique([companyId, catalog])`.
- All three with `company_id` and registered in `TENANT_MODELS` (`apps/api/src/common/prisma/tenant.extension.ts`).
- **`SiatSettings`** gains `signatureFileName`, `signatureUploadedAt`, `mainActivityCode`, `defaultProductCode`, `productionEnabledAt`, `productionEnabledById` (token, `.p12`, expiries and holder already exist).
- **`SiatPointOfSale`** gains `status RecordStatus @default(ACTIVE)`, `typeCode Int?`, `deactivatedAt`.
- **`Product`** gains `sinProductCode`, `sinActivityCode`, `sinUnitCode Int?` (`@map` snake_case), index `[companyId, sinProductCode]`.
- **`Invoice`** gains `legend` and `activityCode`, fixed at the first send so reprints never change.
- Demo seed: catalogue rows, SIN codes on most demo products (a few left pending), one closed period.

## Domain (`libs/domain`)

- `state-machine.ts`: `vatPeriodMachine` — `OPEN {close}` · `CLOSED {file, reopen}` · `FILED` final.
- New `vat-period.ts`: `periodCloseBlockers(counts)`, `canClosePeriod(period, now, previousStatus)`, `vatPeriodActions(status, permissions)`, `listPeriods(first, now)`; `isDraftPeriod` becomes "not closed" (takes the period status).
- New `fiscal-settings.ts`: `expiryHealth` (reuses the `CodeHealth` type), `homologationProgress`, `productionReadiness(input) → { ready, requirements[] }` (signature when the modality is electronic, credentials, connection online, a point of sale with a current CUIS, catalogues synced, main activity chosen, every active product homologated, a non-simulated gateway unless the environment allows the simulator), `PRODUCTION_CONFIRMATION = 'PRODUCCIÓN'`, contracts `FiscalSettingsSummary`, `PointOfSaleListItem`, `CatalogSummary`, `HomologationRow`, `VatPeriodRow`.
- `company-settings.ts`: `invoicing.signatureWarnDays` (30), `invoicing.requireHomologation` (`false`), `invoicing.documentSectors` (`[1, 24]`).
- `permissions.ts`: new `invoicing.production.enable` ("Pasar a producción"), excluded from the default `accountant` role. Used: `invoicing.settings.manage`, `invoicing.vat-books.view`, `invoicing.vat-books.close`.
- `invoicing.ts`: `SIAT_CANCELLATION_REASONS` / `SIAT_CREDIT_NOTE_REASONS` stay as the fallback while a company has not synced.

## `libs/siat`

- `gateway.ts`: port gains `registerPointOfSale({ branchCode, name, typeCode }) → { code }`, `closePointOfSale(ref)`, `syncCatalogs(ref) → SiatCatalogs`. Same rule: `SiatUnavailableError` when the SIAT does not answer.
- `simulated.gateway.ts`: implements them (fixed catalogue fixture in a new `simulated-catalogs.ts`; point-of-sale codes consecutive per branch through the store; offline mode).
- `invoice-xml.ts` / `credit-note-xml.ts`: lines take the product's SIN code, unit and activity; still "PROVISIONAL".

## API (`apps/api/src/modules/invoicing`)

| Method · route (`/api/v1/…`) | Permission | Error `code`s |
|---|---|---|
| `GET invoicing/vat-periods` · `GET …/:period/blockers` | `invoicing.vat-books.view` | `VALIDATION_FAILED` |
| `POST invoicing/vat-periods/:period/close` | `invoicing.vat-books.close` | `PERIOD_NOT_ENDED`, `PREVIOUS_PERIOD_OPEN`, `PERIOD_HAS_PENDING`, `PERIOD_ALREADY_CLOSED` |
| `POST …/:period/file` · `POST …/:period/reopen` `{ reason }` | `invoicing.vat-books.close` | `PERIOD_NOT_CLOSED`, `PERIOD_FILED`, `LATER_PERIOD_CLOSED` |
| `GET invoicing/fiscal-settings` | `invoicing.settings.manage` | — |
| `PUT invoicing/fiscal-settings/signature` (multipart `.p12` + password) | `invoicing.settings.manage` | `SIGNATURE_INVALID`, `SIGNATURE_EXPIRED` |
| `PUT invoicing/fiscal-settings/credentials` `{ systemCode, token, tokenExpiresAt }` | `invoicing.settings.manage` | `VALIDATION_FAILED` |
| `PUT invoicing/fiscal-settings/activity` `{ mainActivityCode, defaultProductCode }` | `invoicing.settings.manage` | `SIN_CODE_UNKNOWN` |
| `POST invoicing/fiscal-settings/production` `{ confirmation }` | `invoicing.production.enable` | `PRODUCTION_REQUIREMENTS_MISSING`, `CONFIRMATION_MISMATCH`, `ALREADY_PRODUCTION` |
| `GET invoicing/points-of-sale` · `POST invoicing/points-of-sale` `{ branchId, name, typeCode, warehouseId }` | `invoicing.settings.manage` | `SIAT_UNAVAILABLE` (503), `POINT_OF_SALE_REJECTED`, `BRANCH_NOT_FOUND` |
| `POST invoicing/points-of-sale/:id/deactivate` | `invoicing.settings.manage` | `POINT_OF_SALE_IN_USE` (open shift), `SIAT_UNAVAILABLE` |
| `GET invoicing/catalogs` · `GET invoicing/catalogs/:catalog` | `invoicing.invoices.view` | — |
| `POST invoicing/catalogs/sync` | `invoicing.settings.manage` | `SIAT_UNAVAILABLE`, `POINT_OF_SALE_MISSING` |
| `GET invoicing/homologation` · `PUT invoicing/homologation/products/:id` | `invoicing.settings.manage` | `PRODUCT_NOT_FOUND`, `SIN_CODE_UNKNOWN`, `CATALOGS_NOT_SYNCED` |
| `GET invoicing/homologation/template` · `POST …/import/preview` · `POST …/import` | `invoicing.settings.manage` | `IMPORT_HAS_ERRORS`, `VALIDATION_FAILED` |

- New services: `vat-periods.service.ts`, `fiscal-settings.service.ts`, `points-of-sale.service.ts`, `siat-catalogs.service.ts`, `homologation.service.ts` (+ `homologation-import.service.ts`). Queries through `prisma.tenant`; gateway through `SiatGatewayFactory`.
- **Period lock:** closing, reopening and every guarded write take `pg_advisory_xact_lock(company, period)` inside their transaction and read the period status under it. Guards added to `vat-books.service.ts` (`verifyPurchaseNit`), `invoice-cancellations.service.ts` (request) and step A of `sales/…/sale-cancellation.service.ts` (approval), through a small shared `VatPeriodGuard` in `apps/api/src/common`. `vat-book-export.service.ts` and the book headers read the period status for the draft flag.
- **Secrets:** `.p12`, its password and the token go through `SecretsService.encrypt`; `loadP12` (`libs/siat/src/lib/xml-signer.ts`) validates and reads holder and expiry. Nothing secret is returned, logged or audited.
- **SIAT calls outside transactions** (as `renewCufd` does): register the point of sale and ask its CUIS, then one transaction writes the point of sale and its `CashRegister`. Catalogue sync fetches first, then replaces the rows in one transaction.
- **Reasons:** cancellation and credit-note reason lists are served from the synced catalogue when it exists, else from the domain constants.
- **Homologation import:** reuses the `exceljs` reading and the preview/apply shape of `inventory/product-import.service.ts` and `list-file.ts`; columns SKU, SIN code, unit.
- **Audit:** `invoicing.period.close|file|reopen`, `invoicing.signature.update`, `invoicing.credentials.update`, `invoicing.point-of-sale.create|deactivate`, `invoicing.catalogs.sync`, `invoicing.product.homologate`, `invoicing.homologation.import`, `invoicing.production.enable`. No outbox event is needed (nothing asynchronous is added).

## Worker (`apps/worker`)

- `siat/invoice-issue.service.ts` and `credit-note-issue.service.ts`, in the prepare step: fix `legend` and `activityCode` on the invoice from the synced catalogue (fallback `INVOICE_LEGEND_DEFAULT`); read each line's SIN code; with `invoicing.requireHomologation` on and a line without code, leave the document `PENDING` with `lastError = PRODUCT_NOT_HOMOLOGATED` (same pattern as `POINT_OF_SALE_MISSING`); skip deactivated points of sale.
- API readers of the legend (`invoice-queries`, `invoice-documents`, `credit-note-queries`) use the stored one.

## ERP screens (`apps/erp/src/app/features/invoicing/`)

New tab **Configuración fiscal** (`settings`, `invoicing.settings.manage`) and the "Ver períodos" button on Libros IVA.

| Screen | Route | `libs/ui` |
|---|---|---|
| FS-37 `vat-periods.page` + FS-40 `vat-period-close.dialog` + `vat-period-reopen.dialog` | `/invoicing/books/periods` | `rs-page-header`, `rs-kpi-card`, `rs-doc-table`, `rs-status-pill`, `rs-row-action`, `rs-pagination`, `rs-modal`, `rs-note`, `rs-textarea` |
| FS-07 `fiscal-settings.page` + FS-36 `production.dialog` | `/invoicing/settings` | `rs-kpi-card`, `rs-doc-table`, `rs-status-pill`, `rs-note`, `rs-button`, `rs-modal`, `rs-field`, `rs-input` |
| FS-31 `fiscal-credentials.page` | `/invoicing/settings/credentials` | `rs-note`, `rs-field`, `rs-input`, `rs-file-dropzone`, `rs-file-item`, `rs-button`, `rs-breadcrumb` |
| FS-32 `points-of-sale.page` + FS-33 `point-of-sale.dialog` | `/invoicing/settings/points-of-sale` | `rs-kpi-card`, `rs-filter-bar-products`, `rs-doc-table`, `rs-status-pill`, `rs-modal`, `rs-select`, `rs-input` |
| FS-34 `fiscal-catalogs.page` | `/invoicing/settings/catalogs` | `rs-doc-table`, `rs-status-pill`, `rs-pagination`, `rs-button` |
| FS-35 `homologation.page` + `homologation-import.dialog` | `/invoicing/settings/homologation` | `rs-kpi-card`, `rs-filter-bar-products`, `rs-doc-table`, `rs-select`, `rs-file-dropzone`, `rs-modal`, `rs-pagination` |

- Reuse `invoicing-api.service.ts`, `invoice-format.ts`, `file-download.ts`, `invoicing-tabs.ts`, `requiresInvoicingTab`. New error codes in Spanish in `core/api-error.ts`. The cancellation and credit-note dialogs load their reasons from the API.
- "Estado del sistema" shows a note when the signature or the token is expiring.
- No new `libs/ui` component expected; if a frame draws one, it is built there with its own `.ts/.html/.scss/.spec`.

## Tests

- **Unit:** `state-machine.spec` (period machine), `vat-period.spec`, `fiscal-settings.spec` (expiry health, readiness, progress), `company-settings.spec`, `permissions.spec`; `simulated.gateway.spec`, XML specs; every new page and dialog (states by permission and status).
- **Integration, real Postgres:** periods list and tenant isolation; close blocked / allowed / ordered; file and reopen; guards on purchase entries and cancellations; **concurrent close vs cancellation approval → one wins**; **two concurrent closes → one `PERIOD_ALREADY_CLOSED`**; signature upload (valid, wrong password, expired) and no secret in any response or audit row; credentials; point of sale online/offline and **concurrent creation → distinct codes**; deactivate with an open shift; catalogue sync online/offline; homologation update, import preview/apply; production switch (missing, mismatch, ok, repeated). Worker: legend from the catalogue, homologation block on/off.
- **E2E (`apps/erp-e2e/src`):** `invoicing-vat-periods.spec.ts` (blocked close shows the pending → verify the observed purchase → close → export without "BORRADOR" → reopen); `invoicing-fiscal-settings.spec.ts` (summary → sync catalogues → new point of sale → homologate by import → production dialog disabled, then enabled and confirmed with PRODUCCIÓN).
- **Agents:** `reviewer`, `ui-checker`. Stock is not touched (`stock-auditor` only if the cancellation diff grows beyond the guard). Then `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default (added to `docs/backlog/decisions.md`)

- **#29** who delivers and renews signature and credentials → Management uploads them in the ERP; warning `invoicing.signatureWarnDays = 30`.
- **#30** how SIN codes are assigned and who homologates → per product by hand or by Excel, by whoever holds `invoicing.settings.manage`; `invoicing.requireHomologation = false`.
- **#31** modality and document sectors → `SiatSettings.modality` (unchanged) and `invoicing.documentSectors = [1, 24]`.
- Closing rules (planning answers 2 and 3) are recorded as answered.

## Risks and doubts

1. **Production with a simulator.** `productionReadiness` requires a non-simulated gateway unless `SIAT_ALLOW_SIMULATOR=true`, so on a real deployment "Pasar a producción" stays disabled until the SOAP story. There is no way back to `TEST` from the UI.
2. **Draft rule changes:** a book is now a draft until its period is closed (before: until the month ended). Existing export and book specs are updated.
3. **One permission for the whole section.** The stories split Gerencia (23, 24, 27) and Contabilidad (25, 26), but only `invoicing.settings.manage` exists and the accountant role has it by prefix. Only the production switch gets its own key; splitting further is a role-editor matter.
4. **`products` is inventory's table:** three new nullable columns; conflicts with any open inventory branch touching `Product` in `schema.prisma`.
5. **Point of sale registered in the SIN but not saved** (crash between the call and the transaction): the simulator makes registration idempotent by branch + name; the real adapter must reconcile.
6. **Purchasing contract:** a future purchase entry dated in a closed period must be refused or moved to the open one (`VatPeriodGuard` is the hook).
7. **Catalogue shapes are simulated**; the real `sincronizar*` responses may need more columns.
8. **Size:** build in slices, each green before the next — (A) periods (21) → (B) settings summary, signature, credentials (22, 23) → (C) points of sale (24) → (D) catalogues and homologation (25, 26) → (E) production (27).

## Files expected to change

- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261117120000_invoicing_fiscal_config/`, `apps/api/prisma/seed-base.ts` (+ demo seed), `apps/api/src/common/prisma/tenant.extension.ts`, new `apps/api/src/common/…/vat-period.guard.ts`
- `libs/domain/src/lib/{state-machine,invoicing,company-settings,permissions}.ts`, new `vat-period.ts`, `fiscal-settings.ts` (+ specs), `libs/domain/src/index.ts`
- `libs/siat/src/lib/{gateway,simulated.gateway,invoice-xml,credit-note-xml}.ts`, new `simulated-catalogs.ts` (+ specs), `libs/siat/src/index.ts`
- `apps/api/src/modules/invoicing/**` (new services and int specs; controller, DTOs, errors, module; `vat-books.service.ts`, `vat-book-export.service.ts`, `invoice-cancellations.service.ts`, `invoice-queries.service.ts`, `invoice-documents.service.ts`, `credit-note-queries.service.ts`)
- `apps/api/src/modules/sales/**/sale-cancellation.service.ts` (+ int spec), `apps/api/src/common/siat/prisma-siat-store.ts`
- `apps/worker/src/siat/{invoice-issue,credit-note-issue}.service.ts`, `prisma-siat-store.ts` (+ int specs)
- `apps/erp/src/app/features/invoicing/**` (new pages/dialogs, `invoicing.routes.ts`, `invoicing-tabs.ts`, `invoicing-api.service.ts`, `vat-books.page.*`, `siat-status.page.*`, cancellation and credit-note dialogs), `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/invoicing-{vat-periods,fiscal-settings}.spec.ts` (and `invoicing-vat-books.spec.ts` for the draft rule)
- `docs/backlog/invoicing.md`, `docs/backlog/decisions.md`, `docs/invoicing/design-notes.md`, `docs/plans/invoicing/HU-FAC-21-27.md`

## Verification

1. `pnpm nx run-many -t test -p domain siat` → `pnpm nx test api` → `pnpm nx test worker` → `pnpm nx test erp` → the Playwright specs.
2. Manual on the dev stack: Libros IVA → "Ver períodos" → closing last month is blocked by the seeded observed purchase → verify it → close → export is final → a cancellation of an invoice of that month is refused → reopen. Configuración fiscal: upload a test `.p12`, save credentials, test connection, sync catalogues, add a point of sale (and with `invoicing.simulatorMode = OFFLINE` see it fail without saving), homologate by Excel, open "Pasar a producción" (disabled with the missing list; with `SIAT_ALLOW_SIMULATOR=true` and everything ready, confirm typing PRODUCCIÓN).
3. `pnpm nx affected -t lint typecheck test` with no errors.
