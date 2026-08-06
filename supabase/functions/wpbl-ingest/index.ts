// wpbl-ingest — pulls the WPBL official public feed and mirrors it into Supabase.
//
// The league publishes a JSON API at https://stats.womensprobaseballleague.com/v1 with
// no auth. This function reconciles it against our tables (readable team slugs + player
// uuids, keyed to the feed by api_id) and upserts games, box-score lines, fielding,
// play-by-play, and TrackMan pitch tracking. It is idempotent — safe to run on a cron.
//
// Invoke (POST, JSON body, all fields optional):
//   { "mode": "all" | "active", "gameId": "<api id>", "force": false }
//   • mode "all"    — (re)ingest every game's boxscore. Use for the initial backfill.
//   • mode "active" — DEFAULT. Only fetch boxscores for games that aren't already
//                     'final' in our DB (i.e. scheduled→live→final transitions). Cheap
//                     enough to run every couple minutes.
//   • gameId        — ingest just this one game (implies its boxscore, ignores mode).
//   • force         — with mode "active", also re-fetch games already final (corrections).
//
// Deploy:
//   supabase functions deploy wpbl-ingest
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically. The service role
// bypasses RLS, so this writes freely; the public still reads through the RLS policies.
// See scripts/add_wpbl_api_ingest.sql for the schema and scripts/wpbl_cron.sql for the
// schedule.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FEED = 'https://stats.womensprobaseballleague.com/v1'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// ─── small helpers ────────────────────────────────────────────────────────────
const n = (v: unknown): number => {
  const x = parseInt(String(v ?? ''), 10)
  return Number.isFinite(x) ? x : 0
}
const s = (v: unknown): string => (v == null ? '' : String(v))
// "2.2" innings → outs (2 innings + 2 outs = 8).
const ipToOuts = (ip: unknown): number => {
  const t = s(ip).trim()
  if (!t) return 0
  const [w, f] = t.split('.')
  return (n(w)) * 3 + Math.min(n(f), 2)
}
// Strip accents + case/space for name matching ("Maïka Dumais" ↔ "maika dumais").
const normName = (name: string): string =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

// Levenshtein edit distance, capped at `max` (returns max+1 once exceeded) — used for a
// last-ditch fuzzy roster match so feed spelling variants (Villareal↔Villarreal,
// Foxx↔Fox, Gabriella↔Gabrielle) resolve to the seeded player instead of a duplicate.
// Nickname SHORTENINGS (Val↔Valerie, Alex↔Alexandra) are too far for this, but the
// prefix matcher in PlayerResolver.nickname handles the common prefix pattern; only true
// non-prefix nicknames (Gabby↔Gabriella, Kate↔Katherine) still need a manual merge.
function editDistance(a: string, b: string, max = 1): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      cur.push(v); if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

// UTC instant → America/Chicago (the hub venue's zone) calendar date + wall-clock, so
// the stored game_date / start_time match what the rest of the app assumes (Central
// wall clock, re-rendered into each viewer's zone by formatGameTime).
const CHI = 'America/Chicago'
function chicagoDate(iso: string): string {
  const d = new Date(iso)
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: CHI, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d)
  const get = (t: string) => p.find(x => x.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
function chicagoTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: CHI, hour: 'numeric', minute: '2-digit' })
}

// Feed status text → our enum. The boxscore's status.complete is authoritative when we
// have it; the games-list status string is the fallback.
function mapStatus(text: string, complete?: boolean): 'scheduled' | 'live' | 'final' {
  if (complete) return 'final'
  const t = text.toLowerCase().trim()
  if (t.startsWith('final') || t.includes('complete') || t.includes('game over') || t.includes('walk-off')) return 'final'
  // Positive live signals only — everything else (incl. "Not Started", "Scheduled",
  // "TBA", "Postponed", "Cancelled", or an unknown string) is treated as scheduled, so
  // future games never show as live by accident.
  if (t.includes('progress') || t.includes('inning') || t.includes('delay') || /\b(top|bottom|mid|end)\b/.test(t)) return 'live'
  return 'scheduled'
}

