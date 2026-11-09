# HU-VEN-20 · Partial dispatch and invoicing of an order (VP-19, VP-19b; decision #14) — plan

## Context
A salesperson wants to dispatch and invoice part of an order now and leave the rest pending. The tables already exist (`Dispatch`, `DispatchItem`, `SalesOrderItem.reservedQuantity/dispatchedQuantity`, from `sales_foundations`), plus `salesOrderMachine` (`dispatchPartial`/`dispatchAll`/`cancel`), the `DSP-` series and the `sales.allowPartialDispatch` setting (default true). Nothing writes them yet.

**Hard dependency:** HU-VEN-20 builds on orders, reservation and the order detail from **HU-VEN-16 + 19** (`docs/plans/sales/HU-VEN-16-19.md`), which are not built yet. `docs/plans/HU-VEN-18.md` is now only HU-VEN-17 + 18 (send, timeline, renew) on top of 16+19, so the plans no longer overlap; **HU-VEN-19 must be merged before this branch** (`feat/hu-ven-20`, cut from `develop` after 19). This plan reuses what 19 adds: `StockReservationService`, `SalesOrdersService`, `sales-documents.ts`, the `orders/` API and ERP folders.

Figma `JYULL6jvXiwNP8UVvEF7tl`, page 09: VP-19 `103:17855` (order detail), VP-19b `103:17941` ("Despachar y facturar" modal). Figma: *"Cada despacho genera su factura en el SIAT por lo entregado."*

