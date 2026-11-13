// What the ingest makes of the feed, with no database in it: feed rows in, our rows out.
//
// Its own module so the spring rehearsal (scripts/rehearse-wpbl-feed.ts) runs the SAME code the
// edge function does. index.ts imports the Supabase client over HTTPS, so only Deno can load it;
// a rehearsal that restated these rules instead would drift from them, and then a clean diff
// would prove nothing about the ingest. Like names.ts and games.ts: `.ts` on every runtime
// import, no bare imports, nothing from the app.
//
// Moved here verbatim from index.ts on Nov 6, 2026. The comments that explain each rule came
// with it.

import { bestTwin } from './games.ts'

export const FEED = 'https://stats.womensprobaseballleague.com/v1'

// ─── small helpers ────────────────────────────────────────────────────────────
export const n = (v: unknown): number => {
  const x = parseInt(String(v ?? ''), 10)
  return Number.isFinite(x) ? x : 0
}
export const s = (v: unknown): string => (v == null ? '' : String(v))
// "2.2" innings → outs (2 innings + 2 outs = 8).
export const ipToOuts = (ip: unknown): number => {
  const t = s(ip).trim()
  if (!t) return 0
  const [w, f] = t.split('.')
  return (n(w)) * 3 + Math.min(n(f), 2)
}
// UTC instant → America/Chicago (the hub venue's zone) calendar date + wall-clock, so
// the stored game_date / start_time match what the rest of the app assumes (Central
// wall clock, re-rendered into each viewer's zone by formatGameTime).
const CHI = 'America/Chicago'
export function chicagoDate(iso: string): string {
  const d = new Date(iso)
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: CHI, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d)
  const get = (t: string) => p.find(x => x.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
export function chicagoTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: CHI, hour: 'numeric', minute: '2-digit' })
}

// The feed appends a literal "Z" to a naive wall-clock string (presto_data.startDateTime)
// that actually belongs to the zone in presto_data.timeZone, so scheduled_start is wrong
// by that zone's UTC offset. Every WPBL game runs on Central time, so we re-home each game
// from its tagged zone onto Central: shift the instant by (taggedZoneOffset − centralOffset).
//   • Eastern-tagged rows (the legacy encoding: feed said 5:30 PM, true pitch 6:30 PM CT) get
//     +1h, matching the old flat fix.
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
export function correctedStart(iso: string, feedZone: string, gameType = ''): string {
  if (!iso) return ''
  // THE POSTSEASON IS A DIFFERENT PRESTO SEASON AND DOES NOT USE THIS ENCODING. The bracket
  // games live under season "Womens Pro Baseball League Playoffs 2026", which publishes ONE
  // copy of each game (Eastern-tagged) carrying the TRUE instant, where the regular season
  // publishes a Central-tagged copy and an Eastern-tagged copy an hour apart. The shift below
  // exists only to collapse that pair, so applying it here moves a postseason game an hour
  // late. It did: BOS at SF on Sep 9, 2026 stored 7:00 PM Central against a first pitch of
  // 6:00 PM, which the league's own schedule page and the game itself both say (the feed had
  // it in the bottom of the 1st at 23:00Z + 25 min). Sep 11 and Sep 12 were an hour late the
  // same way. Keyed on the round rather than on the season id so it reads like
  // `countsInStandings`, and it fails the recoverable way: a feed that renames its game types
  // puts the postseason back an hour late, which is visible, rather than blank.
  if (/post|playoff|semi|champ|wild.?card/i.test(gameType)) return new Date(Date.parse(iso)).toISOString()
  // Missing tag → assume the legacy Eastern encoding (what every historical row was), so an
  // untagged feed row still gets the established +1h rather than silently landing an hour early.
  const zone = feedZone || 'America/New_York'
  const shiftMs = zoneOffsetMs(iso, zone) - zoneOffsetMs(iso, CHI)
  return new Date(Date.parse(iso) + shiftMs).toISOString()
}

// Feed status text → our enum. The boxscore's status.complete is authoritative when we
// have it; the games-list status string is the fallback.
export function mapStatus(text: string, complete?: boolean): 'scheduled' | 'live' | 'final' {
  if (complete) return 'final'
  const t = text.toLowerCase().trim()
  if (t.startsWith('final') || t.includes('complete') || t.includes('game over') || t.includes('walk-off')) return 'final'
  // Positive live signals only: everything else (incl. "Not Started", "Scheduled",
  // "TBA", "Postponed", "Canceled", or an unknown string) is treated as scheduled, so
  // future games never show as live by accident.
  if (t.includes('progress') || t.includes('inning') || t.includes('delay') || /\b(top|bottom|mid|end)\b/.test(t)) return 'live'
  return 'scheduled'
}

// ─── the schedule ─────────────────────────────────────────────────────────────

