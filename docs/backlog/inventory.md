# Backlog · Inventory (HU-INV)

Source: Google Sheets "Rodalaser Product Backlog v2" (Backlog sheet), exported on 22 Oct 2026.
If the Sheet changes, re-export this section; the Sheet is authoritative.

## How to use it

- Implement with `/story HU-INV-xx` (see `.claude/commands/story.md`).
- Design context and business rules: `docs/inventory/design-notes.md`.
- Open client decisions: `docs/backlog/decisions.md`. If a story depends on an open decision, **parameterize it in Settings, do not hardcode it**.
- `IN-xx` screens are the Figma frames (ERP file `JYULL6jvXiwNP8UVvEF7tl`, page 08 Prototype · Inventory). UI texts come from there, in Spanish.

## Retired (do NOT implement)

v2 retired the Stock, Counts and Catalog tabs: **HU-INV-14, HU-INV-15, HU-INV-25, HU-INV-26**.
Even though there is no minimum/maximum screen, the data model does store `min_stock` and `max_stock` per product and branch, because HU-INV-27 and the alerts use them.

## Build order

| Block                                             | Stories                                          |
| ------------------------------------------------- | ------------------------------------------------ |
| A · Foundations (data model, no story of its own) | see `docs/inventory/design-notes.md` §Data model |
| B · Products                                      | 01, 02, 03, 05, 06, 07, 08, 09                   |
| C · Stock and kardex                              | 16, 24, 22, 23                                   |
| D · Equivalences                                  | 04, 11, 12, 13                                   |
| E · Warehouses and transfers                      | 17, 18, 19, 20, 21, 27                           |
| F · Excel importer                                | 10                                               |

## Stories

### HU-INV-01 · Products

- **Block:** B · Products
- **Role:** Warehouse / Sales · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-01a, IN-01b, IN-01c (actions menu), IN-01d, IN-01e (applied filters)
- **Open client decisions:** #38, #52

**Story:** As Warehouse / Sales, I want to browse the product catalog with filters, so that I can find any bearing.

**Acceptance criteria:**

• List with photo, code, brand, measurements, total stock, stock at the current branch and price
• The brand shows its logo and the industry (country of origin) its flag
• Filters by Industry (country), Category, Subcategory, Brand and Status, with icons; there is no branch filter
• Applied filters appear as chips with flag, logo or icon and are removed with the ✕
• Import, Export and New product buttons in the header, with distinct icons
• Pagination for thousands of products
• Empty states with illustration: empty catalog (first use) and no results with "Limpiar filtros"

### HU-INV-02 · Products

- **Block:** B · Products
- **Role:** Warehouse · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-01c, IN-19

**Story:** As Warehouse, I want to access a product's actions from the list, so that I can work quickly.

**Acceptance criteria:**

• View, edit, duplicate, adjust stock and delete
• Duplicate asks for a new code and lets me choose the industry (country of origin)

### HU-INV-03 · Products

- **Block:** B · Products
- **Role:** Warehouse / Sales · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-02a

**Story:** As Warehouse / Sales, I want to see the full product sheet, so that I know its technical data, price and stock.

**Acceptance criteria:**

• Data, measurements, photos, price and stock per branch
• Industry with its flag and brand with its logo
• Each field carries an icon indicating its data type

### HU-INV-04 · Products

- **Block:** D · Equivalences
- **Role:** Warehouse / Sales · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-02b

**Story:** As Warehouse / Sales, I want to see on the sheet the equivalents from other brands and how they differ, so that I can offer reliable alternatives.

**Acceptance criteria:**

• Equivalents tab
• Each equivalent flags its differences

### HU-INV-05 · Products

- **Block:** B · Products
- **Role:** Warehouse · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-22, IN-23

**Story:** As Warehouse, I want to see the movements and the stock per warehouse from the sheet, so that I can trace inflows and outflows.

**Acceptance criteria:**

• Movements tab
• Stock per warehouse tab

### HU-INV-06 · Products

- **Block:** B · Products
- **Role:** Warehouse · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-03a (categories), IN-03 P1, IN-03 P2, IN-03 P3, IN-03 P4, IN-03 P5, IN-03 P6, IN-03 Code error, IN-03 Price error, IN-03 Created, IN-03c and IN-03d (Seals and gaskets), IN-03e to IN-03j (step 1) and IN-03e2 to IN-03j2 (step 2) of the other categories
- **Open client decisions:** #32, #38, #52

**Story:** As Warehouse, I want to create a product step by step with validations, so that I register it completely and without duplicates.

**Acceptance criteria:**

• First step: category-only cards (Rodamientos, Retenes y sellos, Correas y poleas, Cadenas y piñones, Lubricantes y grasas, Herramientas, Accesorios, Acoples; sample list)
• The subcategory is chosen in step 1 and determines which technical fields the next step asks for
• Bearings: 6 steps (identification, dimensions, specifications, price and inventory, photos, equivalences); other categories: 4 steps (identification, specifications, price and inventory, photos and datasheet)
• Brand with logo, industry (country of origin) with flag and fields with icons
• Warns about duplicate code and missing price
• On creation, offers to link equivalences

### HU-INV-07 · Products

- **Block:** B · Products
- **Role:** Warehouse · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-20a, IN-20b

**Story:** As Warehouse, I want to edit an existing product, so that I can correct or complete its data.

**Acceptance criteria:**

• Same steps as creation with pre-filled data

### HU-INV-08 · Products

- **Block:** B · Products
- **Role:** Warehouse · **Priority:** Should · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-19

**Story:** As Warehouse, I want to duplicate a product, so that I can quickly create similar variants.

**Acceptance criteria:**

• Copies the data and asks for a new code
• Lets me choose the industry (country of origin) of the copy, with its flag

