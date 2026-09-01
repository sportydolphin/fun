import { describe, it, expect, vi } from 'vitest'
// A plain .mjs cron script with no type declarations, imported rather than reimplemented: the
// stream split below IS the job's one dangerous decision, and a copy living in the test would
// pass happily while the script it mirrors drifted.
import {
  STREAMS, streamOf, buildMessage,
} from '../../scripts/post-wpbl-discord-highlights.mjs'
import { probeIsShort } from '../../scripts/sync-wpbl-youtube.mjs'

// The league publishes two kinds of highlight to one YouTube channel, and this job posts both
// into one Discord channel. The failure that matters is not a wrong caption: it is the flood.
// Shorts were added to a job that had already been posting reels for a fortnight, so anything
// that makes an established stream look new, or a new stream look established, empties a
// four-day window into the channel in one go.

type V = {
  video_id: string; title: string; published_at: string
  kind: 'highlight' | 'podcast' | 'other'; is_short: boolean | null
  game_id: string | null; away_hint?: string | null; home_hint?: string | null
  game_date_hint?: string | null
}

const video = (over: Partial<V> = {}): V => ({
  video_id: 'abc123XYZ_1', title: 'Denae Benites GRAND SLAM',
  published_at: '2026-08-31T02:00:00Z', kind: 'other', is_short: true,
  game_id: null, ...over,
})

const reel = (over: Partial<V> = {}) => video({
  title: 'WPBL Highlights: Boston Hunters @ San Francisco Firebells | August 28, 2026',
  kind: 'highlight', is_short: false, ...over,
})

const teams = new Map<string, { city: string; name: string }>([
  ['t-bos', { city: 'Boston', name: 'Hunters' }],
  ['t-sf', { city: 'San Francisco', name: 'Firebells' }],
])

describe('streamOf', () => {
  it('reads a reel from what the sync made of its title', () => {
    expect(streamOf(reel())).toBe('reel')
  })

  it('reads a Short from its shape, since no title reveals it', () => {
    // "FIRST WPBL WALK-OFF" and a three-hour full-game replay both land in `other`, so there is
    // no keyword that separates them. is_short is the probe's answer, not a guess about words.
    expect(streamOf(video())).toBe('short')
  })

  it('claims neither for an ordinary upload', () => {
    // Full-game replays ("WPBL: New York Heights @ San Francisco Firebells | August 30, 2026")
    // and sit-down features live here, and the channel must never see them.
    expect(streamOf(video({ title: 'Ticara Geldenhuis | Australian Legend', is_short: false }))).toBeNull()
  })

  it('keeps an undetermined probe out of the channel', () => {
    // null means the probe was blocked or ambiguous, never "no". Guessing it in is how a
    // three-hour replay reaches a highlights channel.
    expect(streamOf(video({ is_short: null }))).toBeNull()
  })

  it('gives a tie to the reel, so one video is never posted twice', () => {
    expect(streamOf(reel({ is_short: true }))).toBe('reel')
  })

  it('names its streams the way the posts table stores them', () => {
    // The keys are written to wpbl_discord_highlight_posts.stream. Renaming one re-seeds it.
    expect(Object.keys(STREAMS).sort()).toEqual(['reel', 'short'])
  })
})

