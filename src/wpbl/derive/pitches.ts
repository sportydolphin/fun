import {
  aggregatePitchCodes as aggregate, pitchQualifiers as qualifiers, readSequence as read,
  type PitchBoard as Board, type PitchProfile as Profile, type PitchQualifiers,
} from '../../league/pitches'
import type { PitchPlay } from '../../league/types'
import type { SeasonGame, SeasonScope } from '../../league/season'
import { WPBL_LEAGUE } from '../league'
import type { WpblPlayer } from '../types'

// The pitch-code boards for WPBL. The engine is league-neutral and lives in
// src/league/pitches.ts, where its reasoning is written down; WPBL's six letters and its sample
// bars are in ../league.ts. This file binds the two and keeps the names the boards, the player
// page and the tests already use.

export { PITCH_CODES } from '../league'
export { battedOutKind, fmtPct, rankBy } from '../../league/pitches'
export type { PitchCounts, PitchKind, PitchRates } from '../../league/pitches'
export type PitchProfile = Profile<WpblPlayer>
export type PitchBoard = Board<WpblPlayer>

export const readSequence = (seq: string) => read(seq, WPBL_LEAGUE.pitchCodes)

export const pitchQualifiers = (teamGames: number): PitchQualifiers => qualifiers(WPBL_LEAGUE, teamGames)

export const aggregatePitchCodes = (
  plays: PitchPlay[], players: WpblPlayer[], games: SeasonGame[], scope: SeasonScope = 'regular',
): PitchBoard => aggregate(WPBL_LEAGUE, plays, players, games, scope)
