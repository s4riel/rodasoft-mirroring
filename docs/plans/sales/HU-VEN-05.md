# HU-VEN-05 + HU-VEN-37 · Customer and invoice data at the POS — plan

**Stories** (`docs/backlog/sales.md`):
- HU-VEN-05: As a cashier, I want to register the customer and their invoice data (NIT or final consumer), so that I issue the correct invoice. Screen VP-03c (Figma `JYULL6jvXiwNP8UVvEF7tl`, node id read with `get_design_context` at build time).
- HU-VEN-37: As Management, I want to set a discount on each customer when I register them, so that every sale to that customer gets it without the cashier deciding. No Figma frame yet: a form built from existing `libs/ui` parts.

**Context**
- **Depends on HU-VEN-02** (POS page, server-side cart `PosCheckout` which already has `customerId`, `cartTotals()`). Branch `feat/hu-ven-05` from `develop`, after 01 and 02 are merged (03 is independent but also touches `pos.page`).
- **Already in the repo:**
  - `Customer` model (unique on company + document type + number, `creditEnabled`, `discountType`, `discountValue`), no API or UI.
  - `normalizeNit`, `isNitFormatValid`, `IdentityDocumentType` in `libs/domain/src/lib/nit.ts`.
  - `applyCustomerDiscount` and `roundSaleTotal` in `libs/domain/src/lib/sales-pricing.ts`.
  - `libs/siat` has `verifyNit`, but nothing in `apps/api` uses `libs/siat` yet.

## Acceptance criteria → checks

| Criterion | Proof |
| --- | --- |
| Search an existing customer or create one quickly | `customers.int.spec.ts`: search by name, NIT or CI finds the customer in the same company only; quick-create saves it; duplicate document gives `CUSTOMER_DOCUMENT_DUPLICATED` (409). `pos-customer.int.spec.ts`: `PUT /sales/pos/checkout/customer` links it to my cart. Page spec: `rs-pos-customer` searches, selects and creates |
| I can invoice a final consumer | Domain `customer.spec.ts`: `FINAL_CONSUMER` is NIT `0`, name "S/N". `pos-customer.int.spec.ts`: the cart accepts "Consumidor final" (customer null) without creating a `Customer` row. Page spec: it is the default and can be picked again |
| The NIT is validated before invoicing | `nit.spec.ts` (extended): formats per document type. `customers.int.spec.ts`: invalid document gives `INVALID_NIT` (400). `pos-customer.int.spec.ts`: `GET /sales/pos/checkout/invoice-data` refuses a cart whose customer fails validation. Page spec: inline error "NIT inválido" |
| 37 · form has the data, NIT, credit flag and discount | `customers.int.spec.ts` (create/edit) and the form page spec |
| 37 · discount is percent, fixed Bs per sale, or none | Domain `customerDiscountInputValid()` rejects percent outside 0–100, negative amounts, NONE with a value; API test `INVALID_DISCOUNT`; DB CHECK test |
| 37 · POS applies it automatically; total never below 0 | `pos-checkout.int.spec.ts`: cart totals include the customer discount; unit test of `cartTotals` with a discount larger than the total; the cashier has no way to change it |
| 37 · changes recorded with user and date | `AuditService.log` with `before`/`after` on discount and credit changes, in the same transaction; test reads `audit_logs` |
| 37 · requires `sales.customers.manage` | Test: 403 without it |

## Model

Migration **`<ts>_customer_checks`**, no new tables (`Customer` is already in `TENANT_MODELS`):
- CHECK `customers_discount_none_check`: value 0 when type is `NONE`. (HU-VEN-00 already checks not negative and percent ≤ 100.)
- Index on `(company_id, document_number)` for search.

## Domain (`libs/domain`)

- `nit.ts`: `validateInvoiceDocument(type, number, complement?)` returns structured errors. NIT 5–13 digits; CI may carry a complement; PAS and OD allow alphanumeric.
- New `customer.ts` (+spec): `FINAL_CONSUMER` constant (NIT `0`, "S/N"), `customerDiscountInputValid()`, `describeCustomerDiscount()`.
- Extend `cartTotals` input from 02 so it receives the customer discount and the rounding mode.
- No state machine change.

## API (`apps/api/src/modules/sales/customers/` and `pos/`)

| Route | Permission | Error `code`s |
| --- | --- | --- |
| `GET /sales/pos/customers?q=` (search) | `sales.pos.use` + open shift | – |
| `POST /sales/pos/customers` (quick create: name, document, optional e-mail/phone; discount NONE, credit false) | `sales.pos.use` | `INVALID_NIT`, `CUSTOMER_DOCUMENT_DUPLICATED` |
| `PUT /sales/pos/checkout/customer` `{ customerId \| null }` (null = final consumer) | `sales.pos.use` + open shift | `CUSTOMER_NOT_FOUND`, `CUSTOMER_INACTIVE`, `CHECKOUT_NOT_EDITABLE`, `CASH_SHIFT_NOT_OPEN` |
| `GET /sales/pos/checkout/invoice-data` | `sales.pos.use` | `INVALID_NIT` |
| `GET/GET :id/POST/PATCH :id /sales/customers` (list with page, full form incl. credit and discount) | `sales.customers.manage` | `INVALID_DISCOUNT`, `INVALID_NIT`, `CUSTOMER_DOCUMENT_DUPLICATED` |

