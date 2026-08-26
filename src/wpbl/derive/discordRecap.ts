// The Discord message for a finished game — the box score as it appears in the fan
// server's recap channel.
//
// Pure, and kept beside the recap engine it renders (recap.ts) rather than inside the job
// that sends it, for two reasons: what gets posted to a public channel is worth unit
// testing, and the sender (scripts/post-wpbl-discord-recaps.ts) exits on missing env at
// import time, so a test can't load it. The hash below is also what decides whether a
// game's already-posted message needs editing, so "what we render" and "when we re-send"
// stay one decision.
import type { WpblGame, WpblTeam, WpblLineScoreEntry } from '../types'
import { playedInnings } from '../innings.ts'
import type { GameRecap } from './recap'

const SITE = 'https://sportydolphin.fun'
const MEDALS = ['🥇', '🥈', '🥉']

export interface DiscordEmbedField { name: string; value: string }
export interface DiscordRecapMessage {
  allowed_mentions: { parse: string[] }
  embeds: [{
    title: string
    url: string
    color?: number
    description: string
    fields: DiscordEmbedField[]
    footer: { text: string }
  }]
}

/** "#e8412c" → 15221548, the integer Discord wants for an embed's accent stripe. */
export function embedColor(team: WpblTeam | undefined): number | undefined {
  const hex = (team?.color ?? '').replace('#', '').trim()
  if (!/^[0-9a-f]{6}$/i.test(hex)) return undefined
  return parseInt(hex, 16)
}

/** Runs per inning from the stored line score, padded out to the innings actually played. */
function inningRuns(line: WpblLineScoreEntry[] | null | undefined, innings: number): number[] {
  const out: number[] = Array(innings).fill(0)
  for (const e of line ?? []) if (e.inning >= 1 && e.inning <= innings) out[e.inning - 1] = e.runs
  return out
}

/**
 * The line score as a monospace table — the shape anyone who has read a box score expects:
 *
 *         1  2  3  4  5  6  7 │  R   H   E
 *   BOS   2  0  0  1  3  0  0 │  6  11   0
 *   NY    0  0  0  1  0  0  0 │  1   8   2
 *
 * A code block is what makes it hold together: Discord renders proportional text
 * everywhere else, so the columns would only line up by accident. Teams are abbreviated
 * for the same reason — the block does not wrap, and "San Francisco Firebells" against
 * seven innings runs past the width of a phone, which is where most of Discord is read.
 */
export interface LineScoreRow { teamId: string; abbr: string; cells: (number | 'X')[]; r: number; h: number; e: number }
export interface LineScoreGrid { innings: number; rows: [LineScoreRow, LineScoreRow] }

/**
 * The line score as data, shared by every renderer of it.
 *
 * Extracted from `lineScoreBlock` when the Bluesky card arrived, because the X rule below is a
 * real baseball judgement and two copies of it would drift: one renderer would start claiming a
 * scoreless bottom of the 7th that nobody batted, and nothing about that looks wrong until
 * somebody who reads box scores notices.
 */
export function lineScoreGrid(game: WpblGame, recap: GameRecap, teams: Map<string, WpblTeam>): LineScoreGrid {
  const innings = Math.max(playedInnings(game.away_line, game.home_line), game.innings ?? 7)
  const [away, home] = recap.teamLine
  const abbr = (teamId: string, fallback: string) => teams.get(teamId)?.abbr ?? fallback
  // A home team that's already ahead never bats in the bottom of the final inning. The feed
  // still reports 0 runs for that half, but printing it as a 0 claims a scoreless frame that
  // was never played, so use the X a scorebook would. A walk-off is the other branch — the
  // home team was tied or trailing going in, so it batted and its runs stand. Same rule the
  // app's Scoreboard applies.
  const aRuns = inningRuns(game.away_line, innings)
  const hRuns = inningRuns(game.home_line, innings)
  const through = (runs: number[], n: number) => runs.slice(0, n).reduce((t, x) => t + x, 0)
  const homeDidNotBatLast = through(hRuns, innings - 1) > through(aRuns, innings)
  return {
    innings,
    rows: [
      { teamId: away.teamId, abbr: abbr(away.teamId, away.name), cells: aRuns, r: away.r, h: away.h, e: away.e },
      {
        teamId: home.teamId, abbr: abbr(home.teamId, home.name),
        cells: hRuns.map((r, i) => (homeDidNotBatLast && i === innings - 1 ? 'X' : r)),
        r: home.r, h: home.h, e: home.e,
      },
    ],
  }
}

