// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { defaultQueue, gameQueue, resolveQueue } from '../watch/queue'
import { resetHideScores, setHideScores } from '../watch/hideScores'
import { wpblVideoCard } from '../ogCard'
import { homersWithoutClips } from '../AdminClips'
import { markWatched, resetProgressCache, resumeAt, saveProgress, watchedShare } from '../watch/progress'
import { formatDuration, formatViews, MORE_GROUPS, watchShelves } from '../videoChannels'
import { clipEvents, clipsOfEvent, clipsOfPlayer, continueWatching, eventLabel, featuredVideo, FEATURED_VIDEO_ID, playersWithClips, splitClips } from '../watch/shelves'
import { bestGameFacts, bestGames, biggestPlays } from '../watch/rankings'
import { wpblAppOwnsPath, wpblViewFromPath, wpblWatchVideoIdFromPath, wpblWatchVideoPath, isWpblWatchPage } from '../routes'
import { classifyFan, parseIsoDuration, refineKind, settleIsShort } from '../../../scripts/sync-wpbl-youtube.mjs'
import type { WpblGame, WpblRunValuePlay, WpblVideo, WpblVideoTag } from '../types'

const video = (video_id: string, over: Partial<WpblVideo> = {}): WpblVideo => ({
  video_id, channel_id: 'x', title: video_id, published_at: '2026-09-01T00:00:00Z', thumbnail_url: null,
  kind: 'other', game_id: null, is_short: false, ...over,
})

describe('the video route', () => {
  it('reads an id of the exact shape and nothing else', () => {
    expect(wpblWatchVideoIdFromPath('/wpbl/watch/m4GsxVjMhEY')).toBe('m4GsxVjMhEY')
    expect(wpblWatchVideoIdFromPath('/wpbl/watch/m4GsxVjMhEY/')).toBe('m4GsxVjMhEY')
    expect(wpblWatchVideoIdFromPath('/wpbl/watch')).toBeNull()
    expect(wpblWatchVideoIdFromPath('/wpbl/watch/short')).toBeNull()
    expect(wpblWatchVideoIdFromPath('/wpbl/watch/m4GsxVjMhEY/more')).toBeNull()
    expect(wpblWatchVideoPath('m4GsxVjMhEY')).toBe('/wpbl/watch/m4GsxVjMhEY')
  })

  it('is a page of its own and not the shelf or a tab', () => {
    expect(isWpblWatchPage('/wpbl/watch/m4GsxVjMhEY')).toBe(false)
    expect(wpblViewFromPath('/wpbl/watch/m4GsxVjMhEY')).toBeNull()
    expect(wpblAppOwnsPath('/wpbl/watch/m4GsxVjMhEY')).toBe(false)
  })

  it('has its wildcard behind the shelf rule and a function standing in front of it', () => {
    const redirects = readFileSync('public/_redirects', 'utf8')
    expect(redirects).toMatch(/^\/wpbl\/watch\/\*\s+\/\s+200\s*$/m)
    // The trailing-slash 301 must stay above the wildcard, which would otherwise swallow it.
    expect(redirects.indexOf('/wpbl/watch/     /wpbl/watch')).toBeLessThan(redirects.indexOf('/wpbl/watch/*'))
    const edge = readFileSync('functions/wpbl/index.ts', 'utf8')
    expect(edge).toContain('wpblWatchVideoIdFromPath(url.pathname)')
    expect(edge).toMatch(/if \(!row\) return notFound\(context\)/)
  })
})

describe('defaultQueue', () => {
  it('plays every Short, newest first, from a Short', () => {
    const list = [video('c1', { is_short: true }), video('r1', { kind: 'highlight', game_id: 'g1' }), video('c2', { is_short: true })]
    expect(defaultQueue(list[0], list)).toEqual(['c1', 'c2'])
  })

  it('puts a game\'s other videos right behind this one, then the same kind from other games', () => {
    const list = [
      video('r3', { kind: 'highlight', game_id: 'g3' }),
      video('r2', { kind: 'highlight', game_id: 'g2' }),
      video('c2', { kind: 'condensed', game_id: 'g2' }),
      video('r1', { kind: 'highlight', game_id: 'g1' }),
      video('c1', { kind: 'condensed', game_id: 'g1' }),
    ]
    expect(defaultQueue(list[1], list)).toEqual(['r3', 'r2', 'c2', 'r1'])
  })

  it('stays in its own group for a video with no game', () => {
    const list = [video('p1', { kind: 'podcast' }), video('t1', { kind: 'compilation' }), video('p2', { kind: 'podcast' })]
    expect(defaultQueue(list[2], list)).toEqual(['p1', 'p2'])
  })
})

