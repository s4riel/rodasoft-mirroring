# Plan · HU-VEN-30 + HU-VEN-32 (one branch: `feat/hu-ven-30-32`)

## Context

- **HU-VEN-30** (hold and resume a sale) and **HU-VEN-32** (request a transfer of missing items from the sale) were "Waiting for design". Figma (`JYULL6jvXiwNP8UVvEF7tl`, page `05 Ventas y POS`) now draws their entry points inside existing frames; no new frames exist.
- **HU-VEN-31 is RETIRED** (3 Nov 2026, replaced by the per-customer discount, HU-VEN-37). It is not planned.
- Decisions taken with the user (12 Nov 2026):
  - HU-VEN-32 covers both buttons (POS and quote), **without** partial orders: reservation stays all-or-nothing, decision #13 default unchanged.
  - A "transfer request" is a **DRAFT transfer** owned by the origin branch, marked as requested from a sale.
  - The held-sales list is an **estimated dialog** (not drawn in Figma).

What Figma shows:

| Frame | Element |
|---|---|
| VP-03 and every POS frame (`80:4584`, `83:5030`…) | Secondary button "Poner en espera" above "Cobrar", beside the retired "Descuento (F8)" |
| VP-03b (`83:5030`) | "Pedir a Sacaba" at the right of the line "6208-2RS en otras sucursales: Sacaba 4 uds · Panamericana 2 uds" |
| VP-18 (`93:7809`) | "Pedir transferencia de faltantes" beside "Crear pedido y reservar", with a "Falta" column and a warning note |

## Acceptance criteria → checks