// ─── player reconciliation cache ──────────────────────────────────────────────
// Resolve a feed player to our wpbl_players.id: by api_id, else by (team, name), else
// insert a new roster row. Backfills api_id / uniform / bats / throws on the way.
class PlayerResolver {
  private byApi = new Map<string, string>()             // api_id → our uuid
  private byTeamName = new Map<string, string>()        // `${teamSlug}::${normName}` → uuid
  private byTeam = new Map<string, { id: string; norm: string }[]>()  // teamSlug → roster
  private pendingApi = new Map<string, string>()        // uuid → api_id to backfill

  constructor(private db: SupabaseClient, rows: any[]) {
    for (const p of rows) {
      if (p.api_id) this.byApi.set(p.api_id, p.id)
      const nm = normName(p.name)
      const slug = p.team_id ?? ''
      this.byTeamName.set(`${slug}::${nm}`, p.id)
      const list = this.byTeam.get(slug) ?? []
      list.push({ id: p.id, norm: nm }); this.byTeam.set(slug, list)
    }
  }

  // Unique same-team roster player within edit distance 1 (names ≥4 chars), or null if
  // there is no match or the match is ambiguous. Guards against merging two real players.
  private fuzzy(teamSlug: string, nm: string): string | null {
    if (nm.length < 4) return null
    let hit: string | null = null
    for (const cand of this.byTeam.get(teamSlug) ?? []) {
      if (cand.norm.length < 4) continue
      if (editDistance(nm, cand.norm, 1) <= 1) {
        if (hit && hit !== cand.id) return null // ambiguous — don't guess
        hit = cand.id
      }
    }
    return hit
  }

  // Nickname-shortening match: same team, EXACT surname match, and one given name is a
  // prefix of the other (Val↔Valerie, Alex↔Alexandra, Sam↔Samuel). This is where feed
  // nicknames that editDistance can't reach actually live. Deliberately narrow: it fires
  // ONLY on the prefix pattern, requires the surname to match exactly and both given names
  // to be ≥3 chars, and bails on any ambiguity (two teammates sharing a surname) — so it
  // never merges two distinct players. Non-prefix nicknames (Gabby↔Gabriella) stay manual.
  private nickname(teamSlug: string, nm: string): string | null {
    const parts = nm.split(' ')
    if (parts.length < 2) return null
    const surname = parts[parts.length - 1]
    const given = parts[0]
    if (surname.length < 3 || given.length < 3) return null
    let hit: string | null = null
    for (const cand of this.byTeam.get(teamSlug) ?? []) {
      const cp = cand.norm.split(' ')
      if (cp.length < 2) continue
      if (cp[cp.length - 1] !== surname) continue         // surnames must match exactly
      const cGiven = cp[0]
      if (cGiven.length < 3) continue
      const [short, long] = given.length <= cGiven.length ? [given, cGiven] : [cGiven, given]
      if (short === long || !long.startsWith(short)) continue  // one must prefix the other
      if (hit && hit !== cand.id) return null              // ambiguous — don't guess
      hit = cand.id
    }
    return hit
  }

