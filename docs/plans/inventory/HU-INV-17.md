# Plan · HU-INV-17 · Warehouses per branch: list, new and edit (IN-14, IN-30a, IN-30b)

## Context
Warehouse and Management need to manage each branch's warehouses so that merchandise can be located. What already exists:
- **Model:** `Warehouse` (`warehouses`) with `companyId`, `branchId`, `code` (unique per company), `name`, `isMain`, `visibleInStore`, `status` and timestamps. It is already used by stock levels, movements, thresholds, import and `GET /context`, which lists the active warehouses per branch.
- **Branch scoping:** `stock-queries.service.ts` shows only the branches a limited member may operate (`MembershipBranch`).
- **ERP:** the inventory sub-nav has a "Almacenes" entry, `disabled: true`, in `inventory-layout.page.ts:22`.
- **Missing:** there are no warehouse endpoints or screens, and the `inventory.warehouses.manage` permission listed in design-notes is not in `permissions.ts`.

**Branches:** no other branch touches warehouses. The shared files are `inventory-layout.page.ts` and `inventory.routes.ts` (HU-INV-11), `permissions.ts` (HU-INV-13), `api-error.ts` and `seed.ts`. Build on `feat/hu-inv-17` from `main`.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| List of warehouses (IN-14) | Int test: `GET /inventory/warehouses` returns code, name, branch, main flag, store visibility, status, product count with stock and total units. It is filterable by branch, status and search (code or name), paginated, tenant-isolated, and limited members see only their branches. Page spec: rows grouped or filterable by branch, with loading, empty with illustration and error states |
| New form (IN-30a) | Int test: `POST` creates with the code normalized to upper case. Duplicate code → 409 `WAREHOUSE_CODE_EXISTS`; an inactive or unknown branch → 422 `BRANCH_INVALID`; a branch outside the member's scope → 403. The first warehouse of a branch becomes main automatically. Audit `inventory.warehouse.create`. Page spec: required fields, inline errors, success toast "Almacén creado" |
| Edit form (IN-30b) | Int test: `PATCH` edits name, code, visibility, main and status. Setting main unsets the branch's previous main in the same tx (exactly one main per branch, enforced by a partial unique index). Changing the branch is rejected (422 `WAREHOUSE_BRANCH_LOCKED`) if it has movements. Deactivating with stock is rejected (422 `WAREHOUSE_HAS_STOCK`), and so is deactivating the only main (422 `WAREHOUSE_MAIN_REQUIRED`). `expectedUpdatedAt` → 409 `WAREHOUSE_MODIFIED`. Audit with before/after |

## Model
- Migration `20261025110000_warehouses_management`:
  - add `location_note String? @map("location_note")` (address or physical reference shown in IN-30, if Figma has it — confirm in the build);
  - a partial unique index `warehouses_one_main_per_branch` on `(company_id, branch_id) WHERE is_main AND status = 'ACTIVE'` (raw SQL in the migration).
- `Warehouse` is already in `TENANT_MODELS` (confirm).

## Domain (`libs/domain/src/lib/warehouse.ts`)
- `WAREHOUSE_CODE_PATTERN` (upper-case letters, digits and `-`, 2–12 chars) and `normalizeWarehouseCode`.
- `canDeactivateWarehouse({ totalUnits, isMain, otherActiveInBranch })` returns `ok | 'HAS_STOCK' | 'MAIN_REQUIRED'`.
- Types `WarehouseListItem`, `WarehouseListResponse`, `WarehouseDetail`, `WarehouseInput`.
- Permission `inventory.warehouses.manage`, label "Gestionar almacenes", added to `permissions.ts`. Viewing uses `inventory.products.view`.