export function lineScoreBlock(game: WpblGame, recap: GameRecap, teams: Map<string, WpblTeam>): string {
  const { innings, rows: grid } = lineScoreGrid(game, recap, teams)
  const cell = (v: string | number) => String(v).padStart(2)
  const rows = grid.map(g => ({ name: g.abbr, side: g, cells: g.cells.map(cell) }))
  const nameW = Math.max(...rows.map(r => r.name.length), 3)
  const header = `${' '.repeat(nameW)}  ${Array.from({ length: innings }, (_, i) => cell(i + 1)).join(' ')} │ ${cell('R')} ${cell('H')} ${cell('E')}`
  const body = rows.map(r =>
    `${r.name.padEnd(nameW)}  ${r.cells.join(' ')} │ ${cell(r.side.r)} ${cell(r.side.h)} ${cell(r.side.e)}`)
  return ['```', header, ...body, '```'].join('\n')
}

/** The whole message for one finished game. */
export function buildRecapMessage(game: WpblGame, recap: GameRecap, teams: Map<string, WpblTeam>): DiscordRecapMessage {
  const fields: DiscordEmbedField[] = []
  if (recap.stars.length) {
    fields.push({
      name: 'Stars of the game',
      value: recap.stars.map((s, i) => `${MEDALS[i] ?? '⭐'} **${s.name}** — ${s.statline}`).join('\n'),
    })
  }
  if (recap.decisions.length) {
    fields.push({
      name: 'Decisions',
      value: recap.decisions.map(d => `\`${d.key}\` **${d.name}** — ${d.statline}`).join('\n'),
    })
  }
  if (recap.feats.length) {
    fields.push({ name: 'Notable', value: recap.feats.map(f => `• ${f}`).join('\n') })
  }

  const extras = (game.innings ?? 7) !== 7 ? ` · ${game.innings} innings` : ''
  return {
    // A recap should never ping a channel, however it is worded.
    allowed_mentions: { parse: [] },
    embeds: [{
      title: recap.headline,
      url: `${SITE}/wpbl?game=${game.id}`,   // opens the game center, on its Recap tab
      color: embedColor(teams.get(recap.winner.id)),
      // A BLANK line before the fence, not just a newline. Discord draws a code block as a
      // filled box with a border, and one newline puts that box hard against the last line of
      // the blurb with no gap at all, so the recap reads as prose with a table stuck to the
      // bottom of it. The blank line is the only spacing control an embed description has.
      description: `${recap.blurb}\n\n${lineScoreBlock(game, recap, teams)}`,
      fields,
      footer: { text: `WPBL · ${game.game_date}${extras} · sportydolphin.fun` },
    }],
  }
}

/**
 * A stable fingerprint of a rendered message, used to decide whether an already-posted
 * recap needs editing. Serialising the message itself (rather than hashing the stats) is
 * deliberate: it means the job re-sends exactly when the reader would see something
 * different, and stays silent for a correction that doesn't change a single character.
 */
export function recapMessageFingerprint(message: DiscordRecapMessage): string {
  return JSON.stringify(message)
}

/**
 * The stored form of that fingerprint. TWO different posters write it — the edge function
 * that announces a final the moment the ingest sees it, and the scheduled job that keeps
 * the message current afterwards — so they have to agree to the character, or the job
 * would "correct" a message the function had only just posted. One implementation, on Web
 * Crypto because it is the digest both Deno and Node have.
 */
export async function recapMessageHash(message: DiscordRecapMessage): Promise<string> {
  const bytes = new TextEncoder().encode(recapMessageFingerprint(message))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
