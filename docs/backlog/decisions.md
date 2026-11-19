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
| 53 | Credit sales: to whom, limit, terms | VEN-34, CRM-05 | **Answered 22 Oct:** credit is a yes/no flag on the customer, no amount limit, variable terms (5, 15, 30 days or other). The terms offered are the setting `sales.creditTermDays` (`[5, 15, 30]`) plus "Otro" (1 to 365 days) |
| 54 | Rounding rule (integer or Bs 0.50); who sees costs in exported lists | VEN-35, REP-07 | `sales.roundingMode` = `NONE` until answered; costs only with `inventory.costs.view` |

When the client answers, update this table and the Sheet, and change the default value in the settings seed.

## Invoicing (HU-FAC)

| No. | Question | Stories | Default value meanwhile |
| --- | -------- | ------- | ----------------------- |
| — | Contingency when the SIAT is down | FAC-01…10, 14…17 | **Answered 12 Nov (client rule):** no contingency. The invoice stays `PENDING` ("No facturada en SIAT"), nothing is retried, the ERP says which invoices are still not issued when the SIAT is back and a person issues them. HU-FAC-14…17 retired |
| 21 | Is a NIT exception allowed and who approves it | FAC-08 | Allowed (`invoicing.allowNitException` = `true`); approved with `invoicing.nit-exception.approve` |
| 22 | Cancellation reasons and deadline | FAC-09, FAC-10 | The four SIN reasons as the catalogue (replaced by the synced one in HU-FAC-25); deadline = `sales.cancellationWindowDays` (no limit) |
| 31 | Modality and economic sector | FAC-04 | Modality read from `SiatSettings.modality`; sector 1 (purchase-sale) |

| — | Credit notes without a return (price adjustment) | FAC-12 | **Not allowed** (`invoicing.allowPriceAdjustmentNotes` = `false`): a note is born from a return. When a company turns it on, the invoice offers a form to credit money on its lines, never more than was invoiced |
| — | Layout of the VAT books and export formats | FAC-18, FAC-20 | `invoicing.vatBookFormat` = `SIN_LCV` (the SIN "Libro de Compras y Ventas" columns, to confirm with the accountant) and `invoicing.vatBookExportFormats` = `['XLSX', 'CSV']` |
| — | Warning before a CUIS/CUFD expires | FAC-13 | `invoicing.cufdWarnHours` = `6` |

| 29 | Who delivers and renews the signature and the SIAT credentials | FAC-23 | Management uploads them in the ERP (Configuración fiscal); warning `invoicing.signatureWarnDays` = `30` |
| 30 | How SIN codes are assigned and who homologates | FAC-26 | Per product, by hand or Excel, by whoever holds `invoicing.settings.manage`; `invoicing.requireHomologation` = `false` (a product without code uses the default code) |
| 31 | Modality and document sectors | FAC-22 | `SiatSettings.modality` (unchanged) and `invoicing.documentSectors` = `[1, 24]` |
| — | Closing a VAT period | FAC-21 | **Answered 16 Nov (planning):** a closed period locks its books and its cancellations (an invoice of it is corrected with a credit note); states `OPEN → CLOSED → FILED`; a closed period can be reopened with a reason (audited), a filed one cannot |

The credit note and cancellation reasons come from the synced SIN catalogue once a company has synced it (HU-FAC-25); until then the built-in lists are used. A VAT book period is a draft until it is closed (HU-FAC-21).

Cancellation never moves stock or cash without the SIAT: if it is offline or refuses, the approval is blocked and the request stays pending.

## Purchasing (HU-COM)

Same rule: parameterize in the per-company settings table with the default below. Questions added to the Sheet on 19 Nov 2026 from the "PENDIENTE (cliente)" note of CO-00 and the gaps of the design.

| No. | Question | Stories | Default value meanwhile |
| --- | -------- | ------- | ----------------------- |
| 55 | How import expenses are apportioned (FOB value, weight or quantity) and to which products (all or only received) | COM-04, COM-17 | `purchasing.apportionmentBasis` = `FOB_VALUE` and `purchasing.apportionmentScope` = `ALL_PRODUCTS`, both editable per file as in CO-16 |
| 56 | From what amount a purchase order needs Management approval | COM-02, COM-11 | `purchasing.approvalThreshold` = `0.00` Bs: every order is approved, with `purchasing.orders.approve` |
| 57 | Is partial receipt allowed; how are excess and damaged goods recorded | COM-03, COM-14 | Partial receipt allowed (`purchasing.allowPartialReceipt` = `true`); a shortfall becomes a pending `SHORTAGE` adjustment; excess is refused (received ≤ ordered) until designed |
| 58 | Exchange-rate source (fixed 6,96, daily BCB or manual) and who updates it | COM-02, COM-04, COM-20 | `purchasing.exchangeRateSource` = `MANUAL` with `purchasing.defaultExchangeRate` = `6.96`; each document stores its own rate |
| 59 | Partial payments and several documents in one payment | COM-06 | Both allowed (`purchasing.allowPartialPayments` = `true`), through payment allocations |
| 60 | Days before the due date that make a document "Por vencer" | COM-20 | `purchasing.dueSoonDays` = `7` |
