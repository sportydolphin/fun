#!/usr/bin/env bash
# Restores tonight's dump into a throwaway Postgres and compares it, table by table, with the live
# database. A backup nobody has restored is only a hope: the Supabase-specific parts of this schema
# are exactly what would fail on the night it was needed, and without this nothing would say so.
#
# THE REPO IS PUBLIC, AND SO ARE THESE LOGS. A failed COPY quotes the row it failed on, and a unique
# index error quotes the key, so pg_restore's output goes to a file and only table names and DDL
# errors are printed from it. A failing count prints the table's name, never its rows or its total.
#
# Usage: verify-restore.sh <dump file>. Reads SUPABASE_DB_URL (live) and RESTORE_URL (the scratch one).
set -uo pipefail

dump="$1"
schemas="'public','auth','storage'"

# What a Supabase project has before anything is restored. Vanilla Postgres has none of it, and the
# dump does not carry it because extensions and roles sit outside the schemas it selects.
psql "$RESTORE_URL" -q -v ON_ERROR_STOP=1 <<'SQL' || exit 1
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
create extension pgcrypto schema extensions;
create extension "uuid-ossp" schema extensions;
SQL

# Exit code ignored on purpose: Supabase's own objects (an auth trigger, a publication) can fail here
# without touching a row. The comparison below is what decides whether the backup is good.
pg_restore --dbname="$RESTORE_URL" --no-owner --no-acl "$dump" > restore.log 2>&1

errors=$(grep -c '^pg_restore: error:' restore.log)
echo "pg_restore errors: $errors"
sed -nE \
  -e 's/^pg_restore: error: COPY failed for table "([^"]+)".*/COPY failed: \1/p' \
  -e 's/^pg_restore: error: could not execute query: (ERROR: .{0,160}).*/\1/p' restore.log | sort | uniq -c | head -40

list_tables="select quote_ident(schemaname)||'.'||quote_ident(tablename) from pg_tables where schemaname in ($schemas) order by 1"
psql "$SUPABASE_DB_URL" -Atc "$list_tables" > live-tables.txt || exit 1
psql "$RESTORE_URL" -Atc "$list_tables" > restored-tables.txt || exit 1

failed=0
missing=$(comm -23 live-tables.txt restored-tables.txt)
if [ -n "$missing" ]; then
  echo "Tables missing from the restore:"
  echo "$missing"
  failed=1
fi

# Live keeps moving after the dump's snapshot (`events` takes a row per page view), so a small lead
# is expected. The restore holding MORE than live is allowed the same room, because the ingest and
# the jobs that prune also run overnight.
checked=0
total=0
while read -r table; do
  live=$(psql "$SUPABASE_DB_URL" -Atc "set statement_timeout = 0; select count(*) from $table" | tail -1)
  restored=$(psql "$RESTORE_URL" -Atc "select count(*) from $table" | tail -1)
  if [ -z "$live" ] || [ -z "$restored" ]; then
    echo "Could not count: $table"
    failed=1
    continue
  fi
  diff=$(( live > restored ? live - restored : restored - live ))
  room=$(( live / 100 > 100 ? live / 100 : 100 ))
  if [ "$diff" -gt "$room" ]; then
    echo "Row count differs by more than the allowance: $table"
    failed=1
  fi
  checked=$((checked + 1))
  total=$((total + restored))
done < <(comm -12 live-tables.txt restored-tables.txt)

echo "Compared $checked tables."
# An empty restore compares clean against nothing if the list above ever came back short.
if [ "$checked" -lt 100 ] || [ "$total" -lt 1000 ]; then
  echo "Too little was compared for this to mean anything."
  failed=1
fi

rm -f restore.log
exit "$failed"
