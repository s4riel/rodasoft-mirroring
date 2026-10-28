# Plan · HU-INV-18 · Create a transfer by search, paste or Excel (IN-05, IN-06a–d)

## Context
Warehouse moves merchandise between branches and needs a fast way to build a transfer of up to 100+ products. What already exists:
- **State machine:** `transferMachine` in `libs/domain/src/lib/state-machine.ts`: `DRAFT → IN_TRANSIT` (send) or `→ PENDING_APPROVAL → APPROVED → IN_TRANSIT`, then receipt, plus `REJECTED` and `CANCELLED`.
- **Permissions:** `inventory.transfers.create|approve|receive`.
- **Settings:** `transfers.approvalThresholdPieces|Value` (decision #36, default `null` = never asks for approval).
- **Stock:** `StockMovementType` has `TRANSFER_OUT` / `TRANSFER_IN`; `StockMovementService.apply` is the only stock writer and rejects negative stock.
- **Warehouses:** in `GET /context`.
- **Missing:** there is no `transfers` model, API or screens.

This story covers the list (IN-05), the editor with its four add methods (IN-06a–d), the draft and **sending**, which takes the stock out of the origin and makes it "en tránsito". Out of scope: insufficient-stock correction UX (HU-INV-19), approval (HU-INV-20, only the "Enviar para aprobación" switch here), receipt (HU-INV-21) and restock-below-minimum (HU-INV-27).

**Branches:** HU-INV-10 (unmerged) adds `exceljs` and a paste/xlsx parsing pattern; HU-INV-16 and 17 are planned. Shared files are `stock-movement.service.ts` (HU-INV-10 and 16), `inventory.routes.ts`, `inventory-layout.page.ts`, `api-error.ts`, `seed.ts` and the document-number sequence (HU-INV-16 `AJ-`). Build on `feat/hu-inv-18` from `main` **after HU-INV-10 merges** (Excel parsing) — or add `exceljs` here if 10 isn't merged yet.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| List of transfers (IN-05) | Int test: `GET /inventory/transfers` returns number `TR-000123`, origin → destination, status, products, pieces, value, creator and dates. It is filterable by status, origin, destination, dates and number, paginated, tenant-isolated and limited to the member's branches. Page spec: rows, status pills and states |
| Search by code (IN-06a) | Int test: `GET /inventory/transfers/product-search?warehouseId&q` returns matches by code, brand or measurement with the stock available at the origin. Page spec: typing then Enter adds the first result. A repeated product adds to its quantity instead of duplicating the line |
| Paste list or Excel (IN-06b / IN-06c) | Domain spec `parseTransferPaste`: comma, tab and semicolon separators, a header row skipped, blank lines, quantities ≤ 0 or non-integer flagged, duplicates summed. Int test: `POST /inventory/transfers/resolve-lines` (paste rows or an uploaded .xlsx/.csv with code + quantity) returns recognized / not found / insufficient stock **before** anything is added. Page spec: the preview modal shows the three groups, and "Agregar" adds only the correct ones |
| Supports 100 products | Int test: a draft with 150 lines is saved and sent in one tx. Page spec: the lines table is paginated by 10, with internal search and filters Todos / Con error / Sin cambios. Edits persist across pages. The summary shows products, pieces, value and errors. Max lines is the setting `transfers.maxLines` (default 500) |
| Stock becomes "en tránsito" | Int test (real Postgres): `POST /inventory/transfers/:id/send` writes a `TRANSFER_OUT` movement per line at the origin (`refType 'TRANSFER'`, `refNumber`) and moves the status `DRAFT → IN_TRANSIT` through `transferMachine`, with audit and outbox `inventory.transfer.sent`. The origin stock goes down, and `GET /inventory/products/:id/stock` shows `inTransit` to the destination branch. Sending with any line erroring → 422 `TRANSFER_HAS_ERRORS` (#35). Over a threshold → `PENDING_APPROVAL`, with no movements yet. **Concurrency:** two transfers sending the same scarce stock at once → one succeeds, the other gets 422 `INSUFFICIENT_STOCK` and leaves no partial movements; the level is never negative |
| Empty state with illustration (IN-06d) | Page spec: a new transfer without lines shows `rs-empty-state-illustrated` "Agrega productos" with the 3 add actions; Enviar is disabled |

## Model
Migration `20261025120000_transfers`:
- **`transfers`:**
  - `id`, `company_id`, `number`, `status TransferStatus`;
  - `origin_warehouse_id`, `destination_warehouse_id`, `note`;
  - `total_pieces Int`, `total_value Decimal(14,2)` (at average cost, frozen on send);
  - `created_by_id`, `sent_by_id`, `sent_at`, `approved_by_id`, `approved_at` (HU-INV-20), `created_at`, `updated_at`;
  - `@@unique(company_id, number)`, `@@index(company_id, status, created_at)`.
- **`transfer_items`:**
  - `id`, `company_id`, `transfer_id` (cascade), `product_id`, `quantity Int`;
  - `received_quantity Int @default(0)` (HU-INV-21), `unit_cost Decimal(14,4)?` (frozen on send);
  - `@@unique(transfer_id, product_id)`.
- Prisma enum `TransferStatus`, matching the domain union.
- Both tables are registered in `TENANT_MODELS`.
- Number series `TR-` via the same document-sequence mechanism as HU-INV-16.
- **In transit** is derived (`Σ quantity − received_quantity` over IN_TRANSIT / PARTIALLY_RECEIVED items), not stored: no virtual warehouse, no reserved column.

## Domain (`libs/domain/src/lib/transfer.ts`)
- `parseTransferPaste(text)` returns `{ rows: {line, code, quantity}[], errors: {line, reason}[] }`. It reuses the separator detection from HU-INV-10 if it exists.
- `validateTransferLines(lines, availableByProduct)` returns per-line `OK | INSUFFICIENT_STOCK | INVALID_QUANTITY | PRODUCT_INACTIVE` plus a summary `{ products, pieces, value, errors }` (value with `Decimal`).
- `requiresTransferApproval(summary, settings)` checks pieces > threshold or value > threshold; `null` → false.
- Rules: origin ≠ destination (`SAME_WAREHOUSE`); the warehouses are active.
- All status changes go through `transferMachine.transition`.

## API (`apps/api/src/modules/inventory/transfers.*`)
| Method | Route | Permission | Errors |
|---|---|---|---|
| GET | `/inventory/transfers` | `inventory.transfers.create` or `.receive` | 400 `INVALID_FILTER` |
| GET | `/inventory/transfers/:id` | same | 404 `TRANSFER_NOT_FOUND` |
| POST | `/inventory/transfers` (draft: origin, destination, note, lines) | `inventory.transfers.create` | 422 `SAME_WAREHOUSE`, `WAREHOUSE_INACTIVE`, `TOO_MANY_LINES`, 403 `BRANCH_FORBIDDEN` |
| PUT | `/inventory/transfers/:id` (replace draft lines, `expectedUpdatedAt`) | `create` | 409 `TRANSFER_MODIFIED`, 422 `TRANSFER_NOT_EDITABLE` |
| GET | `/inventory/transfers/product-search` | `create` | — |
| POST | `/inventory/transfers/resolve-lines` (JSON paste rows or multipart file) | `create` | 400 `FILE_INVALID`, `FILE_TOO_LARGE` |
| POST | `/inventory/transfers/:id/send` | `create` | 422 `TRANSFER_HAS_ERRORS`, `INSUFFICIENT_STOCK` (with lines), `INVALID_TRANSITION`, 409 `TRANSFER_MODIFIED` |
| POST | `/inventory/transfers/:id/cancel` | `create` | 422 `INVALID_TRANSITION` |

- **`send`:** one tx.
  1. Lock the transfer row `FOR UPDATE` and re-validate its lines.
  2. If approval is required → `requestApproval`, and stop.
  3. Otherwise, for each line in product-id order (avoids deadlocks), call `StockMovementService.apply(TRANSFER_OUT, -qty)` at the origin, freezing `unit_cost` and the totals, then `send`.
  4. Write the audit and `OutboxService.publish('inventory.transfer.sent', …, { tx })`.
- Product stock endpoint: add `inTransit` per branch (incoming), read-only.
- Audit `inventory.transfer.create|update|send|cancel`.

## ERP screens (`features/inventory/transfers/*`)
- **Routes and nav:** `inventory/transfers`, `/new`, `/:id`. Enable the "Transferencias" sub-nav entry.
- **IN-05, list:** `rs-page-header` with "Nueva transferencia" (`*rsCan`), a filter bar, an `rs-doc-table` with `rs-status-pill` per status ("Borrador", "En tránsito", "Pendiente de aprobación"…), `rs-pagination`, skeleton, empty and error states.
- **IN-06, editor:**
  - **Header:** origin and destination `rs-select` (destination excludes the origin) and a note.
  - **Add bar:** an `rs-input` search with a results dropdown (Enter adds the first), "Pegar lista" (an `rs-modal` with an `rs-textarea` → preview), "Importar Excel" (`rs-file-upload` → same preview) and "Reponer bajo mínimo" disabled (HU-INV-27).
  - **Lines:** an `rs-doc-table` paginated by 10, with an `rs-input` number quantity per row, stock at the origin, an error flag on the row, remove, internal search and an `rs-tabs` / segmented filter Todos / Con error / Sin cambios.
  - **Summary bar:** products, pieces, value and errors.
  - **Actions:** "Guardar borrador", then "Enviar" — or "Enviar para aprobación" when over the threshold. Both are disabled with errors.
  - **Edits:** kept in a signal store across pages; leaving with unsaved changes asks for confirmation.
- **IN-06d:** `rs-empty-state-illustrated`.
- **Detail `/:id`:** a read-only view after sending (status, lines, in-transit) — the minimum here; HU-INV-21 extends it.
- **Product sheet stock tab:** show "En tránsito: n" per branch if IN-02 has the slot.
- **Components:** none new expected. Check `rs-file-upload` and the segmented filter exist; if a "summary bar" component is in Figma, it belongs in `libs/ui`.

## Tests
- **Unit (domain):** paste parsing, line validation, approval thresholds, transitions used.
- **Unit (ERP):** add by search, Enter and duplicates; the paste preview groups; pagination with edits kept; filters; summary; button states; empty state; error mapping.
- **Integration (real Postgres):**
  - create, update and send draft; 150 lines; branch scope and tenant isolation;
  - resolve-lines for paste and xlsx;
  - send writes the movements, totals, audit and outbox;
  - errors block sending; the approval branch; cancel a draft;
  - **concurrency:** two simultaneous sends over the same stock, and a send racing a draft edit (`TRANSFER_MODIFIED`).
- **E2E:** Inventario → Transferencias → Nueva → origin Central, destination Norte → search a code + Enter → paste 3 lines (1 unknown flagged) → Agregar → Enviar → the list shows "En tránsito" → the origin stock goes down on the product sheet.

## Open decisions used with defaults
- **#35:** sending is blocked while there are errors (no partial send).
- **#36:** `transfers.approvalThresholdPieces|Value` default `null` = never asks. Exceeding them only switches to "Enviar para aprobación" here.
- **New setting:** `transfers.maxLines` (default 500), so "supports 100" has headroom.

## Risks and doubts
- **"En tránsito" representation:** derived from the transfer items, not a transit warehouse — simpler, and the kardex shows TRANSFER_OUT / IN. If accounting needs a valued transit balance, revisit.
- **Cost for value:** the product's average cost; a product without cost counts as 0 and gets a warning.
- **Scope:** the HU-INV-19/20/21 screens are not built here; their hooks are (statuses, `received_quantity`, approval columns).
- **Dependency on HU-INV-10** for Excel parsing and `exceljs`.
- **Size:** this is the largest inventory story so far; if the build runs long, split the ERP editor (IN-06) from the API into two commits on the same branch.

## Files expected to change
- `apps/api/prisma/{schema.prisma, migrations/20261025120000_transfers/, seed.ts}`
- `libs/domain/src/lib/{transfer.ts, transfer.spec.ts, company-settings.ts}`, `libs/domain/src/index.ts`
- `apps/api/src/modules/inventory/{transfers.controller.ts, transfers.service.ts, transfers.dto.ts, transfers.int.spec.ts, inventory.module.ts, stock-queries.service.ts}`, `prisma/tenant` model registry
- `apps/erp/src/app/features/inventory/{inventory-layout.page.ts, inventory.routes.ts, transfers/*, products/sheet/stock/*}`
- `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/transfers.spec.ts`
- `docs/plans/HU-INV-18.md`

## Verification
`pnpm nx affected -t lint typecheck test`, then the API int suite against Postgres (concurrency included), `pnpm db:seed`, then Playwright. Compare against IN-05 and IN-06a–d. Run the `reviewer`, `stock-auditor` and `ui-checker` agents.
