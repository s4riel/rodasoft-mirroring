---
description: Implements a backlog story (e.g. /story HU-INV-06) following the project cycle
argument-hint: HU-INV-xx
---

You are going to implement story **$ARGUMENTS** from the Rodasoft backlog.

## 0. Context (read before writing code)

1. `CLAUDE.md`, `docs/naming-conventions.md`, `docs/ui-library.md`.
2. The story in `docs/backlog/` (grep for the ID). If it is an Inventory story, also `docs/inventory/design-notes.md` and `docs/backlog/decisions.md`.
3. If the story is marked RETIRED, stop and tell me.
4. If it depends on an open decision, use the default value from `decisions.md` and make it **configurable** (per-company setting), never hardcoded.
5. Check what already exists in the repo (Prisma models, modules, `libs/ui` components) and reuse it.

## 1. Plan (stop and wait for my OK)

Deliver a short plan with:
- Acceptance criteria translated into concrete checks.
- Model (Prisma) changes and migration.
- Endpoints (method, route, permission, errors with `code`).
- Screens and `libs/ui` components you will use (or the missing ones and why).
- Tests: unit, integration, E2E.
- Risks or doubts. If anything is ambiguous, ask now, not later.

Do not write code until I approve the plan.

## 2. Implementation (in this order, one commit per step)

1. **Model:** `apps/api/prisma/schema.prisma` + migration (`pnpm db:migrate --name <description>`). Plural snake_case tables, columns with `@map`, `company_id` on business tables and registered in `TENANT_MODELS`.
2. **Domain:** pure rules and state machines in `libs/domain` (money always with `Decimal`).
3. **API:** module in `apps/api/src/modules/<module>`: service with `prisma.tenant`, controller with `@RequirePermissions`, validated DTOs, audit with `AuditService`, effects with `OutboxService.publish(..., { tx })`. Errors `{ status, code, message, details }` with an English `code` that the ERP translates into Spanish.
4. **API tests:** unit and integration (real Postgres for stock, transfers and adjustments, including concurrency).
5. **ERP:** screens in `apps/erp/src/app/features/<module>`, standalone, `OnPush`, signals, only `libs/ui` components and tokens. UI texts in Spanish according to Figma (the story's `IN-xx`/`VE-xx`… screens). Loading, empty, error and no-permission states. ERP routes in English. Permissions with `*rsCan`.
6. **E2E:** Playwright for the story's main flow.

## 3. Non-negotiable rules

- Code, comments, tables, fields, routes and errors in **English**; only the UI in Spanish.
- No stock change outside the movements service. Never `number` for money.
- Document states only with the `libs/domain` machines and audited.
- No loose hex or px in components; hover/pressed/focus states in CSS.
- Do not touch files outside the story's scope. If you need a cross-cutting change, say so in the plan.

## 4. Verification and closing

1. `pnpm nx affected -t lint typecheck test` with no errors. If it fails, fix it; do not disable rules or tests.
2. Run the `reviewer`, `stock-auditor` (if it touches stock) and `ui-checker` (if it touches screens) subagents on the diff and fix what they report.
3. Walk through the acceptance criteria one by one and mark which are covered and by which test.
4. Final commit: `feat(<module>): <summary> (<HU-ID>)` with the story ID.
5. Reply with: what was done, which tests cover each criterion, open decisions you used with a default value, and what is missing (honestly, no sugarcoating).
