import { describe, it, expect } from 'vitest'
import {
  TEAM_BODY_MENTIONS, countVideos, isWpblPost, matchGame, matchPlayers, matchTeams,
  parseFeed, parseTitleScore, readMinutes,
  isRisingFastballWpblPost, dropTranslations, teamsInTitle, sourceOf, SOURCES, coverAt, imageCover, aboutPlayerFirst,
} from '../derive/articles'
import type { WpblGame, WpblPlayer, WpblTeam } from '../types'

// What the reading feed decides about someone else's prose. Every case below is either a
// real shape from her live archive or a near miss that a looser rule got wrong during the
// build, which is the point: the failure mode here is a confident wrong link on a player's
// own page, and nobody reviewing a diff would catch that by eye.

const team = (id: string, city: string, name: string): WpblTeam => ({
  id, city, name, abbr: id, color: null, color_secondary: null, logo_url: null,
  sort_order: 0, api_id: null, created_at: '2026-04-01T00:00:00Z',
})
const TEAMS = [
  team('BOS', 'Boston', 'Hunters'),
  team('NY', 'New York', 'Heights'),
  team('LA', 'Los Angeles', 'Queens'),
  team('SF', 'San Francisco', 'Firebells'),
]

const player = (id: string, name: string): WpblPlayer => ({
  id, team_id: null, name, position: null, bats: null, throws: null, jersey_number: null,
  age: null, hometown: null, status: null, draft_round: null, draft_pick: null, bio: null,
  birth_date: null, birth_date_source: null, zodiac_sign: null, active: true, api_id: null, api_ids: [], team_as_of: null,
  created_at: '2026-04-01T00:00:00Z',
})

const game = (o: Partial<WpblGame> = {}): WpblGame => ({
  id: 'g1', game_date: '2026-08-01', status: 'final',
  home_team_id: 'NY', away_team_id: 'LA', home_score: 8, away_score: 10,
} as WpblGame & typeof o)

describe('isWpblPost', () => {
  it('keeps a post tagged for the league', () => {
    expect(isWpblPost(["Women's Pro Baseball League"])).toBe(true)
    expect(isWpblPost(['WPBL', "women's baseball"])).toBe(true)
  })

  it('drops World Cup posts, which this section has nothing to link them to', () => {
    expect(isWpblPost(["Women's Baseball World Cup"])).toBe(false)
    expect(isWpblPost(['Baseball Media'])).toBe(false)
  })

  // Her one both-tagged post is "The Women's Baseball World Cup Group Stages are set": a
  // World Cup post that mentions the league. Reading the WPBL tag inclusively let exactly
  // that through, so the World Cup tag has to win.
  it('drops a post carrying both tags', () => {
    expect(isWpblPost(['WPBL', "Women's Baseball World Cup", 'baseball'])).toBe(false)
  })

  it('drops untagged posts rather than guessing', () => {
    expect(isWpblPost([])).toBe(false)
  })
})

describe('readMinutes', () => {
  it('reads her real post lengths as sane minute counts', () => {
    expect(readMinutes(722)).toBe(4)     // "I Cannot Overstate... Denae Benites"
    expect(readMinutes(1178)).toBe(6)    // "Ticara Geldenhuis and the Denver Disposition"
    expect(readMinutes(1731)).toBe(9)    // "Queens Topple Heights, 10-8"
  })

  // Her posts embed clips of the plays being described, and a short video-heavy one takes
  // far longer than its word count says. The Benites post is 722 words and three clips.
  it('adds time for the embedded clips', () => {
    expect(readMinutes(722, 3)).toBe(6)
    expect(readMinutes(858, 5)).toBe(7)  // "Kelsie Whitmore Woke Up"
  })

  // Null is "we could not look" (the post left the RSS window, which is the only place a
  // body exists), not "there are none". Counting it as zero under-counts rather than
  // inventing a number.
  it('treats an uncounted post as having no clips', () => {
    expect(readMinutes(722, null)).toBe(readMinutes(722))
    expect(readMinutes(722, undefined)).toBe(4)
  })

  // Rounds up, not to nearest. Finishing early is a pleasant surprise; being left stranded
  // mid-piece by a number you trusted is not.
  it('rounds up, so it never under-promises', () => {
    expect(readMinutes(201)).toBe(2)
    expect(readMinutes(400)).toBe(2)
    expect(readMinutes(401)).toBe(3)
  })

  it('never advertises a zero-minute read', () => {
    expect(readMinutes(0)).toBe(1)
    expect(readMinutes(null)).toBe(1)
    expect(readMinutes(30)).toBe(1)
  })
})

