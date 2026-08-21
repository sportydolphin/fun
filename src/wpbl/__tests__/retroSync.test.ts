import { describe, it, expect } from 'vitest'
// A plain .mjs cron script with no type declarations, imported rather than reimplemented: the
// parser IS the job. A copy of it living in the test would keep passing while the script it
// mirrors drifted, which is the same reasoning as trackingWatch.test.ts.
import { parseEventFile, toDetails, parseNames, TEAM_CODES } from '../../../scripts/sync-wpbl-retro.mjs'

// RetroWPBL is a hand transcription in Retrosheet's format. Everything that can go wrong here
// is quiet: a mis-parsed `info` line drops a field, a wrong team code hangs one game's weather
// on a different game, and "(none)" stored literally puts the string "(none)" on a page.

const EVENT = `id,NYH202608010
info,visteam,LAQ
info,hometeam,NYH
info,site,SPR03
info,date,2026/08/01
info,number,0
info,gametype,regular
info,starttime,5:00PM
info,daynight,night
info,umphome,dinek701
info,ump1b,mckej701
info,ump2b,(none)
info,ump3b,(none)
info,temp,72
info,winddir,ltor
info,fieldcond,wet
info,precip,drizzle
info,sky,overcast
info,timeofgame,167
start,davim201,"Mo'ne Davis",0,1,8
play,1,0,davim201,01,SX,E6/G
id,NYH202608080
info,hometeam,NYH
info,date,2026/08/08
info,timeofgame,121
`

describe('parseEventFile', () => {
  it('splits a file into one block per game', () => {
    const games = parseEventFile(EVENT)
    expect(games.map(g => g.id)).toEqual(['NYH202608010', 'NYH202608080'])
  })

  // 273 play lines a game, and none of them belong in this table: we already hold the
  // play-by-play from the feed in more depth, and a second copy would be a second truth.
  it('reads only the info records, ignoring starts and plays', () => {
    const [g] = parseEventFile(EVENT)
    expect(g.info.timeofgame).toBe('167')
    expect(Object.keys(g.info)).not.toContain('davim201')
  })

  it('keeps a value that contains a comma', () => {
    const [g] = parseEventFile('id,X\ninfo,note,rain delay, 40 minutes\n')
    expect(g.info.note).toBe('rain delay, 40 minutes')
  })

  it('is empty rather than throwing on an empty file', () => {
    expect(parseEventFile('')).toEqual([])
  })
})

describe('toDetails', () => {
  const [game] = parseEventFile(EVENT)
  const d = toDetails(game)

  it('pulls the four things the league feed does not have', () => {
    expect(d.first_pitch_local).toBe('5:00PM')
    expect(d.duration_minutes).toBe(167)
    expect(d.ump_home).toBe('dinek701')
    expect({ temp: d.temp_f, sky: d.sky, precip: d.precip, field: d.field_cond })
      .toEqual({ temp: 72, sky: 'overcast', precip: 'drizzle', field: 'wet' })
  })

  // The match key. Their id carries the home club and the date, but in their vocabulary.
  it('resolves the match key into our club id and an ISO date', () => {
    expect(d.date).toBe('2026-08-01')
    expect(d.homeTeamId).toBe('NY')
  })

  // Retrosheet writes "(none)" for a crew position nobody worked. Stored literally it renders.
  it('turns "(none)" into null rather than into text', () => {
    expect(d.ump_second).toBeNull()
    expect(d.ump_third).toBeNull()
  })

  it('leaves a game with no clock as nulls, not zeroes', () => {
    const bare = toDetails({ id: 'X', info: { hometeam: 'SFF', date: '2026/08/12' } })
    expect(bare.duration_minutes).toBeNull()
    expect(bare.first_pitch_local).toBeNull()
    expect(bare.temp_f).toBeNull()
  })

  // A club code we do not recognise must not fall through to a default: the sync skips an
  // unmatched game, and silently attaching one game's crew to another is the failure to avoid.
  it('refuses to guess at an unknown club code', () => {
    expect(toDetails({ id: 'X', info: { hometeam: 'XXX', date: '2026/08/12' } }).homeTeamId).toBeNull()
  })

  it('rejects a malformed date instead of passing it on', () => {
    expect(toDetails({ id: 'X', info: { hometeam: 'NYH', date: 'August 1' } }).date).toBeNull()
  })

  it('names the park it knows, and does not invent one it does not', () => {
    expect(d.park_id).toBe('SPR03')
    expect(d.park_name).toBe('Lanphier Park')
    expect(toDetails({ id: 'X', info: { site: 'ZZZ99' } }).park_name).toBeNull()
  })
})