export const zoneOf = (fg: any) => s(fg.presto_data?.timeZone)
export const correctedIso = (fg: any) => correctedStart(s(fg.scheduled_start), zoneOf(fg), s(fg.game_type))
export const isPlayed = (fg: any) => !!s(fg.completed_at) || mapStatus(s(fg.status)) !== 'scheduled'

/**
 * The feed's duplicate copies of a game, which the ingest skips and deletes.
 *
 * Phantom-duplicate suppression. The feed carries the same game more than once, and both
 * grouping keys below use the CORRECTED first pitch (correctedStart) so the timezone-tag
 * twins collapse onto one instant before we compare. Two shapes of duplicate:
 *
 *   (A) A stale, never-played copy beside the real one: same date + matchup, different
 *       game_id (e.g. a weather delay left an extra "Not Started" slot next to a completed
 *       game). Group by (Chicago date, matchup) ignoring time; if the group has a played
 *       copy (final/live/completed), any still-unplayed copy is a phantom.
 *   (B) The feed emits each upcoming game two-or-three times (once tagged Central, once
 *       tagged Eastern) for the SAME date, matchup, and (after correction) first pitch.
 *       Collapse each (date, matchup, corrected pitch) bucket to a single best copy,
 *       keeping whichever is most real: played over scheduled, has team ids over blank,
 *       then lowest game_id for stability. Including the time preserves real doubleheaders.
 *
 * Suppressed copies are skipped and any row we already ingested for them is deleted, so the
 * mirror is clean for EVERY consumer. Self-healing: if a suppressed game truly starts it
 * stops matching (its status flips, or it becomes the played copy) and re-ingests.
 *
 * Only ever run over a list proved whole against its `count`: a missing real copy makes a
 * played game's twin look like a phantom beside nothing (see the truncation guard in index.ts).
 */
export function phantomGameIds(feedGames: readonly any[]): Set<string> {
  const matchupKey = (fg: any) => {
    const iso = correctedIso(fg)
    return `${iso ? chicagoDate(iso) : ''}|${s(fg.away_team_id)}|${s(fg.home_team_id)}`
  }
  const phantomIds = new Set<string>()

  // (A) unplayed copies of an already-played matchup.
  const playedMatchups = new Set<string>()
  for (const fg of feedGames) if (s(fg.game_id) && isPlayed(fg)) playedMatchups.add(matchupKey(fg))
  for (const fg of feedGames) {
    const id = s(fg.game_id)
    if (id && !isPlayed(fg) && playedMatchups.has(matchupKey(fg))) phantomIds.add(id)
  }

  // (B) timezone-tag twins: same matchup at the same corrected first pitch. Keep the best.
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
    // `bestTwin` owns the rule, and says why the feed's zone tag is in it. See games.ts.
    const keep = bestTwin(group.map(fg => ({
      gameId: s(fg.game_id),
      played: isPlayed(fg),
      hasTeams: !!(s(fg.home_team_id) && s(fg.away_team_id)),
      feedZone: zoneOf(fg),
    })))
    for (const fg of group) if (s(fg.game_id) !== keep?.gameId) phantomIds.add(s(fg.game_id))
  }
  return phantomIds
}

/** The `wpbl_games` row one `/games` entry upserts, minus `updated_at`, which is the clock's. */
export function gameRowOf(fg: any, homeSlug: string, awaySlug: string) {
  // `completed_at` outranks the status string, which the feed walks backwards after a game
  // ends. See the note on `complete` in boxscoreRows for what that cost.
  const status = s(fg.completed_at) ? 'final' as const : mapStatus(s(fg.status))
  const startIso = correctedStart(s(fg.scheduled_start), zoneOf(fg), s(fg.game_type)) // tz-tag correction (see correctedStart)
  const scoreAway = fg.presto_data?.score?.away
  const scoreHome = fg.presto_data?.score?.home

  // THE LIST SCORE IS NOT WRITTEN WHILE LIVE, and this is a correctness fix, not an
  // optimization. The list's `presto_data.score` runs a run ahead of the game mid-inning:
  // watched on Sep 16, 2026 it published away 6 for LA against the boxscore's away 5 in the
  // same second, and the boxscore's line totals (5) agreed with the boxscore. The boxscore
  // path owns the score for a live game (it says so itself, and `wantBox` is always
  // true when live), so folding the list score on here only ever ADDS a chance to be wrong:
  // on any pass the boxscore fetch throws, the transient list value sticks on the row and
  // the scoreboard reads 6-6 for a 6-5 game. Omitting the columns from the upsert RETAINS
  // the prior (boxscore-written) value rather than blanking it. Scheduled and final games
  // still take the list score: scheduled is 0-0, and on a final it is the fast path that
  // propagates a league score correction before the boxscore is re-fetched (see the
  // read-only-final trap in CLAUDE.md).
  const listScore = status === 'live' ? {} : {
    home_score: scoreHome != null && scoreHome !== '' ? n(scoreHome) : null,
    away_score: scoreAway != null && scoreAway !== '' ? n(scoreAway) : null,
  }
  return {
    startIso,
    row: {
      api_game_id: s(fg.game_id), season_id: s(fg.season_id) || null,
      game_date: startIso ? chicagoDate(startIso) : new Date().toISOString().slice(0, 10),
      start_time: startIso ? chicagoTime(startIso) : null,
      home_team_id: homeSlug, away_team_id: awaySlug,
      venue: s(fg.venue) || null, game_type: s(fg.game_type) || null,
      counts_in_standings: fg.counts_in_standings ?? null,
      status, status_detail: s(fg.status),
      ...listScore,
    },
  }
}

