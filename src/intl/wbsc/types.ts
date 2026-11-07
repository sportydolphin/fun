// What the importer reads from a wbsc.org game page, and nothing more.
//
// WBSC's pages carry far more than this (umpires, scorers, sponsors, a field per inning up to 15,
// a hundred play-row columns that are always 0). Only the fields named here are read, and the
// output is built from an allow-list, so a column WBSC adds tomorrow never rides into a file.
// See docs/WBSC_INGEST.md.

/** One game in an event's schedule (`props.games` on the schedule page). */
export interface WbscScheduleGame {
  id: number
  homeioc: string
  awayioc: string
  homeruns: number
  awayruns: number
  /** 'F' when final. A forfeit has none: the 2024 USA–Venezuela 7–0 has an empty status. */
  gamestatustext: string | null
  /** WBSC's status code: 3 for a final, 4 for that forfeit. 2012 and 2014 write only this. */
  gamestatus: number
  start: string
}

/** The game header (`gameData`). The line score is `runsaway1`..`runsaway15` and the same for home. */
export interface WbscGameData {
  id: number
  tournamentid: number
  gamestatus: number
  gamestatustext: string | null
  homeid: number
  homeioc: string
  homeruns: number
  homehits: number
  /** Runners left on base, as the scorer counted them. */
  homelob: number
  homeerrors: number
  awayid: number
  awayioc: string
  awayruns: number
  awayhits: number
  awaylob: number
  awayerrors: number
  /** Innings played. Below 7 for a game ended by the run rule. */
  innings: number
  gametypelabel: string | null
  /** Local wall-clock time, 'YYYY-MM-DD HH:MM:SS', in `start_tz`. */
  start: string
  start_tz: string | null
  attendance: number | null
  /** 'H:MM'. */
  duration: string | null
  stadium: string | null
  location: string | null
  [inning: `runs${'home' | 'away'}${number}`]: number
}

/** One player's line in one game: batting, fielding and pitching in a single row. */
export interface WbscBoxRow {
  playerid: number
  teamid: number
  firstname: string
  lastname: string
  uniform: number | null
  pos: string | null
  /** The batting-order spot, 1 to 9, or 90 for a pitcher who did not bat. */
  spot: number
  /** 0 for the starter in the spot, 1 for the first substitute, and so on. */
  sub: number
  pa: number; ab: number; r: number; h: number; rbi: number
  double: number; triple: number; hr: number
  bb: number; ibb: number; so: number; hbp: number
  sb: number; cs: number; sf: number; sh: number; gdp: number
  field_po: number; field_a: number; field_e: number; field_dp: number
  field_pb: number; field_sba: number; field_ci: number
  pitch_appear: number
  /** Innings in baseball notation: '4.2' is four and two thirds. Never a decimal. */
  pitch_ip: string
  pitch_bf: number; pitch_h: number; pitch_r: number; pitch_er: number
  pitch_bb: number; pitch_so: number; pitch_hr: number; pitch_hbp: number
  pitch_wp: number; pitch_bk: number
  pitch_pitches: number; pitch_strikes: number
  pitch_gs: number; pitch_win: number; pitch_loss: number; pitch_save: number
}

/**
 * One row of the play log: a pitch, a pickoff throw, a substitution, a stolen base.
 *
 * The count, the outs and the runners are the state BEFORE the row. A runner is a lineup slot
 * code (1090 is the ninth spot), never a player id; `runnerNafter` is who stands there after it.
 * `runnerNtoM` is the reason a runner moved from N to M (34 stolen base, 31 wild pitch, ...),
 * `runnerNout` the fielders who put one out.
 */
export interface WbscPlayRow {
  playorder: number
  inning: number
  batterid: number
  pitcherid: number
  /** The batter's lineup slot code, the same code the runner fields use. */
  lineupslot: number
  balls: number
  strikes: number
  outs: number
  runner1: number; runner2: number; runner3: number
  runner1after: number; runner2after: number; runner3after: number
  runner1to2: number; runner1to3: number; runner1to4: number
  runner2to3: number; runner2to4: number
  runner3to4: number
  runner1out: number; runner2out: number; runner3out: number
  /** What the pitch was. See `PITCH_RESULT` in codes.ts. */
  result1: number
  /** How the plate appearance ended, on the row that ends one. See `PA_RESULT`. */
  result2: number
  /** The scorer's notation: 'F9', 'SF9', '6-3'. */
  result3: string | number | null
  /** 1 on a row that is a pitch thrown, 0 on a penalty ball, a pickoff or a substitution. */
  pitch_pitches: number
  /** 1 on the row that ends a plate appearance. */
  pa: number
  /** Runs scored on the row, batter included: a three-run homer reads 3. */
  runs: number
  narrative: string | null
}

/** `gamePlays.all`: by inning, then by half. WBSC spells the second half `bot`. */
export type WbscPlayLog = Record<string, { top?: WbscPlayRow[]; bot?: WbscPlayRow[] }>

/** `props.viewData.original` on a box-score page. */
export interface WbscGamePage {
  gameData: WbscGameData
  /** Per team id, then per batting spot ('1'..'9', '90'), the rows of everyone who held it. A
   *  player who changed role mid-game (center field to the mound, losing the DH) has a row in
   *  each, every count split between them: see `playerLines` in game.ts. */
  boxScore: Record<string, Record<string, WbscBoxRow[]> | unknown>
  gamePlays: { all: WbscPlayLog }
  /** Set on a page read from IBAF's 2010 stats (ibaf.ts) rather than wbsc.org: its box counts an
   *  intentional walk once, so 2016's correction for counting it twice is not made. */
  ibaf?: true
  /** true for 2004 to 2008: results only, from IBAF's compendium as transcribed into the cache
   *  (compendium.ts). No box scores, so no players, lines or plays. */
  compendium?: true
}

/** Which event a game belongs to, from the importer's own list of events. */
export interface WbscEvent {
  /** wbsc.org's key, as in /en/events/<key>/. */
  key: string
  year: number
  name: string
  /**
   * true for an event scored in WBSC's older system (2016), which differs twice. Its play log is
   * the scorer's words with pitch letters and no result codes ("GOMEZ walked (3-1 BBSBB)."), read
   * by legacy.ts and checked against the box score and line score rather than trusted.
   * And a player who also pitched has a pitchers' row (spot 90) that COPIES the batting and
   * fielding of the batting row rather than splitting them, so only its pitching is added.
   */
  legacy?: true
  /** true for 2010, read from IBAF's own stats pages in the Wayback Machine (ibaf.ts), not wbsc.org.
   *  Always with `legacy`: the play-by-play is the same prose. */
  ibaf?: true
}
