import type { WpblPlayer } from '../types'
import type { AwardResults } from '../awardVotes'
import { WPBL_MANAGERS, type WpblManager } from '../awards'
import { birthDateSettled, statedAge } from './discordBirthdays'

// The offseason Home's player cards: one player a day, the players whose star sign's season it is
// with their birthdays, and the fan award winners. All three are pure selection over what the page
// already holds or one small read, never the box-score lines (homeLandingReadsLines). A player page
// is what readers open most, and the offseason Home had no link to one.
//
// EVERY PICK IS KEYED ON THE READER'S DATE, NEVER ON A RANDOM DRAW. Everyone sees the same player
// all day, so a link shared at lunch still shows the card it was shared about, and a reader who
// comes back in the evening is not dealt someone new as if the page had changed.

/** 'YYYY-MM-DD' for the reader's own calendar day. Local, not UTC: a reader in California at
 *  6 PM is still on today, and UTC would already have moved them to tomorrow's player. */
export function localIsoDate(now = Date.now()): string {
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Whole days since 1970 for an ISO date, as a stable counter to walk the rotation with. */
function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

/** FNV-1a. Only needs to scatter ids evenly and stay the same in every browser. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * The pool in a fixed shuffled order, walked one step a day. A shuffle rather than `hash(date)`
 * per day so nobody repeats until everyone has had a turn: a day-hash picks with replacement and
 * would give one player three days in a month while another waits a season.
 */
function rotation<T>(items: T[], key: (t: T) => string): T[] {
  return [...items].sort((a, b) => hash(`wpbl-home:${key(a)}`) - hash(`wpbl-home:${key(b)}`) || key(a).localeCompare(key(b)))
}

function monthDay(iso: string): string {
  return iso.slice(5, 10)
}

export interface PlayerOfTheDay {
  player: WpblPlayer
  /** Why this player: a settled birthday today outranks the rotation. */
  reason: 'birthday' | 'rotation'
}

/**
 * Today's player. The pool is everyone with a box-score line (a feed id is the marker: the 49
 * players without one have none), since the card's season line is half of what it shows. A
 * settled birthday today wins over the rotation, but only from that same pool: until Oct 21, 2026
 * it reached the whole roster, and the site's front page led with a player whose card read "No
 * 2026 games" and a dash for a number. A birthday off the pool still gets its "Today" in the star
 * sign card.
 */
export function playerOfTheDay(players: WpblPlayer[], today: string): PlayerOfTheDay | null {
  const pool = players.filter(p => p.active && p.api_ids.length > 0)
  const birthdays = pool.filter(p => birthDateSettled(p) && monthDay(p.birth_date!) === monthDay(today))
  const day = dayNumber(today)
  if (birthdays.length) {
    const order = rotation(birthdays, p => p.id)
    return { player: order[day % order.length], reason: 'birthday' }
  }
  if (!pool.length) return null
  const order = rotation(pool, p => p.id)
  return { player: order[day % order.length], reason: 'rotation' }
}

export interface StarSign { name: string; glyph: string; from: string; to: string }

// Tropical sun-sign dates, the ones every horoscope column prints. `from` is 'MM-DD'.
const SIGNS: StarSign[] = [
  { name: 'Capricorn', glyph: '♑', from: '12-22', to: '01-19' },
  { name: 'Aquarius', glyph: '♒', from: '01-20', to: '02-18' },
  { name: 'Pisces', glyph: '♓', from: '02-19', to: '03-20' },
  { name: 'Aries', glyph: '♈', from: '03-21', to: '04-19' },
  { name: 'Taurus', glyph: '♉', from: '04-20', to: '05-20' },
  { name: 'Gemini', glyph: '♊', from: '05-21', to: '06-20' },
  { name: 'Cancer', glyph: '♋', from: '06-21', to: '07-22' },
  { name: 'Leo', glyph: '♌', from: '07-23', to: '08-22' },
  { name: 'Virgo', glyph: '♍', from: '08-23', to: '09-22' },
  { name: 'Libra', glyph: '♎', from: '09-23', to: '10-22' },
  { name: 'Scorpio', glyph: '♏', from: '10-23', to: '11-21' },
  { name: 'Sagittarius', glyph: '♐', from: '11-22', to: '12-21' },
]

/** The sign whose season `iso` falls in. */
export function sunSign(iso: string): StarSign {
  const md = monthDay(iso)
  // Capricorn is the one that wraps the year, so it is the fallback rather than a range test.
  return SIGNS.slice(1).find(s => md >= s.from && md <= s.to) ?? SIGNS[0]
}

/** A sign's glyph by name, for a player row. Empty for a name we do not recognize. */
export function signGlyph(name: string | null | undefined): string {
  return SIGNS.find(s => s.name === name)?.glyph ?? ''
}

export interface SignBirthday {
  player: WpblPlayer
  /** This season's occurrence of the birthday, 'YYYY-MM-DD', or null when the date is not
   *  settled enough to print (see birthDateSettled). */
  date: string | null
  /** Days from today to `date`: negative once it has passed. Null with no date. */
  offset: number | null
  /** The age being turned, or null where the year is not trusted (see statedAge). */
  age: number | null
}

/**
 * The players born under the sign whose season it is, each with their birthday: today and the days
 * ahead first, then the ones already gone, most recent first. In plain date order the card's cap
 * filled up with last month by the end of a season, and a birthday today fell off it. Read off
 * `zodiac_sign`, which the database derives from the birth date and keeps for unsettled dates too:
 * a date good enough to place a sign is not always good enough to print, so those players are
 * listed without one, after the dated ones.
 */
export function signSeason(players: WpblPlayer[], today: string): { sign: StarSign; players: SignBirthday[] } {
  const sign = sunSign(today)
  const base = dayNumber(today)
  const year = Number(today.slice(0, 4))
  const born = players
    .filter(p => p.active && p.zodiac_sign === sign.name)
    .map((p): SignBirthday => {
      if (!birthDateSettled(p)) return { player: p, date: null, offset: null, age: null }
      // The occurrence nearest today: Capricorn's season straddles New Year, so a January
      // birthday seen in late December belongs to next year's date, not this year's.
      const date = [year - 1, year, year + 1]
        .map(y => `${y}-${monthDay(p.birth_date!)}`)
        .reduce((best, d) => Math.abs(dayNumber(d) - base) < Math.abs(dayNumber(best) - base) ? d : best)
      return { player: p, date, offset: dayNumber(date) - base, age: statedAge(p, date) }
    })
  const group = (b: SignBirthday) => (b.offset == null ? 2 : b.offset < 0 ? 1 : 0)
  born.sort((a, b) =>
    group(a) - group(b)
    || (group(a) === 1 ? (b.offset ?? 0) - (a.offset ?? 0) : (a.offset ?? 0) - (b.offset ?? 0))
    || a.player.name.localeCompare(b.player.name))
  return { sign, players: born }
}

/**
 * Who won a closed fan award, or null with no votes for anyone on the roster. Most votes, then the
 * key, the order the results sheet ranks by (withWriteIns), so the two name the same winner. Read
 * off the tally alone: a player award's choice IS the player id, and building the sheet's shortlists
 * would bring back the box-score lines and the play log.
 */
export function awardWinner(results: AwardResults, awardId: string, players: WpblPlayer[]): WpblPlayer | null {
  const byId = new Map(players.map(p => [p.id, p]))
  const key = topAwardKey(results, awardId, k => byId.has(k))
  return key ? byId.get(key)! : null
}

/** The same for Manager of the Year, whose choices are `mgr:` keys rather than player ids. */
export function awardManagerWinner(results: AwardResults, awardId: string): WpblManager | null {
  const key = topAwardKey(results, awardId, k => WPBL_MANAGERS.some(m => m.key === k))
  return key ? WPBL_MANAGERS.find(m => m.key === key)! : null
}

function topAwardKey(results: AwardResults, awardId: string, known: (key: string) => boolean): string | null {
  const [top] = Object.entries(results[awardId] ?? {})
    .filter(([key, votes]) => votes > 0 && known(key))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return top ? top[0] : null
}

/** One stat's leaders as the Stats tab's card ranks them, best first. */
export interface HomeLeaderStat<S> {
  stat: S
  leaders: { player: WpblPlayer; text: string; rank: number }[]
}

/** One row of the leaders card: a leader with their stats, or the players tied for one stat. */
export interface HomeLeaderRow<S> {
  players: WpblPlayer[]
  stats: { stat: S; text: string }[]
}

/** More stats than this and a row's values no longer fit beside a phone's name. */
const STATS_PER_ROW = 2

/**
 * Up to `count` rows, walking the stats in order. A sole leader who already has a row adds the stat
 * to it rather than drawing a second row of the same face, and a third is dropped, so the walk moves
 * on to stats someone else leads. A tie keeps a row of its own: both names are the news there, and
 * the tie-break would otherwise leave a co-leader off the card (Whitmore, 11 home runs, 2026).
 */
export function homeLeaderRows<S>(stats: HomeLeaderStat<S>[], count: number): HomeLeaderRow<S>[] {
  const rows: HomeLeaderRow<S>[] = []
  for (const { stat, leaders } of stats) {
    const top = leaders.filter(l => l.rank === 1)
    if (top.length === 0) continue
    const own = top.length === 1
      ? rows.find(r => r.players.length === 1 && r.players[0].id === top[0].player.id)
      : undefined
    if (own) {
      if (own.stats.length < STATS_PER_ROW) own.stats.push({ stat, text: top[0].text })
    } else if (rows.length < count) {
      rows.push({ players: top.map(l => l.player), stats: [{ stat, text: top[0].text }] })
    }
  }
  return rows
}