  async resolve(feed: { id?: string; name?: string; uniform?: string; bats?: string; throws?: string; position?: string }, teamSlug: string): Promise<string | null> {
    const name = s(feed.name)
    if (!name) return null
    const apiId = s(feed.id)

    // 1) api_id hit
    if (apiId && this.byApi.has(apiId)) return this.byApi.get(apiId)!

    // 2) (team, name) hit → backfill api_id
    const nm = normName(name)
    const existing = this.byTeamName.get(`${teamSlug}::${nm}`) ?? this.byTeamName.get(`::${nm}`)
    if (existing) {
      if (apiId) { this.byApi.set(apiId, existing); this.pendingApi.set(existing, apiId) }
      return existing
    }

    // 3) fuzzy (spelling-variant) hit within the same team → backfill api_id
    const fuzzy = this.fuzzy(teamSlug, nm)
    if (fuzzy) {
      this.byTeamName.set(`${teamSlug}::${nm}`, fuzzy)
      if (apiId) { this.byApi.set(apiId, fuzzy); this.pendingApi.set(fuzzy, apiId) }
      return fuzzy
    }

    // 3.5) nickname-shortening hit within the same team → backfill api_id. Also cache the
    // feed spelling under the team key so play-by-play resolveName() finds it too.
    const nick = this.nickname(teamSlug, nm)
    if (nick) {
      this.byTeamName.set(`${teamSlug}::${nm}`, nick)
      if (apiId) { this.byApi.set(apiId, nick); this.pendingApi.set(nick, apiId) }
      return nick
    }

    // 4) insert a new feed-only player
    const { data, error } = await this.db.from('wpbl_players').insert({
      team_id: teamSlug || null,
      name,
      position: feed.position || null,
      bats: feed.bats || null,
      throws: feed.throws || null,
      jersey_number: feed.uniform || null,
      api_id: apiId || null,
      active: true,
    }).select('id').single()
    if (error || !data) { console.warn('[wpbl-ingest] player insert failed', name, error?.message); return null }
    if (apiId) this.byApi.set(apiId, data.id)
    this.byTeamName.set(`${teamSlug}::${nm}`, data.id)
    const list = this.byTeam.get(teamSlug) ?? []
    list.push({ id: data.id, norm: nm }); this.byTeam.set(teamSlug, list)
    return data.id
  }

  // Resolve a bare name (play-by-play batter/pitcher) against any team. Best-effort.
  resolveName(name: string): string | null {
    const nm = normName(name)
    for (const [key, id] of this.byTeamName) if (key.endsWith(`::${nm}`)) return id
    return null
  }

  async flushApiIds() {
    for (const [uuid, apiId] of this.pendingApi) {
      await this.db.from('wpbl_players').update({ api_id: apiId }).eq('id', uuid)
    }
    this.pendingApi.clear()
  }
}

// Write one game's child rows with minimal churn. The old delete-then-insert rewrote every
// row on every ingest — brutal under the every-2-min live re-ingest, which bloats the table
// and its indexes. Instead upsert on the natural key: rows that already exist are updated in
// place (a HOT update, since the indexed columns game_id/player_id/sequence don't change and
// the stat columns aren't indexed), so the indexes stay stable and dead tuples drop sharply.
// Then prune any rows for this game the feed no longer reports — in steady state this matches
// nothing (box scores only grow), so it deletes zero rows and costs zero churn; it only fires
// on a genuine correction, keeping the stored set exactly equal to the feed.
async function syncGameRows(
  db: SupabaseClient,
  table: string,
  gameUuid: string,
  rows: Record<string, unknown>[],
  keyCol: 'player_id' | 'sequence',
  onConflict: string,
): Promise<void> {
  if (rows.length === 0) {
    await db.from(table).delete().eq('game_id', gameUuid)
    return
  }
  await db.from(table).upsert(rows, { onConflict })
  const keys = rows.map(r => r[keyCol])
  await db.from(table).delete().eq('game_id', gameUuid).not(keyCol, 'in', `(${keys.join(',')})`)
}

