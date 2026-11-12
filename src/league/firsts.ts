import { runnerEvents, runnerResolver, type PlateAppearanceLine } from './inningLines'
import type { LeagueGame, RunValuePlay } from './types'

/**
 * The league's firsts, asked for in the search box: "first home run", "first grand slam of 2026",
 * "first balk", "firsts".
 *
 * THE PLAY IS THE PAGE. Search could not answer a first until now because there was nothing to link
 * it to: the Hall of Firsts card left Home in Sep 2026 and took its list with it. Since Find's inning
 * rows learned to open Game Center at one plate appearance (`requestPlay`, `#play-N`), the play itself
 * is the answer, so a first needs no page of its own.
 *
 * BUILT ON THE PLATE-APPEARANCE LINES, not a second scan of the log. `plateAppearanceLines` already
 * classifies each trip to the plate (hits, walks, the bases it began with, walk-offs) and drops the
 * balk row that is part of the next one, so a first and a Find question about the same event cannot
 * disagree about what happened. A grand slam is a home run with three on, read off the runners, which
 * keeps it clear of the feed's `runs_scored` (it does not count the batter).
 *
 * THE RUNNERS' PLAYS ARE READ OFF THE ROWS. A balk, a steal, a pickoff, a wild pitch and a passed ball
 * are usually a row of their own with no trip to the plate in it, which the plate-appearance lines
 * leave out, so "first balk" offered nothing until Nov 10, 2026. They take the same `runnerEvents`
 * reading the inning grain counts with, so a first and "most balks in an inning" cannot disagree about
 * which rows were balks. The log names a runner by name alone, so the runner comes from
 * `runnerResolver`; one it cannot place, and a passed ball or a double play, which no one player owns
 * here, are credited to the club.
 *
 * ONLY WHAT THE LOG STATES. A win, a save and a complete game are box-score facts with no single play
 * to open, so none of them is a first here.
 */

export type FirstKind = 'hit' | 'hr' | 'slam' | 'double' | 'triple' | 'walk' | 'so' | 'hbp' | 'walkoff'
  | 'single' | 'sf' | 'sh' | 'bunthit' | 'ifh' | 'phit' | 'phhr' | 'leadoffhr'
  | 'sb' | 'sbh' | 'cs' | 'pk' | 'wp' | 'pb' | 'bk' | 'dp' | 'tp'

interface BaseDef {
  kind: FirstKind
  label: string
  /** What a reader types for it after "first". */
  words: RegExp
  /** Listed by a bare "firsts". The rest answer only when asked by name, which keeps that list short. */
  listed?: boolean
  /** The words the Find parser reads as every one of these ("doubles"), for the board of them all
   *  beside a club's first. Absent where Find has no such question. */
  find?: string
}
/** A first read off a plate appearance. */
interface PaDef extends BaseDef {
  source: 'pa'
  /** Who the first belongs to: the batter, or the pitcher for a strikeout. */
  by: 'batter' | 'pitcher'
  test: (l: PlateAppearanceLine) => boolean
}
/** A first read off any row of the log, a runner's play among them. */
interface PlayDef extends BaseDef {
  source: 'play'
  test: (p: RunValuePlay) => boolean
  /** Who owns it: the runner whose clause matches `clause`, the pitcher on the row, or the club in
   *  the field. A runner the log cannot place falls back to the batting club. */
  by: 'runner' | 'pitcher' | 'field'
  clause?: RegExp
}
type KindDef = PaDef | PlayDef

const pa = (d: Omit<PaDef, 'source'>): PaDef => ({ source: 'pa', ...d })
const row = (d: Omit<PlayDef, 'source'>): PlayDef => ({ source: 'play', ...d })
const says = (re: RegExp) => (p: RunValuePlay) => re.test((p.narrative ?? '').toLowerCase())

