# HU-VEN-12 + HU-VEN-13 · Sales made: list and sale detail (VP-01a/b/c/d, VP-02) — plan

## Context
HU-VEN-13 asks for a sale's detail (products, payment, linked invoice, history, reprint). Its entry point is the sales list (HU-VEN-12), which isn't built, so the two are planned **together on one branch, `feat/hu-ven-12-13`**, cut from `develop` (07+11 and 08 are merged). Today `SaleReceiptService.receipt()` only returns the cashier's own sales, and "Ver venta" in the sale-completed dialog is hidden "until HU-VEN-12". The plan is saved as `docs/plans/sales/HU-VEN-12-13.md`, the same layout as `HU-VEN-07-11.md`.

**Decisions taken in planning (4 Nov 2026):**
- Plan 12 + 13 together.
- New permission `sales.history.view-all` ("Ver todas las ventas"): without it a user sees only their own sales (`createdById`). Seed it in the admin and management roles, not Cajero.
- Reprint marks the ticket "REIMPRESIÓN · <fecha>", is audited (`sales.receipt.reprint`) and shows up in the sale's history.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| 12 · List with number, customer, date, items, total and status | Int `sales-history.int.spec.ts`: list returns those fields with newest first, paged. Page spec: the columns render, and the status shows as `rs-status-pill` in Spanish. |
| 12 · Filters | Int: date range (La Paz day bounds), status, payment method, search (number or customer name/document), cashier (only with view-all). Page spec: the filters build the query; filter state lives in the URL query params. |
| 12 · Menu per row with actions | Page spec: `rs-row-menu` has "Ver venta" and "Reimprimir"; "Solicitar anulación" and "Devolución" aren't rendered until HU-VEN-14/21. |
| 12 · Empty and loading states | Page spec: skeleton rows while loading. Two empty states: no sales at all vs. no results for the filters (the second has a "Limpiar filtros" button). Error and no-permission states are also covered (HU-TRV-03). |
| 13 · Products, payment, linked invoice and history | Int: `GET /sales/sales/:id` returns lines, payments (method, amount, change, reference), invoice (status, number or null, tax data) and history from `audit_logs`, oldest first, with user names. Page spec renders each section. |
| 13 · I can reprint | Int: `POST /sales/sales/:id/receipt/reprint` writes the audit row and returns `printedAt`. Print page spec: with `?reprint=1` it calls the endpoint and adds the "REIMPRESIÓN · dd/mm/aaaa hh:mm" header line. Detail spec: the history shows "Comprobante reimpreso". |
| Visibility | Int: a cashier opening another cashier's sale gets 404 `SALE_NOT_FOUND`, in both list and detail. With view-all, every sale of the company is visible. Tenant isolation is tested. |

## Model
- No new tables. `Sale`, `SaleItem`, `SalePayment`, `Invoice` and `AuditLog` already have everything. `TENANT_MODELS` stays unchanged.
- Migration `<ts>_sales_history_indexes`: `sales (company_id, created_at DESC)` and `sales (company_id, created_by_id, created_at DESC)`, for the unfiltered list and the cashier's own list. `(company_id, status, created_at)` already exists.
- Permission `sales.history.view-all` goes in `libs/domain/src/lib/permissions.ts` (label "Ver todas las ventas") and the default roles (admin and management). Check how `seed-base.ts` syncs roles.

## Domain (`libs/domain`)
New file `sale-history.ts` (+ spec) with the shared contract types: `SaleListQuery`, `SaleListItem`, `SaleListResponse`, `SaleDetail`, `SaleHistoryEntry`, `SALE_PAGE_SIZE_DEFAULT/MAX`. It also has pure helpers:
- `saleItemsCount(lines)`.
- `laPazDayRange(from, to)`: reuse the existing date helper if one exists (check `kardex.ts` / the transfers filters first).
- `saleHistoryLabel(action)` is not here: Spanish text lives in the ERP.

Reuse `SaleReceipt`/`buildReceiptLines` from `sale-receipt.ts` and `clampPage`/`clampPageSize` from `product-catalog.ts`. No state-machine change, since this is read-only plus an audit entry.

## API (`apps/api/src/modules/sales/sales/`)
New `sales-history.service.ts` + `sales-history.controller.ts` (or extend `SaleReceiptController`; the route prefix `sales/sales` is shared). All routes require `sales.pos.use`. Visibility: `scope = granted.has('sales.history.view-all') ? {} : { createdById: userId }`, and every query goes through `prisma.tenant`.

| Method · route | Purpose | Error `code`s |
|---|---|---|
| `GET /sales/sales?page&pageSize&from&to&status&method&q&cashierId` | VP-01 list (transfers `page()` pattern: `count` + `findMany` in one `$transaction`) | `VALIDATION_FAILED` |
| `GET /sales/sales/:id` | VP-02 detail: sale, lines (code, name, qty, unit, total), payments, invoice, branch, cashier, customer, history | `SALE_NOT_FOUND` |
| `GET /sales/sales/:id/receipt` | Existing; widened to the same visibility scope | `SALE_NOT_FOUND` |
| `POST /sales/sales/:id/receipt/reprint` | Audits `sales.receipt.reprint` (`entity: 'Sale'`) and returns `{ printedAt }` | `SALE_NOT_FOUND` |
| `POST /sales/sales/:id/receipt/email` | Existing; same widened scope | existing |