describe('matchPlayers', () => {
  const players = [player('p1', 'Denae Benites'), player('p2', 'Kelsie Whitmore'), player('p3', 'Adelaide Frank')]

  it('matches a full name in prose', () => {
    expect(matchPlayers('how good Denae Benites is playing right now', players)).toEqual(['p1'])
  })

  // The whole reason for full-name-only matching: a surname alone cannot identify anyone,
  // and this list feeds a player's own page.
  it('ignores a bare surname', () => {
    expect(matchPlayers('Benites went 3-for-4 last night', players)).toEqual([])
  })

  it('does not match a name buried inside a longer word', () => {
    expect(matchPlayers('speaking frankly about Adelaide Frankfurt', players)).toEqual([])
  })

  it('survives a curly apostrophe and an accent', () => {
    const p = [player('p9', "Rae O'Brien")]
    expect(matchPlayers('a start from Rae O’Brien', p)).toEqual(['p9'])
  })
})

describe('matchTeams', () => {
  const body = (nick: string, n: number) => `filler ${`the ${nick} played. `.repeat(n)} more filler`

  it('matches a club named in the headline, however thin the body', () => {
    expect(matchTeams("Who's Afraid of the Boston Hunters?", 'one passing word', TEAMS)).toEqual(['BOS'])
  })

  it('matches a club the body keeps returning to', () => {
    expect(matchTeams('a headline', body('Heights', TEAM_BODY_MENTIONS), TEAMS)).toEqual(['NY'])
  })

  // A club mentioned once on the way to another subject is not what the team page is asking
  // about. Before the threshold, one essay claimed all four clubs.
  it('ignores a club mentioned only in passing', () => {
    expect(matchTeams('a headline', body('Hunters', TEAM_BODY_MENTIONS - 1), TEAMS)).toEqual([])
  })

  // Her World Cup coverage names Boston and San Francisco as tournament venues. Bare-city
  // matching filed four of those essays under WPBL clubs.
  it('never matches on a bare city', () => {
    expect(matchTeams('Group play opens in Boston', 'games in Boston and San Francisco all week', TEAMS)).toEqual([])
  })

  // A profile is about its subject's club whether or not it keeps naming the club. The
  // Benites post is 722 words of Heights baseball that says "Heights" exactly once, so its
  // card carried no club badge at all.
  it('tags the club of a player named in the headline', () => {
    const benites = { ...player('p1', 'Denae Benites'), team_id: 'NY' }
    const headline = 'I Cannot Overstate to You How Good Denae Benites is Playing WPBL Baseball Right Now'
    expect(matchTeams(headline, 'the Heights won again', TEAMS, [benites])).toEqual(['NY'])
  })

  // Limiting rule 3 to the headline is what keeps it from undoing the mention threshold:
  // her game write-ups name a dozen players across both clubs and a few from elsewhere.
  it('ignores the clubs of players named only in the body', () => {
    const benites = { ...player('p1', 'Denae Benites'), team_id: 'NY' }
    expect(matchTeams('A day at the yard', 'Denae Benites went 2-for-4', TEAMS, [benites])).toEqual([])
  })

  it('counts a full "city nickname" mention once, not twice', () => {
    // Two "Boston Hunters" would clear a naive threshold that counts city and nickname
    // separately; it must not clear the real one.
    expect(matchTeams('a headline', 'the Boston Hunters and the Boston Hunters again', TEAMS)).toEqual([])
  })
})

describe('parseTitleScore', () => {
  it('reads the score out of a recap headline', () => {
    expect(parseTitleScore('Queens Topple Heights, 10-8, In Just Another Ballgame')).toEqual([10, 8])
  })

  it('accepts an en dash, which is how the house styles a score', () => {
    expect(parseTitleScore('Queens Topple Heights, 10–8')).toEqual([10, 8])
  })

  it('reads nothing out of a headline with no score', () => {
    expect(parseTitleScore("Who's Afraid of the Boston Hunters?")).toBeNull()
    expect(parseTitleScore('A 5-5 tie is not a final')).toBeNull()
  })
})

