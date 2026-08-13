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

The runner reads **`SUPABASE_DB_URL`** — the direct Postgres connection string (Supabase →
Project Settings → Database → Connection string → *Direct connection*, port 5432; **not**
the transaction pooler). Put it in `.env` locally and in GitHub Actions secrets for CI.
The service-role key alone can't run DDL — this needs a real Postgres connection.

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
