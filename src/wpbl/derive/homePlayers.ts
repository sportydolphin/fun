import type { WpblPlayer } from '../types'
import { birthDateSettled, statedAge } from './discordBirthdays'

// The offseason Home's player cards: one player a day, the birthdays coming up, whose star sign
// it is, and a place the league draws from. All of it is pure selection over the roster the page
// already holds, so none of it costs a read.
//
// WHY THESE AND NOT LEADERS. A player page is what readers open most, and the offseason Home had
// no link to one. Leaderboards would need every box-score line back on Home, the heaviest read in
// the section, which it stopped making in the offseason on purpose (homeLandingReadsLines). The
// roster's own columns (birth date, sign, hometown) are complete enough to carry a card each and
// cost nothing.
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
 * settled birthday today wins over the rotation, from the whole roster, because a birthday is
 * news about anyone who has a page.
 */
export function playerOfTheDay(players: WpblPlayer[], today: string): PlayerOfTheDay | null {
  const active = players.filter(p => p.active)
  const birthdays = active.filter(p => birthDateSettled(p) && monthDay(p.birth_date!) === monthDay(today))
  const day = dayNumber(today)
  if (birthdays.length) {
    const order = rotation(birthdays, p => p.id)
    return { player: order[day % order.length], reason: 'birthday' }
  }
  const pool = active.filter(p => p.api_ids.length > 0)
  if (!pool.length) return null
  const order = rotation(pool, p => p.id)
  return { player: order[day % order.length], reason: 'rotation' }
}

export interface UpcomingBirthday {
  player: WpblPlayer
  /** Days from today: negative for one just past, 0 for today. */
  offset: number
  /** The date of this occurrence, 'YYYY-MM-DD'. */
  date: string
  /** The age being turned, or null where the year is not trusted (see statedAge). */
  age: number | null
}

/**
 * Birthdays around today: today's, at most `recent` from the last `back` days (a late greeting is
 * still a greeting), then the next ones in date order up to `limit` in all. Settled dates only, by
 * the same rule as the Discord channel.
 */
export function upcomingBirthdays(
  players: WpblPlayer[], today: string,
  { limit = 5, back = 3, recent = 1 }: { limit?: number; back?: number; recent?: number } = {},
): UpcomingBirthday[] {
  const base = dayNumber(today)
  const year = Number(today.slice(0, 4))
  const all: UpcomingBirthday[] = []
  for (const p of players) {
    if (!p.active || !birthDateSettled(p)) continue
    const md = monthDay(p.birth_date!)
    // The nearest occurrence: last year's, this year's or next year's, whichever lands in the
    // window. Three candidates cover a window that crosses New Year from either side.
    for (const y of [year - 1, year, year + 1]) {
      const date = `${y}-${md}`
      const offset = dayNumber(date) - base
      if (offset < -back || offset > 366 - back) continue
      all.push({ player: p, offset, date, age: statedAge(p, date) })
    }
  }
  all.sort((a, b) => a.offset - b.offset || a.player.name.localeCompare(b.player.name))
  const past = all.filter(b => b.offset < 0).slice(-recent)
  const ahead = all.filter(b => b.offset >= 0)
  return [...past, ...ahead].slice(0, limit)
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

/** A sign's glyph by name, for a player row. Empty for a name we do not recognise. */
export function signGlyph(name: string | null | undefined): string {
  return SIGNS.find(s => s.name === name)?.glyph ?? ''
}

/**
 * The players born under the sign whose season it is. Read off `zodiac_sign`, which the database
 * derives from the birth date and keeps for unsettled dates too: a date good enough to place a
 * sign is not always good enough to greet someone on (see birth_date_source). Those who have
 * played lead, so the first rows are names a reader may know, then by name.
 */
export function signSeason(players: WpblPlayer[], today: string): { sign: StarSign; players: WpblPlayer[] } {
  const sign = sunSign(today)
  const born = players
    .filter(p => p.active && p.zodiac_sign === sign.name)
    .sort((a, b) => Number(b.api_ids.length > 0) - Number(a.api_ids.length > 0) || a.name.localeCompare(b.name))
  return { sign, players: born }
}

export interface HometownSpotlight {
  /** "British Columbia, Canada", or the country alone for a hometown that names nothing else. */
  region: string
  players: WpblPlayer[]
}

/** The state or province and country of a hometown: the last two parts, or the one there is. */
export function regionOf(hometown: string | null | undefined): string | null {
  const parts = (hometown ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return parts.length ? parts.slice(-2).join(', ') : null
}

/**
 * A place the league draws from, one a day. Only places with at least `min` players, so the card
 * is always a group and never a single name or a pair standing in for a region. A bare "USA" is left out:
 * it is a missing hometown rather than a place.
 */
export function hometownOfTheDay(players: WpblPlayer[], today: string, min = 3): HometownSpotlight | null {
  const groups = new Map<string, WpblPlayer[]>()
  for (const p of players) {
    if (!p.active) continue
    const region = regionOf(p.hometown)
    if (!region || region === 'USA') continue
    let list = groups.get(region)
    if (!list) groups.set(region, list = [])
    list.push(p)
  }
  const eligible = [...groups.entries()].filter(([, list]) => list.length >= min)
  if (!eligible.length) return null
  const order = rotation(eligible, ([region]) => region)
  const [region, list] = order[dayNumber(today) % order.length]
  return {
    region,
    players: [...list].sort((a, b) => a.name.localeCompare(b.name)),
  }
}