describe('buildMessage', () => {
  it('gives a reel the matchup, the date and exactly one link', () => {
    const game = { game_date: '2026-08-28', away_team_id: 't-bos', home_team_id: 't-sf' }
    const out = buildMessage(reel(), game, teams).content as string
    expect(out).toContain('Boston Hunters @ San Francisco Firebells')
    expect(out).toContain('August 28')
    expect(out.match(/https?:\/\//g)).toHaveLength(1)
  })

  it('gives a Short the league\'s own title and nothing else', () => {
    // There is no matchup in "Denae Benites GRAND SLAM" to parse, and a date taken from the
    // upload time would be a guess printed as a fact.
    const out = buildMessage(video(), null, teams).content as string
    expect(out).toContain('Denae Benites GRAND SLAM')
    expect(out).not.toContain('@')
    expect(out.match(/https?:\/\//g)).toHaveLength(1)
  })

  it('sends a Short to the /shorts/ URL, which is what makes Discord render it portrait', () => {
    const out = buildMessage(video(), null, teams).content as string
    expect(out).toContain('https://www.youtube.com/shorts/abc123XYZ_1')
  })

  it('sends a reel to the /watch URL', () => {
    const out = buildMessage(reel(), null, teams).content as string
    expect(out).toContain('https://www.youtube.com/watch?v=abc123XYZ_1')
  })

  it('never pings the channel, in either stream', () => {
    for (const v of [video(), reel()]) {
      expect(buildMessage(v, null, teams).allowed_mentions).toEqual({ parse: [] })
    }
  })

  it('keeps the score out, so the message does not spoil the video', () => {
    const out = buildMessage(video({ title: 'FIRST WPBL WALK-OFF' }), null, teams).content as string
    expect(out).not.toMatch(/\b\d+\s*[-–]\s*\d+\b/)
  })

  it('falls back to the raw title when a reel resolved to no teams', () => {
    const out = buildMessage(reel({ away_hint: null, home_hint: null }), null, new Map()).content as string
    expect(out).toContain('WPBL Highlights: Boston Hunters @ San Francisco Firebells')
  })
})

// ─── The probe that decides what a Short is ─────────────────────────────────

const reply = (status: number, location?: string) => ({
  status,
  headers: { get: (h: string) => (h.toLowerCase() === 'location' ? location ?? null : null) },
})

describe('probeIsShort', () => {
  it('reads a 200 on /shorts/<id> as a Short', async () => {
    expect(await probeIsShort('abc', vi.fn(async () => reply(200)) as never)).toBe(true)
  })

  it('reads a redirect to /watch as an ordinary video', async () => {
    expect(await probeIsShort('abc', vi.fn(async () => reply(303, 'https://www.youtube.com/watch?v=abc')) as never))
      .toBe(false)
  })

  // The rest of this block is one rule with four faces: anything ambiguous stays NULL, never
  // false. YouTube already bot-gates this repo's requests from GitHub's datacenter IPs, which
  // is why the RSS path carries a browser UA and a retry. A probe that read a gate as "not a
  // Short" would permanently and silently exclude a clip from the Discord channel, because the
  // caller never re-probes a value it already has.
  it('leaves a bot-gate 404 undetermined rather than calling it not a Short', async () => {
    expect(await probeIsShort('abc', vi.fn(async () => reply(404)) as never)).toBeNull()
  })

  it('leaves a rate limit undetermined', async () => {
    expect(await probeIsShort('abc', vi.fn(async () => reply(429)) as never)).toBeNull()
  })

  it('leaves a redirect somewhere other than /watch undetermined', async () => {
    // A consent or region interstitial is not an answer about the video.
    expect(await probeIsShort('abc', vi.fn(async () => reply(302, 'https://consent.youtube.com/m')) as never))
      .toBeNull()
  })

  it('leaves a network failure undetermined rather than throwing', async () => {
    // It runs inside the upsert loop, so a throw here would lose the whole sync over one clip.
    expect(await probeIsShort('abc', vi.fn(async () => { throw new Error('ECONNRESET') }) as never)).toBeNull()
  })

  it('does not follow the redirect it needs to read', async () => {
    const f = vi.fn(async () => reply(200))
    await probeIsShort('abc', f as never)
    const [url, init] = f.mock.calls[0] as unknown as [string, { redirect: string; method: string }]
    expect(url).toBe('https://www.youtube.com/shorts/abc')
    expect(init.redirect).toBe('manual')
    // HEAD, because the answer is entirely in the status line and the body is a whole webpage.
    expect(init.method).toBe('HEAD')
  })
})
