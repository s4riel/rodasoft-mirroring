# HU-VEN-08 · QR payment (screen VP-04b, decision #6) — plan

**Story** (`docs/backlog/sales.md`): As a cashier, I want to charge by QR and see when the payment is confirmed, so that I accept digital payments.

## Dependencies and branch order
- Extends the "Cobrar venta" modal and `complete` from **HU-VEN-07+11** (`docs/plans/sales/HU-VEN-07-11.md`), planned but not built. It reuses their `pay`, `back` and `complete` endpoints, the payment modal and `PosPaymentService`.
- HU-VEN-05 is still uncommitted on `feat/hu-ven-05`.
- **Order:** merge 05 → build 07+11 → build 08 on `feat/hu-ven-08`, cut from `develop`. Do **not** run 08 in parallel with 05 or 07+11: they all touch `pos/**`, `pos.page.*`, `schema.prisma` and `api-error.ts`.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| The QR is shown with the amount | `rs-qr-code` spec renders the QR and "Bs X". Modal spec: choosing QR calls `/payments/qr` and shows the server amount. Int test: start stores a `PosCheckoutPayment` (QR, `PENDING`, amount = rounded total) and returns the QR payload |
| The screen waits for confirmation | Modal spec with fake timers: polls `GET /payments/:id` while `PENDING`, stops on `CONFIRMED`, then completes the sale. Int test: confirm marks the payment `CONFIRMED` |
| I can cancel and choose another payment method | Modal spec: "Cancelar" calls cancel, then the method chips are enabled again. Int test: cancel sets `CANCELLED`, the checkout stays `PAYING`, and cash can then complete the sale |
| Guards | `complete` with a QR not `CONFIRMED` → `PAYMENT_NOT_CONFIRMED`. A `DECLINED` or `CANCELLED` QR cannot complete |

## Model
Migration `<ts>_pos_qr_payment`:
- `PosCheckoutPayment.qrPayload String? @map("qr_payload")` (so a refresh can show the QR again).
- CHECK on `pos_checkout_payments`: a QR payment must have `provider_ref`.
- Partial unique index: one `PENDING` QR per checkout.
- No new tables; `TENANT_MODELS` unchanged. `SalePayment` already has `method`, `reference`, `providerStatus`.
- New setting `sales.qrConfirmTimeoutSeconds` (default 300), typed in `company-settings.ts` and seeded in `seed-base.ts`.

