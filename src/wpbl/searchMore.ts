// Three more kinds of question the search box answers on WPBL, each with rows of its own:
//
//   VIDEO   "Geldenhuis home run video", "Hunters highlights", "walk-off clips"
//   GAMES   "longest game", "Hunters biggest win", "highest-scoring game vs Queens"
//   STREAKS "Hunters streak", "longest winning streak", "Whitmore hitting streak", "active hitting streaks"
//
// THE WORDS ARE READ HERE, NOT IN THE SHELL. Each answer needs the section's own data (the clips and
// their tags, the schedule, the box-score lines), so the palette hands the text to the section's
// resolver (`resolveMore`) and draws whatever groups come back. Loaded on the first ask, like
// searchAnswers.ts, so none of this is in the section's first chunk.
//
// REGULAR SEASON ONLY, for the games and the streaks: a postseason game is in no season total, and a
// streak that ran from September into a semifinal would read as a regular-season one on a club page
// that never counted it. `standingsFinals` is the one definition, the same the standings use.

import { FIRST_KINDS, firstKind, type FirstKind } from '../league/firsts'
import { standingsFinals } from './season'
import type { WpblBattingLine, WpblGame, WpblVideo, WpblVideoTag } from './types'
import type { PlateAppearanceLine } from '../league/inningLines'
import type { RunValuePlay } from '../league/types'

type Clubs = readonly { id: string; names: string[] }[]

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]s?(?=\s|$)/g, '').replace(/\s+/g, ' ').trim()
const YEAR = /(?<![a-z0-9])(20\d\d)(?![a-z0-9])/
const FILLER = new Set(['the', 'a', 'an', 'of', 'in', 'ever', 'wpbl', 'league', 'history', 'all', 'time', 'every', 'for', 'by', 'season', 'this', 'year'])

/**
 * What is left of the text once a phrase is taken out: a club, an opponent ("vs", "against", "over"),
 * a year, and any words nothing placed, which the caller reads as a name or as no question.
 */
function takeOwners(rest: string, clubs: Clubs): { teamId?: string; oppId?: string; season: number | null; words: string[] } | null {
  let text = ` ${rest} `
  let season: number | null = null
  const y = text.match(YEAR)
  if (y) { season = Number(y[1]); text = text.replace(y[0], ' ') }
  // Longest names first, so "boston hunters" is one club and not a club and a leftover word.
  const names = clubs.flatMap(c => c.names.map(n => ({ id: c.id, n: fold(n) }))).sort((a, b) => b.n.length - a.n.length)
  let teamId: string | undefined
  let oppId: string | undefined
  for (;;) {
    let hit = false
    for (const { id, n } of names) {
      const re = new RegExp(`(?<![a-z])((?:vs\\.?|versus|against|over|facing)\\s+)?(?:the\\s+)?${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?(?![a-z])`)
      const m = text.match(re)
      if (!m) continue
      if (m[1]) { if (oppId) return null; oppId = id } else { if (teamId) return null; teamId = id }
      text = text.replace(m[0], ' ')
      hit = true
      break
    }
    if (!hit) break
  }
  const words = text.split(/\s+/).filter(w => w && !FILLER.has(w))
  return { teamId, oppId, season, words }
}

// ─── Video ─────────────────────────────────────────────────────────────────────

export interface VideoAsk {
  teamId?: string
  oppId?: string
  season: number | null
  /** The play asked for ("home run"), when one was. */
  kind?: FirstKind
  /** Words left over, for the section to find as a player. */
  who?: string
}

const VIDEO_WORD = /(?<![a-z])(?:videos?|clips?|highlights?|replays?|watch)(?![a-z])/g

/**
 * "Geldenhuis home run video", "Hunters highlights", "walk-off clips", "video of the first Hunters
 * double" is not one (a first has its own row, with its clip under it). Null without a video word, and
 * for one alone ("videos"), which the Watch page's own row answers.
 */
export function parseVideoAsk(text: string, clubs: Clubs): VideoAsk | null {
  const t = fold(text.replace(/\?\s*$/, ''))
  if (!VIDEO_WORD.test(t)) return null
  VIDEO_WORD.lastIndex = 0
  if (/(?<![a-z0-9])(?:first|last|latest|\d+(?:st|nd|rd|th))(?![a-z])/.test(t)) return null
  const owners = takeOwners(t.replace(VIDEO_WORD, ' '), clubs)
  if (!owners) return null
  let words = owners.words
  // The play, as the firsts read it: the longest run of words that names one.
  let kind: FirstKind | undefined
  for (let len = Math.min(4, words.length); len > 0 && !kind; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const def = FIRST_KINDS.find(k => k.words.test(words.slice(i, i + len).join(' ')))
      if (def) { kind = def.kind; words = [...words.slice(0, i), ...words.slice(i + len)]; break }
    }
  }
  const who = words.join(' ')
  if (!who && !kind && !owners.teamId && !owners.oppId && !owners.season) return null
  return { teamId: owners.teamId, oppId: owners.oppId, season: owners.season, ...(kind ? { kind } : {}), ...(who ? { who } : {}) }
}

