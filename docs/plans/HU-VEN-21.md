# HU-VEN-21 · Returns with credit-debit note (VP-20, VP-10, VP-21; decision #15) — plan

## Context
A cashier registers a return of a sale: picks the sale and the returned lines, each line goes **to stock** or **to scrap (merma)**, the customer is refunded, and a **nota de crédito y débito** linked to the original invoice is created for the SIAT epic to issue. `SaleReturn` / `SaleReturnItem`, `RefundMethod`, `ApprovalType.RETURN`, `StockMovementType.RETURN` ("Devolución" label), the `DEV-` series (`sales-numbering.ts`), `CashMovementType.REFUND` and the permission `sales.returns.manage` (cashier + management) already exist; nothing writes them. The "Devoluciones" tab is a placeholder in `sales-tabs.ts`.

Branch `feat/hu-ven-21` cut from `develop` after HU-VEN-14/15/20 are merged (needs `SaleOrigin`, nullable `shiftId`, the cancellation flow and `dispatchTotals`). Figma `JYULL6jvXiwNP8UVvEF7tl` page 09: VP-20 `103:18057` (list), VP-10 `103:18081` (new return), VP-21 `103:18152` (detail), note stat `103:18188`, approval card `103:18949`.

**Decisions taken in planning (9 Nov 2026):**
- **Refund methods follow Figma:** `CASH` ("Efectivo de caja"), `STORE_CREDIT` ("Saldo a favor", rename of `CREDIT_NOTE`), `TRANSFER` ("Transferencia", reference required). The SIAT credit-debit note is issued on **every** approved return, whatever the refund method. Store credit is only recorded (return + outbox) until a customer balance exists (HU-CON-03 / CRM); it needs an identified customer.
- **Full approval flow behind a setting** `sales.returnApprovalLimit` (default `null` = never asks, decision #15). Above the limit the return is `PENDING_APPROVAL` with an `ApprovalRequest` type `RETURN`; new permission `sales.returns.approve` decides on VP-21. Stock, refund and credit note happen only on approval.
- **Scrap lines write no stock movement.** Only "A stock" lines write `RETURN +n`; "A merma" lines are kept on the item (`condition = SCRAP`) and counted in the "A merma" KPI.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| I choose the sale and the returned products | Int `sale-returns.int.spec.ts`: `GET /sales/returns/sale-lookup?q=` finds a sale by number or customer NIT and returns lines with sold / already returned / returnable. `POST /sales/returns` with 2 of 3 lines → `DEV-000001`, items with quantity, condition and refund amount. Guards: over-return (also summing earlier non-rejected returns) → `RETURN_EXCEEDS_SOLD` with per-line details; empty → `RETURN_EMPTY`; cancelled / cancellation-pending sale → `SALE_NOT_RETURNABLE`; window setting exceeded → `RETURN_WINDOW_EXPIRED`. Form spec (VP-10): lookup, steppers capped at returnable, condition chips, refund chips, live total, button disabled with 0 pieces. |
| A linked credit and debit note is generated | Int: an approved return creates one `CreditNote` (`PENDING`, `invoiceId` = original invoice, total = return total, customer tax data copied) and publishes `sales.return.completed` `{ returnId, creditNoteId, invoiceId, saleId, … }` in the same tx (SIAT hook). A pending-approval return has no note until approved; a rejected one never gets one. Detail spec shows "Nota de crédito y débito · Pendiente". |
| Stock returns to the branch | Int: one `RETURN` movement `+n` per "A stock" line into `sale.warehouseId` (`refType SALE_RETURN`, `refNumber DEV-…`, `balanceAfter` right), none for scrap lines; works for POS and ORDER sales. **Concurrency:** two returns of the last returnable piece at once → one wins, stock +1 once; return vs cancellation request on the same sale → serialised, never both; return vs POS sale of the same product → no deadlock. Repeated `Idempotency-Key` returns the first return. |
| Refund (#15) | Int: `CASH` posts a `REFUND` cash movement on the caller's open shift (none → `CASH_SHIFT_REQUIRED`); `STORE_CREDIT` without customer → `STORE_CREDIT_NEEDS_CUSTOMER`; `TRANSFER` without reference → `TRANSFER_REFERENCE_REQUIRED`; no cash movement for those two. |
| Approval setting | Int: with `sales.returnApprovalLimit = 100`, a Bs 245 return → `PENDING_APPROVAL` + `ApprovalRequest`, no stock/cash/note; approve (with `sales.returns.approve`) → all of it in one tx, cash posted to the open shift of the register where it was requested (closed → `CASH_SHIFT_NOT_OPEN_FOR_REFUND`); reject needs a comment, writes nothing else. Double approve / approve×reject → one wins (`RETURN_NOT_PENDING`). 403 without the permission. Null limit → approved at once. |

## Model
Migration `<ts>_sale_returns` (after `20261109120000_order_dispatch`):
- `RefundMethod`: rename `CREDIT_NOTE` → `STORE_CREDIT`, add `TRANSFER`.
- New enums `SaleReturnStatus { PENDING_APPROVAL APPROVED REJECTED }`, `ReturnItemCondition { RESTOCK SCRAP }`.
- `sale_returns`: add `status`, `reason` (code, validated in domain), `comment String?`, `refund_reference String?`, `register_id String? @db.Uuid` (register of the requesting cashier, used for a cash refund on approval), `shift_id String?` (shift that paid the cash refund), `idempotency_key` + `@@unique([companyId, idempotencyKey])`, `approved_at timestamptz?`, `@@index([companyId, status, createdAt(sort: Desc)])`. **Drop** `credit_note_invoice_id` (unused) in favour of the `CreditNote.returnId` relation.
- `sale_return_items`: add `condition`, `refund_amount Decimal(14,2)`, `@@index([companyId, saleItemId])`. Raw CHECKs: `quantity > 0`, `refund_amount >= 0`, `sale_returns.total >= 0`.
- New `CreditNote` (`credit_notes`): `companyId`, `returnId @unique`, `invoiceId` (original invoice), `number Int?`, `status InvoiceStatus @default(PENDING)`, `total`, `customerTaxName/DocumentType/DocumentNumber`, timestamps, `@@index([companyId, status])`. Add `CreditNote` to `TENANT_MODELS` (`tenant.extension.ts`).
- No new stock movement type (`RETURN` exists, already inward in `StockMovementService`). `CashMovementType.REFUND` exists.

## Domain (`libs/domain`)
- New `sale-return.ts` (+spec): `RETURN_REASONS` (from the Figma dropdown, e.g. `FACTORY_DEFECT`, `WRONG_PRODUCT`, `CUSTOMER_CHANGED_MIND`, `OTHER` — confirm options with `get_design_context` on VP-10), `RETURN_COMMENT_MAX`, `returnableQuantity(saleItem, previousReturnItems)`, `validateReturnRequest(...)` → errors per line, `isWithinReturnWindow(soldAt, now, days)`, `returnTotals(sale, lines, previousReturns)` → per-line refund + total: customer discount and rounding pro-rata to the line, the return that completes the sale takes the remainder so Σ refunds = `sale.total` exactly (extract the shared pro-rata helper from `sales-order-dispatch.ts` `dispatchTotals`), `needsReturnApproval(total, limit)`, `returnTimeline(ret)` (Solicitada / Aprobada / Nota emitida / Reembolsada). Contracts: `CreateSaleReturnInput`, `SaleReturnSummary`, `SaleReturnDetail`, `ReturnableSale`.
- `state-machine.ts`: `saleReturnMachine` `PENDING_APPROVAL → APPROVED | REJECTED` (a return under the limit is created `APPROVED`). Update spec.
- `company-settings.ts`: `sales.returnApprovalLimit: string | null` (null), `sales.returnWindowDays: number | null` (null); validation like `cashExpenseApprovalLimit` / `cancellationWindowDays`.
- `permissions.ts`: `sales.returns.approve` ("Aprobar devoluciones"); management/admin get it through `ALL_PERMISSIONS`, cashier does not.
- `sale-cancellation.ts`: request validation refuses a sale with non-rejected returns (`SALE_HAS_RETURNS`), so stock is never returned twice.

## API (`apps/api/src/modules/sales/returns/`)
| Method · route | Permission | Error `code`s |
|---|---|---|
| `GET /sales/returns?status&page` (list + KPIs: this month, amount returned, pending, scrap pieces) | `sales.returns.manage` | — |
| `GET /sales/returns/sale-lookup?q=` | `sales.returns.manage` | `SALE_NOT_FOUND` |
| `POST /sales/returns` (`Idempotency-Key` required) | `sales.returns.manage` | `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_REQUIRED`, `SALE_NOT_FOUND`, `SALE_NOT_RETURNABLE`, `RETURN_WINDOW_EXPIRED`, `SALE_ITEM_NOT_FOUND`, `RETURN_EMPTY`, `RETURN_EXCEEDS_SOLD` (`details.items[]`), `STORE_CREDIT_NEEDS_CUSTOMER`, `TRANSFER_REFERENCE_REQUIRED`, `CASH_SHIFT_REQUIRED` |
| `GET /sales/returns/:id` | `sales.returns.manage` or `sales.returns.approve` | `RETURN_NOT_FOUND` |
| `POST /sales/returns/:id/approve` `{ comment? }` | `sales.returns.approve` | `RETURN_NOT_FOUND`, `RETURN_NOT_PENDING`, `CASH_SHIFT_NOT_OPEN_FOR_REFUND` |
| `POST /sales/returns/:id/reject` `{ comment }` | `sales.returns.approve` | `VALIDATION_FAILED`, `RETURN_NOT_FOUND`, `RETURN_NOT_PENDING` |
| `GET /sales/sales/:id` (existing) | existing | adds `returns[]` (number, status, total) and `returnable` |

`SaleReturnsService.create`, one `prisma.tenant.$transaction`: idempotency hit → return it; if `CASH` and approval not needed, lock the caller's open shift `FOR SHARE` (reuse the `lockOpenShift` pattern of `pos-payment.service.ts`) → `SELECT sales … FOR UPDATE` (same lock the cancellation service takes) → status + window + validation against earlier non-rejected returns → `nextDocumentNumber(tx, companyId, 'return')` → create return + items. If approval needed: `ApprovalRequest` (`RETURN`, subject = return), audit `sales.return.request`, outbox `sales.return.requested`. Otherwise `applyApprovedReturn(tx, …)`: per RESTOCK line sorted by productId `StockMovementService.apply({ type: 'RETURN', +qty, warehouseId: sale.warehouseId, refType: 'SALE_RETURN', refId, refNumber, reason: 'Devolución DEV-… · venta V-…' })`; `CASH` → `cashMovement.create({ type: 'REFUND', amount, refType: 'SALE_RETURN' })`; `CreditNote` from the sale's `Invoice`; audit `sales.return.approve`; outbox `sales.return.completed` (`idempotencyKey: 'return-completed:<id>'`). Approve: shift (register's open shift, if cash) → sale → return `FOR UPDATE` → machines → `applyApprovedReturn`. Reject: return + request lock, transitions, audit, outbox `sales.return.rejected`. Lock order matches POS completion and HU-VEN-15 (shift → sale → stock). Add the three outbox types in `outbox.service.ts` and route them in `apps/worker/src/common/queues.ts`.
`sale-cancellation.service.ts`: refuse a request on a sale with returns (`SALE_HAS_RETURNS`).

## ERP screens (`apps/erp/src/app/features/sales/returns/`)
- **VP-20 `returns.page`**: `rs-page-header` "Devoluciones" + subtitle, 4 `rs-kpi-card` (Este mes, Monto devuelto, Por aprobar, A merma), `rs-doc-table` (N.º, Cliente, Venta, Ítems, Total, Estado `rs-status-pill`: Nota emitida / Aprobada / Por aprobar / Rechazada, `rs-row-menu`), totals row, `rs-pagination`, "Nueva devolución" button. Loading/empty/error/no-permission states. "Exportar" not built (no criterion asks for it).
- **VP-10 `return-form.page`** (`devoluciones/nueva`, also reached from the sale detail with `?sale=`): "Venta original" card (`rs-input` lookup + `rs-select` Motivo + caption with customer / date / total / window), "¿Qué vuelve?" table (product, Vendido, `rs-qty-stepper` capped at returnable, `rs-filter-chip` pair A stock / A merma), "Reembolso" card (A devolver Bs total preview from `returnTotals`; chips Efectivo de caja / Saldo a favor / Transferencia; `rs-input` reference for transfer), `rs-note` info "Se emite una nota de crédito y débito por Bs X sobre la factura N…" and warning when the amount needs approval, buttons Cancelar / "Emitir nota y devolver" (or "Enviar a aprobación"). `Idempotency-Key` per form; server errors on their line.
- **VP-21 `return-detail.page`**: title "Devolución DEV-…", subtitle customer · sale · date; `rs-status-timeline` (Solicitada, Aprobada, Nota emitida, Reembolsada); `rs-kpi-card` Monto / Piezas / Nota de crédito y débito / Reembolso; "Productos devueltos" with `rs-data-field`; "Auditoría" card; approval card (`rs-textarea` reply, Rechazar / Aprobar) when `PENDING_APPROVAL` and `sales.returns.approve`; actions "Volver a devoluciones", "Ver venta original". "Imprimir nota" not rendered (credit note print is HU-FAC). The Figma "Límite de aprobación: PENDIENTE" note is not shown (the setting replaces it).
- Sale detail (`history/sale-detail.page`): "Registrar devolución" button (permission + returnable) and a "Devoluciones" list; the cancellation button hidden when the sale has returns.
- `sales.routes.ts` (`returns` in `BUILT_TABS`, `new`, `:id`), `api-error.ts` messages, kardex `movement.mapper.ts` already labels `RETURN`.
- `libs/ui`: no new component (`filter-chip`, `qty-stepper`, `status-timeline`, `kpi-card`, `doc-table`, `note` cover it).

## Tests
- **Unit (domain):** `sale-return.spec.ts` (returnable quantity, validation, window, `returnTotals` exact over 1–3 returns with PERCENT/AMOUNT discount and rounding modes, approval threshold, timeline), `state-machine.spec.ts`, `company-settings.spec.ts`, `sale-cancellation.spec.ts` (`SALE_HAS_RETURNS`).
- **Integration (real Postgres) `sale-returns.int.spec.ts`:** happy path atomic (return, items, stock movements + `stock_levels`, refund, credit note, audit, outbox); scrap lines no movement; ORDER sale; each refund method + guards; window; approval path (pending → approve / reject, closed shift); **concurrency** (two returns of the last piece, approve×approve, approve×reject, return × cancellation request, return × POS sale on the same product); idempotency; rollback when a line fails; 403; tenant isolation. `sales-schema.int.spec.ts`: new CHECKs. `sale-cancellation.int.spec.ts`: request on a sale with returns → 409.
- **ERP:** specs for the three pages (states, caps, chips, totals, approval card by permission, error mapping) and the sale-detail additions.
- **E2E** `apps/erp-e2e/src/sale-return.spec.ts`: sell 2 products in cash → Devoluciones → Nueva → return 1 to stock + 1 to scrap in cash → detail shows note Pendiente and Reembolso Efectivo; kardex shows "Devolución" only for the stock line; with the limit set, a return goes Por aprobar and Gerencia approves it.
- Agents: `stock-auditor` (block F), `ui-checker`, `reviewer`; then `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default value
- **#15** deadline: `sales.returnWindowDays` = null (no deadline). Approval limit: `sales.returnApprovalLimit` = null (never asks). Refund methods: cash, store credit, transfer (per Figma; decision text says cash or credit note).

## Risks and doubts
1. **Store credit has no ledger** until HU-CON-03 / CRM: it is a recorded amount + outbox event only; nobody can spend it yet.
2. **Credit note issuing is HU-FAC:** here it is a `PENDING` record; the original invoice may itself be `PENDING` (pre-SIAT). The SIAT consumer must send them in order.
3. **Refund amount vs payment method:** a sale paid by card/QR/credit can be refunded in cash; no rule ties them (Figma does not). A credit (unpaid) sale refunded in cash is allowed but odd — flagged for accounting.
4. **Rounding:** refunds are exact cents from the pro-rata share; `sales.roundingMode` is not applied to the refund.
5. Sale lookup searches by sale number and NIT; search by invoice number waits for HU-FAC (invoice `number` is null today).
6. A sale with returns can no longer be cancelled (HU-VEN-14 guard); a later return after a cancellation is impossible too.
7. Returning an ORDER sale does not touch the order's `dispatchedQuantity`.
8. Scrap pieces leave no kardex trace beyond the return record.

## Files expected to change
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_sale_returns/`, `apps/api/src/common/prisma/tenant.extension.ts`
- `libs/domain/src/lib/{sale-return,state-machine,company-settings,permissions,sale-cancellation,sales-order-dispatch}.ts` (+specs), `libs/domain/src/index.ts`
- `apps/api/src/modules/sales/returns/**` (new), `apps/api/src/modules/sales/sales.module.ts`, `apps/api/src/modules/sales/sales/{sale-cancellation.service,sales-history.service}.ts`, `pos/pos-payment.service.ts` (extract shift lock helper), `pos/pos.int-fixture.ts`, `sales-schema.int.spec.ts`
- `apps/api/src/common/outbox/outbox.service.ts`, `apps/worker/src/common/queues.ts`, seed of default roles (if permissions are seeded outside `permissions.ts`)
- `apps/erp/src/app/features/sales/returns/**` (new), `sales/history/sale-detail.page.*`, `sales-history-api.service.ts`, `sales.routes.ts`, `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/sale-return.spec.ts`, `docs/backlog/sales.md` (status), `docs/backlog/decisions.md` (note #15 defaults)

Overlaps: none with open branches beyond 14/15/20 (all committed before this one); later HU-VEN-22/23 touch cash movements and `outbox.service.ts`.

## Verification
Int specs on local Postgres (incl. concurrency), ERP specs, Playwright E2E. Manual: sell in cash, return one piece to stock and one to scrap, check kardex (`Devolución +1` only for the stock line), the shift shows the refund, VP-20 lists `DEV-000001` and VP-21 shows the pending credit note. Set the limit, repeat as cashier, approve as Gerencia. Finish with `pnpm nx affected -t lint typecheck test`.

## After approval
Save to `docs/plans/HU-VEN-21.md` (uncommitted), then run `/story-build HU-VEN-21` in a fresh session.
