import { describe, it, expect } from 'vitest'
import { airOut, baserunningEvent, paEventType } from '../codes'
import { inningsToOuts, playerLines, surnameCase, transformGame, validateGame } from '../game'
import { inertiaFromHtml, unescapeAttribute } from '../page'
import { EVENT, fixturePage, row } from './fixture'

// The importer against a synthetic game (fixture.ts): every check it makes, every code it maps,
// and the three surprises the first real run turned up. The engines' half is engines.test.ts.

describe('the page', () => {
  it('reads the data-page attribute, entities and all', () => {
    const json = JSON.stringify({ component: 'BoxScore/index', props: { name: "O'Sullivan & Day-Bédard" }, url: '/x', version: 'v1' })
    const attr = json.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
    const page = inertiaFromHtml<{ name: string }>(`<div id="app" data-page="${attr}"></div>`)
    expect(page.props.name).toBe("O'Sullivan & Day-Bédard")
    expect(page.version).toBe('v1')
  })

  it('fails loudly when the markup has changed', () => {
    expect(() => inertiaFromHtml('<div id="app"></div>')).toThrow(/data-page/)
  })

  it('decodes numeric entities', () => {
    expect(unescapeAttribute('&#x27;&#39;&lt;')).toBe("''<")
  })
})

describe('small readers', () => {
  it('reads innings notation as outs, never as a decimal', () => {
    expect(inningsToOuts('4.2')).toBe(14)
    expect(inningsToOuts('0.1')).toBe(1)
    expect(inningsToOuts('2.0')).toBe(6)
    expect(inningsToOuts('4.67')).toBeNull()
    expect(inningsToOuts('4.3')).toBeNull()
  })

  it('cases a surname WBSC writes in capitals', () => {
    expect(surnameCase('MARCANO  VIZCARRONDO')).toBe('Marcano Vizcarrondo')
    expect(surnameCase("O'SULLIVAN")).toBe("O'Sullivan")
    expect(surnameCase('DAY-BÉDARD')).toBe('Day-Bédard')
    expect(surnameCase('DE LEIJA')).toBe('De Leija')
    expect(surnameCase('O ` SULLIVAN')).toBe("O'Sullivan")
  })
})

describe('codes', () => {
  it('reads the kind of air out from the narrative, not result3', () => {
    // result3 says F on all of these; only the narrative's notation tells them apart.
    expect(airOut('flies out to right field. F9. 1 out.')).toBe('flyout')
    expect(airOut('flies out foul. FF2. 3 out.')).toBe('foul_out')
    expect(airOut('pops out foul. FP3. 2 out.')).toBe('foul_out')
    expect(airOut('lines out foul. FL5. 3 out.')).toBe('foul_out')
    expect(airOut('flies out. P3. 2 out.')).toBe('popup')
    expect(airOut('lines out. L6. 2 out.')).toBe('lineout')
    expect(airOut('flies out to deep right field. Sacrifice Fly. SF9.')).toBe('sacrifice')
    expect(airOut('flies out.')).toBeNull()
  })

  it('maps the plate-appearance results, and nothing it has not seen', () => {
    expect(paEventType(row({ result2: 13 }))).toBe('walk')
    expect(paEventType(row({ result2: 14 }))).toBe('intent_walk')
    expect(paEventType(row({ result2: 5 }))).toBe('groundout')
    expect(paEventType(row({ result2: 21 }))).toBe('home_run')
    expect(paEventType(row({ result2: 999 }))).toBeNull()
  })

  it('names one baserunning event per row, an out before an advance', () => {
    expect(baserunningEvent(row({ runner1to2: 34 }))).toBe('stolen_base')
    expect(baserunningEvent(row({ runner1to2: 34, runner2to3: 31 }))).toBe('stolen_base')
    expect(baserunningEvent(row({ runner3to4: 31 }))).toBe('wild_pitch')
    expect(baserunningEvent(row({ runner1out: 26, runner2to3: 34, narrative: 'out at 2nd CS26.' }))).toBe('caught_stealing')
    expect(baserunningEvent(row({ runner1out: 13, narrative: 'out at 1st PO13.' }))).toBe('pickoff')
    expect(baserunningEvent(row({ runner1out: 13, narrative: 'out at 1st.' }))).toBe('unknown_out')
    expect(baserunningEvent(row({ runner1to2: 77 }))).toBe('unknown_advance')
    expect(baserunningEvent(row({}))).toBeNull()
  })
})

describe('validation', () => {
  it('passes the fixture', () => {
    expect(validateGame(fixturePage())).toEqual([])
  })

  it('catches a play log that disagrees with the line score', () => {
    const page = fixturePage()
    page.gamePlays.all['1'].top![5].runs = 2
    const problems = validateGame(page)
    expect(problems).toContain('AAA: inning 1 play log scores 2, line score has 1')
    expect(problems).toContain('AAA: play log scores 3, final is 2')
  })

  it('catches a box score that disagrees with the final', () => {
    const page = fixturePage()
    const bySpot = page.boxScore['20'] as Record<string, { r: number }[]>
    bySpot['1'][0].r = 0
    expect(validateGame(page)).toContain('HHH: box score runs 0, final is 1')
  })

  it('refuses a code it does not know, rather than filing it as unknown', () => {
    const page = fixturePage()
    page.gamePlays.all['2'].bot![0].result2 = 77
    expect(validateGame(page).join('\n')).toMatch(/unknown plate-appearance result 77/)
  })

  it('refuses a stale batter id the narrative does not explain', () => {
    const page = fixturePage()
    page.gamePlays.all['2'].top![5].narrative = 'Somebody lines out. L6. 2 out.'
    expect(validateGame(page).join('\n')).toMatch(/lineup slot 1041 is ECHO, and the narrative names neither/)
  })

  it('refuses a game that is not final', () => {
    const page = fixturePage()
    page.gameData.gamestatustext = ''
    expect(validateGame(page)).toContain('not final (status "")')
  })

  it('refuses innings that are not innings notation', () => {
    const page = fixturePage()
    const bySpot = page.boxScore['10'] as Record<string, { pitch_ip: string }[]>
    bySpot['90'][0].pitch_ip = '1.67'
    expect(validateGame(page).join('\n')).toMatch(/PITCH-AWAY pitched "1.67" innings/)
  })
})

