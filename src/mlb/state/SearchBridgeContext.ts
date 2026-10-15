import { useSyncExternalStore } from 'react'
import type { RecentSearchItem } from '../storage/recentSearches'
import type { GameQuery, RankSide } from '../../league/finderParse'
import type { FinderSide } from '../../league/finder'
import type { PlayerPart } from '../../lib/playerParts'
export type { RecentSearchItem } from '../storage/recentSearches'

export interface PlayerBridgeItem {
  id: number
  fullName: string
  primaryPosition?: { abbreviation?: string; name?: string; code?: string }
  currentTeam?: { id?: number }
  active?: boolean
  mlbDebutDate?: string
  lastPlayedDate?: string
}

export interface TeamBridgeItem {
  id: number
  name: string
  abbreviation: string
  division?: { name?: string }
  league?: { name?: string }
}

/** A row the section works out for the palette from typed text: a pair's compare page, a game. */
export interface CompareRow {
  title: string; subtitle: string; href: string
  /** A game under way right now, which the palette puts above everything else. */
  live?: boolean
}

/** A ranking typed in the box, in the section's own stats-table terms: `sort` is the column key
 *  the row's link sorts on, so the peek ranks exactly what the link opens. */
export interface LeaderAsk { side: RankSide; sort: string; dir: 'asc' | 'desc' | null; season: number | null; career: boolean }

/** Who leads a ranking, as the stats table would put them first. `others` is how many share the
 *  lead on the number as printed. */
export interface LeaderPeek {
  name: string; others: number; value: string
  /** The year the board was read for, so the row can name it rather than say "this season" (which
   *  between seasons is last year). Null for an all-time board. */
  season?: number | null
}

/** A stat typed beside a name ("Whitmore avg"): the column it means on each side the section's
 *  table has one for, the side the word leans to, and the span typed with it, if any. */
export interface PlayerStatAsk { columns: Partial<Record<RankSide, string>>; lean: FinderSide | null; season: number | 'career' | null }

// A self-describing toolbar search result. Produced by whichever section owns search
// so the always-loaded toolbar can render it WITHOUT statically importing that section's
// lazy chunk. The avatar is described by primitive data (image URL + colors), never a
// component or ReactNode. The MLB side keeps its own richer player/team dropdown
// (playerResults/teamResults above); the WPBL section drives this generic `resultRows`
// path instead, since its ids, headshots, and logos are its own (not StatsAPI-shaped).
export interface SearchResultAvatar {
  imageUrl?: string          // portrait/logo; falls back to `fallbackText` when absent
  fallbackText?: string      // initials (player) or abbr (team)
  bg?: string                // backing/fill color (team color)
  ring?: string              // optional 2px border color (team secondary)
  fit?: 'cover' | 'contain'  // cover = headshot fills; contain = logo centered
  circle?: boolean           // circle vs rounded square
}
export interface SearchResultRow {
  key: string
  title: string
  subtitle?: string
  avatar: SearchResultAvatar
  onSelect: () => void
  /** Found only by the forgiving pass (lib/fuzzyName.ts): a slip the exact search missed. Carried
   *  onto the pick, so /admin can say how often that pass is the one that answered. */
  forgiving?: boolean
}