describe('resolveQueue', () => {
  const list = [video('a', { is_short: true }), video('b', { is_short: true }), video('c', { is_short: true })]

  it('takes the shelf\'s list when it holds the video', () => {
    expect(resolveQueue(list[0], list, ['c', 'a']).map(v => v.video_id)).toEqual(['c', 'a'])
  })

  it('ignores a stale list, and drops ids this reader cannot play', () => {
    expect(resolveQueue(list[0], list, ['x', 'y']).map(v => v.video_id)).toEqual(['a', 'b', 'c'])
    expect(resolveQueue(list[0], list, ['a', 'blocked', 'b']).map(v => v.video_id)).toEqual(['a', 'b'])
  })
})

describe('the More shelf', () => {
  // A game reel with no game was on no group: the chip counted it and the shelf never drew it.
  it('draws every video the chip counts', () => {
    const list = (['highlight', 'compilation', 'podcast', 'press', 'other', 'full_game', 'condensed'] as const)
      .map(kind => video(kind, { kind }))
    const { more } = watchShelves(list)
    const drawn = MORE_GROUPS.flatMap(g => more.filter(g.test))
    expect(drawn).toHaveLength(more.length)
    expect(new Set(drawn).size).toBe(more.length)
  })
})

describe('progress', () => {
  beforeEach(() => { localStorage.clear(); resetProgressCache() })

  it('resumes from where the reader stopped', () => {
    saveProgress('v', 120, 600)
    expect(resumeAt('v')).toBe(120)
    expect(watchedShare('v')).toBeCloseTo(0.2)
  })

  it('starts over when barely begun or finished', () => {
    saveProgress('v', 10, 600)
    expect(resumeAt('v')).toBe(0)
    saveProgress('w', 590, 600)
    expect(resumeAt('w')).toBe(0)
    expect(watchedShare('w')).toBe(1)
  })

  it('keeps a finished video finished through a rewatch', () => {
    markWatched('v', 600)
    saveProgress('v', 30, 600)
    expect(watchedShare('v')).toBe(1)
  })

  it('survives a store that holds rubbish', () => {
    localStorage.setItem('sdWatchProgress', 'not json')
    resetProgressCache()
    expect(watchedShare('v')).toBe(0)
    expect(resumeAt('v')).toBe(0)
  })

  it('ignores a player that has not read its length yet', () => {
    saveProgress('v', 0, 0)
    expect(watchedShare('v')).toBe(0)
  })
})

describe('the formats', () => {
  it('writes a length', () => {
    expect(formatDuration(522)).toBe('8:42')
    expect(formatDuration(7805)).toBe('2:10:05')
    expect(formatDuration(59)).toBe('0:59')
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(0)).toBeNull()
  })

  it('writes a view count', () => {
    expect(formatViews(1)).toBe('1 view')
    expect(formatViews(950)).toBe('950 views')
    expect(formatViews(1000)).toBe('1K views')
    expect(formatViews(1250)).toBe('1.3K views')
    expect(formatViews(23400)).toBe('23K views')
    expect(formatViews(2_100_000)).toBe('2.1M views')
    expect(formatViews(null)).toBeNull()
  })
})

