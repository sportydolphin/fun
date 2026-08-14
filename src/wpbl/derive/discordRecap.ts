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
export function lineScoreBlock(game: WpblGame, recap: GameRecap, teams: Map<string, WpblTeam>): string {
  const innings = game.innings ?? 7
  const [away, home] = recap.teamLine
  const abbr = (teamId: string, fallback: string) => teams.get(teamId)?.abbr ?? fallback
  const rows = [
    { name: abbr(away.teamId, away.name), side: away, runs: inningRuns(game.away_line, innings) },
    { name: abbr(home.teamId, home.name), side: home, runs: inningRuns(game.home_line, innings) },
  ]
  const nameW = Math.max(...rows.map(r => r.name.length), 3)
  const cell = (v: string | number) => String(v).padStart(2)
  const header = `${' '.repeat(nameW)}  ${Array.from({ length: innings }, (_, i) => cell(i + 1)).join(' ')} │ ${cell('R')} ${cell('H')} ${cell('E')}`
  const body = rows.map(r =>
    `${r.name.padEnd(nameW)}  ${r.runs.map(cell).join(' ')} │ ${cell(r.side.r)} ${cell(r.side.h)} ${cell(r.side.e)}`)
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
      url: `${SITE}/wpbl`,
      color: embedColor(teams.get(recap.winner.id)),
      description: `${recap.blurb}\n${lineScoreBlock(game, recap, teams)}`,
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
