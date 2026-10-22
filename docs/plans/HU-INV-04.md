# Plan · HU-INV-04 · Equivalents tab on the product sheet (IN-02b)

## Context
Sales and Warehouse need to offer reliable alternatives: on the product sheet, the **Equivalentes** tab (IN-02b, Figma `262:49353`) lists the equivalent products of other brands, flagging what differs from the original.
- HU-INV-03 (in progress on `feat/hu-inv-03`) builds the sheet with this tab as a "próximamente" placeholder, the KPI "Equivalentes" and a hidden Equivalencias card.
- HU-INV-04 adds the `equivalences` model, the comparison rule, the endpoint, and the real tab and card.
- Creating links is HU-INV-13. Until then, links come from the seed.

**Agreed scope:**
- Differences are **computed on read** by a pure domain function; the table stores only the pair.
- **Direct links only**, no transitivity.
- No row checkboxes; they arrive with the HU-INV-12 comparator.

**Dependency:** build after HU-INV-03 is merged (sheet page, tabs, `rs-kpi-card`, `rs-stock-flag`, the bearing `attribute_definitions` seed). The migration must be generated after `20261022201126_product_sheet_thresholds_and_authorship`.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| Equivalents tab | E2E: on 6205-2RS → tab "Equivalentes" → table "Equivalentes por marca" with the original row, the seeded NSK/FAG rows, and a Total row = sum of stock. Page spec: loading, empty (illustrated "Sin equivalentes registrados") and error states |
| Each equivalent flags its differences | Domain spec `compareEquivalents`: same d×D×B, type and specs → EXACT. A differing seal or cage → WITH_DIFFERENCES listing `{key,label,source,other}`. Different d×D×B or type → INCOMPATIBLE. T is used for tapered bearings. Int test: the endpoint returns the differences against the real attributes. Page spec: an amber pill with the first difference and a tooltip with all of them; "Exacta" success pill; "Original" neutral pill |

