import { readdirSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { advance, checkTimeline, type FieldFrame } from '../../league/liveField'
import { buildMlbTimeline, mlbLinescore, type FeedPlay, type MlbLiveFeed } from '../liveField'

// Real games recorded by `npm run record-mlb-feed` (scripts/record-mlb-feed.ts). A file named
// `<pk>-<label>.json.gz` is the final feed; `<pk>-<label>@<timecode>.json.gz` is the same game's
// feed as it stood at that moment, mid-game.
const DIR = join(__dirname, 'fixtures', 'live')
const load = (f: string): MlbLiveFeed => JSON.parse(gunzipSync(readFileSync(join(DIR, f))).toString('utf8'))
const files = readdirSync(DIR).filter(f => f.endsWith('.json.gz'))
const finals = files.filter(f => !f.includes('@'))

const id = (r: { id?: number } | undefined) => (r?.id != null ? String(r.id) : null)

/** Each complete plate appearance's last frame, beside the play it closes. */
function closingFrames(feed: MlbLiveFeed, frames: FieldFrame[]): [FeedPlay, FieldFrame][] {
  const last = new Map<number, FieldFrame>()
  for (const f of frames) last.set(f.atBat, f)
  return (feed.liveData?.plays?.allPlays ?? [])
    .filter(p => p.about?.isComplete)
    .map(p => [p, last.get(p.about?.atBatIndex ?? -1)!] as [FeedPlay, FieldFrame])
}

describe.each(finals)('live field: %s', file => {
  const feed = load(file)
  const t = buildMlbTimeline(feed)

  it('passes every invariant, and its runs match the line score inning by inning', () => {
    expect(t.frames.length).toBeGreaterThan(200)
    expect(checkTimeline(t, { linescore: mlbLinescore(feed) })).toEqual([])
    expect(t.final).toBe(true)
  })

  // The frames are built from runner movements alone. These hold them against what the feed
  // says the state was after each play, which the adapter never reads.
  it("ends every plate appearance where the feed's own after-the-play state is", () => {
    const problems: string[] = []
    for (const [play, f] of closingFrames(feed, t.frames)) {
      const at = play.about?.atBatIndex
      if (!f) { problems.push(`${at}: no frame`); continue }
      const m = play.matchup ?? {}
      const want = { 1: id(m.postOnFirst), 2: id(m.postOnSecond), 3: id(m.postOnThird) }
      // After the third out the feed still lists who was on; the field is empty by then, so the
      // bases are only compared while the half goes on.
      if (f.outs < 3) for (const b of [1, 2, 3] as const) {
        if (f.bases[b] !== want[b]) problems.push(`${at}: base ${b} ${f.bases[b]} vs ${want[b]}`)
      }
      if (f.outs !== play.count?.outs) problems.push(`${at}: outs ${f.outs} vs ${play.count?.outs}`)
      if (f.away !== play.result?.awayScore || f.home !== play.result?.homeScore) {
        problems.push(`${at}: score ${f.away}-${f.home} vs ${play.result?.awayScore}-${play.result?.homeScore}`)
      }
      if (f.pitcher !== id(m.pitcher)) problems.push(`${at}: pitcher ${f.pitcher} vs ${id(m.pitcher)}`)
      if (!f.result) problems.push(`${at}: no result`)
    }
    expect(problems).toEqual([])
  })

  it('names every player it draws, and fields nine every frame once the game is under way', () => {
    for (const f of t.frames) {
      for (const p of [f.batter, f.pitcher, f.bases[1], f.bases[2], f.bases[3], ...Object.values(f.defense)]) {
        if (p != null) expect(t.players[p], `frame ${f.index}`).toBeTruthy()
      }
      expect(Object.keys(f.defense), `frame ${f.index}`).toHaveLength(9)
    }
  })

  it('keeps pitch location and the batted ball in field units', () => {
    const pitches = t.frames.flatMap(f => (f.pitch?.px != null ? [f.pitch] : []))
    expect(pitches.length).toBeGreaterThan(200)
    for (const p of pitches) {
      expect(Math.abs(p.px!)).toBeLessThan(6)
      expect(p.pz!).toBeGreaterThan(-2)
      expect(p.pz!).toBeLessThan(8)
    }
    const homers = t.frames.filter(f => f.result === 'Home Run' && f.ball)
    for (const f of homers) expect(Math.hypot(f.ball!.x, f.ball!.y)).toBeGreaterThan(300)
    const balls = t.frames.flatMap(f => (f.ball ? [f.ball] : []))
    expect(balls.length).toBeGreaterThan(30)
    // Fair or foul, nothing lands behind home plate by more than a catcher's reach.
    for (const b of balls) expect(b.y).toBeGreaterThan(-60)
  })
})

describe('live field: a mid-game feed builds the start of the final one', () => {
  const snapshots = files.filter(f => f.includes('@'))
  it.each(snapshots)('%s', file => {
    const final = buildMlbTimeline(load(file.replace(/@[^.]+/, '')))
    const live = buildMlbTimeline(load(file))
    expect(live.final).toBe(false)
    expect(live.frames.length).toBeGreaterThan(0)
    expect(live.frames.length).toBeLessThanOrEqual(final.frames.length)
    expect(checkTimeline(live)).toEqual([])
    // Frames of finished plate appearances match exactly. The plate appearance still going on has
    // no result yet, so only the field is compared for it.
    const latest = live.frames[live.frames.length - 1]
    const open = latest.result == null ? latest.atBat : -1
    for (const f of live.frames) {
      const g = final.frames[f.index]
      if (f.atBat !== open) expect(f, `frame ${f.index}`).toEqual(g)
      else if (f === latest) {
        // The feed posts a pitch before what it caused: strike three shows up as a 3-strike
        // count seconds before the out does (recorded Jul 1, 2026, game 824818). So the newest
        // frame of an open plate appearance can be one step behind on moves, outs and score;
        // the next poll catches it up, and that catch-up is what step 4's `revised` frames are.
        expect([f.balls, f.strikes]).toEqual([g.balls, g.strikes])
      } else {
        const field = (x: FieldFrame) => ({ ...x, result: null, description: '' })
        // The feed fills in a pitch's tracking a few seconds after the call, so a snapshot can
        // hold a pitch with no location yet that the final feed has.
        expect({ ...field(f), pitch: null, ball: null }).toEqual({ ...field(g), pitch: null, ball: null })
      }
    }
  })
})

describe('live field: polling', () => {
  // Each recorded game's snapshots in time order, then the final feed: what a reader polling
  // that game would have been handed.
  const games = new Map<string, string[]>()
  for (const f of files.filter(f => f.includes('@')).sort()) {
    const game = f.replace(/@[^.]+/, '')
    games.set(game, [...(games.get(game) ?? []), f])
  }
  it.each([...games.entries()])('%s: every poll extends the last', (final, snaps) => {
    let prev: ReturnType<typeof buildMlbTimeline> | null = null
    for (const f of [...snaps, final]) {
      const next = buildMlbTimeline(load(f))
      const u = advance(prev, next)
      if (prev) {
        // Nothing before the plate appearance that was open at the last poll changes.
        const lastSeen = prev.frames[prev.frames.length - 1]
        const openFrom = prev.frames.findIndex(x => x.atBat === lastSeen.atBat)
        expect(u.firstChange, f).toBeGreaterThanOrEqual(lastSeen.result == null ? openFrom : prev.frames.length)
        expect(u.firstChange).toBeLessThan(next.frames.length)
      } else expect(u.firstChange).toBe(0)
      prev = next
    }
  })

  it('reports nothing new for the same feed twice, and a revision when a seen frame changes', () => {
    const t = buildMlbTimeline(load(finals[0]))
    expect(advance(t, buildMlbTimeline(load(finals[0])))).toMatchObject({ firstChange: t.frames.length, revised: false })
    const k = 40
    const changed = { ...t, frames: t.frames.map(f => (f.index === k ? { ...f, outs: f.outs === 3 ? 2 : f.outs + 1 } : f)) }
    expect(advance(t, changed)).toMatchObject({ firstChange: k, revised: true })
    // A pitch's tracking filled in later is a change to draw, not a revision.
    const p = t.frames.find(f => f.index >= k && f.pitch)!.index
    const tracked = { ...t, frames: t.frames.map(f => (f.index === p ? { ...f, pitch: { ...f.pitch!, speed: 1 } } : f)) }
    expect(advance(t, tracked).revised).toBe(false)
  })
})
