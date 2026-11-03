# Plan · HU-INV-22 · Adjustments: list and new adjustment with a reason (IN-27, IN-08)

## Context
Warehouse needs to record multi-line inventory adjustments with a reason (shrinkage, count error, damage, other) and see the list of every adjustment.

**Already in `main` (HU-INV-16, the quick single-line adjustment):**
- `stock-adjustment.{controller,service,dto}.ts`:
  - `POST products/:id/stock-adjustments` writes one `ADJUSTMENT_IN/OUT` movement, with no document;
  - the threshold check `adjustments.approvalThresholdValue`, which returns 422 `ADJUSTMENT_NEEDS_APPROVAL`.
- `libs/domain/src/lib/stock-adjustment.ts`: `ADJUSTMENT_REASONS` and labels, `AdjustmentKind IN|OUT|COUNT`, `resolveAdjustment`, `buildAdjustmentMovement`, `AdjustmentError`.
- The permissions `inventory.adjustments.create` and `.approve`, and `StockMovementService.apply`.

**Also in `main` (HU-INV-21, merged after this plan was first written):**
- the `stock_adjustments` and `stock_adjustment_items` tables (migration `20261029002225_transfer_receipt_and_adjustments`);
- `AdjustmentDocumentsService.createFromTransfer`;
- `adjustment-number.ts` (`nextAdjustmentNumber`), the shared `AJ-` numbering that already looks at `stock_adjustments.number`.
- Items use `StockAdjustmentItemKind` (`SHORTAGE | SURPLUS | MANUAL`) and a signed `quantity`.

**This story extends those tables, it does not recreate them.** HU-INV-23 adds approve/reject (IN-28) for the transfer-difference adjustments.

**Decision (user, 2026-10-28): a manual adjustment has no approval flow.** It is applied and `APPROVED` the moment it is created, whatever its value. `adjustments.approvalThresholdValue` no longer applies to the document form. The quick adjustment of HU-INV-16 is not touched in this story and keeps its threshold.

## Rules
- An adjustment is a document with:
  - a warehouse;
  - a reason (required) and a note (required when the reason is `OTHER`);
  - lines of product + kind (`IN|OUT|COUNT`) + quantity. `COUNT` means the counted stock; the delta is computed against the locked stock when the adjustment is applied.
- **On confirm** it is always applied immediately in one tx: one `ADJUSTMENT_IN/OUT` movement per line with a non-zero delta, in product-id order, through `StockMovementService.apply` (`refType ADJUSTMENT`, `refId` = the document, `refNumber AJ-…`). The status is `APPROVED`, `approved_by` is empty (auto-applied) and `approved_at` is the apply time. There is no pending state for manual adjustments.
- **Total value** = Σ |delta| × average cost. A product with no cost counts as 0 and is logged, the same as HU-INV-16.
- The `AJ-` series is shared with the quick adjustment and the transfer-difference adjustments through `nextAdjustmentNumber`.
- **Branch scope:** the warehouse must be in one of the member's branches; Management sees all. This reuses the HU-INV-16 warehouse check.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| List of adjustments | Int test: `GET /inventory/adjustments` is paginated and can be filtered by status, warehouse, reason, date range and search (number or product code). It is limited to the member's branches and isolated per tenant. Each row shows number, date, warehouse, reason, line count, total value, status and who created it. Page spec IN-27: skeleton, empty ("No hay ajustes registrados" + "Nuevo ajuste"), no results + "Limpiar filtros", error, no permission |
| New adjustment with reason | Int test: a 3-line adjustment (IN, OUT, COUNT) returns `APPROVED` with `approved_by` empty, writes the movements with the AJ- number and updates `stock_levels`. Missing reason → 400 `REASON_REQUIRED`. `OTHER` without a note → `REASON_NOTE_REQUIRED`. OUT beyond stock → 422 `INSUFFICIENT_STOCK`. Duplicate product → `DUPLICATE_LINE`. A high-value adjustment is also `APPROVED` at once (no threshold). 403 without `inventory.adjustments.create`. Audit and outbox are written. Page spec IN-08: the reason select is required, plus product search, line kind and quantity, a computed delta/value column, and confirm |

