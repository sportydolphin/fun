import type { WbscBoxRow, WbscEvent, WbscGamePage, WbscPlayRow } from '../types'

// A SYNTHETIC GAME, written by hand in the shape of a wbsc.org page. Not a copy of any real one:
// this repository is public and WBSC has not said its data may be published (docs/WBSC_INGEST.md),
// so the tests never hold a real row. Every field the importer reads is here, in the form the
// 2026 group stage showed it, including the three things that surprised the first run:
//
// - the second half is keyed `bot`;
// - a fielder who moves to the mound has two box rows, one per role (KILO, spots 4 and 90);
// - a substitute's plate appearance can carry the replaced player's batter id while its lineup
//   slot and narrative name the substitute (ECHO, play 22).
//
// The game: AAA 2, HHH 1, two innings. Visitors' slots are 1000 + spot * 10 + sub, home's 2000.

export const EVENT: WbscEvent = { key: 'test-event', year: 2026, name: 'Test event' }

const T = 99 // tournament
const AWAY = 10, HOME = 20

/** A play row with every field the importer reads, zero unless given. */
export function row(p: Partial<WbscPlayRow>): WbscPlayRow {
  return {
    playorder: 0, inning: 1, batterid: 0, pitcherid: 0, lineupslot: 0, balls: 0, strikes: 0, outs: 0,
    runner1: 0, runner2: 0, runner3: 0, runner1after: 0, runner2after: 0, runner3after: 0,
    runner1to2: 0, runner1to3: 0, runner1to4: 0, runner2to3: 0, runner2to4: 0, runner3to4: 0,
    runner1out: 0, runner2out: 0, runner3out: 0,
    result1: 0, result2: 0, result3: '', pitch_pitches: 0, pa: 0, runs: 0, narrative: '',
    ...p,
  }
}

/** A box row, zero unless given. */
export function box(p: Partial<WbscBoxRow> & Pick<WbscBoxRow, 'playerid' | 'teamid' | 'firstname' | 'lastname' | 'spot'>): WbscBoxRow {
  return {
    uniform: null, pos: null, sub: 0,
    pa: 0, ab: 0, r: 0, h: 0, rbi: 0, double: 0, triple: 0, hr: 0, bb: 0, ibb: 0, so: 0, hbp: 0,
    sb: 0, cs: 0, sf: 0, sh: 0, gdp: 0,
    field_po: 0, field_a: 0, field_e: 0, field_dp: 0, field_pb: 0, field_sba: 0, field_ci: 0,
    pitch_appear: 0, pitch_ip: '0.0', pitch_bf: 0, pitch_h: 0, pitch_r: 0, pitch_er: 0, pitch_bb: 0,
    pitch_so: 0, pitch_hr: 0, pitch_hbp: 0, pitch_wp: 0, pitch_bk: 0, pitch_pitches: 0, pitch_strikes: 0,
    pitch_gs: 0, pitch_win: 0, pitch_loss: 0, pitch_save: 0,
    ...p,
  }
}

// The people. Away: ALPHA 1, BRAVO 2, CHARLIE 3, DELTA 4 (ECHO pinch-hits for DELTA in the 2nd),
// PITCH-AWAY on the mound. Home: O'HOME 1, INDIA 2, JULIET 3, KILO 4, who takes the mound from
// QUEBEC in the 2nd.
const ANA = 101, BEA = 102, CAT = 103, DEE = 104, EVE = 105, PIA = 109
const HANA = 201, IDA = 202, JO = 203, KAI = 204, QUIN = 209

