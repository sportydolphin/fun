import { describe, expect, it } from 'vitest'
import { parsePlayerQuestion, type RosterPlayer } from '../playerQuestion'
import { playerQuestionRows } from '../../finderSearch'
import { WPBL_FINDER_CLUBS, WPBL_FINDER_OPTS, WPBL_FINDER_SIDES } from '../../wpbl/finderLink'

// A name in a Find question. Before this, "Whitmore 2-hit games" asked everyone's two-hit games and
// said "not used: whitmore", and "Sato vs hunters" looked for a player called Hunters.

const ROSTER: RosterPlayer[] = [
  { id: 'kw', name: 'Kelsie Whitmore', hits: true, pitches: true },
  { id: 'as', name: 'Ayami Sato', hits: false, pitches: true },
  { id: 'ms', name: 'Mio Sato', hits: true, pitches: false },
  { id: 'jl', name: 'Jaida Lee', hits: true, pitches: false },
  { id: 'sc', name: 'Alli Schroder', hits: false, pitches: true },
]
const ask = (text: string) => parsePlayerQuestion(text, ROSTER, WPBL_FINDER_CLUBS, WPBL_FINDER_SIDES, WPBL_FINDER_OPTS)

describe('a Find question naming players', () => {
  it('reads a player and a club as their games and their season against it', () => {
    const r = ask('Ayami Sato vs hunters')
    expect(r.map(q => [q.kind, q.side, q.per, q.oppId, q.playerId])).toEqual([
      ['club', 'pitching', 'game', 'BOS', 'as'], ['club', 'pitching', 'season', 'BOS', 'as'],
    ])
    expect(ask('jaida lee at boston')[0]).toMatchObject({ side: 'hitting', oppId: 'BOS', venue: 'away' })
    expect(ask('lee at home')[0]).toMatchObject({ side: 'hitting', venue: 'home', playerId: 'jl' })
  })

  it('offers every player a shared surname could mean, each on the side they play', () => {
    const r = ask('sato vs boston')
    expect(r.map(q => [q.playerId, q.side])).toEqual([['as', 'pitching'], ['as', 'pitching'], ['ms', 'hitting'], ['ms', 'hitting']])
  })

  it('reads a batter and a pitcher as their plate appearances, whichever is named first', () => {
    expect(ask('jaida lee vs alli schroder')).toEqual([expect.objectContaining({ kind: 'matchup', per: 'pa', batterId: 'jl', pitcherId: 'sc', conditions: [] })])
    expect(ask('schroder vs lee')[0]).toMatchObject({ batterId: 'jl', pitcherId: 'sc' })
    expect(ask('lee off schroder')[0]).toMatchObject({ batterId: 'jl', pitcherId: 'sc' })
    // A two-way player named first is the batter.
    expect(ask('whitmore facing schroder')[0]).toMatchObject({ batterId: 'kw', pitcherId: 'sc' })
    // Two pitchers face nobody.
    expect(ask('ayami sato vs schroder')).toEqual([])
  })

  it('asks a stat of the matchup at the plate appearance', () => {
    const r = ask('lee home runs off schroder')
    expect(r[0]).toMatchObject({ kind: 'matchup', batterId: 'jl', pitcherId: 'sc', conditions: [{ field: 'hr', op: 'gte', value: 1 }] })
  })

  it('asks a stat question of one player, on the side they play', () => {
    expect(ask('jaida lee 3 hit games')[0]).toMatchObject({ kind: 'player', side: 'hitting', per: 'game', playerId: 'jl', conditions: [{ field: 'h', op: 'gte', value: 3 }] })
    expect(ask('schroder 3 strikeouts in an inning')[0]).toMatchObject({ side: 'pitching', per: 'inning', playerId: 'sc' })
    // A plate appearance names its batter instead.
    expect(ask('lee home runs on 0-2')[0]).toMatchObject({ per: 'pa', batterId: 'jl', playerId: null })
    expect(ask("lee's 3 hit games")[0]).toMatchObject({ playerId: 'jl' })
  })

  it('leaves a plain name, a name and a stat word, and words that only look like names alone', () => {
    expect(ask('jaida lee')).toEqual([])
    expect(ask('lee hr')).toEqual([])
    expect(ask('5 strikeouts no walks')).toEqual([])
    expect(ask('boston hunters')).toEqual([])
  })

  it('says the question as a row with its link', () => {
    const rows = playerQuestionRows('wpbl', 'Ayami Sato vs hunters', ROSTER, id => ({ BOS: 'Hunters' } as Record<string, string>)[id] ?? id)
    expect(rows[0]).toMatchObject({ title: 'Ayami Sato vs Hunters', subtitle: 'Pitching lines', matchup: false })
    expect(rows[0].href).toBe('/wpbl/stats?board=find&side=pitching&opp=BOS&by=as')
    const m = playerQuestionRows('wpbl', 'lee vs schroder', ROSTER, id => id)
    expect(m[0]).toMatchObject({ title: 'Jaida Lee vs Alli Schroder', matchup: true })
    expect(m[0].href).toContain('bat=jl&pit=sc')
    expect(playerQuestionRows('mlb', 'lee vs schroder', ROSTER, id => id)).toEqual([])
  })
})

describe('a two-way player', () => {
  const twoWay: RosterPlayer[] = [
    { id: 'p', name: 'Pat Mora', hits: true, pitches: true, lean: 'pitching' },
    { id: 'h', name: 'Hana Cole', hits: true, pitches: true, lean: 'hitting' },
  ]
  const read = (text: string) => parsePlayerQuestion(text, twoWay, WPBL_FINDER_CLUBS, WPBL_FINDER_SIDES, WPBL_FINDER_OPTS)
  it('is asked on the side they play most first', () => {
    expect(read('mora vs boston').map(q => q.side)).toEqual(['pitching', 'pitching', 'hitting', 'hitting'])
    expect(read('mora vs cole')[0]).toMatchObject({ batterId: 'h', pitcherId: 'p' })
    expect(read('cole vs mora')[0]).toMatchObject({ batterId: 'h', pitcherId: 'p' })
  })
})
