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
import type { WpblBattingLine, WpblPitchingLine, WpblLiveState } from './types'

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
    // ERA here is the league's per-9, always, and this function deliberately has no way to
    // ask for anything else. The reader of an unfurled card did not open the site and never
    // chose a basis; what they DID do is see a number somewhere that came from the league.
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

// ─── Game cards ────────────────────────────────────────────────────────────────
//
// The same job for /wpbl/games/<slug>. No generated art: the player cards are worth their
// pipeline because a face is the thing people share, and a box score is not. The site's
// default 1200x630 cover carries these, so the words are the whole card.

export interface WpblCardGame {
  id: string
  game_date: string
  home_team_id: string
  away_team_id: string
  status: string | null
  home_score: number | null
  away_score: number | null
  /** Read for one reason: settleGames() in gameOver.ts calls a game the league left sitting at
   *  "In Progress" so the unfurl serves the result rather than the preview. Not rendered. */
  live_state?: WpblLiveState | null
  final_by_rule?: boolean
}

export interface WpblCardTeam { id: string; city: string; name: string }

export interface WpblGameCard {
  title: string
  ogTitle: string
  description: string
}

/** 'Aug 23, 2026' from '2026-08-23', parsed by hand rather than through Date.
 *  `game_date` is a plain calendar date with no zone, and handing it to the Date
 *  constructor reads it as UTC midnight, which renders as the day BEFORE anywhere west of
 *  Greenwich. A share card that names the wrong day is worse than one that names none. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function wpblCardDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ''))
  if (!m) return ''
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : ''
}

export function wpblGameCard(game: WpblCardGame, teams: readonly WpblCardTeam[]): WpblGameCard {
  const club = (id: string) => teams.find(t => t.id === id) ?? null
  const home = club(game.home_team_id)
  const away = club(game.away_team_id)
  const homeNick = home?.name ?? game.home_team_id
  const awayNick = away?.name ?? game.away_team_id
  const homeFull = home ? `${home.city} ${home.name}` : game.home_team_id
  const awayFull = away ? `${away.city} ${away.name}` : game.away_team_id
  const when = wpblCardDate(game.game_date)
  const dateTail = when ? `, ${when}` : ''

  const final = game.status === 'final'
    && typeof game.home_score === 'number' && typeof game.away_score === 'number'

  if (!final) {
    // Scheduled, or in progress. A live game's score changes minute to minute and an unfurl
    // is cached by whoever fetched it, so a card claiming 3-1 in the fourth would still be
    // saying that a week later. The matchup is the part that stays true.
    const title = `${awayNick} at ${homeNick}${dateTail}: WPBL preview | sportydolphin.fun`
    return {
      title,
      ogTitle: `${awayNick} at ${homeNick}${dateTail}`,
      description:
        `${awayFull} at ${homeFull}${dateTail} in the Women's Pro Baseball League. `
        + 'Live score, lineups, box score and play-by-play.',
    }
  }

  // Winner first, which is how a result is spoken and how every scoreboard prints it.
  const homeWon = (game.home_score as number) > (game.away_score as number)
  const winNick = homeWon ? homeNick : awayNick
  const loseNick = homeWon ? awayNick : homeNick
  const winFull = homeWon ? homeFull : awayFull
  const loseFull = homeWon ? awayFull : homeFull
  const hi = Math.max(game.home_score as number, game.away_score as number)
  const lo = Math.min(game.home_score as number, game.away_score as number)
  const tied = hi === lo

  const line = tied ? `${awayNick} ${lo}, ${homeNick} ${hi}` : `${winNick} ${hi}, ${loseNick} ${lo}`
  return {
    title: `${line}${dateTail}: WPBL box score | sportydolphin.fun`,
    ogTitle: `${line}${dateTail}`,
    description: tied
      ? `${awayFull} and ${homeFull} finished ${hi}–${lo}${dateTail}. Full box score, play-by-play and win probability.`
      : `${winFull} beat the ${loseFull} ${hi}–${lo}${dateTail} in the Women's Pro Baseball League. `
        + 'Full box score, play-by-play and win probability.',
  }
}
