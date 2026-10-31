# Brand logos

Logo files of the brands live in `apps/erp/public/brands/` and are served by the ERP at `/brands/<file>`.
`BRAND_LOGO_FILES` in `libs/domain/src/lib/brand-logos.ts` maps each brand name to its file; the reference-data seed
(`apps/api/prisma/seed-reference.ts`) fills the `logo_url` of a brand with it when the brand has none. The product list,
the filter chips, the product sheet and the equivalents card already draw `logoUrl`, and a brand without a logo keeps
showing its initials. A test (`brand-logos.spec.ts`) checks that every mapped file exists and that SVGs carry no scripts.

## Sources

All files come from Wikimedia Commons (`https://commons.wikimedia.org/wiki/File:<title>`), downloaded on 2026-10-31.
The logos are trademarks of their owners. "Public domain" on Commons is a copyright statement about the artwork (simple
text logos); it does not transfer the trademark. They are used to identify the brands sold in the catalog.

| Brand | File | Commons title | License on Commons |
|---|---|---|---|
| SKF | `skf.svg` | `SKF logo.svg` | Public domain |
| INA | `ina.svg` | `INA logo.svg` | Public domain (trademarked) |
| NSK | `nsk.png` | `NSK Ltd logo2.png` | Public domain (trademarked) |
| NTN | `ntn.svg` | `NTN Corporation Logo.svg` | Public domain (trademarked) |
| Timken | `timken.svg` | `Timken.svg` | Public domain |
| Nachi | `nachi.svg` | `Nachi-Fujikoshi Corp. Logo.svg` | Public domain (trademarked) |
| Sachs | `sachs.svg` | `ZF Sachs logo.svg` | Public domain (trademarked) |
| Valeo | `valeo.svg` | `Valeo Logo.svg` | Public domain (trademarked) |
| Fersa | `fersa.png` | `Fersa Bearings - high resolution.png` | Public domain |
| NKE | `nke.jpg` | `NKE Logo.jpg` | CC BY-SA 4.0 |

### Attribution (CC BY-SA 4.0)

`nke.jpg`: "NKE Logo.jpg" by NKE Bearing (own work), licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0), from Wikimedia Commons. The file is used unchanged.

## Brands without a logo

FAG, Koyo, IKO, Gates and Peer have no usable file on Commons; the rest of the reference brands are generic or
distributor labels. They show their initials. To add one: copy the official file to `apps/erp/public/brands/`, add it
to `BRAND_LOGO_FILES`, add its row above, and run the seed (`pnpm db:seed`) so the brand gets its `logo_url`.
