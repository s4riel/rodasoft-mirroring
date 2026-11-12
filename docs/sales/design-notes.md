# Sales and POS · design notes

Context for `docs/backlog/sales.md` (HU-VEN). Written 3 Nov 2026 from the Sheet, the Inventory code already built and `docs/implementation-plan.md`. Screens are the `VP-xx` frames of the Figma ERP file `JYULL6jvXiwNP8UVvEF7tl`.

## Scope

- In: cash register, POS, payments, sales history, cancellations, returns, quotes, orders, prices and discount rules, the approvals inbox.
- Out (other epics): real SIAT issuing, contingency and invoice cancellation in SIAT (HU-FAC), customer CRM (HU-CRM), accounts receivable (HU-CON-03), reports (HU-REP).
- Bridge to SIAT: completing a sale writes an `Invoice` row in status `PENDING` (first state of the existing `invoiceMachine`) and publishes `sale.completed` through `OutboxService.publish(…, { tx })`. The SIAT epic consumes that event. No SIAT call is made from the sale transaction.

## Proposed data model (block 0)

Every table has `company_id`; business queries go through `prisma.tenant`. Tables are plural snake_case, models singular PascalCase.

| Model | Purpose |
| ----- | ------- |
| `Customer` | Name, document type and number (NIT validated with `libs/domain/src/lib/nit.ts`), e-mail, phone, `creditEnabled` (bool, decision #53), `discountType` (`NONE`, `PERCENT`, `AMOUNT`) and `discountValue` (`Decimal`, decision #5, HU-VEN-37). Minimal on purpose; HU-CRM-01 extends it |
| `PosCheckout`, `PosCheckoutItem` | Server-side cart before the sale exists: cashier, shift, customer, lines with `sort_order`, pending payments. Backs QR payments awaiting confirmation, cart recovery after a refresh and held sales (HU-VEN-30) |
| `CashRegister` | A physical register, linked to a branch and a `SiatPointOfSale` |
| `CashShift` | One open→close period of a register: opening float, opened/closed by and at, counted amounts, difference, review status |
| `CashMovement` | Manual income/expense with reason; sale payments also post here |
| `CashCount` | Closing count by denomination |
| `Sale`, `SaleItem` | Number per company and series (row-locked counter, never in memory), customer, branch, warehouse, shift, status, totals, rounding, the customer discount applied (type, value and amount, copied at sale time); `sort_order` per line (HU-VEN-33) |
| `SalePayment` | Method (`CASH`, `QR`, `CARD`, `TRANSFER`, `CREDIT`), amount, change, reference, provider status; credit adds `dueDate` |
| `Invoice` | Minimal: sale link, number, status (`invoiceMachine`, starts at `PENDING`), totals, customer tax data. Extended by HU-FAC |
| `Quote`, `QuoteItem` | Validity date, status, send log |
| `SalesOrder`, `SalesOrderItem`, `Dispatch`, `DispatchItem` | Reservation, partial dispatch and invoicing |
| `SaleReturn`, `SaleReturnItem` | Returned lines, refund method, linked credit note record |
| `PriceChange` | Audit of single and bulk price edits (old, new, user, batch id) |
| `ApprovalRequest` | Generic: `type` (`CANCELLATION`, `CASH_DIFFERENCE`, `RETURN`), subject id, requester, decision, comment |

There is no `DiscountRule` model: discount rules (HU-VEN-28) were retired in favour of the per-customer discount.

Do not add a second price column: there is one price per product and company (`Product.price`).

## Permissions

All keys already exist in `libs/domain/src/lib/permissions.ts`: `sales.pos.use`, `sales.cash-register.open`, `sales.cash-register.review`, `sales.quotes.manage`, `sales.orders.manage`, `sales.discounts.apply`, `sales.discounts.approve`, `sales.cancellations.request`, `sales.cancellations.approve`, `sales.returns.manage`, `sales.prices.edit`. Add only what a story needs (for example the approvals inbox view, or `sales.customers.manage` for HU-VEN-37) and seed it in the default roles. `sales.discounts.apply` and `sales.discounts.approve` are no longer used by any story (manual discounts were retired); leave them unassigned instead of removing them. Sales roles must not get `inventory.costs.view` (HU-TRV-02).

## State machines (`libs/domain/src/lib/state-machine.ts`)

Document state changes only through these, audited with `AuditService`.

- Cash shift: `OPEN → CLOSED → (APPROVED | OBSERVED)`.
- Checkout: `OPEN → PAYING → COMPLETED`, plus `ON_HOLD` (back to `OPEN` on resume) and `ABANDONED`. Completing it creates the `Sale` in the same transaction.
- Sale: `COMPLETED → CANCELLATION_PENDING → CANCELLED` (rejected: back to `COMPLETED`). A sale only exists once paid; everything before payment lives in `PosCheckout`.
- Approval request: `PENDING → APPROVED | REJECTED`.
- Quote: `DRAFT → SENT → (ACCEPTED | EXPIRED | REJECTED)`; an expired quote can be renewed into a new validity date.
- Order: `OPEN → PARTIALLY_DISPATCHED → DISPATCHED`, plus `CANCELLED`; releasing a reservation happens on cancel. Converting a quote moves it to `ACCEPTED` (from `DRAFT` or `SENT`); cancelling the order does not reopen the quote, a new quote is made instead.
- `StockLevel.reserved` is written only by `StockReservationService` (apps/api inventory); any stock removal refuses to leave less than `reserved` (unless negative stock is allowed).

## Stock rules

- Stock changes only through `StockMovement` rows plus the `StockLevel` update in the same transaction (see `libs/domain/src/lib/stock.ts` and `kardex.ts`). A completed sale writes a negative movement with `refType = "SALE"`, `refId`, `refNumber` ("V-00231").
- Concurrency: lock the `StockLevel` rows (`SELECT … FOR UPDATE`, ordered by product id to avoid deadlocks) before checking availability. Available = `quantity - reserved`. Negative stock follows `inventory.allowNegativeStock`.
- Orders reserve with `StockLevel.reserved`; dispatch converts the reservation into a movement. A cancellation or return writes a positive movement back to the sale's warehouse.
- Run the `stock-auditor` agent on every story in blocks B, F and G.

## Money and rounding

- `Decimal` from `libs/domain/src/lib/money.ts`, never `number`. Totals are recomputed on the server; the POS total is only a preview.
- Customer discount (decision #5, HU-VEN-37): one pure function in `libs/domain`, `applyCustomerDiscount(total, type, value)`. `PERCENT` takes a percent of the total; `AMOUNT` takes a fixed Bs amount off the whole sale; the result never goes below 0. The POS, quotes and orders all use it. The cashier cannot change it.
- Line order (HU-VEN-33): `sort_order` is rewritten by `PUT /sales/pos/checkout/items/order` under the cart row lock; quotes save `sort_order = index`; every copy (cart → sale, quote → order → dispatch) keeps it.
- Line measures and type (HU-VEN-36): read live from the product (`sales-line-spec.ts` in `apps/api`, `salesLineSpecText` in `libs/domain`), never copied to the document.
- Rounding (decision #54) is a setting `sales.roundingMode`: `NONE` (default), `INTEGER` or `HALF_BOLIVIANO` (Bs 0.50), applied after the customer discount. One function in `libs/domain` is used by the POS, quotes and the bulk price update (HU-VEN-27, 35).
- Cash change is computed from the rounded total.

## Payments

- `PaymentProvider` interface in `apps/api` with a manual/mock adapter: `charge(amount) → pending`, a confirmation call or webhook, `cancel`. QR (#6) and card (#8) real adapters come later. Webhooks and charges are idempotent (`Idempotency-Key`).
- Cash: no provider. Credit (HU-VEN-34): needs `Customer.creditEnabled` and a NIT; the unpaid amount is stored on `SalePayment` with `dueDate` (a CHECK keeps `due_date` set exactly when the method is `CREDIT`) until accounts receivable exists. A credit sale is always a single `CREDIT` payment for the whole total, writes no `cash_movements` row, and publishes `sale.completed` with a `credit` block (customer, amount, due date) for HU-CON-03.
- Credit after the sale (HU-VEN-34): a return of a credit sale pays out only the money the sale collected (`splitReturnRefund`, earlier returns first); the rest is reported as `creditReduction` in `sales.return.completed` and `paidOut` says what left. A cancellation reports `creditReversal` and `customerId` in `sales.cancellation.approved`. HU-CON-03 consumes both, together with the `credit` block of `sale.completed`.
- Customer balance (HU-VEN-34): `GET /sales/customers/:id/credit-balance` (permission `sales.customers.manage`) returns what the customer owes, the overdue part and the next due date. It is derived from the sales (`creditBalance` in `libs/domain`: each `CREDIT` payment less the approved returns of that sale, zero once cancelled) and needs no table; collecting payments against it, and a screen for it, belong to HU-CON-03.
- Customer copy of a quote (HU-VEN-36, decided 12 Nov 2026): the preview and the printed copy show the measures and type under each line, because the story says the preview includes the measurements. Figma VP-08b draws the lines without them and only says "Medidas en mm" in the footnote; the footnote text is the same as Figma's.
- Before deploying migration `20261112130000_credit_payment_due_date` to a database that may hold older rows, check it can apply: `SELECT count(*) FROM sale_payments WHERE (method = 'CREDIT') <> (due_date IS NOT NULL);` must be 0.
- Mixed payment (#7) is allowed by default (`sales.allowMixedPayment`); the sum of payments must equal the total, except cash, which may exceed it by the change.

## Settings (per company, typed in `libs/domain/src/lib/company-settings.ts`)

`sales.roundingMode`, `sales.allowMixedPayment`, `sales.quoteValidityDays` (7), `sales.allowPartialDispatch` (true), `sales.cancellationWindowDays` (null), `sales.cashExpenseApprovalLimit` (null), `sales.bulkPriceRequiresApproval` (false, decision #19), `sales.creditTermDays` (`[5, 15, 30]`, decision #53). Defaults follow `docs/backlog/decisions.md`. There is no discount limit setting: the discount comes from the customer.

## Screens and API conventions

- ERP module `apps/erp/src/app/features/sales` with its own layout like `inventory-layout.page.ts`; the POS is full screen with keyboard focus (Enter adds, shortcuts), no barcode reader.
- API module `apps/api/src/modules/sales` (split into sub-folders `cash`, `pos`, `quotes`, `orders`, `pricing`, `approvals` if it grows). Errors are `{ status, code, message, details }` with English `code`s; the ERP translates them to Spanish.
- UI components come from `libs/ui` only. Missing ones (Numpad, Ticket, PosResultRow, PosCartLine, PosCustomer, Kanban-free) are built there first, each with its own `.ts`, `.html`, `.scss` and spec.
- Product search reuses the inventory search and equivalences (HU-INV-11/12); the POS adds the branch stock column.

## Screen states

Every list and form has loading, empty, error and no-permission states (HU-TRV-03). Empty and "caja cerrada" states use the Figma illustrations.

## Required tests

- Domain: rounding, discount limits, change calculation, mixed-payment sum, state machines.
- API with real Postgres: concurrent sales of the last unit (only one succeeds), sale writes stock + cash + invoice record + outbox atomically, cancellation returns stock once, order reservation blocks other sales.
- ERP: POS flow (search, add, pay in cash, receipt), register closed blocks selling.
- E2E (Playwright): login → open register → sale in cash → close register.

## As built · reorder, credit, rounding and line measures (HU-VEN-33, 34, 35, 36)

Built together on one branch (12 Nov 2026). The plan is `docs/plans/sales/HU-VEN-33-34-35-36.md`; this section is what exists now.

### API (`apps/api/src/modules/sales`)

| Method | Route | Permission | What it does | Error codes |
| ------ | ----- | ---------- | ------------ | ----------- |
| PUT | `sales/pos/checkout/items/order` | `sales.pos.use` | Body `{ itemIds }`: every line of my cart in the new order. Runs under the cart row lock and rewrites `sort_order` 0…n−1 | `CHECKOUT_ORDER_MISMATCH` (409), `CHECKOUT_NOT_EDITABLE` (while `PAYING`), `CHECKOUT_NOT_FOUND` |
| POST | `sales/pos/checkout/pay` | `sales.pos.use` | Answer gains `credit` (`available`, `reason`, `termOptions`) | — |
| POST | `sales/pos/checkout/complete` | `sales.pos.use` | Accepts `{ method: 'CREDIT', termDays }`, always alone | `CREDIT_CUSTOMER_REQUIRED`, `CREDIT_NOT_ENABLED`, `CREDIT_NIT_REQUIRED` (409), `CREDIT_TERM_INVALID` (400), `PAYMENT_METHOD_NOT_AVAILABLE` (mixed with another method), `PAYMENT_ALREADY_PENDING` (a QR or card of the cart is waiting or paid) |
| GET | `sales/customers/:id/credit-balance` | `sales.customers.manage` | What the customer owes, derived from the sales | `CUSTOMER_NOT_FOUND` |

- `GET sales/pos/checkout` (and every cart answer) gains `rounding`, the signed rounding of the total (HU-VEN-35).
- Quote detail, quote product search, order detail, sale detail and receipt lines gain `spec` (`SalesLineSpec`: measures, category, subcategory, details). The Prisma select and `toLineSpec` live in `apps/api/src/modules/sales/sales-line-spec.ts`; attribute definitions are loaded once per request.
- `SalePayment` and receipt payments gain `dueDate`; `CompletedSale` gains `dueDate` (null unless credit).
- Setting `sales.creditTermDays` (`number[]`, default `[5, 15, 30]`, seeded). A stored list that is empty or has a non-positive-integer falls back to the default; it is sorted and deduplicated.

### Events and audit

- `sale.completed` carries `credit: { customerId, amount, dueDate }` for a credit sale. The audit row `sales.sale.complete` lists the `CREDIT` payment with `termDays` and `dueDate`.
- `sales.return.completed` carries `paidOut` and `creditReduction`; `sales.cancellation.approved` carries `creditReversal` and `customerId`. Cart edits (including reorder) stay unaudited drafts.

### Domain (`libs/domain/src/lib`)

`credit-sale.ts` (`creditEligibility`, `validateCreditTerm`, `creditDueDate`, `PosCreditInfo`, `CREDIT_MAX_TERM_DAYS` = 365), `credit-balance.ts` (`creditBalance`, `creditSaleOwed`), `sales-line-spec.ts` (`formatMeasures`, `salesLineSpecText`), `pos-cart.ts` (`CartTotals.rounding`, `moveLine`, `isSameLineSet`), `sale-return.ts` (`splitReturnRefund`), `sale-receipt.ts` (`formatDay`, `formatDayShort`, `creditDueText`).

### ERP (`apps/erp/src/app/features/sales`)

- **POS (VP-03):** a handle per cart line (`rs-drag-handle` with the CDK's `cdkDragHandle`; ↑/↓ on the handle moves the line and keeps the focus). The change is optimistic and goes through the existing `mutate()`; a refusal puts the server's order back. Handles are off while an add is in flight and while paying. The shortcuts line ends with "⠿ Arrastrar para reordenar". The rounding row is "Redondeo" without a discount and "Descuento (redondeado)" with one (discount and rounding folded together, so subtotal − row = total); nothing when the rounding is zero.
- **Payment (VP-04d):** the "Crédito" chip is on only when `pay` says the customer qualifies; otherwise it is disabled with the reason as its title. `pos-credit-panel` shows the terms plus "Otro", the due date ("21 nov 2026"), "Saldo a crédito", the customer, "Sin límite" and the note. Footer "Confirmar venta a crédito" waits for a term. The cashier can go back to cash from the panel.
- **Completed sale (VP-16a), sale detail (VP-02), receipt:** a credit sale shows "Saldo a crédito" and "Vence el" instead of received and change; the detail and the ticket say "Crédito · vence dd/mm/aaaa".
- **Quote editor (VP-08):** the lines table is now "Ítems de la cotización (n)", a reorderable list of `rs-pos-cart-line` with handles and an empty state. The saved order is the list order. Second text: "Bs 245,00 c/u · {measures · type · details} · Sin existencia" (the stock is said only when it falls short).
- **Quote detail, order detail, sale detail:** measures and type under the product name (one line, cut with an ellipsis, full text as the title). **Preview and print of a quote:** the same text under each line and the footnote "Precios en Bs. Medidas en mm. {códigos} sin existencia. Sujetos a disponibilidad de stock al confirmar.".

### Tests

- Domain unit specs for every new function; API integration specs `pos-credit-payment.int.spec.ts` (atomic write, refusals, concurrency, idempotency, the CHECK, returns, cancellation, balance), reorder cases in `pos-checkout.int.spec.ts`, order and spec cases in `pos-sale`, `quotes` and `sales-order-dispatch`; ERP specs for the POS page, payment dialog, credit panel, completed dialog, quote form and detail screens; Playwright `pos-reorder.spec.ts`, `pos-credit-sale.spec.ts` and the rounding case in `pos-cash-sale.spec.ts`.
- Running the API and ERP suites at the same time overloads the local Postgres and makes unrelated suites fail on timeouts; run them one project at a time (`pnpm nx run-many -t test -p api erp --parallel=1`).

### Not done / follow-ups

- Accounts receivable (HU-CON-03): collecting payments against the balance and a screen for it. The events above and the balance endpoint are what it builds on.
- Figma: the drag handle is its own component, not part of PosCartLine; "Otro" in the credit terms is not drawn (Figma has 5/15/30/45); the quote line text includes the category, which Figma's does not (decided with the client's team on 12 Nov).
