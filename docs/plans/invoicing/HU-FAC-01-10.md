# HU-FAC-01 … HU-FAC-10 · SIAT invoices: list, detail, PDF/XML, sending, rejections, NIT exception and cancellation — plan

> Approved 12 Nov 2026. Build with `/story-build HU-FAC-01-10`.

## Context

A completed sale already writes an `Invoice` row in `PENDING`, but nothing issues it: `apps/worker/src/processors/siat.processor.ts` throws "not implemented", `/invoicing` is a placeholder and `libs/siat` only has CUIS/CUFD, CUF and the XML signer. These ten stories build the invoicing module on top of that record.

**Decisions taken in planning (12 Nov 2026):**

1. **No contingency (client rule).** If the SIAT does not answer, the invoice stays `PENDING`, shown as **"No facturada en SIAT"**. Nothing is retried automatically. When the SIAT is back the ERP **notifies** which invoices are still not issued and the user issues them by hand. `CONTINGENCY`/`OBSERVED`, their events and the "Contingencia" tab disappear; HU-FAC-14…17 become RETIRED.
2. **Story source.** The stories are not in `docs/backlog/`; they come from the Sheet "Rodalaser Product Backlog v2" (rows HU-FAC-01…10). The build creates `docs/backlog/invoicing.md`.
3. **SIAT link = port + simulator.** Everything runs against a `SiatGateway` interface with a `SimulatedSiatGateway`. The real SOAP adapter (purchase-sale XML, reception, cancellation) comes with HU-FAC-22…26, which own the fiscal data it needs.
4. **PDF on the server** with `pdfkit` (new API dependency).
5. **Cancellation never moves stock or cash without the SIAT.** If the SIAT is offline or refuses, the approval is blocked and the request stays pending.

Figma `JYULL6jvXiwNP8UVvEF7tl`, page `136:8992`: FS-01 `136:8994`, FS-02 `136:9076`, FS-13 `136:9085`, FS-14 `136:9168`, FS-03 `136:9270`, FS-15 `136:9374`, FS-16 `136:9505`, FS-04 `136:9622`, FS-20 `136:9664`, FS-21 `136:9765`, FS-22 `136:9709`, FS-09 `136:9808`, FS-12 `136:9907`, FS-18 `136:10012`, FS-19 `136:10049`, FS-17 `136:10092`. Only FS-01, FS-03 and FS-04 were opened while planning; read each frame with `get_design_context` before building its screen.

## Acceptance criteria → concrete checks