## API (`apps/api/src/modules/inventory/warehouses.*`)
| Method | Route | Permission | Errors |
|---|---|---|---|
| GET | `/inventory/warehouses?branchId&status&q&page&pageSize` | `inventory.products.view` | 400 `INVALID_FILTER` |
| GET | `/inventory/warehouses/:id` | `inventory.products.view` | 404 `WAREHOUSE_NOT_FOUND` |
| POST | `/inventory/warehouses` | `inventory.warehouses.manage` | 409 `WAREHOUSE_CODE_EXISTS`, 422 `BRANCH_INVALID`, 403 `BRANCH_FORBIDDEN` |
| PATCH | `/inventory/warehouses/:id` | `inventory.warehouses.manage` | the codes above, plus `WAREHOUSE_BRANCH_LOCKED`, `WAREHOUSE_HAS_STOCK`, `WAREHOUSE_MAIN_REQUIRED`, `WAREHOUSE_MODIFIED` |

- `WarehousesService` uses `prisma.tenant` with one tx per write. It applies the branch scope through the same membership helper that stock-queries uses, and maps P2002 on `(company_id, code)` → 409.
- Audit: `inventory.warehouse.create` / `.update`.
- Outbox: `inventory.warehouse.changed` when `visibleInStore` or `status` changes, because the store sells only from published warehouses.
- `GET /context` already lists only active warehouses, so it needs no change.

## ERP screens
- **Routes:** `inventory/warehouses`, `/new` and `/:id/edit`; the guard is `view` for the list and `manage` for the forms. Enable the sub-nav entry.
- **IN-14, list:**
  - `rs-page-header` with "Nuevo almacén" (`*rsCan`);
  - filter bar with an `rs-select` for branch and status and an `rs-input` search;
  - `rs-doc-table` with the columns Código, Nombre, Sucursal, Principal (`rs-badge`), Tienda en línea (`rs-status-pill`), Productos, Unidades, Estado and an edit action;
  - `rs-pagination`, `rs-skeleton` while loading, `rs-empty-state-illustrated` for empty or error.
- **IN-30a / IN-30b, form:** one `warehouse-form.page.*` for both modes:
  - `rs-input` fields for code and name, `rs-select` for the branch (locked when editing with movements), `rs-switch` toggles for Principal and Visible en tienda, and an `rs-textarea` for the location note;
  - status shown when editing; Guardar / Cancelar;
  - a confirm `rs-modal` when changing the main warehouse ("Se quitará como principal a HK-01").
- **Components:** none new.

## Tests
- **Unit (domain):** the code pattern and normalization, `canDeactivateWarehouse`.
- **Unit (ERP):** list states and filters; form validation, mode, error mapping and the main-change confirmation.
- **Integration (real Postgres):**
  - CRUD, duplicate code, branch scope and 403s, tenant isolation, audit and outbox rows;
  - the main swap is atomic;
  - deactivation with stock is blocked;
  - **concurrency:** two simultaneous "set main" on different warehouses of the same branch leave exactly one main (the partial index plus the tx).
- **E2E:** Inventario → Almacenes → Nuevo almacén (HK-02, Central) → it appears in the list → edit, mark it as main → the previous one loses Principal.

## Open decisions used with defaults
- None found in `decisions.md` for warehouses.

## Risks and doubts
- **IN-30 fields:** I assumed code, name, branch, main, store visibility and an optional location note. If Figma shows zones or shelves (bins), that is a separate model — check before building.
- **Delete:** not in the criteria. Only deactivate, which keeps the kardex history.
- **Who manages:** `inventory.warehouses.manage` is granted in the seed to the admin and management roles. Warehouse leads only if the client says so.

## Files expected to change
- `apps/api/prisma/{schema.prisma, migrations/20261025110000_warehouses_management/, seed.ts}`
- `libs/domain/src/lib/{warehouse.ts, warehouse.spec.ts, permissions.ts}`, `libs/domain/src/index.ts`
- `apps/api/src/modules/inventory/{warehouses.controller.ts, warehouses.service.ts, warehouses.dto.ts, warehouses.int.spec.ts, inventory.module.ts}`
- `apps/erp/src/app/features/inventory/{inventory-layout.page.ts, inventory.routes.ts, warehouses/*}`
- `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/warehouses.spec.ts`
- `docs/plans/HU-INV-17.md`

## Verification
`pnpm nx affected -t lint typecheck test`, then the API int suite against Postgres (including the concurrency test), `pnpm db:seed`, then Playwright. Compare against IN-14, IN-30a and IN-30b. Run the `reviewer` and `ui-checker` agents.
