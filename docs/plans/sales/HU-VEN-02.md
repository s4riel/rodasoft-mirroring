# HU-VEN-02 · Search products and build the sale — plan

**Story** (`docs/backlog/sales.md`): As a cashier, I want to search products by code, measurement or brand and add them to the sale, so that I serve the customer quickly at the counter. Screen: VP-03 (Figma `JYULL6jvXiwNP8UVvEF7tl`, node `103:10335`).

**Context**
- **Depends on HU-VEN-01.** The POS page, `GET /sales/cash-shifts/current` and `requireOpenShift` come from that story. Build this one on a branch from `develop` (`feat/hu-ven-02`) **after `feat/hu-ven-01` is merged**. It can't run in parallel with 01.
- **Already in the repo:**
  - `PosCheckout`/`PosCheckoutItem`, the server-side cart from HU-VEN-00, with `sort_order` and a `quantity > 0` check.
  - `posCheckoutMachine`.
  - `parseMeasurement` in `libs/domain/src/lib/product-catalog.ts`.
  - The exact-code-first search in `transfers.service.ts` and `stock-adjustments.service.ts`.
  - `rs-qty-stepper`, `rs-stock-flag`, `rs-filter-chip`, `rs-input` and `rs-empty-state`.
- **Two components to build:** **PosResultRow** and **PosCartLine** exist in the Figma Design System (`O7gJBRq4bMcWBGP1DMUKkw`) but not in `libs/ui`.
- **What VP-03 also shows, but other stories build:**

  | In VP-03 | Story |
  | --- | --- |
  | Customer block | 05 / 37 |
  | Eye button (technical sheet) | 04 |
  | Equivalentes | 03 |
  | Discount line | 37 |
  | "Descuento (F8)" | retired |
  | Poner en espera | 30 |
  | Cobrar | 07 |
  | Drag to reorder | 33 |
  | Sale number "V-000125" | 07 |

  This story leaves them out, or shows them disabled where noted below.

## Acceptance criteria → checks

| Criterion | Proof |
| --- | --- |
| The search shows the branch's stock | `pos-catalog.int.spec.ts`: search by code, measurement (`25x52x15`) and brand returns each product's available stock (`quantity − reserved`) in the register's warehouse, with a stock status of ok, low (below `StockThreshold.minStock`) or out. It never returns `cost`. Specs for `rs-pos-result-row` and the page show "24 en Central", the low-stock flag and "Agotado aquí" |
| I can change quantities and remove products | `pos-checkout.int.spec.ts`: add, add again (the quantity goes up on the same line), change the quantity and remove, all persisted in `pos_checkout_items`. The page spec drives the `rs-qty-stepper` and the trash button |
| The total is recalculated instantly | Unit test of `cartTotals()` with Decimal values, for example 3 × 0,10 = 0,30. The page spec: the total changes in the same tick as the click, before the API answers, and goes back if the API refuses the change |

## Model

Migration **`<ts>_pos_checkout_cart`**. It only adds constraints:
- A partial unique index `pos_checkouts_one_open_per_cashier` on `(company_id, cashier_id) WHERE status = 'OPEN'`, written as raw SQL in the migration. A cashier then has a single sale in progress, and two quick "Agregar" clicks can't create two carts.
- A unique index `pos_checkout_items_checkout_product_key` on `(checkout_id, product_id)` (`@@unique`). Adding a product that is already in the cart raises the quantity on its line instead of creating a second one.

There are no new tables or columns, and `TENANT_MODELS` stays as it is.

## Domain (`libs/domain`)

A new `pos-cart.ts`, exported from `index.ts`:
- `lineTotal(unitPrice, quantity)`.
- `cartTotals(lines, { discount?, roundingMode })` returns `{ subtotal, discount, total }` as Decimals. It reuses the HU-VEN-00 customer-discount and rounding functions, so 05, 35 and 37 only have to fill in their inputs.
- `stockStatus(available, minStock)` returns `'ok' | 'low' | 'out'`.
- `maxSellable(available, allowNegativeStock)`.

The ERP and the API use the same functions, so the instant total and the saved total always match.

There is no state change: the cart is created `OPEN` and stays `OPEN` in this story.

## API (`apps/api/src/modules/sales/pos/`)

Every endpoint needs `sales.pos.use` and calls `CashShiftsService.requireOpenShift()` first. Stock is read from the warehouse of my shift's register. Money values are decimal strings.

