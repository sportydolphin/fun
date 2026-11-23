import { describe, it, expect } from 'vitest'
// Imported from the cron script rather than copied: the matcher IS the job, and a copy here
// would keep passing while the script drifted.
import {
  classifyCaption, playerIndex, fold, toRows, resignMessage, tokenWarning, ACCOUNTS, plannedMoves, etDate,
  needsReview, rosterSurnames, reviewMessage, tradeMessage, repeatsTrade, tradePushes,
} from '../../scripts/watch-wpbl-instagram.mjs'
import { ROSTERS_2026 } from '../wpbl/offseason2027'

// The watcher has two ways to be useless. Too loose, and the league's teaser posts ("who do you
// hope to see re-signed??") read as signings; too tight, and a real one is missed during a ten-day
// window that will not come round again. The captions below are the real ones from Nov 2026,
// shortened.

const players = [
  { id: '00000000-0000-0000-0000-000000000001', name: 'Ashton Lansdell' },
  { id: '00000000-0000-0000-0000-000000000002', name: 'Alexia Jorge' },
  { id: '00000000-0000-0000-0000-000000000003', name: 'Denae Benites' },
  { id: '00000000-0000-0000-0000-000000000004', name: 'Kelsie Whitmore' },
  { id: '00000000-0000-0000-0000-000000000005', name: 'Beth Greenwood' },
  { id: '00000000-0000-0000-0000-000000000006', name: 'Mo Li' },
]
const index = playerIndex(players)

describe('classifyCaption: real re-signings', () => {
  it('reads a player tagged by handle', () => {
    // The Queens wrote the handle, not the name. Folding makes the two the same string.
    const v = classifyCaption(
      'The crown still fits! 👑 The first re-signing of 2027 is officially in! Captain ashtonlansdell is running it back with the LA Queens!',
      index,
    )
    expect(v.kind).toBe('resign')
    expect(v.player_names).toEqual(['Ashton Lansdell'])
    expect(v.player_ids).toEqual(['00000000-0000-0000-0000-000000000001'])
  })

  it('reads a player named in full', () => {
    const v = classifyCaption(
      'For the Bay 🌉 Our first re-signing is here! Alexia Jorge will be back behind the plate with the Firebells in 2027.',
      index,
    )
    expect(v.kind).toBe('resign')
    expect(v.player_names).toEqual(['Alexia Jorge'])
  })

  it('reads a player named by a short first name', () => {
    // The Heights wrote "Val", the league's list says "Valerie" (Nov 19, 2026).
    const idx = playerIndex([...players, { id: 'val', name: 'Valerie Perez' }])
    const v = classifyCaption(
      'Val Perez will be back at it with the Heights in 2027. 💪 Perez will bring her wealth of talent back to the Heights.',
      idx,
    )
    expect(v.kind).toBe('resign')
    expect(v.player_ids).toEqual(['val'])
    expect(classifyCaption('Valerie Perez, also known as Val Perez, is back with the Heights!', idx).player_ids).toEqual(['val'])
  })

  it('reads "back to <club> in 2027"', () => {
    const idx = playerIndex([...players, { id: 'ayuri', name: 'Ayuri Shimano' }])
    const v = classifyCaption('Ayuri Shimano will bring her power, speed, and versatility back to LA in 2027. 🌴 Always a Queen!', idx)
    expect(v.player_ids).toEqual(['ayuri'])
    expect(classifyCaption('Time to go back to basics, Ayuri Shimano. See you in 2027.', idx).kind).toBe('other')
  })

  it('ignores a short first name two players share', () => {
    const idx = playerIndex([
      { id: 'a', name: 'Alexandra Moreno' },
      { id: 'b', name: 'Alexis Moreno' },
    ])
    expect(classifyCaption('Alex Moreno is back with the Queens!', idx).kind).toBe('other')
    expect(classifyCaption('Alexis Moreno is back with the Queens!', idx).player_ids).toEqual(['b'])
  })

  it('catches the wording without the word "re-sign"', () => {
    expect(classifyCaption('Kelsie Whitmore is back with the Firebells for 2027!', index).kind).toBe('resign')
  })

  it('catches "staying in" with the season', () => {
    expect(classifyCaption('She’s backkkk!! 👏 Beth Greenwood is staying in the nest in 2027. 🪹🦅', index).kind).toBe('resign')
    expect(classifyCaption('Beth Greenwood is staying in Australia this winter.', index).kind).toBe('other')
  })

  it('refuses a jersey post that names a player', () => {
    expect(classifyCaption('They’re back. 👏 Official home, away, and Denae Benites player jerseys are available now.', index).kind).toBe('other')
  })

  it('catches "will remain with"', () => {
    expect(classifyCaption('Beth Greenwood will remain with the New York Heights in 2027.', index).kind).toBe('resign')
  })

  it('names every player in a joint announcement', () => {
    const v = classifyCaption('Re-signed: Ashton Lansdell and Denae Benites.', index)
    expect(v.player_names.sort()).toEqual(['Ashton Lansdell', 'Denae Benites'])
  })
})