### HU-INV-09 · Products

- **Block:** B · Products
- **Role:** Warehouse / Management · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-18a, IN-18b

**Story:** As Warehouse / Management, I want to deactivate a product or delete it if it has no movements, so that I keep the catalog clean without losing history.

**Acceptance criteria:**

• Deactivating hides it from sales
• Deleting is blocked if it has movements

### HU-INV-10 · Products

- **Block:** F · Excel importer
- **Role:** Warehouse · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-21a, IN-21b
- **Open client decisions:** #33

**Story:** As Warehouse, I want to import products from Excel with a preview, so that I can migrate the current catalog.

**Acceptance criteria:**

• I upload the file
• I review errors and warnings before confirming
• The Import button sits next to Export and has a distinct icon

### HU-INV-11 · Equivalences

- **Block:** D · Equivalences
- **Role:** Warehouse / Sales · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-15a, IN-15b, IN-15f

**Story:** As Warehouse / Sales, I want to consult the equivalence table between brands, so that I know which products are interchangeable.

**Acceptance criteria:**

• List of links
• Empty state with illustration
• Without permission shows read-only mode, with illustration

### HU-INV-12 · Equivalences

- **Block:** D · Equivalences
- **Role:** Sales / Warehouse · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-13

**Story:** As Sales / Warehouse, I want to compare equivalents from different brands side by side, so that I see their technical differences.

**Acceptance criteria:**

• Compares measurements and characteristics
• Highlights what differs

### HU-INV-13 · Equivalences

- **Block:** D · Equivalences
- **Role:** Warehouse · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-15c, IN-15d, IN-15e
- **Open client decisions:** #34

**Story:** As Warehouse, I want to link two products as equivalents with validations, so that I avoid wrong links.

**Acceptance criteria:**

• Warns if the link already exists
• Warns if the measurements are incompatible

### HU-INV-14 · Stock · RETIRED

~~As Warehouse / Management, I want to see stock per branch and the products below the minimum, so that I can restock in time.~~

Do not implement. Retired screens: IN-04, IN-12.

### HU-INV-15 · Stock · RETIRED

~~As Warehouse, I want to define minimums and maximums per product and branch, so that I receive restocking alerts.~~

Do not implement. Retired screens: IN-04c.

### HU-INV-16 · Stock

- **Block:** C · Stock and kardex
- **Role:** Warehouse · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-17

**Story:** As Warehouse, I want to adjust stock from the sheet with a reason, so that I can correct one-off differences.

**Acceptance criteria:**

• Quantity and reason required
• It is recorded in the kardex

### HU-INV-17 · Warehouses

- **Block:** E · Warehouses and transfers
- **Role:** Warehouse / Management · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-14, IN-30a, IN-30b

**Story:** As Warehouse / Management, I want to create and edit each branch's warehouses, so that I can locate the merchandise.

**Acceptance criteria:**

• List of warehouses
• New and edit forms

### HU-INV-18 · Transfers

- **Block:** E · Warehouses and transfers
- **Role:** Warehouse · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-05, IN-06a, IN-06b, IN-06c, IN-06d

**Story:** As Warehouse, I want to create a transfer by searching for products or pasting an Excel list, so that I can move merchandise between branches quickly.

**Acceptance criteria:**

• List of transfers
• Search by code
• Paste list or Excel
• Supports 100 products
• Stock becomes "en tránsito"
• With no products added: empty state with illustration

### HU-INV-21 · Transfers

- **Block:** E · Warehouses and transfers
- **Role:** Warehouse · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-24a, IN-24b, IN-07

**Story:** As Warehouse, I want to follow a transfer and receive it piece by piece recording differences, so that the stock arrives correct.

**Acceptance criteria:**

• In-transit detail
• Receipt per product
• Differences generate a pending adjustment

### HU-INV-22 · Adjustments

- **Block:** C · Stock and kardex
- **Role:** Warehouse · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-27, IN-08

**Story:** As Warehouse, I want to record inventory adjustments with a reason, so that I can correct shrinkage or errors.

**Acceptance criteria:**

• List of adjustments
• New adjustment with reason

### HU-INV-23 · Adjustments

- **Block:** C · Stock and kardex
- **Role:** Management · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-28
- **Open client decisions:** #37

**Story:** As Management, I want to approve adjustments with an audit record, so that I control stock changes.

**Acceptance criteria:**

• Approval with user, date and reason

### HU-INV-24 · Kardex

- **Block:** C · Stock and kardex
- **Role:** Warehouse / Accounting · **Priority:** Must · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** IN-09

**Story:** As Warehouse / Accounting, I want to consult a product's kardex, so that I see inflows, outflows and balances.

**Acceptance criteria:**

• Movements with date, type, quantity and balance

### HU-INV-25 · Inventory count · RETIRED

~~As Warehouse, I want to do physical counts, compare them with the system and close them, so that I keep stock accurate.~~

Do not implement. Retired screens: IN-10, IN-29a, IN-29b, IN-29c, IN-29d.

### HU-INV-26 · Catalog · RETIRED

~~As Warehouse / Management, I want to manage categories, brands and sectors, so that I organize the catalog.~~

Do not implement. Retired screens: IN-11, IN-31a, IN-31b, IN-31c.

### HU-INV-27 · Stock

- **Block:** E · Warehouses and transfers
- **Role:** Warehouse · **Priority:** Should · **Delivery:** Wave 1 (review 9–13 Nov)
- **Screens:** — (no screen of its own)

**Story:** As Warehouse, I want to restock the products below the minimum by generating a transfer, so that I restock without building it by hand.

**Acceptance criteria:**

• Loads the products below the minimum into the transfer
