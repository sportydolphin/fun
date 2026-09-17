// The Discord reply for a player lookup.
//
// Pure and kept beside the other WPBL derive modules for the same reason discordRecap.ts
// is: what gets posted into a public channel is worth unit testing, and the function that
// sends it (functions/discord/wpbl.ts) can't be imported by a test without a Cloudflare
// request context.
//
// The stat lines come from stats.ts, the same aggregation the player page and the season
// leaderboards use, so a number here can never disagree with the number on the site.
import { sumBatting, sumPitching, plateAppearances, fmtRate, fmtTwo,
  type WpblBattingTotals, type WpblPitchingTotals } from './stats'
import { displayPosition, leadsWithPitching } from './positions'
// From innings.ts directly, NOT via the constants.ts re-export. constants.ts imports the
// team logos as .webp assets, which Vite resolves and the Cloudflare Functions bundler does
// not: pulling it in here fails the whole functions build, which silently leaves the last
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
 * and the one the player is actually here for leads. Which one that is comes from
 * `leadsWithPitching` in positions.ts, the same call the player page and the unfurl card
 * make: three copies of the rule would let a shortstop who starts on the mound be led one way
 * here and the other way on the site the card links to.
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
  // Two slices of the same lines: the regular season, and the postseason under it. Each is
  // summed THROUGH the schedule, so a game lands in exactly one, and neither double-counts the
  // other. `sumBatting`/`sumPitching` default to 'regular'; the postseason call is the same
  // one the Stats tab and the season page's Runs-by-inning make. It fails CLOSED, so with no
  // postseason game recognised the postseason totals are zero and their fields never draw:
  // that is what keeps this line off every card in the league until a player actually appears
  // in the bracket.
  const bt = sumBatting(batted, games)
  const pt = sumPitching(pitching, games)
  const btPost = sumBatting(batted, games, 'postseason')
  const ptPost = sumPitching(pitching, games, 'postseason')

  const hasBatting = plateAppearances(bt) > 0
  const hasPitching = pt.outs > 0 || pt.bf > 0
  const hasBattingPost = plateAppearances(btPost) > 0
  const hasPitchingPost = ptPost.outs > 0 || ptPost.bf > 0

  // Which side leads, from the two slices together: a player whose only line is a postseason
  // one (a call-up who debuted in the bracket) still has to be led by the side she played.
  const pitcherFirst = leadsWithPitching({
    position: player.position,
    hasBatting: hasBatting || hasBattingPost,
    hasPitching: hasPitching || hasPitchingPost,
    gs: pt.gs + ptPost.gs, bf: pt.bf + ptPost.bf,
    pa: plateAppearances(bt) + plateAppearances(btPost),
  })

  const fields: { name: string; value: string; inline?: boolean }[] = []
  const battingField = (t: WpblBattingTotals, label: string) => ({
    name: `${label} · ${t.g} G`,
    value: [
      `**${fmtRate(t.avg)}** AVG · **${fmtRate(t.obp)}** OBP · **${fmtRate(t.slg)}** SLG · **${fmtRate(t.ops)}** OPS`,
      `${t.h}-for-${t.ab}, ${t.r} R, ${t.hr} HR, ${t.rbi} RBI, ${t.bb} BB, ${t.so} SO, ${t.sb} SB`,
    ].join('\n'),
  })
  // ERA/WHIP on the league's own basis (the stored number), same reasoning as the OG cards: a
  // card posted into a channel is read by people who never touched the site's settings, next to
  // the league's numbers, so it must not rescale to a personal preference. See ERA_BASIS in stats.ts.
  const pitchingField = (t: WpblPitchingTotals, label: string) => ({
    name: `${label} · ${t.g} G`,
    value: [
      `**${fmtTwo(t.era)}** ERA · **${fmtTwo(t.whip)}** WHIP · **${t.w}-${t.l}**${t.s > 0 ? ` · **${t.s}** SV` : ''}`,
      `${outsToIp(t.outs)} IP, ${t.h} H, ${t.er} ER, ${t.bb} BB, ${t.so} SO`,
    ].join('\n'),
  })

  // Regular season first, then postseason under it, each slice in the same lead order. The
  // postseason pair simply does not appear for a player whose year ended in the regular season,
  // which is most of the roster.
  const pushSlice = (
    bat: WpblBattingTotals, pit: WpblPitchingTotals,
    hasBat: boolean, hasPit: boolean, batLabel: string, pitLabel: string,
  ) => {
    if (pitcherFirst) {
      if (hasPit) fields.push(pitchingField(pit, pitLabel))
      if (hasBat) fields.push(battingField(bat, batLabel))
    } else {
      if (hasBat) fields.push(battingField(bat, batLabel))
      if (hasPit) fields.push(pitchingField(pit, pitLabel))
    }
  }
  pushSlice(bt, pt, hasBatting, hasPitching, 'Batting', 'Pitching')
  pushSlice(btPost, ptPost, hasBattingPost, hasPitchingPost, 'Postseason batting', 'Postseason pitching')

  const teamName = team ? `${team.city} ${team.name}` : 'the WPBL'
  // The number leads, the way a player page header reads it. Kept out of the title so the
  // embed still links under the plain name, and a blank one just drops out of the line: the
  // feed only started carrying uniforms into our roster rows partway through the season, so
  // an older player who has not appeared since can genuinely have none. Note it is a string,
  // not a number: "0" and "00" are different players' jerseys, so this must never be
  // coerced or falsy-tested against the number 0.
  const jersey = (player.jersey_number ?? '').trim()
  const subject = [
    jersey ? `#${jersey}` : '',
    displayPosition(player.position, batting, games).label,
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