describe('matchGame', () => {
  const games = [game()]
  const recap = { title: 'Queens Topple Heights, 10-8', publishedAt: '2026-08-02T15:10:08Z', teamIds: ['LA', 'NY'] }

  it('links a recap when teams, date and score all agree', () => {
    expect(matchGame(recap, games)).toBe('g1')
  })

  it('refuses when the headline score disagrees with the final', () => {
    expect(matchGame({ ...recap, title: 'Queens Topple Heights, 9-8' }, games)).toBeNull()
  })

  it('refuses when the post is a week late', () => {
    expect(matchGame({ ...recap, publishedAt: '2026-08-09T15:00:00Z' }, games)).toBeNull()
  })

  it('refuses a post that is about the club generally, not one night', () => {
    expect(matchGame({ ...recap, title: "Who's Afraid of the Boston Hunters?" }, games)).toBeNull()
    expect(matchGame({ ...recap, teamIds: ['NY'] }, games)).toBeNull()
    expect(matchGame({ ...recap, teamIds: ['BOS', 'NY', 'LA'] }, games)).toBeNull()
  })

  // A doubleheader split by the same score, or two same-score meetings inside the window:
  // there is no way to tell which she wrote about, so neither is claimed.
  it('refuses when two games fit equally well', () => {
    const twin = { ...game(), id: 'g2' }
    expect(matchGame(recap, [game(), twin])).toBeNull()
  })

  it('ignores a game that is not final', () => {
    expect(matchGame(recap, [{ ...game(), status: 'scheduled' } as WpblGame])).toBeNull()
  })
})

describe('countVideos', () => {
  it('counts the YouTube clips she embeds', () => {
    expect(countVideos('<p>a</p><iframe src="https://www.youtube-nocookie.com/embed/x?start=91"></iframe>')).toBe(1)
    expect(countVideos('<iframe src="https://youtu.be/a"></iframe><iframe src="https://www.youtube.com/embed/b"></iframe>')).toBe(2)
  })

  // Substack injects its own iframes for subscribe widgets and post embeds. Counting those
  // as baseball would pad the estimate on exactly the posts with no video in them.
  it('ignores Substack\'s own iframes', () => {
    expect(countVideos('<iframe src="https://towardsamoreperfectgame.substack.com/embed"></iframe>')).toBe(0)
    expect(countVideos('<p>no embeds here</p>')).toBe(0)
  })
})

describe('parseFeed', () => {
  const xml = `<rss><channel>
    <item>
      <title><![CDATA[Queens Topple Heights, 10-8]]></title>
      <link>https://towardsamoreperfectgame.substack.com/p/queens-topple-heights</link>
      <content:encoded><![CDATA[<p>A start from <em>Denae</em> <em>Benites</em>.</p><iframe src="https://www.youtube-nocookie.com/embed/abc?start=12"></iframe>]]></content:encoded>
    </item>
  </channel></rss>`

  it('reads the link, title and de-tagged body', () => {
    const [post] = parseFeed(xml)
    expect(post.title).toBe('Queens Topple Heights, 10-8')
    expect(post.link).toBe('https://towardsamoreperfectgame.substack.com/p/queens-topple-heights')
    expect(post.text).toBe('A start from Denae Benites .')
  })

  // The count has to be taken from the markup, because building `text` throws every iframe
  // away. Easy to break by reordering two lines in parseFeed, and silent when broken.
  it('counts the clips before the markup is stripped', () => {
    expect(parseFeed(xml)[0].videos).toBe(1)
  })

  // Markup between the two halves of a name is normal in her posts (an italicised first
  // name, a line break mid-sentence). Stripping tags to a space and collapsing runs is what
  // keeps that a match rather than a miss.
  it('finds a name that markup had split in two', () => {
    const [post] = parseFeed(xml)
    expect(matchPlayers(post.text, [player('p1', 'Denae Benites')])).toEqual(['p1'])
  })
})

