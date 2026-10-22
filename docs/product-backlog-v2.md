# Product Backlog for client review (v2, 22 Oct 2026)

> English translation of the v2 backlog hand-off notes. Story titles and UI text in the sheet itself stay in Spanish
> (client-facing content). Story IDs keep the sheet's prefixes (`HU-INV-01`, …) because they are referenced in commits.

- Presentation document (Claude Docs): https://claude.ai/code/artifact/f79de589-5e93-43bf-bc31-8f0b36623d35 (still describes v1).
- v2 as a native, editable Google Sheet: https://docs.google.com/spreadsheets/d/1aDzJgoLNqkcZFkraw6mfv9fegVflNkAo7gsso56mxRs/edit — "Rodalaser Product Backlog v2". Sheets: How to review, Summary, Backlog, Decisions, Screens, Config. Yellow columns are for the client: "Client decision" (Approved / With comments / Rejected, dropdown) and "Client comments".
- The v1 Excel (`Rodalaser_Product_Backlog_v1.xlsx`) and the original Google Drive file (id `1BqAcRUhqH6ajZmBKhwOuAmJu-wMx0Dqm`) are left untouched. A stray xlsx copy exists in Drive (id `1K70irJBgYrCi3vp3sqfniGxBVXoKauYX`) and can be deleted.
- v2 links use the Config sheet (base URL + parameters) with `HYPERLINK` formulas: to change the scaling mode or the file, edit Config only.

## Changes in v2 (Inventory epic)

- **HU-INV-01:** brand logos and industry flags (country of origin); filters with icons (Industry, Category, Subcategory, Brand, Status; no branch filter); chips with flag/logo/icon; Import/Export/New product buttons with distinct icons; empty states with illustration. New screen IN-01e.
- **HU-INV-02 / 08:** Duplicate lets the user choose the industry. **HU-INV-03:** fields with icons. **HU-INV-10:** Import button next to Export. **HU-INV-11 and HU-INV-18:** empty states with illustration.
- **HU-INV-06 (New product):** step 1 shows only categories (8 examples); the subcategory is chosen in step 1 and determines the fields of the next step. Bearings have 6 steps, everything else 4 steps. New screens: IN-03 Categories, IN-03c/d (Seals), IN-03e–j (step 1) and IN-03e2–j2 (step 2).
- **Withdrawn** (the Stock/Counts/Catalogue tabs no longer exist): HU-INV-14, 15, 25 and 26 (status "Withdrawn", no links; their screens IN-04, 04c, 12, 10, 29a–d, 11, 31a–c move to "Inventory (withdrawn)"). Summary: Inventory has 23 active stories + 4 withdrawn; 152 active in total.
- The v1 Inventory links pointed to `71:*` nodes that no longer exist; they were re-mapped to the current nodes of page 08 (ids `262-`, `292-`, `297-`, `318-`).
- **Decisions:** new row 52 "Real list of categories and subcategories (currently examples) and which technical fields each one requires" (HU-INV-01, HU-INV-06); the brand-logos row also depends on them.
- Links of the other epics (Common base, Sales, Invoicing, Web) were copied as-is from v1 and not re-verified.

## Contents (v2)

- 157 stories in 12 epics (152 active + 4 withdrawn from Inventory; 1 extra count row in Summary = Total). 107 designed and 45 to be designed.
- ID prefixes: `HU-BC`, `HU-VEN`, `HU-FAC`, `HU-INV`, `HU-WEB`, `HU-COM`, `HU-CRM`, `HU-CON`, `HU-TIE`, `HU-REP`, `HU-CFG`, `HU-TRV`.
- 238 rows in the "Screens" sheet (each screen with its story, prototype and design).

## Links

- ERP (`JYULL6jvXiwNP8UVvEF7tl`): stories link to prototype pages 08 Inventory, 09 Sales and 10 Invoicing, and page 03 for Common base. The restart point is the Index of each page.
- Website (`aqXKfm4UE3LC1eHiqWMQoS`): pages 03 Desktop and 04 Mobile.
- Format: `figma.com/proto/<key>/<name>?page-id=..&node-id=..&starting-point-node-id=..&scaling=scale-down-width`

## Rules since sending

- Before sending: both Figma files must have "anyone with the link can view" access.
- Do not copy screens again in the prototype pages: the node id changes and the link already sent breaks. Edit directly on the prototype screen.
- Client answers update the "Pending decisions" column and the screens marked "to confirm".
- Pending: publish the library (FilterSidebar with media chips) and accept the update in the web file.

## Out of scope

- AI analysis and AI agents (per contract).
- Consolidated reports across companies.
- Barcode readers.
