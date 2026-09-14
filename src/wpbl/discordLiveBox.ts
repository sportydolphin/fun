// The Discord reply for `/score` — the box score of a game happening right now.
//
// Pure and asset-free, beside discordPlayerCard.ts and for the same reasons: what gets posted
// into a public channel is worth unit testing, and the endpoint that sends it
// (functions/discord/wpbl.ts) can't be imported by a test without a Cloudflare request context.
// Nothing here may reach constants.ts, which pulls the team logos in as Vite assets and fails
// the Functions build; team names are assembled from the plain WpblTeam fields instead.
//
// The recap card (discordRecap.ts) is the FINISHED-game equivalent and deliberately not reused:
// its line score applies the "home did not bat in the bottom of the last inning" X rule, which
// is a judgement about a completed game and wrong for one still being played. A live line score
// shows exactly the halves the feed has posted and no more.
import { deriveSituation, ORDINAL } from './derive/liveSituation'
import { playedInnings } from './innings'
import type { WpblGame, WpblTeam, WpblLineScoreEntry } from './types'
import type { DiscordEmbed, DiscordReply } from './discordPlayerCard'

const SITE = 'https://sportydolphin.fun'

/** "#e8412c" → the integer Discord wants for an embed's accent stripe. */
function embedColor(team: WpblTeam | undefined): number | undefined {
  const hex = (team?.color ?? '').replace('#', '').trim()
  if (!/^[0-9a-f]{6}$/i.test(hex)) return undefined
  return parseInt(hex, 16)
}

/** Runs per inning from the stored line score, padded out to the innings on the board. */
function inningRuns(line: WpblLineScoreEntry[] | null | undefined, innings: number): number[] {
  const out: number[] = Array(innings).fill(0)
  for (const e of line ?? []) if (e.inning >= 1 && e.inning <= innings) out[e.inning - 1] = e.runs
  return out
}

/**
 * The line score as a monospace table inside a code fence, the shape discordRecap.ts uses:
 *
 *         1  2  3  4  5  6  7 │  R   H   E
 *   BOS   2  0  0  1  3  0  0 │  6  11   0
 *   NY    0  0  0  1  0  0  0 │  1   8   2
 *
 * The fence is what holds the columns together — Discord renders proportional text
 * everywhere else. No X for an unplayed final half here: a live game has not reached that
 * question, and every inning shown is one the feed has actually posted a cell for.
 */
function lineScoreBlock(
  game: WpblGame,
  away: WpblTeam,
  home: WpblTeam,
  liveInning: number,
): string {
  // At least the innings that have been played, and at least the one currently on the board:
  // the feed posts a half-inning's cell as it happens, so the current inning may have no cell
  // yet (top of it, nobody scored) and would otherwise be missing from the grid entirely.
  const innings = Math.max(playedInnings(game.away_line, game.home_line), liveInning, 1)
  const aRuns = inningRuns(game.away_line, innings)
  const hRuns = inningRuns(game.home_line, innings)
  const cell = (v: string | number) => String(v).padStart(2)
  const rows = [
    { name: away.abbr || away.id, cells: aRuns, r: game.away_score ?? 0, h: game.away_hits ?? 0, e: game.away_errors ?? 0 },
    { name: home.abbr || home.id, cells: hRuns, r: game.home_score ?? 0, h: game.home_hits ?? 0, e: game.home_errors ?? 0 },
  ]
  const nameW = Math.max(...rows.map(r => r.name.length), 3)
  const header = `${' '.repeat(nameW)}  ${Array.from({ length: innings }, (_, i) => cell(i + 1)).join(' ')} │ ${cell('R')} ${cell('H')} ${cell('E')}`
  const body = rows.map(r =>
    `${r.name.padEnd(nameW)}  ${r.cells.map(cell).join(' ')} │ ${cell(r.r)} ${cell(r.h)} ${cell(r.e)}`)
  return ['```', header, ...body, '```'].join('\n')
}

