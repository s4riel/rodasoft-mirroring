# Invoicing design notes (HU-FAC)

## State machine (`libs/domain/src/lib/state-machine.ts`)

```
PENDING  --send--> SENDING --accept--> VALID --requestCancellation--> CANCELLATION_PENDING --approveCancellation--> CANCELLED
   ^  \               |  \                                                      |
   |   void           |   reject --> REJECTED --fix--> PENDING                  rejectCancellation --> VALID
   |    \             unavailable --> PENDING          REJECTED --void--> CANCELLED
   +-----+---------------+
```

`CONTINGENCY` and `OBSERVED` no longer exist. An invoice that never got a valid SIAT answer (`PENDING`, `REJECTED`) is voided locally when its sale is cancelled, with no SIAT call.

## Issuing (worker, `apps/worker/src/siat/invoice-issue.service.ts`)

Three steps, never a transaction open while the SIAT is called:

1. **prepare**: lock the invoice, take the number from `document_sequences` (`INV-<branch>-<pos>`), build CUF and XML, move to `SENDING`.
2. **call** the `SiatGateway`. A `SENDING` invoice that already has a CUF first asks `invoiceStatus` (crash recovery).
3. **apply**: `VALID` + an `InvoiceDocument` (XML), or `REJECTED`, or back to `PENDING` when the SIAT is unavailable. The job always completes: there is no retry.

A health check (`siat-health.service.ts`, every 60 s) keeps `SiatSettings.connection*`. The ERP polls `GET /invoicing/status` and shows the sidebar pill, the badge on "Facturación" and a toast when the SIAT comes back with invoices still not issued.

## Cancellation approval (`sale-cancellation.service.ts`)

For a `VALID` invoice, approving a sale cancellation is SIAT-first:

- **A** short transaction: `VALID → CANCELLATION_PENDING`, after `requireLocalCommitPossible` (open shift, active warehouse) so the SIAT never cancels what the sale cannot undo.
- **B** gateway call, outside any transaction. A resume (invoice already `CANCELLATION_PENDING`) asks `invoiceStatus` first.
- **C** the existing transaction: stock back, refund, invoice `CANCELLED`, sale `CANCELLED`.

SIAT offline → 503 `SIAT_UNAVAILABLE`; refusal → 409 `SIAT_CANCELLATION_REJECTED`; in both the invoice goes back to `VALID` and nothing moved. While the invoice is `CANCELLATION_PENDING`, withdrawing or rejecting the request returns `CANCELLATION_IN_PROGRESS`.

## Rules worth remembering

- The cancellation reason is one of the four SIN codes (`SIAT_CANCELLATION_REASONS`); stored on the sale request as `SIN_<n>`.
- Resending a rejected invoice needs a verified NIT or an approved exception (`canResend`); the exception is a setting (`invoicing.allowNitException`) and a permission (`invoicing.nit-exception.approve`).
- The simulated SIN is shared between API and worker through the table `simulated_siat_records`; NITs starting with `999` are rejected (code 1037) unless the exception flag is set.
- Bulk limits: `INVOICE_BULK_ISSUE_MAX` (50), `INVOICE_BULK_DOWNLOAD_MAX` (100).

## As built (12 Nov 2026)

- Not done: the XML is **not signed** (the worker cannot read the company certificate); "Emitir nota de crédito" only links to the sale's return form (the credit note is HU-FAC-12); the real SOAP adapter (HU-FAC-22…26).
- Toast "El SIAT volvió a estar en línea": it has no "Ver facturas" button because `ToastService` has no action; the badge on "Facturación" is the way in.
- The bulk bar is built inline in `invoices.page`, not as a `libs/ui` component. Figma fidelity of FS-01/03/04/09/12/15/16/18/20–22 has not been compared.
- Known window: a shift closed between steps A and C of the cancellation leaves the invoice in `CANCELLATION_PENDING`; reopening the shift and approving again finishes it (tested).
- Sheet: HU-FAC-14…17 should be marked "Retirada" and decisions #24–#26 closed.

