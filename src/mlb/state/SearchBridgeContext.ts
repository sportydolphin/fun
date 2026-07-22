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

export interface SearchBridgeState {
  query: string
  playerResults: PlayerBridgeItem[]
  teamResults: TeamBridgeItem[]
  searching: boolean
  handleSelectPlayer: ((p: PlayerBridgeItem) => void) | null
  handleSelectTeam: ((t: TeamBridgeItem) => void) | null
  isRegistered: boolean
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
