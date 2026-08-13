// Database migration runner.
//
// Applies the SQL files in scripts/migrations/ to the Supabase Postgres in filename
// order, recording each one in a `schema_migrations` table so it never runs twice.
// This replaces the old "paste it into the Supabase SQL editor by hand" flow.
//
// The 33 legacy scripts/*.sql files are the pre-runner BASELINE — they were already
// applied to the live DB by hand, so the runner does not touch them. Everything from
// now on goes in scripts/migrations/ and flows through here.
//
// Connection: reads SUPABASE_DB_URL (a postgres://... string). Get it from Supabase →
// Project Settings → Database → Connection string. Use the DIRECT connection (port
// 5432), not the transaction pooler — migrations need session-level DDL. Keep it in
// .env locally and in GitHub Actions secrets for CI.
//
// Usage:
//   npm run migrate                 # apply all pending migrations (alias: `up`)
//   npm run migrate -- status       # show applied + pending, apply nothing
//   npm run migrate -- up --dry-run # list what WOULD run, apply nothing
//   npm run migrate -- new "add foo table"   # scaffold a timestamped migration file
//
// A migration normally runs inside a transaction (all-or-nothing). If a file needs to
// run without one — e.g. CREATE INDEX CONCURRENTLY, which Postgres forbids in a
// transaction — put this on its own line near the top of the file:
//   -- migrate:no-transaction

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

const CONN = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// ── migration file discovery ──────────────────────────────────────────────────
// Version = the filename without .sql. Files sort lexicographically, and the
// timestamp prefix that `new` writes makes that chronological.
async function listMigrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  const entries = await readdir(MIGRATIONS_DIR);
  return entries
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ version: file.replace(/\.sql$/, ''), file }));
}

// ── db helpers ────────────────────────────────────────────────────────────────
function makeClient() {
  if (!CONN) {
    fail(
      'SUPABASE_DB_URL is not set. Add the direct Postgres connection string to .env:\n' +
        '  SUPABASE_DB_URL=postgres://postgres:<password>@db.<ref>.supabase.co:5432/postgres\n' +
        '(Supabase → Project Settings → Database → Connection string → Direct connection.)',
    );
  }
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(CONN);
  return new pg.Client({
    connectionString: CONN,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
}

async function ensureTrackingTable(client) {
  await client.query(`
    create table if not exists public.schema_migrations (
      version     text primary key,
      applied_at  timestamptz not null default now()
    );
  `);
}

async function appliedVersions(client) {
  const { rows } = await client.query('select version from public.schema_migrations');
  return new Set(rows.map((r) => r.version));
}

// ── commands ────────────────────────────────────────────────────────────────
async function cmdStatus() {
  const client = makeClient();
  await client.connect();
  try {
    await ensureTrackingTable(client);
    const applied = await appliedVersions(client);
    const files = await listMigrationFiles();
    const pending = files.filter((m) => !applied.has(m.version));

    console.log(`\nMigrations in scripts/migrations/: ${files.length}`);
    console.log(`Applied: ${applied.size}   Pending: ${pending.length}\n`);

    for (const m of files) {
      const mark = applied.has(m.version) ? '✓ applied' : '· pending';
      console.log(`  ${mark}  ${m.file}`);
    }
    // Applied rows with no matching file (deleted/renamed) — worth flagging.
    const orphans = [...applied].filter((v) => !files.some((m) => m.version === v));
    if (orphans.length) {
      console.log('\n⚠ recorded as applied but no file present:');
      for (const v of orphans) console.log(`    ${v}`);
    }
    console.log('');
  } finally {
    await client.end();
  }
}

async function cmdUp({ dryRun }) {
  const client = makeClient();
  await client.connect();
  try {
    await ensureTrackingTable(client);
    const applied = await appliedVersions(client);
    const files = await listMigrationFiles();
    const pending = files.filter((m) => !applied.has(m.version));

    if (!pending.length) {
      console.log('\n✓ Up to date — no pending migrations.\n');
      return;
    }

    console.log(`\n${pending.length} pending migration(s):`);
    for (const m of pending) console.log(`  · ${m.file}`);
    if (dryRun) {
      console.log('\n(dry run — nothing applied)\n');
      return;
    }
    console.log('');

    for (const m of pending) {
      const sql = await readFile(join(MIGRATIONS_DIR, m.file), 'utf8');
      const noTx = /^\s*--\s*migrate:no-transaction\s*$/m.test(sql);
      process.stdout.write(`→ ${m.file}${noTx ? ' (no transaction)' : ''} ... `);
      try {
        if (noTx) {
          await client.query(sql);
          await client.query('insert into public.schema_migrations(version) values ($1)', [
            m.version,
          ]);
        } else {
          await client.query('begin');
          await client.query(sql);
          await client.query('insert into public.schema_migrations(version) values ($1)', [
            m.version,
          ]);
          await client.query('commit');
        }
        console.log('done');
      } catch (err) {
        if (!noTx) {
          try {
            await client.query('rollback');
          } catch {}
        }
        console.log('FAILED');
        fail(
          `Migration ${m.file} failed and was rolled back:\n  ${err.message}\n` +
            'Fix the file and re-run. Migrations before it stay applied.',
        );
      }
    }
    console.log(`\n✓ Applied ${pending.length} migration(s).\n`);
  } finally {
    await client.end();
  }
}

async function cmdNew(rawName) {
  if (!rawName) fail('Give the migration a name, e.g. npm run migrate -- new "add foo table"');
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
  const slug = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const file = `${ts}_${slug || 'migration'}.sql`;
  await mkdir(MIGRATIONS_DIR, { recursive: true });
  const path = join(MIGRATIONS_DIR, file);
  if (existsSync(path)) fail(`${file} already exists.`);
  await writeFile(
    path,
    `-- ${rawName}\n` +
      `-- Created ${new Date().toISOString().slice(0, 10)}. Applied by scripts/migrate.mjs.\n` +
      `-- Prefer idempotent DDL (create table if not exists / add column if not exists).\n` +
      `-- For CREATE INDEX CONCURRENTLY, uncomment the next line so it runs outside a txn:\n` +
      `-- migrate:no-transaction\n\n`,
    'utf8',
  );
  console.log(`\nCreated scripts/migrations/${file}\n`);
}

// ── entry ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith('-') ? args[0] : 'up';
const dryRun = args.includes('--dry-run');

try {
  if (cmd === 'status') await cmdStatus();
  else if (cmd === 'new') await cmdNew(args.slice(1).filter((a) => !a.startsWith('-')).join(' '));
  else if (cmd === 'up') await cmdUp({ dryRun });
  else fail(`Unknown command "${cmd}". Use: up | status | new "<name>"`);
} catch (err) {
  fail(err.message);
}