describe('parseNames', () => {
  // UMPIRES2026.txt lists five officials and is stale: Emilie Herpick (herpe701) debuted on
  // Aug 12 and was never added, so the first sync wrote the literal string "herpe701" onto a
  // game page. biofile.csv has everyone and is the one that gets maintained.
  const UMPS = 'ID,last,first\ndinek701,Elliott Dine,Kelly\nmonaa701,Monachello,Annie\n'
  const BIO = 'PLAYERID,LAST,FIRST,NICKNAME\n"herpe701","Herpick","Emilie","Emilie"\n' +
    '"chare601","Charlesworth-Seiler","Emma","Emma"\n'

  it('finds an umpire the umpires file has never heard of', () => {
    expect(parseNames(UMPS, BIO).get('herpe701')).toBe('Emilie Herpick')
  })

  it('still reads the umpires file for anyone the biofile misses', () => {
    expect(parseNames(UMPS, BIO).get('monaa701')).toBe('Annie Monachello')
  })

  // Her id is in the coach range because she is one. She has umpired anyway.
  it('does not care which id range a person is in', () => {
    expect(parseNames(UMPS, BIO).get('chare601')).toBe('Emma Charlesworth-Seiler')
  })

  it('has no entry for an id in neither file, rather than a placeholder', () => {
    expect(parseNames(UMPS, BIO).get('nobod999')).toBeUndefined()
  })

  it('ignores a blank trailing line', () => {
    expect(parseNames('ID,last,first\ndelpb701,Delp,Brian\n\n', 'PLAYERID,LAST,FIRST\n').size).toBe(1)
  })
})

describe('the umpire crew', () => {
  // The `info` records are the assignment AT FIRST PITCH. NYH's Aug 8 game swapped the plate
  // umpire in the 6th, so reading them alone reported two officials for a game that had three.
  const CHANGED = `id,NYH202608080
info,hometeam,NYH
info,date,2026/08/08
info,umphome,beras701
info,ump1b,monaa701
com,"Around 1:15 rain delay"
com,"umpchange,6,umphome,monaa701"
com,"umpchange,6,ump1b,chare601"
play,1,0,davim201,01,SX,E6/G
`

  it('includes an umpire who arrived mid-game', () => {
    const d = toDetails(parseEventFile(CHANGED)[0])
    expect(d.crew).toEqual(['beras701', 'monaa701', 'chare601'])
  })

  it('does not list an umpire twice when they merely move position', () => {
    // monaa701 started at first and moved to the plate: one person, one entry.
    expect(toDetails(parseEventFile(CHANGED)[0]).crew.filter(id => id === 'monaa701')).toHaveLength(1)
  })

  it('reads umpchange out of the transcriber\'s ordinary prose comments', () => {
    // Hundreds of `com` lines are notes about a play. Only the umpchange token counts.
    const d = toDetails(parseEventFile(CHANGED)[0])
    expect(d.crew).not.toContain('Around 1:15 rain delay')
  })

  it('keeps the starting crew when nobody changed', () => {
    const d = toDetails(parseEventFile(EVENT)[0])
    expect(d.crew).toEqual(['dinek701', 'mckej701'])
  })

  // Aug 7 at LAQ was worked by one official, with "(none)" for every other position.
  it('handles a game worked by a single umpire', () => {
    const one = `id,LAQ202608070\ninfo,umphome,beras701\ninfo,ump1b,(none)\ninfo,ump2b,(none)\n`
    expect(toDetails(parseEventFile(one)[0]).crew).toEqual(['beras701'])
  })
})

describe('TEAM_CODES', () => {
  // Four clubs, and a wrong entry here is invisible: the row writes, it just lands on the
  // wrong game. Pinned against our own club ids.
  it('covers all four clubs and maps to our ids', () => {
    expect(TEAM_CODES).toEqual({ BSH: 'BOS', LAQ: 'LA', NYH: 'NY', SFF: 'SF' })
  })
})
