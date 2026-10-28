# Plan · HU-INV-19 · Flag and fix lines without enough stock in a transfer (IN-26)

## Context
When a transfer is built, some lines may ask for more than the origin has. Warehouse must see which ones and fix them before sending. Decision #35 says sending is blocked while there are errors.

**Depends on HU-INV-18** (planned, not built). It provides:
- the `transfers` / `transfer_items` models;
- `validateTransferLines`, which already marks `INSUFFICIENT_STOCK`;
- the editor (IN-06), with its error flag per row, the "Con error" filter and the summary errors count;
- `send`, which re-validates under lock and returns 422 `INSUFFICIENT_STOCK`.

This story adds the **IN-26 correction experience** on top. **Build only after HU-INV-18 is merged**, on `feat/hu-inv-19` from `main`; if 18's code differs from its plan, stop and re-plan.

## Acceptance criteria → checks
| Criterion | Proof |
|---|---|
| Flags the lines without stock | Domain spec: `validateTransferLines` gives `INSUFFICIENT_STOCK` with `available` and `shortfall` per line; inactive products and zero stock are flagged too. Int test: `GET /inventory/transfers/:id/validation` (and the `send` 422 `details.lines`) returns each failing line with `requested`, `available` and `shortfall`, computed from live `stock_levels` minus `reserved`. Page spec: an `rs-alert` banner "3 productos sin stock suficiente" with "Ver productos" applies the "Con error" filter. The rows show an `rs-stock-flag` plus "Disponible: 4" |
| …and allows adjusting | Page spec, per-line actions: "Ajustar a disponible" (sets quantity = available, and removes the line if 0), "Quitar" and a manual quantity edit, which re-validates. A bulk action "Ajustar todos a disponible" is in the banner. The errors count and Enviar enable once errors = 0. Int test: `PUT` with the adjusted lines then `send` → 201. A race where stock drops between validation and send → `send` returns 422 with the updated lines and the UI re-flags them without losing other edits |

## Model
- No migration. It uses HU-INV-18's tables.

## Domain (`libs/domain/src/lib/transfer.ts`)
- Extend the line result with `available` and `shortfall`.
- `adjustLinesToAvailable(lines, availability, { removeZero: true })` → the new lines plus a change log (for a toast "Se ajustaron 3 líneas").
- Pure; quantities are integers.

## API
| Method | Route | Permission | Errors |
|---|---|---|---|
| GET | `/inventory/transfers/:id/validation` | `inventory.transfers.create` | 404 `TRANSFER_NOT_FOUND` |
| POST | `/inventory/transfers/validate-lines` (unsaved draft lines + origin) | `inventory.transfers.create` | 422 `WAREHOUSE_INACTIVE` |

- Both are read-only, through `prisma.tenant`, with no audit or outbox.
- `send` (from HU-INV-18) already blocks; ensure its 422 `details` carries the same line shape.
- The adjustment itself is a normal draft `PUT`, audited as `inventory.transfer.update` with `{ adjustedToAvailable: n }`.

## ERP screens (IN-26, inside the HU-INV-18 editor)
- **Banner:** an `rs-alert` warning with the count, "Ver productos" and "Ajustar todos a disponible" (confirm `rs-modal` listing the changes).
- **Rows:** `rs-stock-flag` level `out` or `low`, "Solicitado 10 · Disponible 4", and the actions "Ajustar a disponible" and "Quitar" (`rsButton` ghost).
- **Re-validation:** debounced (`validate-lines`) when the quantity or origin changes, and after a failed send.
- **Enviar:** stays disabled while errors > 0, with an `rs-tooltip` "Corrige las líneas sin stock para enviar".
- **Components:** none new; texts per IN-26 in Figma.

## Tests
- **Unit (domain):** shortfall math, adjust-to-available (partial, zero → removed), inactive product.
- **Unit (ERP):** banner count, filter, single and bulk adjust, the tooltip, re-validation after the send 422 keeps other edits.
- **Integration (real Postgres):** the validation endpoint for saved and unsaved lines; the reserved quantity is respected; adjust then send succeeds; **concurrency:** stock consumed by another transfer between validate and send → 422 with lines, no movements written, level not negative.
- **E2E:** a draft with 1 over-stock line → banner → "Ajustar a disponible" → Enviar → "En tránsito".

## Open decisions used with defaults
- **#35:** partial send is not allowed; sending is blocked while there are errors. Add the setting `transfers.allowPartialSend` (default `false`). If it is true, Enviar is labelled "Enviar solo líneas correctas" and the error lines stay in a new draft — **not built now**, only the setting and the domain flag, unless you want it now.

## Risks and doubts
- **Hard dependency on HU-INV-18.** File names and shapes come from its plan.
- **Reserved stock:** I assume `available = quantity − reserved`; `reserved` is not used by anything yet (sales may use it later).
- Should the setting for #35 be added now or only when the client changes the decision? I default to adding it, without the partial-send flow.

## Files expected to change
- `libs/domain/src/lib/{transfer.ts, transfer.spec.ts, company-settings.ts}`
- `apps/api/src/modules/inventory/{transfers.controller.ts, transfers.service.ts, transfers.dto.ts, transfers.int.spec.ts}`
- `apps/erp/src/app/features/inventory/transfers/editor/*` (banner, row actions, store)
- `apps/erp/src/app/core/api-error.ts`
- `apps/erp-e2e/src/transfers.spec.ts` (new case)
- `docs/plans/HU-INV-19.md`

## Verification
`pnpm nx affected -t lint typecheck test`, then the API int suite against Postgres (concurrency included), then Playwright. Compare against IN-26. Run the `reviewer`, `stock-auditor` and `ui-checker` agents.