describe('the sync', () => {
  it('reads an ISO length', () => {
    expect(parseIsoDuration('PT8M42S')).toBe(522)
    expect(parseIsoDuration('PT2H10M5S')).toBe(7805)
    expect(parseIsoDuration('PT45S')).toBe(45)
    expect(parseIsoDuration('P0D')).toBeNull()
    expect(parseIsoDuration(undefined)).toBeNull()
  })

  it('settles an unknown as landscape only past the longest Short, and never overrules a probe', () => {
    expect(settleIsShort(null, 181)).toBe(false)
    expect(settleIsShort(null, 180)).toBeNull()
    expect(settleIsShort(null, null)).toBeNull()
    expect(settleIsShort(true, 900)).toBe(true)
    expect(settleIsShort(false, 30)).toBe(false)
  })

  it('files the fan channel\'s season reels as compilations', () => {
    for (const t of ['Top 10 Plays of the WPBL Season!', 'All 7 Grand Slams from the WPBL Season!', 'The Only 2 Triples from the WPBL Season', 'The Entire WPBL Season in 19 Minutes', 'All 13 Home Runs by Denae Benites This Season']) {
      expect(classifyFan(t)).toBe('compilation')
    }
    expect(classifyFan("WPBL Players' Weirdest Superstitions")).toBe('other')
  })

  it('files the league\'s season reels as compilations, landscape only', () => {
    for (const t of ['All 7 Grand Slams from the WPBL Season!', 'The Only 2 Triples from the WPBL Season', 'The Entire WPBL Season in 19 Minutes', 'All 13 Home Runs by Denae Benites This Season']) {
      expect(refineKind('other', t, false)).toBe('compilation')
      expect(refineKind('other', t, true)).toBe('other')
      expect(refineKind('other', t, null)).toBe('other')
    }
    expect(refineKind('other', "Ashton Lansdell's first WPBL home run!", false)).toBe('other')
  })
})

describe('the front page', () => {
  const NOW = Date.parse('2026-11-01T00:00:00Z')
  const pinned = video(FEATURED_VIDEO_ID, { kind: 'compilation', published_at: '2026-10-06T00:00:00Z' })
  const oldReel = video('reel', { kind: 'highlight', game_id: 'g', published_at: '2026-09-23T00:00:00Z' })

  it('features the season reel, and last night\'s reel while there is one', () => {
    expect(featuredVideo([oldReel, pinned], NOW)?.video_id).toBe(FEATURED_VIDEO_ID)
    const fresh = video('fresh', { kind: 'highlight', game_id: 'g', published_at: '2026-10-31T00:00:00Z' })
    expect(featuredVideo([fresh, oldReel, pinned], NOW)?.video_id).toBe('fresh')
  })

  it('falls down the chain when the pinned video is not in this reader\'s list', () => {
    const other = video('top', { kind: 'compilation' })
    expect(featuredVideo([oldReel, other], NOW)?.video_id).toBe('top')
    expect(featuredVideo([oldReel], NOW)?.video_id).toBe('reel')
    expect(featuredVideo([video('s', { is_short: true })], NOW)).toBeNull()
    expect(featuredVideo([], NOW)).toBeNull()
  })

  it('splits every Short onto exactly one side, by whether a tag places it in a game', () => {
    const clips = [video('a', { is_short: true }), video('b', { is_short: true }), video('c', { is_short: true })]
    const tag = (video_id: string, game_id: string | null) => ({ video_id, game_id, play_sequence: null, inning: null, half: null, team_id: null, player_ids: [], method: 'game' as const })
    const { plays, rest } = splitClips(clips, new Map([['a', tag('a', 'g')], ['b', tag('b', null)]]))
    expect(plays.map(v => v.video_id)).toEqual(['a'])
    expect(rest.map(v => v.video_id)).toEqual(['b', 'c'])
  })

  it('offers only what this reader can still play, in the order they watched it, and no Shorts', () => {
    const list = [video('a'), video('b'), video('s', { is_short: true })]
    expect(continueWatching(list, ['b', 'gone', 's', 'a']).map(v => v.video_id)).toEqual(['b', 'a'])
  })
})

