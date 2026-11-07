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
- Rounding (decision #54) is a setting `sales.roundingMode`: `NONE` (default), `INTEGER` or `HALF_BOLIVIANO` (Bs 0.50), applied after the customer discount. One function in `libs/domain` is used by the POS, quotes and the bulk price update (HU-VEN-27, 35).
- Cash change is computed from the rounded total.

## Payments

- `PaymentProvider` interface in `apps/api` with a manual/mock adapter: `charge(amount) → pending`, a confirmation call or webhook, `cancel`. QR (#6) and card (#8) real adapters come later. Webhooks and charges are idempotent (`Idempotency-Key`).
- Cash: no provider. Credit (HU-VEN-34): needs `Customer.creditEnabled` and a NIT; the unpaid amount is stored on `SalePayment` with `dueDate` until accounts receivable exists.
- Mixed payment (#7) is allowed by default (`sales.allowMixedPayment`); the sum of payments must equal the total, except cash, which may exceed it by the change.

## Settings (per company, typed in `libs/domain/src/lib/company-settings.ts`)

`sales.roundingMode`, `sales.allowMixedPayment`, `sales.quoteValidityDays` (7), `sales.allowPartialDispatch` (true), `sales.cancellationWindowDays` (null), `sales.cashExpenseApprovalLimit` (null). Defaults follow `docs/backlog/decisions.md`. There is no discount limit setting: the discount comes from the customer.

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
