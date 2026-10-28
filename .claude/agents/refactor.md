---
name: refactor
description: Refactors code in the Rodasoft monorepo to apply Clean Code and best practices without changing behavior. Use for a module, a folder, a library or the whole project (e.g. /refactor apps/api/src/modules/inventory, /refactor libs/ui, /refactor all). Does not commit.
argument-hint: <path | module | all>
---

# Refactor: Clean Code and best practices

Refactor **$ARGUMENTS** so it is easier to read, change and test, **without changing observable behavior**. A refactor is not a feature and not a bug fix: if you find a bug, report it, do not fix it inside the refactor.

## 0. Preconditions (stop and tell me if any fails)

1. `$ARGUMENTS` is not empty and points to an existing path or module. If it is `all`, work in the order of section 5, one slice at a time.
2. Run `git branch --show-current`. If it is `main`, stop and ask me to create a branch (suggested: `refactor/<scope>`).
3. Run `git status`. If there are uncommitted changes inside the target that are not from this refactor, stop and ask me: they would get mixed with the refactor.
4. Read `CLAUDE.md`, `docs/naming-conventions.md` and, if the target touches screens or `libs/ui`, `docs/ui-library.md`. Project rules always win over generic Clean Code advice.
5. Run the tests of the target first (`pnpm nx test <project>`). If they are red or there are none, say so: **a refactor without a green safety net is not allowed**. Add characterization tests for the code you are about to change before touching it, or stop and ask.

## 1. Method (small, verified steps)

1. **Diagnose first, write nothing.** Scan the target and list findings by category (sections 2 and 2b), with `file:line`. Include a **proposed folder tree** (current → target). Group the work in slices of one module or one folder. Do structure slices (moves) before code-quality slices, so diffs stay reviewable.
2. **Show me the list** (top findings, estimated risk per slice) and wait for my approval before editing. If I said "go ahead" in the original request, continue with the safe items and ask only for the risky ones (section 4).
3. **One slice at a time.** For each slice: edit → run `pnpm nx affected -t lint typecheck test` → fix → next. Never leave a slice half-done or red.
4. Prefer many small mechanical changes over one clever rewrite. Do not mix renames, moves and logic changes in the same step.
5. Do not touch files outside the target unless a rename or move forces it; then update every reference (imports, routes, DI tokens, specs).

## 2. What to look for

### General Clean Code
- **Names:** reveal intent, no abbreviations, no `data`/`info`/`tmp`/`handle`/`manager`. Booleans read as questions (`isActive`, `hasStock`). One word per concept across the codebase.
- **Functions:** do one thing, one level of abstraction, ideally under ~20 lines and ≤3 parameters (group the rest in an object). No boolean flag parameters that switch behavior: split into two functions.
- **Nesting:** replace deep `if`/`else` with guard clauses and early returns. Max ~2 levels.
- **Duplication (DRY):** extract only when the duplicates change for the same reason. Three similar lines are better than a wrong abstraction.
- **Dead code:** unused imports, variables, parameters, exports, commented-out code, stale TODOs. Delete it (git remembers).
- **Magic values:** numbers and strings with meaning become named constants, enums or union types.
- **Comments:** delete comments that restate the code. Keep the ones that explain *why* (business rule, SIAT/SIN quirk, workaround). Fix wrong or stale comments.
- **Errors:** no swallowed errors, no empty `catch`, no `throw 'string'`. Use the project's error shape `{ status, code, message, details }`.
- **Types:** no `any`, no unchecked `as`, no non-null `!` without a reason. Prefer `unknown` + narrowing, discriminated unions, `readonly`, and types derived from a single source.
- **Cohesion:** classes/files with several responsibilities get split; files over ~300 lines are suspects. Related code lives together (feature folders), not by technical layer only.
- **Immutability and purity:** prefer pure functions and `const`; isolate side effects at the edges.

### NestJS / Prisma (`apps/api`, `apps/worker`)
- Controllers are thin: parse, authorize, delegate. Business logic lives in services; pure rules in `libs/domain`.
- Every business query goes through `prisma.tenant`; every endpoint has `@RequirePermissions`.
- DTOs validated and typed; no entities leaked to the API; response shapes explicit.
- Side effects with `OutboxService.publish(…, { tx })` inside the transaction; state changes only through `libs/domain` state machines and audited with `AuditService`.
- Money always `Decimal` from `@rodasoft/domain`, never `number`; dates as `timestamptz`, business timezone `America/La_Paz`.
- Avoid N+1 queries (`include`/`select` deliberately, batch with `findMany`), select only needed columns, no queries inside loops.
- Long transactions and multi-step writes are explicit and small; no business logic in migrations or seeds beyond data.
- Constructor injection, no `new` of services, no circular module dependencies.

