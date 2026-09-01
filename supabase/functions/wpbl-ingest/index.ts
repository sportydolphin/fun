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
import { normName, editDistance, isDamaged, replacementMatch, tradeMatch, teamMoveWins, datedEvidence } from './names.ts'
import { announceFinal } from './announce-final.ts'
import { crownPredictions, settlePredictions } from './settle-predictions.ts'

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

// The feed appends a literal "Z" to a naive wall-clock string (presto_data.startDateTime)
// that actually belongs to the zone in presto_data.timeZone — so scheduled_start is wrong
// by that zone's UTC offset. Every WPBL game runs on Central time, so we re-home each game
// from its tagged zone onto Central: shift the instant by (taggedZoneOffset − centralOffset).
//   • Eastern-tagged rows (the legacy encoding: feed said 5:30 PM, true pitch 6:30 PM CT) get
//     +1h — matching the old flat fix.
//   • Central-tagged rows (a newer encoding the feed now also emits for the same games) are
//     already the true instant and get +0. The old flat +1h pushed THESE an hour late, which
//     is the bug this replaces.
// Offsets are read at each game's own date, so it stays correct across any DST boundary.
// Verified exact against the full feed: every game lands on its official CT first pitch
// (1:00 PM matinees, 5:00/6:30 PM games). See map-wpbl-discord-events + the board script.
// ms to add to a UTC instant to reach the given zone's wall clock (negative in the Americas).
function zoneOffsetMs(iso: string, timeZone: string): number {
  const d = new Date(iso)
  return new Date(d.toLocaleString('en-US', { timeZone })).getTime()
    - new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
}
function correctedStart(iso: string, feedZone: string): string {
  if (!iso) return ''
  // Missing tag → assume the legacy Eastern encoding (what every historical row was), so an
  // untagged feed row still gets the established +1h rather than silently landing an hour early.
  const zone = feedZone || 'America/New_York'
  const shiftMs = zoneOffsetMs(iso, zone) - zoneOffsetMs(iso, CHI)
  return new Date(Date.parse(iso) + shiftMs).toISOString()
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
// Resolve a feed player to our wpbl_players.id: by any feed id we have ever seen for them,
// else by (team, name), else by a league-wide name match that means they were traded, else
// insert a new roster row. Backfills feed ids / uniform / bats / throws on the way, and moves
// a player's club forward when a box score puts them somewhere new.
//
// TRADES. The feed mints a NEW player_id per club — Diana Ibarra is moizfkn9dtrm4vno on New
// York and 27svefz41ds4k58k on Los Angeles, both ACTIVE, career_id empty on both, so nothing
// in the payload says they are one person. Every match below except `traded` is scoped to a
// single team, which is right for spelling variants and fatal for a trade: the new id matched
// nothing and the old resolver inserted a second Diana Ibarra, splitting her season 8 games to
// 1 and turning her name ambiguous enough that /wpbl/players/diana-ibarra started 404ing.
class PlayerResolver {
  // One entry per roster row, kept in step with what we write back, so every matcher below
  // and every later call in the same run sees the current club rather than the one we loaded.
  private players = new Map<string, {
    id: string
    norm: string
    teamId: string
    teamAsOf: string | null   // game date, 'YYYY-MM-DD'
    jersey: string | null
    apiIds: Set<string>
  }>()
  private byApi = new Map<string, string>()        // any feed id → our uuid
  private byName = new Map<string, string[]>()     // normalized roster name → uuids
  // Feed spellings learned this run (a fuzzy / damaged / nickname hit). League-wide because
  // play-by-play gives a bare name with no team beside it.
  private alias = new Map<string, string>()
  // uuid → the columns this run wants to write back, flushed once at the end.
  private pending = new Map<string, Record<string, unknown>>()
  private moves: Record<string, unknown>[] = []

  constructor(private db: SupabaseClient, rows: any[]) {
    for (const p of rows) {
      const nm = normName(p.name)
      const apiIds = new Set<string>([...(p.api_ids ?? []), p.api_id].filter(Boolean) as string[])
      this.players.set(p.id, {
        id: p.id, norm: nm, teamId: p.team_id ?? '', teamAsOf: p.team_as_of ?? null,
        jersey: p.jersey_number ?? null, apiIds,
      })
      for (const a of apiIds) this.byApi.set(a, p.id)
      const list = this.byName.get(nm) ?? []
      list.push(p.id); this.byName.set(nm, list)
    }
  }

  /** Everyone currently on this club, for the same-team matchers. */
  private roster(teamSlug: string) {
    const out: { id: string; norm: string }[] = []
    for (const p of this.players.values()) if (p.teamId === teamSlug) out.push(p)
    return out
  }

  // Unique same-team roster player within edit distance 1 (names ≥4 chars), or null if
  // there is no match or the match is ambiguous. Guards against merging two real players.
  private fuzzy(teamSlug: string, nm: string): string | null {
    if (nm.length < 4) return null
    let hit: string | null = null
    for (const cand of this.roster(teamSlug)) {
      if (cand.norm.length < 4) continue
      if (editDistance(nm, cand.norm, 1) <= 1) {
        if (hit && hit !== cand.id) return null // ambiguous — don't guess
        hit = cand.id
      }
    }
    return hit
  }

  // Same-team player whose name matches apart from characters the feed lost to a bad
  // decode ("ma<?>ka dumais" → "maika dumais"), or null if nothing or more than one
  // matches. This is what stops a transient encoding fault upstream from forking a second
  // roster row: it already happened twice in August 2026, leaving stat-less duplicates of
  // the only two players on any roster with an accent in their name.
  private damaged(teamSlug: string, nm: string): string | null {
    if (!isDamaged(nm)) return null
    let hit: string | null = null
    for (const cand of this.roster(teamSlug)) {
      if (!replacementMatch(nm, cand.norm)) continue
      if (hit && hit !== cand.id) return null // ambiguous — don't guess
      hit = cand.id
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
    for (const cand of this.roster(teamSlug)) {
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

  // A trade: a feed id we have never seen, naming someone already on another club's roster.
  // The rule itself is `tradeMatch` in names.ts, where it can be tested; every hit is also
  // written to wpbl_player_team_changes, because a heuristic that reaches across teams and
  // runs unattended every two minutes needs somewhere you can go and check what it did.
  private traded(teamSlug: string, nm: string): string | null {
    return tradeMatch(nm, teamSlug, [...this.players.values()])
  }

  /** Remember a feed id (and the feed's spelling of the name) against a player we resolved. */
  private link(id: string, apiId: string, nm: string) {
    const p = this.players.get(id)
    if (!p) return
    if (nm !== p.norm) this.alias.set(nm, id)
    if (!apiId || p.apiIds.has(apiId)) return
    p.apiIds.add(apiId)
    this.byApi.set(apiId, id)
    // api_id stays "the current one" — plenty of code reads it as a scalar — while api_ids
    // keeps every id the player has ever had, because wpbl_pitch_tracking is keyed on the
    // FEED id and a traded player's older pitches are only reachable through the older one.
    this.patch(id, { api_id: apiId, api_ids: [...p.apiIds] })
  }

  /**
   * Move a player to the club whose box score just listed them, if this game is newer than the
   * evidence we already had.
   *
   * The date guard is what makes this safe to run on every pass. The ingest re-reads old box
   * scores all the time (corrections via `force`, the late-TrackMan backfill, mode 'all'), and
   * each one is true evidence of where the player was THEN. Without the guard a July re-read
   * would send a traded player back to her old club and the next pass would send her forward
   * again, so her club would depend on whichever game the loop happened to touch last. With
   * it, evidence only ever moves forward and re-ingesting the whole season changes nothing.
   */
  private noteTeam(id: string, teamSlug: string, ctx: GameCtx, apiId: string, reason: string): boolean {
    const p = this.players.get(id)
    if (!p || !teamSlug || !ctx.date) return false
    // A game that has not been played yet is a plan, not evidence: the feed stages lineups
    // ahead of first pitch, and `mode: "all"` walks the whole schedule.
    if (!datedEvidence(ctx.date, chicagoDate(new Date().toISOString()))) return false
    if (p.teamId === teamSlug) {
      // Same club, but a newer game: raise the floor so a later re-read of an older game
      // cannot move them. Cheap — in steady state this is only the games ingested for the
      // first time, and a re-poll of the same live game writes nothing.
      if (p.teamAsOf == null || ctx.date > p.teamAsOf) {
        p.teamAsOf = ctx.date
        this.patch(id, { team_as_of: ctx.date })
      }
      return false
    }
    if (!teamMoveWins(p, teamSlug, ctx.date, chicagoDate(new Date().toISOString()))) return false   // older news
    const from = p.teamId || null
    p.teamId = teamSlug
    p.teamAsOf = ctx.date
    this.patch(id, { team_id: teamSlug, team_as_of: ctx.date })
    this.moves.push({
      player_id: id, from_team_id: from, to_team_id: teamSlug,
      game_id: ctx.gameId, game_date: ctx.date, feed_api_id: apiId || null, reason,
    })
    console.log(`[wpbl-ingest] ${reason}: ${p.norm} ${from ?? '(none)'} → ${teamSlug} (${ctx.date})`)
    return true
  }

  /**
   * Take the uniform number off this box score, if this game is the newest evidence we hold
   * for the player. Every box-score line carries it and the roster row is the only place it
   * lives, so without this it is only ever set at insert: the players who predate the column
   * would stay blank forever.
   *
   * Same date guard as noteTeam, and for the same reason plus one more. A new club usually
   * means a new number (Ibarra wore 8 in New York and wears 6 in Los Angeles), so an old box
   * score is honest evidence of the number she wore THEN, and the ingest re-reads old games
   * constantly (`force`, the TrackMan backfill, mode 'all'). `team_as_of` is the floor
   * because it already means "the newest game we have seen this player in": anything older
   * either shows the same club, where the number is the one we already hold, or an older
   * club, where it is the wrong one. noteTeam runs first and raises that floor to this game
   * when the game is newer, which is exactly when we want the number.
   */
  private noteJersey(id: string, uniform: string, ctx: GameCtx) {
    const p = this.players.get(id)
    if (!p || !uniform || !ctx.date) return
    // A staged lineup for a game nobody has played is a plan, not evidence.
    if (!datedEvidence(ctx.date, chicagoDate(new Date().toISOString()))) return
    if (p.teamAsOf != null && ctx.date < p.teamAsOf) return
    if (p.jersey === uniform) return
    p.jersey = uniform
    this.patch(id, { jersey_number: uniform })
  }

  private patch(id: string, cols: Record<string, unknown>) {
    this.pending.set(id, { ...(this.pending.get(id) ?? {}), ...cols })
  }

  async resolve(
    feed: { id?: string; name?: string; uniform?: string; bats?: string; throws?: string; position?: string },
    teamSlug: string,
    ctx: GameCtx,
  ): Promise<string | null> {
    const name = s(feed.name)
    if (!name) return null
    const apiId = s(feed.id)
    const nm = normName(name)

    // 1) a feed id we have seen before — including one this player picked up in an earlier trade
    let id = apiId ? this.byApi.get(apiId) ?? null : null
    let reason = 'feed-id'

    // 2) (team, name), or a roster row with no club yet
    if (!id) {
      for (const cand of this.byName.get(nm) ?? []) {
        const p = this.players.get(cand)
        if (p && (p.teamId === teamSlug || p.teamId === '')) { id = cand; break }
      }
      if (!id) id = this.alias.get(nm) ?? null
    }

    // 2.5) damaged-name hit within the same team. Ahead of the fuzzy pass because it is the
    // stricter test: it only forgives characters the decoder actually flagged as lost.
    if (!id) id = this.damaged(teamSlug, nm)

    // 3) fuzzy (spelling-variant) hit within the same team
    if (!id) id = this.fuzzy(teamSlug, nm)

    // 3.5) nickname-shortening hit within the same team
    if (!id) id = this.nickname(teamSlug, nm)

    // 3.75) exact name, different club — she was traded, not born
    if (!id) {
      const moved = this.traded(teamSlug, nm)
      if (moved) { id = moved; reason = 'name-match' }
    }

    if (id) {
      this.link(id, apiId, nm)
      this.noteTeam(id, teamSlug, ctx, apiId, reason)
      this.noteJersey(id, s(feed.uniform), ctx)
      return id
    }

    // 4) insert a new feed-only player — but never under a name we know is damaged. An
    // unmatched damaged name is either a roster player this run couldn't recognise or a
    // genuinely new one whose name we can't spell; inserting it is wrong in both cases and
    // permanent, while skipping costs only this player's lines for this run. The ingest is
    // idempotent and re-runs every couple of minutes, so a clean payload backfills them.
    if (isDamaged(nm)) {
      console.warn('[wpbl-ingest] skipping player with a damaged name (bad decode upstream):', JSON.stringify(name))
      return null
    }
    const { data, error } = await this.db.from('wpbl_players').insert({
      team_id: teamSlug || null,
      team_as_of: ctx.date,
      name,
      position: feed.position || null,
      bats: feed.bats || null,
      throws: feed.throws || null,
      jersey_number: feed.uniform || null,
      api_id: apiId || null,
      api_ids: apiId ? [apiId] : [],
      active: true,
    }).select('id').single()
    if (error || !data) { console.warn('[wpbl-ingest] player insert failed', name, error?.message); return null }
    const apiIds = new Set<string>(apiId ? [apiId] : [])
    this.players.set(data.id, {
      id: data.id, norm: nm, teamId: teamSlug, teamAsOf: ctx.date,
      jersey: feed.uniform || null, apiIds,
    })
    if (apiId) this.byApi.set(apiId, data.id)
    const list = this.byName.get(nm) ?? []
    list.push(data.id); this.byName.set(nm, list)
    return data.id
  }

  // Resolve a bare name (play-by-play batter/pitcher) against any team. Best-effort, and
  // ambiguity always loses: an unattributed play is recoverable, a play credited to the wrong
  // player is not.
  resolveName(name: string): string | null {
    const nm = normName(name)
    const ids = this.byName.get(nm)
    if (ids && ids.length === 1) return ids[0]
    if (!ids) {
      const aliased = this.alias.get(nm)
      if (aliased) return aliased
    }
    // Same damaged-name recovery as resolve(), so a play keeps its batter/pitcher link
    // instead of going unattributed. Any ambiguity leaves it unattributed, as before.
    if (isDamaged(nm)) {
      let hit: string | null = null
      for (const p of this.players.values()) {
        if (!replacementMatch(nm, p.norm)) continue
        if (hit && hit !== p.id) return null
        hit = p.id
      }
      return hit
    }
    return null
  }

  /** One write per changed player, plus the trade log. Best-effort: this is bookkeeping, and
   *  failing it must not fail an ingest that has already stored the games. */
  async flush() {
    for (const [uuid, cols] of this.pending) {
      const { error } = await this.db.from('wpbl_players').update(cols).eq('id', uuid)
      if (error) console.warn('[wpbl-ingest] player update failed', uuid, error.message)
    }
    this.pending.clear()
    if (this.moves.length) {
      // UPSERT, NOT INSERT, and `ignoreDuplicates` so a move already logged is left exactly as
      // it was. This loop re-reads old box scores constantly (the 2-minute cron, `force`, the
      // TrackMan backfill, mode `all`) and re-detects the same move every time, so a plain
      // insert appended a fresh row per pass: by Sep 1, 2026 that was 13,644 rows holding 18
      // distinct facts and growing ~2,900 a day, forever. Nothing reads the table on the site,
      // which is why it went unnoticed for three weeks. The unique index it conflicts on is in
      // the 20260901204532 migration; keeping the FIRST row matters, because `detected_at` is
      // then the moment the move could first have been known rather than the last time the
      // loop came round.
      const { error } = await this.db.from('wpbl_player_team_changes')
        .upsert(this.moves, {
          onConflict: 'player_id,game_id,from_team_id,to_team_id',
          ignoreDuplicates: true,
        })
      if (error) console.warn('[wpbl-ingest] team-change log failed', error.message)
      this.moves = []
    }
  }
}

/** The game a box-score row came from: which club a player was on is only ever true as of a
 *  date, so every resolve carries one. */
interface GameCtx { gameId: string; date: string | null }

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

// ─── tracking (TrackMan) source ───────────────────────────────────────────────
// The boxscore embeds `tracking_activity`, but it's server-capped at 200 events — a
// full game is ~380. The dedicated /games/{id}/activity endpoint is the uncapped,
// paginated source (and adds `distance` on hit events), so we page through it and
// merge over whatever the boxscore carried, keyed by activity_id. Merging (rather than
// replacing) means we never lose the boxscore's set if /activity ever regresses, and
// the endpoint's richer copy wins on overlap. Games the league hasn't published
// tracking for return an empty page — nothing to do, and they light up automatically
// once it appears. (Complements the late-backfill gate below, which re-fetches recent
// finals whose tracking posts after the game goes Final.)
async function fetchTracking(apiGameId: string, fromBox: any[]): Promise<any[]> {
  const merged = new Map<string, any>()
  for (const t of fromBox) if (t?.activity_id) merged.set(s(t.activity_id), t)

  const LIMIT = 1000
  try {
    for (let offset = 0, page = LIMIT; page === LIMIT; offset += LIMIT) {
      const res = await fetch(`${FEED}/games/${apiGameId}/activity?limit=${LIMIT}&offset=${offset}`)
      if (!res.ok) { // fall back to whatever the boxscore gave us
        if (offset === 0) console.warn(`[wpbl-ingest] activity ${apiGameId} → ${res.status}, using boxscore tracking`)
        break
      }
      const items: any[] = (await res.json()).activity ?? []
      for (const t of items) if (t?.activity_id) merged.set(s(t.activity_id), t)
      page = items.length
    }
  } catch (e) {
    console.warn(`[wpbl-ingest] activity ${apiGameId} fetch failed, using boxscore tracking:`, e instanceof Error ? e.message : e)
  }
  return [...merged.values()]
}

// ─── boxscore ingestion for one game ──────────────────────────────────────────
async function ingestBoxscore(
  db: SupabaseClient,
  gameUuid: string,
  apiGameId: string,
  gameDate: string | null,
  teamSlug: Map<string, string>,
  resolver: PlayerResolver,
): Promise<{ status: 'scheduled' | 'live' | 'final'; batting: number; pitching: number; fielding: number; plays: number; tracking: number }> {
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
      const playerId = await resolver.resolve(pl, slug ?? '', { gameId: gameUuid, date: gameDate })
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
          // GIDP is the feed's `hitdp` ("hit into DP"); its `gdp` field is present but always 0.
          sf: n(hit.sf), sh: n(hit.sh), ibb: n(hit.ibb), gdp: n(hit.hitdp), tb, lob: n(hit.lob),
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

  // TrackMan — sourced from the uncapped /activity endpoint (merged over the boxscore's
  // capped copy), upsert on activity_id (stable per event).
  const tracking = (await fetchTracking(apiGameId, box.tracking_activity ?? []))
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

  return { status: derivedStatus, batting: batting.length, pitching: pitching.length, fielding: fielding.length, plays: plays.length, tracking: tracking.length }
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
    const { data: players } = await db.from('wpbl_players').select('id, name, team_id, api_id, api_ids, team_as_of, jersey_number')
    const resolver = new PlayerResolver(db, players ?? [])

    // Our current games (to decide which boxscores to (re)fetch).
    const { data: ourGames } = await db.from('wpbl_games').select('id, api_game_id, status, game_date')
    const byApi = new Map<string, { id: string; status: string }>()
    for (const g of ourGames ?? []) if (g.api_game_id) byApi.set(g.api_game_id, { id: g.id, status: g.status })

    // Late TrackMan backfill. The league reconciles tracking (event_type
    // 'rest_reconciliation') in batches that land DAYS after a game goes Final — the two
    // Aug 1–2 games were both published in a single batch on Aug 3, and later games can lag
    // further and arrive in bulk. The "active" gate below skips games already stored final,
    // so without this those late batches would be lost forever. Re-fetch recently-final
    // games that still have zero tracking rows; once the feed posts the data (or the window
    // lapses) this stops. The window must comfortably exceed the observed publish lag, so it
    // is generous — the cost is only a boxscore+activity fetch per still-untracked final,
    // and the set shrinks to nothing as games fill in. Empty on the initial `all` backfill
    // (which fetches everything anyway).
    const BACKFILL_DAYS = 21
    const dayAge = (d: string | null) => d ? (Date.now() - Date.parse(`${d}T00:00:00Z`)) / 86_400_000 : Infinity
    const recentFinalIds = (ourGames ?? [])
      .filter(g => g.status === 'final' && dayAge(g.game_date) <= BACKFILL_DAYS)
      .map(g => g.id as string)
    const missingTracking = new Set<string>()
    if (recentFinalIds.length && mode !== 'all') {
      const { data: trk } = await db.from('wpbl_pitch_tracking').select('game_id').in('game_id', recentFinalIds)
      const have = new Set((trk ?? []).map((r: { game_id: string }) => r.game_id))
      for (const id of recentFinalIds) if (!have.has(id)) missingTracking.add(id)
    }

    // Feed schedule.
    //
    // `?limit=` IS NOT OPTIONAL, AND THE BARE READ LIES. `GET /v1/games` caps at 50 rows and
    // says nothing about it: no error, no flag, just a short array beside a `count` field that
    // reports the real total. On Aug 30, 2026 the season crossed that line. The feed held 56
    // records, we read 50, and the six it withheld included the ONLY copy of that night's
    // NY@SF game that the league ever finished (SF 11-9, full line score, published while the
    // copy we could see sat frozen at "Not Started" from before first pitch).
    //
    // Nothing detected it. The ingest logged `ok: true` with zero errors every two minutes for
    // the entire game, because a truncated list is a perfectly valid list: every row in it
    // ingested cleanly. The game simply did not exist as far as this function was concerned,
    // and the site told readers the league had gone quiet.
    //
    // Same failure as the PostgREST 1000-row cap in the app (see `fetchAllPaged` in
    // src/wpbl/api.ts), and it fails the same way: silently, and worse the longer the season
    // runs, because the twins mean the row count grows at roughly twice the schedule.
    //
    // So: ask for more than can exist, then CHECK the answer against `count` and refuse to
    // proceed on a short read. Erroring out is deliberate. A partial schedule here does not
    // degrade gracefully; it deletes. The phantom-suppression pass below reasons about which
    // copies of a matchup exist, so a missing real copy makes a live game look like an
    // unplayed phantom beside nothing, and phantoms get their rows DELETED. Reading a short
    // list quietly is how a working game disappears from the site.
    const LIST_LIMIT = 1000
    const listRes = await fetch(`${FEED}/games?limit=${LIST_LIMIT}`)
    if (!listRes.ok) {
      await logRun(false, 0, 0, [`feed /games → ${listRes.status}`])
      return json({ error: `feed /games → ${listRes.status}` }, 502)
    }
    const listJson = await listRes.json()
    const feedGames: any[] = listJson.games ?? []
    // `count` is the feed's own total. Trust it over our row count, and stop if they disagree:
    // continuing would run the delete-happy dedupe over a schedule we know is incomplete.
    const feedCount = Number(listJson.count)
    if (Number.isFinite(feedCount) && feedGames.length < feedCount) {
      const msg = `feed /games truncated: ${feedGames.length} of ${feedCount} (limit ${LIST_LIMIT})`
      console.error(`[wpbl-ingest] ${msg}`)
      await logRun(false, 0, 0, [msg])
      return json({ error: msg }, 502)
    }

    // Phantom-duplicate suppression. The feed carries the same game more than once, and both
    // grouping keys below use the CORRECTED first pitch (correctedStart) so the timezone-tag
    // twins collapse onto one instant before we compare. Two shapes of duplicate:
    //
    //   (A) A stale, never-played copy beside the real one — same date + matchup, different
    //       game_id (e.g. a weather delay left an extra "Not Started" slot next to a completed
    //       game). Group by (Chicago date, matchup) ignoring time; if the group has a played
    //       copy (final/live/completed), any still-unplayed copy is a phantom.
    //   (B) The feed emits each upcoming game two-or-three times — once tagged Central, once
    //       tagged Eastern — for the SAME date, matchup, and (after correction) first pitch.
    //       Collapse each (date, matchup, corrected pitch) bucket to a single best copy,
    //       keeping whichever is most real: played over scheduled, has team ids over blank,
    //       then lowest game_id for stability. Including the time preserves real doubleheaders.
    //
    // Suppressed copies are skipped and any row we already ingested for them is deleted, so the
    // mirror is clean for EVERY consumer. Self-healing: if a suppressed game truly starts it
    // stops matching (its status flips, or it becomes the played copy) and re-ingests.
    const zoneOf = (fg: any) => s(fg.presto_data?.timeZone)
    const correctedIso = (fg: any) => correctedStart(s(fg.scheduled_start), zoneOf(fg))
    const matchupKey = (fg: any) => {
      const iso = correctedIso(fg)
      return `${iso ? chicagoDate(iso) : ''}|${s(fg.away_team_id)}|${s(fg.home_team_id)}`
    }
    const isPlayed = (fg: any) => !!s(fg.completed_at) || mapStatus(s(fg.status)) !== 'scheduled'
    const phantomIds = new Set<string>()

    // (A) unplayed copies of an already-played matchup.
    const playedMatchups = new Set<string>()
    for (const fg of feedGames) if (s(fg.game_id) && isPlayed(fg)) playedMatchups.add(matchupKey(fg))
    for (const fg of feedGames) {
      const id = s(fg.game_id)
      if (id && !isPlayed(fg) && playedMatchups.has(matchupKey(fg))) phantomIds.add(id)
    }

    // (B) timezone-tag twins: same matchup at the same corrected first pitch. Keep the best.
    const rank = (fg: any) =>
      (isPlayed(fg) ? 2 : 0) + (s(fg.home_team_id) && s(fg.away_team_id) ? 1 : 0)
    const buckets = new Map<string, any[]>()
    for (const fg of feedGames) {
      const id = s(fg.game_id)
      if (!id || phantomIds.has(id)) continue
      const iso = correctedIso(fg)
      if (!iso) continue
      const key = `${matchupKey(fg)}|${Date.parse(iso)}`
      ;(buckets.get(key) ?? buckets.set(key, []).get(key)!).push(fg)
    }
    for (const group of buckets.values()) {
      if (group.length < 2) continue
      group.sort((a, b) => rank(b) - rank(a) || s(a.game_id).localeCompare(s(b.game_id)))
      for (let i = 1; i < group.length; i++) phantomIds.add(s(group[i].game_id))
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
      const startIso = correctedStart(s(fg.scheduled_start), zoneOf(fg)) // tz-tag correction (see correctedStart)
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
        (force && (started || prior?.status === 'final')) || // corrections: re-fetch finals/started games
        (notFinalHere && (status !== 'scheduled' || started)) ||
        (prior != null && missingTracking.has(prior.id)) // late-TrackMan backfill for recent finals
      if (!wantBox) continue

      try {
        const box = await ingestBoxscore(db, up.id, apiGameId, gameRow.game_date, teamSlug, resolver)
        summary.boxscores++
        // A game we were already tracking has just finished — announce it to Discord now,
        // rather than leaving it for the scheduled poster's next quarter-hour. Deliberately
        // requires a `prior` row: a game first SEEN as final (a backfill, `mode: "all"`, a
        // season imported at once) was never watched finishing here and stays quiet.
        // announceFinal owns its own errors; the box score is already written either way.
        if (box.status === 'final' && prior != null && prior.status !== 'final') {
          await announceFinal(db, up.id)
          // The predictions game ends with the game. Done here rather than in the pass below
          // because that one starts from rounds that are still open, and a game whose last
          // round graded an inning ago has none left to find it by.
          await crownPredictions(up.id)
        }
      } catch (e) {
        summary.errors.push(`box ${apiGameId}: ${e instanceof Error ? e.message : e}`)
      }
    }

    await resolver.flush()
    // Every open Discord prediction round, settled against the plays this pass just wrote. It
    // owns its own errors: a Discord outage is not an ingest failure.
    await settlePredictions()
    await logRun(true, summary.games, summary.boxscores, summary.errors)
    return json({ ok: true, mode, ...summary })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await logRun(false, 0, 0, [msg])
    return json({ ok: false, error: msg }, 500)
  }
})