/** One clip and what it shows, for a row. */
export interface ClipMatch { video: WpblVideo; tag: WpblVideoTag | null; game: WpblGame | null }

/**
 * The clips that answer `ask`, newest first. `playerIds` is who the words named (several when a
 * surname is shared), or null when none were asked. `playAt` reads the play a tag is pinned to, for a
 * kind no tag's event names alone (a grand slam is a home run with three on); null when the log is
 * not in hand, when only the tag's own event can say.
 */
export function matchClips(
  ask: VideoAsk, videos: readonly WpblVideo[], tags: ReadonlyMap<string, WpblVideoTag>, games: readonly WpblGame[],
  playerIds: readonly string[] | null,
  playAt: ((gameId: string, sequence: number) => { line?: PlateAppearanceLine; play?: RunValuePlay } | null) | null,
): ClipMatch[] {
  const gameById = new Map(games.map(g => [g.id, g]))
  const def = ask.kind ? firstKind(ask.kind) : null
  const out: ClipMatch[] = []
  for (const video of videos) {
    const tag = tags.get(video.video_id) ?? null
    const game = gameById.get(tag?.game_id ?? video.game_id ?? '') ?? null
    if (ask.season && (!game || !game.game_date.startsWith(String(ask.season)))) continue
    const clubs = game ? [game.home_team_id, game.away_team_id] : tag?.team_id ? [tag.team_id] : []
    // A club's clip is one of its plays, or one of its games where no play is pinned.
    if (ask.teamId && !(tag?.team_id === ask.teamId || (!tag?.play_sequence && clubs.includes(ask.teamId)))) continue
    if (ask.oppId && !clubs.includes(ask.oppId)) continue
    if (playerIds && !(tag?.player_ids ?? []).some(id => playerIds.includes(id))) continue
    if (def) {
      if (!tag || tag.play_sequence == null || !tag.game_id) continue
      const at = playAt?.(tag.game_id, tag.play_sequence) ?? null
      const ok = def.source === 'pa'
        ? (at?.line ? def.test(at.line) : EVENT_OF[def.kind]?.includes(tag.event_type ?? '') ?? false)
        : (at?.play ? def.test(at.play) : EVENT_OF[def.kind]?.includes(tag.event_type ?? '') ?? false)
      if (!ok) continue
    }
    out.push({ video, tag, game })
  }
  return out.sort((a, b) => (a.video.published_at < b.video.published_at ? 1 : -1))
}

// The play's own event on a tag, for a kind it alone can settle when the log is not in hand.
const EVENT_OF: Partial<Record<FirstKind, string[]>> = {
  hr: ['home_run'], double: ['double'], triple: ['triple'], single: ['single'], hit: ['single', 'double', 'triple', 'home_run'],
  walk: ['walk'], so: ['strikeout'], hbp: ['hit_by_pitch'], sb: ['stolen_base'], cs: ['caught_stealing'], wp: ['wild_pitch'], pb: ['passed_ball'],
}

/** Each clip pinned to one play, by `${game_id}|${sequence}`: the clip a play row offers under it. */
export function clipsByPlay(videos: readonly WpblVideo[], tags: ReadonlyMap<string, WpblVideoTag>): Map<string, WpblVideo> {
  const byId = new Map(videos.map(v => [v.video_id, v]))
  const out = new Map<string, WpblVideo>()
  for (const tag of tags.values()) {
    if (!tag.game_id || tag.play_sequence == null) continue
    const v = byId.get(tag.video_id)
    if (v && !out.has(`${tag.game_id}|${tag.play_sequence}`)) out.set(`${tag.game_id}|${tag.play_sequence}`, v)
  }
  return out
}

// ─── A game's records ──────────────────────────────────────────────────────────

export type GameMeasure = 'longest' | 'shortest' | 'highest' | 'lowest' | 'win' | 'loss'

export interface GameRecordAsk { measure: GameMeasure; teamId?: string; oppId?: string; season: number | null }

