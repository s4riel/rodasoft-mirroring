# HU-VEN-07 + HU-VEN-11 · Cash payment and completing the sale — plan

**Stories** (`docs/backlog/sales.md`), planned and built together on one branch:
- **HU-VEN-07:** As a cashier, I want to charge in cash and see the change to return, so that I avoid change errors. Screen VP-04 (Figma `JYULL6jvXiwNP8UVvEF7tl`, node `103:10778`).
- **HU-VEN-11:** As a cashier, I want to complete the sale and get the invoice even if SIAT does not respond, so that the sale is never blocked. Screen VP-16a (node `103:11081`). VP-16b (contingency) belongs to HU-FAC.

**Context**
- **Depends on HU-VEN-05.** 01–04 are merged into `develop`. HU-VEN-05 is in progress on `feat/hu-ven-05`, and it touches `pos-cart.ts`, `pos/**`, `pos.page.*` and `schema.prisma`. The sale also copies 05's customer tax data. Build this on **`feat/hu-ven-07-11`**, cut from `develop` **after 05 is merged**.
- **Already in the repo:**
  - `PosCheckoutService` and its cart lock.
  - `posCheckoutMachine` (`OPEN →pay→ PAYING →back→ OPEN`, `PAYING →complete→ COMPLETED`).
  - `PosCheckoutPayment`, with a unique `idempotencyKey` per company.
  - `cartTotals`, `applyCustomerDiscount` and `roundSaleTotal`.
  - `nextDocumentNumber` (`V-` series, row-locked counter).
  - `StockMovementService.apply` (locks the stock level row).
  - `OutboxService`: `sale.completed` is already routed to a worker queue.
  - `FINAL_CONSUMER` (HU-VEN-05).
  - `rs-modal`, `rs-filter-chip`, `rs-button`, `rs-note` and `rs-toast`.
- **Figma:**
  - **VP-04** shows a "Cobrar venta" modal with:
    - "Total a cobrar"
    - payment method chips: Efectivo / QR / Tarjeta / Transferencia / Crédito / Mixto
    - "Montos rápidos" (Exacto / next round amounts)
    - a Recibido / "Cambio a devolver" card
    - a numeric keypad with a "Monto recibido" display
    - "Cancelar" / "Confirmar cobro (Enter)"
  - **VP-16a** shows a "Venta completada" modal with:
    - the number · customer · date · branch line
    - total / received / change
    - a Note
    - "Imprimir ticket" / "WhatsApp" / "Correo"
    - "Ver venta" / "Nueva venta (Enter)"
  - Read the exact details with `get_design_context` at build time.

## Acceptance criteria → checks

