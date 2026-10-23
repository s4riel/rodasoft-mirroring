# Plan · HU-INV-07 · Edit an existing product (IN-20a, IN-20b)

## Context
Warehouse needs to correct or complete a product's data. Today "Editar" (sheet header and row menu) shows the "próximamente" toast. HU-INV-07 reuses the HU-INV-06 creation wizard, pre-filled from the product:
- The title is "Editar {code}" and the subtitle "Editando · Paso N de M · … · los cambios se guardan al final".
- Every step is reachable and shows as completed.
- One "Guardar cambios" button saves everything at the end.

**Agreed scope:**
- **Stock:** the current stock is read-only, with an "Ajustar stock" link. Branch and initial stock can't be edited.
- **Category, subcategory and brand:** editable only while the product has no stock movements.
- **Concurrent edits:** an optimistic lock on `updatedAt` (409 `PRODUCT_MODIFIED`).

**Dependency:** HU-INV-06 (wizard, `validateProductDraft`, settings, storage, `ProductStatus`, uploads, link endpoint) is still in progress on `feat/hu-inv-06` and not merged. Build HU-INV-07 on a new branch `feat/hu-inv-07` cut from `main` after 06 is merged. If 06's wizard API differs from its plan, follow the merged code and update this plan.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| Same steps as creation, pre-filled | Page spec: `/inventory/products/:id/edit` loads the product, builds the same `wizardSteps` (6 for bearings, 4 for others), and every field holds the stored value (code, brand, subcategory, industry, sectors, dimensions, specs, price, cost with the permission, thresholds, location, supplier, tariff code, entry date, photos). E2E: edit 6205-2RS → change the price and a spec → Guardar cambios → the sheet shows the new values |
| Changes are validated like creation | Int test: PATCH with an empty price gives 422 `PRICE_REQUIRED`; a code clash gives 409 `DUPLICATE_MANUFACTURER_CODE`; a bad attribute gives 400 `VALIDATION_FAILED` |
| Stock is not edited here | Int test: PATCH ignores or rejects stock fields (`initialStock` → 400 `FIELD_NOT_EDITABLE`) and writes no `stock_movements`. Page spec: stock is read-only with an "Ajustar stock" link |
| Category, subcategory and brand locked once the product has movements | Int test: changing them on a product with movements gives 409 `PRODUCT_HAS_MOVEMENTS`; on one without movements it works. Page spec: the selects are disabled with the hint "No editable: el producto ya tiene movimientos" |
| Concurrent edit | Int test: two PATCHes with the same `expectedUpdatedAt` → the first succeeds and the second gets 409 `PRODUCT_MODIFIED`. Page spec: a modal with "Recargar" |
| Audit | Int test: `audit_logs` gets `inventory.product.update` with `before` and `after` showing only the changed fields; cost appears only in the audit, never in a response without the permission |

## Model
No migration is planned. Everything needed comes from HU-INV-02, 03, 05 and 06 (`updated_by_id`, `updated_at`, thresholds per warehouse, `sectors`/`tariff_code`/`supplier_name`/`entry_date`). Check after 06 is merged; if a column is missing, stop and report it.

## Domain (`libs/domain/src/lib/product-creation.ts`, plus spec)
- `diffProduct(before, after)` → the changed fields only, for the audit and the PATCH payload.
- `editableFields({ hasMovements, canViewCost })` → which fields can change. Category, subcategory and brand are locked when there are movements; stock and the receiving branch are never editable; cost needs the permission.
- Reuse `validateProductDraft` (final mode) and `wizardSteps` from HU-INV-06.

