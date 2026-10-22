# Client decisions · Inventory

Source: "Decisiones" sheet of Product Backlog v2 (22 Oct 2026). None has an answer yet.
Rule: while a decision is open, it is **parameterized in Settings** (per-company settings table) with the default value below. It is not fixed in code.

| No. | Question | Stories | Default value meanwhile |
|---|---|---|---|
| 32 | Required technical fields per type; alternative units, lots and SKU format | HU-INV-06 | Required: code, brand, category, price and, for bearings, d × D × B. A single unit per product. No lots. Sequential internal SKU per company (`RL-000001`) |
| 33 | What happens with brands that do not exist on import? | HU-INV-10 | The row gets an error "Marca no existe"; the brand is not created automatically |
| 34 | Who approves equivalence links? | HU-INV-13 | Permission `inventory.equivalences.approve`; approval not mandatory (saved on linking, with audit) |
| 35 | Is sending a partial transfer (only the correct lines) allowed? | HU-INV-19 | No: sending is blocked while there are errors |
| 36 | Limit amount or quantity and who approves transfers | HU-INV-20 | Setting `transfers.approvalThresholdPieces` and `...Value` per company; no configured limit = never asks for approval. Whoever has `inventory.transfers.approve` approves |
| 37 | Who approves adjustments and from what amount? | HU-INV-23 | Same as 36 with `adjustments.approvalThresholdValue`; permission `inventory.adjustments.approve` |
| 38 | Official brand logos | HU-INV-01, HU-INV-06 | Show the brand name as text; the logo is optional (`logoUrl` null) |
| 52 | Real list of categories and subcategories and which technical fields each requires | HU-INV-01, HU-INV-06 | Seed the 8 sample categories; attributes defined per category (see `design-notes.md`) |

Sample categories (DEMO): Rodamientos, Retenes y sellos, Correas y poleas, Cadenas y piñones, Lubricantes y grasas, Herramientas, Accesorios, Acoples.
Flags per brand (DEMO): SKF→SE, NSK→JP, FAG→DE, INA→DE, NTN→JP, Fersa→ES, Gates→US.

When the client answers, update this table and the Sheet, and change the default value in the settings seed.
