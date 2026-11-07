// wpbl-ingest: pulls the WPBL official public feed and mirrors it into Supabase.
//
// The league publishes a JSON API at https://stats.womensprobaseballleague.com/v1 with
// no auth. This function reconciles it against our tables (readable team slugs + player
// uuids, keyed to the feed by api_id) and upserts games, box-score lines, fielding,
// play-by-play, and TrackMan pitch tracking. It is idempotent: safe to run on a cron.
//
// Invoke (POST, JSON body, all fields optional):
//   { "mode": "all" | "active", "gameId": "<api id>", "force": false }
//   • mode "all":     (re)ingest every game's boxscore. Use for the initial backfill.
//   • mode "active":  DEFAULT. Only fetch boxscores for games that aren't already
//                     'final' in our DB (i.e. scheduled→live→final transitions). Cheap
//                     enough to run every couple minutes.
//   • gameId:         ingest just this one game (implies its boxscore, ignores mode).
//   • force:          with mode "active", also re-fetch games already final (corrections).
//
// Deploy:
//   supabase functions deploy wpbl-ingest
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically. The service role
// bypasses RLS, so this writes freely; the public still reads through the RLS policies.
// See scripts/add_wpbl_api_ingest.sql for the schema and scripts/wpbl_cron.sql for the
// schedule.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { normName, editDistance, isDamaged, replacementMatch, tradeMatch, teamMoveWins, usableEvidence, contestedNames, anonymous } from './names.ts'
import { announceFinal } from './announce-final.ts'
import { crownPredictions, settlePredictions } from './settle-predictions.ts'
import { checkBoxscore, checkGameList } from './feed-contract.ts'
import { FEED, s, chicagoDate, phantomGameIds, gameRowOf, boxscoreRows, fetchTracking, trackingRows } from './transform.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// The rules that turn feed rows into ours (dates, status, duplicates, every row a box score
// makes) live in transform.ts, so the spring rehearsal runs the same code. This file is what
// touches the database: the roster resolver, the writes, and deciding what to fetch.

