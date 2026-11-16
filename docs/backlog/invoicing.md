# Backlog · SIAT invoicing (HU-FAC)

Source: Google Sheets "Rodalaser Product Backlog v2" (Backlog sheet, rows HU-FAC-01…13 and 18…20). If the Sheet changes, re-export this section; the Sheet is authoritative.
Story text is translated to English; UI strings quoted in "…" stay in Spanish.

## How to use it

- Plan with `/story-plan HU-FAC-xx`, build with `/story-build HU-FAC-xx`. Approved plans: `docs/plans/invoicing/HU-FAC-01-10.md`, `docs/plans/invoicing/HU-FAC-11-12-13-18-19-20.md`.
- Design context, data model and rules: `docs/invoicing/design-notes.md`.
- Client decisions and the defaults used (#21, #22, #31 and the three of the notes and books): `docs/backlog/decisions.md`.
- Figma frames (ERP file `JYULL6jvXiwNP8UVvEF7tl`, page `136:8992`) FS-01 … FS-22 and FS-23 … FS-25, FS-38, FS-39. UI texts come from there, in Spanish.
- **No contingency (client rule, 12 Nov 2026).** If the SIAT does not answer, the invoice stays `PENDING` and the UI says "No facturada en SIAT". Nothing is retried; when the SIAT is back the ERP says how many invoices are still not issued and a person issues them. Because of this HU-FAC-14…17 (contingency) are **retired**.
- The SIAT link is a `SiatGateway` port with a simulated adapter. The real SOAP adapter arrives with HU-FAC-22…26.

## Status summary (16 Nov 2026)

| Status | Stories |
| ------ | ------- |
| Developed (10) | 01–10 (branch `feat/hu-fac-01-10`; see "As built" in `docs/invoicing/design-notes.md`) |
| Developed (6) | 11, 12, 13, 18, 19, 20 (branch `feat/hu-fac-11-20`; see "As built" in `docs/invoicing/design-notes.md`) |
| Retired (4) | 14, 15, 16, 17 (contingency) |
| Not built | 21 (close periods), 22…26 (real SOAP adapter and catalogue sync) |

## Stories

| ID | Story | Where it lives |
| -- | ----- | -------------- |
| HU-FAC-01 | List of invoices with the day's indicators | `/invoicing`, `GET /invoicing/invoices` |
| HU-FAC-02 | Row actions by status and permission | `invoiceActions` in `libs/domain` |
| HU-FAC-03 | Select several: download PDF/XML (ZIP) or send | `POST /invoicing/invoices/download`, `…/deliveries` |
| HU-FAC-04 | Invoice detail (products, payment, legend, QR, CUF, modality, history) | `/invoicing/invoices/:id` |
| HU-FAC-05 | Preview and download of the PDF | `GET /invoicing/invoices/:id/pdf` (pdfkit, on the server) |
| HU-FAC-06 | Send by e-mail or WhatsApp | outbox `invoice.email`, `wa.me` link |
| HU-FAC-07 | Rejection reason, correct customer, verify NIT with the SIN, resend | `invoice-customer-fix` component |
| HU-FAC-08 | NIT exception approved by Management | approval type `NIT_EXCEPTION` |
| HU-FAC-09 | Ask for the cancellation of a valid invoice | `POST /invoicing/invoices/:id/cancellation-request` |
| HU-FAC-10 | Approve the cancellation in the SIAT | `SaleCancellationService.approve`, `/invoicing/cancellations` |
| HU-FAC-11 | List and detail of credit and debit notes (number, invoice, origin, total, status; adjusted VAT, linked return) | `/invoicing/notes`, `GET /invoicing/notes`, `…/notes/:id` |
| HU-FAC-12 | Issue a credit and debit note: only what was invoiced, SIN reason, VAT to adjust, sent to the SIAT | `credit-notes.service.ts`, worker `credit-note-issue.service.ts`, `/invoicing/invoices/:id/credit-note` |
| HU-FAC-13 | SIAT system status: connection, CUIS, CUFD and last sync by point of sale; renew the CUFD, test the connection | `/invoicing/status`, `GET /invoicing/system-status`, `POST …/renew-cufd`, `POST …/test-connection` |
| HU-FAC-18 | Sales VAT book by La Paz month with the 13 % fiscal debit and its indicators | `/invoicing/books`, `GET /invoicing/vat-books/sales` |
| HU-FAC-19 | Purchases VAT book: an observed purchase adds no credit; verify the supplier NIT | `GET /invoicing/vat-books/purchases`, `POST …/purchases/:id/verify-nit`, table `purchase_book_entries` |
| HU-FAC-20 | Export a book by period and format; an open period is a draft | `GET /invoicing/vat-books/export`, `exceljs` and CSV |
