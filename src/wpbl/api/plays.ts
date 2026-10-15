import { supabase } from '../../lib/supabase'
import { inSeason, seasonOf } from '../season'
import { applyPlayCorrections, CORRECTION_SELECT, type WpblPlayCorrection } from '../playCorrections'
import { RUN_VALUE_PLAY_SELECT, type WpblRunEnvironment } from '../derive/runEnvironment'
import { playerPlayIds, PA_EVENT_TYPES, type WpblMatchupPlay } from '../derive/matchups'
import type {
  WpblPlayer, WpblGame, WpblGamePlay, WpblRecapPlay, WpblPitchPlay, WpblRunValuePlay,
  WpblSprayPlay,
} from '../types'
import { safe, once, inflight, readOverlay, overlayGameId, asGame, isFresh, fetchAllPaged } from './core'
import { lastGoodSchedule, fetchWpblSchedule } from './games'

// The play-by-play: the season's play log and its filtered views, one player's at-bats, one game's plays,
// and the corrections laid over all of them.

// The season's priced run environment (derive/runEnvironment.ts): one row, read in place of the
// whole play log by the surfaces that only want its weights. Null when the row is missing or the
// read fails, which every caller treats as "price it from the plays", the way it was before.
let runEnvironmentCache: { data: WpblRunEnvironment | null; at: number } | null = null
export function getCachedWpblRunEnvironment(): WpblRunEnvironment | null { return runEnvironmentCache?.data ?? null }
export function fetchWpblRunEnvironment(): Promise<WpblRunEnvironment | null> {
  if (isFresh(runEnvironmentCache)) return Promise.resolve(runEnvironmentCache!.data)
  return once('runEnvironment', async () => {
    const rows = await safe<WpblRunEnvironment[]>('fetchWpblRunEnvironment', () =>
      supabase.from('wpbl_run_environment').select('scope,woba_weights,fip_weights,final_games,plays,computed_at')
        .eq('scope', 'regular').limit(1) as unknown as
        PromiseLike<{ data: WpblRunEnvironment[] | null; error: unknown }>,
      [])
    const data = rows[0] ?? null
    runEnvironmentCache = { data, at: Date.now() }
    return data
  })
}

// ─── The play log ──────────────────────────────────────────────────────────────
//
// ONE READ OF wpbl_game_plays FOR THE WHOLE SECTION. There used to be five, each narrowed to its
// own board: run value (every row, with the base-out state), the pitch-code boards (rows with a
// pitch sequence), batter vs pitcher (plate appearances), the spray chart (balls in play) and the
// Hall of Firsts. Each was its own scan of the same table, four pages deep, so a reader who went
// from Home to Stats to a team page downloaded the same plays three times. On the Oct 2026
// snapshot they were 131 KB, 51 KB, 97 KB and 47 KB gzipped, and every one of the last three is a
// subset of the first. Run value cannot be narrowed (run expectancy walks every row), and Home and
// Stats load it on nearly every visit, so the others are now filters over it in memory and cost
// nothing once it is here. The edge cache gains too: one URL per season instead of four shapes.
//
// THE CORRECTIONS RUN BEFORE THE FILTERS, which one log also buys. A read filtered at the database
// sees the mirror's row, so a correction that turned a pickoff into a double had to fetch the row
// it brought into the filter by its key afterwards. Over the whole log the overlay just runs first.
//
// ONE SEASON AT A TIME, ON THE SERVER. Every board shows one year, and the log grows by a whole
// season every year, so a board that read every season would download two years to draw one in
// 2027 and three in 2028. A season read filters on its games' dates through an embedded join
// (`wpbl_games!inner()` with no columns, so it adds no bytes to a row), and its URL is the same
// for every reader of that year, which is what lets the edge hold it. `null` is every season, for
// the surfaces that span them on purpose: batter vs pitcher and the win model. The surfaces still
// cut what they are handed (useWpblSeason): a cut of rows that are already one season returns the
// same array, so it costs nothing, and it is the net under this read rather than a second rule.

/** Every column a league-wide play surface reads: run expectancy's, which is the widest, plus
 *  `is_hit` for the spray chart. */
const PLAY_LOG_SELECT = `${RUN_VALUE_PLAY_SELECT},is_hit`

/** One row of the play log. Every narrower play type the section reads is a Pick of this. */
export type WpblLogPlay = WpblRunValuePlay & Pick<WpblGamePlay, 'is_hit'>

/** A season, or null for every season the league has played. */
export type WpblPlayScope = number | null

const playLogCache = new Map<string, { data: WpblLogPlay[]; at: number }>()
const scopeKey = (season: WpblPlayScope) => (season == null ? 'all' : String(season))

