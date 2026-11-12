// Types for shared/heartbeat.js. Hand-written like the other shared sidecars, so the TypeScript
// cron scripts can import the plain-ESM helper. `supabase` is a supabase-js client; typed as
// unknown-ish here to avoid dragging the client's types into this tiny surface.
export function recordHeartbeat(
  supabase: { from: (table: string) => { upsert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }> } },
  job: string,
  ok: boolean,
  detail?: string | null,
): Promise<void>

/** What a job's `main` may return: `{ ok: false }` marks a run that finished but did not work. */
export interface HeartbeatResult { ok?: boolean; detail?: string | null }

export function runWithHeartbeat<T extends HeartbeatResult | void>(
  supabase: Parameters<typeof recordHeartbeat>[0] | null,
  job: string,
  main: () => Promise<T>,
  options?: { skip?: boolean },
): Promise<T>