describe('box score', () => {
  it('sums the two rows of a player who changed role, rather than keeping one', () => {
    const kilo = playerLines(fixturePage(), 20).find(p => p.playerid === 204)!
    expect(kilo.spot).toBe(4)        // the batting spot, not the pitchers' 90
    expect(kilo.pa).toBe(1)          // from the batting row
    expect(kilo.pitch_outs).toBe(3)  // from the pitching row
    expect(kilo.field_po + kilo.field_a).toBe(2) // one from each
  })
})

describe('transform', () => {
  const rows = transformGame(fixturePage(), EVENT)

  it('writes the game with only the halves that were played', () => {
    expect(rows.game).toMatchObject({
      id: 'wbsc:g:500', status: 'final', game_date: '2026-07-22', innings: 2,
      away_team_id: 'AAA', home_team_id: 'HHH', away_score: 2, home_score: 1,
      duration_minutes: 65, attendance: 1234,
    })
    expect(rows.game.away_line).toEqual([{ inning: 1, runs: 1 }, { inning: 2, runs: 1 }])
    expect(rows.game.home_line).toEqual([{ inning: 1, runs: 1 }, { inning: 2, runs: 0 }])
  })

  it('names players per tournament, never across one', () => {
    const eve = rows.players.find(p => p.wbsc_player_id === 105)!
    expect(eve).toMatchObject({ id: 'wbsc:p:99:105', name: 'Eve Marie Echo', team_id: 'AAA' })
    expect(rows.players.find(p => p.wbsc_player_id === 201)!.name).toBe("Hana O'Home")
  })

  it('writes one line per player, whatever box rows they had', () => {
    expect(rows.batting.filter(l => l.player_id === 'wbsc:p:99:204')).toHaveLength(1)
    const kai = rows.pitching.find(l => l.player_id === 'wbsc:p:99:204')!
    expect(kai).toMatchObject({ outs: 3, hbp: 1, wp: 1, gs: 0, decision: null })
    expect(rows.pitching.find(l => l.player_id === 'wbsc:p:99:109')).toMatchObject({ outs: 6, gs: 1, decision: 'W' })
    expect(rows.batting.find(l => l.player_id === 'wbsc:p:99:102')).toMatchObject({ h: 2, doubles: 1, tb: 3 })
    // A pitcher who never batted has no batting line.
    expect(rows.batting.some(l => l.player_id === 'wbsc:p:99:209')).toBe(false)
  })

  it('folds pitches into one row per plate appearance, plus each baserunning event', () => {
    const summary = rows.plays.map(p => `${p.event_type}:${p.pitch_sequence ?? '-'}`)
    expect(summary).toEqual([
      'walk:BBBB', 'stolen_base:-', 'single:CX', 'strikeout:SSS', 'groundout:X',
      'home_run:X', 'strikeout:FFC', 'intent_walk:', 'pickoff:-', 'popup:X',
      'hit_by_pitch:H', 'wild_pitch:-', 'double:BX', 'flyout:X', 'lineout:X', 'foul_out:X',
      'groundout:X', 'groundout:X', 'groundout:X',
    ])
  })

  it('gives every row the base-out state before it, with names on the bases', () => {
    const single = rows.plays.find(p => p.event_type === 'single')!
    expect(single).toMatchObject({ outs: 0, first_base: '', second_base: 'Ana Alpha', third_base: '', runs_scored: 1 })
    const steal = rows.plays.find(p => p.event_type === 'stolen_base')!
    expect(steal).toMatchObject({ first_base: 'Ana Alpha', second_base: '', batter_name: 'Bea Bravo' })
    const pickoff = rows.plays.find(p => p.event_type === 'pickoff')!
    expect(pickoff).toMatchObject({ outs: 1, first_base: 'Jo Juliet', half: 'bottom', team_id: 'HHH' })
  })

  it('takes the batter from the lineup slot when the narrative backs it, and says so', () => {
    const lineout = rows.plays.find(p => p.event_type === 'lineout')!
    expect(lineout.batter_id).toBe('wbsc:p:99:105')
    expect(lineout.batter_name).toBe('Eve Marie Echo')
    expect(rows.notes).toHaveLength(1)
    expect(rows.notes[0]).toMatch(/Eve Marie Echo from the lineup slot/)
  })

  it('writes no pitch sequence for a game scored without pitches', () => {
    const page = fixturePage()
    for (const inning of Object.values(page.gamePlays.all)) {
      for (const r of [...(inning.top ?? []), ...(inning.bot ?? [])]) r.pitch_pitches = 0
    }
    expect(transformGame(page, EVENT).plays.every(p => p.pitch_sequence === null)).toBe(true)
  })
})
