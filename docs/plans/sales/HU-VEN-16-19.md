# HU-VEN-16 + HU-VEN-19 · Quotes and quote → order with stock reservation (VP-07, VP-08, VP-09, VP-18) — plan

## Context
HU-VEN-19 asks to turn a quote into an order that reserves stock. Today no quote can be created: HU-VEN-16/17/18 are Pending, and only the tables exist (`Quote`, `QuoteItem`, `SalesOrder`, `SalesOrderItem`, from `sales_foundations`). So, as decided in planning, **HU-VEN-16 and HU-VEN-19 are planned together on one branch, `feat/hu-ven-16-19`**. The POS already counts available stock as `quantity − reserved` (`availableQuantity` in `libs/domain/src/lib/pos-cart.ts`, `PosPaymentService.assertAvailable`), and a test already checks that reserved units cannot be sold. What is missing is the code that writes `StockLevel.reserved`. Sending a quote (HU-VEN-17), expiry/renewal (HU-VEN-18) and dispatch (HU-VEN-20) are left out.

**Decisions taken in planning (7 Nov 2026):**
- 16 and 19 go on one branch.
- If any line has less available stock than it asks for, the whole conversion is refused (`409 INSUFFICIENT_STOCK`, listing each short product and what is available). There is no partial reservation.
- Quotes in `DRAFT` or `SENT` can be converted. Converting fires `accept` (→ `ACCEPTED`). This adds `DRAFT: { accept }` to `quoteMachine`.
- Decision #13 (default): stock is reserved only in the order's branch, in one of its warehouses. Selling from another branch is not supported.

**Branch base:** this checkout has HU-VEN-14 uncommitted (`schema.prisma`, `state-machine.ts`, `libs/domain/src/index.ts`, plus a migration `20261107155756_…`). Cut `feat/hu-ven-16-19` from `feat/hu-ven-14` once 14 is committed (or from `feat/hu-ven-12-13`, then rebase). The new migration timestamp must come after `20261107155756`.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| 16 · Quote list with status | Int `quotes.int.spec.ts`: `GET /sales/quotes` returns number, customer, date, validity, total and status, newest first, paged, with filters for status and search (number or customer). Tenant isolation is tested. Page spec: the columns render and the status shows as `rs-status-pill` in Spanish, with loading, empty, empty-for-filters, error and no-permission states. |
| 16 · New quote with search, quantities and validity | Int: `POST /sales/quotes` with a customer and lines creates `COT-000001` in `DRAFT`. The server takes `unitPrice` from `Product.price`, never from the client, computes totals with the customer discount and the rounding mode (`cartTotals`), and sets `validUntil` to the La Paz today + `sales.quoteValidityDays` when the client does not send it. A date in the past is refused with `QUOTE_VALIDITY_IN_PAST`, and inactive products with `PRODUCT_INACTIVE`. Concurrent creates get different numbers. Page spec: search adds lines, the qty stepper changes the line, the validity is pre-filled, and the total preview matches the server. |
| 19 · Order list | Int `sales-orders.int.spec.ts`: `GET /sales/orders` returns number, customer, source quote number, branch/warehouse, total, status and created at, with filters and paging. Page spec: the same set of states as the quote list. |
| 19 · The order is born from the quote | Int: `POST /sales/quotes/:id/convert { warehouseId }` creates `PED-000001` with `quoteId`. It copies the lines (price, quantity, sort order) and the quote's totals, and moves the quote to `ACCEPTED`, all in one transaction. A quote that is `ACCEPTED`, `EXPIRED`, `REJECTED` or past its `validUntil` gets `409 QUOTE_NOT_CONVERTIBLE`. Converting twice (also concurrently) creates exactly one order. The order detail and the quote detail link to each other. |
| 19 · Reserved stock is no longer available to others | Int (real Postgres): after conversion, `StockLevel.reserved` grows by each line's quantity and `quantity` stays the same. A POS sale of the reserved units fails with `INSUFFICIENT_STOCK`, and the POS search shows the lower availability. A second order for the same units is refused. **Concurrency:** two conversions racing for the last units → only one succeeds and `reserved` is never more than `quantity`. A sale racing a conversion → only one gets the units. A conversion with one short line reserves nothing (rollback). With `inventory.allowNegativeStock = true` the availability check is skipped, as in the POS. |
| (needed) Cancelling releases the reservation | Int: `POST /sales/orders/:id/cancel` → `CANCELLED`, `reserved` drops by `reservedQuantity − dispatchedQuantity` and never below 0. Cancelling twice has no further effect. Without this, a reservation could never be released (see risks). |