const GAME_MEASURES: { measure: GameMeasure; re: RegExp; label: string }[] = [
  { measure: 'longest', label: 'Longest game', re: /(?<![a-z])(?:longest\s+games?|most\s+innings\s+in\s+a\s+game)(?![a-z])/ },
  { measure: 'shortest', label: 'Shortest game', re: /(?<![a-z])(?:shortest\s+games?|fewest\s+innings\s+in\s+a\s+game)(?![a-z])/ },
  { measure: 'highest', label: 'Highest-scoring game', re: /(?<![a-z])(?:(?:highest|most)[\s-]+scoring\s+games?|most\s+(?:combined|total)\s+runs(?:\s+in\s+a\s+game)?|slugfests?)(?![a-z])/ },
  { measure: 'lowest', label: 'Lowest-scoring game', re: /(?<![a-z])(?:(?:lowest|least)[\s-]+scoring\s+games?|fewest\s+(?:combined|total)\s+runs(?:\s+in\s+a\s+game)?|pitchers?\s+duels?)(?![a-z])/ },
  { measure: 'win', label: 'Biggest win', re: /(?<![a-z])(?:(?:biggest|largest|widest)\s+(?:wins?|blowouts?|victor(?:y|ies)|margins?(?:\s+of\s+victory)?|routs?)|most\s+lopsided\s+games?)(?![a-z])/ },
  { measure: 'loss', label: 'Biggest loss', re: /(?<![a-z])(?:(?:biggest|worst|largest)\s+(?:loss(?:es)?|defeats?))(?![a-z])/ },
]

/** "longest game", "Hunters biggest win", "highest-scoring game vs Queens 2026". Null for anything else,
 *  and for any word left that is neither a club, a year nor filler. */
export function parseGameRecord(text: string, clubs: Clubs): GameRecordAsk | null {
  const t = fold(text.replace(/\?\s*$/, ''))
  const hit = GAME_MEASURES.find(m => m.re.test(t))
  if (!hit) return null
  const owners = takeOwners(t.replace(hit.re, ' '), clubs)
  if (!owners || owners.words.some(w => w !== 'game' && w !== 'games')) return null
  // A club's biggest loss is the one it lost; the league's biggest loss is its biggest win.
  const measure = hit.measure === 'loss' && !owners.teamId ? 'win' : hit.measure
  return { measure, teamId: owners.teamId, oppId: owners.oppId, season: owners.season }
}

export const gameMeasureLabel = (m: GameMeasure) => GAME_MEASURES.find(x => x.measure === m)!.label

const inningsOf = (g: WpblGame) => g.innings ?? (g.home_line?.length || g.away_line?.length || null)

/** The games that hold the record, every one tied, in the order they were played. */
export function gameRecord(ask: GameRecordAsk, games: readonly WpblGame[]): { games: WpblGame[]; value: number } | null {
  let pool = standingsFinals([...games])
  if (ask.season) pool = pool.filter(g => g.game_date.startsWith(String(ask.season)))
  const has = (g: WpblGame, id?: string) => !id || g.home_team_id === id || g.away_team_id === id
  pool = pool.filter(g => has(g, ask.teamId) && has(g, ask.oppId))
  const won = (g: WpblGame, id: string) => (g.home_team_id === id ? g.home_score! > g.away_score! : g.away_score! > g.home_score!)
  if (ask.measure === 'win' && ask.teamId) pool = pool.filter(g => won(g, ask.teamId!))
  if (ask.measure === 'loss') pool = pool.filter(g => !won(g, ask.teamId!))
  const value = (g: WpblGame): number | null => {
    switch (ask.measure) {
      case 'longest': return inningsOf(g)
      case 'shortest': { const n = inningsOf(g); return n == null ? null : -n }
      case 'highest': return g.home_score! + g.away_score!
      case 'lowest': return -(g.home_score! + g.away_score!)
      default: return Math.abs(g.home_score! - g.away_score!)
    }
  }
  let best: number | null = null
  for (const g of pool) { const v = value(g); if (v != null && (best == null || v > best)) best = v }
  if (best == null) return null
  return { games: pool.filter(g => value(g) === best), value: Math.abs(best) }
}

// ─── Streaks ───────────────────────────────────────────────────────────────────

export type StreakAsk =
  | { kind: 'club'; teamId?: string; type: 'W' | 'L' | null; longest: boolean; season: number | null }
  | { kind: 'player'; who?: string; type: 'hit' | 'ob' | null; season: number | null }

