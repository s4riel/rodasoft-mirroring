# Plan · HU-INV-13 · Link equivalents with validations (IN-15c, IN-15d, IN-15e)

## Context
Warehouse links products of different brands as equivalents, and wrong links must be avoided. What already exists:
- **Model:** `equivalences` (canonical pair, `@@unique(company_id, product_a_id, product_b_id)`), with `approved_by_id` / `approved_at` unused, waiting for this story.
- **Domain:** `compareEquivalents` returns INCOMPATIBLE when the type or d×D×B differ; `normalizePair`.
- **API:** `POST /inventory/equivalences` (`inventory.equivalences.link`) already rejects a self-link with 422 `SELF_LINK` and a duplicate with 409 `EQUIVALENCE_EXISTS`, and audits `inventory.equivalence.link`. It does **not** check measurements.
- **Permissions:** `inventory.equivalences.link` exists; `inventory.equivalences.approve` doesn't.

What's missing: a validation preview, a confirmed override for incompatible measurements, the IN-15c/d/e flow, approval (decision #34), and unlinking (left over from HU-INV-11).

**Dependencies:** HU-INV-11 (the list with "Vincular") and HU-INV-12 (the comparator) are planned on the same controller, service and routes. Build on `feat/hu-inv-13` from `main` after both merge, or rebase; the changes only add code.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| Warns if the link already exists (IN-15d) | Int test: `POST /inventory/equivalences/validate` with a linked pair, in either order, returns `{ exists: true, equivalenceId }`; `POST /inventory/equivalences` still returns 409 `EQUIVALENCE_EXISTS`. A concurrency test sends two simultaneous links for the same pair: one 201, one 409, one row. Page spec: the link modal shows an `rs-alert` "Estos productos ya están vinculados" with "Ver vínculo", and Vincular is disabled |
| Warns if the measurements are incompatible (IN-15e) | Domain spec `validateEquivalenceLink`: different type or d×D×B gives `INCOMPATIBLE` with the differing measures listed. Int test: link without `acknowledgeIncompatible` gives 422 `EQUIVALENCE_INCOMPATIBLE` with the differences. With `acknowledgeIncompatible: true` it gives 201, and the audit records `incompatibleAcknowledged`. Page spec: the warning modal lists d/D/B (or T) side by side, with "Vincular de todos modos" as the danger variant and Cancelar |
| IN-15c, the link form | Page spec: pick product A (prefilled from the sheet or the list) and search product B via `equivalence-candidates`. The preview shows Exacta or Con diferencias. Confirm → toast "Equivalencia vinculada" and the lists refresh |

