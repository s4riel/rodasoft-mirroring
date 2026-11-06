# HU-VEN-10 · Card payment with decline and retry (screen VP-12, decision #8) — plan

**Story** (`docs/backlog/sales.md`): As a cashier, I want to know whether a card was declined and retry or change the payment method, so that I do not lose the sale over a decline.

## Context
HU-VEN-07+11 (cash + completion), HU-VEN-08 (QR, mock provider, manual confirmation) and HU-VEN-09 (mixed cash + QR) are merged in `develop`. In "Cobrar venta" the "Tarjeta" chip is still disabled.

The card provider is not chosen yet (decision #8), so card uses the existing `MockPaymentProvider`, already registered as `CARD` in `sales.module.ts`. The cashier reads the outcome on the bank's terminal and reports it by hand. `paymentMachine` (PENDING → CONFIRMED/DECLINED/CANCELLED), `PosCheckoutPayment`, the provider registry and `canCompleteWithPayments` work for card as they are.

## Dependencies and branch order
- Branch `feat/hu-ven-10`, cut from `develop` after the 09 merge (`50e65de`).
- **Re-planned 5 Nov 2026 against the merged HU-VEN-09.** Card is a **single** payment method. It does **not** join the mix: `MIXABLE_METHODS` stays `['CASH','QR']`, and `pos-mixed-panel` is not touched.
- Do not run this branch in parallel with other POS payment work: it touches `pos/**`, `pos-payment.dialog.*`, `schema.prisma` and `api-error.ts`.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| The decline is shown | Card panel spec: after "Rechazado" + a reason, the VP-12 state shows "Pago rechazado", the reason in Spanish and "Intento N". Int test: `confirm` DECLINED stores `status=DECLINED` + `decline_reason`, and `GET card` returns both. |
| I can retry the charge | Panel spec: "Reintentar cobro" starts a new attempt with a **new** idempotency key. Int test: a second `start` after a decline creates a second row, the first stays DECLINED, and the sale completes with the approved one. |
| …or go back to the sale | Panel spec: "Cambiar forma de pago" returns to cash, and its panel lets me choose QR or Mixto; "Volver a la venta" emits `cancelled`, so the page calls `back`. Int test: `back` after a decline → cart `OPEN`; `back` with a pending card cancels it. |
| Guards | "Aprobado" needs an authorization code. `complete` refuses a card that is not CONFIRMED, belongs to another checkout, has another amount or is mixed with another line. With `sales.cardPaymentEnabled=false` the chip is disabled and the server answers `PAYMENT_METHOD_NOT_AVAILABLE`. A card and a QR are never live on the same cart. |

## Model
Migration `<ts>_pos_card_payment`, after `20261105180000_pos_mixed_payment`:
- New enum `PaymentDeclineReason` (`INSUFFICIENT_FUNDS`, `CARD_DECLINED`, `TERMINAL_ERROR`, `OTHER`). New column `PosCheckoutPayment.declineReason` → `decline_reason`, nullable.
- The authorization code goes in the existing `reference` column. `SalePayment.reference` copies it.
- CHECKs on `pos_checkout_payments`:
  - `method <> 'CARD' OR provider_ref IS NOT NULL`;
  - a CONFIRMED card has a `reference`;
  - `decline_reason` is only set when `method = 'CARD' AND status = 'DECLINED'`;
  - `method <> 'CARD' OR amount > 0`.
  - Plus `sale_payments_card_amount_check` (`method <> 'CARD' OR amount > 0`), in the style of 09's QR checks.
- New partial unique index `pos_checkout_payments_one_live_card` on `(checkout_id)` WHERE `method = 'CARD' AND status IN ('PENDING','CONFIRMED')`, mirroring 09's `one_live_qr`. 09's index stays untouched.
  - "No card and QR live at the same time" is checked in the services under the cart row lock, which every payment start already takes first.
- Document the index in a `///` comment on `PosCheckoutPayment`, as 09 did.
- No new tables. `TENANT_MODELS` stays unchanged.
- Setting `sales.cardPaymentEnabled: boolean`, default `true`, in `company-settings.ts`. Seed it in `seed-base.ts`.

## Domain (`libs/domain`)
- New `card-payment.ts` (+ spec):
  - `CARD_DECLINE_REASONS` and the `CardDeclineReason` type.
  - `normalizeAuthorizationCode(text)`: trim + uppercase, 4–12 alphanumeric; otherwise `INVALID_AUTHORIZATION_CODE`.
  - Contracts: `PosCardPayment` { paymentId, idempotencyKey, amount, status, attempt, authorizationCode \| null, declineReason \| null }, `StartPosCardInput` { idempotencyKey, expectedTotal }, `ConfirmPosCardInput` (`{outcome:'APPROVED', authorizationCode}` \| `{outcome:'DECLINED', reason}`), `PosCardPaymentResponse`, and `PosActiveCardResponse` { payment \| null }.
- `PosPayResponse` (in `cash-payment.ts`) gains `cardEnabled: boolean`, next to 09's `allowMixed`.
- No state-machine change. Update the doc comments of `paymentMachine` and `mixed-payment.ts` (card is a single method only). Export everything from `index.ts`.

## API
Everything stays under `sales.pos.use` (controller level), with an open shift and my `PAYING` checkout. Queries go through `prisma.tenant`.

| Route | Purpose | Error `code`s |
|---|---|---|
| `GET /sales/pos/checkout/payments/card` | The latest live or declined card attempt of my PAYING cart (resume after a refresh) | — |
| `POST /sales/pos/checkout/payments/card` | Start an attempt for the whole frozen total `{idempotencyKey, expectedTotal}` | `PAYMENT_METHOD_NOT_AVAILABLE` (setting off), `PAYMENT_ALREADY_PENDING`, `PAYMENT_ALREADY_CONFIRMED`, `CHECKOUT_TOTAL_CHANGED`, `CHECKOUT_NOT_PAYING`, `IDEMPOTENCY_KEY_REUSED` |
| `GET /sales/pos/checkout/payments/card/:id` | One of my card attempts | `PAYMENT_NOT_FOUND` |
| `POST /sales/pos/checkout/payments/card/:id/confirm` | The cashier reports APPROVED + code, or DECLINED + reason | `INVALID_AUTHORIZATION_CODE`, `VALIDATION_FAILED`, `PAYMENT_INVALID_STATE`, `CHECKOUT_NOT_PAYING` |
| `POST /sales/pos/checkout/payments/card/:id/cancel` | Drop a pending attempt ("Cambiar forma de pago" while waiting) | `PAYMENT_INVALID_STATE` |
| `POST /sales/pos/checkout/complete` | Also accepts a single `{method:'CARD', paymentId}` | `PAYMENT_NOT_CONFIRMED`, `PAYMENT_NOT_FOUND`, `CHECKOUT_TOTAL_CHANGED`, `PAYMENT_NOT_COVERED`, `PAYMENT_METHOD_NOT_AVAILABLE` (card mixed with another line), `PAYMENT_ALREADY_CONFIRMED` |
| `POST /sales/pos/checkout/back` | Also cancels a pending card attempt; a confirmed one blocks | `PAYMENT_ALREADY_CONFIRMED` |
| `POST /sales/pos/checkout/payments/qr` | Also refuses while a card is live | `PAYMENT_ALREADY_PENDING`, `PAYMENT_ALREADY_CONFIRMED` |

The literal `card` segment is declared before `checkout/payments/:id` in `pos.controller.ts`, so it does not clash with the QR route.

- **New `pos-card-payment.service.ts`**, built like `PosQrPaymentService`: lock the cart row (`payments.lockStatus`/`quote`) first, then settle idempotently, then `withProvider` re-charges on `PAYMENT_NOT_FOUND`. There is no expiry (`expires_at` stays null). A P2002 on start maps to the same-key payment, or to `PAYMENT_ALREADY_PENDING`.
- **Shared helpers:** move the helpers both services need (method-scoped `findMine`, `withProvider`, audit `log`, the "is another provider payment live?" check) into `pos-provider-payment.ts`. `PosQrPaymentService` uses them with no behaviour change; the QR and mixed int tests are the safety net.
- **Retry** = a new `start` with a new key. Declined rows stay as history. `attempt` = the number of card rows on the checkout.
- **`PosPaymentService` (09's shape):**
  - `parseTenders` accepts `CARD`, but only as the only line; otherwise `PAYMENT_METHOD_NOT_AVAILABLE`. `Tender` gains `{method:'CARD', paymentId}`.
  - `loadQr` → `loadProviderPayment(method)`. `Settlement.method` gains `'CARD'` and a `card: ProviderLine | null` field. In `settle`, a card alone must charge exactly the total, like a QR alone.
  - Writes `SalePayment` CARD with `reference` = authorization code and `providerStatus` CONFIRMED. No `CashMovement`. The audit `payments` array includes the card line.
  - `dropQrPayments` → `dropProviderPayments` (QR + CARD). It is used by `back` and by cash-alone `complete`.
  - A QR or mixed `complete` refuses a CONFIRMED card, and a card `complete` refuses a CONFIRMED QR (`PAYMENT_ALREADY_CONFIRMED`): no double charge.
  - In `findCompleted`, a CARD row without a sale returns `null`, like QR.
  - `pay` fills `cardEnabled`.
- **Audit:** `sales.payment.card-start`, `sales.payment.card-confirm` (outcome plus reason or code), `sales.payment.card-cancel`. `sales.sale.complete` records `method: 'CARD'`. **No new outbox events** (`sale.completed` already exists).
- New error factories in `pos.errors.ts` (`paymentAlreadyPending`, `invalidAuthorizationCode`). Update the `PAYMENT_METHOD_NOT_AVAILABLE` message.

## ERP screens
- **Payment dialog:**
  - The "Tarjeta" chip is enabled when `cardEnabled` (otherwise disabled with "No disponible").
  - New `resumeCard` input and `cardConfirmed` output.
  - The same locking as QR: while a card attempt is pending or confirmed, the other chips (Efectivo, QR, Mixto) are locked and "Cancelar" follows `locked`.
- **New `pos-card-panel.{ts,html,scss,spec.ts}`** (feature-level, like `pos-qr-panel`). Its screens:
  - `starting`: skeleton.
  - `failed`: note + Reintentar / Cambiar forma de pago.
  - `pending`: "Pasa la tarjeta en el terminal", the amount, the mock-provider info note, and buttons "Aprobado" / "Rechazado" / "Cambiar forma de pago".
    - "Aprobado" shows `rs-field` + `rs-input` "Código de autorización" with a confirm button.
    - "Rechazado" shows the reason (`rs-radio-group` or `rs-select`, whichever VP-12 uses): Fondos insuficientes · Tarjeta rechazada · Error del terminal · Otro.
  - **`declined` (VP-12):** danger note "Pago rechazado", the reason, "Intento N", and buttons **Reintentar cobro** (primary), **Cambiar forma de pago** and **Volver a la venta**.
  - `confirmed`: "Pago aprobado. Completando la venta…" + "Completar venta".
- **`pos.page`:**
  - On open, it resumes a live or declined card (`GET card`) next to the QR resume.
  - On `cardConfirmed`, it calls `complete` with `[{method:'CARD', paymentId}]` and the attempt's key.
  - "Volver a la venta" goes through the existing `back`.
- **`pos-api.service.ts`:** `startCard`, `getCard`, `currentCard`, `confirmCard`, `cancelCard`.
- **`libs/ui` reused:** `rs-modal`, `rs-filter-chip`, `rs-button`, `rs-note`, `rs-field`, `rs-input`, `rs-radio-group`/`rs-select`, `rs-skeleton`, `rs-icon`.
  - **No new `libs/ui` component**, unless Figma VP-12 shows a reusable Design System piece. Read VP-12 with `get_design_context` at build time.
- Spanish messages for the new codes go in `apps/erp/src/app/core/api-error.ts`.

## Tests
- **Unit:**
  - `card-payment.spec.ts`: code normalization and reasons.
  - `pos-card-panel.spec.ts`: each screen; retry uses a new key; the three decline actions; approval needs a valid code; buttons disabled while busy.
  - `pos-payment.dialog.spec.ts`: Tarjeta chip enabled/disabled by `cardEnabled`; locking of Efectivo/QR/Mixto.
  - `pos.page.spec.ts`: resume a card; complete with CARD; Volver a la venta → `back`.
  - `api-error` messages. The mixed panel and QR panel specs stay green.
- **Integration (real Postgres), new `pos-card-payment.int.spec.ts`:**
  - start → decline with reason → retry → approve with code → complete: one `Sale`, one `SalePayment` CARD with the code, stock deducted, **no** `CashMovement`, outbox `sale.completed`;
  - decline then `back` → cart OPEN, stock untouched;
  - pending card + `back` → CANCELLED;
  - confirmed card + `back` → `PAYMENT_ALREADY_CONFIRMED`;
  - complete with a DECLINED/PENDING card → `PAYMENT_NOT_CONFIRMED`;
  - card + cash in one `complete` → `PAYMENT_METHOD_NOT_AVAILABLE`;
  - cash-alone or QR `complete` while a card is CONFIRMED → refused;
  - QR start while a card is live → refused, and card start while a QR is live → refused;
  - the same start key twice → one row;
  - two concurrent `start` calls → one live card;
  - two concurrent `complete` calls → one sale;
  - a forced rollback leaves stock and payments untouched;
  - setting off → `PAYMENT_METHOD_NOT_AVAILABLE`;
  - another cashier's attempt → 404;
  - tenant isolation;
  - a closed shift blocks;
  - the CHECK constraints reject a CONFIRMED card without a reference.
- Existing `pos-qr-payment`, `pos-mixed-payment` and `pos-sale` int specs stay green (refactor safety).
- **E2E:** new `apps/erp-e2e/src/pos-card-payment.spec.ts`:
  - F9 → Tarjeta → Rechazado "Fondos insuficientes" → VP-12 "Pago rechazado · Intento 1" → Reintentar cobro → Aprobado with code `A1B2C3` → "Venta completada";
  - decline → Volver a la venta → cart.
- **Agents:** `stock-auditor` (the sale moves stock), `ui-checker`, `reviewer`, `refactor`. Then `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default
- **#8 card terminal provider:** the mock adapter. The cashier reports approved/declined, the reason and the authorization code. A real adapter replaces `CARD` in the registry with no change to the callers.
- `sales.cardPaymentEnabled` (default `true`): per company, so a company without a terminal can turn card off.
- **#7:** card is not mixable yet; `sales.allowMixedPayment` is unchanged.
- **#54:** card charges the rounded total.

## Decisions taken in planning
- 4 Nov 2026: on a decline the cashier picks a reason; on approval they type the voucher's authorization code.
- 4 Nov 2026: VP-12 offers Reintentar cobro, Cambiar forma de pago and Volver a la venta.
- 5 Nov 2026 (re-plan after 09): card is a single method only. Adding it to the mix is a later story.

## Risks and doubts
1. Figma VP-12 is not opened yet. It decides radio vs select for the reason, and whether the decline is a state inside "Cobrar venta" (assumed) or its own modal.
2. The shared `pos-provider-payment.ts` refactor touches the QR service that 09 just changed. Keep it mechanical; the QR and mixed int tests are the guard.
3. The cross-method rule (no card and QR live together) is enforced in the services, not by an index. It relies on every start locking the cart row first; a concurrency int test proves it.
4. A confirmed card cannot be undone at the POS (the mock has no refund), so the cashier must finish the sale. Refunds come with HU-VEN-21.
5. "+ Agregar forma de pago" in the mixed panel stays disabled. Card in the mix needs its own story; add it to the backlog.

## Files expected to change
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_pos_card_payment/`, `apps/api/prisma/seed-base.ts`
- `apps/api/src/modules/sales/pos/`: `pos-card-payment.service.ts` (new), `pos-provider-payment.ts` (new), `pos-qr-payment.service.ts`, `pos-payment.service.ts`, `pos-payment.dto.ts`, `pos.controller.ts`, `pos.errors.ts`, `pos-card-payment.int.spec.ts` (new), `pos.int-fixture.ts`
- `apps/api/src/modules/sales/sales.module.ts` (register the new service)
- `libs/domain/src/lib/card-payment.ts` (+ spec, new), `company-settings.ts`, `cash-payment.ts`, `mixed-payment.ts` (comment only), `state-machine.ts` (comment only), `index.ts`
- `apps/erp/src/app/features/sales/pos/`: `pos-card-panel.*` (new), `pos-payment.dialog.*`, `pos.page.*`, `pos-api.service.ts`
- `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/pos-card-payment.spec.ts` (new)

## Verification
- `pnpm nx affected -t lint typecheck test`, including the int specs against the real Postgres.
- The E2E `pos-card-payment.spec.ts`.
- A manual run in the ERP: decline → VP-12 → retry → approve → receipt. Check that the shift's cash total did not change.