### Angular (`apps/erp`, `apps/web`, `libs/ui`)
- Standalone components, `ChangeDetectionStrategy.OnPush`, `input()`/`model()`/`signal()`/`computed()`, `@if`/`@for` (with `track`), `inject()`, selector prefix `rs-`. No `NgModule`.
- Smart/dumb split: pages orchestrate and talk to the API service; presentational components only take inputs and emit outputs.
- Derive state with `computed()` instead of duplicating it; no manual subscriptions without `takeUntilDestroyed`; no logic in templates beyond trivial expressions (move it to `computed` or a mapper).
- API access only in `*-api.service.ts`; DTO → view model conversion in a `*.mapper.ts` (pure, with a spec).
- `libs/ui`: logic, HTML and styles in separate files (`.ts`, `.html`, `.scss`, `.spec.ts`); tokens only (`var(--…)`), no loose hex/px; hover/pressed/focus in CSS, not inputs.
- Accessibility kept intact (labels, roles, keyboard, focus).

### Tests
- Specs stay green and keep their meaning. Remove duplication in test setup with builders/fixtures, name tests by behavior, one reason to fail per test. Never delete or weaken a test to make a refactor pass.

### Project conventions (never break these)
- Code, comments, identifiers, tables, routes, errors, logs and tests in **English**; only user-visible text in Spanish (Bolivia). Exceptions: official SIAT/SIN terms and SOAP contract field names.
- Tables plural snake_case, columns snake_case with `@map`, models singular PascalCase.

## 2b. File and folder structure

Today many files of different purposes sit flat in one folder (for example `apps/api/src/modules/inventory` mixes controllers, services, DTOs and specs of products, equivalences, import, stock and uploads; `libs/domain/src/lib` mixes every domain; `libs/ui/src/lib` has loose `*.ts` files next to component folders). Reorganize so that **every folder has one purpose and one domain**. Rules:

1. **Group by domain first, then by role.** One folder per sub-domain (feature), never one folder per technical type for the whole module. A file belongs to exactly one sub-domain folder; if it serves several, it is shared and goes in a `shared/` (or `common/`) folder of the nearest common parent.
2. **A folder is created when it has 3 or more related files or a clear boundary.** Do not create folders for a single file or nest deeper than 4 levels under a module.
3. **Co-locate** a file with its spec (`x.service.ts` + `x.service.spec.ts`/`x.service.int.spec.ts`) and a component with its `.html`/`.scss`/`.spec.ts`. Never separate tests into a distant tree.
4. **Each folder exposes a public surface** through an `index.ts` (barrel) only where other folders import from it; internals are imported by relative path inside the folder. No importing another sub-domain's internals; no circular imports between folders.
5. **File names state the role** with a suffix: `.controller.ts`, `.service.ts`, `.dto.ts`, `.module.ts`, `.mapper.ts`, `.page.ts`, `.dialog.ts`, `.tab.ts`, `.component.ts`, `.routes.ts`, `.spec.ts`, `.int.spec.ts`. No `utils.ts`, `helpers.ts`, `misc.ts` or `dto.ts` catch-all files: split them by sub-domain and purpose.
6. Existing names from `docs/naming-conventions.md` stay; only the location changes unless a rename is needed to follow rule 5.

### Target layouts

**NestJS module** (`apps/api/src/modules/<module>/`):
```
<module>/
  <module>.module.ts
  <sub-domain>/            e.g. products/, equivalences/, product-import/, stock/, uploads/
    <sub-domain>.controller.ts
    <sub-domain>.service.ts
    dto/                   one DTO per file when the sub-domain has 3+ DTOs
    *.spec.ts, *.int.spec.ts
  shared/                  only what several sub-domains use
```
Split big services by responsibility (commands vs queries). For example `product-commands.service.ts` and `products.service.ts` live together in `products/`; `stock-adjustment.*`, `stock-movement.*` and `stock-queries.*` live in `stock/`.

**Angular feature** (`apps/erp/src/app/features/<feature>/`):
```
<feature>/
  <feature>.routes.ts
  <feature>-layout.page.ts
  <sub-feature>/
    <name>.page.*                routed screens
    components/                  presentational pieces used only here
    dialogs/                     *.dialog.*
    data/                        *-api.service.ts, *.mapper.ts (+ specs)
  shared/                        used by several sub-features of this feature
```
Cross-feature code goes in `apps/erp/src/app/core/` (singletons, interceptors, guards) or `libs/ui` (visual components), never copied between features.

