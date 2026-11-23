// The rows for searchMore.ts's four questions: the reads, and the words each row says. Split from
// the parsers so those stay pure and a test needs no database. Loaded on the first ask.

import { fetchWpblAllLines, fetchWpblVideoTags, fetchWpblVideos } from './api'
import { fetchWpblPlayLog } from './api/plays'
import { plateAppearanceLines, type PlateAppearanceLine } from '../league/inningLines'
import { WPBL_LEAGUE } from './league'
import { WPBL_FINDER_CLUBS } from './finderLink'
import { plateAppearances } from './stats'
import { countsInStandings, currentSeason, inSeason, seasonGames, standingsFinals } from './season'
import { regularSeasonLines } from '../league/season'
import { foldName } from '../lib/fuzzyName'
import { videoKindName } from './videoChannels'
import { wpblGamePath, wpblPlayerPath, wpblTeamPath, wpblWatchVideoPath } from './routes'
import {
  clipsByPlay, clubRuns, gameMeasureLabel, gameRecord, matchClips, parseGameRecord, parseStandingsAsk, parseStreakAsk, parseVideoAsk,
  playerRuns, type ClubRun, type StandingsAsk,
} from './searchMore'
import { pythagenpat } from './derive/seriesOdds'
import type { AnswerGroup, PlayAnswer } from '../mlb/state/SearchBridgeContext'
import type { RunValuePlay } from '../league/types'
import type { WpblGame, WpblPlayer, WpblTeam, WpblVideo } from './types'

export interface MoreContext { games: WpblGame[]; players: WpblPlayer[]; teams: WpblTeam[] }

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const noop = () => {}
const games_ = (n: number) => `${n} ${n === 1 ? 'game' : 'games'}`

/** A name as typed, on the roster: the whole name, else the surname, at most three who share it. */
export function rosterMatches(who: string, players: readonly WpblPlayer[]): WpblPlayer[] {
  const w = foldName(who)
  const whole = players.filter(p => foldName(p.name) === w)
  return (whole.length ? whole : players.filter(p => foldName(p.name).split(' ').pop() === w)).slice(0, 3)
}

/** "BOS 5, LA 4": the winner first, as a score line reads. */
function scoreLine(g: WpblGame, teams: readonly WpblTeam[]): string {
  const abbr = (id: string) => teams.find(t => t.id === id)?.abbr ?? id
  const home = [abbr(g.home_team_id), g.home_score ?? 0] as const
  const away = [abbr(g.away_team_id), g.away_score ?? 0] as const
  const [a, b] = (g.home_score ?? 0) >= (g.away_score ?? 0) ? [home, away] : [away, home]
  return `${a[0]} ${a[1]}, ${b[0]} ${b[1]}`
}

/** Every answer group for `text`, or none. Each question is read first, so text that is none of
 *  them costs no read at all. */
export async function wpblMoreAnswers(text: string, ctx: MoreContext): Promise<AnswerGroup[]> {
  const out: AnswerGroup[] = []
  const video = parseVideoAsk(text, WPBL_FINDER_CLUBS)
  if (video) {
    const rows = await videoRows(video, ctx)
    if (rows.length) out.push({ label: 'Video', icon: 'video', rows })
  }
  const record = parseGameRecord(text, WPBL_FINDER_CLUBS)
  if (record) {
    const rows = gameRows(record, ctx)
    if (rows.length) out.push({ label: 'Game records', icon: 'game', rows })
  }
  const streak = parseStreakAsk(text, WPBL_FINDER_CLUBS)
  if (streak) {
    const rows = streak.kind === 'club' ? clubStreakRows(streak, ctx) : await playerStreakRows(streak, ctx)
    if (rows.length) out.push({ label: 'Streaks', icon: 'streak', rows })
  }
  const twoWay = text.toLowerCase().trim().match(/^(?:the\s+)?(?:two[\s-]?way|2[\s-]way)(?:\s+(?:players?|stars?))?(?:\s+(20\d\d))?$/)
  if (twoWay) {
    const rows = await twoWayRows(twoWay[1] ? Number(twoWay[1]) : null, ctx)
    if (rows.length) out.push({ label: 'Two-way players', icon: 'roster', rows })
  }
  const standings = parseStandingsAsk(text, WPBL_FINDER_CLUBS)
  if (standings) {
    const rows = standingsRows(standings, ctx)
    if (rows.length) out.push({ label: 'Standings', icon: 'standings', rows })
  }
  return out
}