| Criterion | Proof |
|---|---|
| 30 · I put the sale on hold | Integration: `hold` moves my OPEN cart with lines to `ON_HOLD`, audited; my current cart is then empty. E2E: click "Poner en espera", the cart empties and the counter shows 1 |
| 30 · I resume it from a list | Integration: the list returns only my held carts of the current shift; `resume` brings one back to `OPEN` with its lines and customer. E2E: open "En espera", "Retomar", the lines are back |
| 32 · Generates a transfer request with the missing items (reuses HU-INV-18) | Integration: from the POS and from a quote, a `DRAFT` transfer is created (origin = the other branch's main warehouse, destination = mine) with the missing quantities, visible to the origin branch in the HU-INV-18 list, and no stock moves. E2E: "Pedir a Sacaba" → toast with `TR-…`; the origin user sees it and can send it |

## Model

Migration **`20261112120000_transfer_sale_requests`** (HU-VEN-32 only; HU-VEN-30 needs none: `ON_HOLD`, `hold_label` and the `hold`/`resume` events already exist).

- New enum `TransferSourceType { POS, QUOTE }`.
- `Transfer` (table `transfers`): `sourceType TransferSourceType? @map("source_type")`, `sourceId String? @db.Uuid @map("source_id")` (the quote id; null for the POS), plus `@@index([companyId, sourceType, sourceId])`.
- CHECK: `source_id` is null unless `source_type = 'QUOTE'`.
- No new models, so `TENANT_MODELS` is unchanged.
- No conflict found: all local branches are merged into `develop`; the last migration is `20261110120000_cash_review_and_price_history`.

## Domain (`libs/domain`)

- `pos-cart.ts`: `HeldCheckoutSummary { id, customerName, lineCount, pieces, total, heldAt }`.
- `transfer.ts`:
  - `transferRequestLines(shortfalls)`: one line per short product with `requested − available` (pure; reuses `ReservationShortfall`).
  - `TransferRequestOption { branchId, branchName, warehouseId, lines: { productId, missing, available }[], coversAll }` and `rankTransferRequestOptions()` (branches that cover everything first, then by pieces covered).
  - `TransferSourceType`, and `source` on the transfer list/detail types.
- `equivalence.ts`: add `branchId` to `PosOtherBranchStock`.
- `company-settings.ts`: `sales.allowTransferRequests` (boolean, default `true`), seeded in `seed-base.ts`.
- `permissions.ts`: new key `sales.transfer-requests.create`, in the default roles `admin`, `management` and `cashier` (there is no salesperson role).
- State machines: none changed. `posCheckoutMachine` already has `hold`, `resume`, `abandon`; the request uses `DRAFT` of `transferMachine`.

## API

### HU-VEN-30 · `apps/api/src/modules/sales/pos` (all under `sales.pos.use`)

| Method | Route | Behaviour | Error codes |
|---|---|---|---|
| POST | `sales/pos/checkout/hold` | Locks my cart (`FOR UPDATE`); `OPEN → ON_HOLD` | `CHECKOUT_NOT_FOUND`, `CHECKOUT_EMPTY`, `CHECKOUT_NOT_EDITABLE` (while `PAYING`) |
| GET | `sales/pos/held-checkouts` | My held carts of the current shift, oldest first | — |
| POST | `sales/pos/held-checkouts/:id/resume` | `ON_HOLD → OPEN`; returns the `PosCheckoutView` | `HELD_CHECKOUT_NOT_FOUND`, `CHECKOUT_IN_PROGRESS` |
| DELETE | `sales/pos/held-checkouts/:id` | `ON_HOLD → ABANDONED` (discard) | `HELD_CHECKOUT_NOT_FOUND` |

- New `pos-held-checkouts.service.ts`; totals reuse the pricing of `PosCheckoutService.toView()` (extract it to a shared helper instead of duplicating).
- Resume rule: if my current cart is `OPEN` with no lines, it is deleted in the same transaction; if it has lines or is `PAYING`, `409 CHECKOUT_IN_PROGRESS`. A P2002 on `pos_checkouts_one_open_per_cashier` (two resumes at once) maps to the same code.
- A held cart keeps its lines only. Prices are re-checked at `pay` and stock at `complete`, as today; nothing is reserved.
- `hold_label` stays null (one click, no prompt).
- Audit through `AuditService`: `sales.checkout.hold`, `sales.checkout.resume`, `sales.checkout.abandon` (`reason: 'DISCARDED_BY_CASHIER'`). No outbox.
- Shift close keeps abandoning held carts (already built and tested in `cash-closing.service.ts`).

### HU-VEN-32 · new `apps/api/src/modules/sales/transfer-requests` (all under `sales.transfer-requests.create`)

| Method | Route | Behaviour | Error codes |
|---|---|---|---|
| POST | `sales/transfer-requests/options` | Body `{ source: 'POS' \| 'QUOTE', quoteId?, warehouseId?, lines? }`. Returns the ranked `TransferRequestOption[]` of the other branches | `TRANSFER_REQUESTS_DISABLED`, `QUOTE_NOT_FOUND`, `NOTHING_MISSING`, `BRANCH_FORBIDDEN` |
| POST | `sales/transfer-requests` | Body adds `originBranchId`. Creates the draft transfer; returns `{ id, number, originBranchName }` | the above plus `ORIGIN_WAREHOUSE_NOT_FOUND`, `TRANSFER_REQUEST_SAME_BRANCH`, `TRANSFER_REQUEST_EXISTS` (quote with an open request; `details.number`), and the existing transfer validation codes |

- Destination: the shift's warehouse (POS, via `requireOpenShift()`) or the warehouse chosen for the conversion (quote; must be operable). Origin: the active `isMain` warehouse of the chosen branch.
- Lines: POS sends `{ productId, quantity }` (one product); for a quote the server computes them with `reservationShortfalls` + `transferRequestLines`, never trusting the client.
- Inventory side: new `TransfersService.createRequest(input)` (export `TransfersService` from `inventory.module.ts`). It reuses `checkDraft`'s line, product and warehouse checks, the `TR-` numbering and `writeTransaction`, but requires the **destination** to be operable instead of the origin, and does not ask for `inventory.transfers.create`.
- Audit `inventory.transfer.request` (source, requester); outbox `inventory.transfer.requested` with `OutboxService.publish(…, { tx })`.
- No stock moves: movements are written only when the origin branch sends the transfer (HU-INV-18, unchanged).
- Transfer list and detail responses gain `source` (`type`, quote number, requester name).
- `GET sales/quotes/:id` gains `transferRequests: { id, number, status }[]`.
- `pos-equivalents.service.ts` returns `branchId` in `otherBranches`.

## ERP screens

**VP-03 · POS (`features/sales/pos`)**
- "Poner en espera" (`rsButton` secondary) above "Cobrar", disabled with an empty cart or while paying.
- "En espera (n)" in the `sale-header`; opens `pos-held-sales.dialog` (`rs-modal` size `medium`): one row per held sale (customer, lines, total, time) with "Retomar" and "Descartar", `rs-empty-state` when there are none, `rs-skeleton` while loading, `rs-note` for errors. **Estimated layout, to re-check vs Figma.**
- Shortcuts are skipped while the dialog is open. No new shortcut (Figma lists none).

**VP-03b · equivalents panel**
- "Pedir a {sucursal}" beside the other-branches line (the branch with most stock), shown only with the permission and the setting on.
- It opens `pos-transfer-request.dialog` (`rs-modal` `default`): product, origin branch (`rs-select` when several), `rs-qty-stepper` (1…available there), "Solicitar". Success: toast "Solicitud TR-000123 enviada a Sacaba". **The dialog is estimated: Figma draws only the button.**

**VP-17 · quote detail (`features/sales/quotes`)**
- When the conversion answers `INSUFFICIENT_STOCK`, the existing shortfall list gains "Pedir transferencia de faltantes", which opens the same dialog in quote mode (lines read-only, origin picker with "cubre todo / cubre n de m").
- A note lists the requests already made ("Transferencia solicitada: TR-000123 · Borrador").
- VP-18's "Falta" column and partial-reservation note are **not** built (no partial orders).

**IN transfers list and detail (`features/inventory`)**
- `rs-badge` "Solicitada desde venta" and a `rs-data-field` with the requester and quote number.

**Components:** everything comes from `libs/ui` (`Button`, `Modal`, `EmptyState`, `Skeleton`, `Note`, `Select`, `QtyStepper`, `Badge`, `DataField`, `Toast`). No new `libs/ui` component. `docs/ui-library.md` gets a line for the two estimated dialogs.

## Tests

- **Unit (domain):** `transferRequestLines`, `rankTransferRequestOptions`, the new setting default, the permission in the default roles.
- **Integration (real Postgres):**
  - `pos-held-checkouts.int.spec.ts`: hold, list (own, current shift only), resume, discard; hold refused when empty or `PAYING`; resume refused with a cart in progress; empty cart replaced on resume; **two concurrent resumes: exactly one wins**; another cashier's held cart is not found; stock never written.
  - `transfer-requests.int.spec.ts`: POS and quote requests create the right draft (origin, destination, lines, source); `stock_levels` and `stock_movements` unchanged; same-branch, disabled setting, nothing missing and duplicate quote request refused; **concurrent requests get distinct `TR-` numbers**; the origin user sees and sends it, the requester cannot.
  - Permission specs for both controllers; `cash-closing.int.spec.ts` stays green.
- **ERP unit:** POS page (hold button states, counter, resume), both dialogs, equivalents panel button, quote detail button, transfer list badge.
- **E2E (Playwright, `apps/erp-e2e/src`):** `pos-hold.spec.ts` (hold → serve another sale → resume → charge) and `sales-transfer-request.spec.ts` (POS request → origin user sees the draft). Cleanup includes `ON_HOLD` carts.
- Agents before closing: `stock-auditor` (touches transfers), `ui-checker`, `reviewer`.
- `pnpm nx affected -t lint typecheck test` with no errors.

## Open decisions used with a default

- **#13** (sell with stock from another branch): stays "No". The request only asks the other branch to send stock; nothing is reserved or sold from it. New setting `sales.allowTransferRequests` (`true`) lets a company turn the buttons off.

## Risks and doubts

- A held sale is lost when the shift closes (existing behaviour). The closing screen does not warn about it; not in this story.
- A held cart reserves no stock, so a resumed sale can find a line short; the cart already shows that case.
- The origin branch can edit or cancel the draft like any of its own; the requester is not notified (no notification module yet; the outbox event is published for it).
- The cashier cannot open the transfer (no `inventory.transfers.*`); they only see its number and status.
- Three estimated pieces need design review: the held-sales dialog, the request dialog, and the quote-detail button (Figma places it on VP-18, whose partial order is out of scope).
- Figma's shortcut bar still shows "F8 Descuento" (retired); it is left out.

## Files expected to change

- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261112120000_transfer_sale_requests/`, `apps/api/prisma/seed-base.ts`
- `libs/domain/src/lib/`: `pos-cart.ts`, `transfer.ts`, `equivalence.ts`, `company-settings.ts`, `permissions.ts` (+ specs)
- `apps/api/src/modules/sales/pos/`: `pos.controller.ts`, `pos-checkout.service.ts`, `pos.errors.ts`, `pos-equivalents.service.ts`, new `pos-held-checkouts.service.ts` (+ int spec)
- `apps/api/src/modules/sales/transfer-requests/` (new: controller, service, dto, errors, specs), `sales.module.ts`
- `apps/api/src/modules/sales/quotes/quotes.service.ts`
- `apps/api/src/modules/inventory/`: `transfers.service.ts`, `inventory.module.ts`, transfer mappers/DTO types
- `apps/erp/src/app/features/sales/pos/`: `pos.page.*`, `pos-api.service.ts`, `pos-equivalents-panel.*`, new `pos-held-sales.dialog.*`, new `pos-transfer-request.dialog.*`
- `apps/erp/src/app/features/sales/quotes/quote-detail.page.*`, quotes API service
- `apps/erp/src/app/features/inventory/`: transfer list and detail pages
- `apps/erp/src/app/core/api-error.ts` (Spanish texts for the new codes)
- `apps/erp-e2e/src/pos-hold.spec.ts`, `apps/erp-e2e/src/sales-transfer-request.spec.ts`, `pos-cart.spec.ts` cleanup
- `docs/backlog/sales.md` (status and screens of 30 and 32), `docs/ui-library.md`, `docs/sales/design-notes.md`