| Method · route | Does |
| --- | --- |
| `GET /sales/pos/categories` | Active root categories with their icon, for the Todos / Rodamientos / Retenes / Correas chips |
| `GET /sales/pos/product-search?q=&categoryId=` | Active products matched by exact code first, then by code, SKU, name, brand or measurement. Up to 20 results. Each one has the code, name, brand (name and initials), `salePrice`, `available`, `stockStatus` and the warehouse name. No cost |
| `GET /sales/pos/checkout` | My `OPEN` cart, or `null` |
| `POST /sales/pos/checkout/items` `{ productId, quantity }` | Creates the cart if it doesn't exist and adds the product, or raises its quantity. Copies `salePrice` into `unitPrice` |
| `PATCH /sales/pos/checkout/items/:id` `{ quantity }` | Changes a line's quantity |
| `DELETE /sales/pos/checkout/items/:id` | Removes a line. An empty cart stays `OPEN` |

The three write endpoints return the whole cart (lines and totals calculated on the server with `cartTotals()`).

**Error `code`s:**
- `CASH_SHIFT_NOT_OPEN` (409)
- `PRODUCT_NOT_FOUND` (404)
- `PRODUCT_INACTIVE` (409)
- `INVALID_QUANTITY` (400)
- `INSUFFICIENT_STOCK` (409, `details: { available }`), unless `inventory.allowNegativeStock` is on
- `CHECKOUT_ITEM_NOT_FOUND` (404), also returned for another cashier's line
- `CHECKOUT_NOT_EDITABLE` (409), when the cart status isn't `OPEN`

**How the writes run:**
- Each write runs in one transaction and locks my cart row (`SELECT … FOR UPDATE`), so `sort_order` and the quantity stay consistent. Creating the cart relies on the per-cashier index: on P2002 it reads the existing cart again.
- Stock is only checked, never written, and nothing is locked. HU-VEN-11 locks `StockLevel` when the sale is completed.
- Cart edits aren't audited and don't publish outbox events: they are drafts, not document state changes. HU-VEN-07 and 11 audit the sale.

**Services:** `PosCatalogService` (categories and search) and `PosCheckoutService`, registered in `SalesModule`. All queries go through `prisma.tenant`.
- The search conditions move into a shared `apps/api/src/modules/inventory/product-search-where.ts` helper that the POS uses.
- Transfers and adjustments keep their own copy for now, so this branch doesn't touch inventory services.

## ERP screens

**`/sales/pos` is full screen (VP-03).** The route is declared next to the shell in `app.routes.ts`, not inside it, so there is no sidebar. It is still guarded by `authGuard` and the POS tab permission. The HU-VEN-01 closed-register modal is kept.

**Left side:**
- Header: "Punto de venta", the line "Caja · Sucursal · Usuario", and "Salir del POS".
- `rs-input` search box with the placeholder "busca por código, medida o marca (F2)". It debounces typing by 200 ms. F2 focuses it, Enter adds the first result and Esc clears it.
- `rs-filter-chip` category chips.
- A list of `rs-pos-result-row`.
- Shortcut footer: "F2 Buscar · Enter Agregar · Esc Limpiar". Only the shortcuts that work are shown.

**Right side, "Venta actual":**
- A list of `rs-pos-cart-line`, each with an `rs-qty-stepper` and the trash button.
- Subtotal and Total. The discount row only appears when there is a discount.
- "Cobrar Bs X (F9)" is shown **disabled** until HU-VEN-07.
- Empty cart: `rs-empty-state` "Agrega productos para empezar la venta".

**Behaviour:**
- Quantity and remove changes are optimistic. The total is recalculated with `cartTotals()` on the spot, and the server's answer replaces it, or undoes it with a toast and the Spanish message for the error `code`.
- The stepper's maximum is the available stock (`maxSellable`).
- An out-of-stock product shows "Agotado aquí" and its Agregar button is disabled. The Equivalentes button arrives with HU-VEN-03.
- The cart survives a refresh because it is read again from `GET /checkout`.
- The page has states for loading, no results ("Sin resultados para «…»"), search error and no permission.

