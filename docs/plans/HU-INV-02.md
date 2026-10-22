# Plan · HU-INV-02 · Product row actions (IN-01c, IN-19)

## Context
HU-INV-01 shipped the product list with a RowMenu whose items (Ver detalles, Editar, Duplicar, Ajustar stock, Eliminar) all call `comingSoon()` (`apps/erp/src/app/features/inventory/products/products.page.ts:120-130, 333`). HU-INV-02 makes these actions work from the list.

**Agreed scope:** wire every item. Build **Duplicate** in full (IN-19 modal and endpoint; this also covers most of HU-INV-08). Build **Delete** with a confirmation and a guarded endpoint. **View / Edit / Adjust stock** keep the "próximamente" toast until HU-INV-03, 07 and 16 add their screens. The copy's industry is stored on the product (`products.country_id`).

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| View, edit, duplicate, adjust stock and delete reachable from the list, by permission | `products.page.spec.ts`: menu items per permission set; each key triggers its handler (view/edit/adjust show the toast, duplicate opens the modal, delete opens the confirmation). E2E opens the menu and sees the 5 items |
| Duplicate asks for a new code | `products-duplicate.service.int.spec.ts`: an existing code+brand gives 409 `DUPLICATE_MANUFACTURER_CODE`; the modal spec shows "Código nuevo" as required and the inline error on 409 |
| Duplicate lets me choose the industry, with flag | Int test: the copy stores the chosen `countryId` and the list returns that country; modal spec: the Industria select shows the flag; E2E: duplicate 6205-2RS → country JP → the new row shows the JP flag |
| Delete is blocked when the product has history (proxy until HU-INV-16) | Int test: a product with `stock_levels` rows gives 409 `PRODUCT_HAS_STOCK`; one without them is deleted and audited |

## Model
Migration **`product_country_of_origin`**:
- `Product.countryId String? @map("country_id") @db.Uuid` with relation `country Country?` (`onDelete: SetNull`), `@@index([companyId, countryId])`; back-relation `products` on `Country`.
- Backfill in SQL: `UPDATE products p SET country_id = b.country_id FROM brands b WHERE b.id = p.brand_id;`
- `Product` is already in `TENANT_MODELS`; no new tables.
- `seed-catalog.ts`: set `countryId` from the brand on create.
- No conflicts: only `init` and `inventory_catalog_foundation` exist; no other local branches (remote `feat/hu-inv-01-fixes` is already merged).

