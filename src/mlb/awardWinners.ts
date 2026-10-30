import { cachedJson, FRESH_LONG_MS } from './lib/readCache'
import { addDaysISO } from '../../shared/mlbSeason.js'

// ─── The league's awards, as the feed publishes them ──────────────────────────
//
// ONE READ PER AWARD: the feed has no endpoint for a season's winners, only `/awards/{code}/recipients`,
// and an award not yet given answers 404. They land over about two weeks in November (in 2025 the
// Gold Gloves on Nov 2, the Silver Sluggers on Nov 6 and 7, Rookie, Manager, Cy Young and MVP on Nov 10
// to 13), and nothing here hardcodes those dates, so each award appears when the league publishes it.
//
// THIRTEEN READS WOULD BE MOST OF A WINTER HOME'S REQUESTS, so a settled award is remembered on the
// device and never read again, and all winter the card costs nothing. It also lets the card draw on the
// first paint. "Settled" is a few days old rather than merely present, because a Gold Glove class
// lists ten winners and the feed is not obliged to publish them in one write.

export type AwardKind = 'series' | 'major' | 'position'

export interface AwardDef { code: string; label: string; kind: AwardKind; group: string }

/** Card order within a day: the biggest award first, AL above NL. */
export const AWARDS: AwardDef[] = [
  { code: 'ALMVP', label: 'AL MVP',                 kind: 'major',    group: 'MVP' },
  { code: 'NLMVP', label: 'NL MVP',                 kind: 'major',    group: 'MVP' },
  { code: 'ALCY',  label: 'AL Cy Young',            kind: 'major',    group: 'Cy Young' },
  { code: 'NLCY',  label: 'NL Cy Young',            kind: 'major',    group: 'Cy Young' },
  { code: 'ALROY', label: 'AL Rookie of the Year',  kind: 'major',    group: 'Rookie of the Year' },
  { code: 'NLROY', label: 'NL Rookie of the Year',  kind: 'major',    group: 'Rookie of the Year' },
  { code: 'ALMOY', label: 'AL Manager of the Year', kind: 'major',    group: 'Manager of the Year' },
  { code: 'NLMOY', label: 'NL Manager of the Year', kind: 'major',    group: 'Manager of the Year' },
  { code: 'WSMVP', label: 'World Series MVP',       kind: 'series',   group: 'World Series MVP' },
  { code: 'ALGG',  label: 'AL Gold Glove',          kind: 'position', group: 'Gold Glove' },
  { code: 'NLGG',  label: 'NL Gold Glove',          kind: 'position', group: 'Gold Glove' },
  { code: 'ALSS',  label: 'AL Silver Slugger',      kind: 'position', group: 'Silver Slugger' },
  { code: 'NLSS',  label: 'NL Silver Slugger',      kind: 'position', group: 'Silver Slugger' },
]

export interface AwardWinner {
  code: string
  label: string
  kind: AwardKind
  group: string
  /** Null for a manager: a person with no player page worth linking. */
  playerId: number | null
  name: string
  position: string | null
  teamId: number | null
  /** YYYY-MM-DD, or '' if the feed gave none. */
  date: string
}

/** Pure, for the test. The recipients of one award, in the feed's order. A manager reads position "X". */
export function parseAwardWinners(def: AwardDef, raw: any): AwardWinner[] {
  const out: AwardWinner[] = []
  for (const a of raw?.awards ?? []) {
    const p = a?.player
    if (!p?.id || !p.nameFirstLast) continue
    const position: string | null = p.primaryPosition?.abbreviation ?? null
    const manager = position === 'X'
    out.push({
      code: def.code, label: def.label, kind: def.kind, group: def.group,
      playerId: manager ? null : Number(p.id),
      name: String(p.nameFirstLast),
      position: manager ? null : position,
      teamId: a.team?.id ? Number(a.team.id) : null,
      date: typeof a.date === 'string' ? a.date.slice(0, 10) : '',
    })
  }
  return out
}

/** Three days past its date, or with no date to go on: not settled, so it is read again. */
export function isSettled(winners: AwardWinner[], today: string): boolean {
  const date = winners[0]?.date
  return !!date && addDaysISO(date, 3) <= today
}

const SEED_KEY = (season: number) => `mlb_awards_seed_${season}`
type Seed = Record<string, AwardWinner[]>

function readSeed(season: number): Seed {
  try { return JSON.parse(localStorage.getItem(SEED_KEY(season)) ?? '{}') as Seed } catch { return {} }
}

const flatten = (byCode: Seed): AwardWinner[] => AWARDS.flatMap(def => byCode[def.code] ?? [])

/** What this device last read, for the first paint. */
export const seededAwards = (season: number): AwardWinner[] => flatten(readSeed(season))

/** Every award given so far: settled ones from the device, the rest from the feed. */
export async function fetchAwards(season: number, today: string): Promise<AwardWinner[]> {
  const byCode = readSeed(season)
  await Promise.all(AWARDS.filter(def => !isSettled(byCode[def.code] ?? [], today)).map(async def => {
    const winners = await cachedJson<any>(`https://statsapi.mlb.com/api/v1/awards/${def.code}/recipients?season=${season}&sportId=1`, FRESH_LONG_MS)
      .then(raw => parseAwardWinners(def, raw))
      // A 404 is an award not given yet, and is what every unannounced award answers.
      .catch(() => null)
    if (winners?.length) byCode[def.code] = winners
  }))
  try { localStorage.setItem(SEED_KEY(season), JSON.stringify(byCode)) } catch { /* storage off or full */ }
  return flatten(byCode)
}

/**
 * The card's rows: every single-winner award, newest first, then a followed club's Gold Gloves and
 * Silver Sluggers. The full classes are twenty names each, so the card counts them (`positionCounts`)
 * and the sheet lists them. The World Series MVP waits for the champion card to step aside.
 */
export function awardCardRows(all: AwardWinner[], followedTeamId: number | null | undefined, withSeriesMvp: boolean): AwardWinner[] {
  const order = (w: AwardWinner) => AWARDS.findIndex(d => d.code === w.code)
  const single = all
    .filter(w => w.kind === 'major' || (w.kind === 'series' && withSeriesMvp))
    // The World Series MVP is days older than the rest, so date alone puts it last once they land.
    .sort((a, b) => b.date.localeCompare(a.date) || order(a) - order(b))
  const mine = followedTeamId == null ? [] : all.filter(w => w.kind === 'position' && w.teamId === followedTeamId)
  return [...single, ...mine]
}

/** Gold Glove and Silver Slugger, with how many winners each has so far. Absent until one is given. */
export function positionCounts(all: AwardWinner[]): { group: string; count: number }[] {
  const out: { group: string; count: number }[] = []
  for (const w of all) {
    if (w.kind !== 'position') continue
    const row = out.find(r => r.group === w.group)
    if (row) row.count++
    else out.push({ group: w.group, count: 1 })
  }
  return out
}

const POSITION_ORDER = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH', 'UT']

/** The sheet's sections, in AWARDS' order, with each class sorted around the diamond. */
export function awardSections(all: AwardWinner[]): { label: string; winners: AwardWinner[] }[] {
  const rank = (p: string | null) => {
    const i = POSITION_ORDER.indexOf(p ?? '')
    return i < 0 ? POSITION_ORDER.length : i
  }
  return AWARDS
    .map(def => ({
      label: def.label,
      winners: all.filter(w => w.code === def.code).sort((a, b) => rank(a.position) - rank(b.position)),
    }))
    .filter(s => s.winners.length > 0)
}
