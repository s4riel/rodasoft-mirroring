# Plan · HU-INV-24 · Kardex per product (IN-09)

## Context
Warehouse and Accounting need to see a product's kardex: inflows, outflows and the balance, filtered by warehouse and dates, where the final balance matches `stock_levels`.

**Already in `main`:**
- `stock_movements` is immutable. Each row has a signed `quantity`, `balance_after` (the balance of that warehouse), `unit_cost`, `ref_type`/`ref_number` and `user_id`, plus the index `(company_id, product_id, created_at desc)`.
- `StockQueriesService.movements` serves the product sheet's movements tab (HU-INV-05):
  - newest first, with branch scope (`scope()`);
  - no date filter and no cost;
  - its comment already says the kardex belongs in that service.
- The ERP inventory nav has `{ key: 'kardex', label: 'Kardex', disabled: true }` in `inventory-layout.page.ts`.
- **Missing:** the permission `inventory.kardex.view`. design-notes lists it, but `permissions.ts` doesn't have it.

**Read only:** no tables, no stock writes, no migration.

## Rules
- **Kardex = one product.** You can narrow it to a warehouse (default: all warehouses in the member's scope) and a date range (default: the current month, in `America/La_Paz` time).
- **Ordering:** oldest to newest (`created_at, id`), as a kardex is read.
- **Opening balance:** the stock in scope just before `from`.
  - With one warehouse, it is the last `balance_after` before `from`, or 0 if there is none.
  - With several warehouses, it is the sum over each warehouse of its last `balance_after` before `from`.
- **Balance column:**
  - one warehouse: `balance_after`;
  - all warehouses: a running total, opening balance + a SQL window `SUM(quantity) OVER (ORDER BY created_at, id)`. Each row also shows that warehouse's own `balance_after`.
- **Totals:** inflows, outflows and the closing balance. When `to` is today or later, the closing balance equals Σ `stock_levels` in scope. The int test checks this, and so do two checks in the service: one when no date filter is set, and one in dev builds.
- **Valued columns** (unit cost, value in/out, balance value): only with `inventory.cost.view`; otherwise they are left out of the response entirely.
- **Type labels** in Spanish in the domain: Compra, Venta, Salida por transferencia, Entrada por transferencia, Ajuste (+), Ajuste (−), Inventario inicial, Devolución.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| Movements with date, type, quantity and balance | Int test (real Postgres): a sequence of INITIAL, then PURCHASE, then TRANSFER_OUT, then ADJUSTMENT_OUT across 2 warehouses. `GET /inventory/kardex?productId` returns the rows in chronological order with date, type, document, warehouse, user, in, out and balance. The running balance is correct in both the one-warehouse and all-warehouse modes. The opening balance is right with `from` set. The closing balance equals `stock_levels`. Cost columns appear only with `inventory.cost.view`. Branch scope, tenant isolation, and 403 without `inventory.kardex.view`. Page spec IN-09: product picker, filters, opening/closing row, table columns, pagination, and the empty, skeleton, error and no-permission states |

## Model
No changes. The existing index `(company_id, warehouse_id, product_id, created_at)` covers the one-warehouse query, and `(company_id, product_id, created_at desc)` covers all-warehouse mode.

## Domain (`libs/domain`)
- `permissions.ts`:
  - add `'inventory.kardex.view': 'Consultar kardex'`;
  - grant it to Warehouse, Accounting and Management in the role presets (keep the existing preset style).
- New `kardex.ts`:
  - `STOCK_MOVEMENT_TYPE_LABELS`, unless an equivalent already exists for the movements tab, in which case reuse it;
  - `defaultKardexRange(now)` (current month, La Paz time);
  - `kardexValue(qty, unitCost)` with `Decimal`;
  - the response types `KardexResponse` and `KardexRow`.

## API (`StockQueriesService.kardex` + a new `kardex.controller.ts`)
| Method | Route | Permission | Errors |
|---|---|---|---|
| GET | `/inventory/kardex?productId&warehouseId?&branchId?&from?&to?&page&pageSize` | `inventory.kardex.view` | 400 `INVALID_FILTER` (from > to, range > 366 days); 404 `PRODUCT_NOT_FOUND`, `WAREHOUSE_NOT_FOUND` (also when the warehouse is out of scope) |
| GET | `/inventory/kardex/export?…` (xlsx) | `inventory.kardex.view` | the same errors |

- **Queries:**
  - **Page:** a raw `$queryRaw` with the window sum, always filtered by `company_id` (this is a raw query, so `prisma.tenant` doesn't add it automatically; follow how the HU-INV-16 numbering adds it).
  - **Opening balance:** `DISTINCT ON (warehouse_id)` the last `balance_after` before `from`.
  - **Page carry-over:** the running total for a later page needs the opening balance + Σ quantity of the earlier rows in range; the window over the full range does this before `OFFSET`/`LIMIT`.
- **Export:** reuses the existing xlsx helper from the HU-INV-10 product import/export. If none exists for writing, drop the export and keep it as a follow-up.
- **No audit or outbox:** this is a read.

## ERP (`features/inventory/kardex/*`)
**IN-09** (`/inventory/kardex`, and `?productId=` from the product sheet):
- In `inventory-layout.page.ts`, enable the `kardex` nav entry behind `*rsCan 'inventory.kardex.view'`.
- **Filters:**
  - a product search (reusing the existing product picker);
  - warehouse (`rs-select`, defaulting to "Todos los almacenes" in scope);
  - a date range (`rs-date-range`, or the existing date inputs).
- **A product header card:** code, brand, name and current stock.
- **The table** (`rs-doc-table`):
  - Fecha, Tipo (`rs-status-pill` or tag), Documento, Almacén, Usuario, Entrada, Salida, Saldo, plus Costo unit. / Valor when the member may see costs;
  - a first row "Saldo inicial" and a footer with totals and "Saldo final".
- "Exportar" (xlsx).
- A "Ver kardex" link from the product sheet's movements tab.
- **States:**
  - nothing until a product is picked ("Seleccione un producto para ver su kardex");
  - skeleton, error and no permission;
  - empty range: "Sin movimientos en el período", which still shows the opening balance.
- **Components:** existing `libs/ui` only. Check IN-09 in Figma at build time; any missing DS component goes into `libs/ui` with its own files.

## Tests
- **Unit (domain):** the default range across a month boundary (La Paz time), the value math, and the labels covering every `StockMovementType`.
- **Unit (API DTO):** the filter validation.
- **Unit (ERP):**
  - the filters reach the query params, and `productId` is read from the URL;
  - columns are hidden without cost permission;
  - the opening and closing rows;
  - the states.
- **Integration (real Postgres):**
  - running balance in both modes;
  - opening balance with `from`;
  - page 2 carry-over;
  - closing balance = `stock_levels`;
  - scope, tenant isolation (a movement from another company never appears) and 403.
  - **Concurrency:** while 20 parallel `StockMovementService.apply` calls run on the product, the kardex read afterwards has a gapless running balance whose final value equals `stock_levels`, so the history reconciles under contention.
- **E2E:** open the product sheet → "Ver kardex" → filter the warehouse → see the inflows, outflows and final balance matching the sheet's stock.

## Open decisions used with defaults
- None open. Default range = the current month; cost columns follow `inventory.cost.view`.

## Risks and doubts
- **The cost permission's name differs between files:** `permissions.ts` has `inventory.costs.view`, and design-notes says `inventory.cost.view`. Use the existing key, `inventory.costs.view`.
- **A movement's `unit_cost` can be null** (older movements, or a product with no cost). The value is shown as "—" and the balance value is left out in that case. A weighted average cost history is outside this story's scope.
- **Same-millisecond movements:** the `id` (uuid v7) breaks ties, so the order is the write order.
- **Overlaps with HU-INV-21/22:** none in files. They add the `TRANSFER_RECEIPT`/`ADJUSTMENT` ref types, which the kardex only displays.

## Files expected to change
- `libs/domain/src/lib/{permissions.ts, kardex.ts, kardex.spec.ts, index.ts}`
- `apps/api/src/modules/inventory/{stock-queries.service.ts, kardex.controller.ts, kardex.dto.ts, kardex.int.spec.ts, inventory.module.ts}`
- `apps/erp/src/app/features/inventory/{inventory.routes.ts, inventory-layout.page.ts, kardex/*, products/<sheet movements tab> (link)}`
- `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/kardex.spec.ts`
- `docs/plans/HU-INV-24.md`

## Verification
1. `pnpm nx affected -t lint typecheck test`.
2. The API int suite against Postgres.
3. Playwright.
4. Compare IN-09 against Figma.
5. Run the `reviewer`, `stock-auditor` and `ui-checker` agents.