**Decisions taken in planning (7 Nov 2026):**
- **Every dispatch is also an invoice.** It creates a `Sale` with origin `ORDER` + an `Invoice` in `PENDING`, **with no payment**: no checkout, no cash shift, no `SalePayment`. Collection happens outside the POS (accounts receivable, HU-CON-03).
- **Reservation stays all-or-nothing** (as decided in 19). Every line is fully reserved, so you can dispatch any quantity ≤ what is still reserved. Figma's "Faltan N" state (partial reservation) is not drawn.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| I choose what to dispatch and invoice now | Int `sales-order-dispatch.int.spec.ts`: `POST /sales/orders/:id/dispatches { items:[{orderItemId, quantity}] }` on PED with 12/6/4 dispatching 12/3/0 → `DSP-000001` + sale `V-…` (origin ORDER, no shift/checkout/payments) + `Invoice` PENDING for exactly those pieces. `StockLevel.quantity` −15 and `reserved` −15 (availability for others unchanged), a `SALE` kardex movement per line with `refNumber` = sale number. Order → `PARTIALLY_DISPATCHED`. Audit + outbox `sale.completed` in the same tx. Modal spec: steppers capped at what is reserved and not dispatched, live total "Se factura ahora (N piezas)", 0 pieces disables the button. |
| The balance stays pending on the order | Int: after the first dispatch, `GET /sales/orders/:id` shows per line ordered / reserved / dispatched / invoiced / pending, KPIs (Total, Reservado, Despachado, Facturado) and the list of dispatches. A second dispatch of the rest → `DISPATCHED`; `reserved` back to the pre-order value. Cancel after a partial dispatch releases only `reserved − dispatched` (19's `releasableQuantity`). Detail spec: VP-19 timeline (Creado, Reservado, Despacho parcial, Facturado, Completado), KPI cards, item table with status "Listo" / "Pendiente N". |
| Totals add up | Domain spec `dispatchTotals`: the sum of all dispatch totals equals the order total exactly (customer discount pro-rata, rounding; the last dispatch takes the remainder), PERCENT and AMOUNT discounts, every rounding mode. |
| Setting #14 | Int: with `sales.allowPartialDispatch = false`, a dispatch that does not cover everything pending → `422 PARTIAL_DISPATCH_NOT_ALLOWED`; covering everything works. Modal spec: steppers locked to the full pending quantity, with an `rs-note` saying so. |
| Guards | Int: quantity > pending reserved → `DISPATCH_EXCEEDS_RESERVED` (details per line); all zero → `DISPATCH_EMPTY`; item of another order → `ORDER_ITEM_NOT_FOUND`; order `DISPATCHED`/`CANCELLED` → `SALES_ORDER_NOT_DISPATCHABLE`; no `sales.orders.manage` → 403; other company → 404. **Concurrency:** two dispatches racing for the same reserved pieces → their sum never exceeds the reserve; a dispatch racing a cancel → one of them wins, `reserved` never below 0; a repeated `Idempotency-Key` returns the first dispatch, not a second one. |

## Model
Migration `<ts>_order_dispatch` (timestamp after 19's `<ts>_sales_order_totals`):
- New enum `SaleOrigin { POS ORDER }`. `sales.origin SaleOrigin @default(POS)`.
- `sales.checkout_id` and `sales.shift_id` become **nullable** (the unique on `checkout_id` stays; Postgres allows several NULLs). Raw SQL CHECK `sales_pos_origin_ck`: `origin <> 'POS' OR (checkout_id IS NOT NULL AND shift_id IS NOT NULL)`.
- `dispatches`: add `idempotency_key String? @map("idempotency_key")` with `@@unique([companyId, idempotencyKey])`; `@@unique([saleId])` (one sale per dispatch).
- `dispatch_items`: add `@@index([companyId, orderItemId])`.
- No new tables. `Dispatch`/`DispatchItem` are already in `TENANT_MODELS` (check). No new permission: `sales.orders.manage`.
- Business invariant kept by the service (and a raw CHECK on `sales_order_items`): `0 ≤ dispatched_quantity ≤ reserved_quantity ≤ quantity`.

## Domain (`libs/domain`)
- New `sales-order-dispatch.ts` (+spec):
  - `dispatchableQuantity(item)` = `reservedQuantity − dispatchedQuantity` (shares 19's `releasableQuantity`).
  - `validateDispatch(items, request, allowPartial)` → list of errors per line (exceeds, empty, partial not allowed).
  - `nextOrderEvent(itemsAfter)` → `'dispatchAll'` when nothing is pending, otherwise `'dispatchPartial'`.
  - `dispatchTotals(order, previousDispatches, lines, roundingMode)` → `{ subtotal, discountAmount, roundingAmount, total }`. Customer discount allocated pro-rata to the dispatch subtotal; `roundSaleTotal` per dispatch; the **last** dispatch takes the remainder so Σ = `order.total`. Uses `Decimal` (`money.ts`), `roundSaleTotal` (`sales-pricing.ts`).
  - `orderTimeline(order)` → steps for VP-19.
  - Contracts: `CreateDispatchInput`, `DispatchSummary`, and `SalesOrderDetail` extended (per-line `invoicedQuantity`, `pendingQuantity`, KPIs, `dispatches[]`).
- `salesOrderMachine` unchanged. Export from `index.ts`.

## API (`apps/api/src/modules/sales/orders/`)
| Method · route | Permission | Errors |
|---|---|---|
| `POST /sales/orders/:id/dispatches` (`Idempotency-Key` header, required) | `sales.orders.manage` | `SALES_ORDER_NOT_FOUND`, `SALES_ORDER_NOT_DISPATCHABLE`, `ORDER_ITEM_NOT_FOUND`, `DISPATCH_EMPTY`, `DISPATCH_EXCEEDS_RESERVED` (`details.items[] {orderItemId, requested, dispatchable}`), `PARTIAL_DISPATCH_NOT_ALLOWED`, `IDEMPOTENCY_KEY_REQUIRED`, `CUSTOMER_TAX_DATA_MISSING` (if `invoiceDataOf` refuses) |
| `GET /sales/orders/:id` | `sales.orders.manage` | extended with dispatches and invoiced amounts |

`SalesOrderDispatchService.dispatch`, one `prisma.tenant.$transaction`:
1. If the `Idempotency-Key` already exists → return that dispatch.
2. `SELECT … FROM sales_orders WHERE id AND company_id FOR UPDATE` (the same lock 19's `cancel` takes, so dispatch and cancel are serialised), check the status through `salesOrderMachine`, load items `FOR UPDATE`.
3. `validateDispatch` with `sales.allowPartialDispatch` (`CompanySettingsService`).
4. `nextDocumentNumber(tx, companyId, 'dispatch')` and `'sale'`.
5. Per line, **sorted by product id**: `StockReservationService.consume(tx, warehouseId, lines)` (new method on 19's service: `reserved −= n`, guarded `reserved ≥ n`) then `StockMovementService.apply` a `SALE` movement `−n` (`refType SALE`, `refNumber` = sale number, reason `Despacho DSP-… · Pedido PED-…`). Reservation goes first, so availability for other sales does not change.
6. Create `Sale` (origin ORDER, branch/warehouse/customer of the order, totals from `dispatchTotals`, discount type/value copied from the order), `SaleItem`s (unit price from the order line), `Invoice` PENDING through `invoiceDataOf(customer)` (`pos/pos-invoice-data.ts`, reused).
7. Create `Dispatch` + `DispatchItem`s with `saleId`; increase `dispatchedQuantity`.
8. `salesOrderMachine.next(status, nextOrderEvent(...))`, update the order.
9. `AuditService.log('sales.order.dispatch', …, tx)`; `OutboxService.publish('sale.completed', { saleId, origin: 'ORDER', … }, { tx })` (same event the SIAT epic consumes) and `'sales.order.dispatched'`.

Lock order: order → items → document sequences → products → stock levels, the same as the POS sale after its shift/cart. Document it next to `lockOpenShift`.

Other API impact of nullable `shiftId`/`checkoutId`:
- `sales/sales-history.service.ts` and the sale detail: an ORDER sale has no register/cashier shift; return `origin` and `order { id, number }`.
- POS code paths (`pos-payment.service.ts`, `cash-shifts.service.ts`) keep working: they always set both fields; only TS types get `string | null` where the `Sale` is read.

## ERP screens (`apps/erp/src/app/features/sales/orders/`)
- **VP-19 `sales-order-detail.page`** (built in 19, extended here): `rs-status-timeline` steps Creado / Reservado / Despacho parcial / Facturado / Completado, 4 `rs-kpi-card` (Total, Reservado "N de M piezas", Despachado, Facturado), items `rs-doc-table` with Pedido / Reservado / Despachado / Facturado / Estado ("Listo" success, "Pendiente N" warning), a dispatches section (DSP number, date, pieces, total, link to the sale `V-…`), `rs-note` info "Se puede despachar y facturar por partes…" (hidden when the setting is false). Actions: "Cancelar pedido" (19), "Imprimir orden de despacho", "Despachar y facturar" (only with `sales.orders.manage` and status OPEN/PARTIALLY_DISPATCHED).
- **VP-19b `dispatch-order.dialog`**: `rs-modal`, title "Despachar y facturar", subtitle "PED-… · elige cuánto se entrega hoy", one row per pending line with `rs-qty-stepper` (min 0, max = dispatchable, default = dispatchable), caption "N reservadas", "Se factura ahora (N piezas)" + total preview (`dispatchTotals`, server total wins), `rs-note` warning "Las N piezas faltantes quedan en el pedido" when something remains, buttons "Cancelar" / "Despachar y emitir factura". Generates an `Idempotency-Key` when it opens; errors are shown on their line.
- **`sales-order-print.page`** ("Imprimir orden de despacho"): letter `rs-receipt` with the pending lines (code, product, quantity, warehouse) + `window.print()`, like `receipt-print.page`.
- Sale detail (`history/sale-detail.page`): an ORDER sale shows "Pedido PED-…" (link) instead of register/shift.
- Spanish messages for every new code in `core/api-error.ts`.
- `libs/ui`: no new component expected (`rs-status-timeline` is built on `feat/hu-ven-18` (HU-VEN-18); if that is not merged yet, take it from there).

## Tests
- **Unit (domain):** `sales-order-dispatch.spec.ts` — validation, `nextOrderEvent`, `dispatchTotals` (sum = total exactly over 1, 2 and 3 dispatches, PERCENT/AMOUNT, rounding modes), timeline.
- **Integration (real Postgres):** `sales-order-dispatch.int.spec.ts` (extend `pos.int-fixture.ts` with an order created through 19's real convert): partial then complete, kardex + reserve + sale + invoice + audit + outbox atomic, rollback when one line fails (nothing written), setting off, idempotency, **concurrency** (two dispatches of the last reserved pieces; dispatch vs cancel; dispatch vs POS sale of the free stock of the same product → no deadlock, totals consistent), tenant isolation, 403. `sales-schema.int.spec.ts`: CHECK `sales_pos_origin_ck` refuses a POS sale without a shift. `sales-history.int` case: an ORDER sale appears in the history with its order number.
- **ERP:** detail page spec (timeline, KPIs, statuses, permissions, states), dialog spec (caps, total, setting off, error mapping), print page spec.
- **E2E** `apps/erp-e2e/src/sales-order-dispatch.spec.ts`: order from a quote (fixture) → Despachar y facturar with one line reduced → detail shows Despacho parcial and pending pieces → second dispatch → Completado; "Ventas realizadas" shows the two sales.
- Agents: `stock-auditor` (required: reserve + kardex), `ui-checker`, `reviewer`. Then `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default value
- **#14** `sales.allowPartialDispatch` = true (existing setting, read per company). With false, a dispatch must cover everything pending.
- **#13** (from 19): stock leaves only from the order's warehouse.

## Risks and doubts
1. **Depends on HU-VEN-19** (orders, reservation, order detail, `StockReservationService`), which is not built; HU-VEN-18 only adds the timeline component on top of it.
2. **Sales without payment:** ORDER sales do not post to any cash shift and do not count in the register closing (HU-VEN-23). Their collection waits for HU-CON-03. Reports must tell them apart through `origin`.
3. **SIAT point of sale:** a POS sale gets it from the shift's register; an ORDER sale has none. The SIAT epic will have to pick the branch's point of sale. Noted in the outbox payload (`branchId`).
4. **Cancelling an ORDER sale (HU-VEN-14)** returns its stock as **free** stock (not re-reserved) and does not change the order's `dispatchedQuantity`. Acceptable for now; revisit with returns (HU-VEN-21).
5. "Faltan N" (partial reservation) is not supported, per the decision.
6. Figma shows "Despachado" and "Facturado" as separate columns; here they are always equal (dispatch = invoice). Both are rendered to follow the design.
7. "Imprimir orden de despacho" is a small extra page that no criterion asks for; drop it at approval if you prefer.

## Files expected to change
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_order_dispatch/`
- `libs/domain/src/lib/sales-order-dispatch.ts` (+spec), `libs/domain/src/lib/sales-documents.ts` (contracts from 19), `libs/domain/src/index.ts`
- `apps/api/src/modules/sales/orders/**` (dispatch service, controller, dto, errors, int spec), `apps/api/src/modules/inventory/stock-reservation.service.ts` (`consume`)
- `apps/api/src/modules/sales/sales/sales-history.service.ts`, `apps/api/src/modules/sales/pos/pos-payment.service.ts` (types only), `pos.int-fixture.ts`, `sales-schema.int.spec.ts`
- `apps/api/src/common/outbox/outbox.service.ts` (`sales.order.dispatched` type), `apps/worker/src/common/queues.ts` (route)
- `apps/erp/src/app/features/sales/orders/**`, `apps/erp/src/app/features/sales/history/sale-detail.page.*`, `apps/erp/src/app/features/sales/sales.routes.ts`, `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/sales-order-dispatch.spec.ts`, `docs/backlog/sales.md` (status of 20)

Overlaps with HU-VEN-14 (in flight here: `sales-history.service.ts`, `sale-detail.page.*`, `api-error.ts`, `outbox.service.ts`, `queues.ts`, `schema.prisma`) and with 16-19 / 18 (`orders/**`, `sales-documents.ts`, `state-machine.ts`).

## Verification
Int specs against local Postgres (including the concurrency cases), ERP specs, Playwright E2E. Manual: convert a quote to an order, dispatch part of it, check the kardex (`SALE` −n), the POS availability (unchanged for the free stock), the new sale in "Ventas realizadas" with its PENDING invoice, then dispatch the rest and see Completado. Finish with `pnpm nx affected -t lint typecheck test`.

## After approval
Save to `docs/plans/HU-VEN-20.md` (uncommitted), then run `/story-build HU-VEN-20` in a fresh session on `feat/hu-ven-20`, cut from `develop` after HU-VEN-19 is merged.
