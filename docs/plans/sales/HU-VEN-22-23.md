# HU-VEN-22 + HU-VEN-23 · Current shift, cash movements and closing count (VP-22, VP-22b, VP-06; decisions #16, #17) — plan

## Context
Block A completes the cash cycle the skeleton started. HU-VEN-01 left `/sales/cash-register` as a minimal "Turno abierto" summary; nothing writes `INCOME`/`EXPENSE` movements, `cash_counts`, or closes a shift (`cashShiftMachine OPEN → CLOSED → APPROVED | OBSERVED` exists, unused). Planned together on one branch as the backlog asks (`22 + 23`).

- **HU-VEN-22:** see my shift with sales per payment method; register cash income and expenses with a reason.
- **HU-VEN-23:** close counting cash by denomination; the system computes the difference; I register QR, card and transfer.

Already in place: `CashMovement` (`INCOME`, `EXPENSE`, `SALE_PAYMENT` written by POS, `REFUND` written by cancellations/returns), `CashCount` (`@@unique([shiftId, denomination])`), `CashShift.expected/counted/difference/closingFloat`, `ApprovalRequest` with `CASH_DIFFERENCE` and status `WITHDRAWN`, setting `sales.cashExpenseApprovalLimit` (null), `StorageService` (jpeg/png/webp/pdf), `lockOpenShift` (`FOR SHARE`) in `pos-payment.service.ts`, `CashShiftsService.requireOpenShift`.

Figma `JYULL6jvXiwNP8UVvEF7tl` page 09: VP-22 `103:18245`, VP-22b `103:18344`, VP-06 `103:18462`, approval card "Solicitud/Diferencia de caja" `103:18941` (style reference for the expense review card).

**Branch:** `feat/hu-ven-22-23`, cut from `develop` **after `feat/hu-ven-21` is merged** (needs its `REFUND` posting, outbox types and migration order). Migration goes after `20261109150000_sale_returns`.

