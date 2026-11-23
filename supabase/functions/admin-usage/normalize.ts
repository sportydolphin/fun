// Turns the Supabase Management API's answers into the one shape the admin Health card draws.
//
// Pure and dependency-free so vitest can load it (index.ts imports Deno-only modules), and so
// the client can import its types without pulling in anything that runs.
//
// Only documented `/v1` endpoints. The dashboard's own bill and usage come from `/platform/...`,
// which answers a personal access token with 401 "Unsupported access token" (tried Nov 15, 2026):
// it takes only a dashboard session. So the bill is an estimate from published prices
// (src/lib/supabaseUsage.ts), and storage and active users are counted in SQL. Every field is
// checked, and a surprise becomes an `error` on that one part, never a throw that blanks the card.

export type Part<T> = { ok: true; data: T } | { ok: false; error: string }

export interface ProjectInfo { ref: string; name: string; region: string; status: string; orgSlug: string | null; postgres: string | null }
export interface Addon { type: string; name: string; amount: number | null; interval: string | null }
export interface DiskInfo { sizeGb: number | null; type: string | null; usedBytes: number | null; totalBytes: number | null }
export interface DatabaseInfo { bytes: number; tables: Array<{ name: string; bytes: number }> }
export interface Requests { rest: number; auth: number; storage: number; realtime: number }
export interface Quota { storageBytes: number; storageObjects: number; activeUsers: number }

export interface UsageReport {
  fetchedAt: string
  project: Part<ProjectInfo>
  plan: Part<string>
  addons: Part<Addon[]>
  disk: Part<DiskInfo>
  database: Part<DatabaseInfo>
  requests: Part<Requests>
  quota: Part<Quota>
}

type Json = Record<string, unknown>
const obj = (x: unknown): Json | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Json) : null)
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null)
const str = (x: unknown): string | null => (typeof x === 'string' ? x : null)

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

export function project(raw: unknown): Part<ProjectInfo> {
  const r = obj(raw)
  const ref = str(r?.ref)
  if (!r || !ref) return fail('Unexpected project response')
  const db = obj(r.database)
  return {
    ok: true,
    data: {
      ref,
      name: str(r.name) ?? ref,
      region: str(r.region) ?? '',
      status: str(r.status) ?? 'UNKNOWN',
      // `organization_id` is the deprecated name for the same slug; older projects may only carry it.
      orgSlug: str(r.organization_slug) ?? str(r.organization_id),
      postgres: str(db?.version),
    },
  }
}

export function plan(raw: unknown): Part<string> {
  const p = str(obj(raw)?.plan)
  return p ? { ok: true, data: p } : fail('No plan on the organization')
}

export function addons(raw: unknown): Part<Addon[]> {
  const list = obj(raw)?.selected_addons
  if (!Array.isArray(list)) return fail('Unexpected add-ons response')
  return {
    ok: true,
    data: list.map(a => {
      const v = obj(obj(a)?.variant)
      const price = obj(v?.price)
      return {
        type: str(obj(a)?.type) ?? 'addon',
        name: str(v?.name) ?? str(v?.id) ?? 'Add-on',
        amount: num(price?.amount),
        interval: str(price?.interval),
      }
    }),
  }
}

export function disk(config: unknown, util: unknown): Part<DiskInfo> {
  const attrs = obj(obj(config)?.attributes)
  const m = obj(obj(util)?.metrics)
  if (!attrs && !m) return fail('Unexpected disk response')
  return {
    ok: true,
    data: {
      sizeGb: num(attrs?.size_gb),
      type: str(attrs?.type),
      usedBytes: num(m?.fs_used_bytes),
      totalBytes: num(m?.fs_size_bytes),
    },
  }
}

/** The SQL `index.ts` sends to the read-only query endpoint. One row: the size, then the largest tables. */
export const DATABASE_SQL = `
select pg_database_size(current_database())::bigint as bytes,
  (select coalesce(json_agg(t), '[]'::json) from (
    select n.nspname || '.' || c.relname as name, pg_total_relation_size(c.oid)::bigint as bytes
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'm', 'p') and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
    order by pg_total_relation_size(c.oid) desc limit 8) t) as tables`

export function database(raw: unknown): Part<DatabaseInfo> {
  const row = obj(Array.isArray(raw) ? raw[0] : null)
  const bytes = num(row?.bytes)
  if (!row || bytes == null) return fail('Unexpected query response')
  const tables = Array.isArray(row.tables) ? row.tables : []
  return {
    ok: true,
    data: {
      bytes,
      tables: tables.flatMap(t => {
        const name = str(obj(t)?.name)
        const b = num(obj(t)?.bytes)
        return name && b != null ? [{ name, bytes: b }] : []
      }),
    },
  }
}

/** `usage.api-counts?interval=7day` returns one row per bucket; the card wants the week's total. */
export function requests(raw: unknown): Part<Requests> {
  const r = obj(raw)
  if (r?.error) return fail(typeof r.error === 'string' ? r.error : str(obj(r.error)?.message) ?? 'Analytics error')
  const rows = r?.result
  if (!Array.isArray(rows)) return fail('Unexpected request-count response')
  const sum = (k: string) => rows.reduce((s: number, x) => s + (num(obj(x)?.[k]) ?? 0), 0)
  return {
    ok: true,
    data: {
      rest: sum('total_rest_requests'),
      auth: sum('total_auth_requests'),
      storage: sum('total_storage_requests'),
      realtime: sum('total_realtime_requests'),
    },
  }
}

/**
 * Storage and active users, the two quotas the database can count. "Active" is a session made or
 * refreshed in the last 30 days, which is what Supabase bills as a monthly active user: counting
 * `last_sign_in_at` instead missed everyone who stays signed in (8 against 52 on Nov 15, 2026).
 */
export const QUOTA_SQL = `
select (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects)::bigint as storage_bytes,
  (select count(*) from storage.objects)::bigint as storage_objects,
  (select count(distinct user_id) from auth.sessions
    where coalesce(refreshed_at, updated_at, created_at) > now() - interval '30 days')::bigint as active_users`

export function quota(raw: unknown): Part<Quota> {
  const row = obj(Array.isArray(raw) ? raw[0] : null)
  const storageBytes = num(row?.storage_bytes)
  const storageObjects = num(row?.storage_objects)
  const activeUsers = num(row?.active_users)
  if (storageBytes == null || storageObjects == null || activeUsers == null) return fail('Unexpected query response')
  return { ok: true, data: { storageBytes, storageObjects, activeUsers } }
}