**New `libs/ui` components.** Both exist in Figma and nothing existing fits; their variants are read with `get_design_context` at build time.
- **`rs-pos-result-row`** (Figma PosResultRow):
  - Inputs: code, description, brand initials, stock label, stock level, price, and `showDetail` / `showEquivalents` (off for now).
  - Outputs: `add`, `detail`, `equivalents`.
  - The `Stock=None` variant swaps the action for Equivalentes.
- **`rs-pos-cart-line`** (Figma PosCartLine):
  - Inputs: title, unit price, `quantity` model, max, line total, and a discount label for `State=Discount`.
  - Output: `remove`.
  - The drag handle is off until HU-VEN-33.

Each one gets its own `.ts`, `.html`, `.scss` and spec, is exported from `src/index.ts`, and is added to `/design-system` and to the table in `docs/ui-library.md`.

## Tests

**Unit:**
- `pos-cart.spec.ts`: Decimal totals, stock status and the maximum.
- Specs for `rs-pos-result-row` and `rs-pos-cart-line`.
- `pos.page.spec.ts`:
  - Enter adds the first result.
  - The stepper and trash recalculate the total instantly.
  - An API error undoes the change.
  - An out-of-stock product can't be added.
  - The register-closed modal from 01 still works.

**Integration (real Postgres):**
- `pos-catalog.int.spec.ts`:
  - Search by code, measurement and brand.
  - Stock comes from the register's warehouse only.
  - The low and out statuses.
  - No `cost` in the response.
  - The category filter.
  - Tenant isolation.
  - `CASH_SHIFT_NOT_OPEN` without a shift.
- `pos-checkout.int.spec.ts`:
  - The first add creates the cart; 5 concurrent adds give exactly one cart and the summed quantity.
  - The same product raises the quantity on its line.
  - PATCH and DELETE work.
  - More than the available stock gives `INSUFFICIENT_STOCK`, but is allowed with `allowNegativeStock`.
  - Another cashier's line gives 404.
  - Server totals equal `cartTotals()`.

**E2E (`apps/erp-e2e/src/pos-cart.spec.ts`):** open the register → search "6205" → Enter → quantity 2 → the total updates → reload → the cart is still there → remove → the empty cart state.

**Agents:** the `stock-auditor` should confirm this story never writes stock. Then run `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default

None of the client decisions in `decisions.md` affect this story. The rules I picked:
- **Stock shown:** the available stock of the register's warehouse, which is what the sale will take from (decision #3: one register per point of sale, with a fixed warehouse). The label uses the warehouse name.
- **Selling more than the stock:** refused, unless `inventory.allowNegativeStock` is on. That setting already exists, so nothing new is hardcoded.
- **Price:** copied into the line when the product is added. HU-VEN-07 checks it again before payment.

## Risks and doubts

- **"The branch's stock":** if a branch has more than one warehouse, the POS shows only the register's warehouse, not the branch total. Per-branch stock appears in the product sheet (HU-VEN-04).
- **Prices:** if a price changes while a product is in a cart, the line keeps the old price until HU-VEN-07 checks it again.
- **Full-screen route:** the route moves out of the shell, so the ContextBar and `ContextStore` initialisation the shell does now must also run for the POS. This needs checking during the build.
- **Sub-menu order:** the sub-menu fix from HU-VEN-01 must already be merged, or `sales-tabs.ts` conflicts.
- **Parallel work:** the two `libs/ui` components could be built in a parallel session (only `libs/ui` files), but this story needs them, so it's simpler to keep them on the same branch.

## Files expected to change

- `apps/api/prisma/schema.prisma` (index annotations), `apps/api/prisma/migrations/<ts>_pos_checkout_cart/`
- `apps/api/src/modules/sales/pos/**` (new), `apps/api/src/modules/sales/sales.module.ts`
- `apps/api/src/modules/inventory/product-search-where.ts` (new, a helper only)
- `libs/domain/src/lib/pos-cart.ts` (+spec), `libs/domain/src/index.ts`
- `libs/ui/src/lib/pos-result-row/**`, `libs/ui/src/lib/pos-cart-line/**` (new), `libs/ui/src/index.ts`, `docs/ui-library.md`
- `apps/erp/src/app/features/design-system/**` (showcase)
- `apps/erp/src/app/app.routes.ts`, `apps/erp/src/app/features/sales/sales.routes.ts`, `apps/erp/src/app/features/sales/pos/**` and its specs
- `apps/erp-e2e/src/pos-cart.spec.ts` (new)