export const FIRST_KINDS: readonly KindDef[] = [
  pa({ kind: 'hr', find: 'home runs', label: 'First home run', by: 'batter', listed: true, test: l => l.hr > 0, words: /^(?:home\s*runs?|homers?|hr|homeruns?|dingers?)$/ }),
  pa({ kind: 'slam', find: 'grand slams', label: 'First grand slam', by: 'batter', listed: true, test: l => l.hr > 0 && l.on === 3, words: /^(?:grand\s*slams?|slams?)$/ }),
  pa({ kind: 'hit', find: 'hits', label: 'First hit', by: 'batter', listed: true, test: l => l.h > 0, words: /^(?:hits?|base\s*hits?)$/ }),
  pa({ kind: 'double', find: 'doubles', label: 'First double', by: 'batter', listed: true, test: l => l.doubles > 0, words: /^(?:doubles?|2b)$/ }),
  pa({ kind: 'triple', find: 'triples', label: 'First triple', by: 'batter', listed: true, test: l => l.triples > 0, words: /^(?:triples?|3b)$/ }),
  pa({ kind: 'walk', find: 'walks', label: 'First walk', by: 'batter', listed: true, test: l => l.bb > 0, words: /^(?:walks?|bb|base\s+on\s+balls)$/ }),
  pa({ kind: 'so', find: 'strikeouts', label: 'First strikeout', by: 'pitcher', listed: true, test: l => l.so > 0, words: /^(?:strikeouts?|strike\s+outs?|k|so)$/ }),
  pa({ kind: 'hbp', find: 'hbp', label: 'First hit by pitch', by: 'batter', listed: true, test: l => l.hbp > 0, words: /^(?:hit\s+by\s+(?:a\s+)?pitch|hbp)$/ }),
  pa({ kind: 'walkoff', label: 'First walk-off', by: 'batter', listed: true, test: l => l.walkoff > 0, words: /^(?:walk[\s-]*offs?(?:\s+hits?)?)$/ }),
  pa({ kind: 'single', find: 'singles', label: 'First single', by: 'batter', test: l => l.h > 0 && !l.doubles && !l.triples && !l.hr, words: /^(?:singles?|1b)$/ }),
  pa({ kind: 'sf', label: 'First sacrifice fly', by: 'batter', test: l => (l.sf ?? 0) > 0, words: /^(?:sac(?:rifice)?\s+fly|sac(?:rifice)?\s+flies|sf)$/ }),
  pa({ kind: 'sh', label: 'First sacrifice bunt', by: 'batter', test: l => (l.sh ?? 0) > 0, words: /^(?:sac(?:rifice)?\s+bunts?|sacrifice\s+hits?|sac|sh)$/ }),
  pa({ kind: 'bunthit', label: 'First bunt hit', by: 'batter', test: l => (l.bunt ?? 0) > 0 && l.h > 0, words: /^(?:bunt\s+(?:hit|single)s?)$/ }),
  pa({ kind: 'ifh', label: 'First infield hit', by: 'batter', test: l => (l.ifh ?? 0) > 0, words: /^(?:infield\s+(?:hit|single)s?)$/ }),
  pa({ kind: 'phhr', label: 'First pinch-hit home run', by: 'batter', test: l => (l.ph ?? 0) > 0 && l.hr > 0, words: /^(?:pinch[\s-]*hit\s+(?:home\s*runs?|homers?|hr))$/ }),
  pa({ kind: 'phit', label: 'First pinch hit', by: 'batter', test: l => (l.ph ?? 0) > 0 && l.h > 0, words: /^(?:pinch[\s-]*hits?)$/ }),
  pa({ kind: 'leadoffhr', label: 'First leadoff home run', by: 'batter', test: l => (l.leadoff ?? 0) > 0 && l.hr > 0, words: /^(?:lead[\s-]*off\s+(?:home\s*runs?|homers?|hr))$/ }),
  row({ kind: 'sb', find: 'stolen bases', label: 'First stolen base', by: 'runner', listed: true, clause: /\bstole\b/, test: p => runnerEvents(p).sb > 0, words: /^(?:stolen\s+bases?|steals?|sb)$/ }),
  row({ kind: 'sbh', label: 'First steal of home', by: 'runner', clause: /\bstole home\b/, test: p => runnerEvents(p).sbh > 0, words: /^(?:steals?\s+of\s+home|stolen\s+base\s+of\s+home)$/ }),
  row({ kind: 'cs', find: 'caught stealing', label: 'First caught stealing', by: 'runner', listed: true, clause: /caught stealing/, test: p => runnerEvents(p).cs > 0, words: /^(?:caught\s+stealing|cs)$/ }),
  row({ kind: 'pk', label: 'First pickoff', by: 'pitcher', listed: true, test: p => runnerEvents(p).pk > 0, words: /^(?:pick[\s-]*offs?)$/ }),
  row({ kind: 'wp', find: 'wild pitches', label: 'First wild pitch', by: 'pitcher', listed: true, test: p => runnerEvents(p).wp > 0, words: /^(?:wild\s+pitch(?:es)?|wp)$/ }),
  row({ kind: 'pb', label: 'First passed ball', by: 'field', test: p => runnerEvents(p).pb > 0, words: /^(?:passed\s+balls?|pb)$/ }),
  row({ kind: 'bk', find: 'balks', label: 'First balk', by: 'pitcher', listed: true, test: p => runnerEvents(p).bk > 0, words: /^(?:balks?|bk)$/ }),
  row({ kind: 'dp', label: 'First double play', by: 'field', listed: true, test: says(/double play/), words: /^(?:double\s+plays?|dp|gidp)$/ }),
  row({ kind: 'tp', label: 'First triple play', by: 'field', test: says(/triple play/), words: /^(?:triple\s+plays?|tp)$/ }),
]

