// The 2016 play log: WBSC's older system, which scored in prose. See docs/WBSC_INGEST.md.
//
// Every later event codes each play (codes.ts). 2016 writes the scorer's sentence and little else:
//
//   GORTAREZ walked (3-1 SBBBB); GOMEZ advanced to second.
//   UNDERWOOD stole third, scored on a throwing error by c, unearned.
//
// One clause per player, split on ';'. A clause is a NAME and then phrases split on ', ', each of
// which is a result (the batter's: "walked"), a move ("advanced to second", "scored", "out at
// third"), or a tag that moves nobody ("RBI", "SAC", "caught stealing"). The pitches are the
// letters in the parentheses.
//
// READ STRICTLY, AND CHECKED FOUR WAYS. A phrase not in the lists below fails the game, as an
// unknown code does in the coded years. The runners are carried by name from play to play, and the
// result has to agree with four things WBSC recorded apart from the prose: the outs before every
// row, each half's runs in the line score (game.ts), each team's runners left on base, and every
// batter's line in the box score (game.ts). A parse that drifted would fail one of them.
//
// NOT CHECKED AGAINST: the row's own `runs` and its "bases after" flags. `runs` reads 0 on plays
// that scored two. The flags hold the full base state for the visitors and only the players the
// row names for the home side, and keep a runner on base after a pickoff or an out on the bases:
// they match the prose on 98% of rows and no rule makes the rest agree. Measured Nov 2, 2026.

/** One player as the box score has them, for reading the names the prose uses. */
export interface LegacyPerson {
  id: number
  first_name: string
  last_name: string
}

/** A row of the 2016 play log, the fields this reads. */
export interface LegacyRow {
  playorder: number
  pitcherid: number
  batterid: number
  inning: number
  narrative: string | null
  outs: number
}

/** One play, in the neutral shape's terms but with WBSC's numeric ids; game.ts names them. */
export interface LegacyPlay {
  sequence: number
  inning: number
  half: 'top' | 'bottom'
  batter: number | null
  pitcher: number | null
  event: string
  pitch_sequence: string | null
  outs: number
  /** Who was on first, second and third BEFORE the play. */
  bases: [number | null, number | null, number | null]
  runs: number
  narrative: string
}

/** What a batter did, as a plate appearance's box-score counts. Checked against the box. */
export interface LegacyBatterCounts { pa: number; h: number; double: number; triple: number; hr: number; bb: number; ibb: number; so: number; hbp: number }

