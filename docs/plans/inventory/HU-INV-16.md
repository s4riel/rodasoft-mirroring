# Plan · HU-INV-16 · Quick stock adjustment from the product sheet (IN-17)

## Context
Warehouse needs to correct a one-off stock difference for one product in one warehouse, straight from the product sheet, with a mandatory reason that shows up in the kardex. What already exists:
- **Stock writes:** `StockMovementService.apply(tx, input)` in `apps/api/src/modules/inventory/stock-movement.service.ts`. It is the only stock writer: it locks the level row `FOR UPDATE`, rejects negative stock with `INSUFFICIENT_STOCK`, requires a reason (`REASON_REQUIRED`), checks the sign against the type (`MOVEMENT_SIGN_MISMATCH`) and writes `balanceAfter`.
- **Model:** `stock_movements` is immutable (trigger) and has `ADJUSTMENT_IN` / `ADJUSTMENT_OUT`, `reason`, `refType`, `refId`, `refNumber` and `userId`.
- **Permissions and settings:** `inventory.adjustments.create` and `.approve` exist in `permissions.ts`. The setting `adjustments.approvalThresholdValue` exists (decision #37, default `null` = no limit).
- **Not yet:** there is no `stock_adjustments` document; HU-INV-22 (IN-27/IN-08) adds multi-line adjustments and HU-INV-23 their approval.

This story is the single-line shortcut: one movement, no document.

**Branches:** `feat/hu-inv-10` and 13 touch `stock-movement.service.ts` and `company-settings.ts`. Build on `feat/hu-inv-16` from `main`. The last migration on main is `20261024162520_product_deactivation`.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| Quantity and reason required | DTO and int test: missing or zero quantity → 400 `VALIDATION_FAILED`, a missing reason → 400 `REASON_REQUIRED`, `OTHER` without a note → 400 `REASON_NOTE_REQUIRED`. Page spec: "Ajustar" is disabled until direction, quantity ≥ 1 and reason are set, and inline errors show in Spanish |
| It is recorded in the kardex | Int test (real Postgres): `POST /inventory/products/:id/stock-adjustments` writes one `ADJUSTMENT_IN`/`OUT` movement with the signed quantity, `balanceAfter`, the reason label plus note, `refType 'ADJUSTMENT'`, a `refNumber` (`AJ-000123`) and the user. `stock_levels` matches the last `balanceAfter`; an audit row `inventory.stock.adjust` and an outbox `inventory.stock.changed` are written in the same tx. Page spec and E2E: after saving, the sheet's stock card and the movements list show the new line |

## Model
- No new tables.
- Migration `20261025100000_adjustment_number_sequence`: a per-company counter for `AJ-` numbers, via the existing document-sequence mechanism if one exists (check `document_sequences` during the build). HU-INV-22 reuses the same series, so quick and full adjustments share numbering.

## Domain (`libs/domain/src/lib/stock-adjustment.ts`)
- `ADJUSTMENT_REASONS = ['SHRINKAGE', 'COUNT_ERROR', 'DAMAGE', 'OTHER']`, with Spanish labels "Merma", "Error de conteo", "Daño", "Otro" (the catalog from design-notes).
- `buildAdjustmentMovement({ direction: 'IN' | 'OUT', quantity, reason, note })` returns `{ type, signedQuantity, reasonText }` and rejects `OTHER` without a note.
- `needsApproval(quantity, unitCost, threshold)` uses `Decimal`: `quantity × unitCost > threshold`, and `null` threshold → false.
- Types `QuickAdjustmentInput` and `QuickAdjustmentResponse { movementId, refNumber, balanceAfter, totalStock }`.

## API
| Method | Route | Permission | Errors |
|---|---|---|---|
| POST | `/inventory/products/:id/stock-adjustments` `{ warehouseId, direction, quantity, reason, note?, expectedBalance? }` | `inventory.adjustments.create` | 404 `PRODUCT_NOT_FOUND`/`WAREHOUSE_NOT_FOUND`, 422 `WAREHOUSE_INACTIVE`, 422 `INSUFFICIENT_STOCK`, 400 `REASON_REQUIRED`/`REASON_NOTE_REQUIRED`, 409 `STOCK_CHANGED` (balance ≠ `expectedBalance` under the lock), 422 `ADJUSTMENT_NEEDS_APPROVAL` |

- `StockAdjustmentService.quickAdjust()` runs in one `prisma.tenant.$transaction`:
  1. compute the movement in the domain;
  2. check the approval threshold with the product's average cost;
  3. reserve the `AJ-` number;
  4. call `StockMovementService.apply` (which locks the level row);
  5. compare `expectedBalance` with the locked balance;
  6. write `AuditService.log` and `OutboxService.publish('inventory.stock.changed', …, { tx })`.
- **Over the threshold** (only when the setting is non-null), return 422 `ADJUSTMENT_NEEDS_APPROVAL`. The ERP then says to use the full adjustment flow (HU-INV-22/23). Until that exists, the message only explains.
- Small change to `StockMovementService.apply`: return the movement `id` along with `balanceAfter`.

## ERP screens
- **IN-17:** an "Ajustar stock" button on the sheet (`*rsCan="'inventory.adjustments.create'"`). It opens `products/sheet/adjust-stock/adjust-stock.modal.*`, an `rs-modal` with:
  - an `rs-select` for the warehouse (active ones, with their current stock);
  - an `rs-segmented` / radio for Ingreso / Salida;
  - a number `rs-input` for the quantity;
  - an `rs-select` for the reason, plus an `rs-textarea` note that is required for "Otro";
  - a live preview "Stock actual 12 → nuevo 10";
  - Cancelar / "Ajustar".
- **Errors:** errors map through `api-error.ts`. `STOCK_CHANGED` refreshes the stock and shows an `rs-alert`, `INSUFFICIENT_STOCK` an inline error, and `ADJUSTMENT_NEEDS_APPROVAL` an `rs-note`.
- **Success:** a toast "Ajuste AJ-000123 registrado", the sheet's stock store refreshes, and the kardex/movements tab refreshes if it is present.
- **Components:** none new. Confirm `rs-segmented` exists; if not, use `rs-radio-group`. Check the texts against IN-17 in Figma during the build.

## Tests
- **Unit (domain):** reasons, sign per direction, the OTHER note, threshold edges (equal is not over, null).
- **Unit (ERP):** modal validation, preview, each error mapping, the permission-hidden button.
- **Integration (real Postgres):**
  - IN and OUT write the movement, level, audit and outbox;
  - negative stock is rejected;
  - inactive warehouse; `expectedBalance` mismatch;
  - threshold on and off; tenant isolation; 403 without the permission;
  - **concurrency:** two simultaneous OUT adjustments that together exceed the stock → one succeeds, one gets `INSUFFICIENT_STOCK`, stock never goes negative and the movements sum to the level.
- **E2E:** sheet → Ajustar stock → Salida 2, "Merma" → toast → the stock card is down 2 → the movement shows with its reason.

## Open decisions used with defaults
- **#37:** `adjustments.approvalThresholdValue` (existing setting, default `null` = no approval needed). The quick adjustment respects it.

## Risks and doubts
- **Delta or counted quantity?** I assumed a direction plus a quantity (delta). If IN-17 shows "cantidad contada" (set the absolute count), the domain computes the delta instead — check Figma before building.
- **Cost for the threshold:** the product's average cost; if there is none, the sale price is not used and the threshold check is skipped (logged).
- **Shared `AJ-` numbering** with HU-INV-22 — that story must reuse this sequence.
- Overlaps with HU-INV-10 on `stock-movement.service.ts` and `company-settings.ts`.

## Files expected to change
- `apps/api/prisma/migrations/20261025100000_adjustment_number_sequence/` (if a sequence row or table is needed), `schema.prisma`
- `libs/domain/src/lib/{stock-adjustment.ts, stock-adjustment.spec.ts}`, `libs/domain/src/index.ts`
- `apps/api/src/modules/inventory/{stock-adjustment.controller.ts, stock-adjustment.service.ts, stock-adjustment.dto.ts, stock-adjustment.int.spec.ts, stock-movement.service.ts, inventory.module.ts}`
- `apps/erp/src/app/features/inventory/products/sheet/{product-sheet.page.*, adjust-stock/*}`, `products-api.service.ts`
- `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/stock-adjustment.spec.ts`
- `docs/plans/HU-INV-16.md`

## Verification
`pnpm nx affected -t lint typecheck test`, then the API int suite against Postgres (including the concurrency test), then Playwright. Compare against IN-17. Run the `reviewer`, `stock-auditor` and `ui-checker` agents.
