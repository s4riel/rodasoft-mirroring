# HU-VEN-03 · Equivalents of an out-of-stock product — plan

**Story** (`docs/backlog/sales.md`): As a cashier, I want to see equivalents from other brands when a product is out of stock, so that I do not lose the sale. Screen: VP-03b (Figma `JYULL6jvXiwNP8UVvEF7tl`, node `103:10384`).

**Context**
- **Depends on HU-VEN-02**, which provides the POS page, `rs-pos-result-row` with its Equivalentes button, the POS search, and `POST /sales/pos/checkout/items`. Build it on a branch from `develop` (`feat/hu-ven-03`) after 01 and 02 are merged. It can't run in parallel with them.
- **Most of the logic already exists from HU-INV-12/13:**
  - `Equivalence` with `substitute` and `notes`.
  - `compareEquivalents()` in `libs/domain/src/lib/equivalence.ts` gives each equivalent a kind (`EXACT`, `WITH_DIFFERENCES` or `INCOMPATIBLE`) and its list of differences.
  - `equivalenceApprovalState()` and the `inventory.equivalences.requireApproval` setting.
  - `EquivalencesService.listForProduct()`. It sums stock over all warehouses and also returns links still waiting for approval, so the POS can't use it as it is.
- **What VP-03b shows.** Clicking "Equivalentes" on a row marked "Agotado aquí" opens a panel below that row:
  - The heading "Sin stock de 6208-2RS en Central · equivalentes disponibles".
  - One row per equivalent: code, then "Exacta · 40 × 80 × 18 · SKF" or "Con diferencias · blindaje metálico en vez de sello · FAG", the stock, the price, an eye button and Agregar.
  - A footer line "6208-2RS en otras sucursales: Sacaba 4 uds · Panamericana 2 uds".
  - A "Pedir a Sacaba" button. That button is **HU-VEN-32** (still waiting for design), so this story leaves it out. The eye button is HU-VEN-04.

## Acceptance criteria → checks

| Criterion | Proof |
| --- | --- |
| An out-of-stock product offers "Equivalentes" | `pos.page.spec.ts`: a result with status `out` shows "Agotado aquí" and an "Equivalentes" button instead of Agregar. Clicking it, or pressing Enter when that row is the first result, opens the panel. Clicking again closes it |
| Each equivalent shows how it differs from the original and its stock | `pos-equivalents.int.spec.ts`: the response gives each equivalent its kind, its differences (label, original value, equivalent value), `substitute`, `notes` and the available stock in the register's warehouse. Specs for the panel and the row show "Exacta · d × D × B · Marca" and "Con diferencias · …", the stock, and Agregar adding the equivalent to the cart |

## Model

No changes, and no migration.

## Domain (`libs/domain/src/lib/equivalence.ts`)

- New response types `PosEquivalentItem` and `PosEquivalentsResponse`. The API and the ERP share them.
- A pure function `posEquivalentSummary(kind, differences, notes)` that decides what the row's second line shows:
  - the measurements for `EXACT`
  - the cashier's note, or else up to two difference labels, for `WITH_DIFFERENCES`

  It returns structured data, not Spanish text, and the ERP turns it into the sentence.
- `INCOMPATIBLE` links are never offered at the POS: they aren't equivalents.

## API

**Shared logic in inventory (a small refactor).**
- `EquivalencesService` gets a public method `comparedEquivalents(productId, { approvedOnly })` that returns the linked products with their comparison and no stock.
- `listForProduct()` is rewritten to use it, and its behaviour doesn't change; the existing `equivalences.service.int.spec.ts` must still pass.
- `InventoryModule` starts exporting `EquivalencesService`, and `SalesModule` imports `InventoryModule`.

**New endpoint in `apps/api/src/modules/sales/pos/`:**

| Method · route | Permission | Does |
| --- | --- | --- |
| `GET /sales/pos/products/:id/equivalents` | `sales.pos.use` (+ `requireOpenShift`) | Lists the equivalents of a product, with stock (the full response is below) |

The lists it returns:
- **Equivalents offered:** only active products whose link is approved (`approvedOnly` when `requireApproval` is on) and isn't `INCOMPATIBLE`.
- **Their stock:** each one's available stock (`quantity − reserved`) in my register's warehouse. Only equivalents with stock > 0 are returned (the heading says "disponibles").
- **Order:** exact equivalents first, then by stock, highest first.
- **The original product:** its code and its available stock here.
- **Other branches:** the original's stock in other active branches, as `{ branchName, available }` where available > 0.

