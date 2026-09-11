import { describe, it, expect } from 'vitest'
// The .mjs cron script imported rather than reimplemented, for the reason wpblDrift.test gives:
// a copy of the rule living here would keep passing while the script it mirrors drifted, which
// is the exact failure this checker exists to catch.
import { findForks } from '../../scripts/check-wpbl-roster-forks.mjs'

// The case this was written for, on Sep 10, 2026: the league published New York's postseason
// box score with Claire O'Sullivan's first name as CATHERINE under a feed id nobody had seen,
// so the ingest inserted a second player and her game went under it. A reader noticed. Nothing
// in the codebase did.

interface Row { id: string; name: string; team_id: string; created_at: string; api_ids: string[] }

const player = (id: string, name: string, team_id: string, over: Partial<Row> = {}): Row =>
  ({ id, name, team_id, created_at: '2026-07-30T06:26:20Z', api_ids: [], ...over })

/** Stands in for the pg client: the first query asks for players, the second for appearances. */
const db = (players: Row[], appearances: { player_id: string; game_id: string }[] = []) => ({
  query: async (sql: string) =>
    ({ rows: /from wpbl_players/.test(sql) ? players : appearances }),
})

const ROSTER = [
  player('sf-1', 'Kelsie Whitmore', 'SF'),
  player('ny-1', "Claire O'Sullivan", 'NY'),
  // Six surnames are shared across the real roster and every pair is split across two clubs.
  // Both of these belong here for that reason: they are what the rule has to stay quiet about.
  player('la-1', "Elodie O'Sullivan", 'LA'),
  player('bos-1', 'Lexi Hastings', 'BOS'),
  player('la-2', 'Genevieve Hastings', 'LA'),
]

describe('a club carrying two of a surname', () => {
  it('says nothing about the roster as it actually stands', async () => {
    expect(await findForks(db(ROSTER))).toEqual([])
  })

  it('does not mind two clubs sharing a surname, which is the ordinary case', async () => {
    const forks = await findForks(db(ROSTER))
    expect(forks.find(f => f.surname === 'osullivan')).toBeUndefined()
    expect(forks.find(f => f.surname === 'hastings')).toBeUndefined()
  })

  it('catches the split that a reader had to catch', async () => {
    const forked = [...ROSTER, player('ny-2', "Catherine O'Sullivan", 'NY', {
      created_at: '2026-09-11T00:32:06Z', api_ids: ['kfli26dz84mtz2rh'],
    })]
    const forks = await findForks(db(forked, [
      // Claire's thirteen games against the new row's one, and never the same game.
      ...Array.from({ length: 13 }, (_, i) => ({ player_id: 'ny-1', game_id: `g${i}` })),
      { player_id: 'ny-2', game_id: 'postseason-1' },
    ]))

    expect(forks).toHaveLength(1)
    expect(forks[0].team).toBe('NY')
    expect(forks[0].players.map(p => p.name).sort())
      .toEqual(["Catherine O'Sullivan", "Claire O'Sullivan"])
    // The three things a person needs to decide, all present.
    expect(forks[0].players.find(p => p.id === 'ny-1')?.games).toBe(13)
    expect(forks[0].players.find(p => p.id === 'ny-2')?.games).toBe(1)
    expect(forks[0].sharedGames).toBe(0)
  })

  it('reports a shared box score, which settles it the other way', async () => {
    // Two real teammates turn up in the same game eventually. A split player never can, because
    // the feed lists one of them per game by construction.
    const twins = [player('ny-1', 'Ana Rivera', 'NY'), player('ny-2', 'Sofia Rivera', 'NY')]
    const forks = await findForks(db(twins, [
      { player_id: 'ny-1', game_id: 'g1' },
      { player_id: 'ny-2', game_id: 'g1' },
    ]))
    expect(forks).toHaveLength(1)
    expect(forks[0].sharedGames).toBe(1)
  })

  it('keeps a compound surname whole', async () => {
    // "Ela Day-Bedard" is one surname, not a given name and a last word. Splitting on the last
    // token would pair her with anybody on her club called Bedard, and worse, would NOT pair a
    // real fork of her, since the feed's copy would split the same wrong way.
    const rows = [
      player('sf-1', 'Ela Day-Bedard', 'SF'),
      player('sf-2', 'Mia Bedard', 'SF'),
    ]
    expect(await findForks(db(rows))).toEqual([])

    const forkOfHer = [rows[0], player('sf-3', 'Elodie Day-Bedard', 'SF')]
    const forks = await findForks(db(forkOfHer))
    expect(forks).toHaveLength(1)
    expect(forks[0].surname).toBe('day bedard')
  })

  it('folds accents and punctuation, so one spelling of a name is not two surnames', async () => {
    const rows = [
      player('ny-1', 'Samaria Benítez', 'NY'),
      player('ny-2', 'Sam Benitez', 'NY'),
    ]
    expect(await findForks(db(rows))).toHaveLength(1)
  })

  it('reports a club with three of a surname once, as one group', async () => {
    const rows = [
      player('ny-1', "Claire O'Sullivan", 'NY'),
      player('ny-2', "Catherine O'Sullivan", 'NY'),
      player('ny-3', "Cate O'Sullivan", 'NY'),
    ]
    const forks = await findForks(db(rows))
    expect(forks).toHaveLength(1)
    expect(forks[0].players).toHaveLength(3)
    // Three-way groups cannot answer the shared-box-score question, and say so rather than
    // guessing which pair it would be about.
    expect(forks[0].sharedGames).toBeNull()
  })
})
