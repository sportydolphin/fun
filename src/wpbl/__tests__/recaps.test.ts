import { describe, it, expect } from 'vitest'
import {
  clubsNamed, centralDate, matchRecaps, parseRecapFeed, recapThumb, scoreNamed,
  type FeedRecap, type RecapGame,
} from '../derive/recaps'

// Placing someone else's headline on one of our games is a judgement call, and this is where
// every one of those calls is pinned. The numbers quoted are from the real feed, measured
// Sep 12, 2026: 33 games, 33 recaps, everything placed, nothing ambiguous.

const post = (title: string, iso: string, url = title.toLowerCase().replace(/\W+/g, '-')): FeedRecap =>
  ({ title, url: `https://thisiswomensbaseball.com/f/${url}`, publishedAt: new Date(iso), coverUrl: null })

const game = (o: Partial<RecapGame> & { id: string; game_date: string; home_team_id: string; away_team_id: string }): RecapGame =>
  ({ home_score: 5, away_score: 3, ...o })

describe('parseRecapFeed', () => {
  const xml = `<rss><channel>
    <item>
      <title><![CDATA[Firebells finish sweep, punch ticket to championship]]></title>
      <link>https://thisiswomensbaseball.com/f/firebells-finish-sweep</link>
      <pubDate>Sat, 12 Sep 2026 02:43:54 GMT</pubDate>
      <description><![CDATA[SPRINGFIELD, Ill. - the lede we do not keep.]]></description>
      <content:encoded><![CDATA[<img src="https://img1.wsimg.com/isteam/ip/abc/SF.png"/><p>Body.</p>]]></content:encoded>
    </item>
  </channel></rss>`

  it('keeps the headline, the link, the date and their cover', () => {
    const [p] = parseRecapFeed(xml)
    expect(p.title).toBe('Firebells finish sweep, punch ticket to championship')
    expect(p.url).toBe('https://thisiswomensbaseball.com/f/firebells-finish-sweep')
    expect(p.publishedAt.toISOString()).toBe('2026-09-12T02:43:54.000Z')
    expect(p.coverUrl).toBe('https://img1.wsimg.com/isteam/ip/abc/SF.png')
  })

  // THE RULE THE WHOLE FEATURE RESTS ON. The feed hands over the lede and we do not take it:
  // on recaps this short it is close to half the article. `FeedRecap` has nowhere to put it,
  // as `wpbl_recaps` has no column for it. See docs/RECAPS.md.
  it('does not carry their prose out of the parser at all', () => {
    const [p] = parseRecapFeed(xml)
    expect(Object.keys(p).sort()).toEqual(['coverUrl', 'publishedAt', 'title', 'url'])
    expect(JSON.stringify(p)).not.toContain('lede')
    expect(JSON.stringify(p)).not.toContain('Body')
  })

  it('skips an item missing anything it is keyed on, rather than failing the run', () => {
    expect(parseRecapFeed('<rss><channel><item><title>No link</title></item></channel></rss>')).toEqual([])
    expect(parseRecapFeed('')).toEqual([])
  })

  it('has no cover for a post that carries no image', () => {
    const none = `<rss><channel><item><title>T</title><link>u</link>
      <pubDate>Sat, 12 Sep 2026 02:43:54 GMT</pubDate></item></channel></rss>`
    expect(parseRecapFeed(none)[0].coverUrl).toBeNull()
  })
})

describe('recapThumb', () => {
  // 248 KB at source, 18 KB at w:320, which is the only reason a thumbnail per game is
  // affordable. Their CDN rejects `fmt=webp` in every position, so this asks only for a width.
  it('asks their CDN for the width actually drawn', () => {
    expect(recapThumb('https://img1.wsimg.com/isteam/ip/abc/SF.png', 320))
      .toBe('https://img1.wsimg.com/isteam/ip/abc/SF.png/:/rs=w:320')
  })

  // A cover_url is a string out of a database. Appending transform parameters to an arbitrary
  // URL is how you end up "resizing" somebody's tracking pixel.
  it('leaves a URL that is not their image CDN completely alone', () => {
    expect(recapThumb('https://example.com/x.png')).toBe('https://example.com/x.png')
    expect(recapThumb(null)).toBeNull()
  })

  it('does not stack a second transform onto one that already has one', () => {
    const already = 'https://img1.wsimg.com/isteam/ip/abc/SF.png/:/rs=w:640'
    expect(recapThumb(already, 320)).toBe(already)
  })
})