export interface SearchBridgeState {
  query: string
  /** A year typed beside the name ("Ohtani 2023"), so a player picked from the results opens on
   *  that season, or 'career' for "Ohtani career". Null when neither was typed. Neither is in
   *  `query`, which is names only. */
  querySeason: number | 'career' | null
  /** A part of the card typed beside the name ("Ohtani splits"), for the player row to open at.
   *  Not in `query` either. */
  queryPart: PlayerPart | null
  playerResults: PlayerBridgeItem[]
  teamResults: TeamBridgeItem[]
  /** Which of the current results came from the forgiving pass, not the exact one. */
  resultsForgiving: { players: boolean; teams: boolean }
  searching: boolean
  handleSelectPlayer: ((p: PlayerBridgeItem, season?: number | 'career' | null) => void) | null
  handleSelectTeam: ((t: TeamBridgeItem) => void) | null
  isRegistered: boolean
  // Which section currently owns the toolbar search, which decides how the results dropdown
  // renders ('mlb' = the player/team fields above; 'wpbl' = the generic `resultRows`).
  source: 'mlb' | 'wpbl' | null
  resultRows: SearchResultRow[]
  // WPBL-native recents for the empty-query dropdown, as self-describing rows (the MLB
  // `recentSearches` below is numeric-id shaped and renders from the MLB color/logo maps).
  recentRows: SearchResultRow[]
  recentSearches: RecentSearchItem[]
  handleSelectRecent: ((item: RecentSearchItem) => void) | null
  clearRecentSearches: (() => void) | null
  /** Two names typed as "A vs B", resolved against the section's players. Null when either half
   *  names nobody, or before a section has registered. A promise because MLB's is a network call. */
  resolveCompare: ((a: string, b: string, season: number | null) => Promise<CompareRow | null>) | null
  /** "SF vs NY sep 9", "Dodgers last night": the games asked for, from the section's schedule. */
  resolveGames: ((q: GameQuery) => Promise<CompareRow[]>) | null
  /** How many seasons the section has on record, or null when it does not say. WPBL's stats table
   *  ranks one season at a time, so "most hr all time" is that table only while there is one. */
  seasonCount: number | null
  /** The leader of a ranking row, for the row to say who leads and by what. */
  resolveLeader: ((ask: LeaderAsk) => Promise<LeaderPeek | null>) | null
  /** The answer to a stat typed beside a name, for one player row (its `key`): ".312 AVG · 2026".
   *  Null when the player has no such number in the span. */
  resolvePlayerStat: ((rowKey: string, ask: PlayerStatAsk) => Promise<string | null>) | null
}

const DEFAULT: SearchBridgeState = {
  query: '',
  querySeason: null,
  queryPart: null,
  seasonCount: null,
  playerResults: [],
  teamResults: [],
  resultsForgiving: { players: false, teams: false },
  searching: false,
  handleSelectPlayer: null,
  handleSelectTeam: null,
  isRegistered: false,
  source: null,
  resultRows: [],
  recentRows: [],
  recentSearches: [],
  handleSelectRecent: null,
  clearRecentSearches: null,
  resolveCompare: null,
  resolveGames: null,
  resolveLeader: null,
  resolvePlayerStat: null,
}

let _state: SearchBridgeState = { ...DEFAULT }
const _listeners = new Set<() => void>()

const _notify = () => _listeners.forEach(f => f())

function _subscribe(cb: () => void): () => void {
  _listeners.add(cb)
  return () => _listeners.delete(cb)
}

function _snapshot(): SearchBridgeState {
  return _state
}

export function updateSearchBridge(partial: Partial<SearchBridgeState>): void {
  // Nothing new, nobody told. Every subscriber re-renders on a notify, and the app shell is one.
  if ((Object.keys(partial) as (keyof SearchBridgeState)[]).every(k => _state[k] === partial[k])) return
  _state = { ..._state, ...partial }
  _notify()
}

export function setSearchQuery(q: string, season: number | 'career' | null = null, part: PlayerPart | null = null): void {
  if (_state.query === q && _state.querySeason === season && _state.queryPart === part) return
  _state = { ..._state, query: q, querySeason: season, queryPart: part }
  _notify()
}

export function useSearchBridge(): SearchBridgeState {
  return useSyncExternalStore(_subscribe, _snapshot)
}

// The toolbar search has been focused at least once this session. Kept OUT of the bridge state on
// purpose: it changes once, and a field there would re-render every subscriber for a fact only a
// section's lazy data loading cares about. Sticky, so a section that mounts after the first focus
// still learns of it.
let _searchFocused = false
const _focusListeners = new Set<() => void>()

/** Called by the shell when the toolbar search input takes focus. */
export function noteSearchFocus(): void {
  if (_searchFocused) return
  _searchFocused = true
  _focusListeners.forEach(l => l())
  _focusListeners.clear()
}

/** Runs `cb` once, the first time the search is focused (at once if it already has been). Returns
 *  an unsubscribe. For data a section's search rows want but nothing else on the page does, so
 *  only readers who actually search pay for it. */
export function onFirstSearchFocus(cb: () => void): () => void {
  if (_searchFocused) { cb(); return () => {} }
  _focusListeners.add(cb)
  return () => { _focusListeners.delete(cb) }
}

const _querySnapshot = () => _state.query

/** Only the typed query: a component that publishes the rest of the bridge should read just this,
 *  or every one of its own publishes re-renders it. */
export function useSearchBridgeQuery(): string {
  return useSyncExternalStore(_subscribe, _querySnapshot)
}