| Story | Criterion | Proof |
|---|---|---|
| FAC-01 | Day indicators | Int: `GET invoicing/invoices` → `kpis { issuedToday {count,total}, notIssued, rejected, cancellationsPending }` on La Paz day. Page spec: 4 `rs-kpi-card` ("Emitidas hoy", "No facturadas en SIAT · n por emitir", "Rechazadas por el SIAT", "Anulaciones por aprobar") |
| FAC-01 | List with number, customer, sale, total, status | Int: filters `q`, `status`, period, branch, pagination, total row, tenant isolation, visibility (own sales unless `sales.history.view-all`). Page spec: columns and status pills |
| FAC-01 | Empty state | Page spec: FS-02 illustration with and without filters; loading, error and no-permission states |
| FAC-02 | Row actions | Domain spec `invoiceActions(status, permissions)`; page spec: `rs-row-action` items per status (detail, PDF, XML, send, credit note, request cancellation, issue to SIAT) |
| FAC-03 | Multi-select, download PDF or XML, send | Int: `POST invoicing/invoices/download` returns a ZIP with one file per issued invoice and lists the skipped ones; bulk e-mail reports invoices without e-mail. Page spec: selection bar and counts |
| FAC-04 | Detail: products, payment, legend, QR, copyable CUF, modality, point of sale, history | Int: `GET invoicing/invoices/:id` contract. Page spec: cards, "Copiar" writes the CUF to the clipboard, history from the audit trail |
| FAC-05 | Preview in the official layout, PDF download | Unit: `InvoicePdfService` produces a PDF (`%PDF` header, page count, text contains number, CUF, NIT, total in words). Page spec: preview dialog loads the blob; download button |
| FAC-06 | Choose channel and recipient; the send is recorded | Int: e-mail → outbox `invoice.email` + audit `invoicing.invoice.deliver`; WhatsApp → `wa.me` URL + audit; invalid e-mail/phone → 400. Worker spec: mail with PDF and XML attached |
| FAC-07 | Rejection reason shown | Int: simulator rejects → `REJECTED` with `rejectionCode/Message`. Page spec: FS-04 danger note |
| FAC-07 | Verify the NIT with the SIN | Int: `POST …/verify-nit` ok / unknown / `SIAT_UNAVAILABLE` |
| FAC-07 | Resend only with a verified NIT | Domain spec `canResend`; Int: resend without verification → 409 `NIT_NOT_VERIFIED`; verified → `SENDING` → `VALID` |
| FAC-08 | Reason required, needs approval, audited | Int: request without reason → 400; creates `ApprovalRequest NIT_EXCEPTION`; approve needs `invoicing.nit-exception.approve` (cashier 403); approval resends with the exception flag; audit rows; setting off → `NIT_EXCEPTION_DISABLED` |
| FAC-09 | Invoice stays valid until approval; SIN reason + comment; same flow as sales | Int: `POST …/cancellation-request` → sale `CANCELLATION_PENDING`, invoice still `VALID`, request carries `SIN_<code>`; window setting respected; one pending request |
| FAC-10 | Inbox of pending cancellations | Int: `GET invoicing/cancellations`; page spec FS-18 |
| FAC-10 | Approval cancels in the SIAT, returns stock, registers the refund; invoice "Anulada" | Int (real Postgres): approve → SIAT call, invoice `CANCELLED`, stock and cash exactly once; SIAT offline → 503 and nothing written; SIAT refuses → 409 and nothing written; double approve → one wins; recovery after a crash between the SIAT call and the local commit |
| Rule | No contingency, manual issue, notification | Int: SIAT offline → invoice back to `PENDING`, no retry scheduled, no outbox left pending. E2E: offline sale → online → notification → manual issue → "Válida" |

## Model

Migration **`20261113120000_invoicing_siat_issuing`** (after `20261112130000_credit_payment_due_date`; no other branch has unmerged migrations).

- **`InvoiceStatus`**: drop `CONTINGENCY` and `OBSERVED` (recreate the enum; the migration aborts if a row uses them). Used by `invoices` and `credit_notes`.
- **`Invoice`** gains: `branchId`, `pointOfSaleId` (back-filled from the sale's register, or the branch's point of sale 0 for a dispatch sale), `cuf`, `issuedAt`, `siatReceptionCode`, `rejectionCode Int?`, `rejectionMessage`, `lastAttemptAt`, `lastError`, `customerComplement`, `nitVerifiedAt`, `nitException Boolean @default(false)`, `cancellationReasonCode Int?`, `cancelledAt`. `@@unique([companyId, pointOfSaleId, number])`, `@@index([companyId, createdAt(sort: Desc)])`, `@@index([companyId, issuedAt])`.
- **`InvoiceDocument`** (`invoice_documents`, 1:1): `invoiceId` PK, `companyId`, `signedXml Text`, `createdAt`. Kept apart so `invoice: true` includes never drag the XML. Registered in `TENANT_MODELS`.
- **`ApprovalType`** + `NIT_EXCEPTION` (subject = invoice id; the existing partial unique index gives one pending request per invoice).
- **`SiatSettings`** gains `connectionStatus` (new enum `SiatConnectionStatus { UNKNOWN, ONLINE, OFFLINE }`), `connectionCheckedAt`, `connectionChangedAt`.
- No history table: "Historial SIAT" and the delivery log are `AuditLog` rows of entity `Invoice` (same as the cancellation review does).
- Invoice number: `nextDocumentNumber` (`apps/api/src/modules/sales/document-sequence.ts`) with key `INV-<branchCode>-<posCode>`, taken at the first send and kept on later attempts. The CUF and `issuedAt` are recomputed on every attempt (the SIAT wants the real emission time).