/** One season cut out of the every-season log, when that is in memory and so is the schedule that
 *  says which year each game is in. Cached under the season, so a second caller gets the same
 *  array and anything cached on its identity still hits. */
function sliceOfAll(season: number, needFresh: boolean): WpblLogPlay[] | null {
  const all = playLogCache.get('all')
  if (!all || (needFresh && !isFresh(all)) || !lastGoodSchedule) return null
  const data = inSeason(all.data, lastGoodSchedule, season)
  playLogCache.set(scopeKey(season), { data, at: all.at })
  return data
}

/** The years that can have plays: every one in the schedule with a game that has started. */
function playedSeasons(games: WpblGame[]): number[] {
  const years = new Set<number>()
  for (const g of games) if (g.status !== 'scheduled') { const y = seasonOf(g); if (y != null) years.add(y) }
  return [...years]
}
const byGameAndSequence = (a: WpblLogPlay, b: WpblLogPlay) =>
  a.game_id < b.game_id ? -1 : a.game_id > b.game_id ? 1 : a.sequence - b.sequence

/** Every season, put together from the seasons already read, when they are all here. The other
 *  half of `sliceOfAll`: Home reads this season and Game Center's win model reads every season,
 *  and while the league has played one they are the same rows, which a reader going from one to
 *  the other used to download twice. Waits on a season read already in flight. */
async function allFromSeasons(needFresh: boolean): Promise<WpblLogPlay[] | null> {
  if (!lastGoodSchedule) return null
  const years = playedSeasons(lastGoodSchedule)
  if (years.length === 0) return null
  const parts: (Promise<WpblLogPlay[]> | WpblLogPlay[])[] = []
  for (const y of years) {
    const held = playLogCache.get(String(y))
    const pending = inflight.get(`playLog:${y}`) as Promise<WpblLogPlay[]> | undefined
    if (held && (!needFresh || isFresh(held))) parts.push(held.data)
    else if (pending) parts.push(pending)
    else return null
  }
  const logs = await Promise.all(parts)
  if (logs.some(l => l.length === 0)) return null
  const data = logs.length === 1 ? logs[0] : logs.flat().sort(byGameAndSequence)
  playLogCache.set('all', { data, at: Math.min(...years.map(y => playLogCache.get(String(y))?.at ?? Date.now())) })
  return data
}

export function getCachedWpblPlayLog(season: WpblPlayScope = null): WpblLogPlay[] | null {
  const own = playLogCache.get(scopeKey(season))
  if (own) return own.data
  if (season != null) return sliceOfAll(season, false)
  // Synchronously, only when every season is already held (no read to wait on).
  if (!lastGoodSchedule) return null
  const years = playedSeasons(lastGoodSchedule)
  const logs = years.map(y => playLogCache.get(String(y))?.data)
  if (years.length === 0 || logs.some(l => !l || l.length === 0)) return null
  const data = logs.length === 1 ? logs[0]! : (logs as WpblLogPlay[][]).flat().sort(byGameAndSequence)
  playLogCache.set('all', { data, at: 0 })
  return data
}

/** The play log for one season, or every season, in game and sequence order, corrected. */
export function fetchWpblPlayLog(season: WpblPlayScope = null): Promise<WpblLogPlay[]> {
  const key = scopeKey(season)
  const own = playLogCache.get(key)
  if (isFresh(own ?? null)) return Promise.resolve(own!.data)
  if (season != null) {
    const slice = sliceOfAll(season, true)
    if (slice) return Promise.resolve(slice)
    // Every season is already on its way (a surface asked before the schedule could say which
    // year is on screen): wait for it and cut this one out, rather than downloading it twice.
    const all = inflight.get('playLog:all')
    if (all) return all.then(() => sliceOfAll(season, true) ?? fetchWpblPlayLog(season))
  }
  return once(`playLog:${key}`, async () => {
    if (season == null) {
      const assembled = await allFromSeasons(true)
      if (assembled) return assembled
    }
    // A dev overlay's made-up season has no rows in the database: read the real season it copies,
    // let the overlay add its copies (fetchAllPaged does), then cut back to the season asked for.
    const read = season == null ? null : readOverlay?.sourceSeason?.(season) ?? season
    // The corrections read runs BESIDE the pages, not after them: it is independent of them and
    // used to add a whole round trip to the end of the section's slowest read.
    const [out, corrections] = await Promise.all([
      fetchAllPaged<WpblLogPlay>('fetchWpblPlayLog', (from, to) => {
        const rows = supabase.from('wpbl_game_plays')
          .select(read == null ? PLAY_LOG_SELECT : `${PLAY_LOG_SELECT},wpbl_games!inner()`)
        const scoped = read == null ? rows
          : rows.gte('wpbl_games.game_date', `${read}-01-01`).lt('wpbl_games.game_date', `${read + 1}-01-01`)
        return scoped
          .order('game_id', { ascending: true })
          .order('sequence', { ascending: true })
          .range(from, to) as unknown as
          PromiseLike<{ data: WpblLogPlay[] | null; error: unknown }>
      }, PLAY_LOG_WAVE),
      fetchAllPlayCorrections(),
    ])
    let corrected = applyPlayCorrections(out, corrections)
    if (season != null && read !== season) corrected = inSeason(corrected, lastGoodSchedule ?? await fetchWpblSchedule(), season)
    // A short read keeps the last good log, and leaves its clock alone so the next caller retries.
    if (corrected.length > 0 || !playLogCache.has(key)) playLogCache.set(key, { data: corrected, at: Date.now() })
    return corrected
  })
}

