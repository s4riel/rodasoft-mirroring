# HU-VEN-27 + HU-VEN-29 · Bulk price update and approvals inbox (VP-11c, VP-25; decision #19) — plan

## Context
- **HU-VEN-28 is RETIRED** (3 Nov 2026, replaced by the per-customer discount) and is not planned (confirmed 11 Nov 2026).
- **HU-VEN-27** (Management): update prices in bulk by brand or category; choose filter and percentage; preview before applying. Today prices change one by one (HU-VEN-26); `PriceChangeSource.BULK`, `price_changes.batch_id` and `recordPriceChange({ batchId })` exist but nothing writes them.
- **HU-VEN-29** (Management): one inbox with everything awaiting approval, grouped by type; approve or reject with a comment. Today each request (`ApprovalRequest` `CANCELLATION`, `CASH_DIFFERENCE`, `RETURN`, `CASH_EXPENSE`) is decided only from its own screen; cash expenses are reachable only by URL; the "Aprobaciones" tab is a placeholder. No discount group (scope note of the story).
- Figma `JYULL6jvXiwNP8UVvEF7tl` page 09: VP-11c `103:18746`, VP-25 `103:18898`.

**Branch:** `feat/hu-ven-27-29`, cut from `feat/hu-ven-24-25-26` (commit `0f35fce`, not yet in `develop`) or from `develop` once merged. **No migration** in this branch; no other branch carries an unmerged migration.

**Decisions taken in planning (11 Nov 2026):**
- Adjustment types: only "Aumentar %" and "Rebajar %". "Sumar monto" and "Precio fijo" are not drawn.
- "Vigente desde", the "Proveedor" filter (no supplier on products) and "Descargar vista previa" are left out. The preview is a paginated table of all matching products.
- Inbox actions as in Figma: returns and cash expenses decide inline (Aprobar / Rechazar + comment dialog); cancellations and cash differences show "Ver detalle" to their existing review pages.
- Decision #19: new setting `sales.bulkPriceRequiresApproval` (default `false`). While `true`, applying is refused; the real approval flow is a later story.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| 27 · I choose the filter and percentage | Unit `pricing.spec.ts`: `validateBulkAdjustment` (direction, percent > 0, ≤ 2 decimals, decrease < 100, increase ≤ `BULK_PERCENT_MAX`), `applyBulkAdjustment` (percent then rounding `NONE` / `HALF_BOLIVIANO` / `INTEGER` through `roundSaleTotal`; result ≤ 0 or equal → skipped with a reason). Int `price-bulk.int.spec.ts`: filter by brand, by category (subcategories included), by both; no filter → `BULK_FILTER_REQUIRED`; unknown brand/category or other company's → `INVALID_FILTER`; drafts never match; 403 without `sales.prices.edit`. Page spec: selects, chips, percent input, live count "142 productos coinciden con el filtro". |
| 27 · I see a preview before applying | Int: `POST /sales/prices/bulk/preview` writes nothing and returns counts (matched, toChange, unchanged, invalid), paginated rows (code, product, brand, current, new, change %) and `previewHash`. `POST …/apply` with that hash updates every `products.sale_price`, writes one `price_changes` row per product (`source BULK`, same `batch_id`, reason), **one** audit `sales.price.bulk-update` and **one** outbox `sales.prices.bulk-changed`, atomically; without or with a stale hash (a price edited or a product added between preview and apply) → 409 `BULK_PREVIEW_STALE`, nothing written. `sales.bulkPriceRequiresApproval = true` → `BULK_PRICE_APPROVAL_REQUIRED`. Nothing to change → `BULK_NOTHING_TO_CHANGE`. **Concurrency:** two applies with the same hash → one wins, one stale; apply × single `PATCH /sales/prices/:id` on a matching product → both consistent (one history row each, no lost update). Company B untouched. Page spec: "Aplicar a N productos" disabled until a preview is loaded, confirmation modal, success toast and return to the list. |
| 29 · Grouped by type | Int `approvals-inbox.int.spec.ts`: `GET /sales/approvals` returns only `PENDING` requests in groups `CANCELLATION`, `CASH_DIFFERENCE`, `RETURN`, `CASH_EXPENSE` with count, each item with title data (sale / shift / return number, customer, register), requester name, reason, comment, signed amount, age, `canDecide`; only the types whose approve permission the caller holds; branch scope through the subject (`operableBranchIds`), cancellations through the existing sale visibility; other company never listed; KPIs pending, oldest, approved today, rejected today (La Paz day). 403 with none of the four permissions. Page spec (VP-25): 4 KPI cards, a section per type with its count, empty / loading / error / no-permission states. |
| 29 · I approve or reject with a comment | Page + dialog specs: return and cash-expense rows open `approval-decision.dialog`; "Rechazar" requires the comment, "Aprobar" takes an optional one; they call the existing `POST /sales/returns/:id/approve|reject` and `POST /sales/cash-movements/:id/approve|reject`; on success the row leaves the list, KPIs and the tab badge refresh; `*_NOT_PENDING` → toast + reload. Cancellation and cash-difference rows link to `history/:id/cancellation` and `cash-register/shifts/:id/review`. Existing int specs already prove the decision transactions (audit, outbox, stock, cash); int adds: after a decision the request is gone from the inbox and counted in "today". E2E below. |