function boxScore(): WbscGamePage['boxScore'] {
  return {
    [AWAY]: {
      1: [box({ playerid: ANA, teamid: AWAY, firstname: 'Ana', lastname: 'ALPHA', spot: 1, pos: 'CF', pa: 3, ab: 1, r: 2, bb: 1, hbp: 1, sb: 1, field_po: 1 })],
      2: [box({ playerid: BEA, teamid: AWAY, firstname: 'Bea', lastname: 'BRAVO', spot: 2, pos: 'SS', pa: 2, ab: 2, h: 2, double: 1, rbi: 2 })],
      3: [box({ playerid: CAT, teamid: AWAY, firstname: 'Cat', lastname: 'CHARLIE', spot: 3, pos: '1B', pa: 2, ab: 2, so: 1, field_po: 4 })],
      4: [
        box({ playerid: DEE, teamid: AWAY, firstname: 'Dee', lastname: 'DELTA', spot: 4, pos: 'C', pa: 1, ab: 1, gdp: 1 }),
        box({ playerid: EVE, teamid: AWAY, firstname: 'Eve Marie', lastname: 'ECHO', spot: 4, sub: 1, pos: 'PH', pa: 1, ab: 1 }),
      ],
      90: [box({
        playerid: PIA, teamid: AWAY, firstname: 'Pia', lastname: 'PITCH-AWAY', spot: 90, pos: 'P',
        pitch_appear: 1, pitch_ip: '2.0', pitch_bf: 7, pitch_h: 1, pitch_r: 1, pitch_er: 1, pitch_hr: 1,
        pitch_so: 1, pitch_bb: 1, pitch_pitches: 8, pitch_strikes: 6, pitch_gs: 1, pitch_win: 1,
      })],
    },
    [HOME]: {
      1: [box({ playerid: HANA, teamid: HOME, firstname: 'Hana', lastname: "O'HOME", spot: 1, pa: 2, ab: 2, h: 1, r: 1, hr: 1, rbi: 1 })],
      2: [box({ playerid: IDA, teamid: HOME, firstname: 'Ida', lastname: 'INDIA', spot: 2, pa: 2, ab: 2, so: 1 })],
      3: [box({ playerid: JO, teamid: HOME, firstname: 'Jo', lastname: 'JULIET', spot: 3, pa: 2, ab: 1, bb: 1, ibb: 1 })],
      // KILO's two rows: the batting spot, and the pitchers' 90 once on the mound. Each holds a
      // part of the game; the player's line is the sum.
      4: [box({ playerid: KAI, teamid: HOME, firstname: 'Kai', lastname: 'KILO', spot: 4, pos: 'RF', pa: 1, ab: 1, field_po: 1 })],
      90: [
        box({
          playerid: QUIN, teamid: HOME, firstname: 'Quin', lastname: 'QUEBEC', spot: 90, pos: 'P',
          pitch_appear: 1, pitch_ip: '1.0', pitch_bf: 4, pitch_h: 1, pitch_r: 1, pitch_er: 1, pitch_bb: 1,
          pitch_so: 1, pitch_pitches: 10, pitch_strikes: 5, pitch_gs: 1, pitch_loss: 1,
        }),
        box({
          playerid: KAI, teamid: HOME, firstname: 'Kai', lastname: 'KILO', spot: 90, pos: 'P', field_a: 1,
          pitch_appear: 1, pitch_ip: '1.0', pitch_bf: 5, pitch_h: 1, pitch_r: 1, pitch_er: 1, pitch_hbp: 1,
          pitch_wp: 1, pitch_pitches: 6, pitch_strikes: 4,
        }),
      ],
    },
    // WBSC's page carries these beside the two teams; the importer must not read them as teams.
    totals: { r: 3 },
    pitchers: { fullName: 'PITCH-AWAY Pia' },
  }
}