## Credit and debit notes, system status and VAT books (HU-FAC-11, 12, 13, 18, 19, 20)

### Notes (`credit-notes.service.ts`, worker `credit-note-issue.service.ts`)

```
PENDING --send--> SENDING --accept--> VALID (final)
   ^  \               |     |   void           |   reject --> REJECTED --fix--> PENDING ; REJECTED --void--> CANCELLED
   +----+-------------+ unavailable
```

`creditNoteMachine` has the same no-contingency rule as the invoice. A note is born in two ways: an approved return writes it with its lines (`sale-returns.service.ts`), or, when `invoicing.allowPriceAdjustmentNotes` is on, a person credits money on the lines of a valid invoice. Both publish `credit-note.issue` in the same transaction (the return only when the invoice is already `VALID`). The worker numbers it from `NC-<branch>-<pos>` at the first send; a note whose invoice is not `VALID` stays `PENDING` with `INVOICE_NOT_VALID`.

- **Only what was invoiced** (`validateCreditNote`): per line, pieces and money ≤ invoiced less what notes that are not voided already took. The invoiced money of a line is its share of the sale total (`proRata`), as a return does. Two notes over one line serialise on the sale row lock (the lock a return takes).
- **VAT to adjust** = 13 % of the total (`creditNoteVat`, half up). The sales book subtracts it.
- The ERP opens `/invoicing/invoices/:id/credit-note`: with the setting off (or without `invoicing.notes.issue`) it sends the user to the return form of the sale.

### System status (`siat-system-status.service.ts`)

Per branch and point of sale: CUIS and CUFD health (`codeHealth`: `OK`, `EXPIRING` inside `invoicing.cufdWarnHours`, `EXPIRED`), last sync and invoices issued today. The summary is the worst of all points. "Renovar CUFD" asks the gateway for a CUFD (and a CUIS when missing or expired) outside any transaction; offline → 503 `SIAT_UNAVAILABLE` and the old code stays. "Probar conexión" records the result in `siat_settings`.

### VAT books (`vat-books.service.ts`, `vat-book-export.service.ts`)

- **Sales**: invoices and valid notes the SIAT validated in the La Paz month. Valid invoice = total and 13 % debit; cancelled = listed with 0; a credit note reduces both. Company-wide (not narrowed by sales visibility).
- **Purchases**: table `purchase_book_entries`, filled by the demo seed until purchasing exists; `OBSERVED` entries add nothing until the SIN knows the NIT (`verify-nit`, which may carry a corrected NIT).
- **Export**: XLSX (`exceljs`) or CSV with the SIN column layout; text cells that start with `=`, `+`, `-` or `@` are prefixed with `'`. An open month is a draft: "BORRADOR" in the title and in the file name.

### As built (16 Nov 2026)

- Not done: the XML and the PDF of a note are provisional and unsigned; the SIN catalogue of note reasons and the LCV column layout are unconfirmed; closing a period (HU-FAC-21); the real SOAP adapter (HU-FAC-22…26); no contingency tab (client rule).
- Figma fidelity was compared side by side (headless screenshots against the frames, 16 Nov 2026). FS-25 is a page (`/invoicing/invoices/:id/credit-note`) and FS-38 a page (`/invoicing/books/purchases/:id?period=`), as in the design. FS-08 and FS-10 are one page with a book selector. Left out on purpose: the contingency elements the frames still draw (KPI, status, button), "Ver períodos" (closing periods is HU-FAC-21), the "Devolución vinculada" select of FS-25 (a note is linked to a return from the return form), the "Exportar" button of FS-23, the "Enviada al cliente" step of FS-24 (notes are not e-mailed) and the NIT/razón social icons of FS-38. Added: the "Nota SIAT" card (CUF, branch, reception code) of the note detail. Remaining differences come from the library (info note icon, the modal's close button).
- Known gap: a return made after a price-adjustment note on the same line is not limited by what the note credited (price adjustments are off by default).
