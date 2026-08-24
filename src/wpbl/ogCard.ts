// The words on a shared player link's preview card — the title, the season line, and the
// headshot path an unfurler (iMessage, Slack, Discord, X) shows when someone pastes
// /wpbl?player=<id>.
//
// This lives under src/ rather than beside its only caller — the Cloudflare Pages function
// in functions/wpbl/ — for two reasons: it is pure, so it can be unit-tested with the rest
// of the app instead of only by deploying, and it keeps the card's phrasing next to the
// aggregation it describes, so a change to how the player page reads (see PlayerDetail)
// has an obvious second place to follow.
import { sumBatting, sumPitching, fmtRate, fmtTwo } from './stats'
import type { WpblSeasonGame } from './season'
import { slugifyName } from './slug'
import { displayPosition } from './positions'
import type { WpblBattingLine, WpblPitchingLine } from './types'

// Only the columns the card needs. The Pages function selects exactly these, so a preview
// costs four narrow reads rather than whole box-score rows.
// `position` is here for the card's subject line rather than for any stat: it is what the
// player has actually been playing, which the roster does not always agree with.
// `game_id` is not shown anywhere on the card. It is here because the season line has to
// exclude postseason games, and a box-score line carries nothing else that says which game
// it belongs to.
export type WpblCardBatting = Pick<WpblBattingLine, 'game_id' | 'ab' | 'r' | 'h' | 'doubles' | 'triples' | 'hr' | 'rbi' | 'bb' | 'so' | 'hbp' | 'sb' | 'cs' | 'sf' | 'sh'>
  & Partial<Pick<WpblBattingLine, 'position'>>
export type WpblCardPitching = Pick<WpblPitchingLine, 'game_id' | 'outs' | 'h' | 'r' | 'er' | 'bb' | 'so' | 'hr' | 'decision'>
export interface WpblCardPlayer { id: string; name: string; position: string | null }

export interface WpblPlayerCard {
  title: string          // <title> — the browser tab and the search result
  ogTitle: string        // the unfurl's bold first line
  description: string
  cardPath: string       // /cards/<slug>.webp, published by the build; may not exist
}

export function wpblPlayerCard(
  player: WpblCardPlayer,
  teamName: string,
  batting: WpblCardBatting[],
  pitching: WpblCardPitching[],
  games: WpblSeasonGame[],
): WpblPlayerCard {
  // A middot, not a comma: position codes are themselves comma-joined for a two-way
  // player ("RHP, UTL"), and "RHP, UTL, San Francisco Firebells" reads as one long list.
  const subject = [displayPosition(player.position, batting).label, teamName].filter(Boolean).join(' · ')
  return {
    title: `${player.name} — WPBL stats | sportydolphin.fun`,
    ogTitle: `${player.name} — ${subject}`,
    description: describeSeason(player, teamName, batting, pitching, games),
    cardPath: `/cards/${slugifyName(player.name)}.webp`,
  }
}

// The season line, told the way the player page tells it: lead with the skill the player
// is actually here for. Mirrors PlayerDetail's rule — every pitcher position code contains
// a 'P' and no position-player code does — so a starter who also took a few at-bats still
// unfurls as a pitcher.
function describeSeason(
  player: WpblCardPlayer,
  teamName: string,
  batting: WpblCardBatting[],
  pitching: WpblCardPitching[],
  games: WpblSeasonGame[],
): string {
  // Zero-PA rows (a pinch-runner who scored, a defensive sub) would otherwise read as an
  // 0-for-0 game — the same reason the player page drops them.
  const batted = batting.filter(l => l.ab + l.bb + l.hbp + l.sf + l.sh > 0)
  const hasBatting = batted.length > 0
  const hasPitching = pitching.length > 0
  const pitcherFirst = hasPitching && (!hasBatting || /P/.test(player.position || ''))

  const tail = 'Full stat line, game log, and fielding.'
  if (pitcherFirst) {
    const t = sumPitching(pitching as WpblPitchingLine[], games)
    const record = t.w || t.l ? `${t.w}-${t.l}, ` : ''
    const saves = t.s ? `, ${t.s} SV` : ''
    return `${record}${fmtTwo(t.era)} ERA and ${fmtTwo(t.whip)} WHIP with ${t.so} K in ${outsToIp(t.outs)} IP over ${plural(t.g, 'game')}${saves}. ${tail}`
  }
  if (hasBatting) {
    const t = sumBatting(batted as WpblBattingLine[], games)
    const slash = `${fmtRate(t.avg)}/${fmtRate(t.obp)}/${fmtRate(t.slg)}`
    // A hitter with no homers and no RBI is described by what they did do, rather than by
    // two zeroes: an 0-for-3 card shouldn't read "with 0 HR and 0 RBI".
    const power = [t.hr ? `${t.hr} HR` : '', t.rbi ? `${t.rbi} RBI` : ''].filter(Boolean).join(' and ')
    const body = power ? `with ${power}` : `— ${t.h}-for-${t.ab}`
    return `${slash} ${body} in ${plural(t.g, 'game')}. ${tail}`
  }
  // Drafted, or on the roster but yet to appear. Still worth a real card.
  const role = player.position ? `${player.position} for the ${teamName}` : `On the ${teamName} roster`
  return `${role}. WPBL stats, game log, and bio — updated after every game.`
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
// Innings pitched read as outs: 16 outs = "5.1". Duplicated from constants.ts, which the
// Pages function can't import — that module pulls in the team logos through
// import.meta.glob, which only Vite understands.
const outsToIp = (outs: number): string => `${Math.floor(outs / 3)}.${outs % 3}`
