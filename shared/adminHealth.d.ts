// Types for shared/adminHealth.js. Hand-written for the same reason notifications.d.ts is:
// the module is plain ESM .js so the Node cron can run it directly, and the project doesn't
// enable allowJs.

/** One actionable pipeline problem, ready to page the owner. */
export interface HealthAlert {
  /** Stable id for the kind of problem — the dedupe scope. */
  key:       string
  /** Changes only when the problem itself changes; the sender pages on a new (key, signature). */
  signature: string
  title:     string
  body:      string
}

/** Latest wpbl_ingest_runs row (subset the alerting reads). */
export interface IngestRunRow {
  ran_at:      string
  ok:          boolean
  error_count: number
  errors?:     string[] | null
}

/** Latest wpbl_pbp_validation_runs row (subset the alerting reads). */
export interface ValidationRunRow {
  ran_at: string
  ok:     boolean
}

/** One cron_heartbeats row: a background job's last run. */
export interface Heartbeat {
  job:     string
  ran_at:  string
  ok:      boolean
  detail?: string | null
}

/** A heartbeat-monitored job. `maxAgeMs` null means failure-only (no staleness alarm). */
export interface HeartbeatCheck {
  job:      string
  label:    string
  maxAgeMs: number | null
}

export const INGEST_STALE_MS: number
export const INGEST_STALE_OFFSEASON_MS: number
export const VALIDATION_STALE_MS: number
export const HEARTBEAT_CHECKS: HeartbeatCheck[]

export function healthAlerts(
  rows: {
    ingest?: IngestRunRow | null
    validation?: ValidationRunRow | null
    heartbeats?: Heartbeat[]
    nearGame?: boolean
  },
  nowMs?: number,
): HealthAlert[]