function plays(): WbscGamePage['gamePlays']['all'] {
  let order = 0
  const top = (inning: number, p: Partial<WbscPlayRow>) => row({ inning, playorder: ++order, ...p })
  const bot = top
  const A = (spot: number, sub = 0) => 1000 + spot * 10 + sub
  const H = (spot: number) => 2000 + spot * 10
  const pitch = (r1: number) => ({ result1: r1, pitch_pitches: 1 })
  return {
    1: {
      top: [
        top(1, { batterid: ANA, pitcherid: QUIN, lineupslot: A(1), ...pitch(2), narrative: 'Ball 1. ' }),
        top(1, { batterid: ANA, pitcherid: QUIN, lineupslot: A(1), ...pitch(2), balls: 1, narrative: 'Ball 2. ' }),
        top(1, { batterid: ANA, pitcherid: QUIN, lineupslot: A(1), ...pitch(2), balls: 2, narrative: 'Ball 3. ' }),
        top(1, { batterid: ANA, pitcherid: QUIN, lineupslot: A(1), ...pitch(2), balls: 3, pa: 1, result2: 13, runner1after: A(1), narrative: 'ALPHA Ana walks. ' }),
        // A steal on the first pitch to BRAVO: its own row in the log, with ALPHA still on first.
        top(1, { batterid: BEA, pitcherid: QUIN, lineupslot: A(2), ...pitch(4), runner1: A(1), runner1to2: 34, runner2after: A(1), narrative: 'Called Strike 1. ALPHA Ana to 2nd on stolen base. ' }),
        top(1, { batterid: BEA, pitcherid: QUIN, lineupslot: A(2), ...pitch(9), strikes: 1, runner2: A(1), runner2to4: 2, runner1after: A(2), pa: 1, result2: 18, runs: 1, narrative: 'BRAVO Bea singles to left field. ALPHA Ana scores. 1 RBI. ' }),
        top(1, { batterid: CAT, pitcherid: QUIN, lineupslot: A(3), ...pitch(5), runner1: A(2), runner1after: A(2), narrative: 'Swinging Strike 1. ' }),
        top(1, { batterid: CAT, pitcherid: QUIN, lineupslot: A(3), ...pitch(5), strikes: 1, runner1: A(2), runner1after: A(2), narrative: 'Swinging Strike 2. ' }),
        top(1, { batterid: CAT, pitcherid: QUIN, lineupslot: A(3), ...pitch(5), strikes: 2, runner1: A(2), runner1after: A(2), pa: 1, result2: 2, narrative: 'CHARLIE Cat strikes out swinging. 1 out. ' }),
        top(1, { batterid: DEE, pitcherid: QUIN, lineupslot: A(4), ...pitch(9), outs: 1, runner1: A(2), runner1out: 64, pa: 1, result2: 5, narrative: 'DELTA Dee hits into a double play. GDP 643. BRAVO Bea out at 2nd 64. 3 out. ' }),
      ],
      bot: [
        bot(1, { batterid: HANA, pitcherid: PIA, lineupslot: H(1), ...pitch(9), pa: 1, result2: 21, runs: 1, narrative: "O'HOME Hana homers to left field. 1 RBI. " }),
        bot(1, { batterid: IDA, pitcherid: PIA, lineupslot: H(2), ...pitch(6), narrative: 'Foul. ' }),
        bot(1, { batterid: IDA, pitcherid: PIA, lineupslot: H(2), ...pitch(6), strikes: 1, narrative: 'Foul. ' }),
        bot(1, { batterid: IDA, pitcherid: PIA, lineupslot: H(2), ...pitch(4), strikes: 2, pa: 1, result2: 1, narrative: 'INDIA Ida strikes out looking. 1 out. ' }),
        // No pitch thrown: an intentional walk is one row with result1 1.
        bot(1, { batterid: JO, pitcherid: PIA, lineupslot: H(3), outs: 1, result1: 1, pa: 1, result2: 14, runner1after: H(3), narrative: 'JULIET Jo is intentionally walked. ' }),
        bot(1, { batterid: KAI, pitcherid: PIA, lineupslot: H(4), outs: 1, runner1: H(3), runner1out: 13, narrative: 'With KILO Kai batting JULIET Jo out at 1st PO13. 2 out. ' }),
        bot(1, { batterid: KAI, pitcherid: PIA, lineupslot: H(4), ...pitch(9), outs: 2, pa: 1, result2: 4, result3: 'F4', narrative: 'KILO Kai flies out. P4. 3 out. ' }),
      ],
    },
    2: {
      top: [
        top(2, { narrative: 'Defensive Change: #4 KILO to P' }),
        top(2, { batterid: ANA, pitcherid: KAI, lineupslot: A(1), ...pitch(3), pa: 1, result2: 15, runner1after: A(1), narrative: 'ALPHA Ana Hit By Pitch. ' }),
        top(2, { batterid: BEA, pitcherid: KAI, lineupslot: A(2), ...pitch(2), runner1: A(1), runner1to2: 31, runner2after: A(1), narrative: 'Ball 1. ALPHA Ana to 2nd on wild pitch. ' }),
        top(2, { batterid: BEA, pitcherid: KAI, lineupslot: A(2), ...pitch(9), balls: 1, runner2: A(1), runner2to4: 2, runner2after: A(2), pa: 1, result2: 19, runs: 1, narrative: 'BRAVO Bea doubles to right field. ALPHA Ana scores. 1 RBI. ' }),
        top(2, { batterid: CAT, pitcherid: KAI, lineupslot: A(3), ...pitch(9), runner2: A(2), runner2after: A(2), pa: 1, result2: 4, result3: 'F9', narrative: 'CHARLIE Cat flies out to right field. F9. 1 out. ' }),
        // The stale id: DELTA's batter id on ECHO's plate appearance.
        top(2, { batterid: DEE, pitcherid: KAI, lineupslot: A(4, 1), ...pitch(9), outs: 1, runner2: A(2), runner2after: A(2), pa: 1, result2: 4, result3: 'F6', narrative: 'ECHO Eve Marie lines out. L6. 2 out. ' }),
        top(2, { batterid: ANA, pitcherid: KAI, lineupslot: A(1), ...pitch(9), outs: 2, runner2: A(2), pa: 1, result2: 4, result3: 'F3', narrative: 'ALPHA Ana flies out foul. FP3. 3 out. ' }),
      ],
      bot: [
        bot(2, { batterid: HANA, pitcherid: PIA, lineupslot: H(1), ...pitch(9), pa: 1, result2: 3, narrative: "O'HOME Hana grounds out 6-3. 1 out. " }),
        bot(2, { batterid: IDA, pitcherid: PIA, lineupslot: H(2), ...pitch(9), outs: 1, pa: 1, result2: 3, narrative: 'INDIA Ida grounds out 4-3. 2 out. ' }),
        bot(2, { batterid: JO, pitcherid: PIA, lineupslot: H(3), ...pitch(9), outs: 2, pa: 1, result2: 3, narrative: 'JULIET Jo grounds out 5-3. 3 out. ' }),
      ],
    },
  }
}

/** A fresh copy of the whole page, so a test can break one thing in it. */
export function fixturePage(): WbscGamePage {
  return {
    gameData: {
      id: 500, tournamentid: T, gamestatus: 3, gamestatustext: 'F',
      homeid: HOME, homeioc: 'HHH', homeruns: 1, homehits: 1, homeerrors: 0,
      awayid: AWAY, awayioc: 'AAA', awayruns: 2, awayhits: 2, awayerrors: 0,
      innings: 2, gametypelabel: 'Group Stage Games',
      start: '2026-07-22 19:00:00', start_tz: 'America/Chicago',
      attendance: 1234, duration: '1:05', stadium: 'Test Park', location: 'Testville',
      runsaway1: 1, runsaway2: 1, runshome1: 1, runshome2: 0,
    },
    boxScore: boxScore(),
    gamePlays: { all: plays() },
  }
}
