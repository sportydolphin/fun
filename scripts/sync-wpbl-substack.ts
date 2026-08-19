#!/usr/bin/env node
/**
 * sync-wpbl-substack.ts — run the Substack mirror by hand.
 *
 * The sync itself lives in src/wpbl/substackSync.ts, shared with the `wpbl-substack-sync`
 * edge function that runs it hourly on pg_cron. This file is the Node door onto it: read
 * env, adapt a supabase-js client to the small SyncDb interface, print progress, set an exit
 * code. Anything with a judgement in it belongs in the shared module, not here.
 *
 * The scheduled copy runs on Supabase because Substack serves Cloudflare's JavaScript
 * challenge to datacenter address space and GitHub Actions cannot get through it. A laptop
 * can, which is what makes this script still worth having: it is the way to force a refresh
 * without waiting for the hour, and the way to re-check the mirror when something looks off.
 *
 * Usage:
 *   npm run substack-sync -- --dry-run   # print what it would write, write nothing
 *   npm run substack-sync                # upsert
 *
 * Required env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
 * --dry-run needs no service-role key: everything it reads is public.
 */
import { createClient } from '@supabase/supabase-js'
// @ts-expect-error: no types installed for `ws`; it is only handed to supabase-js below.
import ws from 'ws'
import { runSubstackSync, type SyncDb } from '../src/wpbl/substackSync'

const DRY_RUN = process.argv.includes('--dry-run')
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before running')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  // Node < 22 has no native WebSocket; supabase-js builds a realtime client on construction
  // even though this job only ever does plain reads and an upsert.
  realtime: { transport: ws },
})

const db: SyncDb = {
  async select<T>(table: string, columns: string): Promise<T[]> {
    const { data, error } = await supabase.from(table).select(columns)
    if (error) throw new Error(`Loading ${table} failed: ${error.message}`)
    return (data ?? []) as T[]
  },
  async upsert(table, rows, onConflict) {
    const { error } = await supabase.from(table).upsert(rows as never[], { onConflict })
    if (error) throw new Error(`Upsert into ${table} failed: ${error.message}`)
  },
}

runSubstackSync(db, { dryRun: DRY_RUN, log: line => console.log(line) })
  .catch(err => { console.error('❌ ', err instanceof Error ? err.message : err); process.exit(1) })
