# Agent guide (Claude Code / Cowork)

Rodasoft project: ERP + SIAT + store + website for Rodalaser S.R.L. Read `README.md` first.

## Conventions
- **Code in English, UI in Spanish (Bolivia).** Identifiers, files, tables/columns, DTO and response fields, error codes, permission keys, ERP routes, logs, tests and **comments** are in English. Only user-visible content (labels, buttons, messages, emails) is in Spanish, as in the Figma design. Details and glossary: `docs/naming-conventions.md`. Exception: official SIAT/SIN terms (`SIAT`, `NIT`, `CUF`, `CUFD`, `CUIS`) and the field names of the SIN SOAP contract.
- Angular: standalone components, `ChangeDetectionStrategy.OnPush`, `input()`/`model()`/`signal()`, `@if/@for` control flow, selector with `rs-` prefix. No `NgModule`.
- UI: every visual component lives in `libs/ui` and maps 1:1 to a component of the Figma "Design System" (file key `O7gJBRq4bMcWBGP1DMUKkw`). Tokens only (`var(--…)`, mirroring the Figma variables), no loose hex values or spacing. States (hover/pressed/focus) are CSS, not inputs. See `docs/ui-library.md`.
- `libs/ui` components: **logic, HTML and styles go in separate files** — `<name>.component.ts` (logic only), `<name>.component.html` (`templateUrl`) and `<name>.component.scss` (`styleUrl`), plus `<name>.component.spec.ts`. No inline `template:` or `styles:` in the decorator (specs may use an inline `template` for their test hosts). If a file defines several components, each gets its own files named after its selector (`radio-group.component.html`). All those files, their names, classes and comments are in English; only the visible template text is in Spanish.
- NestJS: one module per domain in `apps/api/src/modules/<module>`; business queries through `prisma.tenant`; permissions with `@RequirePermissions`; side effects with `OutboxService.publish(…, { tx })`.
- Database: tables in plural snake_case, columns in snake_case (`@map`), models in singular PascalCase.
- Money with `Decimal` from `@rodasoft/domain`, never `number`. Dates in the DB as `timestamptz`; business timezone `America/La_Paz`.
- Document state changes only through the machines in `libs/domain/src/lib/state-machine.ts`, audited with `AuditService`.
- Every backlog story (HU-xxx) that is implemented is mentioned in the commit.

## Before finishing a task
`pnpm nx affected -t lint typecheck test` with no errors.
