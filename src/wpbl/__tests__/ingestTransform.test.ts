import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { boxscoreRows, gameRowOf, phantomGameIds, trackingRows } from '../../../supabase/functions/wpbl-ingest/transform'
import { normName } from '../../../supabase/functions/wpbl-ingest/names'

// transform.ts is the ingest's rules with the database taken out, shared by the edge function
// and the spring rehearsal (scripts/rehearse-wpbl-feed.ts). These pin it on the real 2026 feed,
// so a change to a rule shows up here before it shows up as a rehearsal diff in March.

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/feed-2026/${name}`, import.meta.url), 'utf8'))

// Every entry resolves to its own name, so the rows say who they are without a roster.
const byName = {
  resolve: async (feed: { name?: string }) => feed.name ?? null,
  resolveName: (name: string) => name || null,
}

async function rows(file: string, completedAt = '') {
  const box = fixture(file).boxscore
  return boxscoreRows(box, 'g1', '2026-08-01', id => id || null, byName, completedAt, new Set(), normName)
}

describe('boxscoreRows', () => {
  it('makes a final from a played box score, its lines adding up to its totals', async () => {
    const box = fixture('box-regular-final-8-innings.json').boxscore
    const out = await rows('box-regular-final-8-innings.json')
    expect(out.derivedStatus).toBe('final')
    for (const team of box.teams) {
      const mine = out.batting.filter(r => r.team_id === team.id)
      expect(mine.reduce((a, r) => a + Number(r.h), 0)).toBe(Number(team.totals.hits))
      expect(out.gamePatch[`${team.side}_score`]).toBe(Number(team.totals.runs))
    }
    expect(out.plays.length).toBe(box.plays.length)
    // Total bases is ours, not the feed's: one per single, two per double and so on.
    for (const r of out.batting) {
      const h = Number(r.h), d = Number(r.doubles), t = Number(r.triples), hr = Number(r.hr)
      expect(r.tb).toBe(h + d + 2 * t + 3 * hr)
    }
  })

  it('leaves a staged lineup scheduled, with no live state', async () => {
    const out = await rows('box-not-started.json')
    expect(out.derivedStatus).toBe('scheduled')
    expect(out.gamePatch.live_state).toBeNull()
  })

  it('trusts the list’s completed_at over a box score that says it is still going', async () => {
    const box = fixture('box-not-started.json').boxscore
    const out = await boxscoreRows(box, 'g1', null, id => id || null, byName, '2026-09-10T01:51:00Z', new Set(), normName)
    expect(out.derivedStatus).toBe('final')
  })
})

describe('the schedule', () => {
  it('keeps one copy of every game the 2026 list published', () => {
    const { games } = fixture('games.json')
    const phantoms = phantomGameIds(games)
    const kept = games.filter((g: any) => !phantoms.has(g.game_id) && g.home_team_id && g.away_team_id)
    const keys = kept.map((g: any) => {
      const { row } = gameRowOf(g, g.home_team_id, g.away_team_id)
      return `${row.game_date}|${row.start_time}|${row.away_team_id}|${row.home_team_id}`
    })
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('leaves the score off a live game’s list row, so the box score owns it', () => {
    const live = { game_id: 'x', status: 'In Progress - Top of 3rd', scheduled_start: '2026-08-01T18:00:00Z',
      presto_data: { timeZone: 'America/Chicago', score: { home: '2', away: '1' } } }
    expect(gameRowOf(live, 'SF', 'NY').row).not.toHaveProperty('home_score')
    expect(gameRowOf({ ...live, status: 'Final' }, 'SF', 'NY').row.home_score).toBe(2)
  })
})

describe('trackingRows', () => {
  it('drops an event with no activity id, the key it is upserted on', () => {
    expect(trackingRows([{ activity_id: 'a', release_speed: 61.2 }, { release_speed: 60 }], 'g1'))
      .toEqual([expect.objectContaining({ activity_id: 'a', game_id: 'g1', release_speed: 61.2 })])
  })
})
