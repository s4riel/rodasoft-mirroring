# Plan · HU-INV-03 · Product sheet (IN-02a)

## Context
The list (HU-INV-01) and the row menu (HU-INV-02, planned, not built yet) need a product sheet to open. HU-INV-03 builds the "Datos" tab of IN-02a (Figma `262:49140`), which shows:
- identity: photo, brand with logo, industry with flag, name, codes and status;
- KPI cards: total stock, price (with cost and margin only with `inventory.costs.view`) and an equivalents placeholder;
- dimensions with the d/D diagram, technical specifications, and price and inventory;
- stock per branch with stock flags, photos and datasheet, and the Registro card.

Every field carries an icon that shows its data type.

**Agreed scope:**
- Add `stock_thresholds` and `created_by_id`/`updated_by_id` on products.
- Tariff code, supplier and sectors are read from `attributes` when present, otherwise hidden. Online-store visibility is hidden until the Web epic.
- New `rs-data-field` component for the field icons.
- The Equivalentes and Movimientos tabs are visible with a "próximamente" state; the Equivalencias card is hidden until HU-INV-04.
- Editar and Ajustar stock are gated by permission and show the toast.

**Dependency:** HU-INV-02 adds `products.country_id` and wires "Ver detalles". Build HU-INV-02 first. If it is not merged, this story reads the industry from the brand and the plan must be rebased.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| Data, measurements, photos, price and stock per branch | Int test: `GET /inventory/products/:id` returns identity, dimensions, attributes with their definitions, photos, price and per-branch stock (sum of the branch's warehouses) plus thresholds. Page spec renders each section. E2E opens 6205-2RS from the list and sees "Stock por sucursal" with the totals matching the list |
| Industry with its flag and brand with its logo | Page spec: `rs-flag` for the product country (falling back to the brand's), brand logo or text media (decision #38). E2E checks the flag |
| Each field carries an icon indicating its data type | Domain spec: `fieldIconOf(type, unit, key)` mapping. `rs-data-field` spec: icon rendered with `aria-hidden` and the label still read. Page spec: every `rs-data-field` has an icon |
| Cost and margin are visible only with `inventory.costs.view` (design notes) | Int test: cost and margin are absent from the response without the permission (Sales and Cashier roles). Page spec hides the "Costo (restringido)" field |

## Model
Migration **`product_sheet_thresholds_and_authorship`**:
- New `StockThreshold` → table `stock_thresholds`: `id`, `company_id`, `product_id`, `branch_id`, `min_stock Int?` (`@map`), `max_stock Int?`, `location String?`, `created_at`, `updated_at`; `@@unique([productId, branchId])`, `@@index([companyId, branchId])`. Add it to `TENANT_MODELS`.
- `Product`: `createdById String? @map("created_by_id") @db.Uuid`, `updatedById String? @map("updated_by_id")`, with relations to `User` (`onDelete: SetNull`).
- Seed (`seed-catalog.ts`):
  - thresholds for the demo products per branch (min 6 / max 60, location `A-03-2`, like Figma);
  - **bearing `attribute_definitions`** from design-notes (series, minimum radius r, bore type, seal, internal clearance, rows, materials, cage, tolerance class, dynamic load C, static load C₀, limiting speed, temperature, lubricant) with type and unit;
  - demo `attributes` values for a few bearings.
- No migration conflict. Only `init` and `inventory_catalog_foundation` are on disk; HU-INV-02's `product_country_of_origin` must go in first, so generate this migration after it.

## Domain (`libs/domain/src/lib/product-catalog.ts`, plus spec)
- `ProductDetail` response type: identity, `country`, `brand`, `category`/`subcategory`, `dimensions`, `specs: ProductSpec[]` (`{ key, label, type, unit, value }` ordered by definition step), `pricing: { salePrice; cost?; marginPercent? }`, `stockByBranch: { branchId; branchName; quantity; minStock; maxStock; location; availability }[]`, `totalStock`, `photos`, `datasheetUrl`, `createdBy`/`updatedBy` with dates.
- Pure `marginPercent(salePrice, cost)` using `Decimal` (`money.ts`): `(price − cost) / price × 100`, rounded to 1 decimal, null when there is no cost or the price is 0.
- Pure `stockAvailability(quantity, minStock)` → `'available' | 'low' | 'out'`, shared with the list mapper (today it is inline in `product-list.mapper.ts`).
- Pure `fieldIconOf(field)` → `IconName`-compatible string: codes → `barcode`, `hash` for SKU, diameters → `diameter`, lengths → `ruler`, weight → `package`, money → `currency`, percent → `percent`, date → `calendar`, warehouse location → `warehouse`, ENUM → `tag`, TEXT → `info`, NUMBER → `hash`. The icon names already exist in `libs/ui/src/lib/icon/icons.ts`.

## API (`apps/api/src/modules/inventory`)
| Method | Route | Permission | Errors |
|---|---|---|---|
| GET | `/inventory/products/:id` | `inventory.products.view` | 404 `PRODUCT_NOT_FOUND`, 400 `INVALID_ID` (ParseUUIDPipe) |

- `ProductsService.detail(id)` (read side, next to `list`):
  - Loads through `prisma.tenant` with brand, country, category/parent, dimensions and the category's attribute definitions (falling back to the parent's).
  - Gets stock as a `stockLevel.groupBy` by warehouse→branch and joins the thresholds.
  - Restricts branches to those the membership can operate (reuses the `assertBranchAccess` logic; `allBranches` sees all).
  - Includes `cost` and `marginPercent` only when `cls` permissions include `inventory.costs.view`.
- Read-only: no audit, no outbox.
- `created_by_id`/`updated_by_id` are set by the HU-INV-02 duplicate (and later 06/07). Update HU-INV-02's `ProductCommandsService` if it is already built.

## ERP screens
- Route `/inventory/products/:id` → `ProductSheetPage` (`features/inventory/products/sheet/product-sheet.page.*`), with child routes `''` (Datos), `equivalents` and `movements`. The last two use `rs-empty-state-illustrated` with "Disponible próximamente".
- `products.page`: "Ver detalles" navigates to the sheet (replaces the toast from HU-INV-02). Clicking the code in the row also navigates there, if ProductTable already emits a row click.
- Page header: breadcrumb Inicio / Inventario / Productos / {code}, title "Rodamiento 6205-2RS", `rs-status-pill`, subtitle "{subcategoría} · {marca} · registrado el {fecha} por {usuario}". Buttons "Editar" (`inventory.products.edit`) and "Ajustar stock" (`inventory.adjustments.create`) show the toast.
- Reused `libs/ui`: PageHeader, Tabs/Tab, Flag, FieldMedia/ChipMedia (brand mark), ProductThumb, StatusPill, Skeleton, EmptyStateIllustrated, Button, Icon, CanDirective, Toast.
- **New `libs/ui` components** (they exist in Figma, but not in code yet):
  - `rs-kpi-card` (Figma `KpiCard`): label, mono value and note. It is the first use of the component.
  - `rs-stock-flag` (Figma `StockFlag`, Low/None): extracted from `product-table.component.html` and reused there.
  - `rs-data-field` (**not in Figma**): icon, label and value, with a `mono` variant. It needs adding to the Design System file; flag it in `docs/ui-library.md` Status as "estimated".

  Each new component gets separate ts/html/scss/spec files, a showcase entry in `/design-system` and an export from `src/index.ts`.
- Sections are plain feature-level cards (a surface card with tokens), unless a Figma `Card` component turns up when checking the frame during build.
- The d/D diagram is a small inline SVG in the feature, drawn with tokens and `aria-hidden`; the values are in the fields.
- States: skeleton while loading, a 404 empty state ("Producto no encontrado" with "Volver a productos"), an error state with retry and a 403 no-permission state, following the patterns in `products.page`.
- Datasheet "Descargar" is a plain link to `datasheetUrl`; it is hidden when the product has no datasheet.

## Tests
- **Unit (domain):** `marginPercent`, `stockAvailability` and `fieldIconOf`.
- **Unit (ui):** `kpi-card`, `stock-flag`, `data-field` specs; `product-table` spec still green after the StockFlag extraction.
- **Unit (erp):** sheet page spec with states (loading, 404, 403, error, ready), cost hidden without the permission, flag fallback and header buttons by permission; mapper spec.
- **Integration (real Postgres)** `products.service.int.spec.ts`:
  - The detail aggregates stock per branch across warehouses with the thresholds.
  - Tenant isolation (another company's product → 404).
  - No cost without the permission.
  - Branch restriction for a member with limited branches.
  - Specs ordered by definition with the parent-category fallback.

  No stock writes here, so no concurrency test is needed.
- **E2E** `apps/erp-e2e/src/product-sheet.spec.ts`: from the list, use the row menu "Ver detalles" on 6205-2RS. Check the header, flag, KPI total = sum of "Stock por sucursal", the field icons, and that the Movimientos tab shows the placeholder.

## Open decisions used with defaults
- #38: no brand logo → brand name text in the media slot.
- #52: the bearing attribute definitions are the sample list from `design-notes.md`; they live in data (`attribute_definitions`) and are not hardcoded.
- Min and max per branch are data (`stock_thresholds`), never constants. The demo values come from the seed only.

## Risks and doubts
- `rs-data-field` has no Figma counterpart: the design team must add it, or the client must confirm the icon criterion.
- The seed's bearing attribute definitions overlap with HU-INV-06, which will reuse them. Whoever builds 06 must extend this seed, not duplicate it.
- Tariff code, supplier and sectors come from `attributes` keys (`tariffCode`, `supplierName`, `sectors`) until Purchasing and Web define their real sources.
- `products.page.ts` and `inventory.routes.ts` are touched by both HU-INV-02 and 03; build them in order.

## Files expected to change
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_product_sheet_thresholds_and_authorship/`, `apps/api/prisma/seed-catalog.ts`
- `apps/api/src/common/prisma/tenant.extension.ts` (`StockThreshold`)
- `apps/api/src/modules/inventory/{products.controller.ts, products.service.ts, products.service.int.spec.ts}` (and `product-commands.service.ts` for created_by if HU-INV-02 is built)
- `libs/domain/src/lib/{product-catalog.ts, product-catalog.spec.ts}`
- `libs/ui/src/lib/{kpi-card,stock-flag,data-field}/*`, `libs/ui/src/lib/product-table/product-table.component.{html,scss}`, `libs/ui/src/lib/erp-components.ts`, `docs/ui-library.md`
- `apps/erp/src/app/features/design-system/sections/*` (showcase)
- `apps/erp/src/app/features/inventory/{inventory.routes.ts, products/products.page.ts, products/product-list.mapper.ts, products/products-api.service.ts, products/sheet/*}`
- `apps/erp-e2e/src/product-sheet.spec.ts`
- `docs/plans/HU-INV-03.md` (after approval)

## Verification
`pnpm nx affected -t lint typecheck test`, the API integration suite against Postgres, `pnpm db:seed`, then the Playwright E2E. Visually compare `/inventory/products/:id` with IN-02a and the new components in `/design-system` with Figma.
