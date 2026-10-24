# Plan · HU-INV-11 · Equivalence table between brands (IN-15a, IN-15b, IN-15f)

## Context
Warehouse and Sales need one place to see which products are interchangeable across brands. What already exists:
- **Model:** the `equivalences` model, with canonical pairs `productA` / `productB`, approval columns, and `kind` computed on read.
- **Domain:** the comparison logic in `libs/domain/src/lib/equivalence.ts`.
- **API:** `equivalences.controller.ts`, with per-product equivalents, suggestions, candidates and link (`inventory.equivalences.link`).
- **ERP:** the product sheet's Equivalentes tab.
- **Inventory layout:** the "Equivalencias" sub-nav entry exists but is `disabled: true` in `inventory-layout.page.ts:21`.

This story adds the company-wide list of links.

**Dependencies:** the current branch is `feat/hu-inv-09`, and HU-INV-10 is planned. Neither touches the equivalences files. The only shared file is `api-error.ts`. Build on `feat/hu-inv-11` from `main`.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| List of links | Int test: `GET /inventory/equivalences` returns each pair once, with both products (code, brand + flag, d×D×B, stock total), `kind` (EXACT / WITH_DIFFERENCES plus the differing fields) and the creator and date. It is paginated, can be filtered by brand, category, kind and search (code of either side), and is tenant-isolated. Page spec: renders the rows |
| Empty state with illustration | Page spec: with 0 links, `rs-empty-state` with its illustration, "Aún no hay equivalencias" and a "Vincular equivalencias" action (behind `link`). With filters and 0 results, "Limpiar filtros" |
| Without permission, read-only with illustration (IN-15f) | Page spec: a user with `inventory.products.view` but without `inventory.equivalences.link` sees the list with no link actions, plus an `rs-note` "Modo solo lectura" with its illustration. A user without `view` gets the route guard's no-permission state. Int test: link returns 403 for that user |

## Model
No migration. The list query uses the existing `@@unique` and indexes on `(company_id, product_a_id)` / `(company_id, product_b_id)`. If the build finds that the brand filter needs an index, add migration `20261024100000_equivalences_list_index`.

## Domain
- Reuse `equivalence.ts` to compute `kind` and `differences` for each pair, with no new rules.
- Add the types `EquivalenceListItem`, `EquivalenceListResponse` and `EquivalenceFilters`.

## API
| Method | Route | Permission | Errors |
|---|---|---|---|
| GET | `/inventory/equivalences?brandId&categoryId&kind&q&page&pageSize` | `inventory.products.view` | 400 `INVALID_FILTER` |

- `EquivalencesService.list()` goes through `prisma.tenant`. It loads both sides with their dimensions and attributes, computes `kind` in the domain, and stock totals come from the existing stock-queries helper.
- The `kind` filter is applied after computing, so the computation is bounded by the page window: filter in SQL by the dimension equality first (all links already match d×D×B), then refine by attributes.
- Read-only, so no audit and no outbox.
- `GET /inventory/context` (or the existing permissions payload) already exposes `inventory.equivalences.link` to the ERP.

## ERP screens
- **Route:** `inventory/equivalences` (guard `inventory.products.view`), and enable the sub-nav entry.
- **IN-15a, list:**
  - `rs-page-header`;
  - a filter bar with `rs-select` for brand, category and kind and an `rs-input` for search;
  - an `rs-doc-table` with Producto A | ⇄ | Producto B (`rs-product-thumb`, `rs-flag`, code, brand), Medidas, Tipo (`rs-status-pill` "Exacta" / "Con diferencias", with an `rs-tooltip` listing the differences) and Stock;
  - `rs-pagination` by 10, and `rs-skeleton` while loading;
  - clicking a side opens that product's sheet.
- **IN-15b, empty:** `rs-empty-state` with an illustration.
- **IN-15f, read-only:** the same list with a read-only `rs-note`. Actions are hidden with `*rsCan`.
- **Components:** none new. Check the empty-state illustration asset in Figma during the build.

## Tests
- **Unit:** page states (loading, empty, filtered-empty, read-only, error), the filter → query mapping, and the mapper.
- **Integration (real Postgres):** pairs listed once, kind computed, filters, pagination, tenant isolation, 403 on link without permission. No stock writes, so no concurrency test.
- **E2E:** Inventario → Equivalencias → see the seeded links → filter by brand → open a product. Then a read-only user sees the Note and no Vincular.

## Open decisions used with defaults
- **#34:** approval is optional, so every saved link is listed. The approval columns are shown only once HU-INV-13 lands.

## Risks and doubts
- **What does "Vincular" do from the list?** No product context. Assumed: it opens the existing candidate search from HU-INV-04 to pick product A. If IN-15a has no such button, drop it.
- **Unlink** isn't in this story; it is left to HU-INV-13.
- **IN-15a / b / f texts and columns:** compare against Figma during the build.

## Files expected to change
- `libs/domain/src/lib/{equivalence.ts (types), index.ts}`
- `apps/api/src/modules/inventory/{equivalences.controller.ts, equivalences.service.ts, dto.ts, equivalences.service.int.spec.ts}`
- `apps/erp/src/app/features/inventory/{inventory-layout.page.ts, inventory.routes.ts, equivalences/equivalences.page.*, equivalences/equivalences-api.service.ts}`
- `apps/erp/src/app/core/api-error.ts` (only if needed)
- `apps/erp-e2e/src/equivalences.spec.ts`
- `docs/plans/HU-INV-11.md`

## Verification
Run `pnpm nx affected -t lint typecheck test`, then the API int suite, then Playwright. Compare against IN-15a, IN-15b and IN-15f. Run the `reviewer` and `ui-checker` agents.
