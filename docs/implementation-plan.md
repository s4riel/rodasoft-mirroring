# Rodalaser — code implementation plan

Version 1 · 19 Oct 2026. Role: architecture and full-stack development. Frontend: Angular. Backend: proposal below.
Assumption: 1 main full-stack developer (if someone joins, Web/Store can be parallelised).

> English translation of `claude/plan-implementacion-codigo.md`. Identifiers follow [`naming-conventions.md`](naming-conventions.md)
> (e.g. `empresa_id` → `company_id`, `ventas.anular.aprobar` → `sales.cancellations.approve`).

## 1. Constraints that drive the architecture

- Deadline: Milestone 2 on 18 Dec (approved design + store in testing), Milestone 3 on 5 Feb 2027, buffer until 12 Feb. About 15 weeks left.
- Budget USD 3,500, and server + DB for 12 months provided by the vendor → cheap, simple-to-operate infrastructure.
- 156 stories in 12 epics; the design of Wave 2 and Wave 3 is still in progress → code starts with what is already designed (Common base, Inventory, Sales/POS, Invoicing) and advances in parallel with the design.
- Risk #1: SIAT (XML signing, CUIS/CUFD, contingency, certification in the pilot environment). Tackled in the first week.
- 2 companies (multi-tenant), each with its own NIT, signature, SIAT credentials and brand (red / green); company resolved by URL; several branches and several warehouses per branch; a single price per product and company; no consolidated reports.

## 2. Recommended backend

**Recommendation: NestJS (TypeScript) + PostgreSQL + Redis/BullMQ, as a modular monolith.**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| NestJS + PostgreSQL | Same language as Angular, shared types, module/DI structure similar to Angular, ecosystem for SOAP, signed XML, queues and OAuth | Decimals and transactions need discipline | **Chosen** |
| .NET 8 / Spring Boot | Very solid for accounting and signed XML | Second language for a single developer; slower to iterate | Discarded (schedule) |
| Laravel | Productive, fast CRUD | No shared types with Angular; queues and SOAP less comfortable | Discarded |
| Supabase / BaaS | Free auth and CRUD | SIAT, accounting and stock logic does not fit a BaaS; vendor dependency | Discarded |

**No microservices.** A modular monolith with clear boundaries (one Nest module per domain) and a separate *worker* process for queued tasks. If it ever grows, each module is already separable.

### Backend building blocks

