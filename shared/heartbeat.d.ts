// Types for shared/heartbeat.js. Hand-written like the other shared sidecars, so the TypeScript
// cron scripts can import the plain-ESM helper. `supabase` is a supabase-js client; typed as
// unknown-ish here to avoid dragging the client's types into this tiny surface.
export function recordHeartbeat(
  supabase: { from: (table: string) => { upsert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }> } },
  job: string,
  ok: boolean,
  detail?: string | null,
): Promise<void>