## Model
Migration `20261029100000_manual_stock_adjustments` (additive on the HU-INV-21 tables):
- `StockAdjustmentItemKind` gains `IN`, `OUT`, `COUNT` (`MANUAL` stays, unused).
- `stock_adjustments.note text NULL` (the domain requires it when the reason is `OTHER`).
- `stock_adjustment_items.entered_quantity int NULL`: what the user typed (for `COUNT`, the counted stock). `quantity` keeps its HU-INV-21 meaning, the **signed delta applied**, and `unit_cost` is the product's average cost when applied.
- `reason` stores the `AdjustmentReason` code (`SHRINKAGE`…); transfer differences keep their text.
- No new tables, so `TENANT_MODELS` is unchanged.

## Domain (`libs/domain/src/lib/stock-adjustment.ts`, additive)
- `validateAdjustmentDraft({ reason, note, lines })`: reason/note rules (existing errors), at least 1 line (`ADJUSTMENT_EMPTY`), no duplicate products (`DUPLICATE_LINE`), quantity ≥1 for IN/OUT and ≥0 for COUNT.
- `resolveAdjustment` (existing) gives each line's delta. An adjustment whose deltas are all 0 → `NO_STOCK_CHANGE`; a COUNT line equal to the stock is allowed when another line changes stock, and writes no movement.
- `adjustmentTotalValue(lines)` → `Decimal` string.
- List/detail/response types.
- **State machine:** unchanged. A manual adjustment is created already `APPROVED` (an initial state, not a transition), audited as `inventory.adjustment.create`.
- `needsApproval` stays for the quick adjustment only.

## API (new `stock-adjustments.controller.ts` + `stock-adjustments.service.ts`)
| Method | Route | Permission | Errors |
|---|---|---|---|
| GET | `/inventory/adjustments?status&warehouseId&reason&from&to&q&page&pageSize` | `inventory.adjustments.create` or `.approve` | 400 `INVALID_FILTER` |
| GET | `/inventory/adjustments/product-search?q&warehouseId` | `inventory.adjustments.create` | 404 `WAREHOUSE_NOT_FOUND` |
| GET | `/inventory/adjustments/:id` | same as the list | 404 `ADJUSTMENT_NOT_FOUND` |
| POST | `/inventory/adjustments` `{ warehouseId, reason, note?, lines: [{ productId, kind, quantity, expectedBalance? }] }` | `inventory.adjustments.create` | 400 `VALIDATION_FAILED`, `REASON_REQUIRED`, `REASON_NOTE_REQUIRED`, `ADJUSTMENT_EMPTY`, `DUPLICATE_LINE`; 404 `WAREHOUSE_NOT_FOUND`, `PRODUCT_NOT_FOUND`; 409 `STOCK_CHANGED`; 422 `INSUFFICIENT_STOCK`, `NO_STOCK_CHANGE` |

The list shows the manual and the transfer-difference adjustments (any status), scoped to the member's operable branches. Costs and values are `null` without `inventory.costs.view`.

**The create runs in one tx:**
1. Validate with the domain.
2. Check the warehouse scope.
3. Take the `AJ-` number (numbering lock first).
4. Lock each level in product-id order, check `expectedBalance`, compute the deltas.
5. Insert the document and its lines as `APPROVED`.
6. `StockMovementService.apply` per non-zero delta.
7. `AuditService.log('inventory.adjustment.create')`.
8. `OutboxService.publish('inventory.stock.changed', …, { tx })` per movement.

