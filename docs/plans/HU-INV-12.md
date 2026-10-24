# Plan · HU-INV-12 · Side-by-side equivalents comparator (IN-13)

## Context
Sales and Warehouse need to see the technical differences between equivalents of different brands at a glance. What already exists:
- **Domain:** `libs/domain/src/lib/equivalence.ts` has `compareEquivalents`, `sameMeasures` (decimal-aware), `EQUIVALENCE_COMPARED_KEYS` and the kind EXACT / WITH_DIFFERENCES / INCOMPATIBLE.
- **API:** `equivalences.controller.ts` serves `GET products/:id/equivalents`, suggestions, candidates and link.
- **ERP:** the product sheet's Equivalentes tab (`products/sheet/equivalents/product-equivalents.tab.*`) uses `rs-doc-table`. The HU-INV-04 plan left row checkboxes for "the HU-INV-12 comparator".

This story adds the comparator: pick 2–4 products from the Equivalentes tab and see them in columns, with the differing rows highlighted.

**Dependencies:** the current branch is `feat/hu-inv-10`; HU-INV-11 is planned and also touches `equivalences.controller.ts`/service and `inventory.routes.ts`. Build on `feat/hu-inv-12` from `main`, after HU-INV-11 merges if possible (or rebase; overlaps are additive).

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| Compares measurements and characteristics | Domain spec `buildEquivalenceComparison`: rows for d, D, B/T (T label for tapered), brand, country, code, then every compared key plus the other attributes defined for the category, each with one value per product. Int test: `GET /inventory/equivalences/compare?ids=a,b,c` returns the columns in the order requested, with real attribute values and labels; tenant-isolated (another company's id → 404). Page spec: renders one column per product and one row per attribute |
| Highlights what differs | Domain spec: a row is `differs: true` when any two values differ ("25" vs "25.000" is equal; missing vs present differs; missing on all is equal). Column `kind` vs the first (reference) product via `compareEquivalents`. Page spec: differing rows get the highlight class and a "Difiere" marker; a "Solo diferencias" toggle hides equal rows; the header shows the "Exacta"/"Con diferencias" pill per column. E2E covers it |

## Model
No migration. Reads products, dimensions, attributes and `attribute_definitions` labels.

## Domain (`libs/domain/src/lib/equivalence.ts`)
- `EQUIVALENCE_COMPARE_MAX = 4` (UI limit, not a client decision) and `EQUIVALENCE_COMPARE_MIN = 2`.
- Pure `buildEquivalenceComparison(products, labels)` → `{ columns: { productId, kind, differences }[], rows: { key, label, group: 'MEASURES' | 'SPECS', values: (string|null)[], differs }[] }`. Measures compared with `Decimal`, the reference column is the first id; reuse `compareEquivalents` for each column's `kind`.
- Types `EquivalenceComparisonColumn`, `EquivalenceComparisonRow`, `EquivalenceComparisonResponse` (column also carries code, brand + flag, total stock, sale price, status, thumbnail).

## API
| Method | Route | Permission | Errors |
|---|---|---|---|
| GET | `/inventory/equivalences/compare?ids=a,b[,c,d]` | `inventory.products.view` | 400 `COMPARE_INVALID_SELECTION` (fewer than 2, more than 4, duplicates), 404 `PRODUCT_NOT_FOUND` |

- `EquivalencesService.compare(ids)` via `prisma.tenant`, loads products with dimensions, attributes and category attribute definitions (labels, order), stock totals with the existing stock-queries helper, then calls the domain builder.
- Products don't need to be linked to each other (allows comparing a candidate before linking, useful for HU-INV-13). INCOMPATIBLE columns are shown with a warning pill.
- Read-only: no audit, no outbox.

## ERP screens
- **Equivalentes tab:** add a selection column (`rs-checkbox`) to the `rs-doc-table` rows (original included), and a "Comparar (n)" `rsButton` enabled with 2–4 selected; a 5th selection is disabled with an `rs-tooltip` "Máximo 4 productos". If `rs-doc-table` has no selectable-row support, add a `selectable` input + `selectionChange` output to it in `libs/ui` (mirrors the Figma table's checkbox variant) rather than a local table.
- **IN-13 route:** `inventory/equivalences/compare?ids=…` (guard `inventory.products.view`), page `equivalences/compare/equivalence-compare.page.*`:
  - `rs-page-header` "Comparar equivalentes" with back link to the origin product;
  - a header row per column: `rs-product-thumb`, code, brand + `rs-flag`, `rs-status-pill` (Referencia / Exacta / Con diferencias / Incompatible), stock and price; a remove (×) action per column (keeps ≥ 2);
  - grouped rows Medidas / Características; differing rows highlighted with tokens (`--color-warning-surface` or the Figma equivalent) plus a text marker for accessibility;
  - `rs-switch` "Solo diferencias"; `rs-skeleton` while loading; `rs-empty-state-illustrated` "error" with Reintentar; the 400 shows an `rs-note` and a link back.
  - Clicking a product header opens its sheet.
- **Components:** reuse the above; the only possible `libs/ui` change is the `rs-doc-table` selection. A comparison grid is a plain CSS grid in the page (no Figma component for it); confirm against IN-13 during the build — if Figma has a "Compare table" component, create it in `libs/ui` instead.

## Tests
- **Unit (domain):** builder — equal/different measures with decimal strings, missing values, tapered T label, attribute ordering, kind per column, 2 and 4 columns.
- **Unit (ERP):** tab selection limits and the Comparar navigation; compare page states (loading, error, invalid selection), highlighting, "Solo diferencias", removing a column updates the query.
- **Integration (real Postgres):** compare returns values and labels, order preserved, validation errors, tenant isolation, 403 without `view`. No stock writes, so no concurrency test.
- **E2E:** product sheet → Equivalentes → select original + 2 equivalents → Comparar → the seeded differing seal row is highlighted → toggle "Solo diferencias" → open a product.

## Open decisions used with defaults
- None. #34 (approval) is not relevant: any products may be compared.

## Risks and doubts
- **Entry point:** assumed only from the product sheet's Equivalentes tab (plus the HU-INV-11 list later, if IN-15a shows checkboxes). Confirm against IN-13 in Figma during the build.
- **Max 4 columns:** assumed from screen width; a constant, not a setting.
- **Which attributes:** all attributes of the category, compared keys first; non-bearing categories only show measures + their own attributes.
- **Row vs pill:** a row also differs on fields `compareEquivalents` does not compare (industry, other category fields), so a column can read "Exacta" while one of its rows is highlighted; the pill tooltip lists only the compared keys.
- Overlap with HU-INV-11 on the equivalences controller/service and routes.

## Files expected to change
- `libs/domain/src/lib/{equivalence.ts, equivalence.spec.ts}`, `libs/domain/src/index.ts`
- `apps/api/src/modules/inventory/{equivalences.controller.ts, equivalences.service.ts, dto.ts, equivalences.int.spec.ts}`
- `apps/erp/src/app/features/inventory/products/sheet/equivalents/product-equivalents.tab.{ts,html,scss,spec.ts}`
- `apps/erp/src/app/features/inventory/{inventory.routes.ts, equivalences/compare/equivalence-compare.page.*, equivalences/equivalences-api.service.ts}`
- possibly `libs/ui/src/lib/doc-table/*` (row selection)
- `apps/erp-e2e/src/equivalence-compare.spec.ts`
- `docs/plans/HU-INV-12.md`

## Verification
`pnpm nx affected -t lint typecheck test`, the API int suite against Postgres, then Playwright. Compare against IN-13 in Figma. Run the `reviewer` and `ui-checker` agents.