// ─── boxscore ingestion for one game ──────────────────────────────────────────
async function ingestBoxscore(
  db: SupabaseClient,
  gameUuid: string,
  apiGameId: string,
  teamSlug: Map<string, string>,
  resolver: PlayerResolver,
): Promise<{ batting: number; pitching: number; fielding: number; plays: number; tracking: number }> {
  const res = await fetch(`${FEED}/games/${apiGameId}/boxscore`)
  if (!res.ok) throw new Error(`boxscore ${apiGameId} → ${res.status}`)
  const box = (await res.json()).boxscore
  if (!box) throw new Error(`boxscore ${apiGameId} empty`)

  const slugOf = (apiTeamId: string) => teamSlug.get(apiTeamId) ?? null

  const batting: any[] = []
  const pitching: any[] = []
  const fielding: any[] = []

  // The boxscore is authoritative for status: complete → final; otherwise it's live only
  // once the game has genuinely started, else still scheduled.
  //
  // The feed flips a game to "In Progress - Top of 1st" and stages the leadoff batter /
  // pitcher ~20+ minutes BEFORE the actual first pitch, with inning=1, a 0-0 count, no
  // plays, and 0-0 score. `inning > 0` is therefore always true (it defaults to 1) and is
  // NOT evidence of live play. Require real activity instead: a logged play, a tracked
  // pitch, any ball/strike/out, a run, or play past the top of the 1st. The only window
  // this treats as still-scheduled is the moment before the very first pitch, which then
  // flips to live the instant a pitch is thrown.
  const st = box.status ?? {}
  const complete = !!st.complete
  const hasPlays    = (box.plays?.length ?? 0) > 0
  const hasTracking = (box.tracking_activity?.length ?? 0) > 0
  const anyCount    = n(st.outs) > 0 || n(st.balls) > 0 || n(st.strikes) > 0
  const anyRuns     = n(st.away_runs) > 0 || n(st.home_runs) > 0
  const beyondTop1  = n(st.inning) > 1 || s(st.half) === 'bottom'
  const hasActivity = hasPlays || hasTracking || anyCount || anyRuns || beyondTop1
  const derivedStatus: 'scheduled' | 'live' | 'final' = complete ? 'final' : hasActivity ? 'live' : 'scheduled'

  // Line score + totals per side, folded back onto the game row.
  const gamePatch: Record<string, unknown> = {
    status: derivedStatus,
    status_detail: s(box.game_status),
    source_updated_at: box.source_updated_at || null,
    live_state: derivedStatus === 'live' ? st : null,
  }
  // While live, the feed's running score is the freshest; final scores come from the
  // team totals below.
  if (derivedStatus === 'live') {
    gamePatch.away_score = n(st.away_runs)
    gamePatch.home_score = n(st.home_runs)
  }

  for (const team of box.teams ?? []) {
    const slug = slugOf(s(team.id))
    const side = s(team.side) // 'away' | 'home'
    const tot = team.totals ?? {}
    gamePatch[`${side}_line`] = team.line ?? []
    gamePatch[`${side}_hits`] = n(tot.hits)
    gamePatch[`${side}_errors`] = n(tot.errors)
    gamePatch[`${side}_lob`] = n(tot.left_on_base)
    if (derivedStatus === 'final') gamePatch[`${side}_score`] = n(tot.runs)

    for (const pl of team.players ?? []) {
      const playerId = await resolver.resolve(pl, slug ?? '')
      if (!playerId) continue
      const spot = n(pl.spot)
      const hit = pl.hitting
      const pit = pl.pitching
      const fld = pl.fielding

      if (hit && (spot > 0 || n(hit.ab) || n(hit.h) || n(hit.bb) || n(hit.r) || n(hit.rbi) || n(hit.hbp) || n(hit.so))) {
        const h = n(hit.h), dbl = n(hit.double), tpl = n(hit.triple), hr = n(hit.hr)
        const tb = (h - dbl - tpl - hr) + 2 * dbl + 3 * tpl + 4 * hr
        batting.push({
          game_id: gameUuid, player_id: playerId, team_id: slug,
          batting_order: spot || null, position: pl.position || null,
          ab: n(hit.ab), r: n(hit.r), h, doubles: dbl, triples: tpl, hr, rbi: n(hit.rbi),
          bb: n(hit.bb), so: n(hit.so), hbp: n(hit.hbp), sb: n(hit.sb), cs: n(hit.cs),
          sf: n(hit.sf), sh: n(hit.sh), ibb: n(hit.ibb), gdp: n(hit.gdp), tb, lob: n(hit.lob),
        })
      }

      if (pit) {
        let decision: string | null = null
        if (pit.win) decision = 'W'
        else if (pit.loss) decision = 'L'
        else if (pit.save) decision = 'S'
        else if (pit.hold) decision = 'H'
        pitching.push({
          game_id: gameUuid, player_id: playerId, team_id: slug,
          outs: ipToOuts(pit.ip), bf: pit.bf != null ? n(pit.bf) : null,
          h: n(pit.h), r: n(pit.r), er: n(pit.er), bb: n(pit.bb), so: n(pit.so), hr: n(pit.hr),
          pitches: pit.pitches != null ? n(pit.pitches) : null, decision,
          gs: n(pit.gs), hbp: n(pit.hbp), ibb: n(pit.ibb), wp: n(pit.wp), bk: n(pit.bk),
          strikes: n(pit.strikes), doubles: n(pit.double), triples: n(pit.triple),
        })
      }

      if (fld && (n(fld.po) || n(fld.a) || n(fld.e) || n(fld.pb) || n(fld.sba) || n(fld.ci) || n(fld.indp))) {
        fielding.push({
          game_id: gameUuid, player_id: playerId, team_id: slug,
          po: n(fld.po), a: n(fld.a), e: n(fld.e), pb: n(fld.pb),
          sba: n(fld.sba), ci: n(fld.ci), dp: n(fld.indp),
        })
      }
    }
  }

  // Play-by-play — delete + reinsert (immutable per game, keeps sequence clean).
  const plays = (box.plays ?? []).map((p: any) => ({
    game_id: gameUuid, sequence: n(p.sequence), inning: n(p.inning),
    half: s(p.half) === 'bottom' ? 'bottom' : 'top', team_id: slugOf(s(p.team_id)),
    batter_name: s(p.batter_name) || null, batter_id: resolver.resolveName(s(p.batter_name)),
    pitcher_name: s(p.pitcher_name) || null, pitcher_id: resolver.resolveName(s(p.pitcher_name)),
    outs: n(p.outs), first_base: s(p.first_base), second_base: s(p.second_base),
    third_base: s(p.third_base), bases_loaded: !!p.bases_loaded,
    narrative: s(p.narrative), event_type: s(p.event_type) || null,
    is_hit: !!p.is_hit, is_scoring_play: !!p.is_scoring_play, runs_scored: n(p.runs_scored),
    pitch_sequence: s(p.pitch_sequence) || null, balls: n(p.balls), strikes: n(p.strikes),
    fouls: n(p.fouls), pitch_events: p.pitch_events ?? null,
  }))

  // TrackMan — upsert on activity_id (stable per event).
  const tracking = (box.tracking_activity ?? [])
    .filter((t: any) => t.activity_id)
    .map((t: any) => ({
      activity_id: s(t.activity_id), game_id: gameUuid, play_id: s(t.play_id) || null,
      session_id: s(t.session_id) || null, kind: s(t.kind) || null, event_type: s(t.event_type) || null,
      sequence: t.sequence != null ? n(t.sequence) : null, occurred_at: t.occurred_at || null,
      release_speed: t.release_speed ?? null, speed_unit: s(t.speed_unit) || null,
      spin_rate_rpm: t.spin_rate_rpm ?? null, extension: t.extension ?? null,
      vertical_break: t.vertical_break ?? null, horizontal_break: t.horizontal_break ?? null,
      plate_location_height: t.plate_location_height ?? null, raw: t,
    }))

  // Write everything with low-churn upserts (see syncGameRows). Box-score lines and plays
  // key on their natural unique index; tracking keys on activity_id.
  await db.from('wpbl_games').update(gamePatch).eq('id', gameUuid)

  await syncGameRows(db, 'wpbl_batting_lines',  gameUuid, batting,  'player_id', 'game_id,player_id')
  await syncGameRows(db, 'wpbl_pitching_lines', gameUuid, pitching, 'player_id', 'game_id,player_id')
  await syncGameRows(db, 'wpbl_fielding_lines', gameUuid, fielding, 'player_id', 'game_id,player_id')
  await syncGameRows(db, 'wpbl_game_plays',     gameUuid, plays,    'sequence',  'game_id,sequence')

  if (tracking.length) await db.from('wpbl_pitch_tracking').upsert(tracking, { onConflict: 'activity_id' })

  return { batting: batting.length, pitching: pitching.length, fielding: fielding.length, plays: plays.length, tracking: tracking.length }
}

