# HU-VEN-01 · Open the cash register — plan

**Story** (`docs/backlog/sales.md`): As a cashier, I want to open the register with the starting float at the beginning of my shift, so that I can sell and balance at the end. Screens VP-05, VP-14. Decision #3.

**Context.** This is the first story of the walking skeleton. HU-VEN-00 is merged into `develop`, so the cash tables already exist: `cash_registers` (one per SIAT point of sale, seeded), `cash_shifts` with the partial unique index `cash_shifts_one_open_per_register` (one `OPEN` shift per register), and `cashShiftMachine`. The `Caja` and `Punto de venta` tabs are still placeholders. No other local branch touches migrations, the `sales` module or `features/sales`. Build on a branch from `develop` (`feat/hu-ven-01`).

Figma frames (file `JYULL6jvXiwNP8UVvEF7tl`, page 09):
- **VP-05 "Apertura de caja"** (node `103:18225`): Caja dropdown, Cajero (locked to the current user), "Efectivo inicial (Bs) *", the last close of the register, an info note, and the buttons Cancelar and Abrir caja.
- **VP-14 "POS · caja cerrada"** (node `103:11225`): the POS with a modal that says "Caja cerrada".

Decisions taken during planning:
- **Cajero** is always the logged-in user (no opening on behalf of someone else, no `cashier_id` column).
- **Sales sub-nav** is fixed in this story to match Figma.

## Acceptance criteria → checks

| Criterion | Proof |
| --- | --- |
| Without an open register the POS shows "caja cerrada" and doesn't allow selling | `pos.page.spec.ts`: with no current shift the modal appears with "Salir del POS" and "Abrir caja", and the page behind it is blocked. API: `CashShiftsService.requireOpenShift()` throws `CASH_SHIFT_NOT_OPEN` (int test). HU-VEN-02/07/11 call it before any cart or payment action |
| I register the starting float | `cash-shifts.int.spec.ts`: POST creates an `OPEN` shift with the float. The ERP form spec covers required, ≥ 0, max 2 decimals and the comma format |
| The opening time and user are recorded | The int test checks `openedById` = caller, `openedAt` set by the server, and one `AuditLog` row `sales.cash-shift.open` with the `after` snapshot |

## Model

Migration **`<ts>_cash_shift_opening`**, additive only:
- `cash_shifts.closing_float` `Decimal(14,2)?` (`closingFloat`): the cash left in the register at close. HU-VEN-23 fills it. VP-05 shows it as "Bs 500,00 dejados en caja" and compares the new float against it.
- Partial unique index `cash_shifts_one_open_per_user` on `(company_id, opened_by_id) WHERE status = 'OPEN'` (raw SQL in the migration, like the register index): a cashier can't have shifts open on two registers at once.
- No new tables. `TENANT_MODELS` stays as it is.

## Domain (`libs/domain`)

- New `cash-shift.ts`:
  - `validateOpeningFloat(text)`: Bolivian format `500,00`, ≥ 0, at most 2 decimals, uses `Decimal`.
  - `floatMatchesLastClose(openingFloat, lastClosingFloat | null)`: `true` when there is no previous close.
  - The `CASH_SHIFT_REF_TYPE` constant.
- Export from `libs/domain/src/index.ts`.
- `cashShiftMachine` is unchanged: a shift is created already `OPEN`, so there is no transition.

## API (`apps/api/src/modules/sales/cash/`)

| Method · route | Permission | Does |
| --- | --- | --- |
| `GET /sales/cash-registers?branchId=` | `sales.cash-register.open` | Active registers in the branches the user may operate (`MembershipService.operableBranchIds`; `null` = all). For each one: whether it's free (open shift summary), and its last closed shift (closed at, closed by name, difference, `closingFloat`) |
| `GET /sales/cash-shifts/current` | `sales.pos.use` or `sales.cash-register.open` | My `OPEN` shift with its register, branch and warehouse, or `null`. The POS and the Caja tab both use it |
| `POST /sales/cash-shifts` `{ registerId, openingFloat }` | `sales.cash-register.open` | Opens the shift for the caller in one transaction: `openedById` and `openedAt` from the server, audit `sales.cash-shift.open`, outbox `sales.cash-shift.opened`. If the float differs from the last `closingFloat`, it also publishes `sales.cash-shift.float-mismatch` for Accounting, as the VP-05 note promises |

Error `code`s (shape `{status, code, message, details}`):
- `CASH_REGISTER_NOT_FOUND` (404)
- `CASH_REGISTER_INACTIVE` (409)
- `CASH_REGISTER_BRANCH_FORBIDDEN` (403)
- `CASH_REGISTER_ALREADY_OPEN` (409): maps the P2002 error on the register index, so a double click or two people opening at once is covered
- `CASH_SHIFT_ALREADY_OPEN_FOR_USER` (409): P2002 on the user index (plus a pre-check for a clear message)
- `INVALID_OPENING_FLOAT` (400)
- `CASH_SHIFT_NOT_OPEN` (409): from `requireOpenShift`

Notes:
- `openingFloat` travels as a decimal string, never a JSON number.
- Both outbox types are added to `OutboxType` (`apps/api/src/common/outbox/outbox.service.ts`) and to the worker queue map (`apps/worker/src/common/queues.ts`); they go to the notifications/accounting queue and have no consumer yet.
- Services: `CashRegistersService` and `CashShiftsService`, registered in `SalesModule` with their controllers, and exported so the POS stories can use `requireOpenShift`.
- All business queries through `prisma.tenant`.

