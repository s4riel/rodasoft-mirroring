# HU-VEN-15 · Approve or reject a sale cancellation (VP-15c, VP-15d; decision #11) — plan

## Context
HU-VEN-14 lets a cashier request a cancellation (`ApprovalRequest` type `CANCELLATION`, sale `CANCELLATION_PENDING`). This story is the Management side: see the request with its impact (amount, reason, invoice, stock, refund) and **approve** (the sale is cancelled: invoice voided, stock returned, cash refunded) or **reject** with a reply to the requester (sale back to `COMPLETED`). Figma `JYULL6jvXiwNP8UVvEF7tl`: VP-15c `103:11602` (approval page), VP-15d `103:11645` (cancelled sale detail).

**Decisions taken in planning (7 Nov 2026):**
- **Hard dependency on HU-VEN-14.** Branch `feat/hu-ven-15` is cut from `develop` after `feat/hu-ven-14` is merged (it needs the machines' `WITHDRAWN`, `sale-cancellation.ts`, the request endpoints, the VP-15 pending banner and `sale-cancellation.errors.ts`).
- **Cash refund** posts a `REFUND` `CashMovement` to the currently **OPEN shift of the sale's register**; if that register has no open shift, approval is blocked (`CASH_SHIFT_NOT_OPEN_FOR_REFUND`, "Abra la Caja X para registrar el reembolso"). Never posts to a closed shift.
- **QR / card parts:** no provider refund. Approval goes through; the impact text, banner and outbox payload carry "reembolso QR/tarjeta Bs X a gestionar manualmente". No cash movement for them. `CREDIT` parts: nothing to refund (unpaid).
- **Self-approval allowed:** anyone with `sales.cancellations.approve` decides, including the requester (audited).
- **New stock movement type `SALE_CANCELLATION`** ("Anulación de venta"), inward, ref `SALE`.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| I see amount, reason and what will happen (cancels invoice, returns stock, refund) | Int: `GET /sales/sales/:id/cancellation-request` returns `{ request, sale: { number, total, invoice, soldAt }, impact: { invoiceAction, stock: { warehouseName, units }, cashRefund: { amount, registerName, shiftOpen }, manualRefunds: [{ method, amount }] }, audit[] }`. Domain spec `cancellationImpact()` (cash only, mixed cash+QR, card, credit, change netted). Page spec: KPI cards Monto / Factura / Motivo / Tiempo desde la venta, "Qué pasará" sentence, Auditoría list. |
| On approval the sale is cancelled | Int: approve → sale `CANCELLED`, request `APPROVED` (`decided_by_id`, `decided_at`, `comment`), invoice `CANCELLED` (from `PENDING`) or `CANCELLATION_PENDING` (from `VALID`), one `SALE_CANCELLATION` stock movement per sale line (+qty, sale warehouse, `balanceAfter` correct), one `REFUND` cash movement = cash paid net of change on the register's open shift, audit `sales.sale.cancellation-approve`, outbox `sales.cancellation.approved` — all in one tx. **Concurrent double approve (and approve vs withdraw / approve vs reject) → exactly one wins, stock returned once**, loser 409 `CANCELLATION_NOT_PENDING`. No open shift → 409 and nothing written. Page/E2E: VP-15d pill "Anulada", info banner, history "Aprobada por … · factura anulada". |
| On rejection I reply to the requester | Int: reject without comment → 400 `VALIDATION_FAILED`; with comment → request `REJECTED` + `comment`, sale `COMPLETED`, no stock/cash/invoice writes, audit `sales.sale.cancellation-reject`, outbox `sales.cancellation.rejected` with `{ requestedById, comment }` (notification target). Detail for the cashier shows "Anulación rechazada por {user}: {respuesta}" note; they can request again. |
| Who approves (#11) | Int: cashier without `sales.cancellations.approve` → 403 on GET/approve/reject; management → ok. |

## Model
Migration `<ts>_sale_cancellation_decision` (timestamp after `20261107155756_sale_cancellation_request`):
- `StockMovementType` + `SALE_CANCELLATION`.
- No new tables/columns: decision data uses `ApprovalRequest.decidedById/decidedAt/comment` (reserved by HU-VEN-14); cancellation date shown = `decidedAt`. `CashMovementType.REFUND` already exists.
- Check `git branch` / migrations again at build (only HU-VEN-14's migration should precede it).

## Domain (`libs/domain`)
- `state-machine.ts`: `invoiceMachine` adds `void: PENDING → CANCELLED` (pre-SIAT invoice never sent). Sale/approval machines already have `approveCancellation`/`rejectCancellation` and `approve`/`reject`. Update spec.
- `stock.ts` `STOCK_MOVEMENT_TYPES` + `SALE_CANCELLATION`; `kardex.ts` label "Anulación de venta"; inward list in `StockMovementService.assertOrigin`.
- `sale-cancellation.ts` (from 14) adds: `CANCELLATION_REPLY_MAX = 500`, `validateCancellationDecision({ decision, comment })` (reject requires non-blank comment), `cancellationImpact(sale)` → `{ invoiceAction: 'VOID' | 'REQUEST_SIAT_CANCELLATION' | 'BLOCKED', stockUnits, cashRefund: Decimal, manualRefunds }` using `Decimal`, `invoiceCancellationEvent(status)` (`PENDING → void`, `VALID → requestCancellation`, other → null). Contract types `CancellationReview`, `CancellationDecisionInput`. Export from `index.ts`.

## API (`apps/api/src/modules/sales/sales/`)
`sale-cancellation.service.ts` (from 14) gains `getReview`, `approve`, `reject`; routes on the same controller.

| Method · route | Permission | Error `code`s |
|---|---|---|
| `GET /sales/sales/:id/cancellation-request` | `sales.cancellations.approve` | `SALE_NOT_FOUND`, `CANCELLATION_NOT_PENDING` |
| `POST /sales/sales/:id/cancellation-request/approve` `{ comment? }` | `sales.cancellations.approve` | `VALIDATION_FAILED`, `SALE_NOT_FOUND`, `CANCELLATION_NOT_PENDING`, `CASH_SHIFT_NOT_OPEN_FOR_REFUND`, `INVOICE_NOT_CANCELLABLE` (invoice `SENDING`/`CONTINGENCY`/…) |
| `POST /sales/sales/:id/cancellation-request/reject` `{ comment }` | `sales.cancellations.approve` | `VALIDATION_FAILED`, `SALE_NOT_FOUND`, `CANCELLATION_NOT_PENDING` |
| `GET /sales/sales/:id` | existing | `cancellation` gains `lastDecision: { status, decidedBy, decidedAt, comment } \| null` and `canReview` |

**Approve tx** (lock order consistent with POS completion to avoid deadlocks: shift → sale → stock): find the sale's register open shift `cashShift.findFirst({ registerId, status: 'OPEN' })` and lock it `FOR SHARE` (reuse/extract `lockOpenShift` pattern from `pos-payment.service.ts`) only if cash refund > 0 → `SELECT … FROM sales … FOR UPDATE` → pending request `FOR UPDATE` (none → `CANCELLATION_NOT_PENDING`) → `saleMachine 'approveCancellation'`, `approvalRequestMachine 'approve'`, `invoiceMachine` via `invoiceCancellationEvent` → per line, sorted by productId, `StockMovementService.apply(tx, { type: 'SALE_CANCELLATION', quantity: +qty, warehouseId: sale.warehouseId, refType: 'SALE', refId, refNumber, reason: 'Anulación venta V-…' })` → `cashMovement.create({ type: 'REFUND', amount: -cash? per existing sign convention, refType: 'SALE' })` → updates → `AuditService.log(…, tx)` → `OutboxService.publish('sales.cancellation.approved', { saleId, saleNumber, requestId, requestedById, invoiceId, invoiceAction, cashRefund, manualRefunds }, { tx, idempotencyKey: 'cancellation-approved:<requestId>' })`. Reject tx: sale + request lock, two transitions, audit, outbox `sales.cancellation.rejected`. All via `prisma.tenant`. Visibility: approver holds view-all; reuse `sale-visibility.service`.

## ERP screens (`apps/erp/src/app/features/sales/history/`)
- **VP-15c `sale-cancellation-review.page`** (`.ts/.html/.scss/.spec`), route `ventas-realizadas/:id/anulacion` guarded by `sales.cancellations.approve`: breadcrumb, title "Aprobar anulación · Venta {n}" + `rs-status-pill` "Por aprobar", subtitle "Solicitada por {user} el {fecha} · {almacén}"; 4 `rs-kpi-card` (Monto, Factura "{n} · {estado}", Motivo, Tiempo desde la venta); "Solicitud" card with `rs-data-field` Comentario / Qué pasará; "Auditoría" card (audit entries + "Pendiente: aprobación de Gerencia"); "Respuesta (opcional)" `rs-input`/`rs-textarea` (confirm with `get_design_context`) — required when rejecting (inline error); `rs-button` "Rechazar" (ghost) and "Aprobar y anular en el SIAT" (primary, confirm `rs-modal`); `rs-note` warning when the register is closed with the button disabled. After decision → navigate to the detail.
- **VP-15 detail (from 14):** "Ver solicitud (Gerencia)" button shown when `canReview`; rejected-decision `rs-note`.
- **VP-15d detail state:** pill "Anulada", info `rs-note` "Venta anulada · Factura {n} anulada · {u} piezas devueltas a {almacén} · reembolso Bs {x} registrado en {caja}[ · reembolso QR/tarjeta Bs y a gestionar manualmente]", invoice card "Anulada" + date/by, history "Aprobada por …". "Emitir nueva venta" → POS. **"Ver factura anulada" not rendered** (SIAT invoice view is HU-FAC).
- `sale-format.ts` labels (history actions, invoice actions), `api-error.ts` messages for new codes, `sales-history-api.service.ts` three calls, kardex `movement.mapper.ts` for `SALE_CANCELLATION`.
- No new `libs/ui` component.

## Tests
- **Unit:** domain `sale-cancellation.spec.ts` (impact for cash/mixed/QR/card/credit with change; decision validation; invoice event map), `state-machine.spec.ts` (`void`), kardex label; review page spec (KPIs, impact text, reject needs reply, closed-register warning, buttons by permission), detail page spec (Ver solicitud, cancelled banner, rejected note), `sale-format.spec.ts`.
- **Integration (real Postgres) `sale-cancellation-decision.int.spec.ts`:** approve happy path atomic (sale, request, invoice, stock movements + `stock_levels`, refund, audit, outbox); mixed cash+QR refunds only cash; **concurrent approve×2, approve×reject, approve×withdraw → one wins, stock returned once**; approve while a POS sale on the same products runs (no deadlock); no open shift → 409 nothing written; invoice `VALID` → `CANCELLATION_PENDING`; reject validation/happy path/no side effects; re-request after reject; permissions 403; tenant isolation.
- **E2E `apps/erp-e2e/src/sale-cancellation-approval.spec.ts`:** cashier sells and requests → manager opens Ver solicitud → approves → "Anulada" + banner + kardex shows "Anulación de venta"; second sale request → reject with reply → cashier sees reply and "Completada".
- **Agents:** `stock-auditor` (block F), `ui-checker`, `reviewer`; then `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default
- **#11** who approves: permission `sales.cancellations.approve` (Gerencia + admin by default; assignable per company through roles). Self-approval allowed.
- **#10** window: enforced only at request time (HU-VEN-14); approval does not re-check.

## Risks and doubts
1. HU-VEN-14 is unfinished; names (errors file, service, DTOs) may shift — adapt at build.
2. Invoice cancellation in SIAT is HU-FAC-10: here a `PENDING` invoice is voided locally; a `VALID` one goes to `CANCELLATION_PENDING` and the `sales.cancellation.approved` event is the hook for SIAT. The button keeps the Figma label "Aprobar y anular en el SIAT".
3. Refund requires the sale's register to be open; until HU-VEN-23 nobody closes shifts, so the block is rare now but real later.
4. QR/card manual refunds are only text + outbox; real refunds come with provider adapters / HU-VEN-21.
5. Approvals inbox and bell (HU-VEN-29) consume the outbox events later; entry today is the "Ver solicitud" button on the detail.

## Files expected to change
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_sale_cancellation_decision/`
- `libs/domain/src/lib/{state-machine,sale-cancellation,stock,kardex}.ts` (+ specs), `libs/domain/src/index.ts`
- `apps/api/src/modules/inventory/stock-movement.service.ts` (inward list)
- `apps/api/src/modules/sales/sales/**` (cancellation service/controller/DTO/errors/int spec, detail payload), possibly `apps/api/src/modules/sales/pos/pos-payment.service.ts` (extract shift lock helper)
- `apps/erp/src/app/features/sales/history/**`, `apps/erp/src/app/features/sales/sales.routes.ts`, `apps/erp/src/app/core/api-error.ts`, `apps/erp/src/app/features/inventory/products/sheet/movements/movement.mapper.ts`
- `apps/erp-e2e/src/sale-cancellation-approval.spec.ts`
- `docs/backlog/sales.md` (status of HU-VEN-15)

## Verification
Int specs on local Postgres, ERP unit specs, Playwright E2E. Manual: as cashier sell in cash and request; as Gerencia open the request, check impact text, approve; verify kardex row, cash register shows the refund, sale "Anulada". Repeat with reject + reply. Finish with `pnpm nx affected -t lint typecheck test`.

