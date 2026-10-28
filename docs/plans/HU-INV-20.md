# Plan · HU-INV-20 · Approve transfers above the limit (IN-25)

## Context
Management wants control over large movements. Decision #36 is still open; its default is in place: the settings `transfers.approvalThresholdPieces|Value` (already in `company-settings.ts`, default `null` = never asks), and anyone with `inventory.transfers.approve` (already in `permissions.ts`) approves.

**Depends on HU-INV-18** (planned, not built). It provides:
- the `transfers` / `transfer_items` models, which already have `approved_by_id` and `approved_at`;
- `requiresTransferApproval(summary, settings)`;
- the `send` endpoint, which already moves an over-limit draft `DRAFT → PENDING_APPROVAL` with no stock movement;
- the editor's "Enviar para aprobación" switch;
- the read-only detail `/:id`.

The `transferMachine` already has `requestApproval`, `approve`, `reject`, `dispatch` and `cancel`. This story adds the approval queue, approve/reject, and the dispatch of an approved transfer.

**Build only after HU-INV-18 is merged**, on `feat/hu-inv-20` from `main`. It does not depend on HU-INV-19. If 18's code differs from its plan, re-plan.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| Stays pending until approved | Int test: with the threshold 50 pieces, sending a 60-piece draft → `PENDING_APPROVAL`, **no** `stock_movements`, stock unchanged. `dispatch` before approval → 422 `INVALID_TRANSITION`. Editing it → 422 `TRANSFER_NOT_EDITABLE`. `approve` without the permission → 403. `approve` → `APPROVED`, then `dispatch` → `IN_TRANSIT` with `TRANSFER_OUT` movements. `reject` with a reason → `REJECTED`, with no movements. Audit and outbox on each step. Domain spec: thresholds on pieces, on value (`Decimal`), on both and `null` |
| Shows amount and products | Int test: `GET /inventory/transfers/approvals` lists the pending ones with the number, origin → destination, requester, date, products, pieces, value and which limit was exceeded. `GET /:id` returns the lines (code, brand, name, quantity, unit cost, subtotal) and live stock at the origin. Page spec IN-25: the summary card (amount, pieces, products, exceeded limit vs. configured limit), the lines table, and the Aprobar / Rechazar buttons only with `*rsCan` |

## Model
Migration `20261025130000_transfer_approval` on `transfers`:
- `rejected_by_id`, `rejected_at`, `rejection_reason Text?`;
- `approval_requested_at`, `approval_reason Json?`, i.e. which limit was exceeded and the threshold values, frozen at request time;
- `@@index(company_id, status)` if 18 didn't add it.

No new tables; `transfers` is already in `TENANT_MODELS`.

## Domain (`libs/domain/src/lib/transfer.ts`)
- `transferApprovalReason(summary, settings)` → `{ pieces?: {value, limit}, value?: {value, limit} } | null`. The existing `requiresTransferApproval` becomes `reason !== null`.
- `canApproveTransfer({ requesterId, approverId })` blocks self-approval (`SELF_APPROVAL_FORBIDDEN`). See the doubts.
- Transitions only through `transferMachine` (`approve`, `reject`, `dispatch`, `cancel` from APPROVED).

## API (`transfers.controller.ts` / `transfers.service.ts`)
| Method | Route | Permission | Errors |
|---|---|---|---|
| GET | `/inventory/transfers/approvals` (status, branch, dates, paginated) | `inventory.transfers.approve` | 400 `INVALID_FILTER` |
| POST | `/inventory/transfers/:id/approve` (`expectedUpdatedAt`, optional note) | `inventory.transfers.approve` | 404 `TRANSFER_NOT_FOUND`, 422 `INVALID_TRANSITION`, `SELF_APPROVAL_FORBIDDEN`, 409 `TRANSFER_MODIFIED` |
| POST | `/inventory/transfers/:id/reject` (`reason` required) | `inventory.transfers.approve` | same + 400 `REASON_REQUIRED` |
| POST | `/inventory/transfers/:id/dispatch` | `inventory.transfers.create` | 422 `INVALID_TRANSITION`, `INSUFFICIENT_STOCK` (with lines), 409 |
| POST | `/inventory/transfers/:id/cancel` (now also from APPROVED) | `inventory.transfers.create` | 422 `INVALID_TRANSITION` |

