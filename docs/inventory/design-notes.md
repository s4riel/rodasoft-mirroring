# Inventory · design notes and business rules

Summary of the project's design documents (Figma + analysis). Use it as context before `/story`.
Code in English, UI texts in Spanish (see `docs/naming-conventions.md`).

## Scope

- Active: HU-INV-01 to 13, 16 to 24 and 27. Retired: 14, 15, 25, 26 (no Stock, Counts or Catalog tabs).
- No barcode scanners (client decision): search is by keyboard.
- Rodalaser sells more than bearings: the catalog has categories and subcategories, and product creation adapts to the category.
- A single price per product and company. Cost and margin are only visible to Management and Accounting (Sales does not see them).
- Stock per warehouse; each branch has one or several warehouses.

## Proposed data model (block A)

Plural snake_case tables, all with `company_id` (add them to `TENANT_MODELS`). Money `Decimal(14,2)`, costs `Decimal(14,4)`.

| Table | Key fields |
|---|---|
| `countries` | `code` (ISO, e.g. SE), `name`; used as "industry" (country of origin) |
| `brands` | `name`, `countryCode`, `logoUrl?`, `status` |
| `categories` | `name`, `parentId?` (subcategory), `icon`, `sortOrder`, `status` |
| `attribute_definitions` | `categoryId`, `key`, `label`, `type` (TEXT, NUMBER, ENUM, BOOLEAN), `unit?`, `options?`, `required`, `step` |
| `products` | `sku`, `manufacturerCode` (unique per brand and company), `brandId`, `categoryId`, `name`, `salePrice`, `cost?`, `unit`, `status`, `attributes` (JSONB validated with `attribute_definitions`), `photos`, `datasheetUrl?` |
| `product_dimensions` (or inside `attributes`) | `innerDiameter` d, `outerDiameter` D, `width` B, `weight`; indexed for equivalence search |
| `stock_levels` | `productId`, `warehouseId`, `quantity`, `reserved`; unique per (product, warehouse) |
| `stock_thresholds` | `productId`, `branchId`, `minStock`, `maxStock`, `location?` |
| `stock_movements` | **immutable**: `productId`, `warehouseId`, `type`, `quantity` (signed), `balanceAfter`, `unitCost?`, `reason`, `refType`, `refId`, `userId`, `createdAt` |
| `stock_adjustments` | `status`, `reason`, `approvedBy?`, lines |
| `transfers` + `transfer_items` | `status` (`TransferStatus`), origin, destination, lines with sent and received quantities, differences |
| `equivalences` | pair (`productAId`, `productBId`), `kind` (EXACT, WITH_DIFFERENCES), `differences` JSON, `approvedBy?` |
| `import_jobs` + `import_rows` | file, status, row, per-row error |

### Integrity rules

1. **Every stock change goes through a single movements service** (`StockMovementService`). No other code writes `stock_levels`.
2. The movement and the level update happen in **one transaction**, with row locking (`SELECT ... FOR UPDATE`) to avoid race conditions. Negative stock is not allowed unless configured.
3. `stock_movements` is never edited or deleted; corrections are new movements.
4. A product with movements is not deleted, only deactivated (HU-INV-09).
5. The manufacturer code is unique per brand and company (error `DUPLICATE_MANUFACTURER_CODE`).
6. Transfer state changes only through `transferMachine` and are audited with `AuditService`.
7. Side effects (future journal entries, notifications) through `OutboxService.publish(..., { tx })`.

## Permissions (keys in `libs/domain/src/lib/permissions.ts`)

Convention `<module>.<resource>.<action>`: `inventory.products.view|create|edit|deactivate|delete|import|export`, `inventory.cost.view`, `inventory.stock.adjust`, `inventory.adjustments.approve`, `inventory.transfers.create|approve|receive`, `inventory.equivalences.link|approve`, `inventory.warehouses.manage`, `inventory.kardex.view`.
Per role: Management full; Sales sees the product sheet without cost or margin; Warehouse operates everything except approving; Accounting is read-only (includes cost).

## Product creation (HU-INV-06)

1. Choose the **category** (cards), then the **subcategory** and **industry** (country) in step 1; the subcategory defines the fields of step 2.
2. **Bearings: 6 steps** — Identification (req.), Dimensions (req.), Technical specifications (opt.), Price and inventory (req.), Photos and datasheet (opt.), Equivalences and review (opt.).
3. **Other categories: 4 steps** — Identification, Specifications, Price and inventory, Photos and datasheet.
4. Save draft always available; progress counts only required steps; "Omitir este paso" on optional ones.
5. Short-option fields (seal, clearance, rows, sectors) are chips, not lists.
6. Cost visible only with `inventory.cost.view`.
7. On creation: initial stock in the receiving branch, 3 suggested equivalents and a "Vincular equivalencias" button.

Bearing fields: d, D, B, weight, series, minimum radius r, bore type; seal, internal radial clearance, rows, materials, tolerance class, dynamic load C and static load C₀, limiting speed, temperatures, lubricant.

## Equivalences (HU-INV-04, 11, 12, 13)

- Equivalent only if **d × D × B and the type** match. Then seal, internal clearance, tolerance, cage and load capacity are compared: if anything differs the link is "With differences" and what differs is shown.
- Tapered bearings use T instead of B.
- Validations when linking: do not link a product to itself, do not duplicate the pair, compatible measurements (warn if not).
- The comparator shows the differences side by side.

## Transfers (HU-INV-18 to 21, 27)

Four ways to add products: (1) search by code, brand or measurement, with stock at origin and Enter to add the first result; (2) **paste list** `code, quantity` (comma, tab or semicolon separator); (3) import Excel/CSV with the same two columns; (4) restock below minimum (suggested quantity up to the maximum).

Paste or import: the system **reads first** and shows recognized, not found and insufficient-stock items; the correct ones go in and the rest are flagged.

List rules (up to 100+ products): paginated by 10, internal search, edits preserved across pages, summary (products, pieces, value, errors), filters All / With error / Unchanged, errors flagged on the row, **cannot be sent with errors** (except decision #35), save draft, and if it exceeds the limit the button becomes "Enviar para aprobación".

Flow: `DRAFT → PENDING_APPROVAL → APPROVED → IN_TRANSIT → PARTIALLY_RECEIVED → RECEIVED` (plus `REJECTED`, `CANCELLED`). On dispatch stock leaves the origin (movement); on receipt it enters the destination piece by piece, recording differences.

## Adjustments and kardex (HU-INV-16, 22, 23, 24)

- Adjustment = movement with a **mandatory reason** (reason catalog: shrinkage, count error, damage, other). Above the limit it goes through approval (Management) and is audited.
- Kardex per product: inflows, outflows and balance, filterable by warehouse and dates; the final balance must match `stock_levels`.

## Excel importer (HU-INV-10)

Upload file → row-by-row **preview** (valid / with error) → confirm only the valid ones → downloadable error report. Nonexistent brand = error (decision #33). Idempotent by manufacturer code + brand (updates or creates depending on the chosen option).

## Screen states

Every screen has loading (skeleton), empty (illustration and action), error and no-permission states. Empty catalog (first use) and no results with "Limpiar filtros".

## Required tests

- Domain and services: unit.
- **Stock, transfers and adjustments: integration with real Postgres**, including concurrency (two simultaneous deductions leave no negative stock and lose no movements).
- Playwright E2E: product creation, transfer with paste list and approval, adjustment with approval.