describe('classifyCaption: what it must refuse', () => {
  it('refuses re-signing wording that names nobody', () => {
    expect(classifyCaption('Discussions are underway. 🗣️ Who do you hope to see re-signed during the Exclusive Player Re-signing Window??', index).kind)
      .toBe('other')
  })

  it('refuses a name with no re-signing wording', () => {
    expect(classifyCaption('Wishing a very HBD to our very own Beth Greenwood!! 🥳', index).kind).toBe('other')
  })

  it('refuses Banana Ball signings, even in re-signing words', () => {
    // The same accounts announce them, and "returning" is exactly the wording a re-signing uses.
    expect(classifyCaption('Denae is returning to Bananaland! Denae Benites will be back on the 2027 World Tour.', index).kind)
      .toBe('other')
    expect(classifyCaption('Kelsie Whitmore will play her third year with thesavbananas, re-signed for Banana Ball 2027!', index).kind)
      .toBe('other')
  })

  it('matches a short name only as whole words', () => {
    // "moli" sits inside plenty of folded words, so a name this short never matches folded.
    expect(index.has(fold('Mo Li'))).toBe(false)
    expect(classifyCaption('Among lions, the Firebells are back with the Bay in 2027!', index).kind).toBe('other')
    expect(classifyCaption('Mo Li will return to the San Francisco Firebells in 2027!', index).player_names).toEqual(['Mo Li'])
    expect(classifyCaption('Captain moli is back with the Firebells in 2027!', index).player_names).toEqual(['Mo Li'])
  })

  it('reads the Jua Park post (Nov 20, 2026)', () => {
    const idx = playerIndex([{ id: 'park', name: 'Jua Park' }])
    const v = classifyCaption(
      'The South Korean star is back for more. 🌉 A productive hitter and versatile defender, Jua Park will return to the San Francisco Firebells in 2027! Welcome back!!',
      idx)
    expect(v).toEqual({ kind: 'resign', player_ids: ['park'], player_names: ['Jua Park'] })
  })

  it('treats a missing caption as nothing', () => {
    expect(classifyCaption(null, index).kind).toBe('other')
  })
})

describe('fold', () => {
  it('drops accents, case and punctuation', () => {
    expect(fold("Claire O'Sullivan")).toBe('claireosullivan')
    expect(fold('Ayami Satō')).toBe('ayamisato')
  })
})

