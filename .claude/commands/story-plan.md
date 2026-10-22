---
description: Plans a backlog story (e.g. /story-plan HU-INV-06) and saves the approved plan. Writes no code.
argument-hint: HU-INV-xx
---

You are going to PLAN story **$ARGUMENTS** from the Rodasoft backlog. This command never writes application code.

## 0. Context (read before planning)

1. If `$ARGUMENTS` is empty or the ID does not exist in `docs/backlog/`, stop and ask me which story to plan.
2. Read `CLAUDE.md`, `docs/naming-conventions.md` and `docs/ui-library.md`.
3. Read the story in `docs/backlog/` (grep for the ID). If it is an Inventory story, also read `docs/inventory/design-notes.md` and `docs/backlog/decisions.md`.
4. If the story is marked RETIRED, stop and tell me.
5. If it depends on an open decision, use the default value from `decisions.md` and make it **configurable** (per-company setting), never hardcoded.
6. Check what already exists in the repo (Prisma models, modules, `libs/ui` components, permissions, existing tests) and reuse it.
7. Check `apps/api/prisma/migrations` and the other local branches (`git branch`) for migrations or work that could conflict with this story.

## 1. Plan

Deliver a short plan with these sections:

- **Acceptance criteria → concrete checks.** One line per criterion, with the test that will prove it.
- **Model:** Prisma changes and the migration name. Plural snake_case tables, columns with `@map`, `company_id` on business tables and registered in `TENANT_MODELS`.
- **Domain:** pure rules and state machines needed in `libs/domain`.
- **API:** endpoints (method, route, permission, error `code`s), services, audit and outbox usage.
- **ERP screens:** screens (`IN-xx`/`VE-xx`… from the story), `libs/ui` components to use, and any missing component with the reason it cannot be reused.
- **Tests:** unit, integration (real Postgres for stock, transfers and adjustments, including concurrency) and the E2E flow.
- **Open decisions used with a default value.**
- **Risks and doubts.** If anything is ambiguous, ask now, not later.
- **Files expected to change**, so parallel sessions can detect overlaps.

Do not write application code. Do not run `git add`, `git commit` or `git push`.

## 2. Save the approved plan

Wait for my feedback. When I approve, save the final plan to `docs/plans/$ARGUMENTS.md` (create the folder if needed) and tell me to run `/story-build $ARGUMENTS`, preferably in a fresh session. Leave the file uncommitted.
