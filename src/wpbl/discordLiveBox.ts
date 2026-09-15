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
import { canonicalFeedName } from './feedNames'
import type { WpblGame, WpblPlayer, WpblTeam } from './types'
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
 *
 * `roster` is REQUIRED, not optional, and that is the whole fix for the misspelled names. The
 * feed's `live_state` is prose: `batter_name` and `pitcher_name` are the league's own spelling,
 * which disagrees with the roster on a growing list of real players ("Emi Saki" for Emi Saiki,
 * "Val Perez" for Valerie Perez — see feedNames.ts). Every other surface on the site runs those
 * names through `canonicalFeedName` and this one shipped without it, so the feed's typos reached
 * the channel raw. Threading the roster through here and correcting inside the builder means no
 * caller can reintroduce that: a `/score` with no roster does not type-check. It resolves only
 * within the two clubs playing, so two players who share a surname across clubs (Claire and
 * Elodie O'Sullivan) can never be confused for each other.
 */
export function buildLiveBoxReply(
  game: WpblGame,
  away: WpblTeam,
  home: WpblTeam,
  roster: readonly Pick<WpblPlayer, 'name' | 'team_id'>[],
): DiscordReply {
  // The correction pool is the two clubs on the field. `canonicalFeedName` rewrites only on a
  // unique match and returns the feed's own spelling otherwise, so a name it cannot place is
  // left exactly as it would have been — never guessed at.
  const pool = roster.filter(p => p.team_id === away.id || p.team_id === home.id)
  const canon = (name: string | null): string | null =>
    name ? canonicalFeedName(name, pool.length ? pool : roster) : name
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
  // Who is at bat against whom, dropped during a break for the reason above. Names corrected to
  // the roster's spelling, so the feed's prose typos never reach the channel.
  if (s && !s.between) {
    const batter = canon(s.batterName)
    const pitcher = canon(s.pitcherName)
    if (batter) fields.push({ name: 'At bat', value: batter, inline: true })
    if (pitcher) fields.push({ name: 'Pitching', value: pitcher, inline: true })
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
