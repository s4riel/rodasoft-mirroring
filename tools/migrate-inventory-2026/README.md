# Migration of `INVENTARIO ALMACEN 2026.xls`

One-off tooling that turns the legacy inventory workbook into files in the ERP import template
(`plantilla-productos.xlsx`) so they can be loaded with **Productos → Importar** (HU-INV-10). It never writes products
itself; the importer's preview is the review step. Outputs go outside the repository (`D:\Rodalaser\docs\migracion-2026`).

## Run order

```bash
# 1. .xls -> CSV (Windows, needs the Access Database Engine OLE DB provider)
powershell -File tools/migrate-inventory-2026/extract.ps1 -Source "D:\Rodalaser\docs\INVENTARIO ALMACEN 2026.xls" -Out "D:\Rodalaser\docs\migracion-2026\inventario-2026.csv"

# 2. import files + review tables (resumen.txt, revision-*.csv, muestra-medidas.csv, pendientes.xlsx)
npx tsx --tsconfig tsconfig.base.json tools/migrate-inventory-2026/build-template-files.ts D:/Rodalaser/docs/migracion-2026/inventario-2026.csv D:/Rodalaser/docs/plantilla-productos.xlsx D:/Rodalaser/docs/migracion-2026

# 3. check the files with the importer's own rules, no database
npx tsx --tsconfig tsconfig.base.json tools/migrate-inventory-2026/dry-run.ts D:/Rodalaser/docs/migracion-2026

# 4. brands, countries and categories the rows refer to (dry run; add --apply to write)
npx tsx --tsconfig tsconfig.base.json --env-file=.env tools/migrate-inventory-2026/prepare-reference-data.ts D:/Rodalaser/docs/migracion-2026/inventario-2026.csv rodalaser

# unit tests of the dimension tables
npx tsx --tsconfig tsconfig.base.json --test tools/migrate-inventory-2026/dimensions.spec.ts
```

Then, in the ERP: Productos → Importar → "Solo crear nuevos", one `productos-importar-NN.xlsx` at a time.

## Decisions baked in

- Code = `codigo` without its ` / BRAND` marker; brand = `marca` through `brand-aliases.json`.
- Unit cost = `valorado / cantidad` (4 decimals): the file shows costs rounded to 2 decimals.
- Stock goes to `Stock HK-01`; the other stock columns stay empty. Unit stays `UN`, country comes from the brand.
- Categories come from `category-map.json` (first matching rule wins).
- d / D / B are derived only for the ISO families in `dimensions.ts`, and only inside the matching subcategory. The rest
  of the bearings go to `pendientes.xlsx`: they would fail the importer's `DIMENSIONS_REQUIRED` rule.
- Duplicated (brand, code) lines are merged (quantities and values added up) and listed in `revision-duplicados.csv`.
