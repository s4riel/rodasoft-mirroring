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