## Model
Migration `<ts>_sales_order_totals` (timestamp after `20261107155756`):
- `sales_orders`: add `subtotal`, `discount_type`, `discount_value`, `discount_amount`, `rounding_amount`, `total`, the same columns as `quotes`, all `Decimal(14,2)` copied from the quote. Add `cancelled_at` (timestamptz, nullable).
- `sales_order_items`: add `line_total` `Decimal(14,2)` and `sort_order` Int default 0.
- Index `sales_orders (company_id, quote_id)`. Exactly one order per quote is enforced by locking the quote row (`FOR UPDATE`) plus the state machine, not by a unique index, so HU-VEN-18 renewals stay open.
- No new tables. `TENANT_MODELS` already lists all six models. `QuoteStatus` and `SalesOrderStatus` enums already exist.
- Permissions `sales.quotes.manage` and `sales.orders.manage` already exist and are seeded in the sales role. No new keys.

## Domain (`libs/domain`)
- `state-machine.ts`: `quoteMachine.DRAFT` gets `accept: 'ACCEPTED'` (spec updated). `salesOrderMachine` is unchanged.
- New `sales-documents.ts` (+ spec) with shared contract types: `QuoteListQuery/Item/Response`, `QuoteDetail`, `CreateQuoteInput`, `SalesOrderListQuery/Item/Response`, `SalesOrderDetail`, `ConvertQuoteInput`. Pure helpers:
  - `quoteDefaultValidUntil(today, days)` (La Paz date; reuse the existing La Paz day helper from `sale-history.ts`/`kardex.ts`).
  - `isQuoteConvertible(status, validUntil, today)`.
  - `reservationShortfalls(lines, levels)`: one entry per short product, with the requested and available quantity (uses `availableQuantity`).
  - `releasableQuantity(item)` = `max(0, reservedQuantity − dispatchedQuantity)`.
- Totals reuse `cartTotals` (`pos-cart.ts`) and `applyCustomerDiscount` (`sales-pricing.ts`). Numbering reuses `nextDocumentNumber(tx, companyId, 'quote' | 'order')` (`apps/api/src/modules/sales/document-sequence.ts`).

## API
Sub-folders `apps/api/src/modules/sales/quotes` and `…/orders`, registered in `sales.module.ts`. Errors use `{ status, code, message, details }`.