## Model
- **No Prisma change, no migration.** `price_changes.batch_id` + `@@index([companyId, batchId])`, `PriceChangeSource.BULK`, `approval_requests` + `@@index([companyId, status, type])` already exist. `ApprovalRequest` and `PriceChange` are already in `TENANT_MODELS`.
- The batch is not a table: its header (filter, direction, percent, rounding, counts, reason, user) lives in the audit row and the outbox payload; rows are found by `batch_id`.

## Domain (`libs/domain`)
- `pricing.ts` (+spec): `BulkPriceDirection = 'INCREASE' | 'DECREASE'`, `BULK_PERCENT_MAX` (1000), `BULK_PRICE_MAX_PRODUCTS` (5000), `validateBulkAdjustment(input)` → `INVALID_PERCENT | INVALID_DIRECTION | INVALID_ROUNDING`, `applyBulkAdjustment(price, { direction, percent }, rounding)` → `{ newPrice } | { skipped: 'UNCHANGED' | 'INVALID' }` (uses `Decimal.percent` and `roundSaleTotal` from `sales-pricing.ts`; no new rounding function); contracts `BulkPriceInput`, `BulkPricePreviewRow`, `BulkPricePreview`, `BulkPriceResult`.
- New `approvals.ts` (+spec): `APPROVAL_TYPES`, `APPROVAL_TYPE_PERMISSION` (`CANCELLATION → sales.cancellations.approve`, `CASH_DIFFERENCE → sales.cash-register.review`, `RETURN → sales.returns.approve`, `CASH_EXPENSE → sales.cash-expenses.approve`), `approvalTypesFor(permissions)`, `APPROVAL_INLINE_TYPES` (`RETURN`, `CASH_EXPENSE`), `APPROVAL_INBOX_MAX` (200), contracts `ApprovalInboxItem`, `ApprovalInboxGroup`, `ApprovalInboxKpis`, `ApprovalInboxResponse`, `ApprovalInboxSummary`.
- `company-settings.ts`: `sales.bulkPriceRequiresApproval: boolean` (default `false`).
- `state-machine.ts`, `permissions.ts`: **no change** (no new permission key; the four approve keys exist and are seeded).

## API
`apps/api/src/modules/sales/pricing/` — new `PriceBulkService`, routes on `PricesController` (class permission `sales.prices.edit`):
| Method · route | Body | Error `code`s |
|---|---|---|
| `POST /sales/prices/bulk/preview` | `{ brandId?, categoryId?, direction, percent, rounding, page?, pageSize? }` | `VALIDATION_FAILED`, `BULK_FILTER_REQUIRED`, `INVALID_FILTER`, `INVALID_PERCENT`, `BULK_TOO_MANY_PRODUCTS` |
| `POST /sales/prices/bulk/apply` | same + `previewHash`, `reason?` | same + `BULK_PREVIEW_STALE` (409), `BULK_NOTHING_TO_CHANGE` (409), `BULK_PRICE_APPROVAL_REQUIRED` (409) |