- Approve and reject run in one tx: lock the transfer `FOR UPDATE`, transition, then write the audit (`inventory.transfer.approve|reject`) and outbox (`inventory.transfer.approved|rejected`, to notify the requester later).
- **Approve does not move stock.** Stock leaves only on `dispatch`. That path reuses 18's send internals (`StockMovementService.apply(TRANSFER_OUT)` in product-id order, totals frozen), so if stock dropped since the request it returns 422 with the lines.
- `send` (18) stores `approval_requested_at` and `approval_reason`.
- Branch scope: the approver sees transfers whose origin is in one of their branches, or all of them for Management (the same scope helper as 18).

## ERP screens
- **IN-25, approval queue** at `inventory/transfers/approvals`:
  - a sub-tab or entry "Por aprobar (n)" in the Transferencias nav, guarded by `*rsCan` and a route guard;
  - an `rs-doc-table`: number, origin → destination, requester, date, products, pieces, value, and the exceeded limit as an `rs-status-pill` warning;
  - skeleton, empty ("No hay transferencias por aprobar"), error and no-permission states.
- **Detail `/:id` in PENDING_APPROVAL:**
  - a summary card: amount (Bs), pieces, products and "Supera el límite de 50 piezas";
  - the lines table, with stock at the origin;
  - "Aprobar" (confirm `rs-modal`) and "Rechazar" (an `rs-modal` with a required `rs-textarea` for the reason).
- **APPROVED:** shows "Despachar" to the origin warehouse.
- **REJECTED:** shows the reason and who rejected it.
- **Components:** none new expected; check IN-25 in Figma for a summary card. If it is a DS component missing from `libs/ui`, add it there.

## Tests
- **Unit (domain):** approval reason for each threshold combination, `Decimal` comparisons at the boundary (equal = no approval), self-approval rule.
- **Unit (ERP):** queue rendering and states, the summary card, buttons hidden without permission, required reject reason, error mapping (`SELF_APPROVAL_FORBIDDEN`, `TRANSFER_MODIFIED`).
- **Integration (real Postgres):**
  - full flow pending → approve → dispatch; reject; cancel from APPROVED;
  - no movements before dispatch;
  - permissions, branch scope and tenant isolation;
  - **concurrency:** two approvers at once → one succeeds, the other gets 409 or `INVALID_TRANSITION`; approve racing a reject; dispatch after another transfer consumed the stock → 422 with no movements and no negative stock.
- **E2E:** set the threshold → Warehouse sends a large transfer → "Pendiente de aprobación" → log in as Management → Por aprobar → open → amount and products shown → Aprobar → Warehouse clicks Despachar → "En tránsito".

## Open decisions used with defaults
- **#36:** thresholds per company (`transfers.approvalThresholdPieces|Value`), default `null` (never asks); approver = `inventory.transfers.approve`. Both already exist. The seed keeps `null`; the E2E sets them.

## Risks and doubts
- **Self-approval:** I block the requester from approving their own transfer (a Management user who creates a large one would need another approver). Tell me if you want it allowed.
- **Approve vs. dispatch:** the machine separates them, so approval does not move stock, and a separate "Despachar" step does. Stock may run out between the two; dispatch re-validates.
- **Settings UI:** there is no Settings screen for thresholds yet. They are seeded or edited in the DB; a Settings screen is out of scope.
- **Notifications:** only the outbox event; no email or in-app notification yet.
- **Hard dependency on HU-INV-18.** Shared files with HU-INV-19: `transfers.service.ts`, `transfers.controller.ts` and the detail page. Build 19 and 20 one after the other, not in parallel.

## Files expected to change
- `apps/api/prisma/{schema.prisma, migrations/20261025130000_transfer_approval/}`
- `libs/domain/src/lib/{transfer.ts, transfer.spec.ts}`
- `apps/api/src/modules/inventory/{transfers.controller.ts, transfers.service.ts, transfers.dto.ts, transfers.int.spec.ts}`
- `apps/erp/src/app/features/inventory/{inventory.routes.ts, inventory-layout.page.ts, transfers/approvals/*, transfers/detail/*}`
- `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/transfers.spec.ts` (approval case)
- `docs/plans/HU-INV-20.md`

## Verification
`pnpm nx affected -t lint typecheck test`, then the API int suite against Postgres (concurrency included), then Playwright. Compare against IN-25. Run the `reviewer`, `stock-auditor` and `ui-checker` agents.