/** "▲ Top 5", "▼ Bottom 3", or the break label when the side is retired. */
function stateLine(s: ReturnType<typeof deriveSituation>): string {
  if (s.between) return `⏸️ ${s.breakLabel}`
  const arrow = s.half === 'top' ? '▲' : '▼'
  const which = s.half === 'top' ? 'Top' : 'Bottom'
  const outs = `${s.outs} out${s.outs === 1 ? '' : 's'}`
  return `${arrow} ${which} ${ORDINAL(s.inning)} · ${outs} · ${s.balls}-${s.strikes}`
}

/** Bases as a one-line diamond of filled/empty corners, so a phone reader sees who is on. */
function basesLine(s: ReturnType<typeof deriveSituation>): string {
  const named = [
    s.thirdName ? `3B ${s.thirdName}` : null,
    s.secondName ? `2B ${s.secondName}` : null,
    s.firstName ? `1B ${s.firstName}` : null,
  ].filter(Boolean)
  const diamond = `${s.second ? '◆' : '◇'}\n${s.third ? '◆' : '◇'} ${s.first ? '◆' : '◇'}`
  // The glyph diamond reads at a glance; the names spell out who each runner is. Bases empty
  // is a real, common answer, so say it rather than drawing three empty corners with no caption.
  return named.length ? `${diamond}\n${named.join(' · ')}` : `${diamond}\nBases empty`
}

/**
 * The `/score` reply for one in-progress game.
 *
 * Public, like the /player card, so a box score can be shared into the channel. The game is
 * assumed live: the endpoint has already filtered to `status = 'live'` games and handled the
 * none/many cases, so this only has to render one.
 */
export function buildLiveBoxReply(game: WpblGame, away: WpblTeam, home: WpblTeam): DiscordReply {
  const awayName = `${away.city} ${away.name}`.trim() || away.abbr || away.id
  const homeName = `${home.city} ${home.name}`.trim() || home.abbr || home.id
  const awayScore = game.away_score ?? 0
  const homeScore = game.home_score ?? 0

  const state = game.live_state
  const s = state ? deriveSituation(state, away, home, { away: game.away_line, home: game.home_line }) : null
  const liveInning = s?.inning ?? game.live_inning ?? 1
  // The leading side gets the accent stripe; a tie takes the home club's colour rather than none.
  const leader = awayScore > homeScore ? away : home

  const fields: DiscordEmbed['fields'] = []
  if (s) {
    fields.push({ name: 'Situation', value: stateLine(s), inline: false })
    // The at-bat in progress: who is up against whom. Dropped during a break, when both names
    // describe an at-bat that has already finished (see betweenInnings in liveSituation.ts).
    if (!s.between && (s.batterName || s.pitcherName)) {
      fields.push({
        name: 'At bat',
        value: [
          s.batterName ? `🏏 ${s.batterName}` : null,
          s.pitcherName ? `⚾ ${s.pitcherName} pitching` : null,
        ].filter(Boolean).join('\n'),
        inline: true,
      })
    }
    if (!s.between) fields.push({ name: 'On base', value: basesLine(s), inline: true })
  }

  const scoreLine = `**${away.abbr || away.id} ${awayScore}** — **${homeScore} ${home.abbr || home.id}**`
  const description = [scoreLine, '', lineScoreBlock(game, away, home, liveInning)].join('\n')

  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `${awayName} @ ${homeName}`,
      url: `${SITE}/wpbl?game=${game.id}`,
      color: embedColor(leader),
      description,
      ...(fields.length ? { fields } : {}),
      // The league's own timestamp, so a reader can tell a quiet feed from a quiet game — the
      // same reason FeedAge exists on the site. Absolute, because an embed footer cannot tick.
      footer: { text: `WPBL 2026 · live · sportydolphin.fun` },
    }],
  }
}
