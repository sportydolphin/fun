import type { BestBoard, BestRow } from '../../league/bests'
import type { WpblGame, WpblPlayer } from '../types'

// The single-game boards for WPBL. The engine is league-neutral and lives in
// src/league/bests.ts, where its reasoning is written down. It is generic over the player and
// game types, so handed WPBL's rows it hands WPBL's rows back; this file only keeps the names
// the Stats tab and its tests already use.

export type WpblBestRow = BestRow<WpblPlayer, WpblGame>
export type WpblBestBoard = BestBoard<WpblPlayer, WpblGame>
export { BEST_ROWS, bestGames as wpblBestGames } from '../../league/bests'