const CLUB_STREAK = /(?<![a-z])(longest\s+|current\s+|active\s+)?(?:(winning|win|losing|loss|losing)\s+)?streaks?(?![a-z])/
const PLAYER_STREAK = /(?<![a-z])(longest\s+|current\s+|active\s+)?(hitting|hit|on[\s-]?base|ob)\s+streaks?(?![a-z])/

/**
 * "Hunters streak", "longest winning streak", "Queens losing streak", "streaks"; "Whitmore hitting
 * streak", "Sato on-base streak", "active hitting streaks". A player's longest across the league
 * ("longest hitting streak") is Find's, which lists them all, so it is not one here.
 */
export function parseStreakAsk(text: string, clubs: Clubs): StreakAsk | null {
  const t = fold(text.replace(/\?\s*$/, ''))
  const p = t.match(PLAYER_STREAK)
  if (p) {
    const owners = takeOwners(t.replace(p[0], ' '), clubs)
    if (!owners || owners.teamId || owners.oppId) return null
    const who = owners.words.join(' ')
    const type = /^h/.test(p[2]) ? 'hit' : 'ob'
    if (!who) return p[1] && !/longest/.test(p[1]) ? { kind: 'player', type, season: owners.season } : null
    return { kind: 'player', who, type, season: owners.season }
  }
  const c = t.match(CLUB_STREAK)
  if (!c) return null
  const owners = takeOwners(t.replace(c[0], ' '), clubs)
  if (!owners || owners.oppId) return null
  const type = c[2] ? (/^w/.test(c[2]) ? 'W' : 'L') : null
  const longest = /longest/.test(c[1] ?? '')
  // Any other word is a name: "Whitmore streak" is a player's, both kinds.
  if (owners.words.length) return owners.teamId ? null : { kind: 'player', who: owners.words.join(' '), type: null, season: owners.season }
  return { kind: 'club', ...(owners.teamId ? { teamId: owners.teamId } : {}), type, longest, season: owners.season }
}

export interface ClubRun { teamId: string; type: 'W' | 'L'; count: number; from: WpblGame; to: WpblGame }

/** Each club's runs of wins and losses over the regular season's finals, in the order played. */
export function clubRuns(games: readonly WpblGame[], season: number): { current: Map<string, ClubRun>; all: ClubRun[] } {
  const finals = standingsFinals(games.filter(g => g.game_date.startsWith(String(season))))
  const open = new Map<string, ClubRun>()
  const all: ClubRun[] = []
  for (const g of finals) {
    const homeWon = g.home_score! > g.away_score!
    for (const [id, w] of [[g.home_team_id, homeWon], [g.away_team_id, !homeWon]] as const) {
      const type = w ? 'W' : 'L'
      const run = open.get(id)
      if (run && run.type === type) { run.count++; run.to = g } else {
        const next: ClubRun = { teamId: id, type, count: 1, from: g, to: g }
        open.set(id, next)
        all.push(next)
      }
    }
  }
  return { current: open, all }
}

export interface PlayerRun { count: number; from: string | null; to: string | null }

/**
 * A player's hitting or on-base streaks over their lines, by the record books' rule, which Find's
 * streaks keep too (`markStreaks` in league/finder.ts): a game with no at-bat neither extends a hitting
 * streak nor ends it, and one with no plate appearance does neither to an on-base streak. `when` dates
 * a line's game; lines must be one season's, regular season, already cut.
 */
export function playerRuns(lines: readonly WpblBattingLine[], when: (l: WpblBattingLine) => string, type: 'hit' | 'ob'):
  { current: PlayerRun; longest: PlayerRun; last: string | null } {
  const counts = (l: WpblBattingLine) => (type === 'hit' ? l.ab > 0 || l.h > 0 : l.ab + l.bb + l.hbp + l.sf + l.sh > 0)
  const did = (l: WpblBattingLine) => (type === 'hit' ? l.h > 0 : l.h + l.bb + l.hbp > 0)
  let run: PlayerRun = { count: 0, from: null, to: null }
  let longest: PlayerRun = { ...run }
  let last: string | null = null
  for (const l of [...lines].sort((a, b) => (when(a) < when(b) ? -1 : 1))) {
    if (!counts(l)) continue
    const d = when(l).slice(0, 10)
    last = d
    if (did(l)) {
      run = { count: run.count + 1, from: run.from ?? d, to: d }
      if (run.count > longest.count) longest = { ...run }
    } else run = { count: 0, from: null, to: null }
  }
  return { current: run, longest, last }
}
