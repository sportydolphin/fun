// The rows for searchMore.ts's three questions: the reads, and the words each row says. Split from
// the parsers so those stay pure and a test needs no database. Loaded on the first ask.

import { fetchWpblAllLines, fetchWpblVideoTags, fetchWpblVideos } from './api'
import { fetchWpblPlayLog } from './api/plays'
import { plateAppearanceLines, type PlateAppearanceLine } from '../league/inningLines'
import { WPBL_LEAGUE } from './league'
import { WPBL_FINDER_CLUBS } from './finderLink'
import { currentSeason, inSeason, seasonGames } from './season'
import { regularSeasonLines } from '../league/season'
import { foldName } from '../lib/fuzzyName'
import { videoKindName } from './videoChannels'
import { wpblGamePath, wpblPlayerPath, wpblTeamPath, wpblWatchVideoPath } from './routes'
import {
  clipsByPlay, clubRuns, gameMeasureLabel, gameRecord, matchClips, parseGameRecord, parseStreakAsk, parseVideoAsk,
  playerRuns, type ClubRun,
} from './searchMore'
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
  return out
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
