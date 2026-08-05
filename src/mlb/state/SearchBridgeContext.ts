import { useSyncExternalStore } from 'react'
import type { RecentSearchItem } from '../storage/recentSearches'
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

export interface ToolbarSuggestion {
  id: number
  fullName: string
  position: string
  teamId: number
  teamAbbr: string
  isTeamPlayer: boolean
}

// A self-describing toolbar search result. Produced by whichever section owns search
// so the always-loaded toolbar can render it WITHOUT statically importing that section's
// lazy chunk — the avatar is described by primitive data (image URL + colors), never a
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
}

export interface SearchBridgeState {
  query: string
  playerResults: PlayerBridgeItem[]
  teamResults: TeamBridgeItem[]
  searching: boolean
  handleSelectPlayer: ((p: PlayerBridgeItem) => void) | null
  handleSelectTeam: ((t: TeamBridgeItem) => void) | null
  isRegistered: boolean
  // Which section currently owns the toolbar search — decides how the results dropdown
  // renders ('mlb' = the player/team fields above; 'wpbl' = the generic `resultRows`).
  source: 'mlb' | 'wpbl' | null
  resultRows: SearchResultRow[]
  toolbarSuggestions: ToolbarSuggestion[]
  recentSearches: RecentSearchItem[]
  handleSelectRecent: ((item: RecentSearchItem) => void) | null
  clearRecentSearches: (() => void) | null
}

const DEFAULT: SearchBridgeState = {
  query: '',
  playerResults: [],
  teamResults: [],
  searching: false,
  handleSelectPlayer: null,
  handleSelectTeam: null,
  isRegistered: false,
  source: null,
  resultRows: [],
  toolbarSuggestions: [],
  recentSearches: [],
  handleSelectRecent: null,
  clearRecentSearches: null,
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
  _state = { ..._state, ...partial }
  _notify()
}

export function setSearchQuery(q: string): void {
  _state = { ..._state, query: q }
  _notify()
}

export function useSearchBridge(): SearchBridgeState {
  return useSyncExternalStore(_subscribe, _snapshot)
}