describe('the ranked rows', () => {
  const tag = (video_id: string, over: Partial<WpblVideoTag>): WpblVideoTag => ({
    video_id, game_id: null, play_sequence: null, inning: null, half: null, team_id: null, player_ids: [], method: 'game', ...over,
  })
  const game = (id: string, away: number, home: number): WpblGame => ({
    id, game_date: '2026-09-01', status: 'final', away_team_id: 'LA', home_team_id: 'SF', away_score: away, home_score: home,
    game_type: 'regular', counts_in_standings: true,
  } as unknown as WpblGame)
  // A seven-inning game, one play a half: home scores in the seventh to win it 1-0.
  const log = (gameId: string): WpblRunValuePlay[] => {
    const out: WpblRunValuePlay[] = []
    let sequence = 1
    for (let inning = 1; inning <= 7; inning++) {
      for (const half of ['top', 'bottom'] as const) {
        const hit = inning === 7 && half === 'bottom'
        out.push({
          game_id: gameId, sequence: sequence++, inning, half, team_id: half === 'top' ? 'LA' : 'SF', outs: 0,
          batter_id: 'b', batter_name: 'B', pitcher_id: 'p', pitcher_name: 'P', first_base: null, second_base: null, third_base: null,
          event_type: hit ? 'home_run' : 'strikeout', runs_scored: 0, narrative: hit ? 'B homers to left field.' : 'B struck out.', pitch_sequence: null,
        } as unknown as WpblRunValuePlay)
      }
    }
    return out
  }

  it('says what kind of game it was and never the score', () => {
    expect(bestGameFacts({ leadChanges: 3, ties: 1, innings: 9 })).toBe('Extra innings · 3 lead changes · 1 tie')
    expect(bestGameFacts({ leadChanges: 1, ties: 0, innings: 7 })).toBe('1 lead change')
    expect(bestGameFacts({ leadChanges: 0, ties: 0, innings: 7 })).toBe('')
  })

  it('picks the condensed game over the reel, and leaves out a game with no video', () => {
    const games = [game('g1', 0, 1), game('g2', 0, 1)]
    const plays = [...log('g1'), ...log('g2')]
    const videos = [video('r', { kind: 'highlight', game_id: 'g1' }), video('c', { kind: 'condensed', game_id: 'g1' })]
    const best = bestGames(plays, games, videos)
    expect(best.map(b => b.game.id)).toEqual(['g1'])
    expect(best[0].video.video_id).toBe('c')
  })

  it('prices only clips pinned to a play, and names only the play the game turned on', () => {
    const games = [game('g1', 0, 1)]
    const clips = [video('winner', { is_short: true }), video('k', { is_short: true }), video('placed', { is_short: true })]
    const tags = new Map([
      ['winner', tag('winner', { game_id: 'g1', play_sequence: 14 })],
      ['k', tag('k', { game_id: 'g1', play_sequence: 1 })],
      ['placed', tag('placed', { game_id: 'g1' })],
    ])
    const big = biggestPlays(log('g1'), games, clips, tags)
    expect(big.map(b => b.video.video_id)).toEqual(['winner', 'k'])
    expect(big[0].points).toBeGreaterThan(big[1].points)
    expect(big[0].label).toBe('Swing of the game')
    expect(big[1].label).toBeNull()
  })

  it('has nothing to say before the plays land', () => {
    expect(bestGames([], [game('g1', 0, 1)], [])).toEqual([])
    expect(biggestPlays([], [game('g1', 0, 1)], [], new Map())).toEqual([])
  })

  it('files clips by play and by player', () => {
    const clips = [video('a', { is_short: true }), video('b', { is_short: true }), video('c', { is_short: true })]
    const tags = new Map([
      ['a', tag('a', { event_type: 'home_run', player_ids: ['p1', 'p2'] })],
      ['b', tag('b', { event_type: 'home_run', player_ids: ['p1'] })],
      ['c', tag('c', { event_type: 'double', player_ids: ['p3'] })],
    ])
    expect(clipsOfEvent(clips, tags, 'home_run').map(v => v.video_id)).toEqual(['a', 'b'])
    expect(clipEvents(clips, tags)).toEqual([{ event: 'home_run', count: 2 }, { event: 'double', count: 1 }])
    expect(clipsOfPlayer(clips, tags, 'p1').map(v => v.video_id)).toEqual(['a', 'b'])
    const roster = [{ id: 'p3', name: 'Cam' }, { id: 'p2', name: 'Bo' }, { id: 'p1', name: 'Ann' }, { id: 'p9', name: 'None' }]
    expect(playersWithClips(clips, tags, roster).map(p => [p.player.name, p.count])).toEqual([['Ann', 2], ['Bo', 1], ['Cam', 1]])
    expect(eventLabel('home_run')).toBe('Home run')
    expect(eventLabel(null)).toBeNull()
  })
})