## Domain (`libs/domain`)
- `qr-payment.ts` (+ spec): `buildQrPayload(...)` (mock text such as `RODASOFT-MOCK|company|checkout|amount|ref`), `canCompleteWithPayments(payments)` (a QR counts only when `CONFIRMED`).
- Reuses `paymentsCover` from 07. In 08 the QR amount must equal the total (mixed payment is HU-VEN-09, decision #7).
- Allowed payment-status transitions in `state-machine.ts`: `PENDING → CONFIRMED | DECLINED | CANCELLED`, audited.
- Exports in `libs/domain/src/index.ts`.

## API
All endpoints need `sales.pos.use`, an open shift, and a checkout in `PAYING` that belongs to my shift. Queries through `prisma.tenant`.

| Route | Does | Error `code`s |
|---|---|---|
| `POST /sales/pos/checkout/payments/qr` `{ idempotencyKey }` | Writes the `PENDING` row first (unique key = durable guard), then `provider.charge`. A repeat returns the same row. Returns `{ paymentId, amount, qrPayload, expiresAt }` | `CHECKOUT_NOT_PAYING`, `QR_ALREADY_PENDING`, `CHECKOUT_TOTAL_CHANGED` |
| `GET /sales/pos/checkout/payments/:id` | Status, for polling | `PAYMENT_NOT_FOUND` |
| `POST /sales/pos/checkout/payments/:id/confirm` `{ outcome: 'APPROVED' \| 'DECLINED' }` | Manual confirmation by the cashier (mock, decision #6) | `PAYMENT_INVALID_STATE` |
| `POST /sales/pos/checkout/payments/:id/cancel` | Cancels a `PENDING` QR | `PAYMENT_INVALID_STATE` |
| `complete` (from 07) | Accepts `{ method: 'QR', paymentId }`, requires `CONFIRMED` | `PAYMENT_NOT_CONFIRMED`, `PAYMENT_METHOD_NOT_AVAILABLE` |

- Service: `PosQrPaymentService` in `pos/`, provider injected through `PAYMENT_PROVIDERS`.
- Audit: `sales.payment.qr-start`, `sales.payment.qr-confirm`, `sales.payment.qr-cancel`. No outbox in 08 (`complete` publishes `sale.completed`).
- The mock adapter keeps state in memory, so the **DB row is the source of truth**. `confirm`/`cancel` update the row first; on `PAYMENT_NOT_FOUND` from the provider after a restart, re-run `charge` (idempotent) and retry.
- Timeout: on expiry the QR is cancelled on the server; a late payment is never auto-accepted.
- A QR payment writes **no** `CashMovement`.

## ERP screens
- **VP-04b**, `pos-qr-payment` inside the 07 payment modal: QR chip enabled; QR with amount; "Esperando confirmación…" with countdown; manual buttons "Pago recibido" / "Pago no recibido"; "Cancelar" and "Cambiar método". Esc cancels.
- **New `libs/ui` component `rs-qr-code`** (nothing existing fits): inline SVG QR from `payload` and `size`, tokens only, no hardcoded Spanish. Needs an encoder: add the small `qrcode-generator` package (pure JS). Own `.ts`, `.html`, `.scss`, spec; exported from `src/index.ts`; added to `/design-system` and to `docs/ui-library.md` (marked "not in Figma / estimated" until the frame is read).
- Spanish messages for the new error codes in `apps/erp/src/app/core/api-error.ts`.
- Read VP-04b with `get_design_context` at build time; the component list may change.

## Tests
- **Unit:** `qr-payment.spec.ts`; `rs-qr-code` spec; modal spec with QR (polling with fake timers, timeout, cancel → cash, decline); `api-error` messages.
- **Integration (real Postgres), `pos-qr-payment.int.spec.ts`:** atomic sale with a QR `SalePayment` (`providerStatus` `CONFIRMED`); same idempotency key twice → one payment; two concurrent starts → one `PENDING` QR; `complete` unconfirmed → `PAYMENT_NOT_CONFIRMED`; declined/cancelled cannot complete; cancel then cash works; another cashier's payment → 404; tenant isolation; provider restart recovery; closed shift blocks; no `CashMovement` for QR.
- **E2E:** extend `apps/erp-e2e/src/pos-cash-sale.spec.ts`: add 6205 → F9 → QR → see QR and amount → "Pago recibido" → "Venta completada".
- **Agents:** `stock-auditor`, `ui-checker`, `reviewer`; then `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default
- **#6:** mock `PaymentProvider`, manual confirmation by the cashier, placeholder payload.
- **#7:** untouched; QR covers the whole total until HU-VEN-09.
- **#54:** the QR amount is the rounded total.
- New setting `sales.qrConfirmTimeoutSeconds` = 300.

## Risks and doubts
1. Build order (above).
2. Manual confirmation is a trust hole. For now `sales.pos.use` is enough and the audit row records who confirmed. A separate permission (e.g. `sales.pos.confirm-qr`) is a possible later hardening.
3. Figma VP-04b not yet opened.
4. Polling every 2 s; the real provider's webhook will feed the same status endpoint later.
5. Timeout cancels the QR on the server.
6. Existing lint error in HU-VEN-05 code (`customer-form.ts:59`, `no-output-native`) must be fixed in that branch before 08 builds on it.

## Files expected to change
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_pos_qr_payment/`, `apps/api/prisma/seed-base.ts`
- `apps/api/src/modules/sales/pos/**`, `apps/api/src/modules/sales/payments/**`, `apps/api/src/modules/sales/sales.module.ts`
- `libs/domain/src/lib/qr-payment.ts` (+ spec), `state-machine.ts`, `company-settings.ts` (+ specs), `libs/domain/src/index.ts`
- `libs/ui/src/lib/qr-code/**` (new), `libs/ui/src/index.ts`, `docs/ui-library.md`
- `apps/erp/src/app/features/design-system/**`
- `apps/erp/src/app/features/sales/pos/**` (payment modal, `pos-api.service.ts`), `apps/erp/src/app/core/api-error.ts`
- `package.json`, lockfile (`qrcode-generator`)
- `apps/erp-e2e/src/pos-cash-sale.spec.ts`
