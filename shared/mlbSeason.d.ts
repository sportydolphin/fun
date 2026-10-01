// Types for shared/mlbSeason.js. Hand-written like the other shared sidecars.

export interface SeasonDates {
  regularSeasonStart: string
  regularSeasonEnd: string
  postSeasonEnd: string
}

export type SeasonPhase = 'preseason' | 'regular' | 'postseason' | 'offseason'
export type JobKind = 'games' | 'regular'

type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<any> }>

export function fetchSeasonDates(season: number, fetchImpl?: FetchLike): Promise<SeasonDates | null>
export function addDaysISO(iso: string, n: number): string
export function phaseOn(dates: SeasonDates, today: string, regularGamesLeft?: boolean): SeasonPhase
export function hasGamesLeft(schedule: any): boolean
export function regularGamesLeft(dates: SeasonDates, fetchImpl?: FetchLike): Promise<boolean>
export const JOB_KINDS: JobKind[]
export function jobDueOn(kind: JobKind, dates: SeasonDates, today: string, makeupLeft?: boolean): boolean
export function mlbJobDue(kind: JobKind, now?: Date, fetchImpl?: FetchLike): Promise<{ due: boolean; reason: string }>
