# Backlog · Sales and POS (HU-VEN)

Source: Google Sheets "Rodalaser Product Backlog v2" (Backlog sheet), exported on 3 Nov 2026. If the Sheet changes, re-export this section; the Sheet is authoritative.
Story text is translated to English; UI strings quoted in "…" stay in Spanish.

## How to use it

- Plan with `/story-plan HU-VEN-xx`, build with `/story-build HU-VEN-xx` (see `.claude/commands/`).
- Design context, data model and rules: `docs/sales/design-notes.md`.
- Open client decisions (#3–20, #53, #54): `docs/backlog/decisions.md`. If a story depends on an open decision, **parameterize it in Settings, do not hardcode it**.
- `VP-xx` screens are the Figma frames (ERP file `JYULL6jvXiwNP8UVvEF7tl`, page 09 Prototype · Sales). UI texts come from there, in Spanish.
- Invoicing is **not** part of this epic. A completed sale creates an `Invoice` record in status `PENDING` (the first state of `invoiceMachine`, "not yet sent to SIAT") through the outbox; the SIAT epic (HU-FAC) issues it for real later.
- **Discounts are per customer** (decided 3 Nov 2026): the customer record holds a discount as a percent or a fixed Bs amount per sale, and the POS, quotes and orders apply it automatically. There are no manual discounts at the POS and no discount approvals, so HU-VEN-06, 28 and 31 are retired and HU-VEN-35 keeps only rounding.
- Every story below is **Pending** except the ones marked **Developed**.

## Status summary (3 Nov 2026)

| Status | Stories |
| ------ | ------- |
| Designed, ready to plan (28) | 00, 01–05, 07–27, 29 |
| Needs a frame or a form from existing parts (1) | 37 |
| Waiting for design (2) | 30, 32 |
| Retired (3) | 06, 28, 31 |
| Developed (4) | 33, 34, 35, 36 (12 Nov 2026, branch `feat/hu-ven-33-34-35-36`; see "As built" in `docs/sales/design-notes.md`) |

## Build order

The first goal is a **walking skeleton** for the Wave 1 review (9–13 Nov): open the register, search, cash sale, ticket, close the register, working end to end. The other blocks widen it afterwards.

| Block | Stories | Why this order |
| ----- | ------- | -------------- |
| 0 · Foundations | 00 | Prisma models + migrations, state machines, `PosCheckout`, generic `ApprovalRequest`, minimal `Customer`, sales settings seed, `PaymentProvider` with a mock adapter. Everything else depends on them. The missing `libs/ui` components (Numpad, Ticket, PosResultRow, PosCartLine, PosCustomer) can be built in parallel |
| Skeleton | 01 → 02 → 07 → 11 → 23 (minimal) | Smallest flow that sells: open shift, search, cash payment, completing the sale (stock out + cash + invoice record + ticket), close shift. E2E covers it |
| A · Cash register | 22 + 23 (full), 24, 25 | Completes the cash cycle started by the skeleton |
| B · POS core | 05 + 37, 03, 04, 33 | Customer + NIT with the customer discount applied automatically; equivalents and technical sheet reuse the inventory search and equivalences |
| C · Other payments | 09, 34, 08, 10 | Mixed and credit need no outside provider; QR and card use the mock adapter until decisions #6 and #8 |
| D · Sales history | 12 + 13 | Needs completed sales |
| E · Prices and approvals | 35, 26 + 27, 29 | Rounding (35) is shared by the POS and the bulk price update (27); the approvals inbox handles cancellations, cash differences and returns |
| F · Cancellations and returns | 14 + 15, 21 | Use the approvals inbox (29); the credit note stays a `PENDING` record |
| G · Quotes and orders | 16 + 17 + 18, 36, 19, 20 | Reservation reuses the stock layer; 36 adds measurements and "Sin existencia" to quote/order/sale lines |
| H · Waiting for design | 30, 32 | Need Figma frames first; 30 reuses `PosCheckout`, 32 reuses Transfers (HU-INV-18) |

`a + b` means the stories are planned and built together on one branch (`/story-plan HU-VEN-22 HU-VEN-23`). Stock-heavy stories (11, 19, 20, 21) stay alone. After the skeleton, blocks E and G touch mostly separate files and can run in parallel; A, B, C and F all touch the checkout and sale services and stay sequential.

Related stories in other epics: HU-REP-07 (sales reports, designed) after block D. HU-CRM-05 is replaced for now by the credit flag on `Customer` (decision #53); the CRM epic extends the customer discount of HU-VEN-37 rather than redoing it.

## Stories

### HU-VEN-00 · Sales foundations

- **Status:** Pending
- **Block:** 0 · Foundations
- **Role:** — (technical) · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** — (ERP `sales` layout and routes only)

**Story:** As the team, we want the sales data model, state machines, settings and payment abstraction in place, so that every HU-VEN story builds on the same base.

**Acceptance criteria:**

• Prisma models and migrations from `docs/sales/design-notes.md`, all with `company_id` and registered in `TENANT_MODELS`
• State machines for cash shift, checkout, sale, approval request, quote and order in `libs/domain`, with unit tests
• Typed `sales.*` settings with the defaults from `docs/backlog/decisions.md`, seeded per company
• `PaymentProvider` interface with a mock adapter (charge, confirm, cancel; idempotent)
• Pure domain functions for the customer discount and rounding, with unit tests
• Empty `sales` API module and ERP `sales` layout with routes, behind permissions

### HU-VEN-01 · Cash register

- **Status:** Pending
- **Block:** A · Cash register
- **Role:** Cashier · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** VP-05, VP-14
- **Open client decisions:** #3

**Story:** As a cashier, I want to open the register with the starting float at the beginning of my shift, so that I can sell and balance at the end.

**Acceptance criteria:**

• Without an open register the POS shows "caja cerrada" and does not allow selling
• I register the starting float
• The opening time and user are recorded

### HU-VEN-02 · Point of sale

- **Status:** Pending
- **Block:** B · POS core
- **Role:** Cashier · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-03

**Story:** As a cashier, I want to search products by code, measurement or brand and add them to the sale, so that I serve the customer quickly at the counter.

**Acceptance criteria:**

• The search shows the branch's stock
• I can change quantities and remove products
• The total is recalculated instantly

### HU-VEN-03 · Point of sale

- **Status:** Pending
- **Block:** B · POS core
- **Role:** Cashier · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-03b

**Story:** As a cashier, I want to see equivalents from other brands when a product is out of stock, so that I do not lose the sale.

**Acceptance criteria:**

• An out-of-stock product offers "Equivalentes"
• Each equivalent shows how it differs from the original and its stock

### HU-VEN-04 · Point of sale

- **Status:** Pending
- **Block:** B · POS core
- **Role:** Cashier · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-03e

**Story:** As a cashier, I want to see the bearing's technical sheet without leaving the sale, so that I can confirm measurements with the customer.

**Acceptance criteria:**

• Shows measurements, brand, photos and equivalents
• I can add it to the sale from the sheet

### HU-VEN-05 · Point of sale

- **Status:** Pending
- **Block:** B · POS core
- **Role:** Cashier · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-03c
- **Open client decisions:** #4

**Story:** As a cashier, I want to register the customer and their invoice data (NIT or final consumer), so that I issue the correct invoice.

**Acceptance criteria:**

• I search an existing customer or create one quickly
• I can invoice a final consumer
• The NIT is validated before invoicing

### HU-VEN-06 · Point of sale

- **Status:** RETIRED (3 Nov 2026) — discounts come from the customer record (HU-VEN-37); there are no manual discounts or discount approvals at the POS
- **Block:** —
- **Role:** Cashier · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-13
- **Open client decisions:** #5

**Story:** As a cashier, I want to apply a discount and ask for approval when it exceeds my limit, so that I close negotiated sales without skipping the rules.

**Acceptance criteria:**

• Discounts within the limit apply directly
• If it exceeds the limit it stays pending Management approval

### HU-VEN-07 · Payment

- **Status:** Pending
- **Block:** B · POS core
- **Role:** Cashier · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-04

**Story:** As a cashier, I want to charge in cash and see the change to return, so that I avoid change errors.

**Acceptance criteria:**

• I enter the received amount with a numeric keypad
• The change is calculated
• Confirming with less than the total is not allowed

### HU-VEN-08 · Payment

- **Status:** Pending
- **Block:** C · Other payments
- **Role:** Cashier · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-04b
- **Open client decisions:** #6

**Story:** As a cashier, I want to charge by QR and see when the payment is confirmed, so that I accept digital payments.

**Acceptance criteria:**

• The QR is shown with the amount
• The screen waits for confirmation
• I can cancel and choose another payment method

### HU-VEN-09 · Payment

- **Status:** Pending
- **Block:** C · Other payments
- **Role:** Cashier · **Priority:** Should · **Delivery:** Wave 1
- **Screens:** VP-04c
- **Open client decisions:** #7

**Story:** As a cashier, I want to combine payment methods in one sale, so that I serve customers who pay part in cash and part by card or QR.

**Acceptance criteria:**

• I split the total among several payment methods
• It shows how much is still uncovered

### HU-VEN-10 · Payment

- **Status:** Pending
- **Block:** C · Other payments
- **Role:** Cashier · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-12
- **Open client decisions:** #8

**Story:** As a cashier, I want to know whether a card was declined and retry or change the payment method, so that I do not lose the sale over a decline.

**Acceptance criteria:**

• The decline is shown
• I can retry the charge or go back to the sale

### HU-VEN-11 · Payment

- **Status:** Pending
- **Block:** B · POS core
- **Role:** Cashier · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-16a, VP-16b
- **Open client decisions:** #9

**Story:** As a cashier, I want to complete the sale and get the invoice even if SIAT does not respond, so that the sale is never blocked.

**Acceptance criteria:**

• On payment, stock is deducted and the cash register is updated
• With SIAT online the invoice is valid with QR
• Offline it is issued in contingency and regularized later
• I can print or send the receipt

> Scope note: until the SIAT epic exists, the sale creates the invoice record as `PENDING` and the receipt prints without the SIAT QR.

### HU-VEN-12 · Sales made

- **Status:** Pending
- **Block:** D · Sales history
- **Role:** Cashier / Management · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-01a, VP-01d, VP-01b, VP-01c

**Story:** As a cashier / Management, I want to consult the sales made with filters, so that I review what was sold and find a sale.

**Acceptance criteria:**

• List with number, customer, date, items, total and status
• Menu per row with actions
• Empty and loading states

### HU-VEN-13 · Sales made

- **Status:** Pending
- **Block:** D · Sales history
- **Role:** Cashier / Management · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-02

**Story:** As a cashier / Management, I want to see a sale's detail with its invoice and payment, so that I answer customer queries.

**Acceptance criteria:**

• Shows products, payment, linked invoice and history
• I can reprint

### HU-VEN-14 · Cancellation

- **Status:** Pending
- **Block:** F · Cancellations and returns
- **Role:** Cashier · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-15a, VP-15
- **Open client decisions:** #10

**Story:** As a cashier, I want to request the cancellation of a sale with a reason, so that I correct errors without cancelling on my own.

**Acceptance criteria:**

• I choose the reason and add a comment
• The sale stays "anulación pendiente" until Management decides

### HU-VEN-15 · Cancellation

- **Status:** Pending
- **Block:** F · Cancellations and returns
- **Role:** Management · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-15c, VP-15d
- **Open client decisions:** #11

**Story:** As Management, I want to approve or reject a cancellation seeing its impact, so that I control cancellations.

**Acceptance criteria:**

• I see amount, reason and what will happen (cancels invoice, returns stock, refund)
• On approval the sale is cancelled
• On rejection I reply to the requester

### HU-VEN-16 · Quotes

- **Status:** Pending
- **Block:** G · Quotes and orders
- **Role:** Salesperson · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-07, VP-08

**Story:** As a salesperson, I want to create a quote by searching products, so that I answer customers' price requests.

**Acceptance criteria:**

• List of quotes with status
• New quote with search, quantities and validity

### HU-VEN-17 · Quotes

- **Status:** Pending
- **Block:** G · Quotes and orders
- **Role:** Salesperson · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-08b

**Story:** As a salesperson, I want to see the quote as the customer will receive it and send it by WhatsApp or e-mail, so that I send it without leaving the system.

**Acceptance criteria:**

• Preview of the document
• Sending by WhatsApp or e-mail
• The sending is recorded

### HU-VEN-18 · Quotes

- **Status:** Pending
- **Block:** G · Quotes and orders
- **Role:** Salesperson · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-17, VP-17b
- **Open client decisions:** #12

**Story:** As a salesperson, I want to follow each quote's status and know when it expires, so that I follow up in time.

**Acceptance criteria:**

• Detail with statuses
• An expired quote says so and can be renewed

### HU-VEN-19 · Orders

- **Status:** Pending
- **Block:** G · Quotes and orders
- **Role:** Salesperson · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-09, VP-18
- **Open client decisions:** #13

**Story:** As a salesperson, I want to convert a quote into an order reserving the stock, so that I secure the merchandise for the customer.

**Acceptance criteria:**

• List of orders
• The order is born from the quote
• Reserved stock is no longer available to others

### HU-VEN-20 · Orders

- **Status:** Pending
- **Block:** G · Quotes and orders
- **Role:** Salesperson · **Priority:** Should · **Delivery:** Wave 1
- **Screens:** VP-19, VP-19b
- **Open client decisions:** #14

**Story:** As a salesperson, I want to dispatch and invoice an order in parts, so that I deliver what is available without waiting for the rest.

**Acceptance criteria:**

• I choose what to dispatch and invoice now
• The balance stays pending on the order

### HU-VEN-21 · Returns

- **Status:** Pending
- **Block:** F · Cancellations and returns
- **Role:** Cashier · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-20, VP-10, VP-21
- **Open client decisions:** #15

**Story:** As a cashier, I want to register a return and issue the credit note, so that I handle exchanges and claims.

**Acceptance criteria:**

• I choose the sale and the returned products
• A linked credit and debit note is generated
• Stock returns to the branch

### HU-VEN-22 · Cash register

- **Status:** Pending
- **Block:** A · Cash register
- **Role:** Cashier · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-22, VP-22b
- **Open client decisions:** #16

**Story:** As a cashier, I want to see my shift and register cash income and expenses, so that I justify every cash movement.

**Acceptance criteria:**

• Current shift with sales per payment method
• I register expenses with a reason

### HU-VEN-23 · Cash register

- **Status:** Pending
- **Block:** A · Cash register
- **Role:** Cashier · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-06

**Story:** As a cashier, I want to close the register counting cash by denomination, so that I balance the shift.

**Acceptance criteria:**

• I count bills and coins
• The system calculates the difference against what was sold
• I register QR, card and transfer

### HU-VEN-24 · Cash register

- **Status:** Pending
- **Block:** A · Cash register
- **Role:** Accounting · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-06b
- **Open client decisions:** #17

**Story:** As Accounting, I want to review and approve closings with a difference, so that I control shortages and surpluses.

**Acceptance criteria:**

• I see the difference and the cashier's comment
• I approve or flag it
• An audit record is kept

### HU-VEN-25 · Cash register

- **Status:** Pending
- **Block:** A · Cash register
- **Role:** Management / Accounting · **Priority:** Should · **Delivery:** Wave 1
- **Screens:** VP-23

**Story:** As Management / Accounting, I want to consult the shift history, so that I review previous closings.

**Acceptance criteria:**

• List by date, cashier, totals and difference

### HU-VEN-26 · Prices and discounts

- **Status:** Pending
- **Block:** E · Prices and approvals
- **Role:** Management · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-11, VP-11b
- **Open client decisions:** #18

**Story:** As Management, I want to consult and edit a product's price, so that I keep prices up to date.

**Acceptance criteria:**

• A single price per product and company
• The edit is recorded

### HU-VEN-27 · Prices and discounts

- **Status:** Pending
- **Block:** E · Prices and approvals
- **Role:** Management · **Priority:** Should · **Delivery:** Wave 1
- **Screens:** VP-11c
- **Open client decisions:** #19

**Story:** As Management, I want to update prices in bulk by brand or category, so that I apply supplier adjustments at once.

**Acceptance criteria:**

• I choose the filter and percentage
• I see a preview before applying

### HU-VEN-28 · Prices and discounts

- **Status:** RETIRED (3 Nov 2026) — replaced by the per-customer discount (HU-VEN-37); decision #20 no longer applies
- **Block:** —
- **Role:** Management · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-24, VP-24b
- **Open client decisions:** #20

**Story:** As Management, I want to define discount rules, so that cashiers apply discounts without consulting me every time.

**Acceptance criteria:**

• List of rules
• New rule with conditions and limit

### HU-VEN-29 · Prices and discounts

- **Status:** Pending
- **Block:** E · Prices and approvals
- **Role:** Management · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** VP-25

**Story:** As Management, I want an inbox with everything awaiting my approval, so that I resolve cancellations, cash differences and returns in one place.

> Scope note (3 Nov 2026): discounts no longer need approval (HU-VEN-37), so the inbox has no discount group.

**Acceptance criteria:**

• Grouped by type
• I approve or reject with a comment

### HU-VEN-30 · Point of sale

- **Status:** Waiting for design
- **Block:** H · Waiting for design
- **Role:** Cashier · **Priority:** Should · **Delivery:** Wave 1
- **Screens:** — (to be designed)

**Story:** As a cashier, I want to put a sale on hold and resume it, so that I serve another customer while the first one decides.

**Acceptance criteria:**

• I put the sale on hold
• I resume it from a list

### HU-VEN-31 · Point of sale

- **Status:** RETIRED (3 Nov 2026) — no manual discounts at the POS; the customer discount applies to the whole sale (HU-VEN-37)
- **Block:** —
- **Role:** Cashier · **Priority:** Could · **Delivery:** Wave 1
- **Screens:** — (to be designed)

**Story:** As a cashier, I want to apply a discount to a single line of the sale, so that I negotiate per product.

**Acceptance criteria:**

• The line discount respects my limit

### HU-VEN-32 · Orders

- **Status:** Waiting for design
- **Block:** H · Waiting for design
- **Role:** Salesperson · **Priority:** Should · **Delivery:** Wave 1
- **Screens:** — (to be designed)

**Story:** As a salesperson, I want to request a transfer of missing items from another branch from the sale, so that I complete an order without local stock.

**Acceptance criteria:**

• Generates a transfer request with the missing items (reuses HU-INV-18)

### HU-VEN-33 · Point of sale

- **Status:** Developed (12 Nov 2026)
- **Block:** B · POS core
- **Role:** Cashier · **Priority:** Should · **Delivery:** Wave 2
- **Screens:** VP-03, VP-04

**Story:** As a cashier, I want to reorder the cart lines by dragging them, so that I group the products the way the customer asks.

**Acceptance criteria:**

• Each line has a visible drag handle
• The order is kept in the quote and in the invoice
• A notice in the shortcuts explains how to reorder

### HU-VEN-34 · Point of sale

- **Status:** Developed (12 Nov 2026). The balance is stored on the `CREDIT` payment and readable at `GET /sales/customers/:id/credit-balance`; collecting it waits for HU-CON-03
- **Block:** C · Other payments
- **Role:** Cashier · **Priority:** Should · **Delivery:** Wave 2
- **Screens:** VP-04d
- **Decision #53 answered (22 Oct)**

**Story:** As a cashier, I want to charge on credit a customer who has credit enabled, so that I sell to companies that pay later.

**Acceptance criteria:**

• Credit is a flag (yes/no) on the customer record; there is no amount limit
• Requires an identified customer with NIT and the flag on
• I choose the term (5, 15, 30 days or other) and the due date is shown
• The balance goes to Accounts receivable (HU-CON-03; until then, stored on the sale)

### HU-VEN-35 · Point of sale

- **Status:** Developed (12 Nov 2026). Decision #54 stays open: `sales.roundingMode` is `NONE` until the client answers
- **Block:** E · Prices and approvals
- **Role:** Cashier · **Priority:** Must · **Delivery:** Wave 2
- **Screens:** VP-03, VP-11c
- **Open client decisions:** #54

**Story:** As a cashier, I want totals after the customer discount rounded to an integer or to Bs 0.50, so that I avoid cents.

**Acceptance criteria:**

• The rounding is shown "redondeado" in the totals
• The bulk price update uses the same rounding rule

> Scope note (3 Nov 2026): the authorization criterion was dropped together with manual discounts (HU-VEN-37).

### HU-VEN-36 · Quotes and orders

- **Status:** Developed (12 Nov 2026)
- **Block:** G · Quotes and orders
- **Role:** Salesperson · **Priority:** Must · **Delivery:** Wave 2
- **Screens:** VP-08, VP-08b, VP-17, VP-18, VP-19, VP-02

**Story:** As a salesperson, I want to see each bearing's measurements and whether it is out of stock in quotes, orders and sales, so that I do not promise what is not there.

**Acceptance criteria:**

• Each line shows measurements (inner Ø · outer Ø · width) and type
• A line without stock shows "Sin existencia"
• The customer preview includes the measurements

### HU-VEN-37 · Customers

- **Status:** Pending
- **Block:** B · POS core (built with HU-VEN-05)
- **Role:** Management · **Priority:** Must · **Delivery:** Wave 1
- **Screens:** — (Figma frame to be added; until then a form built from existing `libs/ui` parts)
- **Decisions #5 and #20 answered (3 Nov)**

**Story:** As Management, I want to set a discount on each customer when I register them, so that every sale to that customer gets it without the cashier deciding.

**Acceptance criteria:**

• The customer form has the data, NIT, the credit flag and the discount
• The discount is a percent or a fixed amount in Bs per sale, or none
• The POS, quotes and orders apply it automatically when the customer is chosen, and the total never goes below 0
• Changes to the discount are recorded with user and date
• Requires the permission `sales.customers.manage`