describe('reading a headline', () => {
  it('knows a club by its nickname and by its city, because they use both', () => {
    expect(clubsNamed('Firebells hold off Hunters, take Game 1').sort()).toEqual(['BOS', 'SF'])
    expect(clubsNamed('Los Angeles rallies late for 8-6 win over Boston').sort()).toEqual(['BOS', 'LA'])
    expect(clubsNamed('Edwards Hits First Grand Slam in WPBL History')).toEqual([])
  })

  it('reads a final score high first, whichever way round it is written', () => {
    expect(scoreNamed('Queens keep pressure on in 8-6 win')).toEqual([8, 6])
    expect(scoreNamed('Boston earns first win over Queens, 7-3')).toEqual([7, 3])
    expect(scoreNamed('Heights power past Queens with 17-hit night')).toBeNull()
  })

  // Central, from `Intl`, not a hardcoded five hours. A recap filed at 02:43 GMT went up on the
  // previous evening in Springfield, which is the night of the game it is about.
  it('puts a small-hours GMT post on the previous Central day', () => {
    expect(centralDate(new Date('2026-09-12T02:43:54Z'))).toBe('2026-09-11')
    expect(centralDate(new Date('2026-09-11T21:42:00Z'))).toBe('2026-09-11')
  })
})

describe('matchRecaps', () => {
  it('places a recap naming both clubs', () => {
    const games = [game({ id: 'g1', game_date: '2026-09-09', home_team_id: 'SF', away_team_id: 'BOS' })]
    const posts = [post('Firebells hold off Hunters, take Game 1', '2026-09-10T03:02:00Z')]
    expect(matchRecaps(posts, games)).toEqual([
      { gameId: 'g1', post: posts[0], how: 'both clubs' },
    ])
  })

  // THE RULE THAT REPLACED "only one game was played that day", and the game it won back.
  // Aug 8 had two games. "Hunters Erase Six-Run Deficit" names one club, and Boston played
  // once, so the post cannot be about the other game however little else the headline says.
  it('places a one-club headline when that club played once that day', () => {
    const games = [
      game({ id: 'bosny', game_date: '2026-08-08', home_team_id: 'NY', away_team_id: 'BOS' }),
      game({ id: 'lasf', game_date: '2026-08-08', home_team_id: 'SF', away_team_id: 'LA' }),
    ]
    const posts = [
      post('Hunters Erase Six-Run Deficit for First Win', '2026-08-08T22:29:00Z'),
      post('Firebells Bounce Back With 10-3 Win Over Queens', '2026-08-09T02:48:00Z'),
    ]
    const got = matchRecaps(posts, games)
    expect(got.find(m => m.gameId === 'bosny')?.how).toBe('club played once')
    expect(got.find(m => m.gameId === 'lasf')?.how).toBe('both clubs')
  })

  // A headline naming a club that is not in this game is about another game, whatever else
  // it says. Without this, a two-game night hands one post to both.
  it('refuses a headline that also names somebody else', () => {
    const games = [
      game({ id: 'a', game_date: '2026-08-08', home_team_id: 'NY', away_team_id: 'BOS' }),
      game({ id: 'b', game_date: '2026-08-08', home_team_id: 'SF', away_team_id: 'LA' }),
    ]
    // Boston and Los Angeles are in different games that night: this names neither pairing.
    const posts = [post('Boston and Los Angeles both fall short', '2026-08-08T22:29:00Z')]
    expect(matchRecaps(posts, games)).toEqual([])
  })

  // Aug 5: the headline is about a player and names no club at all. On a single-game night
  // there is nothing else it could be about.
  it('places a club-less headline on a single-game night', () => {
    const games = [game({ id: 'g', game_date: '2026-08-05', home_team_id: 'LA', away_team_id: 'BOS' })]
    const posts = [post('Edwards Hits First Grand Slam in WPBL History', '2026-08-06T03:38:00Z')]
    expect(matchRecaps(posts, games)[0].how).toBe('no club, sole game')
  })

  it('will not guess a club-less headline when two games were played', () => {
    const games = [
      game({ id: 'a', game_date: '2026-08-08', home_team_id: 'NY', away_team_id: 'BOS' }),
      game({ id: 'b', game_date: '2026-08-08', home_team_id: 'SF', away_team_id: 'LA' }),
    ]
    expect(matchRecaps([post('A player did something', '2026-08-09T03:00:00Z')], games)).toEqual([])
  })

  // PHASE TWO, AND THE ORDER IS THE DESIGN. Aug 6's recap went up on the night of Aug 7, which
  // is also a game night. The tight same-night match is made for Aug 7 first, and only then is
  // the leftover allowed to reach forward, on both clubs AND the exact score.
  it('reaches into the next night only for a game nothing else claimed', () => {
    const games = [
      game({ id: 'aug6', game_date: '2026-08-06', home_team_id: 'SF', away_team_id: 'NY', home_score: 8, away_score: 13 }),
      game({ id: 'aug7', game_date: '2026-08-07', home_team_id: 'LA', away_team_id: 'SF', home_score: 12, away_score: 3 }),
    ]
    const posts = [
      post('Maximiliana, Mackay Power Queens Past Firebells', '2026-08-08T04:10:00Z'),
      post('New York Uses 15 Hits to Beat San Francisco, 13-8', '2026-08-08T04:00:00Z'),
    ]
    const got = matchRecaps(posts, games)
    expect(got.find(m => m.gameId === 'aug7')?.how).toBe('both clubs')
    expect(got.find(m => m.gameId === 'aug6')?.how).toBe('next night')
  })

  // The same evidence, minus the score, is not enough to move a recap across a day boundary.
  it('will not reach into the next night on the clubs alone', () => {
    const games = [game({ id: 'g', game_date: '2026-08-06', home_team_id: 'SF', away_team_id: 'NY', home_score: 8, away_score: 13 })]
    const posts = [post('New York beats San Francisco', '2026-08-08T04:00:00Z')]
    expect(matchRecaps(posts, games)).toEqual([])
  })

  it('never gives one recap to two games', () => {
    const games = [
      game({ id: 'a', game_date: '2026-08-15', home_team_id: 'NY', away_team_id: 'SF', home_score: 6, away_score: 11 }),
      game({ id: 'b', game_date: '2026-08-15', home_team_id: 'BOS', away_team_id: 'LA', home_score: 3, away_score: 13 }),
    ]
    const posts = [post('Firebells stay hot with 11-6 win over Heights', '2026-08-15T21:52:00Z')]
    const got = matchRecaps(posts, games)
    expect(got).toHaveLength(1)
    expect(got[0].gameId).toBe('a')
  })

  // The bias is towards saying nothing: an unmatched game shows no card, where a recap of
  // somebody else's game shown under this one is a mistake a reader does not forgive.
  it('says nothing about a game nobody wrote up', () => {
    const games = [game({ id: 'g', game_date: '2026-08-05', home_team_id: 'LA', away_team_id: 'BOS' })]
    expect(matchRecaps([], games)).toEqual([])
  })

  it('ignores a game that has not been played', () => {
    const games = [game({ id: 'g', game_date: '2026-09-12', home_team_id: 'LA', away_team_id: 'NY', home_score: null, away_score: null })]
    expect(matchRecaps([post('Queens beat Heights', '2026-09-13T03:00:00Z')], games)).toEqual([])
  })
})