/** A filtered view of one log, built once per log array, so every caller of the same season gets
 *  the same array and a derivation cached on its identity keeps hitting. */
const logViews = new WeakMap<WpblLogPlay[], Map<string, WpblLogPlay[]>>()
function viewOf(log: WpblLogPlay[], name: string, keep: (p: WpblLogPlay) => boolean): WpblLogPlay[] {
  let views = logViews.get(log)
  if (!views) logViews.set(log, views = new Map())
  let view = views.get(name)
  if (!view) views.set(name, view = log.filter(keep))
  return view
}

/** Every play with a pitch sequence, for the pitch-code boards. A third of the log is baserunning
 *  and substitution rows that carry no pitches. */
const hasPitches = (p: WpblLogPlay) => p.pitch_sequence != null

/** The plays that put a ball in play, for the spray chart. Outs as well as hits: a flyout is the
 *  best-covered category in the whole log for direction, and a chart of hits alone draws a picture
 *  in which every ball a fielder caught never happened. */
const BATTED_BALL_EVENTS = new Set([
  'single', 'double', 'triple', 'home_run',
  'groundout', 'flyout', 'lineout', 'popup', 'foul_out', 'sacrifice', 'fielders_choice', 'out',
])
export const isBattedBall = (p: Pick<WpblGamePlay, 'event_type'>) => BATTED_BALL_EVENTS.has(p.event_type ?? '')

/** The plate appearances, for batter vs pitcher. Built from the same sets `classifyPa` reads, so it
 *  drops steals, pickoffs and substitution notes and cannot drop an out. */
const PA_EVENTS = new Set(PA_EVENT_TYPES)
const isPlateAppearance = (p: WpblLogPlay) => PA_EVENTS.has(p.event_type ?? '')

/** Every play, for run value and the win model. See the play log above. */
export function fetchWpblAllRunValuePlays(season: WpblPlayScope = null): Promise<WpblRunValuePlay[]> {
  return fetchWpblPlayLog(season)
}
export function getCachedWpblAllRunValuePlays(season: WpblPlayScope = null): WpblRunValuePlay[] | null {
  return getCachedWpblPlayLog(season)
}

export function fetchWpblAllPitchPlays(season: WpblPlayScope = null): Promise<WpblPitchPlay[]> {
  return fetchWpblPlayLog(season).then(log => viewOf(log, 'pitches', hasPitches))
}
export function getCachedWpblAllPitchPlays(season: WpblPlayScope = null): WpblPitchPlay[] | null {
  const log = getCachedWpblPlayLog(season)
  return log && viewOf(log, 'pitches', hasPitches)
}

export function fetchWpblBattedBalls(season: WpblPlayScope = null): Promise<WpblSprayPlay[]> {
  return fetchWpblPlayLog(season).then(log => viewOf(log, 'battedBalls', isBattedBall))
}

/** Every plate appearance in the league, for the batter-vs-pitcher board at /wpbl/matchups. */
export function fetchWpblAllMatchupPlays(season: WpblPlayScope = null): Promise<WpblPlayerMatchupPlay[]> {
  return fetchWpblPlayLog(season).then(log => viewOf(log, 'plateAppearances', isPlateAppearance))
}
export function getCachedWpblAllMatchupPlays(season: WpblPlayScope = null): WpblPlayerMatchupPlay[] | null {
  const log = getCachedWpblPlayLog(season)
  return log && viewOf(log, 'plateAppearances', isPlateAppearance)
}

/** A matchup play plus its `sequence`, which the corrections overlay keys on, and `is_hit`, which
 *  the player page's spray chart reads off the same rows. */
