# HU-VEN-00 · Sales foundations — plan

## Context

HU-VEN-00 is Block 0 of the Sales epic. It is a technical story: the data model, state machines, settings, payment abstraction and empty API/ERP shells that every later HU-VEN story builds on. It is the first step toward the walking skeleton for the Wave 1 review (9–13 Nov). Nothing in Sales is built yet.

**Heads-up:** the HU-VEN-00 text and the updated design notes (per-customer discount, `PosCheckout`, `PENDING` invoice status, no `DiscountRule`) exist only on the unmerged branch `docs/sales-foundations` (commit 984675a). This plan follows that version. **Merge `docs/sales-foundations` into `main` before `/story-build`**, or create `feat/hu-ven-00` from it.

Decision taken with you: **create every model from the design notes now** in one migration, so blocks E and G can run in parallel later without migration conflicts.

## Acceptance criteria → checks

| Criterion | Proof |
| --- | --- |
| Prisma models + migration, all with `company_id`, in `TENANT_MODELS` | `tenant.extension.spec.ts` (already fails for any undeclared model with `company_id`); `prisma migrate dev` applies cleanly; `sales-schema.int.spec.ts` checks the CHECK constraints and unique keys on real Postgres |
| State machines for cash shift, checkout, sale, approval, quote and order, with unit tests | `state-machine.spec.ts`: every allowed transition plus a sample of refused ones (`InvalidTransitionError`) |
| Typed `sales.*` settings with decision defaults, seeded per company | `company-settings.spec.ts` (defaults, enum/nullable fallbacks); `settings.service.int.spec.ts` reads a missing key → default; seed run is idempotent |
| `PaymentProvider` interface + idempotent mock (charge, confirm, cancel) | `mock-payment.provider.spec.ts`: same idempotency key → same `providerRef`; confirm twice is a no-op; cancel after confirm is refused |
| Pure customer discount and rounding functions | `sales-pricing.spec.ts`: PERCENT, AMOUNT, NONE, AMOUNT > total → 0, the 3 rounding modes, boundaries (x.25, x.75, x.50) |
| Empty `sales` API module and ERP `sales` layout with routes behind permissions | `SalesModule` imported in `app.module.ts` (API boots in int tests); `sales-layout.page.spec.ts` shows only the tabs allowed by the permissions; `sales.routes` guards tested like inventory's |

## Model (`apps/api/prisma/schema.prisma`)

Migration: **`<timestamp>_sales_foundations`**. No branch has unmerged migrations (checked every local branch), so no conflict.

Every table plural snake_case, columns `@map`, money `Decimal(14,2)`, `company_id` + `@@index([companyId, …])`, all added to `TENANT_MODELS` in `apps/api/src/common/prisma/tenant.extension.ts` and to `Company` relations.

Enums (mirror the `libs/domain` unions): `CustomerDiscountType` (NONE, PERCENT, AMOUNT) · `CashShiftStatus` · `CashMovementType` (INCOME, EXPENSE, SALE_PAYMENT, REFUND) · `PosCheckoutStatus` · `SaleStatus` · `PaymentMethod` (CASH, QR, CARD, TRANSFER, CREDIT) · `PaymentStatus` (PENDING, CONFIRMED, DECLINED, CANCELLED) · `InvoiceStatus` (same values as `invoiceMachine`) · `ApprovalType` (CANCELLATION, CASH_DIFFERENCE, RETURN) · `ApprovalStatus` · `QuoteStatus` · `SalesOrderStatus` · `RefundMethod` (CASH, CREDIT_NOTE).

