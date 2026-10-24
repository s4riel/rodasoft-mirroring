# Plan · HU-INV-08 · Duplicate a product (IN-19)

## Context
HU-INV-02 already shipped Duplicate from the row menu:
- the IN-19 modal and `POST /inventory/products/:id/duplicate`;
- a required new code (409 `DUPLICATE_MANUFACTURER_CODE`);
- the industry select with its flag (`products.country_id`);
- unit, integration and E2E tests.

So both acceptance criteria are already met. HU-INV-08 closes the remaining gaps (agreed scope):
1. **Copy equivalences:** enable the "Equivalencias" chip. The table exists since HU-INV-04.
2. **After copying:** open `/inventory/products/:id/edit` (HU-INV-07).
3. **Duplicar on the product sheet header** (IN-03), reusing the dialog.
4. **Copy without price → DRAFT** instead of ACTIVE with 0.00, matching HU-INV-06's required price.

**Dependency:** gap 2 needs HU-INV-07's edit route. 07 is uncommitted on `feat/hu-inv-07`, and that branch's modified files overlap this story's API files. Build 08 on `feat/hu-inv-08` after 07 is merged.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| Copies the data and asks for a new code (already met) | Existing tests stay green. New int test: `copy: ['equivalences']` links the copy to every equivalent of the source, with no self-link and canonical pairs |
| Choose the industry with its flag (already met) | Existing dialog spec and E2E |
| Gap: open the edit screen | Dialog spec: on success, navigate to `/inventory/products/{id}/edit` (ACTIVE) or `/inventory/products/{id}/draft` (DRAFT) |
| Gap: Duplicar on the sheet | Sheet spec: the button is shown only with `inventory.products.edit` and opens the dialog with the sheet's product |
| Gap: DRAFT without price | Domain spec: `buildDuplicate` without `price` → `status: 'DRAFT'`; with price → `'ACTIVE'`. Int test: the copy's status, and the audit `after.status` |

## Model
No migration. It reuses `equivalences` (HU-INV-04) and `ProductStatus.DRAFT` (HU-INV-06). Migrations go up to `20261022260000_product_creation_settings_and_drafts`.

## Domain (`libs/domain/src/lib/product-catalog.ts`, plus spec)
- `buildDuplicate` returns `status`: DRAFT when `price` isn't copied, otherwise ACTIVE.
- New pure helper `equivalencePairsForCopy(copyId, equivalentIds)` → canonical `(a<b)` pairs. Reuse HU-INV-04's canonical-pair helper if one exists.
- `DuplicateProductResponse` gets `status`.

## API
- `dto.ts`: add `'equivalences'` to `DUPLICATE_COPY_PARTS`.
- `ProductCommandsService.duplicate`, in the same transaction:
  - when `equivalences` is chosen, read the source's equivalents and `createMany` the pairs for the copy (`skipDuplicates`);
  - status comes from `buildDuplicate`;
  - the audit `inventory.product.duplicate` `after` includes `status` and `equivalenceCount`.
- No new endpoints or error codes. Outbox: publish `inventory.product-created` for the copy, mirroring HU-INV-06's create, only if 06 publishes it.

## ERP screens
- `duplicate-product.dialog.ts`:
  - enable the Equivalencias chip;
  - on success, toast "Copia creada: {sku}" and navigate by `status`.
  - It is now a shared component, used by the list and the sheet.
- **List:** after navigation, no reload is needed.
- **Sheet header:** `product-sheet.page.html` gets "Duplicar" (secondary, copy icon) with `*rsCan="'inventory.products.edit'"`. `product-sheet.page.ts` hosts `<rs-duplicate-product-dialog>`. The dialog's `product` input must accept the sheet's `ProductDetail`; if it is typed as `ProductListItem`, narrow it to a small shared shape.
- No new `libs/ui` components.

## Tests
- **Unit:**
  - domain `buildDuplicate` status and the pairs helper;
  - dialog: equivalences enabled, navigation per status;
  - sheet: Duplicar button by permission, opens the dialog.
- **Integration (real Postgres)** `product-commands.service.int.spec.ts`:
  - equivalences copied, tenant-isolated;
  - DRAFT when no price;
  - concurrency of 2 parallel duplicates with equivalences → one success, one 409, and no orphan pairs.
- **E2E** `products.spec.ts`: sheet → Duplicar → new code + JP + Equivalencias → lands on Editar of the copy → its Equivalentes tab lists the source's equivalents.

## Open decisions used with defaults
- **#32:** the SKU prefix comes from `inventory.skuPrefix` (already configurable).
- **#52:** the attributes are copied from `attribute_definitions`.

## Risks and doubts
- **Overlap with HU-INV-07:** both touch `product-commands.service.ts`, `products.controller.ts` and `product-sheet.page.*`. Build 08 only after 07 is merged.
- **Should the copy also be equivalent to the source?** Not assumed: only the source's equivalents are copied, as the chip says.
- **DRAFT copies** appear in the list per HU-INV-06's draft filter rules.

## Files expected to change
- `libs/domain/src/lib/{product-catalog.ts, product-catalog.spec.ts}`
- `apps/api/src/modules/inventory/{dto.ts, product-commands.service.ts, product-commands.service.int.spec.ts}`
- `apps/erp/src/app/features/inventory/products/{duplicate-product.dialog.*, products.page.*, sheet/product-sheet.page.*}`
- `apps/erp-e2e/src/products.spec.ts`
- `docs/plans/HU-INV-08.md`

## Verification
`pnpm nx affected -t lint typecheck test`, the API integration suite against Postgres, then the Playwright E2E. Compare against IN-19. Run the `reviewer` and `ui-checker` agents on the diff.