// ─── one box score ────────────────────────────────────────────────────────────

/** What a box-score entry is resolved against. The ingest's PlayerResolver writes back to the
 *  roster as it goes; the rehearsal's only reads. */
export interface BoxResolver {
  resolve(
    feed: { id?: string; name?: string; uniform?: string; bats?: string; throws?: string; position?: string },
    teamSlug: string,
    ctx: { gameId: string; date: string | null; played: boolean; contested: boolean },
  ): Promise<string | null>
  resolveName(name: string): string | null
}

/**
 * Every row one box score makes, before the TrackMan merge: the patch onto the game row, the
 * batting, pitching and fielding lines, and the plays. Players are resolved in feed order, then
 * the plays, which is the order the ingest has always run them in, and it matters: a resolve can
 * teach the resolver a spelling (`alias`) that a play's bare name is then matched against.
 */
export async function boxscoreRows(
  box: any,
  gameUuid: string,
  gameDate: string | null,
  slugOf: (apiTeamId: string) => string | null,
  resolver: BoxResolver,
  /** The list row's `completed_at`. See the note on `complete` below: the boxscore has no
   *  equivalent field and its own `status.complete` cannot be trusted to stay true. */
  completedAt: string,
  contested: Set<string>,
  normName: (name: string) => string,
) {
  const batting: Record<string, unknown>[] = []
  const pitching: Record<string, unknown>[] = []
  const fielding: Record<string, unknown>[] = []

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
  //
  // AND `status.complete` GOES BACKWARDS. Game 1 of the 2026 postseason finished at 01:51Z on
  // Sep 10, both feed surfaces published `completed_at`, and both then sat at "In Progress -
  // Bottom of 7th" with `complete: false` for hours afterwards. We had already stored the game
  // final off the list, so this downgraded a finished playoff game back to live: a live dot on
  // a game nobody was playing, the semifinal's 1-0 lead gone from the bracket because the
  // bracket counts finals, and no Discord recap, since `announceFinal` fires on a not-final to
  // final transition through this function and that transition had already been spent.
  // `completed_at` is the signal that does not lie: absent through the whole of the live game
  // (checked in the bottom of the 1st), present the moment it ended, and present on all 31
  // started games in the feed against none of the 34 unplayed ones. `isPlayed` in the
  // phantom-suppression pass already trusts it for exactly this reason.
  const st = box.status ?? {}
  const complete = !!st.complete || !!s(completedAt)
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
      const playerId = await resolver.resolve(pl, slug ?? '', {
        gameId: gameUuid, date: gameDate,
        played: derivedStatus !== 'scheduled',
        contested: contested.has(normName(s(pl.name))),
      })
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

  // Play-by-play: delete + reinsert (immutable per game, keeps sequence clean).
  const plays: Record<string, unknown>[] = (box.plays ?? []).map((p: any) => ({
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

  return { derivedStatus, gamePatch, batting, pitching, fielding, plays }
}

// ─── tracking (TrackMan) source ───────────────────────────────────────────────
// The boxscore embeds `tracking_activity`, but it's server-capped at 200 events: a
// full game is ~380. The dedicated /games/{id}/activity endpoint is the uncapped,
// paginated source (and adds `distance` on hit events), so we page through it and
// merge over whatever the boxscore carried, keyed by activity_id. Merging (rather than
// replacing) means we never lose the boxscore's set if /activity ever regresses, and
// the endpoint's richer copy wins on overlap. Games the league hasn't published
// tracking for return an empty page: nothing to do, and they light up automatically
// once it appears. (Complements the late-backfill gate in index.ts, which re-fetches recent
// finals whose tracking posts after the game goes Final.)
export async function fetchTracking(apiGameId: string, fromBox: any[]): Promise<any[]> {
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

/** The `wpbl_pitch_tracking` rows for one game, upserted on `activity_id` (stable per event). */
export function trackingRows(tracking: readonly any[], gameUuid: string): Record<string, unknown>[] {
  return tracking
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
}