// ─── Two-way players ───────────────────────────────────────────────────────────

/** "Two-way players": everyone who batted and pitched in the season's regular-season games, the most
 *  of both first, off the box-score lines, the same lines the boards sum. Offered nothing until Nov
 *  20, 2026, though two-way players are common in this league. */
async function twoWayRows(asked: number | null, ctx: MoreContext): Promise<PlayAnswer[]> {
  const season = asked ?? currentSeason(ctx.games)
  if (season == null) return []
  const lines = await fetchWpblAllLines()
  const games = ctx.games
  const bat = regularSeasonLines(inSeason(lines.batting, games, season), games)
  const pit = regularSeasonLines(inSeason(lines.pitching, games, season), games)
  const pa = new Map<string, number>()
  for (const l of bat) pa.set(l.player_id, (pa.get(l.player_id) ?? 0) + plateAppearances(l))
  const outs = new Map<string, number>()
  for (const l of pit) outs.set(l.player_id, (outs.get(l.player_id) ?? 0) + (l.outs ?? 0))
  const byId = new Map(ctx.players.map(p => [p.id, p]))
  return [...outs].filter(([id, o]) => o > 0 && (pa.get(id) ?? 0) > 0 && byId.has(id))
    .map(([id, o]) => ({ player: byId.get(id)!, pa: pa.get(id)!, outs: o }))
    .sort((a, b) => Math.min(b.pa, b.outs) - Math.min(a.pa, a.outs) || a.player.name.localeCompare(b.player.name))
    .slice(0, 6)
    .map(({ player, pa: n, outs: o }) => ({
      key: `two-way-${player.id}-${season}`,
      title: player.name,
      detail: `${n} PA · ${Math.floor(o / 3)}${o % 3 ? `.${o % 3}` : ''} IP · ${season}`,
      href: wpblPlayerPath(player, ctx.players),
      open: noop,
    }))
}

// ─── Standings ─────────────────────────────────────────────────────────────────

interface ClubLine { teamId: string; w: number; l: number; homeW: number; homeL: number; roadW: number; roadL: number; rf: number; ra: number; left: number }

/** Each club's season off the same finals the standings count, plus what is still to play. */
function clubLines(games: readonly WpblGame[], teams: readonly WpblTeam[], season: number): ClubLine[] {
  const year = games.filter(g => g.game_date.startsWith(String(season)))
  const finals = standingsFinals(year)
  const done = new Set(finals.map(g => g.id))
  const by = new Map(teams.map(t => [t.id, { teamId: t.id, w: 0, l: 0, homeW: 0, homeL: 0, roadW: 0, roadL: 0, rf: 0, ra: 0, left: 0 }]))
  for (const g of finals) {
    const homeWon = g.home_score! > g.away_score!
    const home = by.get(g.home_team_id), away = by.get(g.away_team_id)
    if (home) { home.rf += g.home_score!; home.ra += g.away_score!; if (homeWon) { home.w++; home.homeW++ } else { home.l++; home.homeL++ } }
    if (away) { away.rf += g.away_score!; away.ra += g.home_score!; if (homeWon) { away.l++; away.roadL++ } else { away.w++; away.roadW++ } }
  }
  for (const g of year) {
    if (done.has(g.id) || g.status === 'final' || !countsInStandings(g) || /cancel|postpon|suspend/i.test(g.status ?? '')) continue
    for (const id of [g.home_team_id, g.away_team_id]) { const c = by.get(id); if (c) c.left++ }
  }
  return [...by.values()].filter(c => c.w + c.l + c.left > 0)
}

const pctText = (w: number, l: number) => (w + l ? (w / (w + l)).toFixed(3).replace(/^0/, '') : '.000')
const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

/** "best record", "road records", "Hunters run differential": a row per club, best first, or the one
 *  club asked about. Best or worst alone is the top of that order, ties listed. */