**Decisions taken in planning (9 Nov 2026):**
- 22 and 23 together.
- **Full expense-approval flow behind `sales.cashExpenseApprovalLimit`** (null = never asks): above the limit the expense is `PENDING` with an `ApprovalRequest` type `CASH_EXPENSE`; it does not count in expected cash until approved. New permission `sales.cash-expenses.approve`. A requester who already holds that permission gets it posted at once.
- **Comprobante included** (optional photo/PDF), through `StorageService` with a new upload kind.
- **Concepts are fixed codes in `libs/domain`**, per type; `OTHER` needs a detail.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| 22 · Current shift with sales per payment method | Int `cash-shift-summary.int.spec.ts`: shift with cash, QR, card, transfer, mixed and credit sales + one cancelled sale → `GET /sales/cash-shifts/:id` returns per method `{ amount, count }` (cancelled sale excluded; credit row only when > 0), "Ventas del turno" total + count, KPIs (expected cash, income, expenses), cash calc lines (float, cash sales, income, expenses, refunds, expected) where expected = float + Σ`SALE_PAYMENT` + Σ`INCOME` − Σ posted `EXPENSE` − Σ`REFUND`. Another cashier's shift → 403 `CASH_SHIFT_NOT_OWNED` (allowed with `sales.cash-register.review`). Page spec `cash-register.page.spec.ts` (VP-22): KPIs, movements table with opening row and pending/rejected pills, by-method table, cash calc, buttons by permission, loading/empty/error/no-permission. |
| 22 · I register expenses with a reason | Int `cash-movements.int.spec.ts`: `POST /sales/cash-shifts/:id/movements` (multipart, `Idempotency-Key`) creates `EXPENSE` with concept + detail + user + time, audit `sales.cash-movement.create`, outbox `sales.cash-movement.created`; income too. Guards: amount ≤ 0 / > 2 decimals → `INVALID_CASH_AMOUNT`; unknown concept for type → `INVALID_CASH_CONCEPT`; `OTHER` without detail → `CASH_DETAIL_REQUIRED`; expense > expected cash → `CASH_EXPENSE_EXCEEDS_CASH`; closed shift → `CASH_SHIFT_NOT_OPEN`; bad file → `INVALID_RECEIPT_FILE` / `RECEIPT_TOO_LARGE`. Receipt stored and served by `GET /sales/cash-movements/:id/receipt`. Repeated key → same movement. Dialog spec (VP-22b). |
| 22 · Expense approval (#16) | Int: limit 100, expense 150 → `PENDING` + `ApprovalRequest CASH_EXPENSE`, not in expected cash; approve → `POSTED`, counted; reject (comment required) → `REJECTED`; requester withdraws → `WITHDRAWN`; approve × withdraw and approve × approve → one wins (`CASH_MOVEMENT_NOT_PENDING`); approval re-checks `CASH_EXPENSE_EXCEEDS_CASH`; requester holding `sales.cash-expenses.approve` → posted at once; 403 without permission; null limit → never pending. |
| 23 · I count bills and coins | Int `cash-closing.int.spec.ts`: `POST /sales/cash-shifts/:id/close` stores one `CashCount` per denomination with quantity > 0, `countedAmount` = Σ, `closingFloat`, `closedBy/At`. Unknown denomination → `INVALID_DENOMINATION`; negative/non-integer → `INVALID_COUNT`. Page spec `cash-closing.page.spec.ts`: steppers, subtotals, "Efectivo contado", Recontar resets. |
| 23 · The system calculates the difference | Int: `expectedAmount` computed on the server under the shift lock (client values ignored), `differenceAmount` = counted − expected; with a difference beyond `sales.cashDifferenceTolerance` the comment is required (`CLOSING_COMMENT_REQUIRED`), shift `CLOSED` + `ApprovalRequest CASH_DIFFERENCE` (HU-VEN-24 reviews it), outbox `sales.cash-shift.difference`; without difference `CLOSED → APPROVED` in the same tx (both audited). `closingFloat` > counted → `CLOSING_FLOAT_EXCEEDS_COUNTED`. Next `GET /sales/cash-registers` shows the last close and VP-05 compares against it. |
| 23 · I register QR, card and transfer | Int: body `declared: { QR, CARD, TRANSFER }` → one `CashShiftMethodTotal` per method with system, declared and difference; a method difference also requires the comment and creates the review request. Page spec: "Sistema vs. contado" table with editable declared amounts prefilled with the system ones, live difference and warning note. |
| 23 · Close is safe | Int **concurrency**: close × POS cash sale on the same shift → either the sale is in `expectedAmount` or it fails `CASH_SHIFT_NOT_OPEN`, never lost; close × expense; close × close → one wins (`CASH_SHIFT_NOT_OPEN`); two expenses that together exceed the cash → one wins. Close with a pending expense → `CASH_SHIFT_HAS_PENDING_EXPENSES`; with a `PAYING` checkout holding a pending QR/card payment → `CASH_SHIFT_HAS_PENDING_PAYMENTS`; `OPEN`/`ON_HOLD` checkouts become `ABANDONED`. After close the POS shows "Caja cerrada". |

## Model
Migration `<ts>_cash_movements_and_closing`:
- New enum `CashMovementStatus { PENDING POSTED REJECTED WITHDRAWN }`; `ApprovalType` add `CASH_EXPENSE`.
- `cash_movements`: add `status` (default `POSTED`, existing rows stay posted), `concept String?` (code, validated in domain), `receipt_key String?`, `idempotency_key String?` + `@@unique([companyId, idempotencyKey])`, `@@index([companyId, shiftId, status])`. `reason` stays as the free "Detalle". CHECK `amount > 0`.
- New `CashShiftMethodTotal` (`cash_shift_method_totals`): `companyId`, `shiftId`, `method PaymentMethod`, `systemAmount`, `declaredAmount`, `differenceAmount` (`Decimal(14,2)`), `@@unique([shiftId, method])`, `@@index([companyId])`. Add to `TENANT_MODELS` (`tenant.extension.ts`); confirm `CashCount` is there too.
- `cash_shifts`: add `closing_comment String?` (cashier's justification; `review_note` stays for HU-VEN-24). CHECKs `closing_float >= 0`, `counted_amount >= 0`; `cash_counts`: `denomination > 0`, `quantity >= 0`; method totals `declared_amount >= 0`.

## Domain (`libs/domain`)
- New `cash-register.ts` (+spec):
  - `CASH_MOVEMENT_CONCEPTS = { INCOME: ['BALANCE_COLLECTION', 'FLOAT_TOP_UP', 'OTHER'], EXPENSE: ['FREIGHT', 'PACKAGING', 'SERVICES', 'TRAVEL', 'SUPPLIES', 'OTHER'] }`, `CASH_DETAIL_MAX`, `validateCashMovement(input)` → field errors, `needsExpenseApproval(amount, limit)`.
  - `CASH_DENOMINATIONS` (Figma: 200, 100, 50, 20, 10 bills; 5, 2, 1, 0.50 coins), `countedTotal(counts)`.
  - `shiftCashSummary({ openingFloat, movements })` → `{ cashSales, income, expenses, refunds, expected }` (posted only), `paymentMethodTotals(payments)`.
  - `closingDifferences(system, declared, tolerance)` → per method + `needsReview`; `validateClosing(input, counted)` (float ≤ counted, comment when needed).
  - Contracts: `CashShiftDetail`, `CashMovementRow`, `CreateCashMovementInput`, `CashMovementDetail`, `CloseCashShiftInput`, `CloseCashShiftResponse`.
- `uploads.ts`: `UploadKind` add `'cash-receipt'`.
- `state-machine.ts`: `cashMovementMachine` `PENDING → POSTED | REJECTED | WITHDRAWN` (+spec). `cashShiftMachine` unchanged.
- `company-settings.ts`: `sales.cashDifferenceTolerance: string` (`"0.00"`, decision #17), validated like the other amounts.
- `permissions.ts`: `sales.cash-expenses.approve` ("Aprobar egresos de caja"); management/admin via `ALL_PERMISSIONS`, not cashier.

## API (`apps/api/src/modules/sales/cash/`)
| Method · route | Permission | Error `code`s |
|---|---|---|
| `GET /sales/cash-shifts/:id` (summary for VP-22 / VP-06, includes `expenseApprovalLimit`, denominations, system per method) | `sales.cash-register.open` (own) or `sales.cash-register.review` | `CASH_SHIFT_NOT_FOUND`, `CASH_SHIFT_NOT_OWNED` |
| `POST /sales/cash-shifts/:id/movements` multipart (`type`, `amount`, `concept`, `detail?`, `receipt?`), `Idempotency-Key` | `sales.cash-register.open` (own, open) | `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_REQUIRED`, `CASH_SHIFT_NOT_OPEN`, `CASH_SHIFT_NOT_OWNED`, `INVALID_CASH_AMOUNT`, `INVALID_CASH_CONCEPT`, `CASH_DETAIL_REQUIRED`, `CASH_EXPENSE_EXCEEDS_CASH`, `INVALID_RECEIPT_FILE`, `RECEIPT_TOO_LARGE` |
| `GET /sales/cash-movements/:id` | requester or `sales.cash-expenses.approve` | `CASH_MOVEMENT_NOT_FOUND` |
| `GET /sales/cash-movements/:id/receipt` | same | `CASH_MOVEMENT_NOT_FOUND`, `RECEIPT_NOT_FOUND` |
| `POST /sales/cash-movements/:id/approve` `{ comment? }` | `sales.cash-expenses.approve` | `CASH_MOVEMENT_NOT_PENDING`, `CASH_SHIFT_NOT_OPEN`, `CASH_EXPENSE_EXCEEDS_CASH` |
| `POST /sales/cash-movements/:id/reject` `{ comment }` | `sales.cash-expenses.approve` | `VALIDATION_FAILED`, `CASH_MOVEMENT_NOT_PENDING` |
| `POST /sales/cash-movements/:id/withdraw` | requester | `CASH_MOVEMENT_NOT_PENDING` |
| `POST /sales/cash-shifts/:id/close` `{ counts[], declared, closingFloat, comment? }` | `sales.cash-register.open` (own) | `CASH_SHIFT_NOT_OPEN`, `CASH_SHIFT_NOT_OWNED`, `INVALID_DENOMINATION`, `INVALID_COUNT`, `INVALID_CASH_AMOUNT`, `CLOSING_FLOAT_EXCEEDS_COUNTED`, `CLOSING_COMMENT_REQUIRED`, `CASH_SHIFT_HAS_PENDING_EXPENSES`, `CASH_SHIFT_HAS_PENDING_PAYMENTS` |

Services: `CashShiftSummaryService` (read), `CashMovementsService` (create / approve / reject / withdraw), `CashClosingService`. Amounts travel as decimal strings.
- **Create:** validate file outside the tx (`checkUpload`), store it after commit-safe naming (`<company>/cash-receipt/<movementId>_v1.ext`; orphan file on rollback is acceptable, noted). Tx: idempotency hit → return; `SELECT … FROM cash_shifts … FOR UPDATE` (serialises with close and other expenses; POS takes `FOR SHARE`) → status/owner → for expense compute expected via `shiftCashSummary` and refuse overdraw → `needsExpenseApproval` (and requester lacks approve permission) → `PENDING` + `ApprovalRequest`, else `POSTED`; audit; outbox `sales.cash-movement.created` or `sales.cash-expense.requested`.
- **Approve / reject / withdraw:** lock shift `FOR UPDATE` → movement + request `FOR UPDATE` → `cashMovementMachine` + `approvalRequestMachine` → audit `sales.cash-expense.approve|reject|withdraw` → outbox `sales.cash-expense.decided`.
- **Close:** lock shift `FOR UPDATE` → owner + `OPEN` → refuse pending expenses / pending QR-card payments → abandon OPEN/ON_HOLD checkouts (`posCheckoutMachine`) → expected and system per method from DB → write counts, method totals, shift fields → `cashShiftMachine.close` (+`approve` when no review needed) → `ApprovalRequest CASH_DIFFERENCE` when needed → audit `sales.cash-shift.close` (+ `.approve`) → outbox `sales.cash-shift.closed` (+ `sales.cash-shift.difference`). Verify during build that `lockOpenShift` re-reads `status = 'OPEN'` after taking the lock so a sale queued behind the close fails cleanly.
- New outbox types in `outbox.service.ts`, routed to `QUEUE.accounting` in `apps/worker/src/common/queues.ts` (no consumer yet).

## ERP screens (`apps/erp/src/app/features/sales/cash/`)
- **VP-22 `cash-register.page`** (rewrite): breadcrumb, `rs-page-header` "Caja 1 · turno abierto" + "Abierta hoy a las 08:02 por … con Bs 500,00 · <sucursal>"; 4 `rs-kpi-card` (Efectivo esperado en caja, Ventas del turno "Bs X · N ventas", Ingresos, Egresos); "Movimientos de efectivo" `rs-doc-table` (Hora, Tipo, Concepto, Registró, Monto ±; opening row; `rs-status-pill` Por aprobar / Rechazada / Retirada; `rs-row-menu` Ver comprobante, Retirar solicitud, Revisar for approvers); "Por forma de pago" table; "Cálculo del efectivo" with `rs-data-field` (adds a "Devoluciones y anulaciones" line only when > 0); buttons Registrar ingreso, Registrar egreso, Cerrar caja. "Historial de turnos" hidden until HU-VEN-25. No shift → `/open` as today.
- **VP-22b `cash-movement.dialog`**: `rs-modal` "Registrar movimiento de efectivo", subtitle with expected cash; `rs-filter-chip` Ingreso/Egreso (preselected by the button); `rs-input` numericInput Monto; `rs-select` Concepto (labels in Spanish per code); `rs-input` Detalle (required for "Otro"); `rs-file-dropzone` + `rs-file-item` Comprobante "Opcional. Foto o PDF del recibo."; `rs-note` shown only when the limit is set and exceeded: "Este egreso supera Bs X y queda pendiente de aprobación de Gerencia." (the Figma "PENDIENTES del cliente" text is replaced by the setting); Cancelar / "Registrar egreso|ingreso". `Idempotency-Key` per dialog.
- **VP-06 `cash-closing.page`** (`cash-register/close`): "Cierre y arqueo de caja", subtitle "Caja 1 · turno de … · 08:02 a ahora · cuenta el efectivo por denominación"; "Arqueo de efectivo" table with `rs-qty-stepper` per `CASH_DENOMINATIONS`, subtotals, "Efectivo contado"; "Sistema vs. contado" (Efectivo read-only from the count, QR/Tarjeta/Transferencia editable `rs-input` prefilled with system); `rs-note` warning "Diferencia de −Bs 20,00 en efectivo · Explica la diferencia…" when needed; `rs-textarea` Justificación * (only then); `rs-input` "Efectivo que queda en caja (Bs)" + hint; Cancelar, Recontar, "Cerrar caja y enviar a revisión" (or "Cerrar caja" with no difference). "Reporte diario" not built (no criterion). Success → toast → `/sales/cash-register/open` showing the last close.
- **`cash-expense-review.page`** (`cash-register/movements/:id`): expense detail (amount, concept, detail, cashier, time, receipt link) and approval card like `103:18941` with `rs-textarea` + Rechazar / Aprobar when pending and permitted.
- `sales.routes.ts` (`close`, `movements/:id`), `cash-api.service.ts`, `cash-format.ts` (concept labels), `apps/erp/src/app/core/api-error.ts` messages.
- `libs/ui`: **no new component** (`kpi-card`, `doc-table`, `status-pill`, `row-menu`, `modal`, `filter-chip`, `input`, `select`, `file-dropzone`, `file-item`, `note`, `qty-stepper`, `textarea`, `data-field` cover everything).

## Tests
- **Unit (domain):** `cash-register.spec.ts` (concepts, validation, approval threshold, summary maths incl. refunds and pending exclusion, method totals, denominations, differences with tolerance, closing validation), `state-machine.spec.ts`, `company-settings.spec.ts`, `uploads` spec.
- **Integration (real Postgres):** `cash-shift-summary.int.spec.ts`, `cash-movements.int.spec.ts`, `cash-closing.int.spec.ts` — happy paths atomic (rows + audit + outbox), all guards, approval flow, idempotency, receipts, 403s, tenant isolation, and the concurrency cases above (close × sale, close × expense, close × close, expense × expense, approve × withdraw). `sales-schema.int.spec.ts`: new CHECKs.
- **ERP:** specs for the page, dialog, closing page and review page (states, permissions, validation, live totals, error mapping).
- **E2E** `apps/erp-e2e/src/cash-register.spec.ts`: open with 500 → cash sale → Registrar ingreso + egreso with receipt → VP-22 shows the movements, by-method and expected → Cerrar caja, count with a difference, justify, leave 500 → POS "Caja cerrada" → VP-05 shows the last close. Second test: limit set, expense goes "Por aprobar", Gerencia approves it from the review page, expected updates.
- Agents: `stock-auditor` not needed (no stock writes), `ui-checker`, `reviewer`; then `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default value
- **#16:** `sales.cashExpenseApprovalLimit` = null (never asks); approver permission `sales.cash-expenses.approve` (Management).
- **#17:** any difference needs review → `sales.cashDifferenceTolerance` = `"0.00"`; the review itself is HU-VEN-24.
- **#3:** unchanged (float typed at opening; closing float suggested as the next float).

## Risks and doubts
1. **No approvals inbox yet (HU-VEN-29):** managers reach a pending expense through its URL / the cashier's row menu; the outbox event has no consumer. HU-VEN-29 lists `CASH_EXPENSE` and `CASH_DIFFERENCE` later.
2. Closing is blocked while an expense is pending; the cashier can withdraw it.
3. Denominations follow Figma (down to Bs 0,50); 0,20/0,10 coins are not counted.
4. Concept codes are a first guess from Figma ("Cobro de saldo", "Material de embalaje", "Pago de flete"); the Spanish list is easy to change.
5. A receipt file stored before a rolled-back tx stays orphaned (no cleanup job).
6. "Reporte diario", "Historial de turnos" (HU-VEN-25) and the Accounting review (VP-06b, HU-VEN-24) are out of scope.
7. Refunds (cancellations/returns) and credit sales are not in Figma's VP-22: shown as an extra calc line / by-method row only when non-zero.
8. Card/QR/transfer "declared" amounts are what the cashier reads from the terminal/bank; no reconciliation with a provider.

## Files expected to change
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_cash_movements_and_closing/`, `apps/api/src/common/prisma/tenant.extension.ts`
- `libs/domain/src/lib/{cash-register,uploads,state-machine,company-settings,permissions}.ts` (+specs), `libs/domain/src/index.ts`
- `apps/api/src/modules/sales/cash/**`, `apps/api/src/modules/sales/sales.module.ts`, `pos/pos-payment.service.ts` (export/reuse shift lock), `pos/pos.int-fixture.ts`, `sales-schema.int.spec.ts`
- `apps/api/src/common/outbox/outbox.service.ts`, `apps/worker/src/common/queues.ts`, `apps/api/prisma/seed-base.ts` (setting comment)
- `apps/erp/src/app/features/sales/cash/**`, `sales.routes.ts`, `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/cash-register.spec.ts` (new), `docs/backlog/sales.md` (status), `docs/backlog/decisions.md` (#16/#17 notes)

Overlaps: `outbox.service.ts`, `queues.ts`, `schema.prisma`, `permissions.ts`, `company-settings.ts` are touched by every sales story; must start after HU-VEN-21 merges. HU-VEN-24/25 build on this branch's closing data.

## Verification
Int specs on local Postgres (incl. concurrency), ERP specs, Playwright E2E. Manual: open with Bs 500, sell in cash and QR, register an income and an expense with a photo, check VP-22 numbers; set the limit, register a bigger expense, approve as Gerencia; close with a Bs 20 short, justify, leave 500; POS shows "Caja cerrada" and VP-05 shows "Bs 500,00 dejados en caja". Finish with `pnpm nx affected -t lint typecheck test`.

## After approval
Save to `docs/plans/sales/HU-VEN-22-23.md` (uncommitted; multi-story naming like `HU-VEN-07-11.md`), then run `/story-build HU-VEN-22 HU-VEN-23` in a fresh session.
