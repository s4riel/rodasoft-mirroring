# HU-VEN-09 · Mixed payment (screen VP-04c, decision #7) — plan

**Story** (`docs/backlog/sales.md`): As a cashier, I want to combine payment methods in one sale, so that I serve customers who pay part in cash and part by card or QR.

## Dependencies and branch order
- Extends the "Cobrar venta" modal and `complete` from **HU-VEN-07+11** (`docs/plans/sales/HU-VEN-07-11.md`) and the QR flow from **HU-VEN-08** (`docs/plans/HU-VEN-08.md`). Neither is built yet.
- HU-VEN-05 is still uncommitted on `feat/hu-ven-05`.
- **Order:** merge 05 → build 07+11 → build 08 → build 09 on `feat/hu-ven-09`, cut from `develop`. Do **not** run 09 in parallel with 05, 07+11 or 08: they all touch `pos/**`, `pos.page.*`, `schema.prisma` and `api-error.ts`.
- Before building, re-check the built modal and `complete` signature against this plan.
- **Approved scope: only cash + QR.** Transfer/credit (HU-VEN-34) are not built; their chips stay disabled. The split logic is method-agnostic.
- **Update (5 Nov 2026):** HU-VEN-10 (card, `docs/plans/HU-VEN-10.md`) is built **before** 09 as a single method. When building 09, re-plan so card can be one line of the mix: a card line uses 10's `POST /checkout/payments/card` for the partial amount, and `complete` accepts `{method:'CARD', paymentId}` lines. Like QR, a `CONFIRMED` card line blocks "Cancelar".

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| I split the total among several payment methods | Domain `mixed-payment.spec.ts`: valid splits accepted, same method twice rejected. Modal spec: choosing Mixto lets me add a cash line and a QR line. Int test: `complete` with cash 300 + QR 700 writes two `SalePayment` rows adding up to the total. |
| It shows how much is still uncovered | `mixedRemaining(total, lines)` unit test. Modal spec: the "Falta Bs X" counter updates per line, shows "Cubierto" at 0, and confirm stays disabled until covered. Int test: uncovered or over-covered split returns 409 `PAYMENT_NOT_COVERED`. |
| Guards | A QR line counts only when `CONFIRMED`. With `sales.allowMixedPayment = false` the Mixto chip is hidden and the server returns `MIXED_PAYMENT_DISABLED`. |

## Model
- **No new tables.** `PosCheckoutPayment` and `SalePayment` already allow several payments per checkout/sale. `TENANT_MODELS` unchanged.
- Migration `<ts>_pos_mixed_payment`:
  - Review 08's "one `PENDING` QR per checkout" partial unique index; a mix has at most one QR, so it should still fit. Drop it only if it blocks.
  - CHECK `amount > 0` on `pos_checkout_payments` and `sale_payments`, if 07 did not add it.
  - Partial unique index on `(checkout_id, method)` for non-cancelled payments: one line per method.
- `sales.allowMixedPayment` already exists in `company-settings.ts` (default `true`). Confirm it is seeded in `seed-base.ts`.

## Domain (`libs/domain`)
New `mixed-payment.ts` (+ spec):
- `mixedRemaining(total, lines)`.
- `validateMixedPayments(total, lines, allowMixed)`: rejects fewer than 2 lines, zero/negative amounts and duplicate methods. Returns `MIXED_PAYMENT_DISABLED`, `PAYMENT_NOT_COVERED` or `PAYMENT_INVALID_AMOUNT`.
- `suggestRemainder(total, lines)`: pre-fills the last line.
- Reuses 07's `paymentsCover`: non-cash must add up exactly, only cash may exceed by the change.
- No state-machine change. Export from `libs/domain/src/index.ts`. Money is `Decimal`.

## API
No new routes. All under `sales.pos.use`, an open shift and a `PAYING` checkout of my shift; queries via `prisma.tenant`.

| Route | Change | Error `code`s |
|---|---|---|
| `POST /sales/pos/checkout/complete` | `payments[]` accepts several lines (`CASH` with `received`, `QR` with `paymentId`) | `MIXED_PAYMENT_DISABLED`, `PAYMENT_NOT_COVERED`, `PAYMENT_INVALID_AMOUNT`, `PAYMENT_NOT_CONFIRMED`, `PAYMENT_METHOD_NOT_AVAILABLE` |
| `POST /sales/pos/checkout/payments/qr` | Accepts `amount` (≤ remaining; in 08 it was the full total) | `QR_AMOUNT_INVALID`, `CHECKOUT_TOTAL_CHANGED` |
| `POST /sales/pos/checkout/back` | **Blocked while any QR payment of the checkout is `CONFIRMED`** (decision below) | `PAYMENT_ALREADY_CONFIRMED` |

