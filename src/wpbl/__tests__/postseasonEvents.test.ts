/**
 * The postseason watch-party events reconcile themselves against the feed
 * (scripts/sync-wpbl-discord-postseason.mjs), and one of the things they do is DELETE a
 * scheduled event, taking its RSVP list with it. That rule cannot be exercised by hand
 * without a live bracket and cannot be undone once it fires, so it is pinned here instead:
 * a swept series loses its unplayed game, a series that goes the distance keeps it.
 */
import { describe, it, expect } from 'vitest'
// A plain .mjs cron script, externalised by the vitest config so its shebang survives.
import { planPostseasonSync, parseSlot } from '../../../scripts/sync-wpbl-discord-postseason.mjs'

const CITIES = new Map([['BOS', 'Boston'], ['LA', 'Los Angeles'], ['NY', 'New York'], ['SF', 'San Francisco']])

// The events as they were created: placeholders, hours apart, all still SCHEDULED.
const SLOTS: Array<[string, string]> = [
  ['semi-a-1', 'Semifinal A Game 1'], ['semi-a-2', 'Semifinal A Game 2'], ['semi-a-3', 'Semifinal A Game 3'],
  ['semi-b-1', 'Semifinal B Game 1'], ['semi-b-2', 'Semifinal B Game 2'], ['semi-b-3', 'Semifinal B Game 3'],
  ['final-1', 'Championship Game 1'], ['final-2', 'Championship Game 2'], ['final-3', 'Championship Game 3'],
  ['final-4', 'Championship Game 4'], ['final-5', 'Championship Game 5'],
]
const STARTS: Record<string, string> = {
  'semi-a-1': '2026-09-09T23:00:00Z', 'semi-a-2': '2026-09-11T22:00:00Z', 'semi-a-3': '2026-09-13T19:00:00Z',
  'semi-b-1': '2026-09-10T23:00:00Z', 'semi-b-2': '2026-09-12T23:00:00Z', 'semi-b-3': '2026-09-14T23:00:00Z',
  'final-1': '2026-09-16T23:00:00Z', 'final-2': '2026-09-17T23:00:00Z', 'final-3': '2026-09-19T23:00:00Z',
  'final-4': '2026-09-20T19:00:00Z', 'final-5': '2026-09-22T23:00:00Z',
}
const events = SLOTS.map(([id, name]) => ({ id, name, status: 1, scheduled_start_time: STARTS[id] }))

// 6:00 PM Central is 23:00 UTC in September, which is where the events sit.
function game(
  id: string, date: string, away: string, home: string,
  score?: [number, number], time = '6:00 PM',
) {
  return {
    api_game_id: id, game_date: date, start_time: time, home_team_id: home, away_team_id: away,
    status: score ? 'final' : 'scheduled', game_type: 'postseason', counts_in_standings: false,
    away_score: score?.[0] ?? null, home_score: score?.[1] ?? null,
  }
}

const NOW = Date.parse('2026-09-12T06:00:00Z')   // morning after semifinal A's game 2

function deletions(plan: { actions: Array<{ kind: string; label: string }> }) {
  return plan.actions.filter(a => a.kind === 'delete').map(a => a.label)
}
function names(plan: { actions: Array<{ kind: string; label: string; body?: { name?: string } }> }) {
  return Object.fromEntries(
    plan.actions.filter(a => a.kind === 'patch' && a.body?.name).map(a => [a.label, a.body!.name]),
  )
}

