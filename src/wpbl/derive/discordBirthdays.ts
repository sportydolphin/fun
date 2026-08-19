// The Discord message for a player's birthday, as it appears in the fan server.
//
// Pure, and kept beside the other derive modules rather than inside the job that sends it,
// for the same reason discordRecap.ts is: what gets posted into a public channel is worth
// unit testing, and the sender (scripts/post-wpbl-discord-birthdays.ts) exits on missing
// env at import time, so a test cannot load it.
//
// Two judgement calls live here rather than in the job, because both are about what the
// channel is told:
//
//   1. A date the BDay sheet contradicted itself about ('sheet-conflict') is not greeted at
//      all. The sheet listed two different dates for that player and the zodiac grid was
//      taken as the tiebreak, which is good enough to draw a sign with and not good enough
//      to wish someone a happy birthday on a coin flip.
//   2. An age is only stated when the league's own `age` agrees with the birth year. The
//      sheet's years are fan-collected and some of them are wrong: Edith De Leija's date
//      says 24 while the feed says 22. Getting the day right and the age wrong is worse
//      than not mentioning the age, and the day is the part the post is about.
import type { WpblPlayer, WpblTeam } from '../types'

const SITE = 'https://sportydolphin.fun'

/** Only the fields the message needs, so the job can select a narrow row. */
export type BirthdayPlayer = Pick<
  WpblPlayer,
  'id' | 'name' | 'team_id' | 'position' | 'birth_date' | 'birth_date_source' | 'age' | 'active'
>

export interface DiscordBirthdayMessage {
  allowed_mentions: { parse: string[] }
  content: string
}

/** 'YYYY-MM-DD' (or a full timestamp from postgres) to its month and day. */
function monthDay(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[2]}-${m[3]}` : null
}

/**
 * Whose birthday falls on `today`, in roster order by name.
 *
 * Year is deliberately ignored, and so is the leap-day question: nobody on the roster is
 * born on 29 February, so there is no convention to pick here. If that ever changes the
 * rule to add is "greet them on the 28th in a common year", and it belongs right here.
 */
export function birthdaysOn(players: BirthdayPlayer[], today: string): BirthdayPlayer[] {
  const md = monthDay(today)
  if (!md) return []
  return players
    .filter(p => p.active)
    .filter(p => p.birth_date_source !== 'sheet-conflict')
    .filter(p => p.birth_date && monthDay(p.birth_date) === md)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** How old the birth year says they are on `today`, which by construction is a birthday. */
export function ageOn(birthDate: string, today: string): number | null {
  const born = Number(birthDate.slice(0, 4))
  const now = Number(today.slice(0, 4))
  if (!born || !now) return null
  return now - born
}

/**
 * The age to print, or null to print none.
 *
 * The feed's `age` is the check: on a birthday it should read either the new age or the old
 * one, depending on whether the league has ticked it over yet. Anything else means the
 * sheet's year is wrong, and then the number stays out of the message. The outer bounds
 * catch a year that parsed into nonsense.
 */
export function statedAge(player: BirthdayPlayer, today: string): number | null {
  if (!player.birth_date) return null
  const age = ageOn(player.birth_date, today)
  if (age === null || age < 15 || age > 60) return null
  if (player.age != null && player.age !== age && player.age !== age - 1) return null
  return age
}

/** Discord markdown in a name would render rather than read. Rare, cheap to rule out. */
function escapeMarkdown(name: string): string {
  return name.replace(/([*_~`|\\])/g, '\\$1')
}

/**
 * "[Sarah Edwards](<link>), Los Angeles Queens 1B, 30"
 *
 * The link is wrapped in angle brackets so Discord does not unfurl it into an embed card.
 * A birthday post is one line of text and a card under it would be most of the message.
 */
function playerLine(
  player: BirthdayPlayer,
  teams: Map<string, WpblTeam>,
  today: string,
  ageSuffix: (age: number) => string,
): string {
  const team = player.team_id ? teams.get(player.team_id) : undefined
  const who = [
    team ? `${team.city} ${team.name}` : null,
    player.position,
  ].filter(Boolean).join(' ')
  const age = statedAge(player, today)
  return [
    `[${escapeMarkdown(player.name)}](<${SITE}/wpbl?player=${player.id}>)`,
    who || null,
    age === null ? null : ageSuffix(age),
  ].filter(Boolean).join(', ')
}

/**
 * The whole message, or null when nobody has a birthday. Null is the normal case: 65 of the
 * 118 players have a date at all, so most days the channel hears nothing, which is the
 * point. A birthday channel that posts every day is a channel nobody reads.
 *
 * One message covers however many people share the day (five pairs of players do), because
 * three separate posts a few seconds apart read like a broken bot.
 */
export function buildBirthdayMessage(
  players: BirthdayPlayer[],
  teams: Map<string, WpblTeam>,
  today: string,
): DiscordBirthdayMessage | null {
  const celebrating = birthdaysOn(players, today)
  if (!celebrating.length) return null

  const content = celebrating.length === 1
    ? `🎂 Happy birthday to ${playerLine(celebrating[0], teams, today, age => `${age} today`)}.`
    : [
        '🎂 Birthdays today:',
        ...celebrating.map(p => `• ${playerLine(p, teams, today, age => String(age))}`),
      ].join('\n')

  return {
    // A birthday should never ping a channel, same as every other webhook post here.
    allowed_mentions: { parse: [] },
    content,
  }
}
