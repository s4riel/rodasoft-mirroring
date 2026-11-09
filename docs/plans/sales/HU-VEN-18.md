# HU-VEN-16 · 17 · 18 · Quotes: create, send, follow up and renew (VP-07, VP-08, VP-08b, VP-17, VP-17b; decision #12) — plan

## RESOLUTIONS (override anything below that conflicts)
Branch `feat/hu-ven-18`, cut from `feat/hu-ven-15` (created). Pending points solved with defaults:
1. **Scope = HU-VEN-17 + 18 only.** HU-VEN-16 (list VP-07, editor VP-08, create/edit API, product/customer search, `quote-format.ts`, `quotes-api.service.ts`, `QuotesService` create/list) belongs to `docs/plans/sales/HU-VEN-16-19.md`. Ignore every 16 item below; build 17/18 on top of that merged work (cut/rebase from `develop` once 16+19 land). Where this branch needs a quote to test, use fixtures.
2. **Price column** is `Product.salePrice` (16-19 plan says `Product.price`; fix there).
3. **No per-line discount** (decision #5): VP-17 "Desc." column shows the customer % or is dropped.
4. **Warehouse** is chosen at conversion (16-19 flow), not on the quote. No `warehouse_id`/`branch_id` columns here; drop "Plazo de entrega" select and the "Sucursal" filter. Stock column on the detail uses the user's branch main warehouse.
5. **`quoteMachine`**: keep 16-19's `DRAFT→accept` and add `EXPIRED→reject`.
6. **Vendedor** = creator, read-only; all `sales.quotes.manage` users see all quotes.
7. **PDF** = browser print of the letter layout; **WhatsApp** = `wa.me` link, logged on open.
8. Migration `<ts>_quote_sending` only adds `notes`, `payment_condition`, `sent_at` (after `20261107170000`).

## Context
HU-VEN-18 (follow a quote's status, know when it expires, renew it) has nothing to stand on: quotes exist only as the `Quote`/`QuoteItem` tables, `quoteMachine`, the `COT-` series and `sales.quoteValidityDays` (HU-VEN-00). Decided with you (7 Nov 2026): **plan HU-VEN-16 + 17 + 18 together on one branch `feat/hu-ven-16-18`**, and expiry is **computed on read + saved by a nightly worker job**.

Figma `JYULL6jvXiwNP8UVvEF7tl`, page 09: VP-07 `103:11732`, VP-08 `103:11741`, VP-08b `103:11792`, VP-17 `103:11883`, VP-17b `103:11960`.

Branch: cut from `develop` after `feat/hu-ven-14` is merged (both touch `state-machine.ts`, `schema.prisma`, `api-error.ts`, `sales.module.ts`, `libs/domain/src/index.ts`). Note: HU-VEN-14 currently fails `api:typecheck` (`sales-history.service.ts:126`, missing `cancellation`) — that is HU-VEN-14's to fix.

## Acceptance criteria → checks
| Story · criterion | Proof |
|---|---|
| 16 · List of quotes with status | Int `quotes.int.spec.ts`: list paginates, filters by `q` (number/customer), `status`, `sellerId`, `branchId`; a SENT quote with `validUntil` < La Paz today comes back as `EXPIRED` and matches the `EXPIRED` filter. Page spec `quotes.page.spec.ts`: columns, status pills, empty/loading/error states, URL filters. |
| 16 · New quote with search, quantities and validity | Int: create → DRAFT `COT-000001`, prices = `Product.salePrice`, customer discount + rounding via `cartTotals`, `validUntil` defaults to today + `sales.quoteValidityDays`; past date → `QUOTE_VALIDITY_IN_PAST`; no items → `QUOTE_EMPTY`; inactive product → `QUOTE_PRODUCT_NOT_SELLABLE`; inactive customer → `CUSTOMER_INACTIVE`; edit only while DRAFT (`QUOTE_NOT_EDITABLE`). 20 concurrent creates → 20 distinct numbers. Editor spec: search adds line, Enter adds first result, qty stepper, remove, totals preview, "Por defecto N días." hint. |
| 17 · Preview of the document | Domain `quote-document.spec.ts` (`buildQuoteDocument`, `quoteShareText`). Dialog spec: preview renders via `rs-receipt` (letter) with number, dates, customer, lines, total, notes. |
| 17 · Sending by WhatsApp or e-mail | Int: `POST …/send` `EMAIL` publishes outbox `sales.quote-email` in the tx; invalid address → `INVALID_EMAIL`; `WHATSAPP` needs a phone. Worker `mail.processor.spec`: new case renders the e-mail. Dialog spec: WhatsApp opens a `wa.me` link with the message; PDF opens the print page. |
| 17 · The sending is recorded | Int: each send appends `{ channel, to, at, userId }` to `send_log` (row-locked), first send moves DRAFT → SENT, re-send on SENT keeps SENT; send on EXPIRED → `QUOTE_EXPIRED`; one audit `sales.quote.send` per send. Detail shows the log. |
| 18 · Detail with statuses | Int: detail returns effective status, timeline (from audit: created, sent, expired/rejected/renewed with dates), send log, per-line available stock (`quantity - reserved`) in the quote's warehouse. Detail spec: timeline steps Borrador → Enviada → Esperando respuesta / Vencida / Rechazada → Convertida (pending), 4 KPI cards, "Sin existencia" pill. |
| 18 · An expired quote says so and can be renewed | Domain spec `effectiveQuoteStatus` (incl. 23:30 La Paz edge). Int: renew on an effectively expired quote saves `expire` then `renew` in one tx, recomputes prices from current `salePrice` and customer discount, new `validUntil`, status SENT, audit `sales.quote.renew` with before/after totals; renew on SENT → `QUOTE_INVALID_TRANSITION`. Worker int `quote-expiry.int.spec.ts`: job expires only SENT past-date quotes, idempotent, one audit `sales.quote.expire` each (user null), other company untouched. Detail spec: VP-17b banner "La cotización venció…", "Venció" card in warning, "Renovar validez" action. |
| 18 · Reject (Figma "Marcar como rechazada") | Int: SENT or EXPIRED → REJECTED with audit; DRAFT → `QUOTE_INVALID_TRANSITION`. |

## Model
Migration **`<ts>_quotes`** (timestamp after `20261107155756_sale_cancellation_request`). `Quote`/`QuoteItem` are already in `TENANT_MODELS`.
- `Quote` adds: `warehouseId` (`@map("warehouse_id")`, required — stock source, also used by the order in HU-VEN-19, decision #13), `branchId` (derived from the warehouse; list filter "Sucursal"), `notes String?` (≤ 1000, "Notas para el cliente"), `paymentCondition QuotePaymentCondition @default(CASH) @map("payment_condition")`, `sentAt DateTime? @map("sent_at") timestamptz`, relations + `@@index([companyId, status, validUntil])` (expiry job) and `@@index([companyId, createdById])`.
- New enum `QuotePaymentCondition { CASH CREDIT }`. CREDIT allowed only if `customer.creditEnabled` (decision #53).
- `send_log` stays the existing Json column (append under `SELECT … FOR UPDATE`). Shape typed in domain: `QuoteSendLogEntry { channel: 'WHATSAPP'|'EMAIL'|'PDF', to: string|null, at, userId }`.
- No per-line discount column: the only discount is the customer's (decision #5) — see Risks.

## Domain (`libs/domain`)
- `state-machine.ts`: `quoteMachine` adds `EXPIRED: { renew: 'SENT', reject: 'REJECTED' }` (Figma VP-17b offers "Marcar como rechazada" on an expired quote). Update spec.
- New `quote.ts` (+ spec): `QUOTE_STATUSES`, `QUOTE_SEND_CHANNELS`, `QUOTE_NOTES_MAX`, `addDaysToDate('YYYY-MM-DD', n)`, `defaultQuoteValidUntil(today, days)`, `effectiveQuoteStatus(status, validUntil, today)` (SENT and `today > validUntil` → EXPIRED; valid through the whole `validUntil` day), `quoteTimeline(status, events)` → steps for the ERP; contracts `QuoteListItem`, `QuoteListResponse`, `QuoteDetail`, `QuoteInput`, `QuoteSendInput`. "Today" uses the existing `todayInLaPaz` (`product-creation.ts`).
- New `quote-document.ts` (+ spec): `buildQuoteDocument(quote)` → receipt-shaped lines (reuse `buildReceiptLines` helpers from `sale-receipt.ts`) and `quoteShareText(doc, message)` for WhatsApp/e-mail.
- Totals reuse `cartTotals` (`pos-cart.ts`) — no new pricing code.
- Export from `index.ts`. No new permission: everything is `sales.quotes.manage` (already on cashier/management/admin).

## API (`apps/api/src/modules/sales/quotes/`)
`quotes.controller.ts` `@Controller('sales/quotes')` + `@RequirePermissions('sales.quotes.manage')`; `quotes.service.ts` (commands), `quotes-query.service.ts` (list/detail), `quotes.dto.ts` (class-validator, `strictValidationPipe`), `quotes.errors.ts`. Registered in `sales.module.ts`.

| Method · route | Notes · error `code`s |
|---|---|
| `GET /sales/quotes` `?q&status&sellerId&branchId&page&pageSize` | Effective status in SQL (`status='EXPIRED' OR (status='SENT' AND valid_until < :today)`). `INVALID_FILTER` |
| `GET /sales/quotes/product-search`, `/customers`, `/warehouses` | Delegate to `PosCatalogService` / `CustomersService` (POS routes need `sales.pos.use`, which a quote-only user may lack). Stock column per the chosen warehouse |
| `POST /sales/quotes` | `{ customerId, warehouseId, validUntil?, paymentCondition, notes?, items[{productId, quantity}] }` → DRAFT. `VALIDATION_FAILED`, `QUOTE_EMPTY`, `QUOTE_VALIDITY_IN_PAST`, `QUOTE_PRODUCT_NOT_SELLABLE`, `QUOTE_CREDIT_NOT_ALLOWED`, `CUSTOMER_NOT_FOUND`, `CUSTOMER_INACTIVE`, `WAREHOUSE_NOT_FOUND` |
| `PUT /sales/quotes/:id` | Replace header + items while DRAFT. + `QUOTE_NOT_FOUND`, `QUOTE_NOT_EDITABLE` |
| `GET /sales/quotes/:id` | Detail + timeline + send log + stock + `document` (preview data). `QUOTE_NOT_FOUND` |
| `POST /sales/quotes/:id/send` | `{ channel, to?, message? }`. DRAFT→`send`; SENT stays. EMAIL → `OutboxService.publish('sales.quote-email', …, { tx, idempotencyKey })`. `QUOTE_EXPIRED`, `QUOTE_INVALID_TRANSITION`, `INVALID_EMAIL`, `QUOTE_PHONE_REQUIRED` |
| `POST /sales/quotes/:id/renew` | `{ validUntil? }`. Persists `expire` if still SENT-but-past, then `renew`; reprices. `QUOTE_INVALID_TRANSITION`, `QUOTE_VALIDITY_IN_PAST`, `QUOTE_PRODUCT_NOT_SELLABLE` |
| `POST /sales/quotes/:id/reject` | SENT/EXPIRED → REJECTED. `QUOTE_INVALID_TRANSITION` |

Every command: `prisma.tenant.$transaction` → `SELECT … FROM quotes WHERE id=$1 AND company_id=$2 FOR UPDATE` → `quoteMachine.next` (error → `QUOTE_INVALID_TRANSITION`) → write → `AuditService.log({ action: 'sales.quote.<create|update|send|renew|reject>', entity: 'Quote', … }, tx)`. Numbers via `nextDocumentNumber(tx, companyId, 'quote')`. Totals wrapper copied from `PosPaymentService.totalsOf` (reads `sales.roundingMode`, customer discount). Outbox: add `sales.quote-email` to the `OutboxType` union and `OUTBOX_ROUTES` (mail queue). No stock writes (reservation is HU-VEN-19).

## Worker (`apps/worker`)
- `mail.processor.ts`: new case `sales.quote-email` (same `escapeHtml` + text pattern as `sale.receipt-email`).
- New `quote-expiry.service.ts`: `@Cron('5 0 * * *', { timeZone: 'America/La_Paz' })`; per company, in a tx, `SELECT id FROM quotes WHERE status='SENT' AND valid_until < :today FOR UPDATE SKIP LOCKED`, apply `quoteMachine.next(…,'expire')`, update, insert `audit_logs` (`sales.quote.expire`, `user_id` null). Registered in `worker.module.ts` (ScheduleModule already there).

## ERP (`apps/erp/src/app/features/sales/quotes/`)
Add `quotes` to `BUILT_TABS` in `sales.routes.ts`: `''` list, `new`, `:id`, `:id/edit`, `:id/print`. Each page/dialog in `.ts/.html/.scss/.spec`.
- **VP-07 `quotes.page`**: `rs-page-header` ("Cotizaciones", subtitle, "Nueva cotización"), filter bar (search, `rs-select` Estado/Vendedor/Sucursal, "Limpiar"), `rs-doc-table` (N.º, Cliente, Válida hasta, Ítems, Total, Estado, row menu: Ver / Editar if DRAFT), total row, `rs-pagination`, `rs-empty-state-illustrated`. Pills in `quote-format.ts`: Borrador neutral, Enviada info, Vencida danger, Rechazada idle, Aceptada success. "Exportar" not rendered (no story).
- **VP-08 `quote-editor.page`** (new + edit): "Cliente y condiciones" card — customer select reusing `pos-customer.dialog` (search + inline create), "Válida hasta" native date `rsInput` with leading calendar icon + "Por defecto {n} días.", Vendedor read-only (current user), "Plazo de entrega" `rs-select` = "Inmediato desde {almacén}" per warehouse, "Forma de pago" Contado / Crédito (disabled unless customer has credit). Search with `rs-pos-result-row`, lines with `rs-pos-cart-line` + `rs-qty-stepper`, "Resumen" with `cartTotals` preview, `rs-textarea` notes, `rs-note` info "Los precios se congelan hasta la fecha de validez…". Actions: Cancelar / Guardar borrador / Vista previa y enviar (saves, then opens the dialog).
- **VP-08b `quote-send.dialog`**: `rs-modal` large, preview with `rs-receipt` (letter), `rs-filter-chip` WhatsApp / Correo / Descargar PDF, field (phone or e-mail, prefilled from customer), `rs-textarea` message, `rs-note` "Envío por WhatsApp: se abre WhatsApp con el mensaje…". WhatsApp → records the send, then `wa.me`; Correo → API; PDF → records, opens `:id/print`.
- **VP-17 / VP-17b `quote-detail.page`**: header title + subtitle (sent/expired line), **status timeline**, 4 `rs-kpi-card` (Total, Ítems, Válida/Venció, Stock disponible), items `rs-doc-table` with "Sin existencia" `rs-status-pill`, send log section, `rs-note` warning when expired. Actions: Marcar como rechazada (confirm modal), Reenviar (SENT) / Editar (DRAFT), Renovar validez (EXPIRED, modal with date default today + n). "Convertir en pedido/venta" and "Duplicar" not rendered (HU-VEN-19 / no story).
- **`quote-print.page`**: like `receipt-print.page`, `rs-receipt` letter + `window.print()` (the "PDF").
- `quotes-api.service.ts`; Spanish messages for every new code in `core/api-error.ts`.
- **New `libs/ui` component `rs-status-timeline`** (`status-timeline.component.{ts,html,scss,spec.ts}`): steps `{ label, caption, state: 'done'|'current'|'warning'|'pending' }`. Reason: `rs-stepper` only takes `label` (no caption, no warning state) and is a wizard stepper; Figma draws the timeline from plain frames. Marked "estimated · add to the Design System" in `docs/ui-library.md` and added to the `/design-system` showcase.

## Tests
- **Unit:** `quote.spec.ts`, `quote-document.spec.ts`, `state-machine.spec.ts`; `status-timeline.component.spec.ts`; page/dialog specs above; `quote-format.spec.ts`; `mail.processor.spec.ts` case.
- **Integration (real Postgres):** `quotes.int.spec.ts` (extend `pos.int-fixture.ts` with the quote services and quote teardown): create/edit/send/renew/reject, totals with discount + rounding, effective-status filter, send log, concurrent numbering, **concurrent double send of a DRAFT → one DRAFT→SENT transition, two log entries**, permission (no `sales.quotes.manage` → 403), tenant isolation, outbox + audit in the same tx. `quote-expiry.int.spec.ts` in the worker.
- **E2E:** `apps/erp-e2e/src/quotes.spec.ts`: new quote (customer, 2 products, qty) → Guardar borrador → Vista previa y enviar → Correo → status Enviada and send log; set `valid_until` in the past via the DB → detail shows Vencida banner → Renovar validez → Enviada with new date.
- Agents: `ui-checker`, `reviewer` (no stock writes, `stock-auditor` optional). Then `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default
- **#12** quote validity: `sales.quoteValidityDays` (already seeded, 7); the editor and the renew modal default to today + that value and allow another future date.
- **#5** discount: only the customer's discount, applied to the whole quote.
- **#53** credit: "Crédito" only for customers with `creditEnabled`.

## Risks and doubts (please confirm when approving)
1. **Per-line discount in Figma** (VP-08 `−5 %` line, "Desc." column in VP-17) contradicts decision #5 (no manual discounts). Plan: no line discount; the customer discount shows in "Resumen", the "Desc." column shows the customer % on every line or is dropped.
2. **"Plazo de entrega"** read as the source warehouse ("Inmediato desde {almacén}"). If the client means free text (e.g. "15 días"), add a `delivery_terms` text column instead and pick the warehouse elsewhere.
3. **Vendedor** is the creator, read-only; no reassignment. Everyone with `sales.quotes.manage` sees all company quotes (Figma list filters by Vendedor).
4. **"Descargar PDF"** is browser print of the letter layout, no server PDF.
5. **WhatsApp** has no API integration: a `wa.me` link and the send is logged when the link is opened (not confirmed delivered), as Figma notes "PENDIENTE de integración".
6. List "Vencida" is danger in VP-07 but warning in VP-17b; follow each frame as drawn.
7. "Esperando respuesta" step = SENT and not expired; "Convertida" always pending until HU-VEN-19 (ACCEPTED).
8. Three stories in one branch is a large diff; commit message lists HU-VEN-16, HU-VEN-17, HU-VEN-18.

## Files expected to change
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_quotes/`
- `libs/domain/src/lib/state-machine.ts` (+spec), new `quote.ts`, `quote-document.ts` (+specs), `libs/domain/src/index.ts`
- `apps/api/src/modules/sales/quotes/**` (new), `apps/api/src/modules/sales/sales.module.ts`, `apps/api/src/modules/sales/pos/pos.int-fixture.ts`, `apps/api/src/common/outbox/outbox.service.ts`
- `apps/worker/src/common/queues.ts` (routes), `apps/worker/src/processors/mail.processor.ts` (+spec), new `apps/worker/src/quotes/quote-expiry.service.ts` (+int spec), `apps/worker/src/worker.module.ts`
- `apps/erp/src/app/features/sales/quotes/**` (new), `apps/erp/src/app/features/sales/sales.routes.ts`, `apps/erp/src/app/core/api-error.ts`
- `libs/ui/src/lib/status-timeline/**` (new), its barrel + `libs/ui/src/index.ts`, design-system showcase, `docs/ui-library.md`
- `apps/erp-e2e/src/quotes.spec.ts`; `docs/backlog/sales.md` (status of 16, 17, 18)

## Verification
Int specs against local Postgres, worker expiry int spec, ERP unit specs, Playwright E2E. Manual: create a quote, send by e-mail (check Mailpit) and WhatsApp (link opens, log entry), set a past `valid_until`, see Vencida in list and detail, renew, reject another. Finish with `pnpm nx affected -t lint typecheck test`.

## After approval
Save to `docs/plans/HU-VEN-18.md` (uncommitted), then run `/story-build HU-VEN-18` in a fresh session on `feat/hu-ven-16-18` cut from `develop` after HU-VEN-14 is merged.