describe('postseason event sync', () => {
  it('reads the round and game number back out of an event name, and ignores everything else', () => {
    expect(parseSlot('Semifinal B Game 2')).toEqual({ roundKey: 'semi-b', game: 2 })
    // The rename keeps the slot in front precisely so a renamed event still parses.
    expect(parseSlot('Championship Game 4: Boston vs Los Angeles')).toEqual({ roundKey: 'final', game: 4 })
    expect(parseSlot('Los Angeles vs New York')).toBeNull()
    expect(parseSlot('Trivia Night')).toBeNull()
  })

  it('deletes the game a swept series will never play, and only that one', () => {
    const games = [
      // Semifinal A: Boston sweeps in two, so game 3 is dead.
      game('a1', '2026-09-09', 'BOS', 'SF', [5, 2]),
      game('a2', '2026-09-11', 'SF', 'BOS', [1, 4], '5:00 PM'),
      game('a3', '2026-09-13', 'BOS', 'SF', undefined, '2:00 PM'),
      // Semifinal B: 1-1, still alive.
      game('b1', '2026-09-10', 'NY', 'LA', [3, 1]),
      game('b2', '2026-09-12', 'LA', 'NY', [6, 2]),
      game('b3', '2026-09-14', 'NY', 'LA'),
    ]
    const plan = planPostseasonSync({ events, games, cities: CITIES, now: NOW })
    expect(deletions(plan)).toEqual(['Semifinal A Game 3'])
  })

  it('leaves a series that goes the distance alone', () => {
    const games = [
      game('a1', '2026-09-09', 'BOS', 'SF', [5, 2]),
      game('a2', '2026-09-11', 'SF', 'BOS', [7, 4], '5:00 PM'),
      game('a3', '2026-09-13', 'BOS', 'SF', undefined, '2:00 PM'),
    ]
    const plan = planPostseasonSync({ events, games, cities: CITIES, now: NOW })
    expect(deletions(plan)).toEqual([])
  })

  it('needs three wins before it will drop a championship game', () => {
    const finals = (scores: Array<[number, number] | undefined>) => [
      game('f1', '2026-09-16', 'BOS', 'LA', scores[0]),
      game('f2', '2026-09-17', 'BOS', 'LA', scores[1]),
      game('f3', '2026-09-19', 'LA', 'BOS', scores[2]),
      game('f4', '2026-09-20', 'LA', 'BOS', scores[3], '2:00 PM'),
      game('f5', '2026-09-22', 'BOS', 'LA', scores[4]),
    ]
    const late = Date.parse('2026-09-21T06:00:00Z')
    const twoOne = planPostseasonSync({
      events, cities: CITIES, now: late,
      games: finals([[4, 1], [2, 5], [3, 6], undefined, undefined]),
    })
    expect(deletions(twoOne)).toEqual([])

    const clinched = planPostseasonSync({
      events, cities: CITIES, now: late,
      games: finals([[4, 1], [2, 5], [1, 7], [2, 8], undefined]),
    })
    expect(deletions(clinched)).toEqual(['Championship Game 5'])
  })

  it('names each event for the clubs the feed has published, away side first', () => {
    const games = [
      game('a1', '2026-09-09', 'BOS', 'SF'),
      game('b1', '2026-09-10', 'NY', 'LA'),
    ]
    const plan = planPostseasonSync({ events, games, cities: CITIES, now: Date.parse('2026-09-08T12:00:00Z') })
    expect(names(plan)['Semifinal A Game 1']).toBe('Semifinal A Game 1: Boston vs San Francisco')
    expect(names(plan)['Semifinal B Game 1']).toBe('Semifinal B Game 1: New York vs Los Angeles')
    // Nothing published for those, so the placeholder stands rather than a guess.
    expect(names(plan)['Semifinal A Game 2']).toBeUndefined()
    expect(names(plan)['Championship Game 1']).toBeUndefined()
  })

  it('fills the championship in from the semifinal winners before the league schedules it', () => {
    const games = [
      game('a1', '2026-09-09', 'BOS', 'SF', [5, 2]),
      game('a2', '2026-09-11', 'SF', 'BOS', [1, 4], '5:00 PM'),
      game('b1', '2026-09-10', 'NY', 'LA', [3, 1]),
      game('b2', '2026-09-12', 'LA', 'NY', [2, 6]),
      // Regular season, to settle which winner is guessed as the host.
      { api_game_id: 'r1', game_date: '2026-08-01', start_time: '6:30 PM', home_team_id: 'NY', away_team_id: 'BOS', status: 'final', game_type: 'regular', counts_in_standings: true, home_score: 1, away_score: 9 },
    ]
    const plan = planPostseasonSync({ events, games, cities: CITIES, now: Date.parse('2026-09-13T06:00:00Z') })
    expect(names(plan)['Championship Game 1']).toBe('Championship Game 1: New York vs Boston')
    expect(names(plan)['Championship Game 5']).toBe('Championship Game 5: New York vs Boston')
  })

  it('follows a rescheduled game and leaves an unchanged one untouched', () => {
    const games = [game('a1', '2026-09-09', 'BOS', 'SF', undefined, '8:00 PM')]   // was 6:00 PM
    const plan = planPostseasonSync({ events, games, cities: CITIES, now: Date.parse('2026-09-08T12:00:00Z') })
    const patch = plan.actions.find((a: { label: string }) => a.label === 'Semifinal A Game 1')
    expect(patch.body.scheduled_start_time).toBe('2026-09-10T01:00:00.000Z')

    const onTime = planPostseasonSync({
      events, cities: CITIES, now: Date.parse('2026-09-08T12:00:00Z'),
      games: [game('a1', '2026-09-09', 'BOS', 'SF')],
    })
    const noMove = onTime.actions.find((a: { label: string }) => a.label === 'Semifinal A Game 1')
    expect(noMove.body.scheduled_start_time).toBeUndefined()
  })

  it('does nothing at all to events that are not bracket slots', () => {
    const plan = planPostseasonSync({
      events: [
        { id: 'x', name: 'Los Angeles vs New York', status: 1, scheduled_start_time: '2026-09-09T23:30:00Z' },
        { id: 'y', name: 'Server movie night', status: 1, scheduled_start_time: '2026-09-13T23:00:00Z' },
      ],
      games: [game('a1', '2026-09-09', 'BOS', 'SF', [9, 0])],
      cities: CITIES,
      now: NOW,
    })
    expect(plan.slots).toHaveLength(0)
    expect(plan.actions).toEqual([])
  })
})
