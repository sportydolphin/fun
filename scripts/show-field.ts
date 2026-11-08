// Prints a game's live-field timeline as text, one frame a line, to read against the
// play-by-play: `npm run field -- mlb <gamePk>` or `npm run field -- wpbl <game id or prefix>`.
//
// WHY A TERMINAL VIEW AND NOT A DEV PAGE. The drawing waits for the redesign, and a page now
// would be a second Game Center to keep in step with it. Reading frames against the league's own
// play-by-play is the check this is for, and text does that with nothing in the app to touch.
// WPBL reads the frozen season in archive/, so it needs no .env; MLB reads StatsAPI live.
import { readFileSync } from 'node:fs'
import { type FieldTimeline } from '../src/league/liveField'
import { buildMlbTimeline, type MlbLiveFeed } from '../src/mlb/liveField'
import { buildWpblTimeline } from '../src/wpbl/liveField'
import { applyPlayCorrections, type WpblPlayCorrection } from '../src/wpbl/playCorrections'
import type { WpblGame, WpblGamePlay } from '../src/wpbl/types'

async function mlb(pk: string): Promise<FieldTimeline> {
  const r = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${pk}/feed/live`)
  if (!r.ok) throw new Error(`StatsAPI ${r.status} for ${pk}`)
  return buildMlbTimeline((await r.json()) as MlbLiveFeed)
}

function wpbl(prefix: string): FieldTimeline {
  const read = <T,>(f: string): T => JSON.parse(readFileSync(`archive/${f}`, 'utf8'))
  const game = read<WpblGame[]>('wpbl-2026/wpbl_games.json').find(g => g.id.startsWith(prefix))
  if (!game) throw new Error(`no 2026 WPBL game id starts with ${prefix}`)
  const plays = applyPlayCorrections(
    read<WpblGamePlay[]>('wpbl-2026/wpbl_game_plays.json').filter(p => p.game_id === game.id),
    read<WpblPlayCorrection[]>('wpbl-2026/wpbl_play_corrections.json'),
  )
  const mine = <T extends { game_id: string }>(f: string) => read<T[]>(f).filter(l => l.game_id === game.id)
  return buildWpblTimeline({
    game,
    plays,
    battingLines: mine('wpbl-2026/wpbl_batting_lines.json'),
    pitchingLines: mine('wpbl-2026/wpbl_pitching_lines.json'),
    players: read('wpbl/wpbl_players.json'),
  })
}

const [league, id] = process.argv.slice(2)
if ((league !== 'mlb' && league !== 'wpbl') || !id) {
  console.error('usage: npm run field -- mlb <gamePk> | wpbl <game id or prefix>')
  process.exit(2)
}
const t = league === 'mlb' ? await mlb(id) : wpbl(id)
const last = (pid: string | null) => (pid ? (t.players[pid] ?? pid).split(' ').slice(-1)[0] : '·')
const BASE = ['home', '1st', '2nd', '3rd', 'scored']

console.log(`${t.awayTeam} at ${t.homeTeam}, ${t.frames.length} frames${t.final ? ', final' : ''}`)
for (const f of t.frames) {
  const bases = [f.bases[1], f.bases[2], f.bases[3]].map(last).join(' ').padEnd(26)
  const moves = f.moves.map(m =>
    `${last(m.runner)} ${m.out ? `out${m.outAt ? ` at ${BASE[m.outAt]}` : ''}` : `${BASE[m.from]}→${BASE[m.to ?? 0]}`}${m.inferred ? '?' : ''}`)
  const pitch = f.pitch ? `${f.pitch.call}${f.pitch.speed ? ` ${f.pitch.speed}` : ''}` : ''
  console.log([
    String(f.index).padStart(4),
    `${f.half === 'top' ? '▲' : '▼'}${f.inning}`.padEnd(4),
    `${f.outs} out`,
    `${f.balls}-${f.strikes}`,
    `${f.away}-${f.home}`.padEnd(6),
    bases,
    f.kind.padEnd(13),
    (f.result ? `${f.result}: ${f.description}` : pitch || f.description).slice(0, 70).padEnd(70),
    moves.join(', '),
    f.gap ? '[no account]' : '',
  ].join('  '))
}