| Model / table | Key fields |
| --- | --- |
| `Customer` / `customers` | name, `documentType` (values of `IdentityDocumentType` in `nit.ts`), `documentNumber`, complement, email, phone, `creditEnabled`, `discountType`, `discountValue` Decimal(14,2), status, created/updated by. Unique `(company_id, document_type, document_number)`. CHECK `discount_value >= 0` and `≤ 100` when PERCENT |
| `CashRegister` / `cash_registers` | branchId, `pointOfSaleId` (unique, decision #3: one register per SIAT POS), `warehouseId` (stock source for its sales), name, status |
| `CashShift` / `cash_shifts` | registerId, status, openingFloat, opened by/at, closed by/at, expected/counted/difference amounts, reviewed by/at, review note. **Partial unique index**: one `OPEN` shift per register (raw SQL in migration) |
| `CashMovement` / `cash_movements` | shiftId, type, amount, reason, refType/refId (sale payment), userId, createdAt |
| `CashCount` / `cash_counts` | shiftId, denomination Decimal, quantity; unique `(shift_id, denomination)` |
| `PosCheckout` / `pos_checkouts` + `PosCheckoutItem` + `PosCheckoutPayment` | cashier, shiftId, customerId?, status, holdLabel?; items with productId, quantity, unitPrice, `sort_order`; payments with method, amount, `idempotencyKey` (unique per company), `providerRef`, status, reference, `dueDate` |
| `Sale` / `sales` + `SaleItem` + `SalePayment` | `number` unique per company, checkoutId (unique), customerId?, branchId, warehouseId, shiftId, status, subtotal, `discountType`/`discountValue`/`discountAmount` (copied at sale time), `roundingAmount`, total; items with unitPrice, quantity, lineTotal, `sort_order`; payments with method, amount, change, reference, providerStatus, `dueDate` |
| `Invoice` / `invoices` | saleId (unique), `number` nullable (HU-FAC assigns it), status default `PENDING`, total, customer tax name/NIT/document type copied |
| `Quote` / `quotes` + `QuoteItem` | number, customerId, status, validUntil, totals, discount copy, `sendLog` Json; items with `sort_order` |
| `SalesOrder` / `sales_orders` + `SalesOrderItem` | number, customerId, quoteId?, branchId, warehouseId, status; items with quantity, reservedQuantity, dispatchedQuantity |
| `Dispatch` / `dispatches` + `DispatchItem` | orderId, number, saleId? (invoicing a dispatch), items with quantity |
| `SaleReturn` / `sale_returns` + `SaleReturnItem` | saleId, number, refundMethod, total, creditNoteInvoiceId?; items with saleItemId, quantity |
| `PriceChange` / `price_changes` | productId, oldPrice, newPrice, userId, `batchId?`, createdAt (append-only) |
| `ApprovalRequest` / `approval_requests` | type, `subjectId`, status, requestedBy, reason, decidedBy/At, comment. Index `(company_id, status, type)` |
| `DocumentSequence` / `document_sequences` | `(company_id, key)` unique, `last` BigInt. Row-locked counter for sale, quote, order, dispatch and return numbers |

Also in the migration: **drop `roles.max_discount`** (only the retired VP-13 rule used it; nothing reads it).

Number formats (`libs/domain`): `V-000231`, `COT-000012`, `PED-…`, `DSP-…`, `DEV-…`, 6 digits like `TR-`/`AJ-`.

## Domain (`libs/domain`)

- `state-machine.ts`: add `cashShiftMachine` (OPEN →close→ CLOSED →approve/observe→ APPROVED | OBSERVED), `posCheckoutMachine` (OPEN →pay→ PAYING →complete→ COMPLETED; PAYING →back→ OPEN; OPEN →hold→ ON_HOLD →resume→ OPEN; OPEN/ON_HOLD →abandon→ ABANDONED), `saleMachine` (COMPLETED ⇄ CANCELLATION_PENDING → CANCELLED), `approvalRequestMachine`, `quoteMachine` (DRAFT→SENT→ACCEPTED|EXPIRED|REJECTED; EXPIRED →renew→ SENT), `salesOrderMachine` (OPEN/PARTIALLY_DISPATCHED →dispatchPartial/dispatchAll/cancel). Same `createMachine` pattern.
- New `sales-pricing.ts`: `applyCustomerDiscount(total, type, value) → { discountAmount, totalAfterDiscount }` (never below 0); `roundSaleTotal(total, mode) → { total, roundingAmount }` with `NONE | INTEGER | HALF_BOLIVIANO`, nearest step, half up. Uses `Decimal` from `money.ts`.
- New `sales-numbering.ts`: `SALE_REF_TYPE = 'SALE'`, `formatSaleNumber`, etc., like `formatAdjustmentNumber`.
- `company-settings.ts`: add `sales.roundingMode` (`'NONE'`), `sales.allowMixedPayment` (true), `sales.quoteValidityDays` (7), `sales.allowPartialDispatch` (true), `sales.cancellationWindowDays` (null), `sales.cashExpenseApprovalLimit` (null, money string). Extend `settingOrDefault` for an allowed-values check (rounding mode) and nullable integers (current code drops `null` defaults into the generic branch).
- `permissions.ts`: remove `sales.discounts.apply` from the `cashier` default role (keys stay, unassigned, per design notes). No new keys (`sales.customers.manage` belongs to HU-VEN-37).
- Export new files from `libs/domain/src/index.ts`.

## API (`apps/api/src/modules/sales`)

- `sales.module.ts`, imported in `app.module.ts`. **No HTTP endpoints** in this story.
- `payments/payment-provider.ts`: `PaymentProvider` interface `charge({ amount, method, idempotencyKey }) → { providerRef, status: 'PENDING' }`, `confirm(providerRef, outcome: 'APPROVED' | 'DECLINED')`, `cancel(providerRef)`, plus a `PAYMENT_PROVIDERS` injection token keyed by method (QR, CARD).
- `payments/mock-payment.provider.ts`: manual/mock adapter (decisions #6, #8). `providerRef` derived from the idempotency key; repeated calls return the stored result; invalid transitions throw `PaymentProviderError` with code `PAYMENT_INVALID_STATE`. Durable idempotency comes from the unique `pos_checkout_payments.idempotency_key` used by HU-VEN-08/10.
- `document-sequence.ts`: `nextDocumentNumber(tx, companyId, key)` with `INSERT … ON CONFLICT (company_id, key) DO UPDATE SET last = last + 1 RETURNING last` (row lock, rolled-back sale leaves no gap). Reused by every later numbered document.
- `OutboxService`: rename type `sale.confirmed` → `sale.completed` (and `apps/worker/src/common/queues.ts`) to match the design notes; nothing publishes it yet.
- Seed (`apps/api/prisma/seed-base.ts`): one `CashRegister` per `SiatPointOfSale` with the branch's main warehouse; the non-null `sales.*` defaults upserted like the inventory keys.

## ERP

- `apps/erp/src/app/features/sales/sales.routes.ts` + `sales-layout.page.ts` (pattern of `inventory-layout.page.ts`, `SubNavComponent` from `libs/ui`). Replace `modulePlaceholder('sales', …)` in `app.routes.ts` with `loadChildren`.
- Tabs, each filtered with `ctx.can(…)` and its route guarded with `requiresPermission(…)`: Punto de venta (`sales.pos.use`), Caja (`sales.cash-register.open`), Ventas (`sales.pos.use`), Cotizaciones (`sales.quotes.manage`), Pedidos (`sales.orders.manage`), Precios (`sales.prices.edit`), Aprobaciones (`sales.cancellations.approve` or `sales.cash-register.review`). Labels are checked against the Figma VP frames (file `JYULL6jvXiwNP8UVvEF7tl`, page 09) during build.
- Each child route uses the existing `ModulePlaceholderPage` with the story that fills it. No new `libs/ui` component (Numpad, Ticket, PosResultRow, PosCartLine, PosCustomer are built by their own stories, in parallel).

## Tests

- Unit: `state-machine.spec.ts`, `sales-pricing.spec.ts`, `company-settings.spec.ts`, `sales-numbering` formatting, `mock-payment.provider.spec.ts`, `sales-layout.page.spec.ts`, `app.routes.spec.ts` (sales lazy route).
- Integration (real Postgres): `document-sequence.int.spec.ts`: 20 concurrent `nextDocumentNumber` calls → 20 distinct consecutive numbers; a rolled-back transaction leaves no gap. `sales-schema.int.spec.ts`: second OPEN shift on a register is refused; discount CHECKs; tenant isolation of `Customer` through `prisma.tenant`.
- E2E: one Playwright smoke in `apps/erp-e2e/src/sales-layout.spec.ts`: admin opens `/sales` and sees the tabs; cashier does not see Precios. The full skeleton E2E lands with HU-VEN-23.
- `pnpm nx affected -t lint typecheck test`. `stock-auditor` is not needed (no stock writes).

## Open decisions used with a default

#3 one register per SIAT POS (seed), float typed at opening · #5 per-customer discount (fields on `Customer`) · #6/#8 mock provider · #7 `sales.allowMixedPayment=true` · #10 `sales.cancellationWindowDays=null` · #12 `sales.quoteValidityDays=7` · #14 `sales.allowPartialDispatch=true` · #16 `sales.cashExpenseApprovalLimit=null` · #54 `sales.roundingMode=NONE`. All are settings, none hardcoded.

## Risks and doubts

- Tables for quotes, orders, dispatches and returns are designed before their stories; small column changes later are expected and fine (additive migrations).
- `HALF_BOLIVIANO` rounds to the nearest Bs 0.50, half up (Bs 10.25 → 10.50). If the client wants "always down", only `roundSaleTotal` changes.
- A renewed expired quote goes back to `SENT` with a new `validUntil`; HU-VEN-18 may refine it.
- Invoice numbering is left to HU-FAC (SIAT numbers per POS), so `invoices.number` is nullable.

## Files expected to change

- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_sales_foundations/migration.sql`, `apps/api/prisma/seed-base.ts`
- `apps/api/src/common/prisma/tenant.extension.ts`, `apps/api/src/common/outbox/outbox.service.ts`, `apps/worker/src/common/queues.ts`, `apps/api/src/app.module.ts`
- `apps/api/src/modules/sales/**` (new)
- `libs/domain/src/lib/state-machine.ts` (+spec), `company-settings.ts` (+spec), `permissions.ts`, new `sales-pricing.ts`, `sales-numbering.ts` (+specs), `libs/domain/src/index.ts`
- `apps/erp/src/app/app.routes.ts` (+spec), `apps/erp/src/app/features/sales/**` (new), `apps/erp-e2e/src/sales-layout.spec.ts` (new)

## After approval

Save this plan to `docs/plans/HU-VEN-00.md` (uncommitted), then run `/story-build HU-VEN-00` in a fresh session on a branch that contains `docs/sales-foundations`.
