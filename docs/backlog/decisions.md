# Client decisions

Source: "Decisiones" sheet of Product Backlog v2 (re-checked 3 Nov 2026). #5, #20 and #53 have answers; the rest are open.

## Inventory

Rule: while a decision is open, it is **parameterized in Settings** (per-company settings table) with the default value below. It is not fixed in code.

| No. | Question | Stories | Default value meanwhile |
|---|---|---|---|
| 32 | Required technical fields per type; alternative units, lots and SKU format | HU-INV-06 | Required: code, brand, category, price and, for bearings, d × D × B. A single unit per product. No lots. Sequential internal SKU per company (`RL-000001`) |
| 33 | What happens with brands that do not exist on import? | HU-INV-10 | The row gets an error "Marca no existe"; the brand is not created automatically |
| 34 | Who approves equivalence links? | HU-INV-13 | Permission `inventory.equivalences.approve`; approval not mandatory (saved on linking, with audit) |
| 35 | Is sending a partial transfer (only the correct lines) allowed? | HU-INV-19 (retired) | **Obsolete.** No: sending is blocked while there are errors |
| 36 | Limit amount or quantity and who approves transfers | HU-INV-20 (retired) | **Obsolete.** (Original default: Setting `transfers.approvalThresholdPieces` and `...Value` per company; no configured limit = never asks for approval. Whoever has `inventory.transfers.approve` approves) |
| 37 | Who approves adjustments and from what amount? | HU-INV-23 (retired) | **Obsolete.** (Original default: Same as 36 with `adjustments.approvalThresholdValue`; permission `inventory.adjustments.approve`) |
| 38 | Official brand logos | HU-INV-01, HU-INV-06 | Show the brand name as text; the logo is optional (`logoUrl` null) |
| 52 | Real list of categories and subcategories and which technical fields each requires | HU-INV-01, HU-INV-06 | Seed the 8 sample categories; attributes defined per category (see `design-notes.md`) |

Sample categories (DEMO): Rodamientos, Retenes y sellos, Correas y poleas, Cadenas y piñones, Lubricantes y grasas, Herramientas, Accesorios, Acoples.
Flags per brand (DEMO): SKF→SE, NSK→JP, FAG→DE, INA→DE, NTN→JP, Fersa→ES, Gates→US.

## Sales (HU-VEN)

Same rule: parameterize in the per-company settings table with the default below. `—` means no default is needed.

| No. | Question | Stories | Default value meanwhile |
| --- | -------- | ------- | ----------------------- |
| 3 | Fixed cash float and how many registers per branch | VEN-01 | The float is typed when the shift opens; one register per SIAT point of sale |
| 4 | How to invoice customers without NIT | VEN-05 | Consumer-final invoice (NIT 0, name "S/N") |
| 5 | Maximum discount per role and who approves | VEN-06, 35, 37 | **Answered 3 Nov:** the discount is set per customer (percent or fixed Bs per sale) when the customer is registered and applies to all their sales; no manual POS discounts, no approvals (HU-VEN-37) |
| 6 | QR provider | VEN-08 | Mock `PaymentProvider` adapter; manual confirmation by the cashier |
| 7 | Is mixed payment accepted? | VEN-09 | Yes (setting `sales.allowMixedPayment`) |
| 8 | Card terminal provider | VEN-10 | Mock adapter; cashier reports approved/declined |
| 9 | Print on 80 mm ticket or letter | VEN-11 | Both templates; 80 mm is the default |
| 10 | Legal deadline to cancel in SIAT | VEN-14 | Setting `sales.cancellationWindowDays`, no limit until answered |
| 11 | Who approves cancellations | VEN-15, FAC-10 | Permission `sales.cancellations.approve` |
| 12 | Default quote validity | VEN-18 | 7 days (`sales.quoteValidityDays`) |
| 13 | Sell with stock from another branch (reserve + transfer) | VEN-19, 32 | No: reservation only against the order's branch |
| 14 | Partial dispatch and invoicing | VEN-20 | Allowed (`sales.allowPartialDispatch`) |
| 15 | Return deadline, approval limit, refund methods | VEN-21 | No deadline (`sales.returnWindowDays`); no approval limit (`sales.returnApprovalLimit`, permission `sales.returns.approve` decides above it); refund in cash, store credit or transfer (as in Figma) |
| 16 | Cash expense limit without approval | VEN-22 | No limit configured = never asks |
| 17 | Policy for cash differences | VEN-24 | Any difference needs Accounting review (`sales.cash-register.review`; tolerance setting `sales.cashDifferenceTolerance`, `0.00`). The reviewer approves it or asks for a recount (`OBSERVED`, final, comment required); nobody reviews their own shift |
| 18 | Who can change prices | VEN-26 | Permission `sales.prices.edit` (Management). One price per product and company; every change (Precios screen, inventory form, Excel import) is kept in `price_changes` |
| 19 | Do bulk price changes need approval? | VEN-27 | No; applied with preview and audit. Setting `sales.bulkPriceRequiresApproval` (`false`): when a company turns it on, applying is refused (`BULK_PRICE_APPROVAL_REQUIRED`) until the approval flow of a later story exists |
| 20 | Do discount rules stack? | VEN-28 | **Obsolete (3 Nov):** discount rules were replaced by the per-customer discount (#5) |
| 53 | Credit sales: to whom, limit, terms | VEN-34, CRM-05 | **Answered 22 Oct:** credit is a yes/no flag on the customer, no amount limit, variable terms (5, 15, 30 days or other) |
| 54 | Rounding rule (integer or Bs 0.50); who sees costs in exported lists | VEN-35, REP-07 | `sales.roundingMode` = `NONE` until answered; costs only with `inventory.costs.view` |

When the client answers, update this table and the Sheet, and change the default value in the settings seed.