## ERP screens

- **Sub-nav fixed to match Figma**: Punto de venta, Cotizaciones, Pedidos, Ventas realizadas, Devoluciones (new placeholder, HU-VEN-21, `sales.returns.manage`), Caja, Precios y descuentos. Aprobaciones stays last for VP-25. The change is in `sales-tabs.ts`, `sales.routes.ts` and their specs.
- **`/sales/cash-register/open`, VP-05** (`cash-opening.page`):
  - `rs-breadcrumb` (Inicio / Ventas y POS / Apertura de caja) and `rs-page-header` with the subtitle "Caja 1 · Sucursal… · cuenta el efectivo antes de empezar a vender".
  - Card "Datos del turno": `rs-field` + `rs-select` (Caja, filtered by the ContextBar branch; registers already open are disabled), `rs-select` disabled (Cajero = me), and `rs-input` with `numericInput` (Efectivo inicial (Bs) *).
  - Hint "Fondo de caja: PENDIENTE del cliente." (decision #3).
  - The last-close line ("Último cierre de esta caja: … · Bs 500,00 dejados en caja", or "Sin cierres anteriores").
  - `rs-note type="info"`: "Queda registrado con tu usuario y la hora" / "Al abrir, el punto de venta queda habilitado. Si el efectivo no coincide con el último cierre, se avisa a Contabilidad."
  - `rs-button` Cancelar and Abrir caja (with a loading state). Success → toast → `/sales/pos`. Spanish messages for each error `code`.
- **`/sales/cash-register`** goes to `/open` when I have no shift. Otherwise it shows a minimal "Turno abierto" summary (opened at, opened by, float, link to the POS). HU-VEN-22 replaces it with VP-22.
- **`/sales/pos`, VP-14 state only** (`pos.page`): header "Punto de venta" with register, branch and user. With no shift: a non-dismissable `rs-modal` with `rs-illustration name="cash-closed"`, "Caja cerrada", "No tienes un turno abierto en la Caja 1. Abre tu turno para empezar a vender.", and the buttons Salir del POS → `/` and Abrir caja → `/sales/cash-register/open`. With a shift: a placeholder body for HU-VEN-02. The full-screen POS layout also comes in HU-VEN-02.
- Each page has loading, error and no-permission states.
- **No new `libs/ui` component is needed**: breadcrumb, page-header, field, select, input/numericInput, note, modal, illustration `cash-closed`, button and toast all exist.

## Tests

- **Unit:** `cash-shift.spec.ts` (float parsing and match), `sales-tabs.spec.ts`, `cash-opening.page.spec.ts`, `pos.page.spec.ts`, and the guard and redirect specs.
- **Integration (real Postgres), `cash-shifts.int.spec.ts`:**
  - Opening works, with audit and outbox in the same transaction.
  - 10 concurrent opens on one register → exactly 1 succeeds, the rest get `CASH_REGISTER_ALREADY_OPEN`.
  - The same user on a second register → `CASH_SHIFT_ALREADY_OPEN_FOR_USER`.
  - A branch outside the membership → 403 `CASH_REGISTER_BRANCH_FORBIDDEN`.
  - Inactive register → `CASH_REGISTER_INACTIVE`.
  - The float mismatch publishes `sales.cash-shift.float-mismatch`; a matching float does not.
  - `current` returns the caller's shift and `null` for another user.
  - `requireOpenShift` throws `CASH_SHIFT_NOT_OPEN`.
  - Tenant isolation.
- **E2E, `apps/erp-e2e/src/cash-opening.spec.ts`:** cashier logs in → POS shows "Caja cerrada" → Abrir caja → types 500,00 → Abrir caja → the POS has no modal.
- `stock-auditor` isn't needed (no stock writes). Run `pnpm nx affected -t lint typecheck test`.

## Open decisions used with a default

- **#3:** one register per SIAT point of sale (seed). The float is typed in at opening; there's no fixed float setting, and the hint says "PENDIENTE del cliente".
- **#17:** a float mismatch only notifies Accounting. It never blocks opening.

## Risks and doubts

- The "se avisa a Contabilidad" notice is only an outbox event for now. Nothing shows it until HU-VEN-24 or HU-VEN-29 consume it.
- Before HU-VEN-23 exists, no shift is ever closed, so the "Último cierre" line will show "Sin cierres anteriores" in every environment.
- Leaving a shift open across days is allowed (no auto-close). HU-VEN-23 or 25 can add a rule.
- The sub-nav change touches HU-VEN-00 files (`sales-tabs.ts`, `sales.routes.ts`); any parallel sales branch must rebase.

## Files expected to change

- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_cash_shift_opening/`
- `apps/api/src/modules/sales/cash/**` (new), `apps/api/src/modules/sales/sales.module.ts`
- `apps/api/src/common/outbox/outbox.service.ts`, `apps/worker/src/common/queues.ts`
- `libs/domain/src/lib/cash-shift.ts` (+spec), `libs/domain/src/index.ts`
- `apps/erp/src/app/features/sales/sales-tabs.ts`, `sales.routes.ts`, `cash/**` (new), `pos/**` (new) and their specs
- `apps/erp-e2e/src/cash-opening.spec.ts` (new)
