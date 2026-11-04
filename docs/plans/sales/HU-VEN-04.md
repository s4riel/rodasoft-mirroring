# HU-VEN-04 · Bearing technical sheet inside the POS — plan

**Story** (`docs/backlog/sales.md`): As a cashier, I want to see the bearing's technical sheet without leaving the sale, so that I can confirm measurements with the customer. Screen: VP-03e (Figma `JYULL6jvXiwNP8UVvEF7tl`, node `103:10439`).

**Context**
- **It depends on HU-VEN-02 and HU-VEN-03.**
  - From 02: the POS page, the eye button on `rs-pos-result-row` (`showDetail`/`detail`) and `POST /sales/pos/checkout/items`.
  - From 03: `EquivalencesService.comparedEquivalents()` and the `InventoryModule` export.
  - It goes on a branch from `develop` (`feat/hu-ven-04`) after 03 is merged. 03 and 04 both edit `pos.page` and the POS API folder, so they can't run in parallel.
- **What VP-03e shows.** A wide modal over the POS:
  - **Header:** brand chip and name, "País de origen: Suecia", then "6205-2RS · Rodamiento rígido de bolas · sello 2RS · SKU RL-000124", sector chips, and a close button.
  - **Left side:** the photo gallery (main image and thumbnails), and the "Dimensiones" card with the d/D drawing and the d, D and B fields.
  - **Right side, three cards:**
    - "Precio de venta Bs 245,00 · Precio único por empresa · 24 en esta sucursal"
    - "Stock por sucursal", with min and max, each branch with its stock flag, and the total
    - "Equivalencias · 3 referencias de otras marcas", where each row has an Exacta or "Con diferencias" pill
  - **Footer:** "…el costo no se muestra en ventas", an `rs-qty-stepper`, and **"Agregar a la venta"**.
- **Most of this is already built for the inventory product sheet** (HU-INV-03, `features/inventory/products/sheet/product-data.tab`):
  - `ProductsService.detail(id, canViewCosts)` returns `ProductDetail` with dimensions, specs, `stockByBranch` (with min and max), photos and `datasheetUrl`.
  - `rs-image-viewer`, `rs-data-field`, `rs-chip-media`, `rs-flag`, `rs-stock-flag`, `rs-status-pill`, `rs-modal size="wide"` and `rs-qty-stepper` already exist.
  - The d/D drawing is inline SVG inside the inventory tab.
- **Permissions:** `@RequirePermissions` only checks "has all of these". Photos are served by `GET /inventory/files/:kind/:file`, which requires `inventory.products.view`. A role with only `sales.pos.use` would see broken images.

## Acceptance criteria → checks

| Criterion | Proof |
| --- | --- |
| Shows measurements, brand, photos and equivalents | `pos-product-sheet.int.spec.ts`: `GET /sales/pos/products/:id/sheet` returns brand and country, dimensions and specs, photos, stock per branch with min and max, the available stock in my warehouse, and the compatible approved equivalents (kind and stock), with **no `cost` or margin**, even for a user who has `inventory.costs.view`. `pos-product-sheet.dialog.spec.ts` renders each block and the "Exacta"/"Con diferencias" pills |
| I can add it to the sale from the sheet | Dialog spec: "Agregar a la venta" with quantity 2 emits `productId` and 2, and the page calls `POST /checkout/items` and closes the modal. It is disabled when the product is out of stock here, and the stepper's maximum is `maxSellable`. The E2E covers it |

## Model

No changes, and no migration.

## Domain (`libs/domain`)

- A new response type `PosProductSheet` in `product-catalog.ts`. It is the cost-free shape of `ProductDetail`:
  - `ProductDetail` without `pricing.cost` or `marginPercent`, and without the audit actors
  - plus `available` and `stockStatus` (from HU-VEN-02) in my warehouse
  - plus `equivalents: PosEquivalentItem[]` (from HU-VEN-03)
- No new rules.

## API

**New endpoint in `apps/api/src/modules/sales/pos/`:**

| Method · route | Permission | Does |
| --- | --- | --- |
| `GET /sales/pos/products/:id/sheet` | `sales.pos.use` (+ `requireOpenShift`) | `ProductsService.detail(id, false)` (cost always off), plus the available stock in the register's warehouse, plus `comparedEquivalents(id, { approvedOnly })` without `INCOMPATIBLE` and with each one's stock. Unlike HU-VEN-03, **equivalents without stock are included here**: the sheet is for reference, and the "3 referencias" count must match |

Notes:
- **Error `code`s:**
  - `CASH_SHIFT_NOT_OPEN` (409)
  - `PRODUCT_NOT_FOUND` (404), also returned for an inactive product
- `ProductsService` is exported from `InventoryModule`, next to `EquivalencesService`. All queries go through `prisma.tenant`.
- **Photos for POS-only roles.** A new decorator `@RequireAnyPermission(...)` lives next to `RequirePermissions`, read by the same guard: it allows the request if any one of the listed permissions is present. `GET /inventory/files/:kind/:file` changes to `@RequireAnyPermission('inventory.products.view', 'sales.pos.use')`.
  - If HU-VEN-01 already added an "any of" check for its `current` endpoint, this story reuses it.
- It only reads: no audit and no outbox. Adding from the sheet uses the existing items endpoint.

## ERP screens