## Model
- Migration `20261024120000_equivalence_incompatible_flag`: add `incompatible_acknowledged boolean NOT NULL DEFAULT false` (`@map`) to `equivalences`, so that list and sheet can flag forced links. No new table; `TENANT_MODELS` already has Equivalence.
- Company setting `inventory.equivalences.requireApproval` (decision #34), default `false`, added to `libs/domain/src/lib/company-settings.ts`.

## Domain (`equivalence.ts`)
- `validateEquivalenceLink(a, b, { exists })` returns `{ selfLink, exists, kind, measureDifferences: {key: 'd'|'D'|'B'|'T', a, b}[], typeDiffers }`. It reuses `compareEquivalents` and `sameMeasures`.
- Approval state: `PENDING_APPROVAL | APPROVED`, derived from `approvedAt` plus the setting (no state machine needed for a flag). If the client later asks for reject or revoke, move it to `state-machine.ts`.
- Types `EquivalenceValidationResponse` and `LinkEquivalenceInput { productAId, productBId, acknowledgeIncompatible? }`.

## API
| Method | Route | Permission | Errors |
|---|---|---|---|
| POST | `/inventory/equivalences/validate` | `inventory.equivalences.link` | 404 `PRODUCT_NOT_FOUND` |
| POST | `/inventory/equivalences` (extended) | `inventory.equivalences.link` | 422 `SELF_LINK`, 409 `EQUIVALENCE_EXISTS`, 422 `EQUIVALENCE_INCOMPATIBLE` |
| POST | `/inventory/equivalences/:id/approve` | `inventory.equivalences.approve` (new) | 404 `EQUIVALENCE_NOT_FOUND`, 409 `EQUIVALENCE_ALREADY_APPROVED` |
| DELETE | `/inventory/equivalences/:id` | `inventory.equivalences.link` | 404 `EQUIVALENCE_NOT_FOUND` |

- `link()` loads both products' category, dimensions and attributes in the transaction and runs the domain validation; the unique index stays the final guard against races (P2002 → 409).
  - When `requireApproval` is false, the link is saved approved (`approvedById` = creator, `approvedAt` = now). This matches #34: "saved on linking, with audit".
  - When it is true, the link is saved pending; pending links are shown with a pill and excluded from sales suggestions (HU-INV-04 and 06 queries filter `approvedAt != null` only when the setting is on).
- Audit `inventory.equivalence.link` (with `incompatibleAcknowledged`), `.approve` and `.unlink` (before = the pair). No outbox: no side effects on other modules.
- Seed: grant `approve` to the admin and warehouse-lead roles; add a label in `permissions.ts`: "Aprobar equivalencias".

## ERP screens
- **IN-15c, link modal:** `equivalences/link/equivalence-link.modal.*`, opened from the sheet's Equivalentes tab, the HU-INV-11 list and the HU-INV-06 created card.
  - `rs-modal` with product A fixed or searchable, and an `rs-input` search for B with results that show `rs-product-thumb`, code, brand and `rs-flag`.
  - A live preview (`validate` on each pick) with an `rs-status-pill` and the differences.
- **IN-15d, already exists:** an `rs-alert` warning inside the modal, with a link to the existing pair; Vincular disabled.
- **IN-15e, incompatible:** a confirmation step in the same `rs-modal` (the variant added in HU-INV-09/10) with a measures table and "Vincular de todos modos" (danger).
- **List and sheet:** an "Incompatible" warning pill for forced links; "Pendiente" pill plus an "Aprobar" action (`*rsCan="'inventory.equivalences.approve'"`) when approval is on; "Desvincular" with a confirm modal.
- **Components:** no new ones (`rs-modal`, `rs-alert`, `rs-input`, `rs-status-pill`, `rs-doc-table`, `rs-toast`). Check the IN-15c/d/e texts against Figma during the build.

## Tests
- **Unit (domain):** `validateEquivalenceLink` covers self, exists, exact, with differences, each measure differing, type differing, the tapered T, and decimal strings.
- **Unit (ERP):** modal steps (search, preview, exists, incompatible confirm, success, API error), disabled states, permission-hidden actions.
- **Integration (real Postgres):**
  - validate;
  - link (both orders, incompatible with and without acknowledgement, approval on and off);
  - approve and unlink with 403s;
  - tenant isolation;
  - audit rows;
  - concurrency on the same pair (parallel `link` → exactly one row).
- **E2E:** sheet → Vincular → pick a product with the same measures → linked. Then a duplicate attempt → the IN-15d warning. Then an incompatible product → IN-15e → confirm → shown with the Incompatible pill. Then Desvincular.

## Open decisions used with defaults
- **#34:** permission `inventory.equivalences.approve`; approval not mandatory. This is configurable through `inventory.equivalences.requireApproval` (default `false`) — links are approved on save and audited.

## Risks and doubts
- **Do incompatible links get saved at all?** The design notes say "warn if not", so it's a warning with an override, not a block. If the client wants a hard block, add the setting `inventory.equivalences.allowIncompatible`.
- **Unlink** is included here because HU-INV-11 deferred it; drop it if the client says otherwise.
- Overlaps with HU-INV-11 and 12 on the equivalences controller, service and routes, and with HU-INV-10 on `company-settings.ts`.

## Files expected to change
- `apps/api/prisma/{schema.prisma, migrations/20261024120000_equivalence_incompatible_flag/, seed.ts}`
- `libs/domain/src/lib/{equivalence.ts, equivalence.spec.ts, permissions.ts, company-settings.ts}`, `libs/domain/src/index.ts`
- `apps/api/src/modules/inventory/{equivalences.controller.ts, equivalences.service.ts, dto.ts, equivalences.int.spec.ts}`
- `apps/erp/src/app/features/inventory/equivalences/link/*`, `products/sheet/equivalents/product-equivalents.tab.*`, `equivalences/equivalences.page.*` (if HU-INV-11 is merged), `equivalences/equivalences-api.service.ts`
- `apps/erp/src/app/core/api-error.ts` (new codes)
- `apps/erp-e2e/src/equivalence-link.spec.ts`
- `docs/plans/HU-INV-13.md`

## Verification
`pnpm nx affected -t lint typecheck test`, then the API int suite against Postgres (including the concurrency test), `pnpm db:seed`, then Playwright. Compare against IN-15c, IN-15d and IN-15e. Run the `reviewer` and `ui-checker` agents.

## Changes after the Figma review (IN-15c, IN-15d, IN-15e)

The Figma frames (file `JYULL6jvXiwNP8UVvEF7tl`, nodes `46:6630`, `46:6867`, `46:7097`) differ from the first plan, so the build follows them:

- **Full page, not a modal:** `/inventory/equivalences/new` (optional `?productId=` for the origin), with the card "Datos de la equivalencia", the info note and the action bar (Cancelar / Guardar equivalencia). It is opened from the list, its empty state and the sheet's Equivalentes tab.
- **Incompatible measures block saving** (IN-15e: "No se pudo guardar · Las medidas no coinciden…"); there is no "Vincular de todos modos". The API answers 422 `EQUIVALENCE_INCOMPATIBLE` always, and the `incompatible_acknowledged` column was dropped.
- **New data:** `equivalences.substitute` (the "Sustituto" type of the form, chosen by the user; Exacta / Con diferencias stay computed) and `equivalences.notes` (varchar 500, "Diferencias observadas"). Migration `20261024220000_equivalence_substitute_and_notes`.
- **Duplicate (IN-15d):** the error "Ya existe el vínculo A → B. Edítalo desde la lista." under the equivalent, plus the red note; there is no "Ver vínculo" button.
- **Same brand:** the hint "Debe ser de una marca distinta al origen." is enforced in the form only; the API does not check it.
- The info note copy ("Quién aprueba el vínculo está PENDIENTE de definir con el cliente.") is the design's own text.
