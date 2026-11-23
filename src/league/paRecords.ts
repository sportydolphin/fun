import type { FinderBoardSide, FinderCondition, FinderVenue } from './finder'
import type { SeasonScope } from './season'

/**
 * Plate-appearance records asked in the search box: "longest at-bat", "most fouls in a PA", "most
 * pitches thrown to one batter", "longest strikeout", "most strikeouts in a row".
 *
 * THE ANSWER IS THE PLAY. A record at this grain is one trip to the plate (or the plate appearance
 * that ended a run of them), so the row opens Game Center at that play, as a first does
 * (src/league/firsts.ts). A record shared by several plays offers each of them, up to three, and then
 * the Find board ranked by the same stat.
 *
 * TWO HALVES. This file reads the MEASURE, the thing being maximized, which the Find parser has no
 * word for in a superlative ("longest", "most ... in a row"). Whatever else was typed ("strikeout",
 * "with the bases loaded", "in the 7th", "by the Firebells") is a FILTER, and goes to the Find parser
 * through `filters`, so a record and a Find question about the same plays cannot disagree. A filter
 * the Find parser cannot read in full ("longest at-bat by Whitmore", where it would drop the name)
 * offers no record rather than a record of something else.
 *
 * ONLY WHAT THE PLAY LOG STATES. Pitch speed, exit velocity and distance are TrackMan's, which has
 * two games of data, so "longest home run" and "fastest pitch" are not records here.
 */

/** What a record ranks: a field of the plate-appearance line, on the side that holds it. */
export interface PaMeasure {
  field: 'pitches' | 'fouls' | 'runs' | 'strikes' | 'krow' | 'retired' | 'hrrow'
  /** The side it is filed under. Strikes and the pitcher's runs are the pitcher's alone. */
  side: FinderBoardSide
  /** "pitch", for "14 pitches". */
  unit: [string, string]
}

const M = {
  pitches: { field: 'pitches', unit: ['pitch', 'pitches'] },
  fouls: { field: 'fouls', unit: ['foul', 'fouls'] },
  runs: { field: 'runs', unit: ['run', 'runs'] },
  strikes: { field: 'strikes', side: 'pitching', unit: ['strike', 'strikes'] },
  krow: { field: 'krow', side: 'pitching', unit: ['strikeout in a row', 'strikeouts in a row'] },
  retired: { field: 'retired', side: 'pitching', unit: ['batter retired in a row', 'batters retired in a row'] },
  hrrow: { field: 'hrrow', unit: ['home run in a row', 'home runs in a row'] },
} as const

export interface PaRecordQuestion {
  measure: PaMeasure
  /** "Longest at-bat", "Most fouls in a plate appearance": what the row is titled. */
  title: string
  /** The Find conditions, the measure's first so it is what the board ranks by. */
  conditions: FinderCondition[]
  teamId: string | null
  oppId: string | null
  venue: FinderVenue
  scope: SeasonScope
  /** A year typed, 'all' for every season ("ever", "all time"), null for the current one. */
  season: number | 'all' | null
}

/** The filter half: the rest of the text read as a plate-appearance question by the section's Find
 *  parser, or null when it cannot read all of it. Called with '' when nothing is left. */
export type PaFilterReader = (rest: string, side: FinderBoardSide) => {
  conditions: FinderCondition[]; teamId: string | null; oppId: string | null; venue: FinderVenue
} | null

const PA_NOUN = String.raw`(?:at[\s-]?bats?|abs?|pas?|plate\s+appearances?|trips?\s+to\s+the\s+plate)`
const ONE = String.raw`(?:an?|one|1|a\s+single|the\s+same)`
const MEASURE_WORD: Record<string, keyof typeof M> = {
  pitch: 'pitches', pitches: 'pitches', fouls: 'fouls', foul: 'fouls', 'foul balls': 'fouls', 'foul balls hit': 'fouls',
  'foul offs': 'fouls', runs: 'runs', 'runs scored': 'runs', rbi: 'runs', strikes: 'strikes',
}
const MEASURE_WORDS = String.raw`(pitches|pitch|foul\s+balls(?:\s+hit)?|foul[\s-]?offs|fouls|runs(?:\s+scored)?|rbi|strikes)`
const norm = (w: string) => w.toLowerCase().replace(/[\s-]+/g, ' ').trim()

