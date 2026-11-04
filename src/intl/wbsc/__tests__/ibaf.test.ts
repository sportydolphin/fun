import { describe, expect, it } from 'vitest'
import { transformGame, validateGame } from '../game'
import {
  boxScoreUrl, IBAF_2010_EVENT_URL, IBAF_2010_SOURCE, ibafGameId, ibafPitcherNames, ibafRound, lineInnings, parseIbafGame, parseIbafRoster, scorerNotes,
  splitIbafName,
} from '../ibaf'
import { legacyPlays, resolveName } from '../legacy'

// A game written by hand in the shape of IBAF's 2010 pages (an Automated ScoreBook report), never
// copied from one: the same tables, headings and sentences, with made-up players.

const cell = (s: string | number) => `<td align=right><font face=verdana size=1 color="#000000">${s}&nbsp;</td>\n`
const row = (cells: (string | number)[]) => `<tr bgcolor="#ffffff">\n${cells.map(cell).join('')}</tr>\n`
const head = (team: string, cols: string[]) => `<tr bgcolor="#00008b">\n${[team, ...cols].map(c => `<td><font face=verdana size=1 color="#ffffff"><b>${c}&nbsp;</b></td>\n`).join('')}</tr>\n`
const BAT = ['ab', 'r', 'h', 'rbi', '2b', '3b', 'hr', 'bb', 'sb', 'cs', 'hp', 'sh', 'sf', 'so', 'ibb', 'kl', 'gdp', 'po', 'a', 'e']
const PIT = ['ip', 'h', 'r', 'er', 'bb', 'so', 'wp', 'bk', 'hbp', 'ibb', 'ab', 'bf', 'fo', 'go', 'np']
// ab r h rbi 2b 3b hr bb sb cs hp sh sf so ibb kl gdp po a e
const bat = (name: string, v: Partial<Record<string, number>>) => row([name, ...BAT.map(c => v[c] ?? 0)])

const GAME = `<html><body>
<a name="GAME.CMP"> </a>
<font size=3><b>
IV Women World Cup<br>
JAPAN at CANADA - Composite Box Score<br>
Aug 14, 2010 at Maracay (Jose Perez C.)<br>
</b></font>
<table border=0>
${head('JAPAN', BAT)}${bat('AOKI M ss', { ab: 1, r: 1, h: 1 })}${bat('BABA K 2b', { ab: 1, r: 1, h: 1, rbi: 2, hr: 1 })}${bat('CHIBA R 1b', { ab: 1, so: 1, po: 1 })}${bat('DOI S c', { ab: 1, po: 1 })}${bat('ENDO N p', { ab: 1 })}${row(['Totals', 5, 2, 2, 2, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0])}
</table>
<table border=0>
${head('CANADA', BAT)}${bat('FOX A cf', { bb: 1 })}${bat('GRAY B lf', { ab: 1, so: 1 })}${bat('HILL C 1b', { ab: 1, po: 2 })}${bat('IRWIN D p', { po: 1 })}${row(['Totals', 2, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0])}
</table>
<table border=0>
${head('JAPAN', PIT)}${row(['ENDO Nana  W,1-0', '1.0', 0, 0, 0, 1, 1, 0, 0, 0, 0, 2, 3, 0, 1, 15])}
<tr><td>&nbsp;</td></tr>
${head('CANADA', PIT)}${row(['IRWIN Dana  L,0-1', '1.0', 2, 2, 2, 0, 1, 0, 0, 0, 0, 5, 5, 1, 1, 18])}
</table>
<br>Start: 11:00   Time: 0:25   Attendance: 800
<a name="GAME.PLY"> </a>
<font face=verdana size=2>
JAPAN starters: 1/ss AOKI M; 2/2b BABA K; 3/1b CHIBA R; 4/c DOI S; 5/p ENDO N;
</font>
<font face=verdana size=2>
CANADA starters: 6/cf FOX A; 7/lf GRAY B; 8/1b HILL C; 9/p IRWIN D;
</font>
<font size=2><b>JAPAN 1st - </b></font>AOKI M singled to center field (0-0). BABA K homered to left field, 2 RBI (1-1
BK); AOKI M scored. COACHING VISIT TO MOUND. CHIBA R struck out swinging (0-2 KS). DOI S grounded out to 1b
unassisted (0-0). ENDO N flied out to cf (0-1 K). <i><b>2 runs, 2 hits, 0 errors, 0
LOB.</b></i>
<font size=2><b>CANADA 1st - </b></font>FOX A walked (3-0 BBBB). GRAY B struck out looking (0-2 KK).
HILL C grounded into double play ss to 2b to 1b (0-0); FOX A out on the play. <i><b>0 runs, 0 hits, 0 errors, 0 LOB.</b></i>
<a name="end"> </a>
<a name="GAME.LIN"> </a>
<pre>
JAPAN............... 2 - 2 2 0
CANADA.............. 0 - 0 0 0
</pre>
Pitchers: JAPAN - ENDO Nana. CANADA - IRWIN Dana.
</body></html>`