export type WpblPlayerMatchupPlay = WpblMatchupPlay & Pick<WpblGamePlay, 'sequence' | 'is_hit'>

const MATCHUP_PLAY_SELECT = 'game_id,sequence,team_id,batter_id,batter_name,pitcher_id,pitcher_name,event_type,narrative,is_hit'

const playerMatchupCache = new Map<string, { data: WpblPlayerMatchupPlay[]; at: number }>()

/** Only uuids go into the database filter. `batter_id` / `pitcher_id` are uuid columns holding
 *  our own player ids, so a feed id can never be on a play, and one in the `in.(...)` list is not
 *  ignored: Postgres rejects the WHOLE query (22P02, invalid input syntax for type uuid), `safe`
 *  turns that into an empty array, and the tables silently draw nothing for every player who has
 *  a feed id, which is all of them. The in-memory filters still take the full id set. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Plays by (game_id, sequence), for the ones a correction brings INTO a filtered read. A
 *  database filter sees the mirror row, which is the feed's; the correction is applied after, so
 *  a play it moves into the filter's reach has to be fetched by its key. Tiny: one request per game
 *  holding such a correction, and the corrections table is usually empty. */
async function fetchMatchupPlaysByKey(keys: Map<string, number[]>): Promise<WpblPlayerMatchupPlay[]> {
  return (await Promise.all([...keys].map(([gameId, seqs]) =>
    safe<WpblPlayerMatchupPlay[]>('fetchMatchupPlaysByKey', () =>
      supabase.from('wpbl_game_plays').select(MATCHUP_PLAY_SELECT)
        .eq('game_id', gameId).in('sequence', seqs) as unknown as
        PromiseLike<{ data: WpblPlayerMatchupPlay[] | null; error: unknown }>, [])))).flat()
}

const involves = (ids: Set<string>) => (p: WpblMatchupPlay) =>
  (p.batter_id != null && ids.has(p.batter_id)) || (p.pitcher_id != null && ids.has(p.pitcher_id))

/** What is already in memory for this player, for a synchronous first paint: her own read if one
 *  has landed, else her slice of the league log if another page loaded it. */
export function getCachedWpblPlayerMatchupPlays(
  player: Pick<WpblPlayer, 'id' | 'api_id' | 'api_ids'>,
): WpblPlayerMatchupPlay[] | null {
  const own = playerMatchupCache.get(player.id)
  if (own) return own.data
  const league = playLogCache.get('all')?.data
  return league ? league.filter(involves(new Set(playerPlayIds(player)))) : null
}

/**
 * Every plate appearance one player took part in, from either side, corrected.
 *
 * EXISTS SO A PLAYER PAGE DOES NOT PAY FOR THE LEAGUE. The matchup tables used to read the whole
 * play log, about 280KB compressed over four requests, and since the season ended nothing else on
 * a cold visit loads it: every reader arriving at a player page from search or Discord paid all
 * of it for one table. Her own plays are a few hundred rows of eight narrow columns. The compare
 * page reads the same thing for its first player, since her plays already hold every duel with
 * the second.
 *
 * THE LEAGUE LOG IS STILL PREFERRED WHEN IT IS FRESH, because then this costs nothing at all.
 *
 * A CORRECTION CAN MOVE AN AT-BAT ONTO HER, and a filter on the mirror's ids cannot see it: the
 * mirror row still names the batter the feed wrote. So every correction that rewrites a batter or
 * pitcher to one of her ids pulls that play in by (game_id, sequence), the overlay runs over the
 * lot, and the result is filtered again, which also drops a play a correction moved OFF her.
 * The corrections table is tiny and the league read already fetches all of it beside the pages.
 */
