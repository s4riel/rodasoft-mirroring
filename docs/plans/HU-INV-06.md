# Plan · HU-INV-06 · Create product step by step (IN-03 family)

## Context
Warehouse needs to register products completely and without duplicates. The "Nuevo producto" buttons (list header and empty state) still show the "próximamente" toast. HU-INV-06 builds the creation wizard:
- **Category cards** (IN-03a).
- **Step 1:** subcategory, brand and industry.
- **Later steps:** fields driven by `attribute_definitions`. Bearings have 6 steps; the other categories have 4.
- **Checks:** a duplicate-code error and a missing-price error.
- **Final screen:** "Producto creado" with suggested equivalents to link.

**Agreed scope:**
- **Core `StockMovementService`:** built here, for the initial stock. HU-INV-16 later adds the adjust screen on top.
- **Uploads:** a `StorageService` plus an uploads endpoint for photos and the datasheet.
- **Drafts:** stored as products with a new `DRAFT` status.
- **Per-company settings:** a new `company_settings` table. The SKU prefix (#32) moves there.

**State and dependencies:**
- HU-INV-02, 03 and 04 are merged in `main`.
- HU-INV-05 is uncommitted on `feat/hu-inv-05`. Its migration is `20261022230000_stock_movements_and_warehouse_thresholds`; it creates `stock_movements` and per-warehouse thresholds.
- **Build HU-INV-06 after HU-INV-05 is merged**, and generate the migration after that one.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| Step 1 shows category-only cards (8 sample categories) | Page spec: IN-03a renders one `rs-radio-card` per root category from `filter-options` (seeded 8), with its icon. E2E: "Nuevo producto" → 8 cards |
| The subcategory is chosen in step 1 and decides the fields of step 2 | Domain spec: `wizardSteps(category, definitions)`. Int test: `GET /inventory/categories/:id/attribute-definitions` falls back to the parent's definitions. Page spec: changing the subcategory rebuilds the step 2 form |
| Bearings have 6 steps, other categories 4 | Domain spec: `wizardSteps` returns 6 steps for Rodamientos (identification, dimensions, specs, price and inventory, photos, equivalences) and 4 for the others. Page spec: `rs-stepper` shows each step's labels and whether it is required |
| Brand with logo, industry with flag, fields with icons | Page spec: the brand select shows media, the industry select shows a flag and is suggested from the brand, and each `rs-data-field`/input has an icon from `fieldIconOf` (HU-INV-03) |
| Warns about a duplicate code | Int test: POST with an existing (brand, code) gives 409 `DUPLICATE_MANUFACTURER_CODE`. A live check, `GET /inventory/products/code-availability?brandId&code`, returns `{available:false, productId}`. Page spec: IN-03 "error de código duplicado" state with a link to the existing product |
| Warns about a missing price | Domain spec: `validateProductDraft` reports `PRICE_REQUIRED` for a non-draft with no price. Int test: POST ACTIVE without a price gives 422 `PRICE_REQUIRED`, but a DRAFT is accepted. Page spec: the IN-03 "error de precio faltante" state blocks "Siguiente" |
| On creation, offers to link equivalences | Int test: `GET /inventory/products/:id/equivalence-suggestions` returns products with the same type and d×D×B, using `compareEquivalents`. `POST /inventory/equivalences` links them, normalizing the pair. Page spec plus E2E: on "Producto creado", "Vincular" on a suggestion → it appears in the sheet's Equivalentes tab |
| Initial stock is recorded in the receiving branch (design notes) | Int test: create with initial stock 24 → an INITIAL movement in the branch's main warehouse, `stock_levels` = 24, `balance_after` = 24. **Concurrency:** 10 parallel `apply()` calls of −1 on stock 5 leave 0 with 5 rejections `INSUFFICIENT_STOCK`; no movement is lost and none goes negative |

## Model
Migration **`product_creation_settings_and_drafts`**:
- **New `ProductStatus` enum** (`ACTIVE`, `INACTIVE`, `DRAFT`). `products.status` changes from `RecordStatus` to it; `RecordStatus` stays for brands and categories. Lists and filter options exclude DRAFT by default. HU-INV-01 gets a "Borrador" option in its status filter, and drafts open in the wizard.
- **`CompanySetting`** → table `company_settings`: `id`, `company_id`, `key`, `value Jsonb`, `updated_by_id?`, `updated_at`, with `@@unique([companyId, key])`. Add it to `TENANT_MODELS`.
  - Seed: `inventory.skuPrefix = "RL-"` and `inventory.allowNegativeStock = false` (design-notes rule 2: "unless configured").
  - Seed the placeholders for #36 and #37 (`transfers.approvalThresholdPieces`, `transfers.approvalThresholdValue`, `adjustments.approvalThresholdValue`) as null.
- **`Product`** gets `sectors String[]` (`@map`, default `{}`), `tariff_code String?`, `supplier_name String?` and `entry_date date?`. These move from the `attributes` keys used by HU-INV-03, which now read the columns.
- **Seed** attribute definitions for the 7 other categories with `step` 2. Today only bearings have them; the fields are the sample lists of the IN-03c–j2 frames (decision #52).

## Domain (`libs/domain`)
- **`product-creation.ts`:**
  - `WizardStepKey`; `wizardSteps(isBearing)` returns ordered steps with `{key, required}`.
  - `validateProductDraft(input, definitions, { draft })` returns `{field, code}[]`. Codes:
    - `CODE_REQUIRED`, `BRAND_REQUIRED`, `CATEGORY_REQUIRED`;
    - `DIMENSIONS_REQUIRED` (bearings: d, D, B);
    - `PRICE_REQUIRED` (#32);
    - `ATTRIBUTE_REQUIRED`, `ATTRIBUTE_TYPE`, `ATTRIBUTE_OPTION`, each checked against the definition.

    A draft only requires the code and brand.
  - `completedRequiredSteps(...)` → the progress counter "2 de 3 requeridos".
- **`company-settings.ts`:** `COMPANY_SETTING_DEFAULTS` holds the typed keys and their defaults, so code always has a fallback.
- **`stock.ts`** (extends HU-INV-05): pure `applyMovement(currentQty, delta, allowNegative)` → `{ balanceAfter }`, throwing `INSUFFICIENT_STOCK` when the result would be negative.

## API (`apps/api/src/modules/inventory`, plus common)
| Method | Route | Permission | Errors |
|---|---|---|---|
| GET | `/inventory/categories/:id/attribute-definitions` | `inventory.products.view` | 404 `CATEGORY_NOT_FOUND` |
| GET | `/inventory/products/code-availability?brandId&code` | `inventory.products.edit` | 400 `INVALID_FILTER` |
| POST | `/inventory/products` | `inventory.products.edit` | 400 `VALIDATION_FAILED` (with field errors), 409 `DUPLICATE_MANUFACTURER_CODE`, 422 `PRICE_REQUIRED` / `BRAND_NOT_FOUND` / `CATEGORY_NOT_FOUND` / `COUNTRY_NOT_FOUND` / `WAREHOUSE_NOT_FOUND`, 403 `BRANCH_NOT_ALLOWED` |
| PATCH | `/inventory/products/:id/draft` | `inventory.products.edit` | 404, 409 `NOT_A_DRAFT`, plus the POST errors (for "Guardar borrador" and the final save of a draft) |
| GET | `/inventory/products/:id/equivalence-suggestions` | `inventory.products.view` | 404 |
| POST | `/inventory/equivalences` | `inventory.equivalences.link` (new key, given to Warehouse and Management) | 422 `SELF_LINK`, 409 `EQUIVALENCE_EXISTS`, 404 |
| POST | `/inventory/uploads` (multipart; kind `photo` or `datasheet`) | `inventory.products.edit` | 413 `FILE_TOO_LARGE`, 415 `UNSUPPORTED_FILE_TYPE` |

**Services:**
- **`ProductCommandsService.create` / `saveDraft` / `finalize`**, all in one `$transaction`:
  1. Validate with the domain functions.
  2. Take the SKU advisory lock (the existing helper, now reading the prefix from `SettingsService`).
  3. Create the product, its dimensions, the cost (only with `inventory.costs.view`) and `created_by_id`.
  4. Upsert the threshold in the main warehouse of the receiving branch.
  5. If initial stock > 0, call `StockMovementService.apply(tx, { type: 'INITIAL', … })`.
  6. Audit `inventory.product.create`.
  7. Publish the outbox event `inventory.product-created` (new `OutboxType`; it has no consumer yet and exists for the future web catalog sync).
- **`StockMovementService`** (`stock-movement.service.ts`): the **only** writer of `stock_levels`. `apply(tx, input)`:
  1. `SELECT … FOR UPDATE` on the stock level, creating it if missing with `INSERT … ON CONFLICT DO NOTHING`.
  2. Run `applyMovement`.
  3. Update the level and insert the movement with `balance_after`.

  Add the stock-auditor review rule to the build checklist.
- **`SettingsService`** (`common/settings`): `get(key)` with a typed default from `COMPANY_SETTING_DEFAULTS`, read through `prisma.tenant`.
- **`StorageService`** (`common/storage`): an S3-compatible client (env `STORAGE_*`), with a local-disk driver in dev and tests. It stores files by company and product and returns the URLs. Images (jpeg, png, webp) up to 5 MB; PDF up to 10 MB. The limits are configuration values.
- **`EquivalencesService.link`:** normalizes the pair, sets `created_by_id`, writes an audit entry, and maps the unique violation to `EQUIVALENCE_EXISTS`. HU-INV-13 later adds the incompatibility warning UI and the IN-15 screens.

## ERP screens
- **Routes:**
  - `/inventory/products/new` → category cards (IN-03a);
  - `/inventory/products/new/:categoryId` → wizard;
  - `/inventory/products/:id/draft` → resume a draft;
  - "Nuevo producto" in `products.page` navigates to the first of these instead of showing the toast.
- **`ProductWizardPage`** (`features/inventory/products/wizard/…`):
  - a signal store holding the form state;
  - `rs-stepper` at the top, a preview card ("Vista previa" with chips), the progress card ("Progreso", required count), and a footer with Cancelar / Guardar borrador / Atrás / Siguiente.
- **Step components:**
  - `identification`: code with the live availability check (debounced), brand, subcategory, commercial name (auto-built), SKU (read-only "Asignado por el sistema"), industry (suggested from the brand), and sectors as chips.
  - `dimensions` and `specifications`: dynamic fields from the definitions. ENUMs with few options are chips (design notes §5).
  - `price-inventory`: unit, price, cost (only with `inventory.costs.view`), min/max, location, receiving branch, initial stock, supplier, tariff code and entry date.
  - `photos`: uploads with previews.
  - `equivalences`: suggestions plus a search.

  Optional steps show "Omitir este paso".
- **States:** duplicate code (the IN-03 error frame), missing price (the IN-03 error frame), and "Producto creado" (IN-03 created) with the success note, the suggestions list with "Vincular", and the buttons "Crear otro producto" / "Ver producto" / "Vincular equivalencias".
- **Reused `libs/ui` components:** Stepper, Steps, RadioCard, Field, Input/InputGroup, Select (with media from HU-INV-02), FilterChip, Note, Button, DataField, StatusPill, Toast, Modal (cancel confirmation), EmptyStateIllustrated, Skeleton.
- **Possibly missing in `libs/ui`:**
  - a **file upload/dropzone**: check the Figma Design System during the build, and implement it as `rs-file-drop` only if it exists there;
  - a **date input**: check whether `rs-input` with `type=date` matches the Figma calendar field.

## Tests
- **Unit (domain):** `wizardSteps`, `validateProductDraft` (each code, draft vs final, enum and number checks), `completedRequiredSteps`, `applyMovement`, and the settings defaults.
- **Unit (ui and erp):** the wizard store (navigation, required progress, the draft payload), each step component, the error states, the created screen, cost hidden without the permission, and the categories page.
- **Integration (real Postgres):**
  - `product-commands` (create, duplicate code, price required, draft lifecycle, cost permission, SKU from settings, audit and outbox rows);
  - `stock-movement.service.int.spec.ts` (initial movement, creating a missing level, balance chain, negative blocked unless the setting allows it, **concurrency** with parallel deductions, no lost movements);
  - `settings` (default fallback, tenant isolation);
  - `equivalences.link` (self, duplicate, reversed pair);
  - uploads with the local driver (type and size limits).
- **E2E** `apps/erp-e2e/src/product-create.spec.ts`:
  1. Nuevo producto → Rodamientos → fill the 6 steps with a duplicate code first, see the error, then fix it.
  2. Leave the price empty, see the error, then fill it.
  3. Initial stock 24 → "Producto creado" → link one suggestion → Ver producto shows stock 24 and the equivalent.
  4. A 4-step category creates fine.
  5. "Guardar borrador" then resume.

## Open decisions used with defaults
- **#32:** the required fields are code, brand, category, price and, for bearings, d×D×B. One unit per product, no lots. The SKU prefix is the company setting `inventory.skuPrefix` (default `RL-`), and the format is sequential.
- **#38:** brand logos are optional; the brand name text is shown otherwise.
- **#52:** the 8 sample categories and their attribute definitions come from the seed data, not hardcoded.
- **Negative stock:** `inventory.allowNegativeStock` defaults to false.

## Risks and doubts
- **Biggest story so far:** model, settings, storage, the stock service and about 9 screens. If the build runs long, split it into 06a (settings, stock service, API) and 06b (wizard UI).
- **Changing `products.status` to a new enum** touches HU-INV-01's filters, HU-INV-02's duplicate and HU-INV-09's planned deactivation. All their tests must be updated.
- **Overlap with other stories:**
  - HU-INV-13: the link endpoint is created here, and 13 extends it.
  - HU-INV-16: the stock service is created here, and 16 builds the adjust UI on it.
  - HU-INV-05: it must be merged first.
- **Storage in production** needs a bucket and credentials to be decided (environment variables only, in `.env.example`).
- **Seeding attribute fields for the 7 other categories** uses the sample lists of the IN-03 frames until the client answers #52.

## Files expected to change
- **Database:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_product_creation_settings_and_drafts/`, `apps/api/prisma/seed*.ts`
- **API, common:** `apps/api/src/common/{prisma/tenant.extension.ts, settings/*, storage/*, outbox/outbox.service.ts}`
- **API, inventory:** `apps/api/src/modules/inventory/{inventory.module.ts, dto.ts, products.controller.ts, products.service.ts, product-commands.service.ts, stock-movement.service.ts, equivalences.controller.ts, equivalences.service.ts, uploads.controller.ts, categories.controller.ts, *.int.spec.ts}`
- **Domain:** `libs/domain/src/lib/{product-creation.ts, company-settings.ts, stock.ts, permissions.ts, product-catalog.ts}` plus specs and `index.ts`
- **Shared UI:** possibly `libs/ui/src/lib/file-drop/*`, the showcase and `docs/ui-library.md`
- **ERP:** `apps/erp/src/app/features/inventory/{inventory.routes.ts, products/products.page.*, products/products-api.service.ts, products/wizard/**}` and `apps/erp/src/app/core/api-error.ts`
- **Tests and docs:** `apps/erp-e2e/src/product-create.spec.ts`, `.env.example`, `docs/inventory/design-notes.md`, `docs/plans/HU-INV-06.md`

## Verification
`pnpm nx affected -t lint typecheck test`, the API integration suite against Postgres (including the stock concurrency test), `pnpm db:seed`, then the Playwright E2E. Visually compare against the IN-03 frames (categories, P1–P6, the errors, Created, and the 4-step categories). Run the `stock-auditor` and `ui-checker` agents on the diff.