/** "walks" -> "walk", "hbp" -> "hit by pitch": an event as a row's title says it. */
const eventWord = (w: string) => {
  const n = norm(w)
  return /^(?:hbp|hit by (?:a )?pitch)$/.test(n) ? 'hit by pitch' : /^(?:homers?|home ?runs?)$/.test(n) ? 'home run' : n.replace(/s$/, '')
}

/** Each way of naming a measure, most specific first. `rest` is what the match leaves as a filter. */
const MEASURES: { re: RegExp; measure: (m: RegExpMatchArray) => PaMeasure | null; title: (m: RegExpMatchArray) => string; rest?: (m: RegExpMatchArray) => string; side?: FinderBoardSide }[] = [
  // "most strikeouts in a row", "most consecutive outs", "longest streak of batters retired".
  {
    re: /\b(?:most|longest)\s+(?:(consecutive|straight)\s+)?(strikeouts?|k'?s|outs|(?:batters|hitters)\s+retired|home\s*runs?|hrs?|homers?)(\s+in\s+a\s+row|\s+straight|\s+consecutively)?\b/,
    measure: m => (!m[1] && !m[3] ? null : /^(?:strikeouts?|k'?s)$/.test(m[2]) ? M.krow : /^(?:outs|batters retired|hitters retired)$/.test(norm(m[2])) ? M.retired : M.hrrow) as PaMeasure | null,
    title: m => `Most ${/^(?:strikeouts?|k'?s)$/.test(m[2]) ? 'strikeouts' : /home|hr|homer/.test(m[2]) ? 'home runs' : 'batters retired'} in a row`,
  },
  {
    re: /\blongest\s+(strikeout|retired|perfect|out)\s+streak\b|\blongest\s+streak\s+of\s+(strikeouts|(?:batters|hitters)\s+retired|outs|home\s*runs)\b/,
    measure: m => ((m[1] ?? m[2]).startsWith('strikeout') ? M.krow : /home/.test(m[2] ?? '') ? M.hrrow : M.retired) as PaMeasure,
    title: m => `Most ${(m[1] ?? m[2]).startsWith('strikeout') ? 'strikeouts' : /home/.test(m[2] ?? '') ? 'home runs' : 'batters retired'} in a row`,
  },
  // "most pitches thrown to one batter", "most strikes to a single hitter".
  {
    re: new RegExp(String.raw`\b(?:most|highest)\s+${MEASURE_WORDS}\s+(?:thrown\s+|thrown\s+by\s+a\s+pitcher\s+)?to\s+${ONE}\s+(?:batter|hitter)\b`),
    measure: m => M[MEASURE_WORD[norm(m[1])]] as PaMeasure,
    title: m => `Most ${MEASURE_WORD[norm(m[1])]} to one batter`,
    side: 'pitching',
  },
  // "longest at-bat", "longest strikeout at-bat", "longest PA of 2026".
  {
    re: new RegExp(String.raw`\blongest\s+(?:(.+?)\s+)?${PA_NOUN}\b`),
    measure: () => M.pitches as PaMeasure,
    title: m => (m[1] ? `Longest ${m[1]} at-bat` : 'Longest at-bat'),
    rest: m => m[1] ?? '',
  },
  // "longest strikeout", "longest walk": the at-bat that ended that way. Not "longest home run" or
  // "longest hit", which a fan means as distance.
  {
    re: /\blongest\s+(strikeouts?|k|walks?|bb|base\s+on\s+balls|hit\s+by\s+pitch|hbp)\b/,
    measure: () => M.pitches as PaMeasure,
    title: m => `Longest ${/^(?:strikeouts?|k)$/.test(m[1]) ? 'strikeout' : /^(?:hit by pitch|hbp)$/.test(norm(m[1])) ? 'hit by pitch' : 'walk'}`,
    rest: m => m[1],
  },
  // "most fouls in a PA", "most pitches in an at-bat", "most runs on one play", "most pitches per PA".
  // The article is optional, and "in" too, as a search box is typed: "most pitches at bat".
  {
    re: new RegExp(String.raw`\b(?:most|highest)\s+${MEASURE_WORDS}\s+(?:(?:seen|faced|thrown|fought\s+off|hit)\s+)?(?:(?:(?:in|on|during)\s+(?:${ONE}\s+)?)?(?:${PA_NOUN}|plays?)|per\s+${PA_NOUN})\b`),
    measure: m => M[MEASURE_WORD[norm(m[1])]] as PaMeasure,
    title: m => {
      const w = MEASURE_WORD[norm(m[1])]
      return w === 'runs' ? 'Most runs on one play' : `Most ${w} in a plate appearance`
    },
  },
  // "most pitches in a walk", "most fouls before a strikeout": one kind of plate appearance, so the
  // event is a filter and the grain needs no saying.
  {
    re: new RegExp(String.raw`\b(?:most|highest)\s+${MEASURE_WORDS}\s+(?:(?:seen|thrown)\s+)?(?:in|on|before|during|for)\s+(?:an?|one|a\s+single)\s+(strikeouts?|walks?|home\s*runs?|homers?|hits?|singles?|doubles?|triples?|hit\s+by\s+(?:a\s+)?pitch|hbp)\b`),
    measure: m => (MEASURE_WORD[norm(m[1])] === 'runs' ? null : M[MEASURE_WORD[norm(m[1])]] as PaMeasure),
    title: m => `Most ${MEASURE_WORD[norm(m[1])]} in a ${eventWord(m[2])}`,
    rest: m => m[2],
  },
  // "most fouls", "most foul balls": only a plate appearance has them, so no grain need be said.
  {
    re: /\b(?:most|highest)\s+(foul\s+balls(?:\s+hit)?|foul[\s-]?offs|fouls)(?:\s+(?:fought\s+off|hit))?\b/,
    measure: () => M.fouls as PaMeasure,
    title: () => 'Most fouls in a plate appearance',
  },
]

const LEAD = /^\s*(?:(?:what|who)(?:'s|\s+is|\s+was|\s+had|\s+has|\s+threw|\s+saw)?\s+)?(?:the\s+)?(?:wpbl(?:'s)?\s+|league(?:'s)?\s+)?(?:record\s+for\s+(?:the\s+)?)?/i
const PITCHING_WORDS = /\b(?:by\s+a\s+pitcher|thrown|threw|faced|allowed|gave\s+up|pitcher'?s?)\b/
const HITTING_WORDS = /\b(?:by\s+a\s+(?:batter|hitter)|seen|saw|fought\s+off|batter'?s?|hitter'?s?)\b/
const SCOPE_POST = /\b(?:in|during|of)\s+the\s+(?:playoffs|postseason)\b|\bpostseason\b|\bplayoffs?\b/
const SCOPE_ALL = /\b(?:including|incl\.?|with)\s+(?:the\s+)?(?:playoffs|postseason)\b/
const ALL_TIME = /\b(?:ever|all[\s-]?time|in\s+(?:wpbl|league)\s+history|in\s+history)\b/
const YEAR = /\b(?:(?:of|in|during)\s+(?:the\s+)?)?(20\d\d)(?:\s+season)?\b/
// "Longest at-bat ending in a home run": the event, read by the filter half.
const ENDING = /\b(?:that\s+)?end(?:ing|ed|s)?\s+(?:in|on|with)\s+(?:an?\s+)?/g
const FILLER = /\b(?:record|season|this\s+year|so\s+far)\b/g
// Left dangling once the measure and the side's words are out: "by the Firebells" keeps its club.
const DANGLING = /^(?:(?:by|the|a|an|in|of|for|to|on)\s+)+|(?:\s+(?:by|the|a|an|in|of|for|to|on))+$/g

/**
 * A plate-appearance record, or null when the text is not one. `filters` reads whatever the measure
 * leaves ("strikeout", "with the bases loaded", "Firebells"); a remainder it cannot read in full is
 * no record.
 */
export function parsePaRecord(text: string, filters: PaFilterReader): PaRecordQuestion | null {
  let t = text.toLowerCase().replace(/[?!.]+\s*$/, '').replace(LEAD, '').trim()
  if (!/\b(?:most|longest|highest)\b/.test(t)) return null

  let scope: SeasonScope = 'regular'
  if (SCOPE_ALL.test(t)) { scope = 'all'; t = t.replace(SCOPE_ALL, ' ') }
  else if (SCOPE_POST.test(t)) { scope = 'postseason'; t = t.replace(SCOPE_POST, ' ') }
  let season: number | 'all' | null = null
  if (ALL_TIME.test(t)) { season = 'all'; t = t.replace(ALL_TIME, ' ') }
  const y = t.match(YEAR)
  if (y) { season = Number(y[1]); t = t.replace(YEAR, ' ') }

  for (const def of MEASURES) {
    const m = t.match(def.re)
    if (!m) continue
    const measure = def.measure(m)
    if (!measure) continue
    const outside = `${t.slice(0, m.index)} ${t.slice(m.index! + m[0].length)}`
    let rest = `${def.rest?.(m) ?? ''} ${outside}`
    // Who it is filed under: the measure's own side, else the words, else the batter.
    let side: FinderBoardSide = measure.side ?? def.side ?? 'hitting'
    if (!measure.side && !def.side) {
      if (PITCHING_WORDS.test(rest)) side = 'pitching'
      else if (HITTING_WORDS.test(rest)) side = 'hitting'
    }
    const strip = (x: string) => x.replace(PITCHING_WORDS, ' ').replace(HITTING_WORDS, ' ').replace(FILLER, ' ')
      .replace(/\s+/g, ' ').trim()
    rest = strip(rest).replace(ENDING, ' ').replace(/\s+/g, ' ').trim()
    // The title keeps the reader's own words for the filter, in the case they were typed. Only the
    // words outside the measure: "longest strikeout" is not "Longest strikeout strikeout".
    // Without the words still being typed, or "most fouls in a" is titled "...plate appearance in a".
    const lead = strip(outside).replace(/^(?:the|a|an|of|for|to)\s+/, '')
    const said = /^(?:(?:by|the|a|an|in|of|for|to|on)(?:\s+|$))*$/.test(lead) ? ''
      : lead.replace(/(?:\s+(?:by|the|a|an|in|of|for|to|on))+$/, '')
    const at = said ? text.toLowerCase().indexOf(said) : -1
    const suffix = said ? (at >= 0 ? text.slice(at, at + said.length) : said) : ''
    rest = rest.replace(DANGLING, '').trim()
    const read = filters(rest, side)
    if (!read) return null
    const head: FinderCondition = { field: measure.field, op: 'gte', value: 1 }
    return {
      measure: { ...measure, side }, title: `${def.title(m)}${suffix ? ` ${suffix}` : ''}`.replace(/\s+/g, ' '),
      conditions: [head, ...read.conditions.filter(c => c.field !== measure.field)],
      teamId: read.teamId, oppId: read.oppId, venue: read.venue, scope, season,
    }
  }
  return null
}

/** "14 pitches", "1 run". */
export function measureText(measure: PaMeasure, value: number): string {
  return `${value} ${measure.unit[value === 1 ? 0 : 1]}`
}