describe('phase 4', () => {
  const tag = (video_id: string, over: Partial<WpblVideoTag>): WpblVideoTag => ({
    video_id, game_id: null, play_sequence: null, inning: null, half: null, team_id: null, player_ids: [], method: 'game', ...over,
  })

  it('queues a game\'s videos, then its clips in the order of the plays', () => {
    const list = [
      video('late', { is_short: true, published_at: '2026-09-02T00:00:00Z' }),
      video('early', { is_short: true, published_at: '2026-09-02T01:00:00Z' }),
      video('nopin', { is_short: true, published_at: '2026-09-01T00:00:00Z' }),
      video('other', { is_short: true }),
      video('cond', { kind: 'condensed', game_id: 'g' }),
      video('reel', { kind: 'highlight', game_id: 'g' }),
    ]
    const tags = new Map([
      ['late', tag('late', { game_id: 'g', play_sequence: 50 })],
      ['early', tag('early', { game_id: 'g', play_sequence: 5 })],
      ['nopin', tag('nopin', { game_id: 'g' })],
      ['other', tag('other', { game_id: 'h', play_sequence: 1 })],
    ])
    expect(gameQueue('g', list, tags)).toEqual(['reel', 'cond', 'early', 'late', 'nopin'])
  })

  it('keeps the hide-scores choice, and shows scores when the store cannot say', () => {
    localStorage.clear()
    resetHideScores()
    setHideScores(true)
    expect(localStorage.getItem('sdWatchHideScores')).toBe('1')
    setHideScores(false)
    expect(localStorage.getItem('sdWatchHideScores')).toBe('0')
  })

  it('cards a video with its own poster only where the sync stored the large one', () => {
    const base = { video_id: 'abc', title: 'All 7 Grand Slams', kind: 'compilation', is_short: false }
    const card = wpblVideoCard({ ...base, thumbnail_url: 'https://i.ytimg.com/vi/abc/maxresdefault.jpg' })
    expect(card.image).toContain('maxresdefault')
    expect(card.imageSize).toEqual({ width: 1280, height: 720 })
    expect(card.description).toContain('A compilation')
    const small = wpblVideoCard({ ...base, thumbnail_url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg' })
    expect(small.image).toBeNull()
    expect(small.imageSize).toBeUndefined()
    expect(wpblVideoCard({ ...base, is_short: true, thumbnail_url: null }).description).toContain('A clip')
  })

  it('lists a home run with no clip, and the free clips posted after its game', () => {
    const game = { id: 'g', game_date: '2026-09-01', start_time: null, status: 'final' } as unknown as WpblGame
    const play = (sequence: number, event_type: string) => ({ game_id: 'g', sequence, event_type, inning: 1, half: 'top' }) as unknown as WpblRunValuePlay
    const shorts = [
      video('after', { is_short: true, published_at: '2026-09-02T00:00:00Z' }),
      video('before', { is_short: true, published_at: '2026-08-01T00:00:00Z' }),
      video('pinned', { is_short: true, published_at: '2026-09-02T00:00:00Z' }),
      video('weeks', { is_short: true, published_at: '2026-09-20T00:00:00Z' }),
    ]
    const tags = new Map([['pinned', tag('pinned', { game_id: 'g', play_sequence: 3 })]])
    const out = homersWithoutClips([play(3, 'home_run'), play(4, 'home_run'), play(5, 'single')], [game], shorts, tags)
    expect(out.map(h => h.play.sequence)).toEqual([4])
    expect(out[0].candidates.map(v => v.video_id)).toEqual(['after'])
  })
})