// ─── handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const db = createClient(url, key)

  let mode = 'active', force = false, oneGame: string | null = null
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    if (body.mode) mode = String(body.mode)
    if (body.force) force = !!body.force
    if (body.gameId) oneGame = String(body.gameId)
  } catch { /* defaults */ }

  // Health log — one row per run (success or failure) so the app can show a freshness
  // indicator. Best-effort: a logging failure must never break the ingest response.
  const startedAt = Date.now()
  const logRun = async (ok: boolean, games: number, boxscores: number, errors: string[]) => {
    try {
      await db.from('wpbl_ingest_runs').insert({
        mode, ok, games, boxscores,
        error_count: errors.length,
        errors: errors.length ? errors.slice(0, 25) : null,
        duration_ms: Date.now() - startedAt,
      })
    } catch (e) { console.warn('[wpbl-ingest] health log failed', e instanceof Error ? e.message : e) }
  }

  try {
    // Team api_id → slug map (and reject if the seed migration hasn't run).
    const { data: teams } = await db.from('wpbl_teams').select('id, api_id')
    const teamSlug = new Map<string, string>()
    for (const t of teams ?? []) if (t.api_id) teamSlug.set(t.api_id, t.id)
    if (teamSlug.size === 0) {
      await logRun(false, 0, 0, ['No wpbl_teams.api_id mappings — run scripts/add_wpbl_api_ingest.sql first'])
      return json({ error: 'No wpbl_teams.api_id mappings — run scripts/add_wpbl_api_ingest.sql first' }, 400)
    }

    // Player cache for reconciliation.
    const { data: players } = await db.from('wpbl_players').select('id, name, team_id, api_id')
    const resolver = new PlayerResolver(db, players ?? [])

    // Our current games (to decide which boxscores to (re)fetch).
    const { data: ourGames } = await db.from('wpbl_games').select('id, api_game_id, status')
    const byApi = new Map<string, { id: string; status: string }>()
    for (const g of ourGames ?? []) if (g.api_game_id) byApi.set(g.api_game_id, { id: g.id, status: g.status })

    // Feed schedule.
    const listRes = await fetch(`${FEED}/games`)
    if (!listRes.ok) {
      await logRun(false, 0, 0, [`feed /games → ${listRes.status}`])
      return json({ error: `feed /games → ${listRes.status}` }, 502)
    }
    const feedGames: any[] = (await listRes.json()).games ?? []

    // Phantom-duplicate suppression. The feed sometimes carries a stale, never-played copy
    // of a game alongside the real one — same date + matchup, different game_id (e.g. a
    // weather delay left an extra "Not Started" slot next to the completed game). Group by
    // (Chicago date, matchup); if a group has a played copy (final/live/completed), any
    // still-unplayed copy in that group is a phantom and is suppressed here, so the mirror
    // is clean for EVERY consumer, not just the client schedule filter. Self-healing: if a
    // suppressed game ever actually starts it no longer matches the rule and re-ingests.
    const matchupKey = (fg: any) => {
      const iso = s(fg.scheduled_start)
      return `${iso ? chicagoDate(iso) : ''}|${s(fg.away_team_id)}|${s(fg.home_team_id)}`
    }
    const isPlayed = (fg: any) => !!s(fg.completed_at) || mapStatus(s(fg.status)) !== 'scheduled'
    const playedMatchups = new Set<string>()
    for (const fg of feedGames) if (s(fg.game_id) && isPlayed(fg)) playedMatchups.add(matchupKey(fg))
    const phantomIds = new Set<string>()
    for (const fg of feedGames) {
      const id = s(fg.game_id)
      if (id && !isPlayed(fg) && playedMatchups.has(matchupKey(fg))) phantomIds.add(id)
    }

    const summary = { games: 0, boxscores: 0, phantomsRemoved: 0, errors: [] as string[] }

    for (const fg of feedGames) {
      const apiGameId = s(fg.game_id)
      if (!apiGameId) continue
      if (oneGame && apiGameId !== oneGame) continue

      // Phantom copy of an already-played game — skip it, and delete any row we ingested on
      // an earlier run (cascades its lines/plays). It re-appears only if it truly starts.
      if (phantomIds.has(apiGameId)) {
        if (byApi.has(apiGameId)) {
          await db.from('wpbl_games').delete().eq('api_game_id', apiGameId)
          summary.phantomsRemoved++
        }
        continue
      }

      // TBD placeholder games have empty team ids — skip them silently.
      if (!s(fg.home_team_id) || !s(fg.away_team_id)) continue
      const homeSlug = teamSlug.get(s(fg.home_team_id))
      const awaySlug = teamSlug.get(s(fg.away_team_id))
      if (!homeSlug || !awaySlug) { summary.errors.push(`unmapped team in ${apiGameId}`); continue }

      const status = mapStatus(s(fg.status))
      const startIso = s(fg.scheduled_start)
      const scoreAway = fg.presto_data?.score?.away
      const scoreHome = fg.presto_data?.score?.home

      // Upsert the game row (on api_game_id).
      const gameRow = {
        api_game_id: apiGameId, season_id: s(fg.season_id) || null,
        game_date: startIso ? chicagoDate(startIso) : new Date().toISOString().slice(0, 10),
        start_time: startIso ? chicagoTime(startIso) : null,
        home_team_id: homeSlug, away_team_id: awaySlug,
        venue: s(fg.venue) || null, game_type: s(fg.game_type) || null,
        counts_in_standings: fg.counts_in_standings ?? null,
        status, status_detail: s(fg.status),
        home_score: scoreHome != null && scoreHome !== '' ? n(scoreHome) : null,
        away_score: scoreAway != null && scoreAway !== '' ? n(scoreAway) : null,
        updated_at: new Date().toISOString(),
      }
      const { data: up, error: upErr } = await db.from('wpbl_games')
        .upsert(gameRow, { onConflict: 'api_game_id' }).select('id').single()
      if (upErr || !up) { summary.errors.push(`upsert ${apiGameId}: ${upErr?.message}`); continue }
      summary.games++

      // Decide whether to pull the boxscore. Besides explicit/live cases, also fetch once
      // a game's scheduled start has passed (its list-status may still read "Not Started"
      // even though it's underway) — the boxscore itself then decides live vs final.
      const prior = byApi.get(apiGameId)
      const started = startIso ? Date.parse(startIso) <= Date.now() : false
      const notFinalHere = !prior || prior.status !== 'final'
      const wantBox =
        oneGame != null ||
        mode === 'all' ||
        (notFinalHere && (force || status !== 'scheduled' || started))
      if (!wantBox) continue

      try {
        await ingestBoxscore(db, up.id, apiGameId, teamSlug, resolver)
        summary.boxscores++
      } catch (e) {
        summary.errors.push(`box ${apiGameId}: ${e instanceof Error ? e.message : e}`)
      }
    }

    await resolver.flushApiIds()
    await logRun(true, summary.games, summary.boxscores, summary.errors)
    return json({ ok: true, mode, ...summary })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await logRun(false, 0, 0, [msg])
    return json({ ok: false, error: msg }, 500)
  }
})