| Criterion | Proof |
| --- | --- |
| 07 · I enter the received amount with a numeric keypad | `rs-numpad` spec: digits, a single comma, at most 2 decimals, backspace. Payment modal spec: tapping 1-2-0-0 shows "Bs 1.200,00", and the physical keyboard also types |
| 07 · The change is calculated | `cash-payment.spec.ts`: `cashChange` from the **rounded** total; `suggestCashAmounts(1111)` = `[1150, 1200, 1500]`. Modal spec: total 1.111,00 and received 1.200 show "Bs 89,00" |
| 07 · Confirming with less than the total is not allowed | Domain: `validateCashTendered` returns `INSUFFICIENT_CASH`. Modal spec: confirm is disabled. Int test: the API returns 409 `INSUFFICIENT_CASH` even if the UI is bypassed |
| 11 · On payment, stock is deducted and the cash register is updated | `pos-sale.int.spec.ts`, all in one transaction:<br>• a negative `SALE` stock movement (`refType` "SALE", `refId`, `refNumber` "V-…")<br>• a `CashMovement` `SALE_PAYMENT` with the cash net of change<br>• `Sale`, `SaleItem`s and a `SalePayment` with its change<br>• an `Invoice` in `PENDING`<br>• the checkout `COMPLETED`<br>• an audit row and the outbox `sale.completed`<br>A forced failure rolls all of it back |
| 11 · With SIAT online the invoice is valid with QR / offline it goes to contingency | **Out of scope** (the story's scope note): the sale writes the `Invoice` as `PENDING` and the SIAT epic issues it. Int test: `PENDING` with the customer's tax data, or NIT 0 / "S/N" for a final consumer. VP-16a shows the Note "Factura pendiente de emisión" |
| 11 · I can print or send the receipt | `rs-ticket` spec. Print page spec in 80 mm and letter. Int test: the receipt endpoint returns the sale without `cost`. Int test: the email request writes the outbox event. `sale-receipt.spec.ts`: the WhatsApp share text |

## Model

Migration **`<ts>_pos_sale_completion`**:
- `PosCheckoutPayment.change Decimal(14,2) @default(0) @map("change")`.
- CHECK `change >= 0 AND (change = 0 OR method = 'CASH')` on `pos_checkout_payments` and on `sale_payments`.
- No new tables, and `TENANT_MODELS` stays as it is.

New setting **`sales.receiptFormat`**: `TICKET_80MM` (default, decision #9) or `LETTER`. It's typed in `libs/domain/src/lib/company-settings.ts` and seeded per company in `seed-base.ts`.

## Domain (`libs/domain`)

- **New `cash-payment.ts`** (+ spec):
  - `validateCashTendered(total, text)`: parses "1.200,00" and returns `INVALID_AMOUNT`, `INSUFFICIENT_CASH` or `AMOUNT_TOO_LARGE`.
  - `cashChange(total, received)`.
  - `suggestCashAmounts(total)`: the next multiples of 50, 100 and 500, without duplicates or the exact total.
  - `paymentsCover(total, payments)`: non-cash payments must add up exactly, and only cash may exceed by the change. HU-VEN-09 reuses it.
- **New `sale-receipt.ts`** (+ spec):
  - `buildReceiptLines()`.
  - `receiptShareText()`: the WhatsApp text, without a NIT.
  - The receipt date format in `America/La_Paz`.
- `company-settings.ts` gains `sales.receiptFormat`.
- No new state machines: the checkout uses `pay` / `back` / `complete`, and the `Sale` is created `COMPLETED`.

Everything is exported from `libs/domain/src/index.ts`. Money is always `Decimal`.

## API

Every endpoint needs `sales.pos.use`. The POS endpoints also call `requireOpenShift()`, and the checkout must belong to my current shift. All queries go through `prisma.tenant`.

| Method · route | Does | Error `code`s |
| --- | --- | --- |
| `POST /sales/pos/checkout/pay` | `OPEN → PAYING`. Rechecks each line's `unitPrice` against `Product.price`. If any changed, it updates the lines, stays `OPEN` and returns `CHECKOUT_PRICES_CHANGED` with `details.lines`. Otherwise it returns `{ total, suggestedAmounts }` | `CHECKOUT_EMPTY`, `CHECKOUT_PRICES_CHANGED`, `INVALID_TRANSITION`, `CASH_SHIFT_NOT_OPEN` |
| `POST /sales/pos/checkout/back` | `PAYING → OPEN` ("Cancelar") | `CHECKOUT_NOT_PAYING` |
| `POST /sales/pos/checkout/complete` `{ payments: [{ method: 'CASH', received }], expectedTotal, idempotencyKey }` | Completes the sale in one transaction (steps below). A repeat with the same key returns the same sale | `INSUFFICIENT_CASH`, `INVALID_AMOUNT`, `CHECKOUT_TOTAL_CHANGED`, `INSUFFICIENT_STOCK` (`details: { productId, available }`), `PAYMENT_METHOD_NOT_AVAILABLE` (anything other than cash, until 08/09/10/34), `CHECKOUT_NOT_PAYING`, `CASH_SHIFT_NOT_OPEN` |
| `GET /sales/sales/:id/receipt` | Ticket data: company, NIT, branch, cashier, customer, lines, subtotal / discount / rounding / total, received / change, invoice status, `receiptFormat`. Never `cost` | `SALE_NOT_FOUND` |
| `POST /sales/sales/:id/receipt/email` `{ email }` | Publishes `sale.receipt-email` to the outbox. The worker sends it through the existing mail queue | `INVALID_EMAIL`, `SALE_NOT_FOUND` |

**`complete`, in one transaction:**
1. Lock the cart (`FOR UPDATE`); its status must be `PAYING`.
2. Recompute the totals with `cartTotals`. If they differ from `expectedTotal`, return `CHECKOUT_TOTAL_CHANGED`.
3. Validate the cash with `validateCashTendered` and check `paymentsCover`. Store the `CONFIRMED` `PosCheckoutPayment`, with its change.
4. Take the number with `nextDocumentNumber('sale')`.
5. Apply the stock movements **sorted by product id** (no deadlocks) through `StockMovementService.apply`, type `SALE`, from the register's warehouse. It follows `inventory.allowNegativeStock`.
6. Write the `Sale` (customer discount and rounding copied in), its `SaleItem`s with `sort_order`, and the `SalePayment`s.
7. Write the `CashMovement` `SALE_PAYMENT` with the cash net of change (`refType` "SALE").
8. Write the `Invoice` `PENDING` with the customer's tax data (`FINAL_CONSUMER` when there's no customer).
9. Move the checkout `PAYING → COMPLETED` through the machine.
10. Audit `sales.sale.complete` with `AuditService`.
11. Publish `sale.completed` with `OutboxService.publish(…, { tx })`.

**Other notes:**
- `pay` and `back` are audited too (`sales.checkout.pay`, `sales.checkout.back`).
- `InventoryModule` must **export `StockMovementService`**.
- The new outbox type `sale.receipt-email` goes into `outbox.service.ts` and `apps/worker/src/common/queues.ts`, with its mail template.

**Services:**
- `PosPaymentService`: `pay`, `back`, `complete`, in `pos/`.
- `SaleReceiptService`: receipt and email, in a new `sales/` sub-folder with its own controller.
- Both are registered in `SalesModule`.

## ERP screens

- **VP-04, `pos-payment-modal`** in `features/sales/pos/`, inside `rs-modal`:
  - "Cobrar Bs X (F9)" becomes active when the cart isn't empty. F9 or the button calls `/pay` and opens the modal.
  - Payment chips use `rs-filter-chip` with icons. Efectivo is selected. QR, Tarjeta, Transferencia, Crédito and Mixto are visible but disabled until their stories.
  - Quick amounts also use `rs-filter-chip`.
  - The Recibido / Cambio card is page markup, with tokens only; the change uses the success colour.
  - `rs-numpad`; the physical keyboard types too. Enter confirms and Esc cancels (calls `/back`).
  - On `CHECKOUT_PRICES_CHANGED`, `CHECKOUT_TOTAL_CHANGED` or `INSUFFICIENT_STOCK`: a Spanish toast (for example "Algunos precios cambiaron"), the cart reloads and the modal closes.
- **VP-16a, `pos-sale-completed-modal`:**
  - "Venta completada", the line "V-… · customer · date", then total / received / change.
  - `rs-note` "Factura pendiente de emisión".
  - **Imprimir ticket** opens `/sales/receipts/:saleId/print`. The page is outside the shell, renders `rs-ticket` with print CSS, and calls `window.print()`. It uses 80 mm or letter from `sales.receiptFormat`.
  - **WhatsApp** opens `wa.me` with `receiptShareText`.
  - **Correo** shows a small email field, pre-filled with the customer's email, and calls the email endpoint.
  - **Ver venta** is hidden until HU-VEN-12.
  - **Nueva venta (Enter)** closes the modal, and the POS shows an empty cart.
  - The sale number is shown **only here**: it can't be reserved before the sale exists without leaving gaps.
- The new error `code`s get their Spanish messages in `apps/erp/src/app/core/api-error.ts`.
- **New `libs/ui` components.** Both are in the Figma Design System (`O7gJBRq4bMcWBGP1DMUKkw`) and nothing existing fits:
  - **`rs-numpad`** (Figma Numpad):
    - `type` input: `'amount' | 'qty'`.
    - 96 × 56 px keys.
    - A `value` model and `key` / `clear` outputs.
    - Read at build time whether the "Monto recibido" display is part of the component.
  - **`rs-ticket`** (Figma Ticket):
    - `format` input: `'ticket-80mm' | 'letter'`.
    - The receipt data comes in as inputs; there's no hardcoded Spanish.
  - Each one gets its own `.ts`, `.html`, `.scss` and spec, is exported from `src/index.ts`, and is added to `/design-system` and to the table in `docs/ui-library.md`.

## Tests

**Unit:**
- `cash-payment.spec.ts`, `sale-receipt.spec.ts` and `company-settings.spec.ts`.
- Specs for `rs-numpad` and `rs-ticket`.
- `pos-payment-modal` spec: keypad, quick amounts, change, disabled confirm, Enter and Esc, the error toasts.
- `pos-sale-completed-modal` spec: print, WhatsApp, email, Nueva venta.
- `pos.page.spec.ts`: F9 opens the payment, an empty cart blocks it, Nueva venta resets the cart.
- Print page spec in both formats.

**Integration (real Postgres), `pos-sale.int.spec.ts`:**
- The whole sale is written atomically: stock, cash movement, sale, payments, invoice, checkout, audit, outbox.
- **Two cashiers sell the last unit at the same time: only one succeeds**, and the other gets `INSUFFICIENT_STOCK`.
- The same idempotency key twice gives one sale.
- Two concurrent `complete` calls on the same cart give one sale.
- A forced failure after the stock step rolls everything back, and the stock is unchanged.
- Sale numbers are consecutive with no gaps under concurrency.
- Price changed at `/pay`; total changed at `complete`.
- Insufficient cash.
- The shift was closed meanwhile.
- Another cashier's cart gives 404.
- Tenant isolation.
- The receipt has no `cost`.
- The email request writes the outbox event.

**E2E, `apps/erp-e2e/src/pos-cash-sale.spec.ts` (the walking skeleton):** open the register → add 6205 ×2 → F9 → tap 1200 → see the change → Confirmar cobro → "Venta completada V-…" → Imprimir shows the ticket → Nueva venta gives an empty cart → the product sheet shows the stock went down.

**Agents:** `stock-auditor` (required: this story writes stock), `ui-checker`, `reviewer`. Then `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default

- **#9 (print format):** setting `sales.receiptFormat` = `TICKET_80MM`. Both templates are built.
- **#54 (rounding):** the change is computed from the rounded total (`sales.roundingMode`, default `NONE`).
- **#7 (mixed payment):** the Mixto chip stays disabled until HU-VEN-09.
- **#4 (no NIT):** the invoice record uses HU-VEN-05's final consumer, NIT 0 / "S/N".

## Decisions taken in planning (approved 4 Nov 2026)

- 07 and 11 are built together on one branch, so the cash flow ends in a completed sale and the walking skeleton can be demoed.
- At `/pay`, a price change is refused and the cart refreshed. The cashier never charges an amount they didn't see.
- The sale number is shown only after completion.
- The receipt is printed, sent by email through the outbox, and shared on WhatsApp as a `wa.me` text.

## Risks and doubts

- **SIAT criteria:** the valid invoice with QR and the contingency case are covered only by the `PENDING` record, per the story's scope note. The ticket prints without the SIAT QR.
- **Size:** stock, cash, sale and two components on one branch. The two `libs/ui` components could be built in a parallel session that touches only `libs/ui`.
- **Branch order:** wait for HU-VEN-05 to merge. 22–25 (the rest of the cash register) read the `CashMovement` rows this branch writes.
- **Stock check:** stock is not checked at `/pay`; the locked check in `complete` is the one that counts.

## Files expected to change

- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_pos_sale_completion/`, `apps/api/prisma/seed-base.ts`
- `apps/api/src/modules/sales/pos/**` (payment service, controller routes, errors, int specs), `apps/api/src/modules/sales/sales/**` (new: receipt and email), `apps/api/src/modules/sales/sales.module.ts`
- `apps/api/src/modules/inventory/inventory.module.ts` (export only)
- `apps/api/src/common/outbox/outbox.service.ts`, `apps/worker/src/common/queues.ts`, worker mail template
- `libs/domain/src/lib/cash-payment.ts`, `sale-receipt.ts`, `company-settings.ts` (+ specs), `libs/domain/src/index.ts`
- `libs/ui/src/lib/numpad/**`, `libs/ui/src/lib/ticket/**` (new), `libs/ui/src/index.ts`, `docs/ui-library.md`
- `apps/erp/src/app/features/design-system/**`
- `apps/erp/src/app/features/sales/pos/**`, `apps/erp/src/app/features/sales/receipts/**` (new), `apps/erp/src/app/app.routes.ts`, `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/pos-cash-sale.spec.ts` (new)

## Decisions taken during the build (4 Nov 2026)

- **`rs-receipt`, not `rs-ticket`.** The Figma `Ticket` component is the POS sale panel (Empty / Items / Paid), not a printed receipt, so the printed receipt has no Figma source. It was built as `rs-receipt` (estimated, noted in `docs/ui-library.md`) to avoid a false 1:1 mapping; add it to the Design System and review it against the client's template (decision #9).
- **`rs-numpad` `Type=Qty` is estimated:** Figma only draws `Type=Amount`.
- **Modal sizes:** `rs-modal` gained `medium` (600) and `large` (800), the widths Figma draws for "Venta completada" and "Cobrar venta".
- **A paying cart is still the cashier's cart:** `current()`, `ensureCheckout` and `invoiceData()` treat `OPEN` and `PAYING` alike; a `PAYING` cart is refused with `CHECKOUT_NOT_EDITABLE` instead of starting a second one. A page load that finds a `PAYING` cart calls `back`.
- **Stock-audit fixes:** `complete` checks `quantity − reserved` under the locks, binds the idempotency key to the sale (`IDEMPOTENCY_KEY_REUSED`), maps a key collision to that code, re-checks the shift under `FOR SHARE`, and returns a committed sale on retry even if the shift closed since.
- **Receipts are the cashier's own** (`createdById`) until the sales history (HU-VEN-12); the e-mail request is audited (`sales.receipt.email`).
- **Accepted:** the sale-number lock is taken before the product locks (it cannot deadlock today; moving it later needs the number for the stock movement's reference).