- All queries through `prisma.tenant`. Discount/credit changes audited in the same transaction. No outbox event (no document changes state).
- A repeated NIT with a different name returns the existing customer instead of silently creating a second one.
- **NIT check:** format only. New setting `sales.nitVerification` (`FORMAT` default; `SIAT` reserved for HU-FAC) keeps the real SIAT check configurable.

## ERP screens

- **VP-03c** customer block inside `pos.page` (search, select, quick create, "Consumidor final"). Discount line shown only for a customer with a discount.
- **HU-VEN-37** customer list + form under Sales, new tab and route guarded by `sales.customers.manage`.
- **New `libs/ui` component:** `rs-pos-customer` (PosCustomer exists in Figma, not in `libs/ui`). Own `.ts`, `.html`, `.scss`, spec; export; showcase entry; row in `docs/ui-library.md`.
- Reused: `rs-input`, `rs-select`, `rs-modal`, `rs-radio-card`, `rs-switch`, `rs-note`, `rs-empty-state`, `rs-doc-table`, `rs-status-pill`.
- Loading, empty, error and no-permission states on every list and form.

## Permissions

Add `sales.customers.manage` ("Gestionar clientes del POS y descuentos"). Management gets it automatically; the cashier does not.

## Tests

- **Unit:** `nit.spec.ts`, `customer.spec.ts`, `pos-cart.spec.ts`; specs for `rs-pos-customer`, the POS page and the customer form.
- **Integration (real Postgres):** `customers.int.spec.ts`, `pos-customer.int.spec.ts`; two concurrent creates of the same NIT leave one row; tenant isolation; discount recomputed on the server.
- **E2E** `apps/erp-e2e/src/pos-customer.spec.ts`: open register → add product → create customer with NIT → discount applied → switch to final consumer → total changes.
- Stock is not touched (no `stock-auditor`). Run `ui-checker`, then `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default

- **#4** customers without NIT: final consumer, NIT `0`, name "S/N", as a `FINAL_CONSUMER` constant (not a Customer row).
- **#5** answered: discount per customer. **#53** answered: credit flag, no limit.

## Decisions taken in planning (approved)

1. HU-VEN-37 is built on this branch.
2. Any user with `sales.pos.use` may quick-create a customer (no discount, no credit). Only `sales.customers.manage` sets those.
3. NIT validation is format-only for now; SIAT verification comes with HU-FAC via `sales.nitVerification`.

## Built differently from the first draft

- Management routes are `/sales/customers`; the cashier's search and quick create are `/sales/pos/customers` (no either-or permission check).
- The customer dialog has a "Consumidor final" footer button that is not in the Figma frame (documented in `docs/ui-library.md`).
- The POS result list is a list of buttons with `aria-pressed`, not an ARIA listbox.

## Risks and doubts

- If Management edits a customer's discount while a cart is open, the cart picks up the new value on its next total calculation; HU-VEN-11 freezes it in the sale.
- **For HU-VEN-11:** an open cart keeps applying the discount of a customer deactivated after being chosen; only `GET /sales/pos/checkout/invoice-data` refuses an inactive customer. Completing the sale must re-check the customer's status and freeze the discount in the sale.
- Conflicts: `schema.prisma`, `sales.routes.ts`, `sales-tabs.ts`, `pos.page.*`, `permissions.ts`, `libs/domain/src/index.ts` are touched by 01–03. Build after those merge. Latest migration at planning time: `20261104024945_cash_shift_opening`.

## Files expected to change

- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_customer_checks/`
- `apps/api/src/modules/sales/customers/**` (new), `apps/api/src/modules/sales/pos/**`, `apps/api/src/modules/sales/sales.module.ts`
- `libs/domain/src/lib/nit.ts`, `customer.ts` (+specs), `pos-cart.ts`, `permissions.ts`, `company-settings.ts`, `libs/domain/src/index.ts`
- `libs/ui/src/lib/pos-customer/**`, `libs/ui/src/index.ts`, `docs/ui-library.md`
- `apps/erp/src/app/features/design-system/**`, `apps/erp/src/app/features/sales/pos/**`, `apps/erp/src/app/features/sales/customers/**`, `sales.routes.ts`, `sales-tabs.ts`
- `apps/erp-e2e/src/pos-customer.spec.ts` (new)