function standingsRows(ask: StandingsAsk, ctx: MoreContext): PlayAnswer[] {
  const season = ask.season ?? currentSeason(ctx.games)
  if (season == null) return []
  const lines = clubLines(ctx.games, ctx.teams, season)
  if (!lines.some(c => c.w + c.l > 0)) return []
  const team = (id: string) => ctx.teams.find(t => t.id === id)
  const of = ask.season ? ` · ${ask.season}` : ''
  const m = ask.measure
  // What the clubs are ordered by, highest first, and what each row says.
  const value = (c: ClubLine): number => m === 'home' ? (c.homeW + c.homeL ? c.homeW / (c.homeW + c.homeL) : 0)
    : m === 'road' ? (c.roadW + c.roadL ? c.roadW / (c.roadW + c.roadL) : 0)
    : m === 'rundiff' ? c.rf - c.ra
    : m === 'pythag' ? pythagenpat(c.rf, c.ra, c.w + c.l)
    : m === 'remaining' ? c.left
    : c.w + c.l ? c.w / (c.w + c.l) : 0
  const say = (c: ClubLine): string => {
    const g = c.w + c.l
    if (m === 'home') return `${c.homeW}–${c.homeL} at home · ${pctText(c.homeW, c.homeL)}`
    if (m === 'road') return `${c.roadW}–${c.roadL} on the road · ${pctText(c.roadW, c.roadL)}`
    if (m === 'rundiff') return `${signed(c.rf - c.ra)} · ${c.rf} scored, ${c.ra} allowed`
    if (m === 'pythag') {
      const xw = Math.round(pythagenpat(c.rf, c.ra, g) * g)
      return `${xw}–${g - xw} expected · ${c.w}–${c.l} actual`
    }
    if (m === 'remaining') return c.left ? `${c.left} ${c.left === 1 ? 'game' : 'games'} left` : 'No games left'
    return `${c.w}–${c.l} · ${pctText(c.w, c.l)}`
  }
  const label: Record<typeof m, string> = {
    record: 'record', pct: 'win percentage', home: 'home record', road: 'road record', rundiff: 'run differential',
    pythag: 'Pythagorean record', remaining: 'games left',
  }
  // After the last game every club reads "No games left": one row says it.
  if (m === 'remaining' && !ask.teamId && lines.every(c => !c.left)) {
    return [{ key: `standings-remaining-${season}`, title: 'Games left', detail: `None · ${season} regular season complete`, href: '/wpbl/standings', open: noop }]
  }
  let ranked = [...lines].sort((a, b) => value(b) - value(a) || (team(a.teamId)?.name ?? '').localeCompare(team(b.teamId)?.name ?? ''))
  if (ask.pick === 'worst') ranked.reverse()
  if (ask.teamId) ranked = ranked.filter(c => c.teamId === ask.teamId)
  else if (ask.pick) ranked = ranked.filter(c => value(c) === value(ranked[0])).slice(0, MAX_TIED)
  const standingsHref = '/wpbl/standings'
  return ranked.slice(0, 4).map(c => {
    const t = team(c.teamId)
    const name = t?.name ?? c.teamId
    const title = ask.pick ? `${ask.pick === 'best' ? 'Best' : 'Worst'} ${label[m]}` : `${name} ${label[m]}`
    return {
      key: `standings-${m}-${ask.pick ?? 'all'}-${c.teamId}-${season}`,
      title,
      detail: `${ask.pick ? `${name} · ` : ''}${say(c)}${of}`,
      href: ask.teamId && t ? wpblTeamPath(t, ctx.teams) : standingsHref,
      open: noop,
    }
  })
}

// ─── Video ─────────────────────────────────────────────────────────────────────

const MAX_CLIPS = 5

async function videoRows(ask: NonNullable<ReturnType<typeof parseVideoAsk>>, ctx: MoreContext): Promise<PlayAnswer[]> {
  const ids = ask.who ? rosterMatches(ask.who, ctx.players).map(p => p.id) : null
  if (ids && !ids.length) return []
  const [videos, tags] = await Promise.all([fetchWpblVideos(), fetchWpblVideoTags()])
  // The play a clip is pinned to, read off the log only when a kind is asked that its event alone
  // cannot settle (a grand slam, a walk-off); the log of each season a pinned clip falls in.
  let playAt: Parameters<typeof matchClips>[5] = null
  if (ask.kind && !['hr', 'double', 'triple', 'single', 'hit', 'walk', 'so', 'hbp'].includes(ask.kind)) {
    const years = new Set<number>()
    const gameById = new Map(ctx.games.map(g => [g.id, g]))
    for (const t of tags.values()) { const g = gameById.get(t.game_id ?? ''); if (g && t.play_sequence != null) years.add(Number(g.game_date.slice(0, 4))) }
    const lines = new Map<string, PlateAppearanceLine>()
    const rows = new Map<string, RunValuePlay>()
    for (const y of years) {
      const plays = await fetchWpblPlayLog(y)
      for (const p of plays) rows.set(`${p.game_id}|${p.sequence}`, p)
      for (const l of plateAppearanceLines(WPBL_LEAGUE, plays, seasonGames(ctx.games, y))) lines.set(`${l.game_id}|${l.sequence}`, l)
    }
    playAt = (gameId, sequence) => ({ line: lines.get(`${gameId}|${sequence}`), play: rows.get(`${gameId}|${sequence}`) })
  }
  return matchClips(ask, videos, tags, ctx.games, ids, playAt).slice(0, MAX_CLIPS).map(({ video, game }) => ({
    key: `video-${video.video_id}`,
    title: video.title,
    detail: [videoKindName(video), day(game?.game_date ?? video.published_at)].join(' · '),
    href: wpblWatchVideoPath(video.video_id),
    open: noop,
  }))
}

