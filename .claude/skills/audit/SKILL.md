---
name: audit
description: Audit part of the site (a page, a feature, the data, loading, accessibility, security, dead code) with the project's own checks, and report verified findings ranked by severity. Use when the user says audit, review, check over, look for problems in, or how solid is X.
---

# Audit

An audit is a report, not a fix. Find problems, prove each one, rank them, and change nothing
until the user picks what to fix.

## 1. Scope

Name the target in one line (a route, a directory, a table, "loading", "the whole WPBL section").
Read the scoped `CLAUDE.md` beside that code and the doc in `docs/` that guards it (CLAUDE.md,
"Where to look") before running anything: most real bugs here are the traps they list.

## 2. Run the checks that fit

Pick by target; skip the rest. Run independent ones in parallel, long ones in the background.

| Target | Checks |
|---|---|
| Any code | `npm run typecheck`, `npm run lint` (must print nothing), `npx vitest related --run <files>`, `npm run knip` |
| A diff or branch | `/code-review` at the effort the user asked for (default `medium`) |
| UI, a page | `npm run sweep -- --routes <routes> --shift` (overflow, loading shift, 3:1 outlines, axe, chart text), `--ellipsis` for cut names, `--behavior` for stats boards with filters. Replay setup in docs/CI.md, "The layout sweep" |
| Loading, bundle size | `npm run size`, `npm run analyze`; read docs/LOADING.md first and measure on production, never `vite preview` |
| WPBL data | `npm run event-audit` (play log vs box score), `npm run check-drift`, `npm run check-retro`, `npm run check-roster-forks`, `npm run validate-pbp`, `npm run check-postseason`. All need `.env` |
| Database, security | Supabase MCP `get_advisors` (security and performance), scripts/migrations/CLAUDE.md (SELECT policies, `security definer` callers, `anon` grants), `/security-review` for a diff, docs/ADMIN_ANALYTICS.md for `admin_*` |
| Pages Functions, routing | `npm run check-functions`, `src/wpbl/__tests__/routes.test.ts`, functions/CLAUDE.md |
| Copy | `npx vitest run src/__tests__/houseRules.test.ts`, plus a read against the House rules (labels not narration, no em dashes, American spelling, no softball framing) |

Then read the code itself for what no check catches: the traps index in CLAUDE.md, error paths,
empty and loading states, both themes, a phone width.

## 3. Verify

A finding goes in the report only once it is shown: a failing command, a query result, a
screenshot, or a line of code with the input that breaks it. Mark anything not shown as
"unconfirmed" or drop it. A finding the baseline or a code comment already accepts is not one.

## 4. Report

In chat, most severe first, one line each: `file:line`, what is wrong, how it shows up for a
reader. Group by severity (breaks something / wrong data / polish). End with what the audit did
not cover. Then ask which to fix; fixing goes through `ship` when the user wants it landed.

Stop any dev server or background task the audit started.