**VP-03e as `PosProductSheetDialog`**, a feature component in `features/sales/pos/` with separate `.ts`, `.html`, `.scss` and spec:
- It is an `rs-modal size="wide"`. It opens from the eye button on any result row (HU-VEN-02) and on any equivalent row (HU-VEN-03).
- **Header:** `rs-chip-media` (brand), "País de origen: …" with `rs-flag`, then code · name · SKU, sector chips, and close. Esc also closes it.
- **Left side:**
  - The photo gallery (main photo, thumbnails, and a click opens `rs-image-viewer`). With no photos it shows the placeholder.
  - The "Dimensiones" card, with the d/D drawing and `rs-data-field` for d, D, B and weight, followed by the specs.
  - A "Ficha técnica" link when there is a `datasheetUrl`.
- **Right side:**
  - Price card: "Precio de venta", "Precio único por empresa · {n} en esta sucursal".
  - "Stock por sucursal": rows with `rs-stock-flag` (low or out), "Mínimo · máximo", and the total. The register's branch is highlighted.
  - "Equivalencias": "{n} referencias de otras marcas", then rows with the brand chip, code and an `rs-status-pill` (Exacta in green, Con diferencias in amber). Clicking a row opens that product's sheet in the same modal, with a "Volver" back step.
- **Footer:** "el costo no se muestra en ventas", `rs-qty-stepper` (maximum `maxSellable`), and "Agregar a la venta". The button is disabled and reads "Agotado aquí" when the product has no stock here.
- **States:** loading as `rs-skeleton` blocks, error with a retry, and 404 shown as "Producto no disponible".
- **Shortcut:** with a result highlighted, `Space` opens its sheet. This is added to the shortcut footer.

**Reuse without copying from inventory:**
- The d/D drawing moves out of `product-data.tab.html` into a new `libs/ui` **`rs-bearing-diagram`** component (inputs: outer and inner diameter). The inventory tab and the POS sheet both use it. The ui-checker must confirm the Figma name: if Figma has no master for it, it is marked "not in Figma: estimated" in `docs/ui-library.md`, like `ImageViewer`.
- The format helpers (`formatMillimeters`, `formatMoney`, `specValue`, `toSpecField`) are imported from the inventory `product-sheet.mapper.ts`. If the lint boundary rules forbid that import, they move to a shared `features/shared/product-format.ts`.

## Tests

**Unit:**
- `pos-product-sheet.dialog.spec.ts`:
  - Each block, and the states with no photos, no dimensions and no equivalents.
  - Add with quantity, and disabled when out of stock.
  - Opening an equivalent and going back with "Volver".
  - Esc closes it.
- `bearing-diagram.component.spec.ts`.
- `pos.page.spec.ts`: the eye button and `Space` open the sheet, and adding from the sheet updates the cart and the total.
- Regression: `product-sheet.page.spec.ts` still renders the drawing.

**Integration (real Postgres):**
- `pos-product-sheet.int.spec.ts`:
  - The fields are present, and there is no cost even with `inventory.costs.view`.
  - Available stock in my warehouse, and stock per branch with min and max.
  - Equivalents include those without stock and leave out `INCOMPATIBLE` ones and pending links when `requireApproval` is on.
  - An inactive product gives 404, plus tenant isolation and `CASH_SHIFT_NOT_OPEN`.
- `uploads.controller.spec.ts`: `sales.pos.use` alone can read a photo, while a user with neither permission gets 403.

**E2E (`apps/erp-e2e/src/pos-product-sheet.spec.ts`):** search "6205" → eye → the sheet shows "Dimensiones" and "Stock por sucursal" → quantity 2 → "Agregar a la venta" → the modal closes and the cart line has 2.

**Agents:** the `stock-auditor` only needs to confirm nothing writes stock, and the `ui-checker` reviews the dialog and `rs-bearing-diagram`. Then run `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default

- **#34 (approving equivalences):** pending links stay hidden only when `inventory.equivalences.requireApproval` is on, as in HU-VEN-03.
- **Cost:** never shown at the POS, whatever the role, as the Figma footer says. It is fixed in the endpoint, not a setting, because sales roles must not get costs (`docs/sales/design-notes.md`).

## Risks and doubts

- **`rs-bearing-diagram` may not exist in the Design System.** If so it is documented as estimated, rather than leaving a copy in each feature.
- **Opening the file endpoint to `sales.pos.use`** widens who can read product photos and datasheets. These files aren't sensitive, but the change touches inventory code.
- **Moving the drawing** edits the inventory product sheet, and its spec guards it.
- **"Precio único por empresa"** is correct while there is a single price per company (design notes). If price lists ever appear, this text changes.

## Files expected to change

- `libs/domain/src/lib/product-catalog.ts`
- `libs/ui/src/lib/bearing-diagram/**` (new), `libs/ui/src/index.ts`, `docs/ui-library.md`, `apps/erp/src/app/features/design-system/**`
- `apps/api/src/modules/access/require-permissions.decorator.ts` and its guard (unless HU-VEN-01 already did this)
- `apps/api/src/modules/inventory/uploads.controller.ts` (+spec), `apps/api/src/modules/inventory/inventory.module.ts`
- `apps/api/src/modules/sales/pos/` (controller route, `pos-product-sheet.service.ts`, int spec)
- `apps/erp/src/app/features/inventory/products/sheet/product-data.tab.html` / `.scss` (use the drawing component)
- `apps/erp/src/app/features/sales/pos/` (`pos-product-sheet.dialog.*`, `pos.page.*`)
- `apps/erp-e2e/src/pos-product-sheet.spec.ts` (new)
