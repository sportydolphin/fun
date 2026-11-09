// Types for shared/newsWatch.js. Hand-written like the other shared sidecars, so its tests can
// import the plain-ESM module the news-watch cron runs.
export interface NewsItem {
  key: string
  fingerprint: string
  title: string
  url?: string
  loud?: boolean
  note?: string
}

export interface NewsReport {
  source: string
  kind: 'added' | 'changed' | string
  item: { title: string }
}

export const LOUD_SOURCES: Set<string>
export const SOURCE_LABELS: Record<string, string>
export const FAILURES_BEFORE_RED: number

export function diffSource<T extends NewsItem>(
  prev: Map<string, string>,
  items: T[],
  opts: { seeded: boolean },
): { added: T[]; changed: Array<T & { before: string }>; seeding: boolean }

export function isLoud(source: string, item: Partial<NewsItem>): boolean
export function isNextSeasonDate(iso: string | null | undefined, knownSeasonYear: number): boolean
export function decodeEntities(s: unknown): string
export function describe(source: string, kind: string, item: NewsItem): string
export function chunkLines(header: string, lines: string[], cap?: number): string[]
export function pushSummary(loud: NewsReport[]): { title: string; body: string } | null