- Preview response also carries `defaultRounding` (`sales.roundingMode`) and `requiresApproval` so the screen can preselect the chip and disable "Aplicar".
- Shared filter: extract the brand / category(+children) / not-`DRAFT` `where` from `PricesService.list` into `price-filter.ts` and reuse it in both.
- `previewHash` = sha256 of the ordered `productId:oldPrice:newPrice` of the rows to change (stateless, like the import preview → commit; nothing stored).
- Apply tx (`prisma.tenant.$transaction`, long timeout as the import): `pg_advisory_xact_lock(company || ':price-bulk')` → `SettingsService.get('sales.bulkPriceRequiresApproval', tx)` → `SELECT id, sku, sale_price FROM products … FOR UPDATE ORDER BY id` → `applyBulkAdjustment` per row → compare hash → one `UPDATE products … FROM unnest(ids, prices)` setting `sale_price`, `updated_by_id`, `updated_at` → `recordPriceChanges(tx, rows, { batchId, source: 'BULK', reason })` (new `createMany` sibling of `recordPriceChange` in `common/prices/price-change.recorder.ts`) → `AuditService.log('sales.price.bulk-update', entity 'PriceBatch', entityId batchId, after: filter, adjustment, counts)` → `OutboxService.publish('sales.prices.bulk-changed', { batchId, count, filter, direction, percent, rounding, userId }, { tx, idempotencyKey: 'price-batch:<batchId>' })`.
- Open carts keep the existing `PRICES_CHANGED` check at payment; no stock is touched.

`apps/api/src/modules/sales/approvals/` — new `ApprovalsController`, `ApprovalsInboxService`, `approvals.errors.ts`:
| Method · route | Permission | Error `code`s |
|---|---|---|
| `GET /sales/approvals` (`type?`) | any of the four approve keys (`@RequireAnyPermission`) | `INVALID_FILTER` |
| `GET /sales/approvals/summary` → `{ pending }` | same | — |