| Need | Choice |
|---|---|
| Framework | NestJS, REST API + OpenAPI (Swagger) → generated Angular client |
| DB | PostgreSQL 16, `numeric(14,2)` for money, `numeric(14,4)` for costs and exchange rates |
| ORM | Prisma (migrations and productivity). Heavy queries (kardex, reports, VAT books) with raw SQL / views |
| Multi-tenant | Shared schema with `company_id` on every business table; Prisma extension that injects the filter; Postgres RLS as a second barrier on critical tables (invoices, stock, journal entries) |
| Queues and scheduled jobs | BullMQ + Redis: SIAT submission, contingency packages, daily CUFD renewal, catalogue sync, e-mails, Excel imports |
| SIAT | `soap` (SOAP client), `xml-crypto` + `node-forge` (XMLDSig signing with each company's .p12), `zlib` (gzip), SHA-256; in-house CUF generator with unit tests |
| Auth | E-mail + password (argon2) and Google OAuth (passport); short-lived access JWT + refresh in httpOnly cookie; user↔company↔branch membership |
| Permissions | RBAC with fine-grained permissions (`sales.cancellations.approve`, `inventory.costs.view`…) using CASL; guard per endpoint + directive in Angular |
| Product search | Postgres `pg_trgm` + full-text over code, brand, size and equivalences. Meilisearch only if the store needs it |
| Files | Cloudinary: photos and data sheets (invoice XML/PDF and the 3D model storage still to be decided) |
| PDF | HTML templates → PDF with Playwright (Chromium) in the worker; 80 mm ticket and letter size |
| Excel | `exceljs` to import (migration, transfer lists, homologation) and export |
| Payments | `PaymentProvider` interface with adapters: bank QR, card (local aggregator), manual transfer with receipt. Idempotent webhooks |
| E-mail | Transactional SMTP (Resend/SES or similar) |
| Observability | JSON logs (pino), Sentry, Uptime Kuma; own audit in `audit_logs` table |

### Mandatory patterns

- **Kardex as an immutable ledger:** stock is the sum of movements (`inventory_movements`), with a balance-per-warehouse table updated in the same transaction. Weighted average cost on receiving purchases/imports.
- **Transactional outbox:** every sale, invoice, purchase or collection writes an event to `outbox_events` inside its transaction; the worker publishes it → automatic journal entries, SIAT submission, e-mails. Nothing is lost if SIAT or e-mail fail.
- **Idempotency** in POS payment, invoice issuing and payment webhooks (`Idempotency-Key`).
- **Fiscal numbering** per company + point of sale with row locking (`SELECT … FOR UPDATE`), never with in-memory counters.
- **Explicit state machines** (invoice, cancellation, transfer, purchase order, receipt, quotation, order, period) with validated and audited transitions.
- **Generic approvals:** a single `approval_requests` entity (discount, cancellation, cash difference, return, transfer over limit, purchase order, credit) → the VP-25 / FS-18 inbox.
- **Money:** never `float`; `decimal.js` in backend and frontend; multi-currency Bs/USD with the exchange rate stored per document.

## 3. Angular frontend

- Current Angular with standalone components, signals, new control flow and zoneless change detection; NgRx SignalStore for module state (POS, cart, long transfers).
- **In-house UI library** (`libs/ui`) that mirrors the Figma Design System library: tokens exported from Figma variables → CSS custom properties (Style Dictionary); per-company brand mode with `data-brand="rodalaser|company2"`. Base: Angular CDK (overlay, drawer, a11y, virtual scroll, table). Components 1:1 with Figma: Sidebar, ContextBar, PageHeader, FilterBar, DocTable, Drawer, Modal, DatePicker, ActionMenu, Numpad, Ticket, PosResultRow, PosCartLine, PosCustomer, JournalLines, AccountTreeRow, AgingBar, ReconcileRow, Dropzone, Kanban, Timeline… Storybook to review them.
- Typed forms (Reactive Forms) with shared validators (NIT, amounts).
- HTTP client generated from OpenAPI (`openapi-generator` or `orval`) → zero DTOs written by hand twice.
- Company by URL: `rodalaser.erp.<domain>` and `company2.erp.<domain>` (subdomain) or route prefix; an interceptor sends the company, the backend validates it against the user's membership.
- POS: full screen, keyboard focus (Enter adds, shortcuts), no barcode reader; debounced search over `pg_trgm` and equivalences.
- Large tables (transfers of 100+ products, VAT books): server-side pagination + virtual scroll.

### Decision to confirm: Next.js or Angular for the web and the store?

The project plan says Next.js. With a single developer I recommend **Angular SSR/SSG for the web and the store too**: one framework, one shared UI library, shared types, one pipeline. The 3D bearing that comes apart on scroll is done with Three.js + GSAP ScrollTrigger in both. Next.js only pays off if the React ecosystem is a priority. **If accepted, the monorepo is 100% Angular + NestJS.**

## 4. Monorepo structure (Nx)

```
apps/
  erp/          Angular (ERP, 2 companies by URL)
  web/          Angular SSR (site + store, multi-brand)
  api/          NestJS (HTTP)
  worker/       NestJS standalone (BullMQ: SIAT, PDF, e-mails, imports)
libs/
  ui/           Design System (tokens + components)
  api-client/   Client generated from OpenAPI
  domain/       Shared types, enums, state machines and validations
  siat/         SIAT client: SOAP, signing, CUF, catalogues (with tests)
  backend/<module>/  identity, tenancy, catalog, inventory, sales, pos-cash, invoicing,
                     purchases, crm, accounting, store, reports, settings, approvals, files
infra/          docker-compose, Caddy, backup scripts
```

## 5. Data model (core)

- **Tenancy:** company (NIT, brand, SIAT environment), branch, warehouse, siat_point_of_sale, user, membership (user × company × branches × role), role, permission.
- **Catalogue:** product (per company, single price), brand, family/category (22), sector, technical attributes per brand (d, D, B, seal, clearance…), **equivalence_group** (equivalent bearings across brands, with their feature differences), SIN homologation (SIN product code, unit of measure).
- **Inventory:** warehouse_stock, inventory_movement (kardex), transfer + lines (draft → pending approval → sent → partially/fully received), adjustment, physical count, minimum/maximum levels.
- **Sales:** quotation, order (reservation), sale, line, payment (QR/card/transfer/cash/mixed/credit), return, cash_shift, cash_movement, cash_count, discount_rule.
- **Invoicing:** cuis, cufd (per point of sale and day), invoice (CUF, signed XML, status, reception codes), credit_debit_note, cancellation, significant_event, contingency_package, cafc, synchronised SIN catalogues, vat_book/period.
- **Purchasing:** supplier (Bs/USD), purchase_order, receipt, import (DUI, costs, apportionment), purchase_invoice, accounts_payable, supplier_payment.
- **CRM:** customer (verified NIT, discount %, term 15/30/45/date), contact, opportunity, activity, segment, credit_line.
- **Accounting:** chart_of_accounts, journal_entry + lines, posting_rule (event → entry), accounts_receivable, collection, bank, statement, reconciliation, period.
- **Cross-cutting:** approval_request, audit_log, outbox, file, import (Excel batches with per-row errors).

## 6. SIAT invoicing — technical approach

1. **Spike in week 1:** register the system in the pilot environment, obtain CUIS and CUFD, sign and send a test purchase-sale invoice, query its status. If this does not work, the whole schedule shifts.
2. Isolated, tested `libs/siat`: CUF generation, XML assembly per sector, XMLDSig signing with each company's certificate, compression, hash, submission, receipt of codes and error messages.
3. **Asynchronous issuing with fast response:** the sale is confirmed, the invoice stays "Sending" and the worker submits it; the POS shows the result within seconds (polling or SSE).
4. Contingency: if SIAT does not respond, a significant event is activated, invoices are issued offline (signed, with a valid CUFD) and the worker builds and sends the package on recovery; handling of observed packages.
5. Scheduled tasks: renew CUFD daily per point of sale, sync catalogues (activities, legends, reasons, event types), expiry warnings for signature and credentials.
6. Certification: run the tests the SIN requires in the pilot environment (Dec–Jan) and move to production per company in go-live week.
7. Credentials and the .p12 are stored encrypted (AES-GCM with a key outside the DB).

## 7. Infrastructure and deployment

- **Production (12 months included):** 1 VPS with 4 vCPU / 8 GB running Docker Compose: Caddy (automatic TLS), api, worker, web SSR, PostgreSQL, Redis. ERP as static files served by Caddy or a CDN. Choose a region with good latency to Bolivia.
- **Staging:** small VPS or the same one with another compose file; Milestone 2 base ("store in testing").
- **Backups:** daily `pg_dump` + WAL/14–30 day retention in external storage; monthly restore test (backup clause of the contract).
- **CI/CD:** GitHub Actions: lint, test, build, Docker image, SSH deploy to staging on every merge to `main` and to production on tag.
- **Quality:** Jest/Vitest unit tests in domain and SIAT; integration tests with real Postgres (Testcontainers) for stock, invoicing and journal entries; Playwright E2E on 5 critical flows (login, POS sale with invoice, transfer, purchase with receipt, store checkout).

## 8. Schedule (2-week sprints)

| Sprint | Dates | Content | Output |
|---|---|---|---|
| S0 | 19 Oct–1 Nov | Nx monorepo, CI, staging, Docker; auth (e-mail + Google), companies/branches/warehouses by URL, roles and permissions; tokens and first UI components (Shell, Sidebar, ContextBar, PageHeader, DocTable, FilterBar, Modal, Drawer); **SIAT spike in pilot** | Login and ERP skeleton on staging; test invoice accepted by SIAT |
| S1 | 2–15 Nov | Catalogue (products, brands, families, attributes, **equivalences**), Excel migration importer, inventory (stock per warehouse, kardex, adjustments, minimums), transfers with search, paste list and Excel, approval | Usable inventory with test migrated data |
| S2 | 16–29 Nov | POS and sales (search with equivalents, cart, customer, mixed payment, ticket), cash (opening, movements, count), quotations and orders with reservation, **online SIAT issuing** from the sale | Complete sale invoiced in pilot |
| S3 | 30 Nov–13 Dec | Invoicing: cancellation with approval, credit/debit notes, rejection and NIT verification, contingency and packages, fiscal settings, homologation; store API (catalogue, product page with stock, cart, checkout, gateway in sandbox); web/store in Angular SSR (Home with 3D bearing, catalogue, product page, cart, checkout) | **Milestone 2 (18 Dec): store in testing on staging** |
| — | 14–18 Dec | Stabilisation, demo and review with the client | Milestone 2 approval |
| — | 21 Dec–4 Jan | Reduced pace: returns, prices and discount rules, VAT books, approvals inbox; SIAT certification tests | |
| S4 | 5–18 Jan | Purchasing (suppliers Bs/USD, PO with approval, receipt, imports with apportionment and average cost, purchase invoices, accounts payable); CRM (customers with discount % and credit term, Kanban opportunities, follow-up, segments, credits) and impact on POS | Purchase→stock→purchase-book cycle |
| S5 | 19 Jan–1 Feb | Accounting (chart of accounts, automatic entries from outbox, manual, receivables, banks and statement import, reconciliation, ledger, balance sheets, income statements, closings); reports; store management; permissions and states (loading, empty, error, no permission) in all modules; **real migration rehearsal** | Complete system on staging |
| S6 | 2–5 Feb (+ buffer to 12) | Move to SIAT production per company, final migration, web for the 2nd company (green mode), training, manuals, go-live | **Milestone 3 (5 Feb)** |

Rule: each module is closed with its backlog stories (HU-xxx) marked and its main E2E passing.

## 9. Risks and mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Slow SIAT certification or signature/credentials not delivered | Blocks go-live | Spike in S0; request signature, credentials and modality for both companies in Phase 0 now |
| Payment gateway: contract with bank/aggregator takes weeks | Store without payment at Milestone 2 | Start the process this week; Milestone 2 with sandbox or manual transfer with receipt |
| Scope (156 stories) vs. 1 developer | Delay | Prioritise the operating core (Inventory, POS, SIAT); in Accounting and Reports deliver the essentials first and agree the rest as an improvement within support |
| Wave 2/3 design still in progress | Rework | Schedule modules only once their prototype is approved; UI components 1:1 with the Figma library |
| Dirty migration data (Excel) | Wrong stock and balances | Importer with per-row validation and error report; 2 rehearsals before go-live |
| Open Phase 0 questions (approval limits, maximum credit, apportionment, CAFC) | Incomplete logic | Make them configurable in Settings instead of hard-coding |

## 10. What is needed from the client before 1 Nov

- Digital signature and SIAT credentials for both companies, modality and document sector(s).
- QR and card provider (or a decision to start with transfer).
- Current Excel files for products, stock per warehouse, customers and suppliers (real sample).
- Name, branches and brand of the 2nd company; domain(s).
- Approval limits (transfers, discounts, cancellations, POs) and who approves.