## ERP screens (`features/inventory/adjustments/*`)
**IN-27, list** (`/inventory/adjustments`):
- an `rs-doc-table` with filters (status, warehouse, reason, dates, search) and an `rs-status-pill` showing "Aplicado", "Pendiente de aprobación" (transfer differences) or "Rechazado";
- "Nuevo ajuste" (`*rsCan create`), and a row click opens a read-only detail (`/:id`);
- an "Ajustes" entry in the inventory nav.

**IN-08, new adjustment** (`/inventory/adjustments/new`):
- a header with the warehouse (defaults to the header branch), the reason (`rs-select`, from `ADJUSTMENT_REASON_LABELS`) and the note (`rs-textarea`, required for "Otro");
- lines: a product search (the adjustments' own endpoint), plus kind, quantity, current stock, the resulting stock and the value;
- a summary of the total value (no approval notice: it is applied on confirm);
- "Confirmar ajuste", followed by a toast with the AJ- number and a return to the list.
- The Spanish error mapping lives in `adjustments.mapper.ts` (as the transfers do), not in `api-error.ts`.

**States on every screen:** skeleton, empty, error and no permission.

**Components:** the existing `libs/ui` ones only. Check IN-27 and IN-08 in Figma at build time; any missing DS component goes into `libs/ui` with its own files.

## Tests
- **Unit (domain):** draft validation, deltas for each kind, total value with `Decimal`, the all-zero `NO_STOCK_CHANGE` rule.
- **Unit (ERP):** the list states and filters; the reason/note rule; adding and removing lines and blocking duplicates; the summary; the error mapping.
- **Integration (real Postgres):**
  - applied on create at any value, `approved_by` empty;
  - movements and `refId`/number;
  - shared `AJ-` numbering with the quick adjustment (no duplicates);
  - scope, tenant isolation and 403.
  - **Concurrency:**
    - two adjustments taking out the same last pieces → one succeeds and one gets `INSUFFICIENT_STOCK`, with no negative stock;
    - a quick adjustment and a document adjustment at the same time → unique numbers;
    - the kardex sum matching `stock_levels`.
- **E2E:** Warehouse → Ajustes → Nuevo ajuste → reason Merma, 2 lines → Confirmar → the list shows AJ-… "Aplicado" → the product's stock is updated.

## Open decisions used with defaults
- **#37 (threshold):** resolved for this form by the user: manual adjustments are always applied on creation. The setting still governs the quick adjustment (HU-INV-16), which answers `ADJUSTMENT_NEEDS_APPROVAL` above it; revisit if that should go too.

## Risks and doubts
- **Figma may show IN-08 as a single movement type for the whole document** rather than per line. Check during the build; per line is the more general option.
- **HU-INV-16's quick adjustment stays documentless.** The list (IN-27) only shows documents, so quick adjustments do **not** appear in it; they still appear in the kardex.
- **HU-INV-23 scope shrinks:** only transfer-difference adjustments can be pending, so the approval screen handles those.

## Files expected to change
- `apps/api/prisma/{schema.prisma, migrations/20261029100000_manual_stock_adjustments/}`
- `libs/domain/src/lib/{stock-adjustment.ts, stock-adjustment.spec.ts}`
- `apps/api/src/modules/inventory/{stock-adjustments.controller.ts, stock-adjustments.service.ts, stock-adjustments.dto.ts, stock-adjustments.int.spec.ts, inventory.module.ts}`
- `apps/api/src/modules/inventory/{business-days.ts, transfers.service.ts}` (the La Paz day helpers move to a shared file)
- `apps/erp/src/app/features/inventory/{inventory.routes.ts, inventory-layout.page.ts, adjustments/*}`
- `apps/erp-e2e/src/adjustments.spec.ts`
- `docs/plans/HU-INV-22.md`

## Verification
1. `pnpm nx affected -t lint typecheck test`.
2. The API int suite against Postgres, concurrency included.
3. Playwright.
4. Compare IN-27 and IN-08 against Figma.
5. Run the `reviewer`, `stock-auditor` and `ui-checker` agents.
