import { describe, it, expect } from 'vitest'
// A plain .mjs cron script with no type declarations, imported rather than reimplemented
// because the matching below IS the job: a copy living in the test would pass happily while
// the script it mirrors drifted.
import {
  classify, classifyComment, toHits, digestMessage, normaliseReddit, normaliseBluesky,
  normaliseRedditComments, commentSpanMinutes, isCompetitor, mentionParse, byUrgency,
  fitDigest, DISCORD_LIMIT,
} from '../../scripts/watch-wpbl-mentions.mjs'

// The mention watcher runs every 15 minutes over two public search APIs and has exactly two
// ways to be useless. Too loose and the channel is a firehose that gets muted inside a day, so
// the real question ("where can I follow tonight's game?") arrives somewhere nobody is looking.
// Too tight and it never arrives at all. `classify` decides both, from post text alone.

type Result = {
  external_id: string; source: string; url: string; author: string | null
  title: string | null; text: string; context: string | null; posted_at: string | null
  form?: string; parent_title?: string | null
  domain?: string | null; parent_author?: string | null
}

const NOW = Date.parse('2026-08-24T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

const result = (over: Partial<Result> = {}): Result => ({
  external_id: 'reddit:t3_aaa', source: 'reddit', url: 'https://www.reddit.com/r/baseball/x',
  author: 'u/someone', title: null, text: '', context: 'r/baseball', posted_at: hoursAgo(1),
  ...over,
})

describe('classify: the question we exist to catch', () => {
  it('flags a post naming the league and asking where to follow it', () => {
    const v = classify('Where can I watch WPBL games? Is there anywhere with live scores?')
    expect(v?.kind).toBe('question')
    expect(v?.matched).toContain('wpbl')
  })

  it('reads the question out of the body, not just the title', () => {
    // Reddit titles are often just "Question" with everything in the selftext, which is why
    // normaliseReddit concatenates the two before this ever runs.
    expect(classify('WPBL\nDoes anybody know where to find box scores for these games?')?.kind)
      .toBe('question')
  })

  it('accepts the curly apostrophe, which is what a phone actually types', () => {
    expect(classify('any live updates for women’s pro baseball tonight?')?.kind).toBe('question')
  })

  it('treats the league without a question as a quieter mention', () => {
    const v = classify('The Firebells bullpen has been unbelievable this month.')
    expect(v?.kind).toBe('mention')
  })
})

describe('classify: what it must refuse', () => {
  it('ignores a post that asks the question about some other sport', () => {
    // The single commonest false positive, and the one that would make the channel useless:
    // "where can I watch" appears under every sport there is.
    expect(classify('Where can I watch the Guardians game tonight?')).toBeNull()
  })

  it('does not match a club nickname on its own', () => {
    // "Queens", "Heights" and "Hunters" are ordinary words. A watcher that reports every post
    // containing "heights" is a watcher nobody opens, which is why only the full city-and-club
    // spellings are subject terms.
    expect(classify('Moved to Brooklyn Heights last year, where can I watch baseball?')).toBeNull()
    expect(classify('Best bar in Queens to watch a game?')).toBeNull()
  })

  it('does not match a subject term inside a longer word', () => {
    expect(classify('outstanding pitching performance')).toBeNull()
  })

  it('surfaces anyone naming the site, question or not', () => {
    const v = classify('sportydolphin.fun has the standings if anyone needs them')
    expect(v?.kind).toBe('link')
  })
})

describe('toHits', () => {
  it('drops what we have already seen', () => {
    const results = [result({ external_id: 'reddit:t3_seen', title: 'WPBL live scores?' })]
    expect(toHits(results, ['reddit:t3_seen'], { now: NOW })).toHaveLength(0)
  })

  it('dedupes within a single run, since two queries can return the same post', () => {
    // Both "WPBL" and "sportydolphin" match a post naming both, and the same id twice is a
    // primary key violation that fails the whole insert rather than skipping one row.
    const dupe = result({ title: 'WPBL scores on sportydolphin?' })
    expect(toHits([dupe, { ...dupe }], [], { now: NOW })).toHaveLength(1)
  })

  it('drops anything older than the lookback window', () => {
    const old = result({ title: 'Where can I find WPBL standings?', posted_at: hoursAgo(24 * 30) })
    expect(toHits([old], [], { now: NOW })).toHaveLength(0)
  })

  it('keeps a result with no timestamp rather than silently discarding it', () => {
    // An undated result is far likelier a payload shape we did not expect than a decade-old
    // post, and dropping it would hide the change instead of surfacing it.
    const undated = result({ title: 'Where can I find WPBL standings?', posted_at: null })
    expect(toHits([undated], [], { now: NOW })).toHaveLength(1)
  })

  it('carries the subreddit into the author line, so a hit says where it is', () => {
    const hit = toHits([result({ title: 'WPBL live updates?' })], [], { now: NOW })[0]
    expect(hit.author).toBe('u/someone in r/baseball')
  })
})

describe('classifyComment: the half Reddit search cannot see', () => {
  // Reddit's search does not index comments, and the question this job exists to catch is more
  // often a reply in somebody else's game thread than a post of its own. Judging a comment is a
  // different problem from judging a post, and both of its rules are load-bearing.

  it('reads the league off the parent post, since the comment never names it', () => {
    // The single most valuable thing this job can find, and `classify` returns null for it:
    // there is no league anywhere in the text a human actually typed.
    expect(classify('wait, where can I watch this?')).toBeNull()
    const v = classifyComment('wait, where can I watch this?', 'WPBL semifinal game thread')
    expect(v?.kind).toBe('question')
    expect(v?.matched).toContain('wpbl')
  })

  it('refuses to let a comment be a plain mention, which is what stops a game thread flooding', () => {
    // Every one of the four hundred comments under that thread inherits the league from the
    // title. If inheriting the subject were enough on its own, one busy night would bury a
    // week of real questions and the channel would be muted by morning.
    expect(classifyComment('lmao what a swing', 'WPBL semifinal game thread')).toBeNull()
    expect(classifyComment('Firebells look unbeatable', 'WPBL semifinal game thread')).toBeNull()
  })

  it('takes the intent only from the comment, never from the parent', () => {
    // A post titled "Where can I watch WPBL games?" makes every reply under it look like the
    // question, including the replies that are answering it.
    expect(classifyComment('no idea sorry', 'Where can I watch WPBL games?')).toBeNull()
  })

  it('still needs a league somewhere: the question alone is every sport there is', () => {
    expect(classifyComment('where can I watch this?', 'Guardians vs Tigers game thread')).toBeNull()
  })

  it('surfaces someone naming the site wherever they said it', () => {
    // Neither the comment nor the thread is about the league, and it still matters: a
    // recommendation to thank someone for, or a complaint to answer today.
    const v = classifyComment('sportydolphin.fun has the box scores', 'Best sports sites?')
    expect(v?.kind).toBe('link')
  })
})

describe('normaliseRedditComments', () => {
  const payload = (over = {}) => ({ data: { children: [{ kind: 't1', data: {
    id: 'c1', name: 't1_c1', body: 'where can I watch this?', author: 'fan',
    subreddit: 'baseball', link_title: 'WPBL semifinal game thread',
    permalink: '/r/baseball/comments/abc/t/c1/', created_utc: 1756036800, ...over,
  } }] } })

  it('opens the link on the conversation, not on an orphaned reply', () => {
    // Answering well needs to know what was already said above.
    expect(normaliseRedditComments(payload())[0].url)
      .toBe('https://www.reddit.com/r/baseball/comments/abc/t/c1/?context=3')
  })

  it('keeps the thread as the heading and the comment as the quote', () => {
    const [row] = normaliseRedditComments(payload())
    expect(row.title).toBe('re: WPBL semifinal game thread')
    expect(row.text).toBe('where can I watch this?')
    expect(row.form).toBe('comment')
  })

  it('ignores anything in the listing that is not a comment', () => {
    expect(normaliseRedditComments({ data: { children: [{ kind: 't3', data: { id: 'x' } }] } }))
      .toHaveLength(0)
  })

  it('measures how much of the window a batch actually covers', () => {
    // A comment listing returns the newest N and cannot be asked for a time range, so a sub
    // busy enough outruns the poll. That failure is invisible unless it is measured: the sweep
    // returns a full page and has still only seen the last two minutes.
    const rows = [{ posted_at: hoursAgo(0.5) }, { posted_at: hoursAgo(0.05) }]
    expect(Math.round(commentSpanMinutes(rows, NOW))).toBe(30)
    expect(commentSpanMinutes([], NOW)).toBeNull()
  })
})

describe('toHits: comments', () => {
  const comment = (over: Partial<Result> = {}): Result => result({
    external_id: 'reddit:t1_c1', form: 'comment', title: 're: WPBL semifinal game thread',
    parent_title: 'WPBL semifinal game thread', text: 'where can I watch this?', ...over,
  })

  it('classifies a comment against its parent rather than its own title', () => {
    // The `re: ` heading is display text. Feeding it to `classify` would let the parent supply
    // the intent as well as the subject, which is the flood this whole design avoids.
    const [hit] = toHits([comment()], [], { now: NOW })
    expect(hit.kind).toBe('question')
    expect(hit.excerpt).toBe('where can I watch this?')
  })

  it('drops the ordinary chatter under a thread the search already found', () => {
    expect(toHits([comment({ text: 'what a swing' })], [], { now: NOW })).toHaveLength(0)
  })
})

describe('competitors', () => {
  // Turning up under a rival site's post to recommend ours is the fastest way to be the person
  // a community dislikes, and worse than never finding the thread. Their posts are dropped
  // before they reach the table, rather than announced for a human to skip: a channel full of
  // things you must not act on is a channel you skim, and the one you skim is the one that
  // mattered.

  it('drops a post by a competitor, however the handle is punctuated', () => {
    expect(isCompetitor({ author: '@dub-sports.bsky.social' })).toBe(true)
    expect(isCompetitor({ author: 'u/DubSports' })).toBe(true)
    expect(isCompetitor({ author: '@keepscore.bsky.social' })).toBe(true)
  })

  it('drops a link post pointing at their site', () => {
    // `domain` is the outbound link, not the Reddit thread: a competitor submitting their own
    // site is the commonest shape of a post we must not turn up under.
    expect(isCompetitor({ author: 'u/someone', domain: 'dubsports.io' })).toBe(true)
  })

  it('drops a comment sitting in a competitor thread', () => {
    // The question may be genuine, and answering it there still reads as an ad in their house.
    expect(isCompetitor({ author: 'u/curious', parent_author: 'u/dubsports' })).toBe(true)
  })

  it('KEEPS a post that merely names one, which is the best lead there is', () => {
    // "dubsports is down, anywhere else to follow the score?" is the single most valuable thing
    // this job can find. A rule that read the text would throw it away and say nothing.
    const hit = toHits([result({
      author: 'u/fan',
      title: 'dubsports is down, anywhere else to follow WPBL scores?',
    })], [], { now: NOW })
    expect(hit).toHaveLength(1)
    expect(hit[0].kind).toBe('question')
  })

  it('keeps everyone else', () => {
    expect(isCompetitor({ author: 'u/baseballfan', domain: 'mlb.com' })).toBe(false)
    expect(isCompetitor({})).toBe(false)
  })
})

describe('byUrgency', () => {
  it('spends the per-run budget on questions before plain mentions', () => {
    const hits = [
      { kind: 'mention', posted_at: hoursAgo(1) },
      { kind: 'question', posted_at: hoursAgo(5) },
      { kind: 'link', posted_at: hoursAgo(3) },
    ]
    expect([...hits].sort(byUrgency).map(h => h.kind)).toEqual(['question', 'link', 'mention'])
  })
})

describe('normalise', () => {
  it('keys a Reddit post on its fullname, not its permalink', () => {
    // A permalink carries the title slug, which changes when a post is edited, so the same
    // thread would dedupe as two.
    const [hit] = normaliseReddit({
      data: { children: [{ kind: 't3', data: {
        id: 'abc', name: 't3_abc', title: 'T', selftext: 'B', author: 'x',
        subreddit: 'baseball', permalink: '/r/baseball/comments/abc/t/', created_utc: 1756036800,
      } }] },
    })
    expect(hit.external_id).toBe('reddit:t3_abc')
    expect(hit.url).toBe('https://www.reddit.com/r/baseball/comments/abc/t/')
  })

  it('rebuilds an openable web URL from a Bluesky at:// uri', () => {
    const [hit] = normaliseBluesky({ posts: [{
      uri: 'at://did:plc:xyz/app.bsky.feed.post/3labc',
      author: { handle: 'fan.bsky.social' },
      record: { text: 'WPBL scores?', createdAt: hoursAgo(2) },
    }] })
    expect(hit.url).toBe('https://bsky.app/profile/fan.bsky.social/post/3labc')
    // The did-bearing uri stays the key: a handle can be changed by its owner, a did cannot.
    expect(hit.external_id).toBe('bluesky:at://did:plc:xyz/app.bsky.feed.post/3labc')
  })
})

describe('digestMessage', () => {
  const hit = (over = {}) => ({
    kind: 'question', source: 'reddit', url: 'https://example.com/1',
    author: 'u/a in r/baseball', title: 'WPBL live scores?', excerpt: 'anywhere to follow along?',
    ...over,
  })

  it('says nothing when there is nothing due', () => {
    expect(digestMessage([])).toBeNull()
  })

  it('strips mention and code characters out of a stranger\'s text', () => {
    // allowed_mentions is the real guard; this is the belt. A post whose body is "@everyone"
    // must not read as a ping, and one full of backticks must not break the rest of the
    // message out of its formatting.
    const message = digestMessage([hit({ excerpt: '@everyone `look` here' })])!
    expect(message).not.toContain('@everyone')
    expect(message).not.toContain('`')
  })

  it('names the backlog rather than dropping it silently', () => {
    expect(digestMessage([hit()], { remaining: 12 })).toContain('12 more')
  })

  it('always carries the reply-as-yourself reminder', () => {
    // The job is one impatient afternoon away from being a spam bot, and the person reading
    // the channel is the part that stops it.
    expect(digestMessage([hit()])).toContain('Reply as yourself')
  })
})

describe('mentionParse', () => {
  it('is derived from our own configured string, never the post content', () => {
    expect(mentionParse('')).toEqual([])
    expect(mentionParse('<@123>')).toEqual(['users'])
    expect(mentionParse('<@&456>')).toEqual(['roles'])
    expect(mentionParse('@everyone')).toEqual(['everyone'])
  })
})

describe('fitDigest', () => {
  const long = (i: number) => ({
    kind: 'question', source: 'reddit', url: `https://www.reddit.com/r/baseball/comments/${i}`,
    author: `u/person${i} in r/baseball`, title: `WPBL live scores question number ${i}`,
    excerpt: 'x'.repeat(400),
  })

  it('keeps the message under the cap instead of slicing a URL in half', () => {
    // Slicing the finished string is what the naive version did, and it leaves an unclickable
    // link as the last thing in the channel: the one failure that makes a found thread
    // unreachable after finding it.
    const hits = Array.from({ length: 20 }, (_, i) => long(i))
    const { due, left } = fitDigest(hits, hits.length)
    expect(left).toBeGreaterThan(0)
    expect(digestMessage(due, { remaining: hits.length - due.length })!.length)
      .toBeLessThanOrEqual(DISCORD_LIMIT)
  })

  it('leaves a batch that already fits completely alone', () => {
    const hits = [long(1), long(2)]
    expect(fitDigest(hits, hits.length).left).toBe(0)
  })
})