const LIST = `<table>${row(['AOKI Mai, JPN', '.500'])}${row(['BABA Kaori, JPN', '.500'])}${row(['CHIBA Rin, JPN', '.000'])}${row(['DOI Saki, JPN', '.000'])}`
  + `${row(['FOX Abby, CAN', '.000'])}${row(['GRAY Beth, CAN', '.000'])}${row(['HILL Cara, CAN', '.000'])}</table>`

describe('IBAF 2010 pages', () => {
  const roster = parseIbafRoster(LIST, ibafPitcherNames(GAME))

  it('takes the batters from the league list and the pitchers who never batted from the pitching tables', () => {
    expect(roster.map(p => `${p.team} ${p.last_name}, ${p.first_name}`)).toEqual([
      'CAN FOX, Abby', 'CAN GRAY, Beth', 'CAN HILL, Cara', 'CAN IRWIN, Dana',
      'JPN AOKI, Mai', 'JPN BABA, Kaori', 'JPN CHIBA, Rin', 'JPN DOI, Saki', 'JPN ENDO, Nana',
    ])
  })

  it('reads a game into a legacy page that passes every check game.ts makes', () => {
    const { page, problems } = parseIbafGame(GAME, roster, 12)
    expect(problems).toEqual([])
    expect(validateGame(page, { legacy: true })).toEqual([])
    const g = page.gameData
    expect([g.id, g.awayioc, g.awayruns, g.homeioc, g.homeruns, g.innings, g.gametypelabel, g.start]).toEqual(
      [ibafGameId(12), 'JPN', 2, 'CAN', 0, 1, 'Round 1', '2010-08-14 11:00:00'])
    const rows = transformGame(page, { key: '2010-womens-baseball-world-cup', year: 2010, name: 'x', legacy: true, ibaf: true })
    expect(rows.players.find(p => p.last_name === 'Baba')?.name).toBe('Kaori Baba')
    expect(rows.plays.map(p => p.event_type)).toEqual(['single', 'home_run', 'strikeout', 'groundout', 'flyout', 'walk', 'strikeout', 'groundout'])
    expect(rows.plays[1]).toMatchObject({ pitch_sequence: 'BCX', runs_scored: 2, first_base: 'Mai Aoki', pitcher_name: 'Dana Irwin' })
    expect(rows.pitching.find(p => p.decision === 'W')).toMatchObject({ outs: 3, bf: 3 })
  })

  it('fails a game whose half the line score disagrees with', () => {
    const { problems } = parseIbafGame(GAME.replace('JAPAN............... 2 - 2', 'JAPAN............... 3 - 3'), roster, 12)
    expect(problems).toContain('JPN: inning 1 play-by-play says 2 runs, line score has 3')
  })

  it('fails a name that is nobody on the list', () => {
    const { problems } = parseIbafGame(GAME.replace('DOI S c', 'DORE S c'), roster, 12)
    expect(problems.some(p => p.includes('"DORE S" is nobody'))).toBe(true)
  })
})