describe('toRows and the message', () => {
  it('gives a club account its team and the league account none', () => {
    const media = [{ id: '1', caption: 'x', timestamp: '2026-11-10T21:20:00+0000', permalink: 'https://www.instagram.com/p/a/', media_type: 'IMAGE' }]
    const queens = ACCOUNTS.find(a => a.handle === 'wpbl_queens')!
    const league = ACCOUNTS.find(a => a.handle === 'wpbl_official')!
    expect(toRows(queens, media, index)[0].team_id).toBe('LA')
    expect(toRows(league, media, index)[0].team_id).toBeNull()
  })

  it('labels the player and club, and ends on the link so Discord unfurls it', () => {
    const msg = resignMessage({ team_id: 'SF', player_names: ['Alexia Jorge'], permalink: 'https://www.instagram.com/p/DfnsnRFCOgz/' })
    expect(msg).toBe('✍️ **Re-signed: Alexia Jorge**, San Francisco Firebells\nhttps://www.instagram.com/p/DfnsnRFCOgz/')
  })

  it('counts the token warning down and then says it lapsed', () => {
    expect(tokenWarning(1)).toContain('lapses in 1 day.')
    expect(tokenWarning(6.2)).toContain('lapses in 7 days.')
    expect(tokenWarning(-1)).toContain('has lapsed')
  })
})

// The rosters on Home read wpbl_roster_moves, so these rules are what stands between a caption
// and a public claim about a real player's job. Real ids from the league's 2026 lists.
const ASHTON = '030a471e-8821-481c-a1e1-aa3f3789e46e' // LA
const ALEXIA = '9e22846e-a73a-4202-a359-1a71138c5105' // SF
const resign = (over: Record<string, unknown> = {}) => ({
  account: 'wpbl_queens', team_id: 'LA', permalink: 'https://www.instagram.com/p/Dfk27nylCmM/',
  posted_at: '2026-11-10T21:20:00+0000', player_ids: [ASHTON], player_names: ['Ashton Lansdell'],
  ...over,
})

describe('plannedMoves: what reaches the rosters', () => {
  it('records a club re-signing its own player, dated in the league time zone', () => {
    // 21:20 UTC on Nov 10 is still Nov 10 in New York; 03:00 UTC on Nov 12 is Nov 11 there.
    const { moves, skipped } = plannedMoves(resign(), [])
    expect(skipped).toEqual([])
    expect(moves).toEqual([{
      season: 2027, kind: 're-signed', player_id: ASHTON, player_name: null, team_id: 'LA',
      announced_on: '2026-11-10', source_url: 'https://www.instagram.com/p/Dfk27nylCmM/',
    }])
    expect(etDate('2026-11-12T03:00:00Z')).toBe('2026-11-11')
  })

  it('lets the league account post for any club', () => {
    const { moves } = plannedMoves(resign({ account: 'wpbl_official', team_id: null }), [])
    expect(moves[0]?.team_id).toBe('LA')
  })

  it('refuses a club naming another club\'s player', () => {
    const { moves, skipped } = plannedMoves(resign({ player_ids: [ALEXIA], player_names: ['Alexia Jorge'] }), [])
    expect(moves).toEqual([])
    expect(skipped[0]).toContain('SF')
  })

  it('refuses a player already recorded, by hand or by an earlier run', () => {
    const { moves, skipped, already } = plannedMoves(resign(), [{ player_id: ASHTON, team_id: 'LA' }])
    expect(moves).toEqual([])
    expect(skipped).toEqual([])
    expect(already).toEqual(['Ashton Lansdell'])
  })

  it('refuses a post outside the window', () => {
    expect(plannedMoves(resign({ posted_at: '2027-03-01T15:00:00Z' }), []).moves).toEqual([])
  })

  it('records a re-signing a club reveals after the window closes', () => {
    // Madison Willan's post, Nov 21, 2026, the morning after the deadline.
    expect(plannedMoves(resign({ posted_at: '2026-11-21T15:46:56Z' }), []).moves).toHaveLength(1)
    expect(plannedMoves(resign({ posted_at: '2026-12-01T05:00:00Z' }), []).moves).toEqual([])
  })

  it('refuses a player on no 2026 roster', () => {
    const { skipped } = plannedMoves(resign({ player_ids: ['00000000-0000-0000-0000-000000000009'], player_names: ['New Name'] }), [])
    expect(skipped[0]).toContain('not on a 2026 roster')
  })

  const row = (over: Record<string, unknown>) => ({
    id: 1, season: 2027, kind: 're-signed', player_name: null, from_team_id: null, trade_id: null,
    draft_round: null, announced_on: '2026-11-12', ...over,
  })
  const LA_OTHERS = ROSTERS_2026.LA.filter(id => id !== ASHTON)

  it('stops at ten per club', () => {
    const ten = LA_OTHERS.slice(0, 10).map((id, i) => row({ id: i + 1, player_id: id, team_id: 'LA' }))
    expect(plannedMoves(resign(), ten).skipped[0]).toContain('already has 10')
  })

  it('counts a player traded in toward the ten, and one traded away out of it', () => {
    const nine = LA_OTHERS.slice(0, 9).map((id, i) => row({ id: i + 1, player_id: id, team_id: 'LA' }))
    const inbound = row({ id: 50, kind: 'traded', player_id: ROSTERS_2026.SF[0], team_id: 'LA', from_team_id: 'SF', trade_id: 't' })
    expect(plannedMoves(resign(), [...nine, inbound]).skipped[0]).toContain('already has 10')
    const outbound = row({ id: 51, kind: 'traded', player_id: LA_OTHERS[0], team_id: 'SF', from_team_id: 'LA', trade_id: 'u', announced_on: '2026-11-13' })
    expect(plannedMoves(resign(), [...nine, inbound, outbound]).moves).toHaveLength(1)
  })

  it('says in Discord what was added and what was not', () => {
    const msg = resignMessage(resign(), { recorded: ['Ashton Lansdell'], already: ['Alexia Jorge'], skipped: ['Someone: not on a 2026 roster'] })
    expect(msg).toContain('Added to the 2027 rosters: Ashton Lansdell')
    expect(msg).toContain('Already on the 2027 rosters: Alexia Jorge')
    expect(msg).toContain('Not added: Someone: not on a 2026 roster')
    expect(msg.endsWith('https://www.instagram.com/p/Dfk27nylCmM/')).toBe(true)
  })
})

