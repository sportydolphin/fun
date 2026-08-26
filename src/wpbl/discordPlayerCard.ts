// The Discord reply for a player lookup.
//
// Pure and kept beside the other WPBL derive modules for the same reason discordRecap.ts
// is: what gets posted into a public channel is worth unit testing, and the function that
// sends it (functions/discord/wpbl.ts) can't be imported by a test without a Cloudflare
// request context.
//
// The stat lines come from stats.ts, the same aggregation the player page and the season
// leaderboards use, so a number here can never disagree with the number on the site.
import { sumBatting, sumPitching, fmtRate, fmtTwo } from './stats'
import { displayPosition } from './positions'
// From innings.ts directly, NOT via the constants.ts re-export. constants.ts imports the
// team logos as .webp assets, which Vite resolves and the Cloudflare Functions bundler does
// not — pulling it in here fails the whole functions build, which silently leaves the last
// good deployment serving and the endpoint 405ing. Everything this module reaches for has
// to stay asset-free for the same reason.
import { outsToIp } from './innings'
import type { WpblPlayer, WpblTeam, WpblBattingLine, WpblPitchingLine } from './types'
import type { WpblSeasonGame } from '../wpbl/season'

const SITE = 'https://sportydolphin.fun'

export interface DiscordEmbed {
  title: string
  url?: string
  color?: number
  description?: string
  fields?: { name: string; value: string; inline?: boolean }[]
  footer?: { text: string }
  thumbnail?: { url: string }
}

export interface DiscordReply {
  embeds?: DiscordEmbed[]
  content?: string
  allowed_mentions: { parse: [] }
  /** 64 = ephemeral, visible only to whoever ran the command. */
  flags?: number
}

/** "#e8412c" → the integer Discord wants for an embed's accent stripe. */
function embedColor(team: WpblTeam | undefined): number | undefined {
  const hex = (team?.color ?? '').replace('#', '').trim()
  if (!/^[0-9a-f]{6}$/i.test(hex)) return undefined
  return parseInt(hex, 16)
}

/**
 * A player's season. Batting and pitching are separate fields rather than one blended line,
 * and the one the player is actually here for leads: every pitcher position code contains a
 * 'P' and no position-player code does, which is the same rule the player page and the
 * unfurl card use to decide which way round to tell it.
 */
export function buildPlayerReply(
  // Only the fields the card actually shows, so a caller holding a partial roster row
  // (the bot selects id/name/position/jersey_number/team_id) doesn't need a cast to pass it.
  player: Pick<WpblPlayer, 'id' | 'name' | 'position' | 'jersey_number'>,
  team: WpblTeam | undefined,
  batting: WpblBattingLine[],
  pitching: WpblPitchingLine[],
  // The schedule, so the season line stops where the regular season does. Same reason as
  // every other aggregate on the site; see stats.ts.
  games: WpblSeasonGame[],
): DiscordReply {
  // Zero-PA rows (a pinch-runner who scored, a defensive sub) would read as an 0-for-0
  // game, so they come out here exactly as they do on the player page.
  const batted = batting.filter(l => l.ab + l.bb + l.hbp + l.sf + l.sh > 0)
  const bt = sumBatting(batted, games)
  const pt = sumPitching(pitching, games)
  const hasBatting = batted.length > 0
  const hasPitching = pitching.length > 0
  const pitcherFirst = hasPitching && (!hasBatting || /P/.test(player.position ?? ''))

  const fields: { name: string; value: string; inline?: boolean }[] = []
  const battingField = () => ({
    name: `Batting · ${bt.g} G`,
    value: [
      `**${fmtRate(bt.avg)}** AVG · **${fmtRate(bt.obp)}** OBP · **${fmtRate(bt.slg)}** SLG · **${fmtRate(bt.ops)}** OPS`,
      `${bt.h}-for-${bt.ab}, ${bt.r} R, ${bt.hr} HR, ${bt.rbi} RBI, ${bt.bb} BB, ${bt.so} SO, ${bt.sb} SB`,
    ].join('\n'),
  })
  // Per-9 ERA, same reasoning as the OG cards: a card posted into a channel is read by
  // people who never touched the site's settings, next to the league's own numbers.
  const pitchingField = () => ({
    name: `Pitching · ${pt.g} G`,
    value: [
      `**${fmtTwo(pt.era)}** ERA · **${fmtTwo(pt.whip)}** WHIP · **${pt.w}-${pt.l}**${pt.s > 0 ? ` · **${pt.s}** SV` : ''}`,
      `${outsToIp(pt.outs)} IP, ${pt.h} H, ${pt.er} ER, ${pt.bb} BB, ${pt.so} SO`,
    ].join('\n'),
  })

  if (pitcherFirst) {
    fields.push(pitchingField())
    if (hasBatting) fields.push(battingField())
  } else {
    if (hasBatting) fields.push(battingField())
    if (hasPitching) fields.push(pitchingField())
  }

  const teamName = team ? `${team.city} ${team.name}` : 'the WPBL'
  // The number leads, the way a player page header reads it. Kept out of the title so the
  // embed still links under the plain name, and a blank one just drops out of the line: the
  // feed only started carrying uniforms into our roster rows partway through the season, so
  // an older player who has not appeared since can genuinely have none. Note it is a string,
  // not a number — "0" and "00" are different players' jerseys, so this must never be
  // coerced or falsy-tested against the number 0.
  const jersey = (player.jersey_number ?? '').trim()
  const subject = [
    jersey ? `#${jersey}` : '',
    displayPosition(player.position, batting).label,
    teamName,
  ].filter(Boolean).join(' · ')

  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: player.name,
      url: `${SITE}/wpbl?player=${player.id}`,
      color: embedColor(team),
      description: subject,
      // A player on the roster who hasn't appeared yet is a real answer, not an error, so
      // say so plainly rather than returning an embed with nothing under the name.
      ...(fields.length ? { fields } : { fields: [{ name: 'Season', value: 'No games played yet.' }] }),
      footer: { text: `WPBL 2026 · sportydolphin.fun` },
    }],
  }
}

/**
 * Nothing matched well enough to answer with. Ephemeral on purpose: a mistyped name is
 * between the reader and the bot, and a channel full of other people's failed lookups is
 * noise nobody asked for.
 */
export function buildNoMatchReply(query: string, suggestions: string[]): DiscordReply {
  const lines = [`No WPBL player matched **${sanitize(query)}**.`]
  if (suggestions.length) {
    lines.push('', 'Did you mean:', ...suggestions.slice(0, 5).map(n => `• ${n}`))
  }
  return { allowed_mentions: { parse: [] }, content: lines.join('\n'), flags: 64 }
}

/**
 * Several players match about equally ("kim" on a roster with two). Listing them beats
 * picking one, and it's ephemeral for the same reason as a miss.
 */
export function buildAmbiguousReply(query: string, names: string[]): DiscordReply {
  return {
    allowed_mentions: { parse: [] },
    content: [
      `**${sanitize(query)}** matches more than one player:`,
      ...names.slice(0, 8).map(n => `• ${n}`),
      '',
      'Try a full name.',
    ].join('\n'),
    flags: 64,
  }
}

/**
 * Whatever was typed is echoed back into a channel message, so it must not be able to carry
 * markdown or a mention out with it. `allowed_mentions` already defuses pings; this stops
 * the formatting characters, and the length cap stops someone pasting a wall of text.
 */
function sanitize(s: string): string {
  return s.slice(0, 80).replace(/[\\*_~`>|@]/g, '')
}