## Model
Migration **`product_equivalences`**:
- `Equivalence` → table `equivalences`:
  - `id`, `company_id`, `product_a_id`, `product_b_id`;
  - `created_by_id?` and `approved_by_id?` → users, with `approved_at?` (for decision #34, unused until HU-INV-13);
  - `created_at`.
- `@@unique([companyId, productAId, productBId])`, `@@index([companyId, productBId])`.
- SQL `CHECK (product_a_id < product_b_id)`: canonical ordering, which also forbids self-links and stops a duplicate pair in reverse order. The service normalizes the pair.
- FKs to products `ON DELETE CASCADE`.
- Add `Equivalence` to `TENANT_MODELS`. No `kind` or `differences` columns, because they are computed.
- Seed: link the demo bearings with the same d×D×B across brands (e.g. 6205-2RS SKF ↔ 6205-DDU NSK ↔ 6205-2Z FAG, as direct pairs from the SKF one), so the seal and cage differences show.

## Domain (`libs/domain/src/lib/equivalence.ts`, plus spec, exported from the index)
- `EquivalenceKind = 'EXACT' | 'WITH_DIFFERENCES' | 'INCOMPATIBLE'`.
- `EQUIVALENCE_COMPARED_KEYS = ['seal', 'internalClearance', 'toleranceClass', 'cage', 'dynamicLoad', 'staticLoad']`, matching the keys seeded by HU-INV-03.
- Pure `compareEquivalents(source, other)`. Inputs are `{ subcategoryId, dimensions: {d, D, B}, attributes, labels }`. Output is `{ kind, differences: { key; label; source; other }[] }`.
  - Dimensions are compared as decimal strings, not floats.
  - INCOMPATIBLE when the type (subcategory) or d×D×B differ. HU-INV-13 reuses this to warn.
- `normalizePair(a, b)` → `[min, max]`.
- Response types: `ProductEquivalentItem { productId, manufacturerCode, brand, country, totalStock, salePrice, status, kind, differences }` and `ProductEquivalentsResponse { source: ProductEquivalentItem; items; total; page; pageSize; brandCount }`.

## API (`apps/api/src/modules/inventory`)
| Method | Route | Permission | Errors |
|---|---|---|---|
| GET | `/inventory/products/:id/equivalents?page&pageSize` | `inventory.products.view` | 404 `PRODUCT_NOT_FOUND`, 400 `INVALID_ID` / `INVALID_FILTER` |

- New read service `EquivalencesService.listForProduct(id, page)`:
  - Through `prisma.tenant`, find the links where the product is A or B, and load the other side with brand, country, subcategory, dimensions and attributes.
  - Total stock comes from a `stockLevel.groupBy`, as in `ProductsService.list`.
  - Labels come from `attribute_definitions`.
  - Paginate with `clampPage` and `clampPageSize`. Ordering: EXACT first, then by brand name.
- `brandCount` = distinct brands among the equivalents. It feeds the sheet KPI ("2 marcas").
- Read-only: no audit, no outbox. Cost is never exposed.
- Register it in `inventory.module.ts`. It can live in a new `equivalences.controller.ts`, so HU-INV-11 and 13 extend it.

## ERP screens
- **IN-02b:** replace the HU-INV-03 placeholder child route `equivalents` with `ProductEquivalentsTab` (`features/inventory/products/sheet/equivalents/…`). It contains:
  - "Equivalentes por marca" with a table: Código (mono), Marca (brand media + flag), Stock (with `rs-stock-flag`), Precio (Bs), Diferencia (pill);
  - a footer "Total · N códigos" with summed stock;
  - `rs-pagination` and the range label "1–3 de 3 registros".
- **IN-02a update:** show the HU-INV-03 Equivalencias card. It shows the first 3 items with pills and "Ver todas las equivalencias", which links to the tab. The KPI "Equivalentes" shows "N marcas" and "x exacta · y con diferencias".
- Components: Tabs, Pagination, StatusPill (success "Exacta", warning for differences, neutral "Original", danger "Medidas distintas"), Tooltip (full difference list), Flag/FieldMedia, StockFlag, KpiCard, EmptyStateIllustrated, Skeleton.
- **Table component:** `ProductTable` is tied to the list's columns and row menu, so it can't be reused here. Implement the Figma **`DocTable`** (listed as "not started" in `docs/ui-library.md`) as `rs-doc-table`. It is a generic table with column definitions, cell templates, a footer row and the same header and row tokens as ProductTable. During the build, read the Figma component first. If IN-02b uses a different component, implement that one instead. Add a showcase entry and update the Status table.

## Tests
- **Unit (domain):** `compareEquivalents` covers exact, each compared key differing, missing attribute on one side (counts as a difference: "— vs 2RS"), different d×D×B, different type, tapered width and decimal strings ("25" vs "25.000"). Also `normalizePair`.
- **Unit (ui):** `doc-table` spec (columns, templates, footer, empty).
- **Unit (erp):** tab spec (states, pills, tooltip text, total) and sheet card and KPI spec.
- **Integration (real Postgres)** `equivalences.service.int.spec.ts`:
  - links found from both A and B;
  - tenant isolation;
  - the CHECK constraint rejects a self-link or a reversed duplicate;
  - cascade on product delete (HU-INV-02's delete still works);
  - differences computed from real attributes;
  - pagination and `brandCount`.

  There are no stock writes, so no concurrency test.
- **E2E** `apps/erp-e2e/src/product-equivalents.spec.ts`: list → Ver detalles 6205-2RS → card shows the equivalents → "Ver todas las equivalencias" → tab with NSK "Sello…" and FAG "Jaula…" pills and the total stock.

## Open decisions used with defaults
- #34 (who approves links): `approved_by_id`/`approved_at` columns exist but nothing sets them here. Approval stays optional, as decided, and the behavior belongs to HU-INV-13.
- #52: the compared keys are the bearing attributes seeded by HU-INV-03. Other categories have no compared specs yet, so only type and dimensions are checked for them. This is noted as a known limit.

## Risks and doubts
- **Compared keys:** `EQUIVALENCE_COMPARED_KEYS` is a domain constant (a business rule from design-notes), not a per-company setting. If the client wants it configurable per category, add an `attribute_definitions.compare_for_equivalence` flag later.
- **Dependency on HU-INV-03:** if 03's attribute keys or sheet structure change before merge, this plan's keys and file paths must follow.
- **`rs-doc-table` scope:** it is a new generic `libs/ui` component, which is the largest UI piece here. If the Figma DocTable differs a lot from IN-02b's table, raise it during the build.

## Files expected to change
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_product_equivalences/`, `apps/api/prisma/seed-catalog.ts`
- `apps/api/src/common/prisma/tenant.extension.ts` (`Equivalence`)
- `apps/api/src/modules/inventory/{inventory.module.ts, equivalences.controller.ts, equivalences.service.ts, equivalences.service.int.spec.ts}`
- `libs/domain/src/lib/{equivalence.ts, equivalence.spec.ts}`, `libs/domain/src/index.ts`
- `libs/ui/src/lib/doc-table/*`, `libs/ui/src/lib/erp-components.ts`, `docs/ui-library.md`, `apps/erp/src/app/features/design-system/sections/*`
- `apps/erp/src/app/features/inventory/{inventory.routes.ts, products/products-api.service.ts, products/sheet/**}` (tab, card and KPI)
- `apps/erp-e2e/src/product-equivalents.spec.ts`
- `docs/plans/HU-INV-04.md` (after approval)

## Verification
`pnpm nx affected -t lint typecheck test`, the API integration suite against Postgres, `pnpm db:seed`, then the Playwright E2E. Visually compare the tab with IN-02b and `rs-doc-table` in `/design-system` with Figma.