Notes:
- **No cost** in the response, and no audit or outbox (it only reads). All queries go through `prisma.tenant`.
- **Error `code`s:**
  - `CASH_SHIFT_NOT_OPEN` (409)
  - `PRODUCT_NOT_FOUND` (404)
- **Adding an equivalent** uses HU-VEN-02's `POST /sales/pos/checkout/items`, including its `INSUFFICIENT_STOCK` check, so there is no new write endpoint.

## ERP screens

**VP-03b, inside `pos.page`:**
- A new `PosEquivalentsPanel`, a feature component in `features/sales/pos/` with separate `.ts`, `.html`, `.scss` and spec. It appears under the out-of-stock `rs-pos-result-row`.
- The heading "Sin stock de {código} en {almacén} · equivalentes disponibles".
- One `rs-pos-result-row` per equivalent, in its nested look:
  - The second line is "Exacta · 40 × 80 × 18 · SKF" or "Con diferencias · {nota o diferencias} · FAG".
  - A substitute shows "Sustituto ·" first.
  - The stock line and Agregar work as in HU-VEN-02.
- The other-branches line "{código} en otras sucursales: Sacaba 4 uds · Panamericana 2 uds", shown only when there is stock elsewhere.
- **States:**
  - loading, as an `rs-skeleton` inside the panel
  - error, with a retry
  - empty: "Ningún equivalente tiene stock en {almacén}", followed by the other-branches line
- Only one panel is open at a time. It closes when the search changes.

**Reusing `rs-pos-result-row`.** If Figma PosResultRow has a nested variant, it is used as it is. If not, the panel adds its own background and padding around the existing row, using tokens only. Either way there is no new `libs/ui` component. The eye button stays hidden (HU-VEN-04).

## Tests

**Unit:**
- `equivalence.spec.ts`: `posEquivalentSummary` for exact, with differences, with a note, and a substitute.
- `pos-equivalents-panel.spec.ts`: rows, summary text, the empty and error states, and Agregar sending the equivalent's `productId`.
- `pos.page.spec.ts`: the button only appears on out-of-stock rows, Enter opens it, and only one panel is open at a time.

**Integration (real Postgres), `pos-equivalents.int.spec.ts`:**
- The link works in both directions (A→B and B→A).
- `INCOMPATIBLE` is excluded.
- A pending link is excluded when `requireApproval` is on and included when it is off.
- Inactive products and equivalents without stock in my warehouse are excluded.
- Stock counts only the register's warehouse, minus `reserved`.
- The other-branches list leaves out my branch and empty branches.
- No `cost`, tenant isolation, and `CASH_SHIFT_NOT_OPEN` without a shift.

**Regression:** `equivalences.service.int.spec.ts` (the inventory equivalents list after the refactor).

**E2E (`apps/erp-e2e/src/pos-equivalents.spec.ts`):** a seeded out-of-stock product with an equivalent → search → Equivalentes → the panel shows "Con diferencias…" and the stock → Agregar → the equivalent is in the cart.

**Agents:** the `stock-auditor` only needs to confirm this story doesn't write stock. Then run `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default

- **#34 (approving equivalences):** the existing setting `inventory.equivalences.requireApproval` decides whether pending links are offered. It is off by default, so every saved link shows.
- **Equivalents with no stock:** hidden, because the heading says "disponibles". No setting for this.

## Risks and doubts

- **"Pedir a Sacaba"** is left out until HU-VEN-32. The other-branches line is information only.
- **The difference text** depends on the data: links without a note fall back to the attribute labels ("Sello: 2RS → 2Z"). This may read worse than in Figma.
- **The refactor of `listForProduct()`** touches inventory code, and the existing integration test guards it.
- **Seed data:** the demo needs an out-of-stock product with an equivalent; the build adds it to the seed if it's missing.

## Files expected to change

- `libs/domain/src/lib/equivalence.ts` (+spec)
- `apps/api/src/modules/inventory/equivalences.service.ts`, `apps/api/src/modules/inventory/inventory.module.ts`
- `apps/api/src/modules/sales/pos/` (new controller route, `pos-equivalents.service.ts`, int spec), `apps/api/src/modules/sales/sales.module.ts`
- `apps/api/prisma/seed*.ts` (only if the demo data is missing)
- `apps/erp/src/app/features/sales/pos/` (`pos-equivalents-panel.*`, `pos.page.*`)
- `apps/erp-e2e/src/pos-equivalents.spec.ts` (new)
