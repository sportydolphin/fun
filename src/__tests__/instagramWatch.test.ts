import { describe, it, expect } from 'vitest'
// Imported from the cron script rather than copied: the matcher IS the job, and a copy here
// would keep passing while the script drifted.
import {
  classifyCaption, playerIndex, fold, toRows, resignMessage, tokenWarning, ACCOUNTS, plannedMoves, etDate,
} from '../../scripts/watch-wpbl-instagram.mjs'

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

  it('catches the wording without the word "re-sign"', () => {
    expect(classifyCaption('Kelsie Whitmore is back with the Firebells for 2027!', index).kind).toBe('resign')
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

  it('skips names too short to match safely inside a folded caption', () => {
    // "moli" sits inside plenty of folded words; a two-part name this short is left out.
    expect(index.has(fold('Mo Li'))).toBe(false)
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

  it('refuses a player on no 2026 roster', () => {
    const { skipped } = plannedMoves(resign({ player_ids: ['00000000-0000-0000-0000-000000000009'], player_names: ['New Name'] }), [])
    expect(skipped[0]).toContain('not on a 2026 roster')
  })

  it('stops at ten per club', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ player_id: `x${i}`, team_id: 'LA' }))
    expect(plannedMoves(resign(), ten).skipped[0]).toContain('already has 10')
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
