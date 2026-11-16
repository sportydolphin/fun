// admin-usage: the Supabase plan, bill and usage for the admin Health tab.
//
// It exists because the bill lives only in the Management API, and the only credential that API
// takes is a personal access token with the whole account's power: it can delete the project.
// That token can never reach the browser, so this function holds it and answers just one caller,
// the site owner, checked by the database's own `is_site_owner()` under the caller's JWT, the
// same gate every `admin_*` RPC uses. Nothing here writes: every call is a GET, plus two
// read-only SQL queries.
//
// Deploy:
//   supabase functions deploy admin-usage
//   supabase secrets set MGMT_API_TOKEN=sbp_...   (supabase.com/dashboard/account/tokens)
// The name cannot start with SUPABASE_: Supabase reserves that prefix for its own injected vars.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as N from './normalize.ts'

const API = 'https://api.supabase.com'
const TIMEOUT_MS = 10_000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

type Got = { ok: true; body: unknown } | { ok: false; error: string }

async function call(token: string, path: string, init?: RequestInit): Promise<Got> {
  try {
    const res = await fetch(API + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}` }
    try { return { ok: true, body: JSON.parse(text) } } catch { return { ok: false, error: 'Response was not JSON' } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Runs one normalizer over one or two answers, carrying the first failure through as the part's error. */
function part<T>(got: Got[], read: (...bodies: unknown[]) => N.Part<T>): N.Part<T> {
  const bad = got.find((g): g is { ok: false; error: string } => !g.ok)
  if (bad && got.every(g => !g.ok)) return { ok: false, error: bad.error }
  return read(...got.map(g => (g.ok ? g.body : null)))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const token = Deno.env.get('MGMT_API_TOKEN')

  // Asked as the caller, never as the service role: the answer must be about whoever sent the JWT.
  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: owner, error: ownerErr } = await caller.rpc('is_site_owner')
  if (ownerErr || owner !== true) return json({ error: 'Not allowed' }, 403)

  if (!token) return json({ error: 'MGMT_API_TOKEN is not set. Run: supabase secrets set MGMT_API_TOKEN=sbp_...' }, 500)

  const ref = new URL(supabaseUrl).hostname.split('.')[0]
  const p = `/v1/projects/${ref}`

  const projectGot = await call(token, p)
  const project = part([projectGot], N.project)
  const slug = project.ok ? project.data.orgSlug : null
  const noSlug: Got = { ok: false, error: 'Organization unknown' }
  const org = (path: string) => (slug ? call(token, `${path.replace('{slug}', encodeURIComponent(slug))}`) : Promise.resolve(noSlug))

  const sql = (query: string) => call(token, `${p}/database/query/read-only`, { method: 'POST', body: JSON.stringify({ query }) })
  const [orgGot, addonsGot, diskGot, utilGot, dbGot, quotaGot, reqGot] = await Promise.all([
    org('/v1/organizations/{slug}'),
    call(token, `${p}/billing/addons`),
    call(token, `${p}/config/disk`),
    call(token, `${p}/config/disk/util`),
    sql(N.DATABASE_SQL),
    sql(N.QUOTA_SQL),
    call(token, `${p}/analytics/endpoints/usage.api-counts?interval=7day`),
  ])
  // A scoped token without this one permission gets a bare 403 here, and the plan drives the
  // estimate and every quota, so the card says what to grant rather than "Forbidden".
  const orgAnswer: Got = !orgGot.ok && orgGot.error.startsWith('HTTP 403')
    ? { ok: false, error: 'The token needs Organization Settings: Read' } : orgGot

  const report: N.UsageReport = {
    fetchedAt: new Date().toISOString(),
    project,
    plan: part([orgAnswer], N.plan),
    addons: part([addonsGot], N.addons),
    disk: part([diskGot, utilGot], N.disk),
    database: part([dbGot], N.database),
    requests: part([reqGot], N.requests),
    quota: part([quotaGot], N.quota),
  }
  return json(report)
})