- Change is computed on the cash line only: `cash received − (total − non-cash payments)`, must be ≥ 0.
- `CashMovement` = cash net of change. QR writes none (as in 08).
- Audit: `sales.sale.complete` records the full split; `sales.payment.qr-start` carries the partial amount. No new outbox events.

## ERP screens
- **VP-04c** inside the 07 payment modal: Mixto chip enabled (hidden if the setting is off); method lines each with an amount; "Falta Bs X" indicator (→ "Cubierto"); "Agregar método" (cash or QR only).
- Cash line uses `rs-numpad` and shows the change. QR line starts 08's QR for the partial amount with the same waiting/cancel behaviour.
- **"Cancelar" is blocked** while a QR line is `CONFIRMED`: the button is disabled with a Spanish hint (the cashier must finish the sale with the remaining method; refunds go through HU-VEN-21). Esc does nothing in that state.
- Reuse `rs-modal`, `rs-filter-chip`, `rs-button`, `rs-note`, `rs-numpad`, `rs-qr-code`.
- Possible new `libs/ui` component `rs-payment-split-row` (method + amount + status + remove), only if Figma VP-04c shows it is more than page markup (read with `get_design_context` at build time). If added: own `.ts/.html/.scss/spec`, export from `src/index.ts`, add to `/design-system` and `docs/ui-library.md`.
- Spanish messages for the new error codes in `apps/erp/src/app/core/api-error.ts`.

## Tests
- **Unit:** `mixed-payment.spec.ts`; split-row spec (if created); modal spec (add/remove lines, remainder counter, disabled confirm, chip hidden when setting off, "Cancelar" disabled with a confirmed QR); `api-error` messages.
- **Integration (real Postgres), `pos-mixed-payment.int.spec.ts`:**
  - Cash + QR sale is atomic: stock deducted, one `SalePayment` per line, `CashMovement` for cash only.
  - Mismatched sums → 409.
  - Unconfirmed QR blocks `complete`.
  - Cash over-tender returns change only on the cash line.
  - Setting off → `MIXED_PAYMENT_DISABLED`.
  - `back` with a confirmed QR → `PAYMENT_ALREADY_CONFIRMED`.
  - Same idempotency key twice → one sale.
  - Two concurrent `complete` calls → one sale.
  - Forced rollback leaves stock and cash untouched.
  - Closed shift blocks.
  - Another cashier's payment → 404.
  - Tenant isolation.
- **E2E:** extend `apps/erp-e2e/src/pos-cash-sale.spec.ts`: F9 → Mixto → cash 300 → QR for the rest → "Pago recibido" → "Venta completada" with both payments.
- **Agents:** `stock-auditor` (the sale moves stock), `ui-checker`, `reviewer`; then `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default
- **#7:** mixed payment allowed, behind `sales.allowMixedPayment` (default `true`).
- **#54:** the mix works on the rounded total.
- **#6, #8:** QR stays the mock adapter with manual confirmation; card is not included until HU-VEN-10.

## Decisions taken in planning (approved 4 Nov 2026)
- Only cash + QR can be mixed for now.
- "Cancelar" is blocked once a QR line is `CONFIRMED` (no automatic refund; the mock provider cannot refund).
- One line per method.

## Risks and doubts
1. Build order (above); the modal and `complete` may differ once 07/08 are built.
2. A confirmed QR with a failing cash line leaves the cashier unable to cancel; they must finish the sale or ask Management for a refund once HU-VEN-21 exists.
3. Card, transfer and credit will need their own stories to join the mix.
4. Figma VP-04c not yet opened.

## Files expected to change
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_pos_mixed_payment/`, `apps/api/prisma/seed-base.ts` (verify only)
- `apps/api/src/modules/sales/pos/**` (payment service, QR service, DTO, errors, int specs)
- `libs/domain/src/lib/mixed-payment.ts` (+ spec), `libs/domain/src/lib/cash-payment.ts`, `libs/domain/src/index.ts`
- `libs/ui/src/lib/payment-split-row/**` (possible), `libs/ui/src/index.ts`, `docs/ui-library.md`
- `apps/erp/src/app/features/design-system/**`
- `apps/erp/src/app/features/sales/pos/**` (payment modal, `pos-api.service.ts`), `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/pos-cash-sale.spec.ts`