## API (`apps/api/src/modules/inventory`)
| Method | Route | Permission | Errors |
|---|---|---|---|
| GET | `/inventory/products/:id/edit-model` | `inventory.products.edit` | 404 `PRODUCT_NOT_FOUND` |
| PATCH | `/inventory/products/:id` | `inventory.products.edit` | 400 `VALIDATION_FAILED`/`FIELD_NOT_EDITABLE`, 404, 409 `DUPLICATE_MANUFACTURER_CODE`/`PRODUCT_MODIFIED`/`PRODUCT_HAS_MOVEMENTS`/`NOT_EDITABLE_DRAFT` (drafts use HU-INV-06's draft route), 422 `PRICE_REQUIRED`/`BRAND_NOT_FOUND`/`CATEGORY_NOT_FOUND`/`COUNTRY_NOT_FOUND` |

- **`GET …/edit-model`** returns the wizard input shape:
  - the product fields;
  - the attribute definitions for its category;
  - per-warehouse thresholds;
  - current stock (read-only);
  - `hasMovements` and `updatedAt`;
  - cost only with `inventory.costs.view`.
- **`ProductCommandsService.update(id, dto)`** runs in one `$transaction`:
  1. `SELECT … FOR UPDATE` on the product, and compare `updated_at` with `expectedUpdatedAt` (409 `PRODUCT_MODIFIED`).
  2. Check `editableFields` (looking up whether movements exist).
  3. Run `validateProductDraft`.
  4. Update the product and dimensions, upsert the thresholds per warehouse, and set `updated_by_id`.
  5. Map the P2002 unique error to `DUPLICATE_MANUFACTURER_CODE`.
  6. Audit `inventory.product.update` with the `diffProduct` before and after.
  7. Publish the outbox event `inventory.product-updated`, mirroring HU-INV-06's `product-created`.

  Cost is ignored when the caller lacks the permission.
- No stock writes, so `StockMovementService` is not touched.

## ERP screens
- **Route:** `/inventory/products/:id/edit` → `ProductWizardPage` in `mode: 'edit'`. Reuse HU-INV-06's wizard store and step components, adding a `mode` input or route data.
- **Header:** breadcrumb Inicio / Inventario / Productos / Editar {code}, title "Editar {code}", subtitle "Editando · Paso N de M · {step} · los cambios se guardan al final".
- **Stepper:** every step is clickable and shows as completed (as in IN-20a/b). The progress card shows the required count.
- **Footer:** Cancelar (confirm if dirty) / Atrás / **"Guardar cambios"** (brand, check icon) on every step; no "Guardar borrador".
- **Fields:**
  - stock is read-only, with "Ajustar stock", which shows the toast until HU-INV-16;
  - the receiving branch is hidden;
  - category, subcategory and brand are disabled when `hasMovements`, with the hint above;
  - the code keeps the live availability check, excluding itself.
- **After saving:** toast "Cambios guardados" and navigate to `/inventory/products/:id`.
- **409 `PRODUCT_MODIFIED`:** modal "Otro usuario modificó este producto" with "Recargar". Other errors are shown on their fields.
- **Entry points:** wire "Editar" in the sheet header (HU-INV-03) and in the row menu (`products.page`, HU-INV-02) to the edit route.
- **States:** skeleton, 404, 403 (no `inventory.products.edit` → no-permission empty state) and error with retry.
- **Components:** none new. Everything is reused from HU-INV-06 (Stepper, Field, Input, Select, FilterChip, DataField, Note, Modal, Button, Toast).
- **API errors:** `api-error.ts` gets Spanish messages for `PRODUCT_MODIFIED`, `FIELD_NOT_EDITABLE` and `NOT_EDITABLE_DRAFT`.

## Tests
- **Unit (domain):** `diffProduct` (nested dimensions and attributes, Decimal strings) and `editableFields` (each combination).
- **Unit (erp):** wizard edit mode (pre-fill, all steps reachable, locked fields, cost hidden, footer buttons, the 409 modal, save → navigation) and the entry points from the sheet and the row menu.
- **Integration (real Postgres)** `product-commands.service.int.spec.ts`:
  - update happy path with the audit diff and `updated_by_id`;
  - duplicate code;
  - price required;
  - fields locked when movements exist;
  - `FIELD_NOT_EDITABLE` for stock;
  - **concurrency:** two parallel PATCHes with the same `expectedUpdatedAt` → exactly one 409;
  - cost ignored without the permission;
  - tenant isolation;
  - no `stock_movements` rows created.
- **E2E** `apps/erp-e2e/src/product-edit.spec.ts`:
  1. Sheet → Editar → step 4 → change the price → Guardar cambios → the sheet shows Bs. with the new price.
  2. Row menu → Editar → category disabled on a product with movements.

## Open decisions used with defaults
- **#32:** the required fields are the same as creation (from HU-INV-06's `validateProductDraft`).
- **#38:** the brand logo is optional.
- **#52:** fields come from `attribute_definitions`.

## Risks and doubts
- **Hard dependency on HU-INV-06's wizard:** if its store or step components aren't built for reuse, a small refactor in 06's files is needed, and that touches 06's code.
- **Figma vs. stock:** IN-20b shows "Stock inicial" and the receiving branch as editable; the agreed behavior differs from the frame. The design should be updated.
- **Edit is blocked for drafts** (`NOT_EDITABLE_DRAFT`): drafts stay in the HU-INV-06 draft flow.

## Files expected to change
- `apps/api/src/modules/inventory/{products.controller.ts, dto.ts, product-commands.service.ts, products.service.ts, product-commands.service.int.spec.ts}`
- `apps/api/src/common/outbox/outbox.service.ts` (`inventory.product-updated` type)
- `libs/domain/src/lib/{product-creation.ts, product-creation.spec.ts}`
- `apps/erp/src/app/core/api-error.ts`
- `apps/erp/src/app/features/inventory/{inventory.routes.ts, products/products.page.ts, products/products-api.service.ts, products/wizard/**, products/sheet/product-sheet.page.*}`
- `apps/erp-e2e/src/product-edit.spec.ts`
- `docs/plans/HU-INV-07.md`

## Verification
`pnpm nx affected -t lint typecheck test`, the API integration suite against Postgres, then the Playwright E2E. Visually compare against IN-20a and IN-20b. Run the `reviewer` and `ui-checker` agents on the diff.