- Read only. Pending requests of the permitted types (cap `APPROVAL_INBOX_MAX`, oldest first, `truncated` flag) → subjects loaded in one batched query per type (no N+1): `Sale` (+ invoice number), `CashShift` (+ register), `SaleReturn` (+ sale, customer, pieces), `CashMovement` (+ shift, register) → branch scope via `MembershipService.operableBranchIds`; cancellations via `SaleVisibilityService` → user names → `canDecide` (false on the caller's own shift, mirroring `CASH_SHIFT_SELF_REVIEW`).
- **No new decision endpoint:** decisions keep going through the existing type endpoints, so audit, outbox, state machines and side effects stay in one place.
- Outbox / worker: add type `sales.prices.bulk-changed` to `outbox.service.ts` and `apps/worker/src/common/queues.ts` (accounting, no consumer); update the "until the approvals inbox" comment (the inbox reads the table, it consumes no event).

## ERP screens (`apps/erp/src/app/features/sales/`)
- **VP-11c `prices/price-bulk-update.page`** (`prices/bulk`; `prices` becomes a route with children): `rs-page-header type="form"` "Actualización masiva de precios"; card "1. Qué productos": `rs-field` + `rs-select` Marca, Categoría (options from the price list response) and the match count; card "2. Cómo ajustar": `rs-filter-chip` groups "Tipo de ajuste" (Aumentar % / Rebajar %) and "Redondeo" (Sin redondeo / A Bs 0,50 / A Bs 1, preselected from `sales.roundingMode`), `rs-field` + `input[rsNumeric]` "Porcentaje *"; card "3. Vista previa (N de M)": `rs-doc-table` Código, Producto, Actual, Nuevo, Cambio + `rs-pagination`, with skipped counts in an `rs-note`; `rs-note` warning (applies at once, kept in the history; "requiere aprobación" when the setting is on); buttons Cancelar / "Aplicar a N productos" → `rs-modal variant="confirmation"` with optional `textarea[rsTextarea]` "Motivo". Preview reloads (debounced) on any change; `BULK_PREVIEW_STALE` reloads it with a toast. States: loading, empty (no match), error, no-permission.
- `prices/price-list.page`: header action "Actualización masiva" (`[rsActions]`, `*rsCan="'sales.prices.edit'"`); `price-format.ts` `changeAuthor`: `BULK` → "actualización masiva"; `prices-api.service.ts`: `bulkPreview`, `bulkApply`.
- **VP-25 `approvals/approvals-inbox.page`** (tab `approvals` in `BUILT_TABS`): header "Aprobaciones" + description; 4 `rs-kpi-card` (Pendientes, Más antigua, Aprobadas hoy, Rechazadas hoy); `rs-filter-chip` per type with count (Todas, Anulaciones, Diferencias de caja, Devoluciones, Gastos de caja; only permitted types); one section per type with heading + count and its request cards; card actions "Rechazar" / "Aprobar" (inline types) or "Ver detalle"; `rs-note` at the end (who can decide what). States: loading (`rs-skeleton`), empty ("No hay solicitudes pendientes", illustrated), error, no-permission. The chips "Lista de precios" / "Reglas de descuento" of the frame are not drawn (the inbox is its own sales tab).
- **`approvals/approval-decision.dialog`**: `rs-modal variant="form"`, inputs `item`, `decision`; summary of the request, `rs-field` + `textarea[rsTextarea]` (required on reject, max 500), calls `ReturnsApi` / `CashApi`; output `decided`.
- `approvals/approvals-api.service.ts`, `approval-format.ts` (type labels, title / detail lines, link per type), `approvals.testing.ts`.
- `sales-tabs.ts`: approvals tab permissions = the four approve keys. `sales-layout.page`: `badge` on the Aprobaciones item from `GET /sales/approvals/summary` (small `ApprovalsCountStore`, refreshed on entering sales and after a decision). `sales.routes.ts`, `core/api-error.ts` (new codes in Spanish). The shell bell stays static (out of scope).
- **`libs/ui` — one new component: `rs-request-card`** (`request-card.component.{ts,html,scss,spec.ts}`): kicker (type), title, description, amount (tone `neutral | negative`), projected actions. Reason: VP-25 "Solicitud/…" is a three-line card with amount and actions; `rs-doc-table` rows cannot hold it and no existing card matches. Figma draws it as plain frames → **estimated, add to the Design System**; showcase section + `docs/ui-library.md`.

## Tests
- **Unit (domain):** `pricing.spec.ts` (bulk validation, percent + rounding, skip reasons, 2-decimal results), `approvals.spec.ts` (types per permission set), `company-settings.spec.ts` (new key).
- **Integration (real Postgres):** `price-bulk.int.spec.ts` (preview writes nothing, atomic apply, hash staleness, setting block, guards, tenant isolation, both concurrency cases, 1 000-product batch in one tx); `approvals-inbox.int.spec.ts` (one request of each type, permission subsets, branch scope, sale visibility, KPIs, own shift `canDecide: false`, decided requests leave the list); `prices-permissions.spec.ts` (+2 handlers), new `approvals-permissions.spec.ts`; `pos.int-fixture.ts` exposes the two new services.
- **ERP:** specs for the 2 pages, the dialog, `price-list.page.spec.ts` (header action), `price-format.spec.ts`, `sales-layout.page.spec.ts` + `app.routes.spec.ts` (tab permissions, badge), `request-card.component.spec.ts`.
- **E2E (Playwright):** extend `prices.spec.ts`: Precios → "Actualización masiva" → brand + "Aumentar 5 %" → preview rows → apply → list shows new prices and "actualización masiva"; DB: one `batch_id`, one audit row. New `approvals.spec.ts`: seed (Prisma) a pending return and a cash expense → Aprobaciones shows both groups and the badge → reject the expense without comment (blocked), with comment → approve the return → empty state; "Ver detalle" of a cancellation opens VP-15c. Update `sales-layout.spec.ts` (tab permissions).
- Agents: `ui-checker`, `reviewer`; `stock-auditor` not needed (no new stock write path). Then `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default value
- **#19** (bulk changes need approval?): default **no** → `sales.bulkPriceRequiresApproval = false`, per company. `true` blocks "Aplicar" (`BULK_PRICE_APPROVAL_REQUIRED`) until the approval flow exists.
- **#54** (rounding): the bulk screen preselects `sales.roundingMode` (`NONE`); the user may pick another mode for that batch.
- **#11, #15, #16, #17** (who approves): unchanged — the existing permissions; the inbox only reads them.

## Risks and doubts
1. With the setting `true` there is no way to apply a bulk change until a follow-up story adds a `PRICE_BATCH` approval (needs a stored batch + migration).
2. Inline approval of a return or expense triggers its side effects (restock, cash refund, cash out) from the inbox without opening the detail; errors such as `CASH_SHIFT_NOT_OPEN_FOR_REFUND` or `CASH_EXPENSE_EXCEEDS_CASH` surface as toasts. A "Ver detalle" link stays on those rows too.
3. Self-approval rules stay as they are and differ by type (blocked only for cash differences).
4. Withdrawn requests count in neither "today" KPI; "Aprobadas / Rechazadas hoy" count decisions by anyone in the caller's scope. An observed shift counts as rejected.
5. Bulk apply locks every matching product row in one transaction (cap 5 000); POS payments on those products wait for it. "Cambios este mes" counts every bulk row.
6. Products without price (`sale_price = 0`) are never changed by a percentage; they are reported as skipped.
7. Rounding can make a small change vanish (e.g. +1 % with "A Bs 1"); those rows show as "sin cambio" in the preview.
8. No batch undo; reverting is another bulk update or single edits.
9. Shifts closed before HU-VEN-23 have no `ApprovalRequest` and do not appear in the inbox (still reachable from Historial de turnos).
10. `rs-request-card` and the texts of the two `Note`s were not read from Figma (only frame metadata); confirm with design at build (`get_design_context` on `103:18746`, `103:18898`).

## Files expected to change
- `libs/domain/src/lib/{pricing,company-settings}.ts` (+specs), new `approvals.ts` (+spec), `libs/domain/src/index.ts`
- `apps/api/src/modules/sales/pricing/{prices.controller,prices.service,prices.dto,prices.errors}.ts`, new `price-bulk.service.ts`, `price-filter.ts`, `price-bulk.int.spec.ts`, `prices-permissions.spec.ts`
- `apps/api/src/common/prices/price-change.recorder.ts`
- `apps/api/src/modules/sales/approvals/**` (new), `sales.module.ts`, `pos/pos.int-fixture.ts`
- `apps/api/src/common/outbox/outbox.service.ts`, `apps/worker/src/common/queues.ts`, settings seed
- `libs/ui/src/lib/request-card/**` (new), `libs/ui/src/lib/erp-components.ts`, design-system showcase section
- `apps/erp/src/app/features/sales/prices/**` (new bulk page; list page, api, format), `approvals/**` (new), `sales.routes.ts`, `sales-tabs.ts`, `sales-layout.page.{ts,spec.ts}`, `apps/erp/src/app/app.routes.spec.ts`, `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/{prices,approvals,sales-layout}.spec.ts`
- `docs/backlog/sales.md` (status), `docs/backlog/decisions.md` (#19 setting), `docs/ui-library.md`, `docs/sales/design-notes.md` (settings list)

Overlaps: `outbox.service.ts`, `queues.ts`, `sales.routes.ts`, `sales-tabs.ts`, `api-error.ts`, `pos.int-fixture.ts`, `company-settings.ts` are shared with every sales story. `schema.prisma` is **not** touched.

## Verification
Int specs on local Postgres (incl. concurrency), ERP specs, Playwright. Manual: as Gerencia open Precios → "Actualización masiva", pick SKF + "Aumentar 5 %" + "A Bs 0,50", check the preview and counts, apply, see the list, the product history and the POS price; edit one product in another tab between preview and apply → stale message. Turn `sales.bulkPriceRequiresApproval` on → "Aplicar" blocked. As cashier create a return over the limit, an expense over the limit, a cancellation request and close a shift with a difference; as Gerencia open Aprobaciones: four groups, badge 4; reject the expense (comment required), approve the return, open "Ver detalle" for the other two and decide there; inbox ends empty. As Contador only "Diferencias de caja" shows. Finish with `pnpm nx affected -t lint typecheck test`.

## After approval
Save to `docs/plans/sales/HU-VEN-27-29.md` (uncommitted; same naming as `HU-VEN-24-25-26.md`), then run `/story-build HU-VEN-27 HU-VEN-29` in a fresh session.
