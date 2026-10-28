---
description: Implements an already-approved backlog story plan (e.g. /story-build HU-INV-06). Does not commit.
argument-hint: HU-INV-xx
---

You are going to IMPLEMENT story **$ARGUMENTS** from the Rodasoft backlog, following the approved plan.

## 0. Preconditions (stop and tell me if any fails)

1. `$ARGUMENTS` is not empty and the story exists in `docs/backlog/`.
2. The approved plan exists at `docs/plans/$ARGUMENTS.md`. If it does not, tell me to run `/story-plan $ARGUMENTS` first.
3. The story is not marked RETIRED.
4. Run `git branch --show-current`. If the branch is `main`, stop and ask me to create a branch (suggested name: `feat/<hu-id-in-lowercase>`).
5. Read `CLAUDE.md`, `docs/naming-conventions.md`, `docs/ui-library.md`, the story, the plan and, for Inventory stories, `docs/inventory/design-notes.md` and `docs/backlog/decisions.md`.

If the code contradicts the plan (for example a model changed since), stop and tell me instead of improvising.

## 1. Implementation (in this order; do NOT commit)

1. **Model:** `apps/api/prisma/schema.prisma` + migration (`pnpm db:migrate --name <description>`). Before creating it, check `apps/api/prisma/migrations` for migrations from other unmerged branches; if you see a possible conflict, tell me instead of creating it.
2. **Domain:** pure rules and state machines in `libs/domain` (money always with `Decimal`).
3. **API:** module in `apps/api/src/modules/<module>`: service with `prisma.tenant`, controller with `@RequirePermissions`, validated DTOs, audit with `AuditService`, effects with `OutboxService.publish(..., { tx })`. Errors `{ status, code, message, details }` with an English `code` that the ERP translates into Spanish.
4. **API tests:** unit and integration (real Postgres for stock, transfers and adjustments, including concurrency).
5. **ERP:** screens in `apps/erp/src/app/features/<module>`, standalone, `OnPush`, signals, only `libs/ui` components and tokens. UI texts in Spanish according to Figma. Loading, empty, error and no-permission states. ERP routes in English. Permissions with `*rsCan`.
6. **E2E:** Playwright for the story's main flow.

## 2. Non-negotiable rules

- Code, comments, tables, fields, routes and errors in **English**; only the UI in Spanish.
- No stock change outside the movements service. Never `number` for money.
- Document states only with the `libs/domain` machines, and audited.
- No loose hex or px in components; hover/pressed/focus states in CSS.
- Do not touch files outside the story's scope. If you need a cross-cutting change, stop and tell me.
- Never run `git add`, `git commit` or `git push` unless I explicitly ask. Leave all changes uncommitted.

## 3. Verification and closing

1. Run `pnpm nx affected -t lint typecheck test` with no errors. If it fails, fix it; do not disable rules or tests.
2. Run the `reviewer`, `stock-auditor` (if it touches stock), `refactor` and `ui-checker` (if it touches screens) subagents on the diff and fix what they report.
3. Walk through the acceptance criteria one by one and mark which are covered and by which test.
4. Do NOT commit. Propose the commit message `feat(<module>): <summary> (<HU-ID>)` and wait for my approval.
5. Reply with: what was done, which tests cover each criterion, open decisions you used with a default value, what you could NOT verify (for example Figma fidelity or tests you could not run), and what is missing. Report real command results, not assumptions.