- `cashierId` is ignored (forced to self) without view-all.
- History comes from `auditLog.findMany({ where: { companyId, entity: 'Sale', entityId: id }, orderBy: createdAt asc })` with user names joined. It returns `action`, `at` and a whitelisted `details` (email address only), never raw before/after JSON. Future cancellation/invoice events appear automatically.
- Costs are never returned (HU-TRV-02).
- No outbox events. The visibility scope is one private helper shared by the receipt and history services so they can't drift.

## ERP screens (`apps/erp/src/app/features/sales/history/`)
- Register `history` (and the child `history/:id`) in `BUILT_TABS` of `sales.routes.ts`. The tab already exists in `sales-tabs.ts`.
- **VP-01a/b/c/d `sales-history.page`:** `rs-page-header`, filter bar (`rs-date-range-picker`, `rs-select` for status/method/cashier, `rs-input` search, `rs-filter-chip`), `rs-doc-table`, `rs-status-pill`, `rs-row-menu`, `rs-pagination`, `rs-skeleton`, `rs-empty-state-illustrated`. The cashier filter shows only with view-all (`rs-can`).
- **VP-02 `sale-detail.page`:** `rs-breadcrumb` back to the list. Uses `rs-data-field` for the header (number, date, branch, cashier, customer, status), `rs-doc-table` for the lines, a payments block, an invoice block (status pill plus "Pendiente de emisión SIAT" `rs-note` while `PENDING`), and the history list. Buttons: "Reimprimir" opens `/sales/receipts/:id/print?reprint=1` in a new tab; "Enviar por e-mail" reuses the existing e-mail request.
- **History list:** check Figma VP-02 at build time with `get_design_context`. If it's a simple list, it's page markup. If Figma has a Timeline/Activity component, build `rs-timeline` in `libs/ui` (own `.ts/.html/.scss/spec`, export, `/design-system`, `docs/ui-library.md`). None exists today.
- **`receipt-print.page`:** read `reprint` from the query params, call the reprint endpoint, and prepend the "REIMPRESIÓN · …" line to `headerLines`. No change to `rs-receipt`.
- **`pos-sale-completed.dialog.html`:** enable "Ver venta" → `/sales/history/:id`.
- New `sales-history-api.service.ts`. Spanish labels for statuses, methods and history actions go in a `sale-format.ts` (+ spec). Spanish for `SALE_NOT_FOUND` is already in `api-error.ts` (verify).

## Tests
- **Unit:** `sale-history.spec.ts` (domain); `sale-format.spec.ts`; list page spec (columns, filters → query/URL, row menu, loading/empty/filtered-empty/error/forbidden); detail page spec (sections, invoice pending note, history labels, reprint link); print page spec (reprint banner + endpoint call); dialog spec ("Ver venta" link).
- **Integration (real Postgres), `sales-history.int.spec.ts`:** paging and order; each filter, including La Paz day bounds at 23:30 local; search by number and by customer document; own-only vs view-all on list, detail, receipt and email; `cashierId` ignored without view-all; detail payload with mixed payments and invoice; history order and user names; reprint writes exactly one audit row per call; tenant isolation; no cost fields in the payloads.
- **E2E:** new `apps/erp-e2e/src/sales-history.spec.ts`: cash sale → "Ver venta" → detail shows the line, payment and invoice "Pendiente" → Reimprimir → history shows "Comprobante reimpreso" → back to the list, the sale is first, filter by number finds it.
- **Agents:** `ui-checker`, `reviewer` (no stock change, so `stock-auditor` isn't required); then `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default
- **#9:** the reprint uses `sales.receiptFormat` (80 mm by default), the same as the original.
- The cancellation and return row actions (#10/#11/#15) arrive with HU-VEN-14/15/21.

## Risks and doubts
1. Figma VP-01a–d and VP-02 haven't been opened yet. Exact filters, columns and the history layout get confirmed at build time; a filter shown in Figma that the plan doesn't list gets added if it's cheap.
2. Customer search uses `invoices.customer_tax_name` / `customer_document_number` (copied at sale time) with `ILIKE`. That's fine at current volumes; a trigram index can come later.
3. The history only shows events from now on; existing sales show just "Venta completada" (`sales.sale.complete`).
4. `HU-VEN-09` (mixed payment) also touches `pos-sale-completed.dialog` and `sale-receipt.service`. Its changes are small, but merge order matters if both run in parallel.

## Files expected to change
- `apps/api/prisma/schema.prisma` (indexes), `apps/api/prisma/migrations/<ts>_sales_history_indexes/`, `apps/api/prisma/seed-base.ts` (verify only)
- `libs/domain/src/lib/permissions.ts`, `libs/domain/src/lib/sale-history.ts` (+ spec), `libs/domain/src/index.ts`
- `apps/api/src/modules/sales/sales/**` (history service/controller, receipt scope, DTOs, int spec), `apps/api/src/modules/sales/sales.module.ts`
- `apps/erp/src/app/features/sales/history/**` (new), `sales.routes.ts`, `receipts/receipt-print.page.*`, `pos/pos-sale-completed.dialog.html`, `apps/erp/src/app/core/api-error.ts`
- Possibly `libs/ui/src/lib/timeline/**`, `libs/ui/src/index.ts`, `docs/ui-library.md`, `apps/erp/src/app/features/design-system/**`
- `apps/erp-e2e/src/sales-history.spec.ts`
- `docs/backlog/sales.md` (status of 12 and 13)

## Verification
Run the int spec against local Postgres, the ERP unit specs and the Playwright E2E above. Manual check: log in as a cashier (sees only their own sales) and as management (sees all, cashier filter visible), then reprint from the detail and check the banner and the history entry. Finish with `pnpm nx affected -t lint typecheck test`.
