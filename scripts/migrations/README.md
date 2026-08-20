# scripts/migrations/

Ordered SQL migrations applied by [`scripts/migrate.mjs`](../migrate.mjs). This is the
schema-change path **going forward** — no more pasting SQL into the Supabase editor by hand.

## Baseline

The 33 legacy `scripts/*.sql` files (`create_*`, `add_*`, `seed_*`) are the **pre-runner
baseline**: they were already applied to the live database by hand, so the runner does not
run them and they stay where they are as a record of the starting schema. This folder holds
only changes made *after* the runner existed.

## Commands

```bash
npm run migrate                        # apply all pending migrations
npm run migrate -- status              # show applied + pending, change nothing
npm run migrate -- up --dry-run        # preview what would run
npm run migrate -- new "add foo table" # scaffold a timestamped migration file
```

The runner reads **`SUPABASE_DB_URL`** — a Postgres connection string. In Supabase click
**Connect → Connection string → *Session pooler*** (port 5432). Use the session pooler, not
"Direct connection" (IPv6-only without the paid IPv4 add-on, so it won't reach from most
home networks or GitHub Actions) and not the *transaction* pooler (6543, no session-level
support). The password in the string is the **database password** (Settings → Database →
Reset database password if unknown) — not the anon/service-role key. Put it in `.env`
locally and in GitHub Actions secrets for CI.

## Conventions

- **Filename:** `YYYYMMDDHHMMSS_short_description.sql` (what `new` generates). Files apply in
  filename order; the timestamp keeps that chronological and collision-free.
- **Tracking:** each applied file is recorded in a `schema_migrations` table (created
  automatically) and never runs twice.
- **Transactions:** each migration runs in a transaction and rolls back on error. If a file
  can't run in one (e.g. `CREATE INDEX CONCURRENTLY`), put `-- migrate:no-transaction` on its
  own line near the top.
- **Prefer idempotent DDL** (`create table if not exists`, `add column if not exists`) so a
  file is safe even if it's ever partially applied.
- **Never edit an applied migration** — its effect is already in the DB. Add a new one.
- **"Recorded as applied but no file present"** means someone applied schema and recorded the
  version without committing the file, so a database rebuilt from this repo would be missing
  it. The fix is to reconstruct the file from the live schema and commit it under **exactly
  the recorded version name**: the runner's version string is the filename minus `.sql`, so a
  matching name is seen as already applied and never re-runs, while any other name re-runs it
  against production. `20260817225409_add_wpbl_predict_game.sql` was rebuilt this way on
  Aug 20, 2026 and is the worked example.