describe('playerIndex: one id per name', () => {
  it('prefers the id on the league\'s 2026 list over an unmerged duplicate', () => {
    const idx = playerIndex([
      { id: 'dupe-row', name: 'Ashton Lansdell' },
      { id: ASHTON, name: 'Ashton Lansdell' },
    ])
    expect(classifyCaption('Ashton Lansdell is running it back!', idx).player_ids).toEqual([ASHTON])
  })
})

describe('the re-signing push', () => {
  it('names the player and club, and lands on the rosters page', async () => {
    const { buildWpblResign } = await import('../../shared/notifications.js')
    const n = buildWpblResign({ playerId: 'p1', playerName: 'Alexia Jorge', teamName: 'San Francisco Firebells', season: 2027 })
    expect(n).toMatchObject({
      id: 'wpbl-resign:p1', type: 'wpbl-resign',
      title: 'Re-signed: Alexia Jorge', body: 'San Francisco Firebells, 2027', url: '/wpbl/rosters',
    })
  })
})

describe('needsReview: the loose net during the window', () => {
  // Real roster ids, since a surname only counts for a player on a 2026 roster.
  const roster = [
    { id: '69a50af7-c4ed-4758-b2e6-cceaf9d83473', name: 'Valerie Perez' },
    { id: '1142dad3-3520-48f2-94ea-78346f4d177c', name: 'Denae Benites' },
    { id: 'not-rostered', name: 'Somebody Longname' },
  ]
  const idx = playerIndex(roster)
  const sur = rosterSurnames(roster)
  const review = (c: string) => needsReview(c, idx, sur)

  it('flags a surname alone', () => {
    expect(review('Perez brings her leadership to New York again.')?.player_names).toEqual(['Valerie Perez'])
  })

  it('flags return wording that names nobody', () => {
    expect(review('Welcome back, number twelve! See you in 2027.')?.player_names).toEqual([])
  })

  it('flags a caption that leaves it to the image', () => {
    expect(review('Just a little lore drop for the timeline. 😉')).not.toBeNull()
  })

  it('lets a plain sponsor or event post go by', () => {
    expect(review('The WPBL is proud to partner with Aerial Performance Skincare. Aerial creates beauty products for women in motion.')).toBeNull()
    expect(review('Join us on December 4th from 5-8pm to celebrate the first-ever WPBL Champions: the Los Angeles Queens.')).toBeNull()
  })

  it('never flags Banana Ball', () => {
    expect(review('Heights fans, keep an eye on the dugout during Firefighters games throughout the 2027 Banana Ball World Tour: Val Perez!')).toBeNull()
  })

  it('ignores the surname of a player on no 2026 roster', () => {
    expect(review('Longname was great at the clinic today, thank you all for coming out to see us.')).toBeNull()
  })

  it('says what it is and where to record it', () => {
    const msg = reviewMessage({ team_id: 'NY', account: 'wpbl_heights', caption: 'Perez  is\nback', permalink: 'https://www.instagram.com/p/x/' }, ['Valerie Perez'])
    expect(msg).toContain('Possible re-signing, not recorded**, New York Heights')
    expect(msg).toContain('Players: Valerie Perez')
    expect(msg).toContain('> Perez is back')
    expect(msg.endsWith('https://www.instagram.com/p/x/')).toBe(true)
  })
})