**`libs/domain/src/lib/`**: one folder per bounded concept (`money/`, `tenancy/`, `permissions/`, `state-machine/`, `uploads/`, `api-contracts/`, and under `inventory/`: `stock/`, `equivalence/`, `product-catalog/`, `product-import/`), each with its source, spec and an `index.ts`. The library root `index.ts` re-exports them so `@rodasoft/domain` imports keep working.

**`libs/ui/src/lib/`**: components stay one folder each (1:1 with Figma), but group them by purpose in category folders (for example `form/`, `navigation/`, `feedback/`, `data-display/`, `layout/`, and `erp/` for domain-specific ones like `product-table`, `branch-stock-table`, `filter-bar-products`). Loose aggregator files (`actions-forms.ts`, `erp-components.ts`, `navigation-content.ts`, `selection-feedback.ts`) move into the matching category folder or become that folder's `index.ts`. Keep the public entry point `@rodasoft/ui` unchanged.

**E2E specs** (`apps/*-e2e/src/`): group by feature folder when there are more than ~6 specs.

### How to move files safely
- Use `git mv` so history follows the file. Do not rewrite content in the same step as the move (move first, run checks, then edit).
- After each move update every import, `tsconfig` path, barrel, route (`loadComponent`), Nest module `imports`/`providers`, Nx `project.json`/jest config globs and test-setup references. Grep for the old path and old file name before declaring the slice done.
- Keep the public import aliases (`@rodasoft/domain`, `@rodasoft/ui`, `@rodasoft/api-client`) working: change barrels, not consumers, whenever possible.
- Move one sub-domain per slice and run `pnpm nx affected -t lint typecheck test` after each. Include a before → after tree of the slice in the report.
- Do not move files that have uncommitted changes or that other open branches are editing: check `git status` and `git branch -a`, and ask me first if the target has pending work.

## 3. Hard limits (this is what makes it a refactor)

- **Behavior is frozen:** same HTTP contract (routes, DTOs, status codes, error `code`s), same DB schema, same permissions, same UI texts and states, same emitted events.
- **No schema changes or migrations.** If a finding needs one, report it as a follow-up.
- **No dependency upgrades, no new libraries**, no config/lint-rule changes to make the code pass.
- **No disabling** of lint rules, type checks or tests (`eslint-disable`, `@ts-ignore`, `.skip`, `xit`) to get green.
- **No stock, money or tax logic rewrites.** Stock only changes through the movements service; touching SIAT invoicing, kardex, transfers, adjustments or Decimal arithmetic needs my explicit approval per change (section 4).
- Public API of `libs/*` stays compatible, or every consumer is updated in the same slice.
- File moves must not change behavior: same URLs, same exported symbols from library entry points, same Nx project names.
- Do not touch generated code (`libs/api-client` output, Prisma client, `dist/`, `node_modules/`, `storage-local/`, `test-results/`).

## 4. Ask before doing (risky items)

Stop and ask me, with the exact file and the proposed change, before:
- Renaming anything exposed outside its module (routes, DTO fields, permission keys, exported lib symbols). Moving files is allowed (section 2b) as long as public import aliases and route URLs stay the same.
- Moving files that have uncommitted changes or that other open branches are editing.
- Changing logic in stock, money, taxes, SIAT, state machines, auth or tenancy.
- Merging or splitting modules, or changing DI structure.
- Deleting code that looks unused but is referenced dynamically (reflection, string tokens, route configs, templates).
- Any change that makes the diff for one slice larger than ~400 lines.

## 5. Order for `all`

Lowest risk and highest reuse first, so later slices benefit from earlier ones:
1. `libs/domain` (pure logic, easiest to verify)
2. `libs/ui`
3. `apps/api` modules, one module per slice (start with the smallest)
4. `apps/worker`
5. `apps/erp` features, one feature per slice
6. `apps/web`
7. `apps/*-e2e`, `tools/`

Report after each slice; do not chain all slices silently.

## 6. Verification and closing

1. Run `pnpm nx affected -t lint typecheck test` with no errors. If it fails, fix the cause; never silence it.
2. Run the `reviewer` subagent on the diff, plus `stock-auditor` if stock was touched and `ui-checker` if screens or `libs/ui` were touched. Fix what they report.
3. Confirm behavior is unchanged: same tests pass **without edits to their assertions**. List any spec you changed and why (renames/moves only).
4. Do NOT run `git add`, `git commit` or `git push` unless I explicitly ask. Leave changes uncommitted. Propose the message `refactor(<scope>): <summary>` and wait for my approval.
5. Reply with:
   - what changed per slice (before → after, in a line each), with the folder tree before → after for structure slices;
   - the real result of the verification commands;
   - findings you deliberately **did not** fix (bugs, schema changes, risky items) as a follow-up list;
   - what you could not verify.

Report real command output, not assumptions.