| Method · route | Permission | Errors |
|---|---|---|
| `GET /sales/quotes` | `sales.quotes.manage` | — |
| `GET /sales/quotes/:id` | `sales.quotes.manage` | `QUOTE_NOT_FOUND` |
| `POST /sales/quotes` | `sales.quotes.manage` | `CUSTOMER_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `PRODUCT_INACTIVE`, `QUOTE_EMPTY`, `QUOTE_VALIDITY_IN_PAST`, `INVALID_QUANTITY` |
| `GET /sales/quotes/product-search?q&warehouseId` | `sales.quotes.manage` | `WAREHOUSE_NOT_FOUND` |
| `GET /sales/quotes/customers?q` | `sales.quotes.manage` | — |
| `POST /sales/quotes/:id/convert` `{ warehouseId }` | `sales.orders.manage` | `QUOTE_NOT_FOUND`, `QUOTE_NOT_CONVERTIBLE`, `WAREHOUSE_NOT_FOUND`, `WAREHOUSE_INACTIVE`, `INSUFFICIENT_STOCK` (`details.items[] {productId, requested, available}`) |
| `GET /sales/orders` · `GET /sales/orders/:id` | `sales.orders.manage` | `SALES_ORDER_NOT_FOUND` |
| `POST /sales/orders/:id/cancel` `{ reason }` | `sales.orders.manage` | `SALES_ORDER_NOT_FOUND`, `INVALID_TRANSITION` |

Services:
- `QuotesService` (list/detail/create). Product search and customer search work without a cash shift. Pull the search query out of `PosCatalogService` into a shared function that takes `warehouseId`, so the stock column is the warehouse's available stock and cost is never returned (HU-TRV-02). Customer search reuses `CustomersService`.
- `StockReservationService` in `apps/api/src/modules/inventory`, next to `stock-movement.service.ts`, as the **only writer of `StockLevel.reserved`**. It has `reserve(tx, warehouseId, lines)` and `release(tx, warehouseId, lines)`. Locks are taken in the same order as `PosPaymentService.assertAvailable`: each product row, then its level, `FOR UPDATE`, with lines **sorted by product id** to avoid deadlocks. A missing level means 0 available. The update is `reserved = reserved + n`, guarded by `reserved >= 0`. It honours `inventory.allowNegativeStock`. Its doc comment explains that reservations are not kardex movements: `quantity` does not change.
- `SalesOrdersService.convert`, in one `prisma.tenant` transaction: lock the quote `FOR UPDATE` → check status and validity → check the warehouse belongs to the company, is active, and gives the branch → `nextDocumentNumber('order')` → reserve (all lines, or throw with all shortfalls) → create the order and its items with `reservedQuantity = quantity` → `quoteMachine.transition('accept')`. Audit `quote.accepted` and `sales-order.created`, then `OutboxService.publish('sales-order.created', …, { tx })`.
- `cancel`: lock the order, apply `salesOrderMachine.transition('cancel')`, release `releasableQuantity` for each line, audit `sales-order.cancelled` with the reason, and publish `sales-order.cancelled`.
- `create` quote: audit `quote.created`.

## ERP screens (`apps/erp/src/app/features/sales`)
Before building, confirm in Figma (`JYULL6jvXiwNP8UVvEF7tl`) that the frames map as expected: VP-07 quote list, VP-08 new quote, VP-09 order list, VP-18 convert / order detail.
- `quotes/quotes.page` (VP-07): `rs-page-header`, filters (`rs-input` search, `rs-select` status), `rs-doc-table`, `rs-status-pill`, `rs-row-menu` ("Ver cotización", "Convertir en pedido" only when convertible and the user has `sales.orders.manage`), `rs-pagination`, `rs-empty-state`, `rs-skeleton`.
- `quotes/quote-form.page` (VP-08): customer picker (reuse the customer search pattern of `customers/`), product search with result rows and a branch-stock hint (`rs-stock-flag`), lines with `rs-qty-stepper`, a validity date field, a totals block, and `rs-button`, `rs-toast`.
- `quotes/quote-detail.page`: read-only lines and totals, a "Convertir en pedido" action, and a link to its order.
- `quotes/convert-quote.modal` (VP-18): `rs-modal` with a warehouse `rs-select` (warehouses of the user's branch, main warehouse preselected), a per-line available-vs-requested table, an `rs-note` explaining the reservation, and `INSUFFICIENT_STOCK` rendered on the short lines.
- `orders/sales-orders.page` (VP-09) and `orders/sales-order-detail.page`: lines with reserved and dispatched quantities, a link to the quote, and "Anular pedido" with a reason (`rs-modal` + `rs-textarea`).
- Routes go in `sales.routes.ts`, behind `sales-permission.guard.ts`. The `quotes` and `orders` tabs already exist in `sales-tabs.ts`. API errors are translated to Spanish in the ERP.
- Missing `libs/ui` components: none expected. If the VP-08/VP-18 frames show a quote line that is not `rs-pos-cart-line` / `rs-doc-table`, build it in `libs/ui` first (`.ts`/`.html`/`.scss`/spec) and give the reason in the PR.

## Tests
- **Unit (domain):** `quoteMachine` DRAFT→ACCEPTED, refused transitions, `isQuoteConvertible`, `quoteDefaultValidUntil` across a La Paz midnight, `reservationShortfalls`, `releasableQuantity`.
- **Integration (real Postgres):** `quotes.int.spec.ts`, `sales-orders.int.spec.ts`, and `stock-reservation.int.spec.ts`. The last covers concurrent conversions on the last unit, a sale racing a conversion, two conversions of the same quote, a rollback with one short line, a cancel releasing exactly once, and tenant isolation. Extend `pos-sale.int.spec.ts` so its reserved fixture goes through a real order instead of a direct `update` (`pos.int-fixture.ts:187`).
- **ERP:** page specs for the four screens and the modal (states, permissions, error mapping).
- **E2E (Playwright):** login → new quote (customer, 2 products, validity) → convert to order in the main warehouse → order list shows `PED-…` → the POS shows the lower available stock for that product.
- Run the `stock-auditor`, `ui-checker` and `reviewer` agents before closing.

## Open decisions used with a default value
- #13 · Reserve only in the order's branch: the warehouse must belong to the user's branch. This is not a setting, because the opposite (reserving + transferring) would need a new flow, and the decision default is "no".
- #12 · `sales.quoteValidityDays` = 7, an existing setting, used for the default `validUntil`.
- `sales.allowPartialDispatch` is not touched (HU-VEN-20).

## Risks and doubts
- **Cancelling orders** is not in the HU-VEN-19 criteria, but without it reservations can never be released. It is included as a small cancel action; drop it at approval if you want it in another story.
- There is no automatic expiry job: a `SENT` quote past `validUntil` is refused at conversion but still shows `SENT` in the list until HU-VEN-18. The list shows "Vencida" from `validUntil` for display only.
- Quote editing (a DRAFT) and sending are out of scope (HU-VEN-17/18).
- The order keeps the quote's prices, even if `Product.price` changed since.
- HU-VEN-14 is in flight in this checkout and touches the same files (see below), so this branch must start after 14 is committed.

## Files expected to change
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_sales_order_totals/`
- `libs/domain/src/lib/state-machine.ts` (+spec), `libs/domain/src/lib/sales-documents.ts` (+spec), `libs/domain/src/index.ts`
- `apps/api/src/modules/sales/quotes/**`, `apps/api/src/modules/sales/orders/**`, `apps/api/src/modules/sales/sales.module.ts`
- `apps/api/src/modules/inventory/stock-reservation.service.ts` (+int spec), `apps/api/src/modules/inventory/inventory.module.ts`
- `apps/api/src/modules/sales/pos/pos-catalog.service.ts` (search extracted), `pos.int-fixture.ts`, `pos-sale.int.spec.ts`
- `apps/erp/src/app/features/sales/quotes/**`, `apps/erp/src/app/features/sales/orders/**`, `apps/erp/src/app/features/sales/sales.routes.ts`
- `apps/erp-e2e/**` (new flow), `docs/backlog/sales.md` (status of 16 and 19)

## Verification
`pnpm nx affected -t lint typecheck test` (including the Postgres int specs). Then the E2E flow, and a manual check in the ERP: create a quote, convert it, and confirm the POS can no longer sell the reserved units.

## After approval
Save this plan as `docs/plans/sales/HU-VEN-16-19.md` (same folder as the other sales plans; leave it uncommitted), then run `/story-build HU-VEN-16 HU-VEN-19` in a fresh session.