// The Rising Fastball (D.A. Espinoza), the second writer, from Sep 25, 2026. Every case is a real
// post from that archive, because the rules were written against it.
describe('The Rising Fastball', () => {
  const roster = [player('rk', 'Rakyung Kim'), player('as', 'Ayami Sato'), player('rd', 'Rosi del Castillo')]
  const post = (title: string, subtitle: string | null = null, tags: string[] = []) => ({ title, subtitle, tags })

  it('takes the league coverage by its title, whatever the tags say', () => {
    expect(isRisingFastballWpblPost(post('WPBL: Week 4 Check In'), roster)).toBe(true)
    expect(isRisingFastballWpblPost(post('WPBL Plants Its Flag in Springfield, Illinois'), roster)).toBe(true)
    // Tagged WPBL, about something else: the tags are bulk reach tags, not filing.
    expect(isRisingFastballWpblPost(post('The Rising Fastball Turns 1!', null, ['WPBL', 'npb']), roster)).toBe(false)
    expect(isRisingFastballWpblPost(post('Venus League: The Return Of The Regular Season', null, ['WPBL']), roster)).toBe(false)
  })

  it("takes a profile of one of the league's players, even from before the season", () => {
    expect(isRisingFastballWpblPost(post('Rakyung Kim - Part 1: "The First"'), roster)).toBe(true)
    // Case differs from the roster's "del"; names match case-insensitively.
    expect(isRisingFastballWpblPost(post('Rosi Del Castillo: La Nena'), roster)).toBe(true)
    expect(isRisingFastballWpblPost(post('Micaela Kanagusku: The Star of the South'), roster)).toBe(false)
  })

  it('keeps the English edition of a translated post', () => {
    const kept = dropTranslations([
      post('Nene Masago: Don’t just play to win, “Enjoy Baseball”'),
      post('真砂寧々：勝つことだけじゃない、“Enjoy Baseball”の精神'),
      post('Rosi Del Castillo: La Nena', 'Una entrevista con la revolucionaria del béisbol de México'),
      post('Rosi Del Castillo: La Nena', "An Interview With Mexico's Baseball Revolutionary"),
    ])
    expect(kept.map(p => p.subtitle)).toEqual([null, "An Interview With Mexico's Baseball Revolutionary"])
  })

  it('credits every row by its source, and an unknown one to the original writer', () => {
    expect(sourceOf('rising-fastball').authorName).toBe('D.A. Espinoza')
    expect(sourceOf('towards').authorName).toBe('mary mustard')
    expect(sourceOf(null)).toBe(SOURCES[0])
    // Only a first-person bio is quoted; see AuthorByline.
    expect(sourceOf('rising-fastball').bioIsQuote).toBe(false)
    expect(sourceOf('towards').bioIsQuote).toBe(true)
  })
})

describe('matchGame, a recap headline with no score', () => {
  const opening: WpblGame = {
    id: 'op', game_date: '2026-08-01', status: 'final',
    home_team_id: 'NY', away_team_id: 'LA', home_score: 8, away_score: 10,
  } as WpblGame
  const title = 'WPBL: Los Angeles Queens VS New York Heights Game 1 Recap'
  const opts = (publishedAt: string, t = title) =>
    ({ title: t, publishedAt, teamIds: ['NY', 'LA', 'BOS'], titleTeamIds: teamsInTitle(t, TEAMS) })

  it('links it when the headline names two clubs and says recap, and they met once in the window', () => {
    expect(teamsInTitle(title, TEAMS).sort()).toEqual(['LA', 'NY'])
    expect(matchGame(opts('2026-08-02T15:00:00Z'), [opening])).toBe('op')
  })

  it('links nothing when the pair met twice in the window, or the headline is not a recap', () => {
    const rematch = { ...opening, id: 'op2', game_date: '2026-08-02' }
    expect(matchGame(opts('2026-08-03T15:00:00Z'), [opening, rematch])).toBeNull()
    expect(matchGame(opts('2026-08-02T15:00:00Z', 'WPBL: Los Angeles Queens VS New York Heights Preview'), [opening])).toBeNull()
  })
})

describe('covers', () => {
  const full = 'https://substackcdn.com/image/fetch/$s_!KeXd!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fabc.png'
  it('asks the CDN for the drawn width instead of the full-size original', () => {
    expect(coverAt(full, 240)).toBe('https://substackcdn.com/image/fetch/w_240,c_limit,f_auto,q_auto:good/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fabc.png')
    expect(coverAt('https://example.com/a.jpg', 240)).toBe('https://example.com/a.jpg')
    expect(coverAt(null, 240)).toBeNull()
  })
  it('stores no cover for a post whose cover is a video', () => {
    expect(imageCover('https://substack-video.s3.amazonaws.com/video_upload/post/210317804/a.mp4')).toBeNull()
    expect(imageCover(full)).toBe(full)
  })
})

describe('aboutPlayerFirst', () => {
  it('puts the posts about a player ahead of the ones that only mention the player, each newest first', () => {
    const p = (title: string, published_at: string) => ({ title, subtitle: null, published_at })
    const out = aboutPlayerFirst([
      p('O, For An Encore', '2026-09-23'),
      p('Rakyung Kim - Part 1: "The First"', '2025-10-09'),
      p('WPBL: Playoff Preview', '2026-09-09'),
      p('Rakyung Kim: Destiny Awaits In Springfield', '2026-07-20'),
    ], 'Rakyung Kim')
    expect(out.map(x => x.title)).toEqual([
      'Rakyung Kim: Destiny Awaits In Springfield', 'Rakyung Kim - Part 1: "The First"',
      'O, For An Encore', 'WPBL: Playoff Preview',
    ])
  })
})
