import { describe, it, expect } from 'vitest'
import { buildLiveBoxReply } from '../discordLiveBox'
import type { WpblGame, WpblLiveState, WpblTeam } from '../types'

// The /score box score, pinned because both ways it can go wrong are silent in Discord: a count
// the feed publishes between batters ("3-3") drawn straight is a fourth ball on screen, and a
// break state read literally names an at-bat that finished a couple of minutes ago.

const away: WpblTeam = {
  id: 'BOS', city: 'Boston', name: 'Hunters', abbr: 'BOS',
  color: '#0d5c3f', color_secondary: null, logo_url: null, sort_order: 1, api_id: null, created_at: '',
}
const home: WpblTeam = {
  id: 'SF', city: 'San Francisco', name: 'Firebells', abbr: 'SF',
  color: '#e8412c', color_secondary: null, logo_url: null, sort_order: 2, api_id: null, created_at: '',
}

const liveState = (over: Partial<WpblLiveState> = {}): WpblLiveState => ({
  complete: false, inning: 4, half: 'bottom', batting_team_id: 'SF',
  outs: 1, balls: 2, strikes: 1, batter_name: 'Val Perez', pitcher_name: 'Ada Cruz',
  first_base: 'Lin Tanaka', second_base: '', third_base: '',
  bases_occupied: [], bases_loaded: false, away_runs: 3, home_runs: 2,
  ...over,
})

const game = (over: Partial<WpblGame> = {}): WpblGame => ({
  id: 'g1', game_date: '2026-09-05', start_time: null,
  home_team_id: 'SF', away_team_id: 'BOS', venue: null, status: 'live',
  home_score: 2, away_score: 3, innings: 7, notes: null, created_at: '', updated_at: '',
  away_hits: 6, home_hits: 4, away_errors: 0, home_errors: 1,
  away_line: [{ inning: 1, runs: 2 }, { inning: 3, runs: 1 }],
  home_line: [{ inning: 2, runs: 2 }],
  live_state: liveState(),
  ...over,
})

// The feed's live_state carries the league's own spelling of the batter and pitcher, which
// disagrees with the roster; the roster is what gets printed. Val Perez / Ada Cruz are the
// feed spellings in `liveState`; these are the roster rows they must resolve to.
const roster: { name: string; team_id: string }[] = [
  { name: 'Valerie Perez', team_id: 'SF' },   // batting for SF (home) in the fixture
  { name: 'Ada Cruz', team_id: 'BOS' },        // pitching for BOS (away)
  { name: 'Emi Saiki', team_id: 'BOS' },
  { name: "Claire O'Sullivan", team_id: 'BOS' },
  { name: "Elodie O'Sullivan", team_id: 'SF' }, // a same-surname player on the other club
]

const desc = (g: WpblGame) => buildLiveBoxReply(g, away, home, roster).embeds?.[0].description ?? ''
const fields = (g: WpblGame) => buildLiveBoxReply(g, away, home, roster).embeds?.[0].fields ?? []
const field = (g: WpblGame, name: string) => fields(g).find(f => f.name === name)?.value ?? ''

// The output is deliberately spare: score, inning, batter, pitcher. No emoji, no line score,
// no base diamond. This guards against any of those creeping back in.
const EMOJI = /\p{Extended_Pictographic}|[▲▼◆◇]/u

describe('the /score box score', () => {
  it('is a public reply (no ephemeral flag) so it can be shared', () => {
    expect(buildLiveBoxReply(game(), away, home, roster).flags).toBeUndefined()
  })

  it('titles the matchup and links the game page', () => {
    const embed = buildLiveBoxReply(game(), away, home, roster).embeds?.[0]
    expect(embed?.title).toBe('Boston Hunters @ San Francisco Firebells')
    expect(embed?.url).toContain('/wpbl?game=g1')
  })

  it('carries the score and inning, and no line score', () => {
    const d = desc(game())
    expect(d).toContain('BOS 3 — 2 SF')
    expect(d).toContain('Bottom 4th')
    expect(d).not.toContain('```') // no monospace line-score fence
  })

  it('uses no emoji anywhere in the message', () => {
    const embed = buildLiveBoxReply(game(), away, home, roster).embeds?.[0]
    const text = [embed?.title, embed?.description, ...(embed?.fields ?? []).flatMap(f => [f.name, f.value])].join(' ')
    expect(text).not.toMatch(EMOJI)
  })

  it('clamps a count the feed left over from the last at-bat', () => {
    // Between batters the feed republishes the previous strikeout's full count.
    expect(desc(game({ live_state: liveState({ balls: 3, strikes: 3 }) }))).toContain('3-2')
  })

  it('prints the roster spelling of the batter and pitcher, never the feed prose', () => {
    // Feed sends "Val Perez"; the roster says "Valerie Perez", and that is what ships.
    expect(field(game(), 'At bat')).toBe('Valerie Perez')
    expect(field(game(), 'Pitching')).toBe('Ada Cruz')
  })

  it('corrects a misspelled feed name to the roster (Emi Saki → Emi Saiki)', () => {
    const g = game({ live_state: liveState({ pitcher_name: 'Emi Saki' }) })
    expect(field(g, 'Pitching')).toBe('Emi Saiki')
  })

  it('resolves a shared surname by first name, never to the other club (Claire vs Elodie)', () => {
    // A slightly-off first name on the pitching club still lands on Claire, not Elodie.
    const g = game({ live_state: liveState({ pitcher_name: "Clare O'Sullivan" }) })
    expect(field(g, 'Pitching')).toBe("Claire O'Sullivan")
  })

  it('leaves a name it cannot place exactly as the feed sent it', () => {
    const g = game({ live_state: liveState({ batter_name: 'Someone Unknown' }) })
    expect(field(g, 'At bat')).toBe('Someone Unknown')
  })

  it('lists who is on base, third to first, in the roster spelling', () => {
    const g = game({ live_state: liveState({ first_base: 'Val Perez', third_base: "Clare O'Sullivan" }) })
    expect(field(g, 'On base')).toBe("3B Claire O'Sullivan\n1B Valerie Perez")
  })

  it('says the bases are empty rather than leaving the field blank', () => {
    const g = game({ live_state: liveState({ first_base: '', second_base: '', third_base: '' }) })
    expect(field(g, 'On base')).toBe('Bases empty')
  })

  it('falls back to "runner on" for a base occupied without a named runner', () => {
    const g = game({ live_state: liveState({ first_base: '', second_base: ' ', third_base: '' }) })
    expect(field(g, 'On base')).toBe('2B runner on')
  })

  it('drops the at-bat between innings and says which break it is', () => {
    // Nobody out, no count, bases empty, batting side scoreless this inning: a break.
    const g = game({
      live_state: liveState({ outs: 0, balls: 0, strikes: 0, first_base: '' }),
      home_line: [{ inning: 2, runs: 2 }],
    })
    expect(desc(g)).toContain('Middle of the 4th')
    expect(fields(g)).toHaveLength(0)
  })

  it('renders without a situation when live_state is absent', () => {
    const g = game({ live_state: null })
    expect(fields(g)).toHaveLength(0)
    expect(desc(g)).toContain('In progress')
  })
})
