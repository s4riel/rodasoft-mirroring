# HU-VEN-14 · Request a sale cancellation (VP-15a, VP-15; decision #10) — plan

## Context
A cashier who made a mistake (wrong customer data, wrong items, sale not concluded) must not cancel a sale alone: they request it with a reason and a comment, and the sale stays **"Anulación pendiente"** until Management decides (HU-VEN-15). This story creates the first `ApprovalRequest` rows (type `CANCELLATION`), drives `saleMachine.requestCancellation`, and adds the request dialog (VP-15a) and the pending state on the sale detail (VP-15). Figma `JYULL6jvXiwNP8UVvEF7tl`: VP-15a `103:11408`, VP-15 `103:11513`.

**Decisions taken in planning (5 Nov 2026):**
- **Branch `feat/hu-ven-14` is cut from `develop` after `feat/hu-ven-12-13` is merged** — it needs the sale detail page (VP-02), `GET /sales/sales/:id`, the visibility-scope helper and the row menu from that branch.
- **"Retirar solicitud" is in scope:** the requester (or a holder of `sales.cancellations.approve`) can withdraw a pending request; the sale goes back to `COMPLETED`.
- Nothing happens to the invoice, stock or cash on request. Figma: "La factura sigue válida hasta que Gerencia apruebe". Those effects belong to the approval (HU-VEN-15).

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| I choose the reason and add a comment | Domain spec: `CANCELLATION_REASONS` + `validateCancellationRequest` (unknown reason, empty/blank comment, >500 chars → errors). Int: `POST …/cancellation-request` with a bad reason or empty comment → 400 `VALIDATION_FAILED`; valid → 201 and the `approval_requests` row has `type=CANCELLATION`, `reason`, `requester_comment`, `requested_by_id`. Dialog spec: "Enviar solicitud" disabled until one chip and a comment are set; only one chip selected at a time. |
| The sale stays "anulación pendiente" until Management decides | Int: after the request the sale is `CANCELLATION_PENDING`; a second request → 409 `CANCELLATION_ALREADY_PENDING`; concurrent double request → exactly one row (partial unique index + row lock); request on a `CANCELLED` sale → 409 `SALE_NOT_CANCELLABLE`. Detail returns `cancellation.pending` (who, when, reason). Page spec: status pill "Anulación pendiente", warning banner, "Solicitar anulación" hidden, "Retirar solicitud" shown. Stock/cash/invoice untouched (int asserts no `stock_movements`, `cash_movements` or invoice status change). |
| Window (decision #10) | Int: `sales.cancellationWindowDays = 2` and a sale 3 La Paz days old → 409 `CANCELLATION_WINDOW_EXPIRED`; `null` (default) → always allowed. |
| Withdraw (Figma VP-15) | Int: requester withdraws → request `WITHDRAWN`, sale `COMPLETED`, can request again; another cashier → 403 `CANCELLATION_WITHDRAW_FORBIDDEN`; with approve permission → allowed; withdraw when not pending → 409 `CANCELLATION_NOT_PENDING`. |
| Audit/outbox | Int: one `AuditLog` per action (`sales.sale.cancellation-request`, `sales.sale.cancellation-withdraw`, entity `Sale`) — so HU-VEN-13's history shows them — and one outbox row `sales.cancellation.requested` / `sales.cancellation.withdrawn` per action, written in the same tx. |

## Model
Migration `<ts>_sale_cancellation_request`:
- `ApprovalStatus` + `WITHDRAWN`.
- `ApprovalRequest`: new `requesterComment String? @map("requester_comment")`. Field docs: `reason` = reason code (`CANCELLATION_REASONS` for type `CANCELLATION`), `comment` = the decider's reply (HU-VEN-15), `decidedById/decidedAt` are also set on withdraw.
- Raw SQL partial unique index `approval_requests_one_pending_uq ON approval_requests (company_id, type, subject_id) WHERE status = 'PENDING'`.
- `ApprovalRequest` is already in `TENANT_MODELS`; no new tables. Check that no open branch adds migrations after `20261105180000_pos_mixed_payment` (12-13 adds `sales_history_indexes`; take a later timestamp).

## Domain (`libs/domain`)
- `state-machine.ts`: `saleMachine` adds `withdrawCancellation: CANCELLATION_PENDING → COMPLETED`; `approvalRequestMachine` adds `WITHDRAWN` and `withdraw: PENDING → WITHDRAWN`. Update the existing machine specs.
- New `sale-cancellation.ts` (+ spec): `CANCELLATION_REASONS = ['CUSTOMER_DATA_ERROR', 'ITEMS_OR_PRICES_ERROR', 'SALE_NOT_COMPLETED', 'OTHER']`, `CANCELLATION_COMMENT_MAX = 500`, `validateCancellationRequest(input)`, `cancellationWindowEndsAt(saleAt, days | null)` (La Paz calendar days; `null` → no limit), `isWithinCancellationWindow(now, saleAt, days)`. Contract types `CancellationRequestInput`, `SaleCancellationState` (`{ canRequest, windowEndsAt, pending: { id, reason, comment, requestedBy, requestedAt } | null }`). Export from `index.ts`.
- `company-settings.ts`: `sales.cancellationWindowDays` already exists (default `null`); no change.

## API (`apps/api/src/modules/sales/sales/`)
New `sale-cancellation.service.ts` + routes on the `sales/sales` controller (or a sibling `sale-cancellation.controller.ts`). Reuses the 12-13 visibility-scope helper (a cashier without view-all can only act on their own sales → 404 `SALE_NOT_FOUND`).

| Method · route | Permission | Error `code`s |
|---|---|---|
| `POST /sales/sales/:id/cancellation-request` `{ reason, comment }` | `sales.cancellations.request` | `VALIDATION_FAILED`, `SALE_NOT_FOUND`, `SALE_NOT_CANCELLABLE`, `CANCELLATION_ALREADY_PENDING`, `CANCELLATION_WINDOW_EXPIRED` |
| `POST /sales/sales/:id/cancellation-request/withdraw` | `sales.cancellations.request` or `sales.cancellations.approve` | `SALE_NOT_FOUND`, `CANCELLATION_NOT_PENDING`, `CANCELLATION_WITHDRAW_FORBIDDEN` |
| `GET /sales/sales/:id` (from 12-13) | existing | adds `cancellation: SaleCancellationState` and the impact data the dialog needs (warehouse name, register name, total) |

Request transaction: `SELECT … FROM sales WHERE id = $1 AND company_id = $2 FOR UPDATE` → `saleMachine.transition(status, 'requestCancellation')` (machine error → `SALE_NOT_CANCELLABLE`) → window check with `SettingsService` → `approvalRequest.create` (unique violation P2002 → `CANCELLATION_ALREADY_PENDING`) → `sale.update(status)` → `AuditService.log(…, tx)` → `OutboxService.publish('sales.cancellation.requested', { saleId, saleNumber, requestId, reason, total, requestedById }, { tx, idempotencyKey: 'cancellation-requested:<requestId>' })`. Withdraw mirrors it with `withdrawCancellation` / `withdraw`. All through `prisma.tenant`. Errors in `sale-cancellation.errors.ts`. No stock, cash or invoice writes.

## ERP screens (`apps/erp/src/app/features/sales/history/`)
- **VP-15a `sale-cancellation.dialog`** (`.ts/.html/.scss/.spec`): `rs-modal`; title "Solicitar anulación de la venta {n}", subtitle "Factura … · Bs … La factura sigue válida hasta que Gerencia apruebe."; reason chips with `rs-filter-chip` (single-select handled by the dialog; the Figma selected chip with × matches its On state); "Comentario *" with `rs-input` (or `rs-textarea` if the Figma field maps to it — confirm with `get_design_context` at build); impact `rs-note` warning: "Al aprobarse se anula la factura en el SIAT. El stock vuelve a {almacén} y el reembolso de Bs {total} se registra en {caja}. Plazo de anulación: {fecha | sin límite}."; `rs-button` "Cancelar" / "Enviar solicitud" (loading state; API errors translated).
- **VP-02 detail page (from 12-13):** "Solicitar anulación" shown when `cancellation.canRequest` and `rs-can` `sales.cancellations.request`; on success reload. **VP-15 state:** status pill "Anulación pendiente", warning `rs-note` "Anulación pendiente de aprobación · Solicitada por {user} el {fecha} · motivo: {motivo}. La factura sigue válida.", "Retirar solicitud" (confirm `rs-modal`). "Ver solicitud (Gerencia)" is **not** rendered — HU-VEN-15.
- **Row menu (VP-01d, from 12-13):** add "Solicitar anulación" (opens the same dialog) under the same condition.
- `sale-format.ts`: Spanish labels for reasons and history actions ("Anulación solicitada", "Solicitud de anulación retirada"). `api-error.ts`: Spanish messages for the new codes. `sales-history-api.service.ts`: two new calls.
- No new `libs/ui` component needed.

## Tests
- **Unit:** `sale-cancellation.spec.ts` (reasons, validation, window in La Paz incl. 23:30 local edge); `state-machine.spec.ts` (new events/state); dialog spec (chip single-select, required fields, submit payload, error message, impact text with and without window); detail page spec (button visibility by status/permission, pending banner, withdraw); row menu spec; `sale-format.spec.ts`.
- **Integration (real Postgres), `sale-cancellation.int.spec.ts`:** happy path writes request + status + audit + outbox atomically; validation; already pending; **concurrent double request → one succeeds, one `CANCELLATION_ALREADY_PENDING`**; window expired / null; not cancellable; visibility (other cashier → 404); permission (no `sales.cancellations.request` → 403); withdraw (requester, other cashier 403, approver ok, not pending 409, re-request after withdraw); no stock/cash/invoice changes; tenant isolation.
- **E2E:** `apps/erp-e2e/src/sale-cancellation.spec.ts`: cash sale → detail → Solicitar anulación → pick "Error en datos del cliente" + comment → pill "Anulación pendiente" and banner → history shows "Anulación solicitada" → Retirar solicitud → back to "Completada".
- **Agents:** `stock-auditor` (block F; confirm no stock change), `ui-checker`, `reviewer`; then `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default
- **#10** cancellation deadline: `sales.cancellationWindowDays` (per company, already seeded `null` = no limit). When set, requests past the window are blocked and the dialog shows the deadline.
- **#11** who approves: not used here beyond letting `sales.cancellations.approve` withdraw; approval is HU-VEN-15.

## Risks and doubts
1. Hard dependency on `feat/hu-ven-12-13` (detail page, detail endpoint, scope helper, row menu, `sale-format.ts`). If 12-13 changes those names during review, adapt at build.
2. The cash-impact sentence names the sale's register; if the shift is closed by approval time, HU-VEN-15 decides where the refund posts. HU-VEN-14 only displays it.
3. Invoice status stays `PENDING`/`VALID`: `invoiceMachine.requestCancellation` is only valid from `VALID` and belongs to SIAT (HU-FAC-10), so it's not touched here.
4. Notifying Management (bell) is only the outbox event; the approvals inbox (HU-VEN-29) consumes it later.

## Files expected to change
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_sale_cancellation_request/`
- `libs/domain/src/lib/state-machine.ts` (+ spec), `libs/domain/src/lib/sale-cancellation.ts` (+ spec), `libs/domain/src/index.ts`
- `apps/api/src/modules/sales/sales/**` (cancellation service/controller/DTO/errors/int spec; detail payload), `apps/api/src/modules/sales/sales.module.ts`
- `apps/erp/src/app/features/sales/history/**` (dialog, detail page, row menu, api service, `sale-format.ts`), `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/sale-cancellation.spec.ts`
- `docs/backlog/sales.md` (status of HU-VEN-14)

## Verification
Int specs against local Postgres, ERP unit specs and the Playwright E2E. Manual: as a cashier request a cancellation of an own sale (pill + banner + history), try a second request (error), withdraw it; set `sales.cancellationWindowDays` to 0 and check the block. Finish with `pnpm nx affected -t lint typecheck test`.
