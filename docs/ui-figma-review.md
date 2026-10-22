# UI vs Figma review (components marked "estimated")

Scope: Default variant only, compared by numbers/tokens against the SCSS. Hover/pressed/focus states and screenshots
were NOT compared; a visual pass in `/design-system` is still needed.

## Fixed (CSS only, API unchanged)
- **StatusPill:** text uses `text-primary`; the dot keeps the status colour.
- **Toast:** background `status-*-soft`, radius `sm`, max width 440, shadow `card`, text `text-primary`.
- **Note:** radius `sm`, padding 16.
- **Modal:** width 520 for both variants.
- **Pagination:** all controls bordered, mono font.

- **Badge (all 3 variants, read from Figma):** `brand-primary-soft` bg + `brand-accent-on-page` text for New and Offer (identical in Figma), `bg-surface-2` + `text-muted` for OutOfStock; 1 px `border-default`, radius 8, padding 4/12, weight 400.

## States checked in Figma (Pagination)
- Hover is identical to Default (no visual change in Figma). Focus adds a 2 px `focus-control` ring, offset 4, radius `xs`, around the whole group (code: ring per button).

## States checked in Figma (RadioCard, Tabs, QtyStepper, Breadcrumb)
- **RadioCard (Off):** Hover bg `bg-surface-2`; Pressed bg `action-primary-soft`; Focus keeps surface bg and adds a 2 px `focus-control` ring, offset 5, radius `lg`. Border is always 1 px `border-control`, radius 12, padding 20.
- **Tabs:** Hover, Pressed and Focus look identical to Default (no per-state style). Focus is a 2 px ring, offset 4, radius `xs`, around the whole tab list.
- **QtyStepper:** Hover identical to Default. Pressed fills the whole container with `action-primary-soft`. Focus is a 2 px ring, offset 5, fully rounded, around the whole stepper. The minus is `text-muted`.
- **Breadcrumb (3 levels):** Hover and Pressed identical to Default (no link styling change). Focus is a ring, offset 4, radius `xs`, around the whole trail. Current item is `label/md` `text-primary`; earlier items `body/md` `text-muted`.
- Not read: Steps, Accordion, PriceRange, Avatar, Modal, Tooltip, EmptyState, Skeleton states (Disabled states of all components also unread).

## Still different (need markup/API work)
- **StatusPill:** Figma ~34 px high with a 16 px icon instead of the 6 px dot (code: 24 px).
- **Toast / Modal:** Figma close is a text button ("Cerrar"), code is an icon button.
- **Pagination:** Previous/Next carry text in Figma, icon only in code.
- **Tabs:** padding 12/16, text always `text-primary`, own 2 px indicator, no container border.
- **Steps:** gap 16, fixed 40 px connector, check on completed steps, subtitle (Completado / Paso actual / Pendiente).
- **RadioCard:** radius 12, padding 20, `bg-surface-2`, 1 px border when selected.
- **EmptyState:** 24 px icon without circle, gap 16 (code: 56 px circle, gap 8).
- **Skeleton:** Figma is a static composed card, code is one animated block.
- **PriceRange:** missing 20-bar histogram and min/max fields (feature work).
- **Tooltip:** weight 400 in Figma, 500 in code.
- **QtyStepper:** mono font for value and ± in Figma.
- **Accordion:** missing `bg-surface` and 16 px horizontal padding.
- **Avatar:** background `bg-surface-2`, weight 500, size `label/md`.
- **Breadcrumb:** matches.

## Applied (states)
- **Tabs:** per-tab 2 px indicator (`action-primary` active, `border-default` inactive), padding 12/16, `label/md` `text-primary`, no container border. Figma has no hover/pressed, so hover/pressed darken the inactive indicator (`border-control` / `text-muted`) as an affordance.
- **QtyStepper:** mono font; Pressed fills the whole container with `action-primary-soft`; removed the border-darkening hover (not in Figma), kept per-button hover.
- **RadioCard:** radius 12, padding 20, selected card uses `bg-surface-2` + 1 px `action-primary` border; hover on a selected card uses `action-primary-soft` so it still gives feedback.
- **Breadcrumb:** unchanged; hover underline is kept as link affordance (Figma has none).
- Focus rings stay per control with the shared 2 px offset (Figma draws one ring around the group; per control is better for keyboard users).