## Domain (`libs/domain/src/lib/product-catalog.ts`, plus spec)
- `ProductCopyPart = 'dimensions' | 'specifications' | 'price' | 'media' | 'equivalences'`, `DEFAULT_COPY_PARTS` = dimensions, specifications, price (as in Figma).
- `DuplicateProductRequest { manufacturerCode; brandId; countryId: string | null; copy: ProductCopyPart[] }` and `DuplicateProductResponse { id; sku }`.
- Pure `buildDuplicate(source, request)` returns the create payload. It copies name, category and unit. It copies `attributes` only with `specifications`, dimensions only with `dimensions`, and salePrice and cost only with `price` (otherwise `0.00`, and HU-INV-06's missing-price warning applies later). It copies photos and datasheet only with `media`. Status is always ACTIVE and stock is never copied.
- `formatSku(prefix, n)` / `parseSkuNumber(sku, prefix)` → `RL-000001` (decision #32).
- `ProductListItem.country` now comes from `product.country`, falling back to `brand.country`.

## API (`apps/api/src/modules/inventory`)
| Method | Route | Permission | Errors |
|---|---|---|---|
| POST | `/inventory/products/:id/duplicate` | `inventory.products.edit` | 404 `PRODUCT_NOT_FOUND`, 400 `VALIDATION_FAILED`, 422 `BRAND_NOT_FOUND` / `COUNTRY_NOT_FOUND`, 409 `DUPLICATE_MANUFACTURER_CODE` |
| DELETE | `/inventory/products/:id` | `inventory.products.delete` (new key, "Eliminar productos"; Warehouse and Management get it through the existing prefix rules) | 404 `PRODUCT_NOT_FOUND`, 409 `PRODUCT_HAS_STOCK` |

- New `ProductCommandsService` (keeps the read-only `ProductsService` untouched except for the country change in `list`/`buildWhere`: `countryId` filter → `OR [{countryId}, {countryId: null, brand: {countryId}}]`).
- Duplicate runs in `prisma.tenant.$transaction`:
  1. Load the source.
  2. Validate the brand and country.
  3. Take `pg_advisory_xact_lock(hashtext(company_id || ':sku'))`, read the max SKU and create the next one.
  4. Create the product and its dimensions.
  5. Write `AuditService.log({ action: 'inventory.product.duplicate', entity: 'Product', entityId, before: { sourceId }, after }, tx)`.

  Prisma `P2002` on `(companyId, brandId, manufacturerCode)` maps to `DUPLICATE_MANUFACTURER_CODE`.
- Delete: in a transaction, lock the product row (`SELECT … FOR UPDATE`). Block if any `stock_levels` row exists (the movements check is added by HU-INV-16), otherwise delete it (dimensions cascade). Audit `inventory.product.delete` with `before`.
- Outbox: no consumer exists for product events, so nothing is published (justified, not skipped by accident).
- DTOs with class-validator in `dto.ts`, using the controller's pipe pattern with error code `VALIDATION_FAILED`.

## ERP screens
- **IN-01c:** `products.page` `(rowAction)` → `onRowAction(key, row)`:
  - `duplicate` opens `DuplicateProductDialog`.
  - `delete` opens the confirmation modal.
  - `view`, `edit` and `adjust` show the `comingSoon()` toast.

  Delete is gated by `inventory.products.delete`, Adjust by `inventory.adjustments.create`. Check that `rowAction` emits the row id; if not, extend `ProductTable`'s output to `{ key, rowId }`.
- **IN-19:** `apps/erp/.../products/duplicate-product.dialog.{ts,html,scss,spec.ts}` (feature component, reactive form), built from:
  - `rs-modal` (variant form), heading "Duplicar producto", description "Crea una copia de {code} · {brand}…".
  - `rs-field` + `rs-input-group` with a barcode icon for "Código nuevo *", hint "Debe ser único para la marca."
  - `rs-select` for "Marca *" with brand media, and for "Industria (país de origen)" with a flag. Defaults: source brand and product country.
  - `rs-filter-chip` toggles under "Qué copiar". "Equivalencias" is disabled until HU-INV-13.
  - `rs-note` info: "El stock no se copia / La copia empieza en 0…".
  - Buttons "Cancelar" and "Crear copia" (brand, plus icon, loading state).
  - On 409, show an inline error on the code field. On success: toast "Copia creada: {sku}" and reload the list. The redirect to `/inventory/products/:id/edit` arrives with HU-INV-07.
- Delete confirmation: `rs-modal` variant confirmation, "¿Eliminar {code}?", danger button "Eliminar". On 409, show the toast "No se puede eliminar: tiene stock registrado. Desactívalo en su lugar."
- `ProductsApi`: `duplicate(id, body)` and `remove(id)`.
- **Possible `libs/ui` gap:** `SelectOption` has no media (flag/brand) for the option list and the selected value, which the Figma Select shows with FieldMedia. Extend `SelectOption` with an optional `media?: { type: 'flag' | 'brand'; country?; text? }` rendered with the existing `rs-field-media`, instead of creating a new component. Verify against the Figma Select variant first.

## Tests
- **Unit:** `product-catalog.spec.ts` (`buildDuplicate` per copy part, `formatSku` / `parseSkuNumber`); `permissions` snapshot including the new key; dialog spec (validation, defaults, chip toggles, 409 mapping); page spec (menu → handler); select spec if the media is added.
- **Integration (real Postgres)** `product-commands.service.int.spec.ts`, using the setup of `products.service.int.spec.ts`:
  - The duplicate copies only the chosen parts, has stock 0, writes the audit row and is isolated per tenant (it cannot duplicate another company's product → 404).
  - The duplicate code gives 409.
  - **Concurrency:** 5 parallel duplicates get 5 distinct consecutive SKUs, and 2 parallel duplicates with the same code give one success and one 409.
  - Delete is blocked when stock_levels exist, succeeds otherwise, and is audited.
  - The list's industry filter uses the product's country.
- **E2E** `apps/erp-e2e/src/products.spec.ts`: open the menu, duplicate with a new code and country JP, see the new row and flag. Delete that copy and check it disappears.

## Open decisions used with defaults
- #32 SKU format `RL-` + 6 digits: the prefix is passed to `formatSku` from a single constant. A per-company settings table does not exist yet; see risks.
- #38: brands without a logo show their text in the media slot.

## Risks and doubts
- No per-company settings table exists, so the SKU prefix cannot be made per-company yet. I propose a constant now and a move to settings with HU-INV-06, which owns decision #32. Raise it if you want the settings table here instead.
- "Delete blocked if it has movements": `stock_movements` doesn't exist yet. Until HU-INV-16 adds it, any `stock_levels` row is used as the proxy.
- Not copying the price leaves `sale_price = 0.00`.

## Files expected to change
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_product_country_of_origin/`, `apps/api/prisma/seed-catalog.ts`
- `apps/api/src/modules/inventory/{products.controller.ts, products.service.ts, dto.ts, inventory.module.ts, product-commands.service.ts, product-commands.service.int.spec.ts, products.service.int.spec.ts}`
- `libs/domain/src/lib/{product-catalog.ts, product-catalog.spec.ts, permissions.ts}`
- `apps/erp/src/app/features/inventory/products/{products.page.ts, .html, .spec.ts, products-api.service.ts, product-list.mapper.ts, duplicate-product.dialog.*}`
- Possibly `libs/ui/src/lib/select/*` and `libs/ui/src/lib/product-table/*` (row id in the action output)
- `apps/erp-e2e/src/products.spec.ts`
- `docs/plans/HU-INV-02.md` (after approval)

## Verification
`pnpm nx affected -t lint typecheck test`, the integration suite against Postgres, then the Playwright E2E on the seeded demo catalog.
