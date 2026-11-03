# Plan · HU-INV-21 · Follow and receive a transfer piece by piece (IN-24a, IN-24b, IN-07)

## Context
Warehouse at the destination needs to see what is on the way, receive it product by product, and record what arrived short or extra, so the stock ends up correct.

What it builds on:
- **HU-INV-18** (planned, not built) gives:
  - `transfers` / `transfer_items`, already with `received_quantity Int @default(0)`;
  - the dispatch writing `TRANSFER_OUT`, and in-transit derived from the lines;
  - the read-only detail `/:id`.
- **HU-INV-20** (planned) adds dispatch of approved transfers. This story doesn't need it.
- **Already in the repo:**
  - `transferMachine`: `IN_TRANSIT`/`PARTIALLY_RECEIVED` + `receivePartial|receiveAll`;
  - the permission `inventory.transfers.receive`;
  - `StockMovementType.TRANSFER_IN`;
  - `StockMovementService.apply`;
  - the setting `adjustments.approvalThresholdValue`.
- **Missing:**
  - the `stock_adjustments` document (HU-INV-22/23 aren't planned);
  - an adjustment state machine.

**Your choices:**
1. Only what was received enters the destination. A shortage stays outside every warehouse and is recorded on a pending adjustment.
2. This story adds a minimal adjustments model, and HU-INV-22/23 extend it later.

**Build after HU-INV-18 is merged**, on `feat/hu-inv-21` from `main`. HU-INV-19, 20 and 21 all touch the transfers service, its controller and the detail page, so build them one after the other.

## Receipt rules
- Receiving happens in **sessions**. Each `POST …/receipts` records the pieces counted for each line now, and the line's cumulative `received_quantity` goes up.
- A session can't take a line above its sent quantity; that returns `RECEIPT_EXCEEDS_SENT`. Extra pieces are entered as a surplus when the receipt is closed.
- After a session, a transfer with any lines left goes to `PARTIALLY_RECEIVED`.
- `POST …/close` finishes the receipt: it records the surplus per line, writes the differences and moves the transfer to `RECEIVED`. A transfer whose lines are all fully received closes the same way.
- **Stock:** each session writes `TRANSFER_IN` at the destination for the pieces received, at the unit cost frozen on dispatch, through `StockMovementService.apply`. Movements are always written in product-id order.
- **Differences** (written at close only):
  - **Shortage** (`sent − received > 0`): a pending adjustment line `SHORTAGE` at the destination, with quantity and value. Approving it later (HU-INV-23) writes off the loss and **moves no stock**, because those pieces never entered any warehouse.
  - **Surplus:** a pending adjustment line `SURPLUS` (`ADJUSTMENT_IN`). Approving it puts the extra pieces into stock; until then they aren't in stock.
  - All of a transfer's differences go into **one** adjustment document, linked to the transfer.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| In-transit detail | Int test: `GET /inventory/transfers/:id` returns the status, origin → destination, who sent it and when, and the lines (code, brand, name, sent, received, pending, unit cost), plus the totals. `GET /inventory/transfers/incoming` lists the IN_TRANSIT and PARTIALLY_RECEIVED transfers headed to the member's branches. Page spec IN-24a: the timeline/status, the lines with pending pieces, and "Recibir" only with `*rsCan` |
| Receipt per product | Int test: a session with 6 of 10 → `PARTIALLY_RECEIVED`, a `TRANSFER_IN` of +6 at the destination and the origin unchanged. A second session with 4 → done. 11 of 10 → 422 `RECEIPT_EXCEEDS_SENT`. Wrong status → 422 `INVALID_TRANSITION`. No permission → 403. Not the destination branch → 404. Audit and outbox on every step. Page spec IN-24b: a quantity input per row, "Recibir todo" per line and in bulk, the pending counter, and quantities kept across pages |
| Differences generate a pending adjustment | Int test: close with 8 of 10 on A and 12 of 10 on B → `RECEIVED`, plus one `stock_adjustments` row `PENDING_APPROVAL`, `source=TRANSFER`, linked to the transfer, with lines A `SHORTAGE` −2 and B `SURPLUS` +2 and their values. The stock for those lines (+8 for A, +10 for B) is unchanged by the close. Closing with no differences creates no adjustment. Page spec IN-07: a differences summary before confirming, and after closing an "Ajuste pendiente AJ-…" banner |

## Model
Migration `20261025140000_transfer_receipt_and_adjustments`.

**Transfers:**
- `transfer_items` gets `surplus_quantity Int @default(0)` (`received_quantity` already comes from HU-INV-18).
- `transfers` gets `received_by_id` and `received_at`, written at close.

**New `transfer_receipts`** (one row per session):
- `id`, `company_id`, `transfer_id`, `received_by_id`, `note`, `created_at`;
- items in `transfer_receipt_items`: `receipt_id`, `transfer_item_id`, `quantity Int`.

The receipt is kept as its own document so the history is preserved and the movements' `refId` can point at it.

**New `stock_adjustments`** (minimal; HU-INV-22/23 extend it):
- `id`, `company_id`, `number` (series `AJ-`, the same sequence HU-INV-16 plans);
- `status StockAdjustmentStatus` (`PENDING_APPROVAL | APPROVED | REJECTED`);
- `source` (`MANUAL | TRANSFER`), `transfer_id?`, `warehouse_id`, `reason`, `total_value Decimal(14,2)`;
- `created_by_id`, `approved_by_id?`, `approved_at?`, `created_at`, `updated_at`;
- `@@unique(company_id, number)` and `@@unique(transfer_id)`, so there is one adjustment per transfer.

**New `stock_adjustment_items`:**
- `id`, `company_id`, `adjustment_id`, `product_id`;
- `kind` (`SHORTAGE | SURPLUS | MANUAL`), `quantity Int` (signed), `unit_cost Decimal(14,4)`.

Every new table goes into `TENANT_MODELS`.

## Domain
**`libs/domain/src/lib/transfer.ts`:**
- `applyReceiptSession(lines, input)` returns the new received quantities and rejects over-sent with `RECEIPT_EXCEEDS_SENT`, quantities below 0 and products not on the transfer.
- `nextReceiptEvent(lines)` returns `receivePartial` or `receiveAll`.
- `computeTransferDifferences(lines)` returns `{ productId, kind, quantity, value }[]` (value with `Decimal`).

**`libs/domain/src/lib/state-machine.ts`:**
- Add `stockAdjustmentMachine`: `PENDING_APPROVAL{approve→APPROVED, reject→REJECTED}`. It is only used to create documents now; HU-INV-23 uses the transitions.
- On `transferMachine`, add `close` from `PARTIALLY_RECEIVED` to `RECEIVED`. Today `receiveAll` is the only way into `RECEIVED`, so closing with a shortage needs this new event.

**`libs/domain/src/lib/stock-adjustment.ts`** (shared with HU-INV-16's plan, which is only additive): `TRANSFER_DIFFERENCE` reason label "Diferencia en transferencia".

## API (`transfers.controller.ts` / `transfers.service.ts`; new `stock-adjustments.service.ts`)
| Method | Route | Permission | Errors |
|---|---|---|---|
| GET | `/inventory/transfers/incoming` (status, origin, dates, paginated) | `inventory.transfers.receive` | 400 `INVALID_FILTER` |
| GET | `/inventory/transfers/:id` (extended: received, pending, surplus, receipts, adjustment) | `inventory.transfers.create` or `.receive` | 404 `TRANSFER_NOT_FOUND` |
| POST | `/inventory/transfers/:id/receipts` `{ lines: [{itemId, quantity}], note?, expectedUpdatedAt }` | `inventory.transfers.receive` | 404, 422 `INVALID_TRANSITION`, `RECEIPT_EXCEEDS_SENT`, `RECEIPT_EMPTY`, 409 `TRANSFER_MODIFIED` |
| POST | `/inventory/transfers/:id/close` `{ surplus: [{itemId, quantity}], note?, expectedUpdatedAt }` | `inventory.transfers.receive` | 404, 422 `INVALID_TRANSITION`, 409 `TRANSFER_MODIFIED` |

**The receipt session runs in one tx:**
1. Lock the transfer `FOR UPDATE`, then check `updatedAt`.
2. Validate with the domain.
3. Create `transfer_receipts`, update `received_quantity`, and call `StockMovementService.apply(TRANSFER_IN, destination, +q, refType TRANSFER_RECEIPT, refNumber TR-…)`.
4. Transition through `transferMachine` and write the audit `inventory.transfer.receive`.
5. Publish the outbox event `inventory.transfer.received_partial|received`.

**The close runs in one tx:**
1. Lock the transfer.
2. Store the surplus quantities and compute the differences.
3. If there are any, create the adjustment through `StockAdjustmentsService.createFromTransfer(tx, …)`, which **writes no stock**.
4. Transition to `RECEIVED`.
5. Write the audit `inventory.transfer.close` and `inventory.adjustment.create`.
6. Publish the outbox events `inventory.transfer.received` and `inventory.adjustment.pending` (approval and notifications come later, in HU-INV-23).

**Branch scope:** a member receives only when the destination warehouse is in one of their branches; Management sees all. A transfer outside scope returns 404. This reuses HU-INV-18's helper.

## ERP screens (`features/inventory/transfers/*`)
**IN-24a, in transit:**
- A "Por recibir" entry in the Transferencias nav (`*rsCan` receive) showing the incoming list (`rs-doc-table`).
- The detail `/:id` gets:
  - a header with an `rs-status-pill`: "En tránsito" or "Recibida parcialmente";
  - the origin → destination, and who sent it and when;
  - the lines with sent, received and pending columns;
  - a "Recibir" button.

**IN-24b, receipt** (`/:id/receive`):
- an `rs-doc-table` paginated by 10, with an `rs-input` number per row (prefilled with 0) and a "Todo" button on each line that fills in the pending pieces;
- "Recibir todo" for the whole list, plus an internal search;
- a summary of pieces received now and pieces still pending;
- "Registrar recepción" (a partial session) and "Finalizar recepción". The second opens IN-07.

**IN-07, differences:**
- an `rs-modal` with a table of shortages and surpluses (with an `rs-input` for the surplus per line) and their values;
- the text "Se generará un ajuste pendiente de aprobación";
- "Confirmar".

After closing, the detail shows a banner with the adjustment number.

**States on every screen:** skeleton, empty ("No hay transferencias por recibir"), error and no-permission. The error mapping for the new codes goes in `api-error.ts`.

**Components:** none new expected. Check IN-24a in Figma for a timeline/stepper; if the DS has it and `libs/ui` doesn't, add it to `libs/ui` with its own files.

## Tests
- **Unit (domain):**
  - the receipt session (over-sent, zero, unknown item);
  - which event comes next;
  - the differences math with `Decimal`;
  - the new `close` transition and the adjustment machine.
- **Unit (ERP):**
  - the incoming list states;
  - the detail columns;
  - receipt inputs and "Todo" / "Recibir todo";
  - quantities kept across pages;
  - the differences modal and the error mapping.
- **Integration (real Postgres):**
  - partial, partial and close flows;
  - TRANSFER_IN movements, with the origin untouched;
  - the adjustment created only when there are differences, with no stock written by the close;
  - branch scope, tenant isolation and 403.
  - **Concurrency:**
    - two receipt sessions at once on the same line → one wins, the other gets 409 or `RECEIPT_EXCEEDS_SENT`, and the total never exceeds the sent quantity;
    - close racing a receipt session → exactly one adjustment (unique `transfer_id`), and movements matching `received_quantity`;
    - the kardex balance matching `stock_levels`.
- **E2E:** dispatch a 2-product transfer, then log in as Warehouse at the destination:
  1. Por recibir → open it → En tránsito;
  2. receive 6 of 10 → Recibida parcialmente;
  3. Finalizar with 3 more of the rest plus 1 surplus on the other product → differences modal → Confirmar;
  4. Recibida, with the "Ajuste pendiente AJ-…" banner;
  5. the destination's product stock tab shows +9.

## Open decisions used with defaults
- None open for this story.
- The adjustment's approval and its threshold (`adjustments.approvalThresholdValue`, decision #37) belong to HU-INV-23. Every transfer difference is created `PENDING_APPROVAL` whatever the threshold, because the story says "pending".

## Risks and doubts
- **Model overlap with HU-INV-16/22/23:**
  - HU-INV-16's plan writes direct adjustment *movements* without a document; this story introduces the document;
  - HU-INV-22/23 must extend `stock_adjustments` and not create a parallel table;
  - the `AJ-` sequence is shared with HU-INV-16. Whichever is built first creates it.
- **Approving a shortage moves no stock** (HU-INV-23 has to respect that); approving a surplus writes `ADJUSTMENT_IN`.
- **Surplus is only entered at close**, never in a session, so the sent quantity caps every session.
- **A partial transfer can stay open indefinitely**; there is no automatic close.
- **Hard dependency on HU-INV-18.** It shares files with 19 and 20, so build them in sequence.

## Files expected to change
- `apps/api/prisma/{schema.prisma, migrations/20261025140000_transfer_receipt_and_adjustments/}`
- `apps/api/src/prisma/tenant-models.ts`, wherever `TENANT_MODELS` lives
- `libs/domain/src/lib/{transfer.ts, transfer.spec.ts, state-machine.ts, state-machine.spec.ts, stock-adjustment.ts}`
- `apps/api/src/modules/inventory/{transfers.controller.ts, transfers.service.ts, transfers.dto.ts, transfers.int.spec.ts, stock-adjustments.service.ts, inventory.module.ts}`
- `apps/erp/src/app/features/inventory/{inventory.routes.ts, inventory-layout.page.ts, transfers/incoming/*, transfers/detail/*, transfers/receive/*}`
- `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/transfers-receive.spec.ts`
- `docs/plans/HU-INV-21.md`

## Verification
1. `pnpm nx affected -t lint typecheck test`.
2. The API int suite against Postgres, concurrency included.
3. Playwright.
4. Compare the screens against IN-24a, IN-24b and IN-07 in Figma.
5. Run the `reviewer`, `stock-auditor` and `ui-checker` agents.