const KIND_BY_ID = new Map(FIRST_KINDS.map(k => [k.kind, k]))
export const firstKind = (kind: FirstKind): KindDef => KIND_BY_ID.get(kind)!

/** What a typed first asks: which kinds, in which season (null: the league's first ever), and whose.
 *  `teamId` is a club the words named ("first Hunters double"); `who` is any other owner, as typed
 *  ("Whitmore first hit"), for the section to find on its roster. Neither is set for the league's.
 *  `which` is the last one ("last Hunters double") or the Nth ("Hunters 100th hit"); absent is the first. */
export interface FirstQuestion { kinds: FirstKind[]; season: number | null; teamId?: string; who?: string; which?: 'last' | number }

// The question around a first that names nobody: "who hit the", "the wpbl's", "when was the".
const PREAMBLE = /^\s*(?:(?:who|what|when|where)\s+(?:hit|had|got|threw|recorded|was|were|turned|stole|committed|did)\s+)?(?:the\s+)?(?:(?:wpbl|league)(?:['’]s)?\s*)?$/i
const ORDINAL_WORDS: Record<string, number> = { second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 }
// "first", "last", "most recent", "100th", "tenth": which one of them. The earliest such word in the
// text, so "the hunters 100th hit" keeps "the hunters" for the owner.
const ORDER_WORD = new RegExp(`^(.*?)(?<![a-z0-9])(?:very\\s+)?(first|last|latest|most\\s+recent|(\\d+)(?:st|nd|rd|th)|${Object.keys(ORDINAL_WORDS).join('|')})\\s+(?:ever\\s+)?`, 'i')
// Words that make the owner a grain or a count rather than a club or a name: "3rd inning home runs",
// "last 10 home runs" and "first inning hr" are Find's to read, and a first that took them as a
// player would hide its rows.
const NOT_AN_OWNER = /\d|(?<![a-z])(?:innings?|frames?|bases?|games?|outs?|pitch(?:es)?|counts?|strikes?|balls?|bats?|half|starts?|times?|in|of|on|with|at|vs|against)(?![a-z])/i
const OWNER_TAIL = /\s+(?:by|for|from)\s+(?:the\s+)?(.+)$/
const TAIL = /\s+(?:ever|in\s+(?:the\s+)?(?:wpbl|league)(?:\s+history)?|in\s+(?:club\s+|team\s+|franchise\s+)?history|of\s+all\s+time)\s*$/i
const IN_HISTORY = /\s+in\s+(?:the\s+)?(?:(.+?)(?:['’]s?)?\s+)?history\s*$/i
const SEASON_TAIL = /\s+(?:(?:of|in)\s+(?:the\s+)?)?(20\d\d)(?:\s+season)?\s*$/i
const ALL_FIRSTS = /^\s*(?:(?:the\s+)?(?:wpbl|league)(?:'s)?\s+)?(?:hall\s+of\s+)?firsts(?:\s+(?:of|in)\s+(20\d\d))?\s*\??\s*$/i

const CLUB_FIRSTS = /^\s*(?:the\s+)?(.+?)(?:['’]s?)?\s+firsts(?:\s+(?:of|in)\s+(20\d\d))?\s*\??\s*$/i

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/\s+/g, ' ').trim()

/** The order word as `which`: undefined for the first, 'last', or N from the second on. */
function whichOf(word: string, digits: string | undefined): FirstQuestion['which'] | null {
  const w = fold(word)
  if (w === 'first') return undefined
  if (w === 'last' || w === 'latest' || w === 'most recent') return 'last'
  const n = digits ? Number(digits) : ORDINAL_WORDS[w]
  if (!n || n > 100_000) return null
  return n === 1 ? undefined : n
}

/**
 * "first home run", "the first grand slam in wpbl history", "first hr of 2026", "firsts", and whose:
 * "first Hunters double", "Boston's first home run", "first walk by Whitmore". The last and the Nth
 * too: "last Hunters double", "Hunters 100th hit", "Whitmore's 10th home run". Null when the text is
 * not one. "First inning" is not one: it names an inning, which the Find parser reads.
 *
 * THE OWNER GOES WHEREVER IT WAS TYPED, before the order word, between it and the play, or after "by"
 * or "for", and only one of those places may hold words. A club is read here off `clubs`; anything
 * else is handed on as `who`, since only the section has a roster to find a name on.
 */
export function parseFirstText(text: string, clubs: readonly { id: string; names: string[] }[] = []): FirstQuestion | null {
  const all = text.match(ALL_FIRSTS)
  if (all) return { kinds: FIRST_KINDS.filter(k => k.listed).map(k => k.kind), season: all[1] ? Number(all[1]) : null }
  // "Hunters firsts": a club's list. A club only, since a player's list of firsts is mostly their
  // first game.
  const own = text.match(CLUB_FIRSTS)
  if (own) {
    const club = clubs.find(c => c.names.some(n => fold(n) === fold(own[1])))
    if (club) return { kinds: FIRST_KINDS.filter(k => k.listed).map(k => k.kind), season: own[2] ? Number(own[2]) : null, teamId: club.id }
  }
  const t = text.replace(/\?\s*$/, '').trim()
  const lead = t.match(ORDER_WORD)
  if (!lead) return null
  const which = whichOf(lead[2], lead[3])
  if (which === null) return null
  // Before the order word: nothing, the question's own words, or the owner with its possessive ("Hunters'").
  const pre = PREAMBLE.test(lead[1]) ? '' : lead[1].replace(/^\s*(?:(?:who|what|when|where)\s+\S+\s+)?(?:the\s+)?/i, '').replace(/['’]s?\s*$/, '').trim()
  let rest = t.slice(lead[0].length).toLowerCase().trim()
  let season: number | null = null
  const s = rest.match(SEASON_TAIL)
  if (s) { season = Number(s[1]); rest = rest.slice(0, s.index).trim() }
  let post = ''
  // "in Hunters history": the club's history, said where the league's would be.
  const hist = rest.match(IN_HISTORY)
  if (hist) {
    if (hist[1] && !/^(?:wpbl|league|club|team|franchise)$/.test(fold(hist[1]))) post = hist[1].trim()
    rest = rest.slice(0, hist.index).trim()
  }
  rest = rest.replace(TAIL, '')
  // Not when the whole of it is a play: "hit by pitch" is one, whose "by" names nobody.
  const whole = FIRST_KINDS.some(k => k.words.test(rest.replace(/^(?:a|an)\s+/, '')))
  const by = post || whole ? null : rest.match(OWNER_TAIL)
  if (by) { post = by[1].trim(); rest = rest.slice(0, by.index).trim() }
  rest = rest.replace(/^(?:a|an)\s+/, '').trim()
  // The longest run of words at the end that names a play; any words in front of it are the owner.
  const words = rest.split(/\s+/).filter(Boolean)
  for (let i = 0; i < words.length; i++) {
    const def = FIRST_KINDS.find(k => k.words.test(words.slice(i).join(' ')))
    if (!def) continue
    const mid = words.slice(0, i).join(' ')
    const owners = [pre, mid, post].filter(Boolean)
    if (owners.length > 1 || owners.some(o => NOT_AN_OWNER.test(o))) return null
    const q: FirstQuestion = { kinds: [def.kind], season, ...(which != null ? { which } : {}) }
    if (!owners.length) return q
    const owner = fold(owners[0])
    if (owner === 'wpbl' || owner === 'league') return q
    const club = clubs.find(c => c.names.some(n => fold(n) === owner || `${fold(n)}s` === owner))
    if (club) return { ...q, teamId: club.id }
    return owner.length >= 2 ? { ...q, who: owners[0].replace(/['’]s?$/, '').trim() } : null
  }
  return null
}

/** One of them: the play it happened on, and whose it was. */
export interface FirstFound {
  kind: FirstKind
  game_id: string
  /** The row Game Center opens at (`#play-N`). */
  sequence: number
  /** The plate appearance, for one read off one. */
  line?: PlateAppearanceLine
  /** The batter, the pitcher (a strikeout, a balk), the runner; null where only the club is known. */
  playerId: string | null
  /** The club they played for that day, off the play, never the roster. */
  teamId: string | null
}

type Owner = { teamId?: string | null; playerId?: string | null }

/**
 * Every play of one kind, in the order the games were played: the first is [0], the last the end,
 * the Nth [N - 1], and the length how many. `when` sorts the games (date, then first pitch, so the
 * second game of a doubleheader comes second); a play from a game not in `games` is left out. Lines from
 * unfinished games count: a first is a first the moment it happens. `plays` is the log the lines were
 * built from; without it the runners' kinds find nothing. `owner` narrows them to one club's or one
 * player's, credited the same way the league's are: a club's strikeouts are its pitchers'.
 *
 * ONE ENTRY PER EVENT, NOT PER ROW. A double steal is two stolen bases on one row, and the league's
 * 100th steal can be the second runner on it, so each runner the log names is its own entry. A row
 * naming no runner it can place still counts its events, credited to the club.
 */
export function occurrences<G extends LeagueGame>(lines: readonly PlateAppearanceLine[], games: readonly G[], kind: FirstKind,
  when: (g: G) => string, plays: readonly RunValuePlay[] = [], owner: Owner = {}): FirstFound[] {
  const rank = new Map([...games].sort((a, b) => (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : a.id < b.id ? -1 : 1))
    .map((g, i) => [g.id, i]))
  const inOrder = <T extends { game_id: string; sequence: number }>(xs: readonly T[]) => xs.filter(x => rank.has(x.game_id))
    .sort((a, b) => rank.get(a.game_id)! - rank.get(b.game_id)! || a.sequence - b.sequence)
  const theirs = (f: Pick<FirstFound, 'playerId' | 'teamId'>) =>
    (owner.teamId == null || f.teamId === owner.teamId) && (owner.playerId == null || f.playerId === owner.playerId)
  const def = firstKind(kind)
  const out: FirstFound[] = []
  if (def.source === 'pa') {
    for (const line of inOrder(lines)) {
      if (!def.test(line)) continue
      const credit = {
        playerId: def.by === 'pitcher' ? line.pitcher_id : line.batter_id,
        teamId: def.by === 'pitcher' ? line.fielding_team : line.batting_team,
      }
      if (theirs(credit)) out.push({ kind, game_id: line.game_id, sequence: line.sequence, line, ...credit })
    }
    return out
  }
  const gameById = new Map(games.map(g => [g.id, g]))
  const runners = def.by === 'runner' ? runnerResolver([...plays]) : null
  const counted = kind in RUNNER_KINDS ? RUNNER_KINDS[kind as keyof typeof RUNNER_KINDS] : null
  for (const p of inOrder(plays)) {
    if (!def.test(p)) continue
    const at = { kind, game_id: p.game_id, sequence: p.sequence }
    const times = counted ? Math.max(1, runnerEvents(p)[counted]) : 1
    if (runners) {
      // Each runner the clause names, then any the log could not place, filed under the batting club.
      const named = runners(p).filter(r => def.clause!.test(r.clause))
      for (const r of named) if (theirs({ playerId: r.id, teamId: p.team_id })) out.push({ ...at, playerId: r.id, teamId: p.team_id })
      for (let i = named.length; i < times; i++) if (theirs({ playerId: null, teamId: p.team_id })) out.push({ ...at, playerId: null, teamId: p.team_id })
      continue
    }
    // A play names only the batting club; the club in the field is the game's other one.
    const g = gameById.get(p.game_id)!
    const fielding = p.team_id == null ? null : p.team_id === g.home_team_id ? g.away_team_id : g.home_team_id
    const credit = { playerId: def.by === 'pitcher' ? p.pitcher_id : null, teamId: fielding }
    if (theirs(credit)) for (let i = 0; i < times; i++) out.push({ ...at, ...credit })
  }
  return out
}

/** The runners' kinds whose count on a row `runnerEvents` gives. */
const RUNNER_KINDS = { sb: 'sb', sbh: 'sbh', cs: 'cs', pk: 'pk', wp: 'wp', pb: 'pb', bk: 'bk' } as const

/** The first play of each kind asked (see `occurrences`), skipping a kind nobody has done. */
export function findFirsts<G extends LeagueGame>(lines: readonly PlateAppearanceLine[], games: readonly G[], kinds: readonly FirstKind[],
  when: (g: G) => string, plays: readonly RunValuePlay[] = [], owner: Owner = {}): FirstFound[] {
  return kinds.flatMap(kind => occurrences(lines, games, kind, when, plays, owner).slice(0, 1))
}

/** An ordinal in words a reader writes: "100th", "2nd", "23rd". */
export function ordinal(n: number): string {
  const ten = n % 100
  const suffix = ten >= 11 && ten <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n.toLocaleString('en-US')}${suffix}`
}

/** "First Hunters double", "Last double", "Hunters 100th hit", "Kelsie Whitmore's 10th home run". */
export function occurrenceTitle(kind: FirstKind, which: FirstQuestion['which'], owner: { club?: string; player?: string }): string {
  const noun = firstKind(kind).label.replace(/^First /, '')
  const order = which === 'last' ? 'last' : typeof which === 'number' ? ordinal(which) : 'first'
  if (owner.player) return `${owner.player}'s ${order} ${noun}`
  const club = owner.club ? `${owner.club} ` : ''
  // The club's name comes after a word ("First Hunters double") and before a number ("Hunters 100th hit").
  if (typeof which === 'number') return `${club}${order} ${noun}`
  return `${order.charAt(0).toUpperCase()}${order.slice(1)} ${club}${noun}`
}

/**
 * A club's first asked as the Find question for every one of them: "first Hunters double" is the top
 * row of "BOS doubles", whose plate appearances run oldest first. Null for anything else: the league's
 * own is every one in the league, and a player's is the name search's (`playerQuestionRows`). `side` is
 * the board the first is credited on, a strikeout's being the pitcher's.
 */
export function firstFindText(q: FirstQuestion): { text: string; side: 'hitting' | 'pitching' } | null {
  if (!q.teamId || q.who || q.kinds.length !== 1) return null
  const def = firstKind(q.kinds[0])
  if (!def.find) return null
  const side = def.by === 'pitcher' ? 'pitching' : 'hitting'
  return { text: `${q.teamId} ${def.find}${q.season ? ` ${q.season}` : ''}`, side }
}