// The first trade, Nov 21, 2026, as the league and both clubs posted it.
describe('trades: flagged, never recorded', () => {
  const ZETT = 'ff1f001e-32ac-442d-b3aa-6bde77fec86c'
  const index = playerIndex([{ id: ZETT, name: 'Alyssa Zettlemoyer' }])

  it('reads all three posts as a trade, even the one that says re-signing', () => {
    for (const caption of [
      'Prior to the close of the Exclusive Player Re-signing Window, the New York Heights agreed to trade C/IF Alyssa Zettlemoyer to the Boston Hunters in exchange for Boston’s 6th round draft pick.',
      'We have traded C/IF Alyssa Zettlemoyer to the Boston Hunters in exchange for a 6th round pick.',
      'We’re excited to welcome Alyssa Zettlemoyer to the Boston Hunters! In exchange for Zettlemoyer joining the Hunters in 2027, New York Heights will receive our 6th round draft pick.',
    ]) expect(classifyCaption(caption, index)).toMatchObject({ kind: 'trade', player_ids: [ZETT] })
    expect(classifyCaption('Alyssa Zettlemoyer trading cards are in the shop!', index).kind).toBe('other')
  })

  it('pings once per trade, however many accounts post it', () => {
    const post = (at: string, ids = [ZETT]) => ({ posted_at: at, player_ids: ids })
    expect(repeatsTrade(post('2026-11-21T21:13:25Z'), [post('2026-11-21T21:13:02Z')])).toBe(true)
    expect(repeatsTrade(post('2026-11-28T21:13:25Z'), [post('2026-11-21T21:13:02Z')])).toBe(false)
    expect(repeatsTrade(post('2026-11-21T21:13:25Z', ['x']), [post('2026-11-21T21:13:02Z')])).toBe(false)
    expect(tradeMessage({ team_id: 'BOS', player_names: ['Alyssa Zettlemoyer'], permalink: 'https://x' }))
      .toContain('Trade: Alyssa Zettlemoyer**, posted by Boston Hunters')
  })

  it('pushes a recorded trade as who got what', () => {
    const base = { season: 2027, kind: 'traded', player_name: null, trade_id: 't1', draft_pick: null, announced_on: '2026-11-21', source_url: 'https://x' }
    const [n] = tradePushes([
      { ...base, id: 34, player_id: ZETT, team_id: 'BOS', from_team_id: 'NY', draft_round: null },
      { ...base, id: 35, player_id: null, team_id: 'NY', from_team_id: 'BOS', draft_round: 6 },
    ], () => 'Alyssa Zettlemoyer')
    expect(n).toMatchObject({ id: 'wpbl-trade:t1', title: 'Trade: Boston and New York', body: 'Boston gets Alyssa Zettlemoyer. New York gets a 2027 6th-round pick.' })
  })
})
