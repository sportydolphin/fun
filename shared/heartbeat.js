// Write a job heartbeat to cron_heartbeats — the supabase-js path, shared by the service-role
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
