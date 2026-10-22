# UI library (`libs/ui`, `@rodasoft/ui`)

Angular implementation of the **Design System in Figma**. Rule: every component maps 1:1 to a Figma
component set, uses only Figma tokens, and exposes the Figma variant properties as inputs.

- Figma file: https://www.figma.com/design/O7gJBRq4bMcWBGP1DMUKkw (`fileKey` **O7gJBRq4bMcWBGP1DMUKkw**, "Design System").
  A copy of the structure also exists at `8ij8DrrSzzPeXDDfa1o4uE`; the library above is the source of truth.
- Pages: `01 Foundations` (0:1), `02 Base Components` (16:214), `03 ERP Components` (16:215),
  `04 Store & Web` (16:216), `05 Patterns` (16:217), `06 Docs & QA` (16:218).
- Component masters live in the frame **"BaseLibrary · Native masters"** (node `23:82`) of page 02. Each child frame is a
  component set (e.g. `Button` 23:465); its children are the variants (`Variant=Primary, State=Hover`).
- Tokens: `src/styles/_tokens.scss` mirrors the Figma variables (Primitives, Color Light/Dark, Brand Company 1/2,
  Spacing, Radius, Typography, Effects). Figma `group/name` becomes CSS `--group-name`. Typography has one utility
  class per text style: `label/md` -> `.rs-text-label-md`.

## Modes

`<html data-theme="light|dark">` and `<html data-brand="rodalaser|company2">` are independent (2 x 2 matrix).
Components must look right in all four combinations **without any mode-specific code**: only semantic tokens.
Brand colors are accents (price, badges, brand focus, logo); the main action is monochrome (`--action-primary`).

## Mapping Figma -> Angular

| Figma | Angular |
|---|---|
| Component set `Foo` | `FooComponent`, selector `rs-foo` (attribute selector on native elements: `button[rsButton]`) |
| Variant property `Variant=Primary` | `variant = input<'primary' | ...>('primary')` (property camelCase, values lower-kebab) |
| `Size=SM/MD/LG` | `size = input<'sm' | 'md' | 'lg'>('md')` (heights from `--size-control-*`) |
| `State=Default/Hover/Pressed/Focus` | **CSS only**: `:hover`, `:active`, `:focus-visible`. Never an input |
| `State=Disabled` | `disabled` input / native attribute + `:disabled`/`[aria-disabled]` styles |
| `State=Error` | `invalid` input mirrored to `aria-invalid="true"` |
| `Checked=On/Off`, `Selected`, `Open`, `Active`, `Current`, `Levels` | `checked`/`selected`/`open`/`active`/`current`/`levels` inputs or `model()` |
| Boolean/instance-swap properties (`ShowMedia`, `Icon`) | boolean inputs or projected content (`<rs-icon>`) |
| Text properties (`Label`, `Title`, `Description`) | inputs or `<ng-content>`; **never hardcode Spanish text inside a component**; Spanish copy lives in the app/showcase |

## Coding rules

- Standalone, `ChangeDetectionStrategy.OnPush`, signal inputs (`input()`, `model()`, `output()`), `@if/@for`, no NgModule.
- Form controls (Input, Select, Textarea, Checkbox, Radio, Switch, QtyStepper, Chip groups) implement `ControlValueAccessor`.
- Logic, template and styles in **separate files** (`templateUrl` / `styleUrl`; no inline `template`/`styles` in the decorator), **tokens only** (`var(--...)`). No hex values, no loose px other than
  geometry that Figma specifies and has no token (comment it).
- Focus ring: `outline: var(--stroke-focus) solid var(--focus-control); outline-offset: var(--focus-offset)`; on dark
  surfaces brand-aware focus uses `--brand-focus-on-dark`.
- Accessibility: correct roles/ARIA, keyboard support, visible focus, contrast pairs from the Figma "Política de contraste".
- Files: `src/lib/<name>/<name>.component.ts` + `<name>.component.html` + `<name>.component.scss` + `<name>.component.spec.ts`. If a file holds several components, name each one's html/scss after its selector (`radio-group.component.html`). Public API through `src/index.ts`.
- Code is English; visible default text is Spanish only in the showcase / apps.
- A showcase page (`/design-system` in the ERP, dev only) renders every component with all its variants and states in the
  same layout as the Figma frames, so visual review is a side-by-side comparison.

## Status

Written without a compiler and partly without Figma access (the Figma MCP quota ran out on 2026-10-22). Anything marked
"estimated" below must be re-checked against the Figma frames side by side in `/design-system` once the quota resets.

| Group | Components | Source | Status |
|---|---|---|---|
| Foundations | tokens (Primitives, Color Light/Dark, Brand 1/2, Spacing, Radius, Typography, Effects), `.rs-text-*` | Figma variables (read) | done |
| Icons | 62 IconGlyph + `info` + chevron aliases | Figma export (read) | done |
| Actions & forms | Button, IconButton, Input, Select, Textarea, Field, Checkbox, Radio, Switch | Figma (most states read; hover/pressed/focus of Radio, Switch, Textarea, Checkbox-off inferred) | review |
| Selection & feedback | FilterChip, ChipMedia, FieldMedia, Flag | Figma (read) | review |
| | RadioCard, StatusPill, Note, Toast, Tooltip, Modal, EmptyState (+Illustrated, 14 illustrations), Skeleton, Avatar, Badge | **estimated** (existing code + design-system.md + tokens) | re-check vs Figma |
| Navigation & content | Sidebar, ContextBar, PageHeader (List), SubNav (Inventory), Stepper | Figma page 03 (read) | review |
| | Tabs, Steps, Breadcrumb, Pagination, QtyStepper, Accordion, PriceRange | **estimated** (only frame sizes read) | re-check vs Figma |
| ERP components | ProductTable, FilterBarProducts, RowMenu, ProductThumb | implemented (HU-INV-01) | re-check vs Figma |
| | KpiCard, StockFlag (extracted from ProductTable) | implemented (HU-INV-03), names from the Figma plan | re-check vs Figma |
| | DataField (`2198:4942`), BranchStockTable (`2200:5023`, with Row Current) | Figma page 03 (read, HU-INV-03) | review |
| | DocTable, CategoryCard… | not started | next |
| Store & Web | header, product card, footer… | not started | next |

Known gaps: dark values of `action/primary-hover|pressed` are assumed (`TODO(figma)` in `_tokens.scss`); illustrations and
flags are redrawn (the Figma asset host is not reachable from the build sandbox) and should be replaced by the exported SVGs.
