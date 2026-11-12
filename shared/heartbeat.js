// Write a job heartbeat to cron_heartbeats: the supabase-js path, shared by the service-role
// cron scripts (the push sender, the recap sync). One row per job: when it last ran and whether
// it succeeded, read by the /admin Health group and the health-alert cron (shared/adminHealth.js).
//
// The drift checker writes the SAME row a different way, by SQL over its own direct pg
// connection, because that is the client it already holds; there is no single write helper that
// fits both, and a two-line upsert is not worth forcing one. See scripts/check-wpbl-drift.mjs
// and scripts/migrations/…_add_cron_heartbeats.sql.
//
// NEVER THROWS: a heartbeat that fails to record must not turn a clean run into a red one. The
// upsert returns its error rather than raising, and this logs and moves on.

export async function recordHeartbeat(supabase, job, ok, detail = null) {
  const now = new Date().toISOString()
  const { error } = await supabase.from('cron_heartbeats').upsert({
    job, ran_at: now, ok, detail, updated_at: now,
  })
  if (error) console.error(`  heartbeat write failed (non-fatal) for ${job}: ${error.message}`)
}

/**
 * Runs a job's `main` and records how it went, so a cron script joins the /admin Health group
 * with one line at its entrypoint instead of a heartbeat call at every exit.
 *
 * `main` may return `{ ok: false, detail }` for a run that finished without throwing but did not
 * do its job (every source down, say): the watchers deliberately exit 0 then, so the workflow
 * stays green, and without this the panel would call that run Fresh. A throw records a failure
 * with the message and is rethrown, so each script's own crash handling is unchanged.
 *
 * `skip` is for runs that are not the job: a dry run, a status read, a test post, or a local run
 * on the anon key, which RLS would refuse anyway.
 */
export async function runWithHeartbeat(supabase, job, main, { skip = false } = {}) {
  let result
  try {
    result = await main()
  } catch (err) {
    if (!skip && supabase) await recordHeartbeat(supabase, job, false, String(err?.message ?? err).slice(0, 300))
    throw err
  }
  if (!skip && supabase) {
    const ok = result?.ok !== false
    await recordHeartbeat(supabase, job, ok, result?.detail ? String(result.detail).slice(0, 300) : null)
  }
  return result
}