// ── Names ───────────────────────────────────────────────────────────────────────

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
  .replace(/['’`]/g, '').replace(/[^A-Z]+/g, ' ').trim()

/** A word of a given-name prefix: a capital and any lowercase after it, hyphen-joined parts too.
 *  2016 cuts it to three letters at most ("WEN Ya T"); 2012 and 2014 write more of it ("CHEN
 *  Hsiao-M", "LAU Tsz Chin"), and a word the rule refused was read as the start of the play. */
const GIVEN_WORD = /^\p{Lu}\p{Ll}*(?:-\p{Lu}\p{Ll}*)*$/u

/**
 * Split a clause into the name it opens with and the rest. The name is the run of capitalized
 * words: the surname ("VAN DE WIEL") and, when two players share one, a prefix of each given name
 * after it ("CHEUNG Wa", "LAU T", "WEN Ya T" beside "WEN Ya Z"). The rest starts lowercase.
 */
export function splitName(clause: string): { name: string; rest: string } | null {
  const words = clause.trim().split(/\s+/)
  let i = 0
  // "McMILLAN": 2012 and 2014 keep the small c of a Mc surname, which no other capitalized word has.
  while (i < words.length && (/^(?:Mc|Mac)?[\p{Lu}'’`.-]+$/u.test(words[i]) || (i > 0 && GIVEN_WORD.test(words[i])))) i++
  if (i === 0 || !/\p{Lu}{2}/u.test(words[0].replace(/['’`.-]/g, ''))) return null
  return { name: words.slice(0, i).join(' '), rest: words.slice(i).join(' ') }
}

/** A box-score name field, or '' for the "." WBSC stores in the half of a one-name player's. */
const field = (s: string): string => (s.trim() === '.' ? '' : fold(s))

/**
 * The player a name means, among one side's players, and never a guess: a guess here would move
 * the wrong runner. The surname must open the box score's surname, by whole words
 * first ("RODRIGUEZ" for "Rodriguez Castillo") and then by letters, because the prose cuts some
 * names short ("ARSHDEEP KAU"). A one-name player is matched on whichever field holds the name.
 * Each given-name word must open the given name's word in the same place ("WEN Ya T": Ya Ting).
 * 'ambiguous' when more than one fits, null when nobody does.
 */
export function resolveName(name: string, roster: readonly LegacyPerson[]): LegacyPerson | 'ambiguous' | null {
  const found = resolveWords(name, roster)
  if (found) return found
  // 2012 and 2014 also write the given name as capital initials ("CHEN HM" for Chen Hsiao-Mei,
  // "PAN CY"), which reads as a two-word surname nobody has. Only when that finds no one, the
  // last word is taken as initials, one per given-name part.
  const words = name.split(/\s+/)
  const last = words[words.length - 1]
  if (words.length < 2 || !/^\p{Lu}{1,3}$/u.test(last)) return found
  return resolveWords([...words.slice(0, -1), ...[...last]].join(' '), roster)
}

function resolveWords(name: string, roster: readonly LegacyPerson[]): LegacyPerson | 'ambiguous' | null {
  const words = name.split(/\s+/)
  let cut = words.length
  while (cut > 1 && GIVEN_WORD.test(words[cut - 1]) && !/^\p{Lu}{2,}$/u.test(words[cut - 1])) cut--
  const surname = fold(words.slice(0, cut).join(' '))
  // Word by word, so "Hsiao-M" is HSIAO then M against "Hsiao-Mei".
  const given = words.slice(cut).map(fold).join(' ').split(' ').filter(Boolean)
  // A word may also drop letters after its first ("Kit Yn" for Kit Yan, 2014): its letters in
  // order, first letter kept. Only when the word opens nobody's given name, or "CHEUNG Wi" (Wing)
  // would also fit a Wai, as it did across six 2016 games.
  const within = (w: string, full: string) => {
    let j = 0
    for (const ch of full) if (ch === w[j]) j++
    return w[0] === full[0] && j === w.length
  }
  const givenFits = (p: LegacyPerson, loose: boolean) => {
    const g = field(p.first_name).split(' ')
    return given.every((w, i) => (g[i] ?? '').startsWith(w) || (loose && within(w, g[i] ?? '')))
  }
  const own = (p: LegacyPerson) => field(p.last_name) || field(p.first_name)
  const pick = (fits: (p: LegacyPerson) => boolean): LegacyPerson | 'ambiguous' | null => {
    const strict = roster.filter(p => fits(p) && givenFits(p, false))
    const all = strict.length ? strict : roster.filter(p => fits(p) && givenFits(p, true))
    if (all.length === 1) return all[0]
    const exact = all.filter(p => own(p) === surname)
    return exact.length === 1 ? exact[0] : all.length ? 'ambiguous' : null
  }
  const compact = (s: string) => s.replace(/ /g, '')
  return pick(p => own(p) === surname || own(p).startsWith(surname + ' '))
    ?? pick(p => compact(own(p)).startsWith(compact(surname)))
}

// ── Phrases ─────────────────────────────────────────────────────────────────────

const OUT = 4 // a "base" that means out; HOME is 3+1 = scored
const HOME = 3
const BASE: Record<string, number> = { first: 0, second: 1, third: 2, home: HOME }

const FIELDERS = String.raw`(?:p|c|1b|2b|3b|ss|lf|cf|rf|dh)(?: to (?:p|c|1b|2b|3b|ss|lf|cf|rf|dh))*(?: unassisted)?`

/** A batter's result: the event and where it leaves the batter. Order matters: first match wins. */
const RESULTS: readonly [RegExp, string, number][] = [
  [/^intentionally walked$/, 'intent_walk', 0],
  [/^walked$/, 'walk', 0],
  [/^hit by pitch$/, 'hit_by_pitch', 0],
  // "to catcher" is 2012 and 2014's way of naming who took the third strike.
  [/^struck out(?: swinging| looking)?(?: to catcher)?$/, 'strikeout', OUT],
  [/^singled\b/, 'single', 0],
  [/^doubled\b/, 'double', 1],
  [/^tripled\b/, 'triple', 2],
  [/^homered\b/, 'home_run', HOME],
  [/^(?:grounded) into (?:double|triple) play\b/, 'groundout', OUT],
  [/^(?:lined) into (?:double|triple) play\b/, 'lineout', OUT],
  [/^(?:flied) into (?:double|triple) play\b/, 'flyout', OUT],
  [/^(?:popped|fouled) into (?:double|triple) play\b/, 'popup', OUT],
  // 2012 and 2014 write a ground ball into a double play as "hit into" (the fielders say so).
  [/^hit into (?:double|triple) play\b/, 'groundout', OUT],
  [/^grounded out\b/, 'groundout', OUT],
  [/^flied out\b/, 'flyout', OUT],
  [/^lined out\b/, 'lineout', OUT],
  [/^popped up\b/, 'popup', OUT],
  [/^fouled out\b/, 'foul_out', OUT],
  [/^infield fly\b/, 'popup', OUT],
  [/^reached on a fielder'?s choice\b/, 'fielders_choice', 0],
  [/^reached on (?:a |an )?(?:throwing |fielding )?error\b/, 'field_error', 0],
  [/^reached on a (?:dropped fly|muffed throw|dropped foul)\b/, 'field_error', 0],
  [/^reached on (?:catcher'?s )?interference\b/, 'catcher_interference', 0],
  // A bunt thrown out, written as a runner's out because no fielder caught a ball in the air.
  [new RegExp(`^out at first ${FIELDERS}$`), 'groundout', OUT],
]

/** Tags: they say something about the play and move nobody. */
// "ground-rule" rides on a double; "safe on a throwing error by ss, no advance" is a runner kept where
// they were by a throw that got away (both 2012 and 2014).
const TAG = new RegExp(`^(?:(?:grounded|lined|flied|popped|hit) into (?:double|triple) play(?: ${FIELDERS})?|failed pickoff attempt|ground-rule|safe on (?:a |an )?(?:throwing |fielding )?error(?: by (?:p|c|1b|2b|3b|ss|lf|cf|rf))?|interference|obstruction|sac|sf|bunt|rbi|\\d+ rbi|unearned|team unearned|caught stealing|picked off|no advance|assist by (?:(?:p|c|1b|2b|3b|ss|lf|cf|rf)(?: to | |$))+|out of order|${FIELDERS})$`)

/** Why a runner moved, from the end of a move phrase. Null for a move the play itself explains. */
function reason(tail: string): string | null | undefined {
  const t = tail.trim()
  if (!t || t === 'on the play' || t === 'on the throw' || /^on a fielder'?s choice/.test(t)) return null
  if (/^on a wild pitch$/.test(t)) return 'wild_pitch'
  if (/^on a passed ball$/.test(t)) return 'passed_ball'
  if (/^on a balk$/.test(t)) return 'balk'
  if (/^on (?:a |an |the )?(?:throwing |fielding )?error\b/.test(t) || /^on a muffed throw\b/.test(t) || /^on a dropped (?:fly|throw)\b/.test(t)) return 'error_advance'
  if (/^on a stolen base$/.test(t)) return 'stolen_base'
  return undefined
}

interface Move { to: number; reason: string | null; caught?: boolean; pickoff?: boolean; placed?: boolean }

/** A move phrase, or undefined if this is not one. Throws on a move whose reason is unknown. */
function move(phrase: string): Move | undefined {
  let m = /^advanced to (second|third|home)\b(.*)$/.exec(phrase)
  if (m) {
    const r = reason(m[2])
    if (r === undefined) throw new Error(`unknown reason "${m[2].trim()}"`)
    return { to: BASE[m[1]], reason: r }
  }
  m = /^scored\b(.*)$/.exec(phrase)
  if (m) {
    const r = reason(m[1])
    if (r === undefined) throw new Error(`unknown reason "${m[1].trim()}"`)
    return { to: HOME, reason: r }
  }
  m = /^stole (second|third|home)$/.exec(phrase)
  if (m) return { to: BASE[m[1]], reason: 'stolen_base' }
  m = new RegExp(`^out at (first|second|third|home)(?: ${FIELDERS})?$`).exec(phrase)
  if (m) return { to: OUT, reason: null }
  if (/^out on the play$/.test(phrase) || /^out on batter'?s interference$/.test(phrase)) return { to: OUT, reason: null }
  // The extra-inning tie-break runner (2016 put two on): not a play, and from nowhere.
  m = /^placed on (first|second|third)$/.exec(phrase)
  if (m) return { to: BASE[m[1]], reason: null, placed: true }
  if (/^reached first on (?:a wild pitch|a passed ball|an error|a throwing error)\b/.test(phrase)) {
    return { to: 0, reason: null }
  }
  return undefined
}

/** A row that is not a play: a substitution, a mound visit, a note. */
const NOT_A_PLAY = [
  /^to (?:p|c|1b|2b|3b|ss|lf|cf|rf|dh)\b/,
  // 2012 and 2014 often leave off whom ("RODRIGUEZ Y pinch hit."); the box score has it either way.
  /^pinch hit\b/,
]
const NOT_A_PLAY_WHOLE = [/^:::.*$/, /^dropped foul ball\b/i, /^no play\.?$/i, /^batter set to\b/i, /^\/\s+for\b/, /^[.\- :]*$/, /^\p{L}$/u, /^\d$/]

// ── The parse ───────────────────────────────────────────────────────────────────

interface Parsed {
  /** The batter's result, when the row ends a plate appearance. */
  result: { person: LegacyPerson; event: string; to: number; sac: boolean; sf: boolean } | null
  moves: { person: LegacyPerson; move: Move }[]
  /** A pinch runner, and who they ran for (null when the prose does not say). */
  runnerSub: { in: LegacyPerson; for: LegacyPerson | null } | null
  pitches: string | null
}

const PITCH: Record<string, string> = { B: 'B', K: 'C', S: 'S', F: 'F' }

/** The letters in "(3-1 BBSBB)", in our alphabet (codes.ts), or null if there are none. */
export function pitchLetters(narrative: string): string | null {
  const m = /\((\d)-(\d)(?: ([A-Z]*))?\)/.exec(narrative)
  if (!m) return null
  const letters = m[3] ?? ''
  let out = ''
  for (const ch of letters) {
    const l = PITCH[ch]
    if (!l) throw new Error(`unknown pitch letter "${ch}"`)
    out += l
  }
  return out
}

interface Context {
  batting: readonly LegacyPerson[]
  onBase: ReadonlySet<number>
  /** Players the prose names and the box score lacks, each given a stand-in once per game. */
  missing: Map<string, LegacyPerson>
}

/** The player a clause names, or a stand-in for one the box score lacks. Throws if ambiguous. */
function person(name: string, ctx: Context): LegacyPerson {
  const p = resolveName(name, ctx.batting)
  if (p === 'ambiguous') throw new Error(`"${name}" could be more than one player`)
  if (p) return p
  // In the prose and not in the box score at all (2016 has a batter like this). The plays still
  // need the runner, so a stand-in carries the bases, and legacyPlays reports it as a problem.
  let stand = ctx.missing.get(name)
  if (!stand) {
    stand = { id: -(ctx.missing.size + 1), first_name: '', last_name: name }
    ctx.missing.set(name, stand)
  }
  return stand
}

/**
 * The results a later phrase of the batter's clause can be: an out on the ball in play. Not a
 * double play: "reached on a fielder's choice, grounded into double play; A out; B out" credits
 * the batter with the double play and leaves them on first.
 */
const LATER_RESULTS = RESULTS.filter(([re, event, to]) =>
  to === OUT && event !== 'strikeout' && !re.source.startsWith('^out at first') && !re.source.includes('into'))

function parseRow(narrative: string, ctx: Context): Parsed | null {
  const text = narrative.replace(/\s+/g, ' ').trim()
  if (NOT_A_PLAY_WHOLE.some(re => re.test(text))) return null
  const pitches = pitchLetters(text)
  const clauses = text.replace(/\([^)]*\)/g, '').replace(/\.\s*$/, '').split(';').map(c => c.trim()).filter(Boolean)
  const out: Parsed = { result: null, moves: [], runnerSub: null, pitches }

  for (const [i, clause] of clauses.entries()) {
    const split = splitName(clause)
    if (!split) throw new Error(`no name opens "${clause}"`)
    const phrases = split.rest.toLowerCase().split(/,\s*/).map(p => p.trim()).filter(Boolean)
    // A name and nothing else ("CAZORLA.", 2012) says nothing happened.
    if (i === 0 && clauses.length === 1 && !phrases.length) return null
    // 2014 sometimes swaps a runner as a lineup change ("PRIMERA HERR to dh for PINEDA FLORE" with
    // Pineda on second): when the player replaced is on base, it is a pinch runner.
    const swap = /^to (?:p|c|1b|2b|3b|ss|lf|cf|rf|dh) for (.+)$/.exec(split.rest)
    if (i === 0 && swap) {
      const was = resolveName(swap[1], ctx.batting)
      if (was && was !== 'ambiguous' && ctx.onBase.has(was.id)) {
        out.runnerSub = { in: person(split.name, ctx), for: was }
        return out
      }
    }
    if (i === 0 && NOT_A_PLAY.some(re => re.test(phrases[0] ?? ''))) return null
    const pr = /^pinch ran(?: for (.+))?$/.exec(split.rest)
    if (i === 0 && pr) {
      out.runnerSub = { in: person(split.name, ctx), for: pr[1] ? person(pr[1], ctx) : null }
      return out
    }
    const who = person(split.name, ctx)
    // A result is the batter's: a player already on base who is "out at first" was picked off.
    const batting = i === 0 && !ctx.onBase.has(who.id)

    let to: number | null = null
    let event: string | null = null
    let sac = false, sf = false, caught = false, pickoff = false
    const moves: Move[] = []
    for (const [j, phrase] of phrases.entries()) {
      // A later out on the ball in play is the result after all: "reached on a fielder's choice,
      // grounded out to 2b unassisted" is a groundout.
      const r = batting ? (j === 0 ? RESULTS : event ? LATER_RESULTS : []).find(([re]) => re.test(phrase)) : undefined
      if (r) { event = r[1]; to = r[2]; continue }
      if (phrase === 'sac') sac = true
      if (phrase === 'sf') sf = true
      if (phrase === 'caught stealing') caught = true
      if (phrase === 'picked off') pickoff = true
      if (TAG.test(phrase)) continue
      const mv = move(phrase)
      if (mv) { moves.push(mv); continue }
      throw new Error(`unknown phrase "${phrase}"`)
    }
    if (event) {
      // The name, not `batterid`, says who batted: 2016 has rows whose id is nobody in the box
      // score. The box-score check in game.ts is what catches a name read wrong.
      // A move after the result is the batter's own ("singled, advanced to second on the throw").
      for (const mv of moves) to = mv.to
      out.result = { person: who, event, to: to ?? 0, sac, sf }
    } else if (moves.length) {
      const last = moves[moves.length - 1]
      // The reason worth keeping is the first that is not "the play": a steal that then scored on
      // the throw is a steal.
      const why = moves.find(m => m.reason)?.reason ?? null
      out.moves.push({ person: who, move: { to: last.to, reason: why, caught, pickoff, placed: moves.some(m => m.placed) } })
    }
    // A clause of tags alone ("GARCIA no advance", "EGAS failed pickoff attempt") moves nobody.
  }
  return out.result || out.moves.length ? out : null
}

/** The baserunning event a row without a result is, by the same precedence as codes.ts. */
function runnerEvent(moves: Parsed['moves']): string {
  const outs = moves.filter(m => m.move.to === OUT)
  if (outs.length) {
    if (outs.some(m => m.move.caught)) return 'caught_stealing'
    if (outs.some(m => m.move.pickoff)) return 'pickoff'
    return 'other_out'
  }
  for (const r of ['stolen_base', 'wild_pitch', 'passed_ball', 'balk', 'error_advance']) {
    if (moves.some(m => m.move.reason === r)) return r
  }
  // "MARKIES advanced to second." and nothing else: the scorer gave no reason. The base state is
  // still right, which is what run expectancy reads; the event says only that a runner moved.
  return 'other_advance'
}

const IN_PLAY = new Set(['single', 'double', 'triple', 'home_run', 'groundout', 'flyout', 'lineout', 'popup', 'foul_out', 'fielders_choice', 'field_error', 'sacrifice'])

export interface LegacyHalf {
  inning: number
  half: 'top' | 'bottom'
  rows: LegacyRow[]
  /** The side at bat. */
  batting: readonly LegacyPerson[]
}

/**
 * Every play of a 2016 game, or the reasons it cannot be read. `counts` is each batter's line as
 * the plays add it up, for the caller to hold against the box score.
 */
export function legacyPlays(halves: readonly LegacyHalf[]): {
  plays: LegacyPlay[]; counts: Map<number, LegacyBatterCounts>; problems: string[]
  /** Runners on base when each half ended, by half: 'top' is the visitors' left on base. */
  lob: { top: number; bottom: number }
  /** The stand-ins for players the box score lacks (negative ids), by the name the prose uses. */
  standIns: Map<number, string>
} {
  const plays: LegacyPlay[] = []
  const counts = new Map<number, LegacyBatterCounts>()
  const problems: string[] = []
  const lob = { top: 0, bottom: 0 }
  const count = (id: number) => {
    let c = counts.get(id)
    if (!c) { c = { pa: 0, h: 0, double: 0, triple: 0, hr: 0, bb: 0, ibb: 0, so: 0, hbp: 0 }; counts.set(id, c) }
    return c
  }

  const missing = new Map<string, LegacyPerson>()
  for (const h of halves) {
    const bases: [number | null, number | null, number | null] = [null, null, null]
    let outs = 0
    for (const r of h.rows) {
      const narrative = (r.narrative ?? '').replace(/\s+/g, ' ').trim()
      const where = `inning ${h.inning} ${h.half}, play ${r.playorder} ("${narrative}")`
      let parsed: Parsed | null
      try {
        parsed = parseRow(narrative, { batting: h.batting, onBase: new Set(bases.filter((b): b is number => b != null)), missing })
      } catch (err) {
        problems.push(`${where}: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }
      if (!parsed) continue
      if (parsed.runnerSub) {
        const { in: runner, for: forWho } = parsed.runnerSub
        // "PAN pinch ran." names nobody: it can only be read when one runner is on.
        const on = bases.filter(b => b != null)
        const at = forWho ? bases.indexOf(forWho.id) : on.length === 1 ? bases.indexOf(on[0]) : -1
        if (at < 0) problems.push(`${where}: ${forWho ? `${forWho.last_name} is not on base` : 'no single runner to run for'}`)
        else bases[at] = runner.id
        continue
      }
      // The tie-break runners: placed, not a play.
      if (!parsed.result && parsed.moves.every(m => m.move.placed)) {
        for (const { person: p, move: mv } of parsed.moves) {
          if (bases[mv.to] != null) problems.push(`${where}: ${['first', 'second', 'third'][mv.to]} is taken`)
          else bases[mv.to] = p.id
        }
        continue
      }

      if (r.outs !== outs) problems.push(`${where}: the row says ${r.outs} out, the plays before it make ${outs}`)
      const before: [number | null, number | null, number | null] = [...bases]
      let made = 0, scored = 0

      // Runners first, lead runner first, so a runner moving up never lands on one not yet moved.
      const placed = new Map<number, number>()
      for (const { person, move: mv } of parsed.moves) {
        const from = bases.indexOf(person.id)
        if (from < 0 && !mv.placed && !(parsed.result && person.id === parsed.result.person.id)) {
          problems.push(`${where}: ${person.last_name} moves but is not on base`)
        }
        if (from >= 0) bases[from] = null
        placed.set(person.id, mv.to)
      }
      if (parsed.result) {
        const b = parsed.result.person.id
        if (bases.includes(b)) problems.push(`${where}: the batter is already on base`)
        placed.set(b, parsed.result.to)
      }
      for (const [id, to] of placed) {
        if (to === OUT) made++
        else if (to === HOME) scored++
        else if (bases[to] != null) problems.push(`${where}: two runners on ${['first', 'second', 'third'][to]}`)
        else bases[to] = id
      }

      let event: string
      let pitches: string | null = null
      if (parsed.result) {
        const res = parsed.result
        event = res.event
        // The WPBL feed's word for a sacrifice, fly or bunt, which is an out that is not one.
        if ((res.sf || res.sac) && res.to === OUT) event = 'sacrifice'
        // Some plays carry no count at all, and those keep no sequence rather than an empty one,
        // which would claim the plate appearance saw no pitch.
        if (parsed.pitches != null) pitches = parsed.pitches + (event === 'hit_by_pitch' ? 'H' : IN_PLAY.has(event) || event === 'catcher_interference' ? 'X' : '')
        const c = count(res.person.id)
        c.pa++
        if (event === 'single' || event === 'double' || event === 'triple' || event === 'home_run') c.h++
        if (event === 'double') c.double++
        if (event === 'triple') c.triple++
        if (event === 'home_run') c.hr++
        if (event === 'walk' || event === 'intent_walk') c.bb++
        if (event === 'intent_walk') c.ibb++
        if (event === 'strikeout') c.so++
        if (event === 'hit_by_pitch') c.hbp++
      } else {
        event = runnerEvent(parsed.moves)
      }

      plays.push({
        sequence: r.playorder, inning: h.inning, half: h.half,
        batter: parsed.result ? parsed.result.person.id : (r.batterid || null),
        pitcher: r.pitcherid || null,
        event, pitch_sequence: pitches, outs, bases: before, runs: scored, narrative,
      })
      outs += made
    }
    if (outs > 3) problems.push(`inning ${h.inning} ${h.half}: ${outs} outs`)
    lob[h.half] += bases.filter(b => b != null).length
  }
  for (const name of missing.keys()) problems.push(`${name} is in the plays and not in the box score`)
  return { plays, counts, problems, lob, standIns: new Map([...missing].map(([name, p]) => [p.id, name])) }
}
