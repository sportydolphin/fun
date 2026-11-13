// Prints the live notes (src/league/liveNotes.ts) of a game or a whole season, from the frozen season
// files in archive/, so it needs no .env:
//
//   npm run notes -- <game id or prefix>      every note of one game, in the order they fired
//   npm run notes -- --season                 per game: notes and public notes, then the top of the season
//   npm run notes -- --season --public        only what readers would see, game by game
//   npm run notes -- ... --bar 55 --cap 4     try another public bar or cap
//   npm run notes -- --kinds                  how many notes of each category and lens
//
// WHY THE BACKTEST. There are no live games until spring 2027, and the public bar decides what every
// reader sees. Replaying 2026 play by play is the only way to see how many notes a game makes, which
// ones would have been shown, and to set PUBLIC_BAR from that rather than by guessing.
import { readFileSync } from 'node:fs'
import type { LiveNote } from '../src/league/liveNotes'
import { wpblLiveNotes } from '../src/wpbl/derive/liveNotes'
import { applyPlayCorrections, type WpblPlayCorrection } from '../src/wpbl/playCorrections'
import type { WpblGame, WpblGamePlay } from '../src/wpbl/types'

const read = <T,>(f: string): T => JSON.parse(readFileSync(`archive/${f}`, 'utf8'))
const games = read<WpblGame[]>('wpbl-2026/wpbl_games.json')
const plays = applyPlayCorrections(read<WpblGamePlay[]>('wpbl-2026/wpbl_game_plays.json'),
  read<WpblPlayCorrection[]>('wpbl-2026/wpbl_play_corrections.json'))
type Line = { game_id: string; player_id: string; team_id: string | null; position?: string | null }
const lines = [...read<Line[]>('wpbl-2026/wpbl_batting_lines.json'), ...read<Line[]>('wpbl-2026/wpbl_pitching_lines.json')]
const players = read<{ id: string; name: string }[]>('wpbl/wpbl_players.json')
const teams = read<{ id: string; city: string | null; name: string }[]>('wpbl/wpbl_teams.json')

const args = process.argv.slice(2)
const flag = (f: string) => args.includes(f)
const num = (f: string) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : undefined }
const id = args.find((a, i) => !a.startsWith('--') && !['--bar', '--cap'].includes(args[i - 1] ?? ''))

const t0 = performance.now()
const notes = wpblLiveNotes({ games, plays, lines, players, teams }, { publicBar: num('--bar'), publicCap: num('--cap') })
const ms = Math.round(performance.now() - t0)
const byId = new Map(games.map(g => [g.id, g]))
const abbr = new Map(teams.map(t => [t.id, t.id]))
const title = (g: WpblGame) => `${g.game_date} ${abbr.get(g.away_team_id)} ${g.away_score}, ${abbr.get(g.home_team_id)} ${g.home_score} (${g.id.slice(0, 8)})`
const line = (n: LiveNote) => [
  n.public ? '★' : n.superseded ? '·' : ' ',
  String(n.score).padStart(3),
  `${n.half === 'top' ? '▲' : n.half === 'bottom' ? '▼' : ' '}${n.inning ?? ''}`.padEnd(4),
  n.category.padEnd(9),
  n.lens.padEnd(13),
  n.text + (n.detail ? `  [${n.detail}]` : ''),
].join(' ')

if (flag('--kinds')) {
  const tally = new Map<string, number>()
  for (const list of notes.values()) for (const n of list) {
    const k = `${n.category} / ${n.lens}`
    tally.set(k, (tally.get(k) ?? 0) + 1)
  }
  for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(6), k)
} else if (flag('--season')) {
  let all = 0, shown = 0
  for (const [gid, list] of notes) {
    const pub = list.filter(n => n.public)
    all += list.length
    shown += pub.length
    console.log(`${title(byId.get(gid)!)}: ${list.length} notes, ${pub.length} public`)
    if (flag('--public')) for (const n of pub) console.log(`   ${line(n)}`)
  }
  console.log(`\n${notes.size} games, ${all} notes (${Math.round(all / notes.size)} a game), ${shown} public (${(shown / notes.size).toFixed(1)} a game), ${ms} ms`)
  if (!flag('--public')) {
    console.log('\nTop 40 of the season:')
    const top = [...notes.values()].flat().filter(n => !n.superseded).sort((a, b) => b.score - a.score).slice(0, 40)
    for (const n of top) console.log(`${byId.get(n.game_id)!.game_date} ${line(n)}`)
  }
} else if (id) {
  const g = games.find(x => x.id.startsWith(id))
  if (!g) throw new Error(`no 2026 WPBL game id starts with ${id}`)
  const list = notes.get(g.id) ?? []
  console.log(`${title(g)}: ${list.length} notes, ${list.filter(n => n.public).length} public (★ public, · replaced)`)
  for (const n of list) console.log(line(n))
} else {
  console.error('usage: npm run notes -- <game id or prefix> | --season [--public] | --kinds [--bar N] [--cap N]')
  process.exit(2)
}
