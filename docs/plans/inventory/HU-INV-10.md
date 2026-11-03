# Plan · HU-INV-10 · Import products from Excel with a preview (IN-21a, IN-21b)

## Context
Warehouse needs to migrate the current catalog from Excel. The list header already has an "Importar" button (`import` icon, `inventory.products.import`), but it only calls `comingSoon()`. The permission `inventory.products.import` already exists, and so do `rs-file-dropzone` and `rs-file-item` in `libs/ui`. `uploads.controller.ts` already shows the multer `FileInterceptor` pattern, with memory storage and a `FILE_TOO_LARGE` error. There is no Excel library yet.

The flow follows the design notes:
1. Upload the file.
2. Preview it row by row, each row valid or with an error, plus warnings.
3. Confirm, which imports only the valid rows.
4. Download an error report.

The import is idempotent by manufacturer code + brand. An unknown brand is an error (decision #33).

**Dependencies:** HU-INV-09's plan is approved but not built yet. Both stories touch `products.page.*`, `api-error.ts` and `products.controller.ts`. Build 10 on `feat/hu-inv-10` from `main` after 09 is merged, or build them one after the other.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| I upload the file | API int test: `POST /inventory/products/import/preview` with a multipart .xlsx returns parsed rows. A wrong type gets 415 `UNSUPPORTED_FILE_TYPE`, more than 5 MB gets 413 `FILE_TOO_LARGE`, and a missing header gets 422 `IMPORT_INVALID_TEMPLATE`. Dialog spec: the dropzone accepts .xlsx only |
| I review errors and warnings before confirming | Domain spec for `validateImportRow`: brand not found (#33), category not found, missing required fields per #32, invalid price, duplicate within the file (error), existing product (a warning in update mode, an error in create-only mode). IN-21b spec: summary counters, the All / Con error / Con advertencia filters, and Confirmar disabled when there are 0 valid rows. E2E: errors are shown before anything is written to the DB |
| The Import button sits next to Export with a distinct icon | Page spec: Importar comes right before Exportar with the `import` icon (already in the HTML) and is wired to the dialog |

## Model
No migration and no new table, because the import is **stateless**:
- `preview` parses and validates the file and returns the rows;
- `commit` receives the same file plus the chosen mode, validates again on the server, and writes in a single transaction.

This avoids an import-batch table and the cleanup it would need. It reuses `products`, `product_dimensions`, `brands`, `categories` and `attribute_definitions`.

## Domain (`libs/domain/src/lib/product-import.ts` + spec)
- `IMPORT_COLUMNS`: Spanish headers mapped to fields. The template is: Código, Marca, Categoría, Subcategoría, Descripción, Precio, d, D, B, then attribute columns by `attribute_definitions.key`.
- `validateImportRow(row, lookups, mode)` returns `{ status: 'valid' | 'error', errors[], warnings[], action: 'create' | 'update' | 'skip' }`. It reuses the required-field rules of HU-INV-06's product-write validation and the `Decimal` price parsing.
- `ImportMode = 'create_only' | 'create_or_update'`.
- **Stock columns:** one column per active warehouse, `Stock <código almacén>` (an integer ≥ 0, blank = don't touch), plus an optional `Costo unitario` (a `Decimal`). The values are the **on-hand quantity to set**, not an amount to add. The template builds these columns from the tenant's warehouses.
- `planStockChanges(target, current)` returns one movement per warehouse:
  - no level yet (or 0 with no history) → `INITIAL` with +target;
  - an existing level → `ADJUSTMENT_IN` or `ADJUSTMENT_OUT` for the difference, with a row warning "Ajustará el stock de X a Y";
  - the same quantity → no movement.
- Errors: a warehouse column that doesn't exist or is inactive (`Almacén no existe / inactivo`), a negative or decimal quantity, and stock on a row whose product would be skipped.
- The counters add the pieces to import and their value (cost × qty).
- Response types: `ImportPreviewResponse` and `ImportCommitResponse`.

## API (`apps/api/src/modules/inventory/product-import.{controller,service}.ts`)
| Method | Route | Permission | Errors |
|---|---|---|---|
| GET | `/inventory/products/import/template` | `inventory.products.import` | — (an .xlsx with the headers and an example row) |
| POST | `/inventory/products/import/preview` (multipart `file`, `mode`) | `inventory.products.import` | 415 `UNSUPPORTED_FILE_TYPE`, 413 `FILE_TOO_LARGE`, 422 `IMPORT_INVALID_TEMPLATE`, 422 `IMPORT_TOO_MANY_ROWS` |
| POST | `/inventory/products/import/commit` (multipart `file`, `mode`) | `inventory.products.import` + `inventory.products.edit` | same errors |
| POST | `/inventory/products/import/error-report` (multipart `file`, `mode`) | `inventory.products.import` | returns an .xlsx with the rows that have errors and an "Errores" column |

- Parse with **`exceljs`** (new dependency, MIT, streams large files). Only the first sheet is read, header row 1.
- Brands and categories are looked up by name, case- and accent-insensitive, within the tenant through `prisma.tenant`. The brand is never auto-created (#33).
- Commit runs in one `$transaction`:
  1. Re-validate on the server.
  2. Create rows through the existing `ProductCommandsService` create path, with the SKU from `inventory.skuPrefix`; in update mode, run update. Skip rows with errors.
  3. Lock the existing products by (brand, code) with `FOR UPDATE`, so two concurrent imports never create a product twice. The unique key (`DUPLICATE_MANUFACTURER_CODE`) is the backstop.
  4. **Stock:** for each planned change, call the existing `StockMovementService.apply(tx, …)` (`stock-movement.service.ts`), which is the only writer of `stock_levels` and `stock_movements`. It locks the level `FOR UPDATE` and checks for an inactive warehouse. Each call passes:
     - `type` INITIAL or ADJUSTMENT_IN / ADJUSTMENT_OUT;
     - `reason: 'Importación Excel'`, `refType: 'IMPORT'`, `refNumber` = the file name;
     - `unitCost` from the column.
     The difference is recomputed **inside the lock** from the current quantity, so a sale made between preview and commit is not overwritten.
  5. Any `apply` error rolls back the whole commit, so stock and products always stay consistent.
- Commit needs `inventory.stock.adjust` (or the existing adjustments key) when the file has stock columns; otherwise it returns 403 `MISSING_PERMISSION` with the row count. Check the exact key in `permissions.ts` during the build.
- One audit entry `inventory.product.import` with the counts and file name, plus one audit entry per created or updated product (the same actions as the existing create and update). The outbox publishes `inventory.product-created` / `-updated` per product, the same events as create and update.
- The row limit is configurable: setting `inventory.import.maxRows`, default 2000 (in the settings seed).

## ERP screens
- **`products.page`:** Importar opens `rs-import-products-dialog` instead of `comingSoon()`.
- **IN-21a, upload (Modal):**
  - `rs-file-dropzone` (accept .xlsx) and `rs-file-item`;
  - a link "Descargar plantilla";
  - a mode choice with `rs-radio-card`: "Solo crear nuevos" (default) or "Crear y actualizar existentes";
  - a "Revisar" button.
- **IN-21b, preview (Modal, wide):**
  - summary counters with `rs-kpi-card`: Válidas, Con error, Con advertencia, Nuevas, A actualizar;
  - filter chips;
  - the rows in `rs-doc-table`, with row number, code, brand, an `rs-status-pill` and the messages, paginated by 10 with `rs-pagination`;
  - a `rs-note` saying "Solo se importarán las filas válidas";
  - buttons "Descargar errores" and "Importar N productos".
- **After import:** toast "N productos importados (M omitidos)" and reload the list.
- **`api-error.ts`:** Spanish messages for the new codes.
- **Components:** no new `libs/ui` components are needed.

## Tests
- **Unit:**
  - domain `validateImportRow` for every rule and mode, and the header mapping;
  - the parser service with fixture .xlsx files built with exceljs in the spec;
  - the dialog's two steps;
  - the page button wiring.
- **Integration (real Postgres):**
  - preview writes nothing;
  - commit creates only the valid rows, with SKUs, audit and outbox;
  - update mode updates by (brand, code);
  - re-running the same file in create-only mode creates nothing (idempotent);
  - tenant isolation: a brand of another company counts as "Marca no existe";
  - **concurrency:** two parallel commits of the same file create every product exactly once.
  - **stock:**
    - a new product gets an INITIAL movement and a matching `stock_levels` row;
    - an existing level is adjusted to the target, and the kardex balance equals the level;
    - re-importing the same quantities creates no movements;
    - a commit racing a sale on the same product and warehouse ends at the target with no lost movement;
    - an inactive warehouse is a row error;
    - a failure rolls back both the products and the stock.
- **E2E:** Productos → Importar → upload a fixture → see the errors and warnings → Importar → toast → the products appear in the list.

## Open decisions used with defaults
- **#33:** an unknown brand is a row error "Marca no existe", and the brand is never created. Configurable via setting `inventory.import.createMissingBrands` (default `false`). The setting is read but `true` is not implemented yet; if enabled, it is rejected with 409 `NOT_SUPPORTED` until the client decides.
- **#32:** the required fields and the single unit come from the existing HU-INV-06 settings.

## Risks and doubts
- **Stateless commit** re-sends the file, which is fine up to 5 MB and 2000 rows. Larger catalogs would need a stored batch and a background job, which is out of scope.
- **Template columns:** the IN-21a and IN-21b texts and columns must be checked against Figma during the build.
- **Stock adjustments on update:** setting an existing product's stock through the import creates an adjustment without the approval threshold of HU-INV-23. This is acceptable for the initial migration; to be revisited when HU-INV-23 lands.
- **New dependency `exceljs`:** confirm it is acceptable.

## Files expected to change
- `package.json`, `pnpm-lock.yaml` (`exceljs`)
- `libs/domain/src/lib/{product-import.ts, product-import.spec.ts, index.ts}`
- `apps/api/src/modules/inventory/{inventory.module.ts, product-import.controller.ts, product-import.service.ts, product-import.service.spec.ts, product-import.int.spec.ts}`
- `apps/api/prisma/seed` (setting defaults)
- `apps/api/src/modules/inventory/stock-movement.service.ts` (read-only reuse; touch it only if `refType 'IMPORT'` needs registering)
- `apps/erp/src/app/core/api-error.ts`
- `apps/erp/src/app/features/inventory/products/{products.page.*, products-api.service.ts, import/import-products.dialog.*}`
- `apps/erp-e2e/src/{products-import.spec.ts, fixtures/products-import.xlsx}`
- `docs/plans/HU-INV-10.md`

## Verification
Run `pnpm nx affected -t lint typecheck test`, then the API integration suite against Postgres, then the Playwright E2E. Compare against IN-21a and IN-21b. Run the `reviewer` and `ui-checker` agents on the diff.
