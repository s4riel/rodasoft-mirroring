# Plan · HU-INV-05 · Movements and stock-per-warehouse tabs on the product sheet (IN-22, IN-23)

## Context
On the product sheet, Warehouse needs to trace the product's inflows and outflows and see its stock per warehouse.
- HU-INV-03 left the **Movimientos** tab as a "próximamente" placeholder.
- HU-INV-05 adds:
  - the immutable **`stock_movements`** table, which is the base of the kardex (HU-INV-24) and of all stock writes (HU-INV-16);
  - a read endpoint, the Movimientos tab (IN-22, Figma `262:49367`);
  - a new **Stock por almacén** tab (IN-23, Figma `262:49432`).

**Agreed scope:**
- Model and read only. The demo movements come from the seed, matching `stock_levels`. The write path (`StockMovementService`, locking, no negative stock) stays in HU-INV-16.
- `stock_thresholds` moves from per branch to **per warehouse**, as IN-23 shows.
- IN-23 is a **fourth tab**, `stock`. The Figma frame must be updated to show it.
- HU-INV-02's delete guard becomes the real HU-INV-09 rule: "blocked if it has movements".

**Dependencies:** HU-INV-03 is merged in `main`. HU-INV-04 is in progress on `feat/hu-inv-04` with uncommitted changes to the sheet routes, the KPIs and the seed. Build HU-INV-05 on top of 04 after it is merged. Generate the migration after `20261022213618_product_equivalences`.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| Movements tab | E2E: 6205-2RS → "Movimientos" → KPIs "Entradas (30 días)", "Salidas (30 días)" and "Saldo actual" (= sum of `stock_levels`), and a table with Fecha, Documento, Tipo, Cant. (signed), Saldo, Sucursal, newest first. Int test: the endpoint returns movements ordered and paginated, the 30-day sums, and `balanceAfter` consistent per warehouse |
| Stock per warehouse tab | E2E: tab "Stock por almacén" → one row per warehouse that has stock or thresholds, with Sucursal, Almacén, Ubicación, Stock, Mín., Máx., and a footer "Total N uds". Int test: the per-warehouse rows, the thresholds join, and the branch restriction for a member with limited branches |
| Movements are immutable (design-notes rule 3) | Int test: `UPDATE` and `DELETE` on `stock_movements` raise the trigger error |
| Delete is blocked if it has movements (HU-INV-09 rule, replacing HU-INV-02's proxy) | Int test: a product with movements gives 409 `PRODUCT_HAS_MOVEMENTS`; one with only zero-quantity levels and no movements is deleted |

## Model
Migration **`stock_movements_and_warehouse_thresholds`**:
- New enum `StockMovementType`: `PURCHASE_RECEIPT`, `SALE`, `TRANSFER_OUT`, `TRANSFER_IN`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `INITIAL`, `RETURN`.
- New `StockMovement` → table `stock_movements`:
  - `id`, `company_id`, `product_id`, `warehouse_id`, `type`;
  - `quantity Int` (signed) and `balance_after Int` (the warehouse balance after the movement);
  - `unit_cost Decimal(14,4)?`, `reason String?`, `ref_type String?`, `ref_id String?`;
  - `ref_number String?`: the denormalized document number for display ("V-00231"), because the source documents don't exist yet;
  - `user_id` → users (nullable for seed/system), `created_at timestamptz`.

  Indexes: `@@index([companyId, productId, createdAt(sort: Desc)])` and `@@index([companyId, warehouseId, productId, createdAt])`. FKs `RESTRICT`. Add the model to `TENANT_MODELS`.
- SQL trigger `stock_movements_immutable`: `BEFORE UPDATE OR DELETE … RAISE EXCEPTION`.
- `StockThreshold`:
  - add `warehouse_id`, backfilled to each branch's `is_main` warehouse, falling back to the first warehouse by code;
  - drop `branch_id` and its unique;
  - new `@@unique([productId, warehouseId])` and `@@index([companyId, warehouseId])`.
- `Product.stockMovements` back-relation. The `stock_levels` FK stays `RESTRICT`.
- Seed (`seed-catalog.ts`):
  - for each demo product and warehouse, write a short movement history (purchase receipt, transfer, sale, adjustment, with `ref_number`) whose last `balance_after` equals the seeded `stock_levels.quantity`;
  - thresholds per warehouse, matching IN-23 (A-03-2 6/60, V-01-1 2/6, …).

  The seed writes levels and movements directly, since it is a fixture. The runtime rule "only `StockMovementService` writes stock" starts in HU-INV-16.

## Domain (`libs/domain/src/lib/stock.ts`, plus spec, exported)
- `STOCK_MOVEMENT_TYPES` and `movementDirection(type)` → `'IN' | 'OUT'`.
- `ProductMovementItem { id, date, type, documentLabel, quantity, balanceAfter, branch: {id, name}, warehouse: {id, name} }`.
- `ProductMovementsResponse { items, total, page, pageSize, summary: { inLast30Days, outLast30Days, currentBalance } }`.
- `ProductWarehouseStockItem { branch, warehouse, location, quantity, minStock, maxStock, availability }` and `ProductWarehouseStockResponse { items, total }`.
- Pure `summarizeMovements(movements, now, days = 30)`. The 30-day window is computed in `America/La_Paz` using `libs/domain` date helpers if they exist, otherwise a small helper with the offset.
- `stockAvailability` (from HU-INV-03) is reused per warehouse.
- `documentLabel(refType, refNumber)` → "Venta V-00231", "Transferencia TR-0045", "Ajuste AJ-0012", "Compra OC-0088". The Spanish labels for refType live in the ERP mapper, not in domain; domain returns only `{ refType, refNumber }`.

## API (`apps/api/src/modules/inventory`)
| Method | Route | Permission | Errors |
|---|---|---|---|
| GET | `/inventory/products/:id/movements?page&pageSize&branchId` | `inventory.products.view` | 404 `PRODUCT_NOT_FOUND`, 400 `INVALID_ID`/`INVALID_FILTER`, 403 `BRANCH_NOT_ALLOWED` |
| GET | `/inventory/products/:id/stock` | `inventory.products.view` | 404 `PRODUCT_NOT_FOUND`, 400 `INVALID_ID` |

- New read service `StockQueriesService`, the home for kardex reads in HU-INV-24:
  - Movements through `prisma.tenant`, restricted to the warehouses of branches the membership may operate (reuse the `assertBranchAccess` logic from `ProductsService`).
  - The summary uses two `aggregate` calls (sum of positive and of negative quantities, `created_at >= now − 30 d`). The current balance is the sum of `stock_levels`.
  - Per-warehouse stock: `stock_levels` left-joined with `stock_thresholds` on (product, warehouse), with warehouse and branch names. Warehouses with neither stock nor thresholds are omitted.
  - `unit_cost` is never returned.
- **HU-INV-03 change:** `ProductsService.detail` builds "Stock por sucursal" by summing the per-warehouse thresholds per branch (min and max summed; location shows the main warehouse's).
- **HU-INV-02 change:** `ProductCommandsService.remove` blocks with 409 `PRODUCT_HAS_MOVEMENTS` when any movement exists, and keeps `PRODUCT_HAS_STOCK` when a level has quantity ≠ 0. Otherwise it deletes the zero levels, the thresholds and the product in the same transaction, as before, with an audit entry.
- Read-only endpoints: no audit, no outbox.

## ERP screens
- `product-sheet.routes.ts`:
  - `movements` → `ProductMovementsTab` (`sheet/movements/…`);
  - new child `stock` → `ProductStockTab` (`sheet/stock/…`);
  - a fourth tab label "Stock por almacén" in the sheet page tabs.
- **IN-22:** three `rs-kpi-card` ("Entradas (30 días)" "+26", "Salidas (30 días)" "−6", "Saldo actual" "27 uds"), the heading "Movimientos de {code}", then `rs-doc-table` (from HU-INV-04) with these columns:
  - Fecha `es-BO`, in `America/La_Paz`;
  - Documento;
  - Tipo "Entrada"/"Salida";
  - Cant. (mono, signed);
  - Saldo (mono);
  - Sucursal.

  Then `rs-pagination` and the note "Historial completo en Kardex, con filtros por sucursal, tipo y fechas." (the Kardex link arrives with HU-INV-24). Empty state "Sin movimientos registrados".
- **IN-23:** a `rs-doc-table` with Sucursal, Almacén, Ubicación, Stock (with `rs-stock-flag`), Mín., Máx., and the note "Total N uds · el stock se mueve entre sucursales solo con transferencias." Empty state when the product has no stock rows.
- States for both tabs: skeleton, error with retry, 403 and empty, following the HU-INV-03 sheet tabs.
- `ProductsApi`: `movements(id, page)` and `stockByWarehouse(id)`.
- `api-error.ts`: the Spanish message for `PRODUCT_HAS_MOVEMENTS` is "No se puede eliminar: tiene movimientos de stock. Desactívalo en su lugar."
- No new `libs/ui` components: KpiCard, DocTable, StockFlag, Pagination, EmptyStateIllustrated and Skeleton are all reused.

## Tests
- **Unit (domain):** `movementDirection`, `summarizeMovements` (the window edge at the La Paz day boundary, IN/OUT sums), availability per warehouse.
- **Unit (erp):** movements tab spec (KPIs, signed quantities, date formatting, document label per refType, states); stock tab spec (rows, totals, stock flag, states); sheet page spec with the 4 tabs.
- **Integration (real Postgres)** `stock-queries.service.int.spec.ts`:
  - movements ordered and paginated;
  - 30-day summary;
  - current balance = sum of levels;
  - branch restriction;
  - tenant isolation;
  - the immutability trigger on UPDATE and DELETE;
  - per-warehouse thresholds join;
  - the migration backfill (a threshold per branch lands on the main warehouse).

  Updated tests:
  - `products.service.int.spec.ts`: branch thresholds are aggregated from warehouses.
  - `product-commands.service.int.spec.ts`: delete with movements gives 409 `PRODUCT_HAS_MOVEMENTS`, and a product without movements is deleted.

  There are no stock writes at runtime, so no concurrency test; the concurrency tests belong to HU-INV-16.
- **E2E** `apps/erp-e2e/src/product-movements.spec.ts`: list → Ver detalles 6205-2RS → Movimientos (KPIs plus the first row) → Stock por almacén (rows and the Total matching the KPI on Datos).

## Open decisions used with defaults
- None of #32–#52 applies directly.
- The 30-day window comes from Figma ("Entradas (30 días)"). It is a parameter of `summarizeMovements` with a default of 30, exposed as an optional `days` query param, so it isn't hardcoded in the API.

## Risks and doubts
- Changing thresholds to per warehouse goes against `design-notes.md` (`stock_thresholds: productId, branchId`). The design notes must be updated in this story, and HU-INV-27 (restock below minimum) must aggregate per branch.
- The fourth tab is not in Figma. The design needs updating, and the client should confirm.
- `ref_number` is denormalized. When sales, purchases and transfers exist, they must fill it when they write movements through `StockMovementService` (HU-INV-16 and later).
- Rebase risk: HU-INV-04 touches the same sheet routes, KPIs, seed and `inventory.module.ts`. Build after it is merged.

## Files expected to change
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_stock_movements_and_warehouse_thresholds/`, `apps/api/prisma/seed-catalog.ts`
- `apps/api/src/common/prisma/tenant.extension.ts` (`StockMovement`)
- `apps/api/src/modules/inventory/{inventory.module.ts, products.controller.ts or stock.controller.ts, stock-queries.service.ts, stock-queries.service.int.spec.ts, products.service.ts, products.service.int.spec.ts, product-commands.service.ts, product-commands.service.int.spec.ts}`
- `libs/domain/src/lib/{stock.ts, stock.spec.ts}`, `libs/domain/src/index.ts`
- `apps/erp/src/app/core/api-error.ts`
- `apps/erp/src/app/features/inventory/products/{products-api.service.ts, sheet/product-sheet.routes.ts, sheet/product-sheet.page.*, sheet/movements/*, sheet/stock/*, sheet/product-placeholder.tab.ts}`
- `apps/erp-e2e/src/product-movements.spec.ts`
- `docs/inventory/design-notes.md` (thresholds per warehouse, 4th tab)
- `docs/plans/HU-INV-05.md` (after approval)

## Verification
`pnpm nx affected -t lint typecheck test`, the API integration suite against Postgres (including the migration backfill), `pnpm db:seed`, then the Playwright E2E. Visually compare both tabs with IN-22 and IN-23.