/** The clip pinned to each play, for the first, last, Nth and record rows to offer under the play. */
export async function wpblPlayClips(): Promise<Map<string, WpblVideo>> {
  const [videos, tags] = await Promise.all([fetchWpblVideos(), fetchWpblVideoTags()])
  return clipsByPlay(videos, tags)
}

/** The clip row under a play row, when the play has one. */
export function clipRow(clip: WpblVideo | undefined, of: string): PlayAnswer | null {
  if (!clip) return null
  return { key: `clip-${of}`, title: clip.title, detail: videoKindName(clip), href: wpblWatchVideoPath(clip.video_id), open: noop }
}

// ─── A game's records ──────────────────────────────────────────────────────────

const MAX_TIED = 3

function gameRows(ask: NonNullable<ReturnType<typeof parseGameRecord>>, ctx: MoreContext): PlayAnswer[] {
  const found = gameRecord(ask, ctx.games)
  if (!found) return []
  const name = (id?: string) => (id ? ctx.teams.find(t => t.id === id)?.name ?? id : '')
  const label = gameMeasureLabel(ask.measure)
  const title = [ask.teamId ? `${name(ask.teamId)} ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label,
    ask.oppId && `vs ${name(ask.oppId)}`, ask.season && `of ${ask.season}`].filter(Boolean).join(' ')
  const tied = found.games.length
  return found.games.slice(0, MAX_TIED).map((g, i) => {
    const what = ask.measure === 'longest' || ask.measure === 'shortest' ? `${found.value} innings`
      : ask.measure === 'highest' || ask.measure === 'lowest' ? `${found.value} runs` : `by ${found.value}`
    return {
      key: `game-${ask.measure}-${g.id}`,
      title,
      detail: [scoreLine(g, ctx.teams), what, day(g.game_date), i === 0 && tied > 1 ? `${tied} tied` : null].filter(Boolean).join(' · '),
      href: wpblGamePath(g, ctx.teams, ctx.games),
      open: noop,
    }
  })
}

// ─── Streaks ───────────────────────────────────────────────────────────────────

const runText = (r: ClubRun) => `${r.type}${r.count} · ${r.count === 1 ? shortDay(r.from.game_date) : `${shortDay(r.from.game_date)} to ${shortDay(r.to.game_date)}`}`

function clubStreakRows(ask: Extract<NonNullable<ReturnType<typeof parseStreakAsk>>, { kind: 'club' }>, ctx: MoreContext): PlayAnswer[] {
  const season = ask.season ?? currentSeason(ctx.games)
  if (season == null) return []
  const { current, all } = clubRuns(ctx.games, season)
  const team = (id: string) => ctx.teams.find(t => t.id === id)
  const href = (id: string) => { const t = team(id); return t ? wpblTeamPath(t, ctx.teams) : '/wpbl/standings' }
  const of = ask.season ? ` of ${ask.season}` : ''
  const longestOf = (type: 'W' | 'L', id?: string) => {
    const runs = all.filter(r => r.type === type && (!id || r.teamId === id))
    const top = Math.max(0, ...runs.map(r => r.count))
    return runs.filter(r => r.count === top && top > 0).slice(0, MAX_TIED)
  }
  const label = (type: 'W' | 'L') => (type === 'W' ? 'winning' : 'losing')
  const rows: PlayAnswer[] = []
  const types: ('W' | 'L')[] = ask.type ? [ask.type] : ['W', 'L']
  if (ask.teamId) {
    const name = team(ask.teamId)?.name ?? ask.teamId
    const now = current.get(ask.teamId)
    if (!ask.longest && now && (!ask.type || now.type === ask.type)) {
      rows.push({ key: `streak-now-${ask.teamId}`, title: `${name} streak${of}`, detail: runText(now), href: href(ask.teamId), open: noop })
    }
    for (const type of types) {
      for (const r of longestOf(type, ask.teamId)) {
        rows.push({ key: `streak-${type}-${r.teamId}-${r.from.id}`, title: `${name} longest ${label(type)} streak${of}`, detail: runText(r), href: href(r.teamId), open: noop })
      }
    }
    return rows
  }
  // The league: every club's streak now, unless the longest was asked.
  if (!ask.longest && !ask.type) {
    // The hottest first: the longest winning streaks, then the shortest losing ones.
    const rank = (r: ClubRun) => (r.type === 'W' ? r.count : -r.count)
    for (const t of ctx.teams.filter(t => current.has(t.id)).sort((a, b) => rank(current.get(b.id)!) - rank(current.get(a.id)!))) {
      rows.push({ key: `streak-now-${t.id}`, title: `${t.name} streak${of}`, detail: runText(current.get(t.id)!), href: href(t.id), open: noop })
    }
    return rows
  }
  for (const type of types) {
    for (const r of longestOf(type)) {
      rows.push({ key: `streak-${type}-${r.teamId}-${r.from.id}`, title: `Longest ${label(type)} streak${of}`, detail: `${team(r.teamId)?.name ?? r.teamId} · ${runText(r)}`, href: href(r.teamId), open: noop })
    }
  }
  return rows
}

async function playerStreakRows(ask: Extract<NonNullable<ReturnType<typeof parseStreakAsk>>, { kind: 'player' }>, ctx: MoreContext): Promise<PlayAnswer[]> {
  const season = ask.season ?? currentSeason(ctx.games)
  if (season == null) return []
  const owners = ask.who ? rosterMatches(ask.who, ctx.players) : null
  if (owners && !owners.length) return []
  const all = await fetchWpblAllLines()
  // Cut to the year against the WHOLE schedule, then to the regular season.
  const lines = regularSeasonLines(inSeason(all.batting, ctx.games, season), ctx.games)
  const gameById = new Map(ctx.games.map(g => [g.id, g]))
  const when = (l: { game_id: string }) => { const g = gameById.get(l.game_id); return `${g?.game_date ?? ''} ${g?.start_time ?? ''} ${l.game_id}` }
  const byPlayer = new Map<string, typeof lines>()
  for (const l of lines) byPlayer.set(l.player_id, [...(byPlayer.get(l.player_id) ?? []), l])
  const types: ('hit' | 'ob')[] = ask.type ? [ask.type] : ['hit', 'ob']
  const noun = (type: 'hit' | 'ob') => (type === 'hit' ? 'hitting streak' : 'on-base streak')
  const span = (r: { count: number; from: string | null; to: string | null }) =>
    r.count === 1 || r.from === r.to ? shortDay(r.from!) : `${shortDay(r.from!)} to ${shortDay(r.to!)}`
  const of = ask.season ? ` of ${ask.season}` : ''
  const rows: PlayAnswer[] = []
  if (owners) {
    for (const p of owners) {
      const mine = byPlayer.get(p.id)
      if (!mine?.length) continue
      const href = wpblPlayerPath(p, ctx.players)
      for (const type of types) {
        const { current, longest, last } = playerRuns(mine, when, type)
        rows.push({
          key: `pstreak-now-${type}-${p.id}`, title: `${p.name} ${noun(type)}${of}`,
          detail: current.count ? `${games_(current.count)} · ${span(current)}` : `None · last game ${last ? shortDay(last) : '—'}`,
          href, open: noop,
        })
        if (longest.count > current.count) {
          rows.push({ key: `pstreak-long-${type}-${p.id}`, title: `${p.name} longest ${noun(type)}${of}`, detail: `${games_(longest.count)} · ${span(longest)}`, href, open: noop })
        }
      }
    }
    return rows
  }
  // "Active hitting streaks": the longest going, as of each player's last game.
  const type = types[0]
  const going = [...byPlayer].map(([id, mine]) => ({ id, run: playerRuns(mine, when, type).current }))
    .filter(x => x.run.count >= 2).sort((a, b) => b.run.count - a.run.count).slice(0, MAX_TIED + 2)
  for (const { id, run } of going) {
    const p = ctx.players.find(x => x.id === id)
    if (!p) continue
    rows.push({ key: `pstreak-now-${type}-${id}`, title: `${p.name} ${noun(type)}${of}`, detail: `${games_(run.count)} · ${span(run)}`, href: wpblPlayerPath(p, ctx.players), open: noop })
  }
  return rows
}
