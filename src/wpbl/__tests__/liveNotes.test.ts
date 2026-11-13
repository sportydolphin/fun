import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIRST_KINDS, findFirsts } from '../../league/firsts'
import { plateAppearanceLines } from '../../league/inningLines'
import { PUBLIC_BAR, PUBLIC_CAP, type LiveNote } from '../../league/liveNotes'
import { wpblLiveNotes, readWpblPlay } from '../derive/liveNotes'
import { WPBL_LEAGUE } from '../league'
import { applyPlayCorrections, type WpblPlayCorrection } from '../playCorrections'
import type { WpblGame, WpblGamePlay } from '../types'

// Every 2026 game, from the frozen season files in archive/ (in git, so no .env).
const DIR = join(__dirname, '..', '..', '..', 'archive')
const read = <T,>(f: string): T => JSON.parse(readFileSync(join(DIR, f), 'utf8'))
const games = read<WpblGame[]>('wpbl-2026/wpbl_games.json')
const plays = applyPlayCorrections(read<WpblGamePlay[]>('wpbl-2026/wpbl_game_plays.json'),
  read<WpblPlayCorrection[]>('wpbl-2026/wpbl_play_corrections.json'))
type Line = { game_id: string; player_id: string; team_id: string | null; position?: string | null }
const lines = [...read<Line[]>('wpbl-2026/wpbl_batting_lines.json'), ...read<Line[]>('wpbl-2026/wpbl_pitching_lines.json')]
const players = read<{ id: string; name: string }[]>('wpbl/wpbl_players.json')
const teams = read<{ id: string; city: string | null; name: string }[]>('wpbl/wpbl_teams.json')

const input = { games, plays, lines, players, teams }
const notes = wpblLiveNotes(input)
const all = [...notes.values()].flat()
const when = (g: WpblGame) => `${g.game_date} ${g.start_time ?? ''}`
const order = new Map([...games].sort((a, b) => (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : a.id < b.id ? -1 : 1)).map((g, i) => [g.id, i]))

describe('live notes: the 2026 season replayed', () => {
  it('walks every game with plays', () => {
    expect(notes.size).toBe(new Set(plays.map(p => p.game_id)).size)
    expect(all.length).toBeGreaterThan(1000)
  })

  // The notes count with the same kinds and tests the firsts do, so the two cannot disagree about
  // which play was the league's first of anything.
  it("puts each league first on the play Find's firsts name", () => {
    const pas = plateAppearanceLines(WPBL_LEAGUE, plays, games)
    const firsts = findFirsts(pas, games, FIRST_KINDS.map(k => k.kind), when, plays)
    expect(firsts.length).toBeGreaterThan(20)
    for (const f of firsts) {
      const n = all.find(x => x.lens === 'league' && x.kind === f.kind && x.nth === 1)
      expect(n, f.kind).toBeDefined()
      expect([n!.game_id, n!.sequence], f.kind).toEqual([f.game_id, f.sequence])
    }
  })

  it('names each note once', () => {
    for (const [gid, list] of notes) {
      const keys = list.map(n => n.key)
      expect(new Set(keys).size, gid).toBe(keys.length)
    }
  })

  it('cites only plays from before the note', () => {
    for (const n of all) {
      for (const b of n.before) {
        const earlierGame = order.get(b.game_id)! < order.get(n.game_id)!
        const earlierPlay = b.game_id === n.game_id && b.sequence != null && n.sequence != null && b.sequence < n.sequence
        expect(earlierGame || earlierPlay, `${n.key} cites ${b.game_id}|${b.sequence}`).toBe(true)
      }
    }
  })

  it('writes plain text', () => {
    for (const n of all) {
      const text = `${n.text} ${n.detail ?? ''}`
      expect(text, n.key).not.toMatch(/undefined|NaN|null|Unknown|—/)
      expect(n.score).toBeGreaterThanOrEqual(0)
      expect(n.score).toBeLessThanOrEqual(100)
    }
  })

  it('shows readers only the top few, never a replaced note', () => {
    for (const list of notes.values()) {
      const shown = list.filter(n => n.public)
      expect(shown.length).toBeLessThanOrEqual(PUBLIC_CAP)
      for (const n of shown) {
        expect(n.score).toBeGreaterThanOrEqual(PUBLIC_BAR)
        expect(n.superseded).toBe(false)
      }
    }
  })

  it('knows the season by its known moments', () => {
    const text = (id: string) => (notes.get(games.find(g => g.id.startsWith(id))!.id) ?? []).map(n => n.text)
    expect(text('42a5249c')).toContain('First walk-off in WPBL history')
    // The only one-pitcher staff and the only zero on a scoreboard in 2026 were both the final day.
    expect(text('cfa6c463')).toEqual(expect.arrayContaining(['First complete game in WPBL history', 'First shutout in WPBL history']))
    expect(all.filter(n => n.text === 'First shutout in WPBL history')).toHaveLength(1)
    expect(all.some(n => n.kind.startsWith('dp:') && n.lens === 'crew')).toBe(true)
    expect(all.some(n => n.kind.startsWith('ofa:') && n.lens === 'league')).toBe(true)
  })

  // A live game is the same walk with fewer plays: whatever a page showed mid-game, the finished
  // game shows too, on the same play. Streaks of plate appearances in a row are the exception, since
  // a run still going is only marked where the log stops.
  it('says the same thing live as after the final', () => {
    const finals = games.filter(g => g.status === 'final')
    for (const g of [finals[3], finals[17], finals[33]]) {
      const rows = plays.filter(p => p.game_id === g.id)
      const cut = rows[Math.floor(rows.length / 2)].sequence
      const live = wpblLiveNotes({
        ...input,
        games: games.map(x => (x.id === g.id ? { ...x, status: 'live' } : x)),
        plays: plays.filter(p => p.game_id !== g.id || p.sequence <= cut),
      }).get(g.id)!
      const done = new Map(notes.get(g.id)!.map(n => [n.key, n]))
      const comparable = (n: LiveNote) => n.category !== 'streak' && !n.kind.endsWith('walkoff') && n.lens !== 'game'
      expect(live.filter(comparable).length).toBeGreaterThan(5)
      for (const n of live.filter(comparable)) {
        expect(done.get(n.key)?.sequence, `${g.id.slice(0, 8)} ${n.key}`).toBe(n.sequence)
      }
    }
  })
})

describe('readWpblPlay', () => {
  it('reads double plays, throw chains and errors off the scorer\'s words', () => {
    expect(readWpblPlay('Andreanne Leblanc grounded into double play 2b to ss to 1b (1-2 BKK); Ayaka Yamamoto out on the play.'))
      .toEqual({ chains: [{ what: 'dp', base: null, chain: ['2b', 'ss', '1b'], how: null }], errors: [] })
    expect(readWpblPlay('Hyeonah Kim out at second c to ss to 3b to 2b, picked off.').chains)
      .toEqual([{ what: 'out', base: 'second', chain: ['c', 'ss', '3b', '2b'], how: 'pk' }])
    expect(readWpblPlay('Elodie Ciamarro out at second c to ss, caught stealing.').chains[0].how).toBe('cs')
    expect(readWpblPlay('Jua Park singled to left field, RBI (0-1 K); Skylar Kaplan advanced to third, out at home lf to 3b to c; Andreanne Leblanc scored.').chains)
      .toEqual([{ what: 'out', base: 'home', chain: ['lf', '3b', 'c'], how: null }])
    expect(readWpblPlay('Mo\'ne Davis reached first on an error by cf (0-1 K).').errors).toEqual(['cf'])
  })
})
