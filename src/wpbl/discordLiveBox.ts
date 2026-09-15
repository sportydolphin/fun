// The Discord reply for `/score` — a game happening right now, at a glance.
//
// Pure and asset-free, beside discordPlayerCard.ts and for the same reasons: what gets posted
// into a public channel is worth unit testing, and the endpoint that sends it
// (functions/discord/wpbl.ts) can't be imported by a test without a Cloudflare request context.
// Nothing here may reach constants.ts, which pulls the team logos in as Vite assets and fails
// the Functions build; team names are assembled from the plain WpblTeam fields instead.
//
// Deliberately terse: the score, the inning, and who is at bat against whom. The full line
// score and the base diamond were dropped on the reader's ask — a `/score` in a chat channel
// wants the state in a line or two, and the game's own page (linked in the title) carries the
// rest. The live-situation reading is shared with the site through derive/liveSituation.ts so
// the count clamp and the between-innings break stay one definition rather than two that drift.
import { deriveSituation, ORDINAL } from './derive/liveSituation'
import type { WpblGame, WpblTeam } from './types'
import type { DiscordEmbed, DiscordReply } from './discordPlayerCard'

const SITE = 'https://sportydolphin.fun'

/** "#e8412c" → the integer Discord wants for an embed's accent stripe. */
function embedColor(team: WpblTeam | undefined): number | undefined {
  const hex = (team?.color ?? '').replace('#', '').trim()
  if (!/^[0-9a-f]{6}$/i.test(hex)) return undefined
  return parseInt(hex, 16)
}

/**
 * The `/score` reply for one in-progress game.
 *
 * Public, like the /player card, so a score can be shared into the channel. The game is
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
  // The leading side gets the accent stripe; a tie takes the home club's colour rather than none.
  const leader = awayScore > homeScore ? away : home

  const scoreLine = `**${away.abbr || away.id} ${awayScore} — ${homeScore} ${home.abbr || home.id}**`
  // Between half-innings the count, outs and batter all describe an at-bat that has finished
  // (see betweenInnings in liveSituation.ts), so the line collapses to the break itself.
  const inningLine = s
    ? (s.between
      ? s.breakLabel
      : `${s.half === 'top' ? 'Top' : 'Bottom'} ${ORDINAL(s.inning)} · ${s.outs} out${s.outs === 1 ? '' : 's'} · ${s.balls}-${s.strikes}`)
    : 'In progress'
  const description = [scoreLine, inningLine].filter(Boolean).join('\n')

  const fields: DiscordEmbed['fields'] = []
  // Who is at bat against whom, dropped during a break for the reason above.
  if (s && !s.between) {
    if (s.batterName) fields.push({ name: 'At bat', value: s.batterName, inline: true })
    if (s.pitcherName) fields.push({ name: 'Pitching', value: s.pitcherName, inline: true })
  }

  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `${awayName} @ ${homeName}`,
      url: `${SITE}/wpbl?game=${game.id}`,
      color: embedColor(leader),
      description,
      ...(fields.length ? { fields } : {}),
      footer: { text: `WPBL 2026 · live · sportydolphin.fun` },
    }],
  }
}
