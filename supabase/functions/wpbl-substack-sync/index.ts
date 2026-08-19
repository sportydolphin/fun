/**
 * wpbl-substack-sync — the Substack mirror, on Supabase, hourly.
 *
 * WHY THIS EXISTS AS AN EDGE FUNCTION. Substack serves Cloudflare's JavaScript interstitial
 * ("Just a moment...") to datacenter address space, and it covers every host it owns: her
 * publication's archive API, her publication's RSS feed, and substack.com itself all return
 * 403 from a GitHub Actions runner. Seven scheduled runs, seven failures. Supabase's egress
 * is not challenged: probed with pg_net before any of this was written, all three answer 200,
 * the feed included at its full size. That last part is why this is a real fix rather than a
 * degraded one, since bodies are where players, clubs, the game link and the clip count all
 * come from.
 *
 * The sync itself is src/wpbl/substackSync.ts, shared with the npm script so the matching
 * rules cannot drift between a hand run and the scheduled one. This file is the HTTP door:
 * check the caller, adapt the client, run it, report.
 *
 * Scheduled by pg_cron; see scripts/migrations for the job. Hourly is generous for someone
 * who posts about twice a week, and a post is no less good on the site an hour later.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { runSubstackSync, type SyncDb } from '../../../src/wpbl/substackSync.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/** The `role` claim out of a bearer token, or null. Signature is not checked here: Supabase
 *  verifies it before the handler runs, and re-verifying without the project secret would be
 *  theatre. Anything malformed returns null and is refused. */
function jwtRole(authHeader: string): string | null {
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return (JSON.parse(json) as { role?: string }).role ?? null
  } catch {
    return null
  }
}

Deno.serve(async (req: Request) => {
  // Service-role only.
  //
  // Supabase has already verified the JWT's SIGNATURE before this handler runs, so what is
  // left to check is which key it was. That matters because the anon key is also a perfectly
  // valid project JWT, and it ships inside the browser bundle: platform verification alone
  // (which is all wpbl-ingest relies on) would let any visitor trigger a sync. Reading the
  // `role` claim is the actual authorisation check.
  //
  // Deliberately NOT a string comparison against SUPABASE_SERVICE_ROLE_KEY. The cron job
  // sends the key stashed in Vault, and a rotated or re-issued key leaves those two valid but
  // no longer identical, which fails closed in the most confusing way possible: a 401 on a
  // scheduled job whose credentials are correct. The claim survives rotation.
  if (jwtRole(req.headers.get('Authorization') ?? '') !== 'service_role') {
    return new Response(JSON.stringify({ error: 'service_role key required' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  // `{"mode":"dry-run"}` computes and reports without writing, which is how to check what a
  // change would do against live data before letting it near the table.
  let dryRun = false
  try {
    const body = await req.json()
    dryRun = body?.mode === 'dry-run'
  } catch { /* no body is the normal case: a plain scheduled run */ }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
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

  // Progress is collected rather than only logged, so a run's reasoning is visible in the
  // HTTP response as well as in the function logs. A cron invocation discards it; a human
  // poking the function with curl gets the same narrative the npm script prints.
  const lines: string[] = []
  const log = (line: string) => { lines.push(line); console.log(line) }

  try {
    const result = await runSubstackSync(db, { dryRun, log })
    return new Response(JSON.stringify({ ok: true, ...result, log: lines }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('wpbl-substack-sync failed:', message)
    return new Response(JSON.stringify({ ok: false, error: message, log: lines }, null, 2), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