## Domain (`libs/domain`)

- `state-machine.ts` — `invoiceMachine`:
  `PENDING {send→SENDING, void→CANCELLED}` · `SENDING {accept→VALID, reject→REJECTED, unavailable→PENDING}` · `REJECTED {fix→PENDING, void→CANCELLED}` · `VALID {requestCancellation→CANCELLATION_PENDING}` · `CANCELLATION_PENDING {approveCancellation→CANCELLED, rejectCancellation→VALID}`. Events `offline`, `packageValidated`, `packageObserved` removed.
- New `invoicing.ts`: `invoiceActions(status, permissions)`, `canResend({ status, documentType, nitVerifiedAt, nitException, verificationMode })`, `isStuckSending(lastAttemptAt, now, timeoutMinutes)`, `fiscalDebit(total)` (13 % with `Decimal`), `SIAT_CANCELLATION_REASONS` (codes 1–4 of the SIN parametric table, to be validated against the synced catalogue), `siatCancellationReasonCode(reason)` (maps `CANCELLATION_REASONS` and `SIN_<n>`), `validateNitExceptionRequest`, `validateInvoiceDelivery` (channel, e-mail or Bolivian mobile), contracts `InvoiceListItem`, `InvoiceListResponse`, `InvoiceDetail`, `InvoicingStatus`.
- `sale-cancellation.ts`: `isCancellationReason` also accepts `SIN_<code>`; `invoiceCancellationAction` follows the new machine (a `REJECTED` invoice is now `VOID`).
- `approvals.ts`: `NIT_EXCEPTION` in `APPROVAL_TYPES`, permission `invoicing.nit-exception.approve`, inline type.
- `company-settings.ts`: `invoicing.autoIssueOnSale` (true), `invoicing.statusCheckMinutes` (2), `invoicing.sendingTimeoutMinutes` (5), `invoicing.allowNitException` (true, decision #21), `invoicing.siatGateway` (`SIMULATED` | `SOAP`; `SOAP` is refused until the real adapter exists), `invoicing.simulatorMode` (`ONLINE` | `OFFLINE`, the demo/test switch).
- `permissions.ts`: no new key. Used: `invoicing.invoices.view`, `invoicing.invoices.issue`, `invoicing.nit-exception.approve`, `sales.cancellations.request`, `sales.cancellations.approve`, `sales.returns.manage`. `invoicing.contingency.manage` stays unassigned (not removed).

## `libs/siat`

- `gateway.ts`: `SiatGateway { verifyCommunication, verifyNit, sendInvoice, invoiceStatus, cancelInvoice }`, `SiatUnavailableError`, result types reusing `ServiceMessage`.
- `simulated.gateway.ts`: deterministic — offline when told so; `verifyNit`/`sendInvoice` reject NITs starting with `999` (SIN code 1037-style message) unless the exception flag is set; remembers accepted and cancelled CUFs through an injected store, so `invoiceStatus` and a repeated cancel behave like the SIN.
- `invoice-xml.ts`: provisional XML of the invoice (marked "PROVISIONAL"), signed with the existing `xml-signer.ts` when the company has a signature. `qr-url.ts`: `siatQrUrl({ environment, nit, cuf, number })`. CUF from the existing `cuf.ts`.

## API

New module `apps/api/src/modules/invoicing` plus `apps/api/src/common/siat/` (`SiatGatewayFactory`: picks the adapter from `invoicing.siatGateway`, reads `SiatSettings` with `SecretsService`; shared by invoicing and sales, so no circular import). All business queries through `prisma.tenant`.

| Method · route (`/api/v1/…`) | Permission | Error `code`s |
|---|---|---|
| `GET invoicing/status` | `invoicing.invoices.view` | — → `{ connection, checkedAt, notIssued, rejected }` |
| `GET invoicing/invoices` | `invoicing.invoices.view` | `VALIDATION_FAILED` |
| `GET invoicing/invoices/:id` | `invoicing.invoices.view` | `INVOICE_NOT_FOUND` |
| `POST invoicing/invoices/:id/issue` | `invoicing.invoices.issue` | `INVOICE_NOT_FOUND`, `INVOICE_NOT_ISSUABLE`, `INVOICE_ALREADY_SENDING` |
| `POST invoicing/invoices/issue` `{ ids }` (≤ 50) | `invoicing.invoices.issue` | per-invoice result list |
| `PATCH invoicing/invoices/:id/customer` | `invoicing.invoices.issue` | `INVOICE_NOT_EDITABLE`, `INVALID_NIT` |
| `POST invoicing/invoices/:id/verify-nit` | `invoicing.invoices.issue` | `SIAT_UNAVAILABLE` (503) |
| `POST invoicing/invoices/:id/resend` | `invoicing.invoices.issue` | `NIT_NOT_VERIFIED`, `INVOICE_NOT_ISSUABLE` |
| `POST invoicing/invoices/:id/nit-exception` `{ reason }` | `invoicing.invoices.issue` | `NIT_EXCEPTION_DISABLED`, `NIT_EXCEPTION_ALREADY_PENDING`, `VALIDATION_FAILED` |
| `POST …/nit-exception/approve` · `…/reject` `{ comment }` | `invoicing.nit-exception.approve` | `NIT_EXCEPTION_NOT_PENDING`, `VALIDATION_FAILED` |
| `GET invoicing/invoices/:id/pdf` · `…/xml` | `invoicing.invoices.view` | `INVOICE_NOT_ISSUED` |
| `POST invoicing/invoices/download` `{ ids, format }` (≤ 100) | `invoicing.invoices.view` | `VALIDATION_FAILED` |
| `POST invoicing/invoices/:id/deliveries` `{ channel, recipient }` | `invoicing.invoices.view` | `INVOICE_NOT_ISSUED`, `VALIDATION_FAILED` |
| `POST invoicing/invoices/deliveries` `{ ids }` (e-mail) | `invoicing.invoices.view` | per-invoice result list |
| `POST invoicing/invoices/:id/cancellation-request` `{ reasonCode, comment }` | `sales.cancellations.request` | the HU-VEN-14 codes + `INVOICE_NOT_CANCELLABLE` |
| `GET invoicing/cancellations` | `sales.cancellations.approve` | — |

- **Issuing.** `pos-payment.service.ts` and `sales-order-dispatch.service.ts` also publish `invoice.issue` in the sale transaction when `invoicing.autoIssueOnSale` is on (`OutboxService.publish(…, { tx, idempotencyKey: 'invoice-issue:<id>:1' })`). A manual issue locks the invoice row `FOR UPDATE`, applies `send` (or `fix` + `send`), audits and publishes `invoice.issue` with the attempt number. A `SENDING` invoice older than `invoicing.sendingTimeoutMinutes` can be issued again; the attempt first asks `invoiceStatus(cuf)` so nothing is sent twice.
- **Cancellation (changes `sale-cancellation.service.ts` `approve`, VALID invoice only):** (A) short tx: lock sale + request, invoice `requestCancellation` → `CANCELLATION_PENDING`; (B) `gateway.cancelInvoice(cuf, reasonCode)` outside any tx; (C) the existing HU-VEN-15 tx (stock, refund, sale, request, audit, outbox) plus invoice `approveCancellation`, `cancelledAt`, `cancellationReasonCode`. If B is unavailable or refused: invoice `rejectCancellation` → `VALID`, error `SIAT_UNAVAILABLE` (503) or `SIAT_CANCELLATION_REJECTED` (409, SIN messages in `details`), request still pending. An approval that finds the invoice already `CANCELLATION_PENDING` (crash between B and C) checks `invoiceStatus` and finishes C. `PENDING`/`REJECTED` invoices keep the local `void`. The HU-FAC-09 request endpoint delegates to `SaleCancellationService.request`.
- **Delivery.** E-mail: the API renders PDF + XML and publishes `invoice.email` (attachments as base64 in the payload; the worker only delivers). WhatsApp: no provider — the API returns a `wa.me` link whose text carries the SIAT verification URL, and the click is what gets audited.
- **PDF/ZIP.** `invoice-pdf.service.ts` with `pdfkit`; the QR is drawn from the `qrcode-generator` matrix already in the repo. ZIP: reuse an installed library if one is there (check what `exceljs` brings), else add `fflate`.
- **Audit** (`AuditService`): `invoicing.invoice.issue`, `.accept`, `.reject`, `.unavailable`, `.correct`, `.verify-nit`, `.nit-exception-request|approve|reject`, `.deliver`, `.download`, plus the existing cancellation actions.
- **Outbox routes** (`apps/worker/src/common/queues.ts`): `invoice.issue` → siat (exists), `invoice.email` → mail, `invoicing.nit-exception.requested|decided` → accounting (no consumer yet). `invoice.cancel` is no longer published (cancellation is synchronous).

## Worker (`apps/worker`)

- `siat/invoice-issue.service.ts` (called by `SiatProcessor` on `invoice.issue`): loads the invoice by id + company, skips unless `SENDING`, takes the number, builds CUF and XML, calls the gateway, then one tx: `accept` → `VALID` (+ `InvoiceDocument`, reception code) · `reject` → `REJECTED` (+ code and message) · `SiatUnavailableError` → `unavailable` → `PENDING` (+ `lastError`). The job **always completes**: no BullMQ retry for an offline SIAT.
- `siat/siat-health.service.ts`: job `siat.health` every minute; per company, when `invoicing.statusCheckMinutes` has passed, `verifyCommunication` and update `SiatSettings.connection*`. It never issues anything.
- `mail.processor.ts`: case `invoice.email` with attachments.
- The gateway choice and credentials loading mirror the API factory (small duplicate; both apps cannot share Nest providers).

## ERP screens (`apps/erp/src/app/features/invoicing/`)

Replace the `invoicing` placeholder with `invoicing.routes.ts` + `invoicing-layout.page` (tabs: only **Facturas**, with the count badge, and **Anulaciones**; "Contingencia" is not built, the other tabs arrive with their stories).

| Screen | Route | `libs/ui` used |
|---|---|---|
| FS-01/02/13/14 list `invoices.page` | `/invoicing` | `rs-kpi-card`, `rs-filter-bar-products [inline]`, `rs-select`, `rs-doc-table` (`selectable`), `rs-status-pill`, `rs-row-action`, `rs-pagination`, `rs-empty-state`, `rs-note`, `rs-skeleton` |
| FS-03 detail `invoice-detail.page` | `/invoicing/invoices/:id` | `rs-breadcrumb`, `rs-kpi-card`, `rs-data-field`, `rs-qr-code`, `rs-status-pill`, `rs-button` |
| FS-15 preview `invoice-preview.dialog` | dialog | `rs-modal` (large) with the PDF blob |
| FS-16 send `invoice-send.dialog` | dialog | `rs-modal`, `rs-radio-card`, `rs-field`, `rs-input` |
| FS-04/20/21 rejected state of the detail | same route | `rs-note`, `rs-field` (`invalid`), `rs-input`, `rs-button` |
| FS-22 NIT exception `nit-exception.dialog` | dialog | `rs-modal`, `rs-textarea`, `rs-note` |
| FS-09/12 cancellation request `invoice-cancellation.dialog` | dialog | `rs-modal`, `rs-select`, `rs-textarea`, `rs-note` |
| FS-18 cancellations inbox `invoice-cancellations.page` | `/invoicing/cancellations` | `rs-doc-table`, `rs-empty-state` |
| FS-19/17 review and cancelled state | reuse `sales/history/sale-cancellation-review.page` and the detail | — |

- **Status labels:** `PENDING` "No facturada en SIAT" (warning), `SENDING` "Enviando", `VALID` "Válida", `REJECTED` "Rechazada", `CANCELLATION_PENDING` "Anulación en curso", `CANCELLED` "Anulada". Figma's "Contingencia" pill and KPI "En contingencia" become "No facturada en SIAT".
- **Notification:** `InvoicingStatusStore` (in `core/`) polls `invoicing/status` every 60 s for users with `invoicing.invoices.view`. Shell: the sidebar footer pill shows "SIAT en línea" / "SIAT sin conexión" / "Sin configurar" (the shell's `S2` comment). On `OFFLINE → ONLINE` with `notIssued > 0`: `rs-toast` "El SIAT volvió a estar en línea · n facturas sin emitir" with "Ver facturas". The list shows a persistent `rs-note` warning with "Emitir seleccionadas" while there are invoices not issued, and the Facturas tab and the sidebar item carry the count.
- "Emitir factura" and "Exportar" of FS-01 are not rendered (invoices are born from sales; export is not in these criteria). "Emitir nota de crédito" opens the existing return form of the sale (HU-VEN-21); the note itself is HU-FAC-12.
- Existing screens: `sale-format.ts` (`invoiceLabel`, impact texts), `pos-sale-completed.dialog` and `sale-detail.page` show the new labels and link to the invoice; `approvals` module shows `NIT_EXCEPTION`; `api-error.ts` gets the new codes in Spanish.
- **Possibly missing in `libs/ui`:** a selection bar for FS-14 (count + bulk actions). Check the frame first; if Figma draws one and nothing existing fits, build `rs-bulk-bar` there (own `.ts/.html/.scss/.spec`, tokens only).

## Tests

- **Unit (domain, siat):** `state-machine.spec` (new transitions, removed ones throw), `invoicing.spec` (actions, `canResend`, `isStuckSending`, `fiscalDebit`, reason mapping, validations), `company-settings.spec`, `approvals.spec`, `sale-cancellation.spec`; `simulated.gateway.spec`, `invoice-xml.spec`, `qr-url.spec`.
- **Integration, real Postgres (`apps/api/src/modules/invoicing/*.int.spec.ts`, `apps/worker/src/siat/*.int.spec.ts`):** list/detail/visibility/tenant isolation; sale completion publishes `invoice.issue` atomically (and not when the setting is off); issue happy path, reject, unavailable → `PENDING` with no retry; **two concurrent manual issues → one attempt, one number**; **concurrent first sends on one point of sale → consecutive numbers, no gap or duplicate**; stuck `SENDING` recovery; correct + verify + resend; NIT exception request/approve/reject and permissions; deliveries and audit; download ZIP; cancellation: happy path, offline, refused, double approve, approve × withdraw, crash recovery, stock and refund exactly once (`sale-cancellation-decision.int.spec.ts` extended).
- **ERP unit:** every page and dialog above (states by permission and status), `InvoicingStatusStore` (toast only on the offline → online edge), shell pill.
- **E2E (`apps/erp-e2e/src`):** `invoicing-offline-issue.spec.ts` (simulator offline → cash sale → "No facturada en SIAT" → online → toast → manual issue → "Válida" → PDF downloads); `invoicing-rejected-nit.spec.ts` (NIT `999…` → rejected → correct → verify → resend → valid); `invoicing-cancellation.spec.ts` (request from the invoice → Management approves → "Anulada", kardex row).
- **Agents:** `stock-auditor` (cancellation touches stock), `ui-checker`, `reviewer`; then `pnpm nx affected -t lint typecheck test` (API and ERP suites one project at a time, as noted in `docs/sales/design-notes.md`).

## Open decisions used with a default

- **#21** NIT exception allowed? → setting `invoicing.allowNitException` = `true`; approval by permission `invoicing.nit-exception.approve`.
- **#22** cancellation reasons and deadline → the four SIN reasons as the default catalogue (replaced by the synced one in HU-FAC-25); deadline = existing `sales.cancellationWindowDays` (null).
- **#11** who approves cancellations → `sales.cancellations.approve` (unchanged).
- **#31** modality/sector → read from `SiatSettings.modality`; sector 1 purchase-sale.
- New client rule (no contingency) recorded in `decisions.md`; `invoicing.autoIssueOnSale` lets a company turn the automatic first attempt off.

## Risks and doubts

1. **Size.** Ten stories in one branch. Build in slices, each green before the next: (A) model, machine, gateway, issuing, status → (B) list + detail → (C) PDF/XML, preview, send, bulk → (D) rejections + NIT exception → (E) cancellation.
2. **Simulator only.** Nothing here is certified against the SIN; invoices and the PDF are marked "PROVISIONAL". `invoicing.siatGateway = SOAP` is refused until the real adapter exists.
3. **Fiscal side of "no contingency":** an invoice issued hours later carries the later emission date, and the customer leaves with the sale receipt only. Worth confirming with the client's accountant; not blocking.
4. **Removing enum values** needs the enum recreated; the migration checks no row uses them.
5. **Cancellation approval now waits for the SIAT** (a few seconds, 15 s timeout) and changes HU-VEN-15 code; its integration spec is extended, not replaced.
6. **E-mail attachments in the outbox payload** (~100 KB per invoice): fine at this volume; move to storage keys if it grows.
7. **Sheet:** HU-FAC-14…17 should be marked "Retirada" in the Google Sheet and decisions #24–#26 closed. Not done by the build; say the word and I update the Sheet.
8. **Branch:** `feat/hu-fac-01-10`, cut from `develop` once `feat/hu-ven-33-34-35-36` (one commit ahead of `develop`) is merged, or from that branch.

## Files expected to change

- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261113120000_invoicing_siat_issuing/`, `apps/api/prisma/seed-base.ts` (settings), `apps/api/src/common/prisma/tenant.extension.ts`
- `libs/domain/src/lib/{state-machine,invoicing,sale-cancellation,approvals,company-settings}.ts` (+ specs), `libs/domain/src/index.ts`
- `libs/siat/src/lib/{gateway,simulated.gateway,invoice-xml,qr-url}.ts` (+ specs), `libs/siat/src/index.ts`
- `apps/api/src/common/siat/**` (new), `apps/api/src/modules/invoicing/**` (new), `apps/api/src/app.module.ts`
- `apps/api/src/modules/sales/{pos/pos-payment.service.ts,orders/sales-order-dispatch.service.ts,sales/sale-cancellation.service.ts,sales/sale-cancellation.errors.ts,sales/sale-cancellation-decision.int.spec.ts,approvals/approvals-inbox.service.ts,sales.module.ts}`
- `apps/worker/src/{processors/siat.processor.ts,processors/mail.processor.ts,common/queues.ts,worker.module.ts}`, `apps/worker/src/siat/**` (new)
- `apps/erp/src/app/features/invoicing/**` (new), `apps/erp/src/app/{app.routes.ts,layout/shell.component.ts,core/api-error.ts,core/invoicing-status.store.ts}`, `apps/erp/src/app/features/sales/{history/sale-format.ts,history/sale-detail.page.*,pos/pos-sale-completed.dialog.*,approvals/*}`
- `libs/ui/src/lib/bulk-bar/**` only if FS-14 needs it (+ `libs/ui/src/index.ts`, design-system showcase, `docs/ui-library.md`)
- `apps/erp-e2e/src/invoicing-*.spec.ts`
- `package.json`, `pnpm-lock.yaml` (`pdfkit`, `@types/pdfkit`, maybe `fflate`)
- `docs/backlog/invoicing.md` (new), `docs/invoicing/design-notes.md` (new), `docs/backlog/decisions.md`, `docs/naming-conventions.md` (InvoiceStatus list), `docs/sales/design-notes.md`, `docs/plans/invoicing/HU-FAC-01-10.md`

## Verification

1. `pnpm nx run-many -t test -p domain siat` → `pnpm nx test api` → `pnpm nx test worker` → `pnpm nx test erp` → the three Playwright specs.
2. Manual on the dev stack: set `invoicing.simulatorMode = OFFLINE`, sell in cash at the POS → the invoice is "No facturada en SIAT" and the sidebar says "SIAT sin conexión"; set it `ONLINE` → within a minute the toast appears; issue from the list → "Válida"; open the detail, copy the CUF, preview and download PDF and XML, send by e-mail (check Mailpit at `localhost:8025`) and WhatsApp. Sell to a NIT starting with `999` → "Rechazada" → correct, verify, resend. Request a cancellation from the invoice, approve as Gerencia → "Anulada", stock back in the kardex, refund in the register; repeat with the simulator offline → approval blocked, nothing moved.
3. `pnpm nx affected -t lint typecheck test` with no errors.