// ─── player reconciliation cache ──────────────────────────────────────────────
// Resolve a feed player to our wpbl_players.id: by any feed id we have ever seen for them,
// else by (team, name), else by a league-wide name match that means they were traded, else
// insert a new roster row. Backfills feed ids / uniform / bats / throws on the way, and moves
// a player's club forward when a box score puts them somewhere new.
//
// TRADES. The feed mints a NEW player_id per club: Diana Ibarra is moizfkn9dtrm4vno on New
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
  // to be ≥3 chars, and bails on any ambiguity (two teammates sharing a surname), so it
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
  private traded(teamSlug: string, nm: string, apiId: string): string | null {
    return tradeMatch(nm, teamSlug, [...this.players.values()], apiId)
  }

  /** Remember a feed id (and the feed's spelling of the name) against a player we resolved. */
  private link(id: string, apiId: string, nm: string) {
    const p = this.players.get(id)
    if (!p) return
    if (nm !== p.norm) this.alias.set(nm, id)
    if (!apiId || p.apiIds.has(apiId)) return
    p.apiIds.add(apiId)
    this.byApi.set(apiId, id)
    // api_id stays "the current one" (plenty of code reads it as a scalar) while api_ids
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
    if (!p || !teamSlug) return false
    // A game that has not been PLAYED is a plan, not evidence: the feed stages lineups ahead
    // of first pitch, `mode: "all"` walks the whole schedule, and a staged copy of tonight's
    // game is dated today, so the date alone never sees it.
    if (!usableEvidence(ctx, chicagoDate(new Date().toISOString()))) return false
    // Listed on both sides of this game, so it names two clubs and means neither.
    if (ctx.contested) return false
    if (p.teamId === teamSlug) {
      // Same club, but a newer game: raise the floor so a later re-read of an older game
      // cannot move them. Cheap: in steady state this is only the games ingested for the
      // first time, and a re-poll of the same live game writes nothing.
      if (p.teamAsOf == null || ctx.date > p.teamAsOf) {
        p.teamAsOf = ctx.date
        this.patch(id, { team_as_of: ctx.date })
      }
      return false
    }
    // AN ENTRY THE FEED DID NOT IDENTIFY MOVES NOBODY, and this is the place that has to hold
    // it rather than `tradeMatch` alone. Every matcher's answer arrives here, and two of them
    // besides the trade rule can cross clubs: `alias`, which is keyed on a name and not scoped
    // to a team, and any future one. Emi Saiki was moved to Los Angeles on Sep 5, 2026 off an
    // anonymous entry in a Los Angeles box score, having never played a game for them; the
    // eleven rows she has in wpbl_player_team_changes are that argument in both directions,
    // one club each way per game. See `anonymous` in names.ts for why the id is the signal.
    if (anonymous(apiId)) return false
    if (!teamMoveWins(p, teamSlug, ctx, chicagoDate(new Date().toISOString()))) return false   // older news
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
    if (!p || !uniform) return
    // A staged lineup for a game nobody has played is a plan, not evidence.
    if (!usableEvidence(ctx, chicagoDate(new Date().toISOString()))) return
    // Both sides of this game list her, and a new club usually means a new number, so the
    // two entries disagree about this too.
    if (ctx.contested) return
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

    // 1) a feed id we have seen before, including one this player picked up in an earlier trade
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

    // 3.75) exact name, different club: she was traded, not born. PLAYED GAMES ONLY: this is
    // the one matcher that reaches across clubs, so it is the one a staged lineup can turn into
    // a mass trade, and on Sep 3, 2026 it did. Seventeen Hunters read as Queens off a copy of
    // that night's Los Angeles game that was never played, which left Boston's roster page
    // showing one name. The guard in noteTeam could not help: the staged game was TODAY'S.
    if (!id && ctx.played) {
      const moved = this.traded(teamSlug, nm, apiId)
      if (moved) { id = moved; reason = 'name-match' }
    }

    if (id) {
      this.link(id, apiId, nm)
      this.noteTeam(id, teamSlug, ctx, apiId, reason)
      this.noteJersey(id, s(feed.uniform), ctx)
      return id
    }

    // 4) insert a new feed-only player, but never under a name we know is damaged. An
    // unmatched damaged name is either a roster player this run couldn't recognize or a
    // genuinely new one whose name we can't spell; inserting it is wrong in both cases and
    // permanent, while skipping costs only this player's lines for this run. The ingest is
    // idempotent and re-runs every couple of minutes, so a clean payload backfills them.
    if (isDamaged(nm)) {
      console.warn('[wpbl-ingest] skipping player with a damaged name (bad decode upstream):', JSON.stringify(name))
      return null
    }
    // PLAYED GAMES ONLY, the same rule and for a sharper version of the same reason. A roster
    // row is permanent and a staged lineup is a plan, typos included: Aug 27, 2026's staged
    // LA-at-NY carried Suzu Narasaki twice, spelled "Narasaki" under the club she had just
    // been traded to and "Naraski" under the one she had left. Every matcher but one is scoped
    // to a single club, and `tradeMatch`, the one that is not, demands the exact spelling
    // precisely because it is the only rule that could merge two different people. So the
    // typo matched nothing and landed here, and the league had a second Suzu Narasaki with no
    // feed id, no stats and no way back out but wpbl_merge_players. The played box score for
    // that same game spells her correctly on both sides.
    //
    // Skipping costs this entry's lines for this pass, and a staged lineup's lines are zeros.
    // If she is genuinely new, the played box score inserts her minutes later.
    if (!ctx.played) {
      console.log('[wpbl-ingest] not inserting a player off an unplayed box score:', JSON.stringify(name))
      return null
    }
    // AND NEVER OFF AN ANONYMOUS ENTRY, the third guard on this insert and the one that pays
    // for the bar `tradeMatch` now sets. Refusing to read an anonymous entry as a trade is only
    // half a fix: the entry then falls through to here, and a second Emi Saiki with no feed id
    // and no stats makes `emi-saiki` an ambiguous slug, which 404s the canonical page of the
    // one who is real (see the slug rules in routes.ts). That is not a hypothetical. It is what
    // the second Suzu Narasaki was, and `wpbl_merge_players` was the only way back out.
    //
    // Free, on the evidence: of 118 players, the 49 with no feed id have no box-score line
    // between them, so an anonymous entry has never yet been anything the site could show.
    // Skipping costs this entry for this pass, and the ingest re-runs every two minutes.
    if (anonymous(apiId)) {
      console.log('[wpbl-ingest] not inserting a player the feed gave no id:', JSON.stringify(name))
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
 *  date, so every resolve carries one, and only ever true at all if the game was played, so
 *  every resolve carries that too.
 *
 *  `played` is the box score's DERIVED status, not the feed's list status: a game the feed
 *  still calls "Not Started" can be underway, and one it has only staged a lineup for has not
 *  been played at all. Everything that writes a fact about a PERSON rather than about a game
 *  (her club, her uniform number) is gated on it. */
interface GameCtx {
  gameId: string
  date: string | null
  played: boolean
  /** This box score lists this player on BOTH sides. See `contestedNames`. */
  contested: boolean
}

// Write one game's child rows with minimal churn. The old delete-then-insert rewrote every
// row on every ingest, brutal under the every-2-min live re-ingest, which bloats the table
// and its indexes. Instead upsert on the natural key: rows that already exist are updated in
// place (a HOT update, since the indexed columns game_id/player_id/sequence don't change and
// the stat columns aren't indexed), so the indexes stay stable and dead tuples drop sharply.
// Then prune any rows for this game the feed no longer reports: in steady state this matches
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
  gameDate: string | null,
  teamSlug: Map<string, string>,
  resolver: PlayerResolver,
  /** The list row's `completed_at`. See the note on `complete` in boxscoreRows (transform.ts): the boxscore has no
   *  equivalent field and its own `status.complete` cannot be trusted to stay true. */
  completedAt: string,
): Promise<{ status: 'scheduled' | 'live' | 'final'; batting: number; pitching: number; fielding: number; plays: number; tracking: number; breaks: string[] }> {
  const res = await fetch(`${FEED}/games/${apiGameId}/boxscore`)
  if (!res.ok) throw new Error(`boxscore ${apiGameId} → ${res.status}`)
  const body = await res.json()
  const box = body.boxscore
  if (!box) throw new Error(`boxscore ${apiGameId} empty`)
  // Reported, not refused: see feed-contract.ts for why a broken box score is still ingested.
  const breaks = checkBoxscore(body, apiGameId)

  const slugOf = (apiTeamId: string) => teamSlug.get(apiTeamId) ?? null
  // Names this box score puts on both sides: contradictory evidence about a club, and the
  // one thing a box score can say that must move nobody. See contestedNames in names.ts.
  const contested = contestedNames((box.teams ?? []).flatMap((t: any) =>
    (t.players ?? []).map((pl: any) => ({ club: slugOf(s(t.id)) ?? '', name: s(pl.name) }))))

  const { derivedStatus, gamePatch, batting, pitching, fielding, plays } = await boxscoreRows(
    box, gameUuid, gameDate, slugOf, resolver, completedAt, contested, normName)
  // Reading this box score IS the tracking check, whatever brought us here, so the stamp
  // rides the update the fetch was going to make anyway rather than costing a round trip.
  // It also means a game that has just gone final is already fresh, and the backfill leaves
  // it alone for an hour instead of re-reading it on the very next pass.
  gamePatch.tracking_checked_at = new Date().toISOString()

  // TrackMan: sourced from the uncapped /activity endpoint (merged over the boxscore's
  // capped copy), upsert on activity_id (stable per event).
  const tracking = trackingRows(await fetchTracking(apiGameId, box.tracking_activity ?? []), gameUuid)

  // Write everything with low-churn upserts (see syncGameRows). Box-score lines and plays
  // key on their natural unique index; tracking keys on activity_id.
  await db.from('wpbl_games').update(gamePatch).eq('id', gameUuid)

  await syncGameRows(db, 'wpbl_batting_lines',  gameUuid, batting,  'player_id', 'game_id,player_id')
  await syncGameRows(db, 'wpbl_pitching_lines', gameUuid, pitching, 'player_id', 'game_id,player_id')
  await syncGameRows(db, 'wpbl_fielding_lines', gameUuid, fielding, 'player_id', 'game_id,player_id')
  await syncGameRows(db, 'wpbl_game_plays',     gameUuid, plays,    'sequence',  'game_id,sequence')

  if (tracking.length) await db.from('wpbl_pitch_tracking').upsert(tracking, { onConflict: 'activity_id' })

  return { status: derivedStatus, batting: batting.length, pitching: pitching.length, fielding: fielding.length, plays: plays.length, tracking: tracking.length, breaks }
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

  // Health log: one row per run (success or failure) so the app can show a freshness
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
    // Feed team id → slug map (and reject if the seed migration hasn't run).
    //
    // A CLUB HAS MORE THAN ONE FEED ID, for the same reason a player does: the league mints a
    // new one per context and nothing in the payload says the two are the same team. Boston is
    // 9f08or2mffx81409 all regular season and rknw1oz8pl20apx4 in the postseason, both live in
    // /games at once. Reading the scalar `api_id` alone left every bracket game unmapped, so
    // the loop below skipped all four, into `summary.errors`, which did not then set
    // `ok: false`. Game 1 was played on Sep 9, 2026 with no row on the site at all.
    // So match on ANY id the club has held; api_ids is the same shape as wpbl_players.api_ids.
    const { data: teams } = await db.from('wpbl_teams').select('id, city, name, abbr, api_id, api_ids')
    const teamSlug = new Map<string, string>()
    for (const t of teams ?? []) {
      for (const a of [...(t.api_ids ?? []), t.api_id]) if (a) teamSlug.set(a as string, t.id)
    }
    if (teamSlug.size === 0) {
      await logRun(false, 0, 0, ['No wpbl_teams.api_id mappings. Run scripts/add_wpbl_api_ingest.sql first'])
      return json({ error: 'No wpbl_teams.api_id mappings. Run scripts/add_wpbl_api_ingest.sql first' }, 400)
    }

    // And LEARN the next one, because the postseason ids will not be the last set the feed
    // mints and a club it cannot map is a game we drop entirely. The feed names the club on
    // the same row as the id ("San Francisco Firebells" = city + name), and there are four
    // clubs with nothing close to a shared name, so an exact full-name hit is unambiguous.
    // Adopt on that alone, persist it into api_ids, and the mapping is there next pass.
    // Deliberately EXACT and never fuzzy: a wrong club here silently files a whole game's
    // lines under the other team, which is far worse than the missing row it replaces.
    const teamByName = new Map<string, string>()
    for (const t of teams ?? []) {
      teamByName.set(normName(`${t.city ?? ''} ${t.name ?? ''}`), t.id)
      if (t.abbr) teamByName.set(normName(String(t.abbr)), t.id)
    }
    const adoptTeam = async (apiTeamId: string, feedName: string): Promise<string | undefined> => {
      const slug = teamByName.get(normName(feedName))
      if (!apiTeamId || !slug) return undefined
      teamSlug.set(apiTeamId, slug)
      const row = (teams ?? []).find((t: any) => t.id === slug)
      const ids = [...new Set([...(row?.api_ids ?? []), row?.api_id, apiTeamId].filter(Boolean))]
      if (row) row.api_ids = ids
      const { error } = await db.from('wpbl_teams').update({ api_ids: ids }).eq('id', slug)
      console.log(`[wpbl-ingest] adopted feed team id ${apiTeamId} as ${slug}${error ? ` (not persisted: ${error.message})` : ''}`)
      return slug
    }

    // Player cache for reconciliation.
    const { data: players } = await db.from('wpbl_players').select('id, name, team_id, api_id, api_ids, team_as_of, jersey_number')
    const resolver = new PlayerResolver(db, players ?? [])

    // Our current games (to decide which boxscores to (re)fetch).
    const { data: ourGames } = await db.from('wpbl_games').select('id, api_game_id, status, game_date, tracking_checked_at')
    const byApi = new Map<string, { id: string; status: string }>()
    for (const g of ourGames ?? []) if (g.api_game_id) byApi.set(g.api_game_id, { id: g.id, status: g.status })

    // Late TrackMan backfill. The league reconciles tracking (event_type
    // 'rest_reconciliation') in batches that land DAYS after a game goes Final. The two
    // Aug 1–2 games were both published in a single batch on Aug 3, and later games can lag
    // further and arrive in bulk. The "active" gate below skips games already stored final,
    // so without this those late batches would be lost forever. Re-fetch recently-final
    // games that still have zero tracking rows; once the feed posts the data (or the window
    // lapses) this stops. The window must comfortably exceed the observed publish lag, so it
    // is generous: the cost is only a boxscore+activity fetch per still-untracked final,
    // and the set shrinks to nothing as games fill in. Empty on the initial `all` backfill
    // (which fetches everything anyway).
    //
    // ONCE AN HOUR PER GAME, NOT ONCE A PASS. The gate below had no memory, so "still has no
    // tracking" was re-asked every two minutes for as long as the window lasted. The league
    // published tracking for the Aug 1 and Aug 2 games and none since, so by Sep 4, 2026 this
    // was re-reading 17 games 30 times an hour, a box score and a paged activity call each:
    // ~24,000 requests a day to the league's API and ~1.2M row upserts, for data that had not
    // existed for a month. The cron file still says finished games stop costing anything, and
    // this is what made that untrue. Tracking that arrives DAYS late does not need a two-minute
    // poll; `tracking_checked_at` records when we last looked so it can be asked hourly.
    const BACKFILL_DAYS = 21
    const TRACKING_RECHECK_MS = 60 * 60 * 1000
    const dayAge = (d: string | null) => d ? (Date.now() - Date.parse(`${d}T00:00:00Z`)) / 86_400_000 : Infinity
    // Null means never looked at, which is every row until the first pass after the column
    // landed, and is also what a re-ingested game gets back.
    const dueForTracking = (checkedAt: string | null) =>
      !checkedAt || Date.now() - Date.parse(checkedAt) >= TRACKING_RECHECK_MS
    const recentFinalIds = (ourGames ?? [])
      .filter(g => g.status === 'final' && dayAge(g.game_date) <= BACKFILL_DAYS
        && dueForTracking(g.tracking_checked_at as string | null))
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
    // The contract (feed-contract.ts). An envelope without `count` stops the pass here, because
    // the guard below used to skip itself on a missing count (`Number.isFinite(NaN)` is false)
    // and let the dedupe run over a list nothing had proved whole.
    const list = checkGameList(await listRes.json())
    if (list.fatal) {
      console.error(`[wpbl-ingest] ${list.fatal}`)
      await logRun(false, 0, 0, [list.fatal])
      return json({ error: list.fatal }, 502)
    }
    const feedGames: any[] = list.games
    // `count` is the feed's own total. Trust it over our row count, and stop if they disagree:
    // continuing would run the delete-happy dedupe over a schedule we know is incomplete.
    const feedCount = list.count
    if (feedGames.length < feedCount) {
      const msg = `feed /games truncated: ${feedGames.length} of ${feedCount} (limit ${LIST_LIMIT})`
      console.error(`[wpbl-ingest] ${msg}`)
      await logRun(false, 0, 0, [msg])
      return json({ error: msg }, 502)
    }

    // The feed's duplicate copies (timezone twins, stale slots beside a played game). The rule
    // and why it deletes are in transform.ts; it is only safe over the list proved whole above.
    const phantomIds = phantomGameIds(feedGames)

    // Rows that break the contract are ingested anyway and reported here first, so they lead
    // the 25 errors the run log keeps. A one-game pass reports only its own row's: the drift
    // check repairs one game at a time and fails the repair on `ok: false`, so another row's
    // break would fail every repair for a reason that has nothing to do with the game.
    const listBreaks = oneGame
      ? checkGameList({ count: list.count, games: feedGames.filter(fg => s(fg?.game_id) === oneGame) }).breaks
      : list.breaks
    const summary = { games: 0, boxscores: 0, phantomsRemoved: 0, errors: [...listBreaks] }

    for (const fg of feedGames) {
      const apiGameId = s(fg.game_id)
      if (!apiGameId) continue
      if (oneGame && apiGameId !== oneGame) continue

      // Phantom copy of an already-played game: skip it, and delete any row we ingested on
      // an earlier run (cascades its lines/plays). It re-appears only if it truly starts.
      if (phantomIds.has(apiGameId)) {
        if (byApi.has(apiGameId)) {
          await db.from('wpbl_games').delete().eq('api_game_id', apiGameId)
          summary.phantomsRemoved++
        }
        continue
      }

      // TBD placeholder games have empty team ids: skip them silently.
      if (!s(fg.home_team_id) || !s(fg.away_team_id)) continue
      const homeSlug = teamSlug.get(s(fg.home_team_id))
        ?? await adoptTeam(s(fg.home_team_id), s(fg.home_team_name))
      const awaySlug = teamSlug.get(s(fg.away_team_id))
        ?? await adoptTeam(s(fg.away_team_id), s(fg.away_team_name))
      if (!homeSlug || !awaySlug) { summary.errors.push(`unmapped team in ${apiGameId}`); continue }

      // The row itself, and why the list score is left off a live game, is transform.ts's.
      const { startIso, row } = gameRowOf(fg, homeSlug, awaySlug)
      const status = row.status
      const gameRow = { ...row, updated_at: new Date().toISOString() }
      const { data: up, error: upErr } = await db.from('wpbl_games')
        .upsert(gameRow, { onConflict: 'api_game_id' }).select('id').single()
      if (upErr || !up) { summary.errors.push(`upsert ${apiGameId}: ${upErr?.message}`); continue }
      summary.games++

      // Decide whether to pull the boxscore. Besides explicit/live cases, also fetch once
      // a game's scheduled start has passed (its list-status may still read "Not Started"
      // even though it's underway); the boxscore itself then decides live vs final.
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
        const box = await ingestBoxscore(db, up.id, apiGameId, gameRow.game_date, teamSlug, resolver, s(fg.completed_at))
        summary.boxscores++
        summary.errors.push(...box.breaks)
        // A game we were already tracking has just finished: announce it to Discord now,
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
    // ANY ERROR IS A FAILED RUN. This said `ok: true` whatever `summary.errors` held, and the
    // postseason proved what that costs: four bracket games unmapped on every pass for two days,
    // logged `ok: true`, seen only as an amber chip on /admin, while Game 1 was played with no row
    // on the site. An error here is a game we did not mirror or a feed that no longer matches its
    // contract, and either is the owner's to know about. The pass still writes everything it
    // could; `ok` says whether that was everything.
    const ok = summary.errors.length === 0
    await logRun(ok, summary.games, summary.boxscores, summary.errors)
    return json({ ok, mode, ...summary })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await logRun(false, 0, 0, [msg])
    return json({ ok: false, error: msg }, 500)
  }
})