describe('IBAF 2010 pieces', () => {
  it('splits a listed name into surname and given name', () => {
    expect(splitIbafName('BATISTA Dayana')).toEqual({ last_name: 'BATISTA', first_name: 'Dayana' })
    expect(splitIbafName('McCANN Amy')).toEqual({ last_name: 'McCANN', first_name: 'Amy' })
    expect(splitIbafName('VAN DER BERG Lia')).toEqual({ last_name: 'VAN DER BERG', first_name: 'Lia' })
    expect(splitIbafName('LOKKEN H Letticia')).toEqual({ last_name: 'LOKKEN', first_name: 'H Letticia' })
    expect(splitIbafName('KIM HEE JEOM')).toEqual({ last_name: 'KIM', first_name: 'HEE JEOM' })
  })

  it('reads a line score, double-digit innings and an unplayed half included', () => {
    expect(lineInnings('100 (10)46')).toEqual([1, 0, 0, 10, 4, 6])
    expect(lineInnings('471 5X')).toEqual([4, 7, 1, 5, null])
  })

  it('names the rounds by game number', () => {
    expect([1, 25, 26, 40, 41, 42, 43, 44, 46, 47].map(ibafRound)).toEqual(
      ['Round 1', 'Round 1', 'Round 2', 'Round 2', '5th Place Game', '9th Place Game', '7th Place Game', 'Semifinals', 'Bronze', 'Gold'])
  })

  it('links a 2010 game to its archived page and any other to wbsc.org', () => {
    expect(boxScoreUrl(IBAF_2010_EVENT_URL, ibafGameId(4))).toBe(`https://web.archive.org/web/2010/${IBAF_2010_SOURCE}/04.htm`)
    expect(boxScoreUrl('https://www.wbsc.org/en/events/x/schedule-and-results', 201054)).toBe('https://www.wbsc.org/en/events/x/schedule-and-results/box-score/201054')
  })

  it("drops the scorer's capitals notes and the two hand entries the next sentence contradicts", () => {
    const notes: string[] = []
    expect(scorerNotes([
      'AOKI M advanced to second on a wild pitch.', 'AOKI ADVANCED TO 2ND BY DEFENSIVE INDIFERENCE.',
      'OBR 13 RUNNER OUT BY INTERFERENCE.', 'Coaching visit to mound.',
      'BABA K struck out swinging (0-2 KS).', 'KAORI OUT BY RULE, BUNTING 3RD STRIKE INTO FOUL.',
      'CHIBA R pinch ran for DOI S.', 'CHIBA R pinch hit.',
      'ENDO N pinch ran for FOX A.', 'Batter set to GRAY B.', 'ENDO N placed on second.',
    ], n => notes.push(n))).toEqual([
      'AOKI M advanced to second on a wild pitch.', 'BABA K struck out swinging (0-2 KS).', 'CHIBA R pinch hit.',
      'Batter set to GRAY B.', 'ENDO N placed on second.',
    ])
    expect(notes).toEqual(['"CHIBA R pinch ran for DOI S." dropped: the next sentence has CHIBA R pinch hit'])
  })
})

describe('legacy.ts, for IBAF', () => {
  it('reads a given name written in capitals when nothing else fits', () => {
    const kim = { id: 1, first_name: 'Hee Jeom', last_name: 'KIM' }
    expect(resolveName('KIM HEE JEOM', [kim, { id: 2, first_name: 'Su Jin', last_name: 'KIM' }])).toBe(kim)
  })

  it('with no stored outs, holds every half but the last to three', () => {
    const batting = [{ id: 1, first_name: 'Mai', last_name: 'AOKI' }]
    const half = (inning: number, half: 'top' | 'bottom', narratives: string[]) => ({
      inning, half, batting,
      rows: narratives.map((narrative, i) => ({ playorder: inning * 10 + i, pitcherid: 9, batterid: 0, inning, narrative, outs: null })),
    })
    const out = 'AOKI M grounded out to ss (0-0).'
    const { problems } = legacyPlays([half(1, 'top', [out, out]), half(1, 'bottom', [out, out, out]), half(2, 'top', [out])])
    expect(problems).toEqual(['inning 1 top: ends on 2 outs'])
  })
})