export function fetchWpblPlayerMatchupPlays(
  player: Pick<WpblPlayer, 'id' | 'api_id' | 'api_ids'>,
): Promise<WpblPlayerMatchupPlay[]> {
  const idList = playerPlayIds(player)
  const ids = new Set(idList)
  const league = playLogCache.get('all')
  if (isFresh(league ?? null)) return Promise.resolve(league!.data.filter(involves(ids)))
  const own = playerMatchupCache.get(player.id)
  if (isFresh(own ?? null)) return Promise.resolve(own!.data)
  const list = idList.filter(id => UUID.test(id)).join(',')
  if (!list) return Promise.resolve([])
  return once(`playerMatchupPlays:${player.id}`, async () => {
    const [mine, corrections] = await Promise.all([
      fetchAllPaged<WpblPlayerMatchupPlay>('fetchWpblPlayerMatchupPlays', (from, to) =>
        supabase.from('wpbl_game_plays')
          .select(MATCHUP_PLAY_SELECT)
          .or(`batter_id.in.(${list}),pitcher_id.in.(${list})`)
          .order('game_id', { ascending: true })
          .order('sequence', { ascending: true })
          .range(from, to) as unknown as
          PromiseLike<{ data: WpblPlayerMatchupPlay[] | null; error: unknown }>),
      fetchAllPlayCorrections(),
    ])
    const have = new Set(mine.map(p => `${p.game_id}:${p.sequence}`))
    const movedOn = new Map<string, number[]>()
    for (const c of corrections) {
      if ((c.field !== 'batter_id' && c.field !== 'pitcher_id') || !c.new_value || !ids.has(c.new_value)) continue
      if (have.has(`${c.game_id}:${c.sequence}`)) continue
      const seqs = movedOn.get(c.game_id)
      if (seqs) seqs.push(c.sequence); else movedOn.set(c.game_id, [c.sequence])
    }
    const extra = await fetchMatchupPlaysByKey(movedOn)
    const corrected = applyPlayCorrections([...mine, ...extra], corrections).filter(involves(ids))
    if (corrected.length > 0 || !playerMatchupCache.has(player.id)) {
      playerMatchupCache.set(player.id, { data: corrected, at: Date.now() })
    }
    return corrected
  })
}

/** Four pages covers the whole 2026 play log (about 3,500 rows) in one round trip. */
const PLAY_LOG_WAVE = 4

// ─── Play corrections ─────────────────────────────────────────────────────────
//
// The league's scoring has errors: batters credited to the wrong player, plate appearances
// missing entirely. They are not reachable to fix it at source, so we keep our own
// corrections and lay them over the mirror on the way out.
//
// This CANNOT be done by editing wpbl_game_plays. That table is a mirror and wpbl-ingest
// deletes and reinserts every play for a game on each pass, so an edit written into it
// survives until the next cron tick and then disappears without trace.
//
export { applyPlayCorrections }

// The overlay itself lives in playCorrections.ts, free of the supabase client, so the scheduled
// jobs that price plays (scripts/compute-wpbl-run-environment.ts) apply exactly this one.

function fetchPlayCorrections(gameId: string): Promise<WpblPlayCorrection[]> {
  return safe('fetchPlayCorrections', () =>
    supabase.from('wpbl_play_corrections').select(CORRECTION_SELECT).eq('game_id', gameId),
    [] as WpblPlayCorrection[])
}

/** Every correction in the league. The table holds one row per corrected field and is expected
 *  to stay in the dozens, so the season-wide reads take the lot rather than paging it. */
function fetchAllPlayCorrections(): Promise<WpblPlayCorrection[]> {
  return safe('fetchAllPlayCorrections', () =>
    supabase.from('wpbl_play_corrections').select(CORRECTION_SELECT),
    [] as WpblPlayCorrection[])
}

// The official-feed play-by-play for one game, in order, with our corrections laid over it.
// Full rows, because the Game Center renders every pitch of every at-bat and so genuinely
// needs `pitch_events`.
export async function fetchWpblGamePlays(gameId: string): Promise<WpblGamePlay[]> {
  const id = overlayGameId(gameId)
  // Both reads go out together: the corrections table is tiny and usually empty, so making it
  // wait on the plays would add a round trip to every game anyone opens.
  const [plays, corrections] = await Promise.all([
    safe('fetchWpblGamePlays', () =>
      supabase.from('wpbl_game_plays').select('*').eq('game_id', id).order('sequence', { ascending: true }),
      [] as WpblGamePlay[]),
    fetchPlayCorrections(id),
  ])
  const corrected = asGame(applyPlayCorrections(plays, corrections), id, gameId)
  return readOverlay ? readOverlay.plays(gameId, corrected) : corrected
}

// The same game's plays, projected to what buildRecap reads (see WpblRecapPlay), so Home's
// Last Game card does not pull ~80 KB of pitch-by-pitch JSON on the landing view to answer
// whether anyone hit back-to-back home runs. Game Center still takes the full rows when a
// reader actually opens a game.
export async function fetchWpblGameRecapPlays(gameId: string): Promise<WpblRecapPlay[]> {
  const [plays, corrections] = await Promise.all([
    safe<WpblRecapPlay[]>('fetchWpblGameRecapPlays', () =>
      supabase.from('wpbl_game_plays')
        .select('game_id,sequence,inning,team_id,event_type,narrative')
        .eq('game_id', gameId)
        .order('sequence', { ascending: true }) as unknown as
        PromiseLike<{ data: WpblRecapPlay[] | null; error: unknown }>,
      []),
    fetchPlayCorrections(gameId),
  ])
  return applyPlayCorrections(plays, corrections)
}
