# Plan · HU-INV-09 · Deactivate or delete a product (IN-18a, IN-18b)

## Context
HU-INV-05 already made delete refuse a product with movements: `remove()` returns 409 `PRODUCT_HAS_MOVEMENTS` or `PRODUCT_HAS_STOCK`. That message already says "Desactívalo en su lugar", but deactivation doesn't exist yet. This story adds deactivation and reactivation, and redesigns delete.

**Dependency:** this story touches the same files as HU-INV-08 (`product-commands.service.ts`, `products.page.*`, `product-sheet.page.*`). Build 09 on `feat/hu-inv-09` once 08 is merged.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| Deactivating hides it from sales | Domain spec: `isSellable(status)` is true only for ACTIVE. Int test: a deactivated product drops out of `GET /inventory/products?sellable=true` (the contract for the future POS, quotes and web store). It still shows in the default list with the "Inactivo" badge, and its history stays intact |
| Deleting is blocked if it has movements (already met) | The existing int test for 409 `PRODUCT_HAS_MOVEMENTS` stays green. Dialog spec: when the product has movements, the delete dialog offers **Desactivar** instead |
| Deactivation doesn't lose history | Int test: no movements, levels or equivalences are touched; only `status`, `deactivated_at` and `deactivated_by_id` change |
| Audited and reversible | Int test: audit entries `inventory.product.deactivate` / `.reactivate`, and the outbox event `inventory.product-status-changed` |

## Model
Migration `20261024162520_product_deactivation` adds two nullable columns to `products`:
- `deactivated_at` (`timestamptz`, `@map`);
- `deactivated_by_id` (uuid, FK to users, `onDelete: Restrict`).

The table is already in `TENANT_MODELS`.

## Domain
- `PRODUCT_STATUS_MACHINE` in `state-machine.ts`: ACTIVE → INACTIVE, INACTIVE → ACTIVE, DRAFT → ACTIVE (finishing a draft). A draft can't be deactivated; it's deleted instead.
- `isSellable(status)` in `product-catalog.ts`.
- New permission `inventory.products.deactivate` ("Desactivar y reactivar productos"), per the design-notes catalog. Warehouse and Management get it through the `inventory.*` prefix rules.

## API
| Method | Route | Permission | Errors |
|---|---|---|---|
| POST | `/inventory/products/:id/deactivate` | `inventory.products.deactivate` | 404 `PRODUCT_NOT_FOUND`, 409 `INVALID_STATUS_TRANSITION` (draft, or already inactive) |
| POST | `/inventory/products/:id/reactivate` | `inventory.products.deactivate` | 404, 409 `INVALID_STATUS_TRANSITION` |
| GET | `/inventory/products?sellable=true` | `inventory.products.view` | — |

- `ProductCommandsService.setStatus()` in one `$transaction`:
  1. Lock the product row with `FOR UPDATE`.
  2. Apply the state-machine transition.
  3. Audit with `AuditService` and publish with `OutboxService.publish(…, { tx })`.
- A deactivated product keeps its stock; cleaning it up is HU-INV-16's job.
- `ProductDetail` and `ProductListItem` get `hasMovements` so the UI can choose between delete and deactivate.

## ERP screens
- **Row menu:** "Desactivar" or "Reactivar" by status, behind `inventory.products.deactivate`. "Eliminar" only when the product has no movements; otherwise only "Desactivar" is offered.
- **IN-18a, deactivate confirmation:** Modal "¿Desactivar {code}?" explaining that the product stops showing in sales and the store and keeps its history and stock.
- **IN-18b, delete confirmation:** without movements, the existing danger modal; with movements, a Note "Tiene movimientos: solo puede desactivarse" and a "Desactivar" button.
- **Sheet header:** "Desactivar" / "Reactivar" next to Editar and Duplicar. An inactive product shows the "Inactivo" badge and a Note.
- **Toasts:** "Producto desactivado" and "Producto reactivado".
- **`api-error.ts`:** Spanish message for `INVALID_STATUS_TRANSITION`.
- **Components:** none new (Modal, Note, Button, Badge, Toast, RowMenu).

## Tests
- **Unit:** state machine and `isSellable`; menu items by permission and status; both dialogs, including the movements branch; sheet buttons.
- **Integration (real Postgres):** deactivate and reactivate with audit, outbox and `deactivated_*`; deactivating a draft gets 409; the `sellable` filter; tenant isolation; **concurrency:** a delete racing a stock movement never deletes a product with movements (existing lock).
- **E2E:** row menu → Desactivar → "Inactivo" badge → missing from `sellable` → Reactivar. Then a product with movements → Eliminar → the dialog offers Desactivar.

## Open decisions used with defaults
None apply directly. Whether an inactive product with stock shows in reports is left to HU-INV-16 and the reports stories.

## Risks and doubts
- **No sales module exists yet**, so "hidden from sales" is proven through the contract only (`isSellable` and `?sellable=true`). Sales, POS and web stories must use them.
- **New permission vs. reusing `products.edit`:** follows the design notes with a separate key.
- **IN-18a and IN-18b texts:** compare with Figma during the build.

## Files expected to change
- `apps/api/prisma/{schema.prisma, migrations/20261024162520_product_deactivation/}`
- `libs/domain/src/lib/{state-machine.ts, product-catalog.ts, permissions.ts, specs}`
- `apps/api/src/modules/inventory/{products.controller.ts, dto.ts, product-commands.service.ts, products.service.ts, *.int.spec.ts}`
- `apps/api/src/common/outbox/outbox.service.ts`
- `apps/erp/src/app/core/api-error.ts`
- `apps/erp/src/app/features/inventory/products/{products.page.*, products-api.service.ts, product-list.mapper.ts, sheet/product-sheet.page.*, deactivate-product.dialog.*}`
- `apps/erp-e2e/src/products.spec.ts`
- `docs/plans/HU-INV-09.md`

## Verification
`pnpm nx affected -t lint typecheck test`, the API integration suite against Postgres, then the Playwright E2E. Compare against IN-18a and IN-18b. Run the `reviewer`, `stock-auditor` and `ui-checker` agents on the diff.
