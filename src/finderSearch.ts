// A stat question typed into the search, as a link to the section's Find board.
//
// The shell's half of src/league/finderParse.ts: the parser knows the grammar and nothing about
// either section, and each section's finderLink.ts knows its clubs and where its Find board lives. The header
// search and the Ctrl+K palette both draw from here, so a question reads the same in both.
//
// THE RESULT IS AN ADDRESS, never a callback into the section. Both Find boards read their whole
// question off the URL (`?board=find&q=...` on WPBL, `/mlb/find?q=...` on MLB) and both re-read it
// on a navigation while mounted (StatsView's `applyAddress`, useMlbState's popstate), so the
// shell's own `navigate()` is the whole integration, and the row is a real link that opens in a new
// tab on a modified click like any other.

import { describeFinderCuts, describeFinderQuery, finderFields, type FinderBoardSide, type FinderPer, type FinderSide } from './league/finder'
import { parseClubPage, parseClubRecord, parseFinderText, parseGameQuery, parseLeaderText, parsePositionRank, parseRecordQuestion, parseRecordText, parseScopedRank, parseTeamRankText, rankField, rankLowerBetter, type ClubPagePart, type ParsedFinder, type ParsedLeader, type RankSide } from './league/finderParse'
import { MLB_FINDER_CLUBS, mlbFinderHref } from './mlb/finderLink'
import { CURRENT_SEASON, HITTING_STAT_DEFS, PITCHING_STAT_DEFS, TEAM_ABBR } from './mlb/constants'
import { MLB_GLOSSARY_PAGE, mlbClubById, mlbTeamPath, mlbUrlFor } from './mlb/routes'
import { WPBL_FINDER_CLUBS, WPBL_FINDER_OPTS, WPBL_FINDER_SIDES, wpblFinderHref } from './wpbl/finderLink'
import { WPBL_TEAMS } from './wpbl/constants'
import { WPBL_GLOSSARY_PAGE, wpblSeriesPath, wpblTeamPath } from './wpbl/routes'
import { askedTerms, glossaryTermKey } from './league/glossary'
import { parsePaRecord, type PaRecordQuestion } from './league/paRecords'
import { parsePlayerQuestion, type RosterPlayer } from './league/playerQuestion'
import { positionFilterDef } from './league/positionFilter'
import { MLB_STAT_TERMS } from './mlb/statGlossary'
import { STAT_TERMS } from './wpbl/glossary'
import type { LeaderAsk, LeaderPeek, PlayerQuestionRow } from './mlb/state/SearchBridgeContext'

export type FinderSection = 'wpbl' | 'mlb'

export interface FinderSuggestion {
  key: string
  /** The question in words, as the board will state it: "Strikeouts at least 5 and Walks exactly 0". */
  title: string
  /** Which lines, and any club or venue: "Pitching lines · vs SF · at home". */
  subtitle: string
  href: string
  parsed: ParsedFinder
}

function clubLabel(section: FinderSection, id: string): string {
  return section === 'mlb' ? TEAM_ABBR[Number(id)] ?? id : id
}

/**
 * "longest at-bat", "most fouls in a PA", "longest strikeout with the bases loaded": a plate-appearance
 * record (src/league/paRecords.ts), or null. WPBL only, since MLB has no play log. The words beside the
 * measure are read by the Find parser as a plate-appearance question, so a record means what the same
 * words mean on the Find board, and a remainder it cannot place in full (a player's name) is no record.
 */
export function paRecordQuestion(section: FinderSection, text: string): PaRecordQuestion | null {
  if (section !== 'wpbl') return null
  return parsePaRecord(text, (rest, side) => {
    if (!rest) return { conditions: [], teamId: null, oppId: null, venue: 'any' }
    const parse = (t: string) => parseFinderText(t, WPBL_FINDER_CLUBS, WPBL_FINDER_SIDES, WPBL_FINDER_OPTS)
      .filter(p => p.per === 'pa' && !p.ignored.length && p.season == null)
    // A club or an opponent alone is no question to the Find parser, which wants a stat, so it is
    // asked beside a stand-in condition that every plate appearance meets, which is then dropped.
    let read = parse(`${rest} in a plate appearance`)
    if (!read.length) {
      read = parse(`1+ pitches ${rest} in a plate appearance`).map(p => ({
        ...p, conditions: p.conditions.filter(c => !(c.field === 'pitches' && c.op === 'gte' && c.value === 1)),
      }))
    }
    // The side the measure is filed under when the words allow it; an event leans its own way
    // ("strikeout" reads as the pitcher's first), and the plays are the same lines on either side.
    const p = read.find(r => r.side === side) ?? read[0]
    // A club alone ("Firebells") reads as no condition, which is fine: the record is theirs.
    return p ? { conditions: p.conditions, teamId: p.teamId, oppId: p.oppId, venue: p.venue } : null
  })
}

// "most runs in an inning", "biggest innings": the inning record, which neither the leaders (season
// totals) nor the Bests boards (one game) hold. The Find board already lists its matches highest
// first by the question's stat, so "at least 1, in an inning" IS that ranking. WPBL only: MLB has no
// play log to cut into innings.
const INNING_MOST = /^\s*(?:what\s+(?:is|was|were|are)\s+)?(?:the\s+)?(?:most|highest|greatest)\s+(.+?)\s+in\s+(?:an?|one|a\s+single)\s+(?:half[\s-]+)?inning\s*\??\s*$/i
const BIGGEST_INNING = /^\s*(?:the\s+)?(?:biggest|largest)\s+innings?\s*\??\s*$/i

function inningRecord(text: string): { text: string; stat: string } | null {
  if (BIGGEST_INNING.test(text)) return { text: '1+ runs in an inning', stat: 'runs' }
  const m = text.match(INNING_MOST)
  return m ? { text: `1+ ${m[1]} in an inning`, stat: m[1] } : null
}

// ─── Titles in the reader's words ─────────────────────────────────────────────
//
// A QUESTION WITH A NAME IS TITLED BY ITS NAME. "grand slams" came back as "Home runs at least 1 and
// Bases loaded", "shutouts" as "Runs allowed exactly 0": right, and not what anybody calls them.
// Each named question is read by the parser itself, and a row whose question comes out the same
// (side, grain and every condition) takes the name, however it was typed: "bases loaded home runs"
// is a grand slam too. A question with anything more in it ("grand slams on 0-2") has no name and
// keeps the board's own statement. Clubs, venue and year are the subtitle's, so they do not count.
type Side = FinderSide | 'fielding'
const NAMED_QUESTIONS: [phrase: string, label: Partial<Record<Side, string>>][] = [
  ['grand slams', { hitting: 'Grand slams', pitching: 'Grand slams allowed' }],
  ['walk-offs', { hitting: 'Walk-offs', pitching: 'Walk-offs allowed' }],
  ['back-to-back-to-back home runs', { hitting: 'Back-to-back-to-back home runs', pitching: 'Back-to-back-to-back home runs allowed' }],
  ['back-to-back home runs', { hitting: 'Back-to-back home runs', pitching: 'Back-to-back home runs allowed' }],
  ['walk-off home runs', { hitting: 'Walk-off home runs', pitching: 'Walk-off home runs allowed' }],
  ['bases loaded walks', { hitting: 'Bases-loaded walks', pitching: 'Bases-loaded walks allowed' }],
  ['full count', { hitting: 'Full counts', pitching: 'Full counts' }],
  ['hits with risp', { hitting: 'Hits with runners in scoring position', pitching: 'Hits allowed with runners in scoring position' }],
  ['no-hitters', { pitching: 'No-hitters' }],
  ['one-hitters', { pitching: 'One-hitters' }],
  ['two-hitters', { pitching: 'Two-hitters' }],
  ['shutouts', { pitching: 'Shutouts' }],
  ['errorless games', { fielding: 'Errorless games' }],
  ['immaculate inning', { pitching: 'Immaculate innings' }],
  ['1-2-3 innings', { pitching: '1-2-3 innings' }],
  ['comebacks', { hitting: 'Comebacks' }],
  ['go-ahead innings', { hitting: 'Go-ahead innings' }],
  ['two-out rallies', { hitting: 'Two-out rallies' }],
  ['steals of home', { hitting: 'Steals of home' }],
  ['perfect games', { pitching: 'Perfect games' }],
  ['complete game shutouts', { pitching: 'Complete-game shutouts' }],
  ['complete games', { pitching: 'Complete games' }],
  ['quality starts', { pitching: 'Quality starts' }],
  ['cycles', { hitting: 'Cycles' }],
  ['hitting streaks', { hitting: 'Hitting streaks' }],
  ['on-base streaks', { hitting: 'On-base streaks' }],
  ['consecutive hits', { hitting: 'Hits in a row' }],
  ['leadoff home runs', { hitting: 'Leadoff home runs', pitching: 'Leadoff home runs allowed' }],
  ['leading off the game home runs', { hitting: 'Home runs leading off the game', pitching: 'Home runs allowed leading off the game' }],
  ['pinch hits', { hitting: 'Pinch hits', pitching: 'Pinch hits allowed' }],
  ['pinch hit home runs', { hitting: 'Pinch-hit home runs', pitching: 'Pinch-hit home runs allowed' }],
  ['pinch hitters', { hitting: 'Pinch hitters', pitching: 'Pinch hitters faced' }],
  ['bunt hits', { hitting: 'Bunt hits', pitching: 'Bunt hits allowed' }],
  ['bunts', { hitting: 'Bunts', pitching: 'Bunts' }],
  ['infield hits', { hitting: 'Infield hits', pitching: 'Infield hits allowed' }],
]

type Question = Pick<ParsedFinder, 'side' | 'per' | 'conditions' | 'byClub'>
const signature = (q: Question) => [q.side, q.per, q.byClub ? 'club' : '',
  ...q.conditions.map(c => `${c.field}:${c.op}:${c.value}`).sort()].join('|')

const namedBySection = new Map<FinderSection, Map<string, string>>()
function namedQuestions(section: FinderSection): Map<string, string> {
  let named = namedBySection.get(section)
  if (!named) {
    named = new Map()
    for (const [phrase, labels] of NAMED_QUESTIONS) {
      const read = section === 'mlb' ? parseFinderText(phrase, MLB_FINDER_CLUBS) : parseFinderText(phrase, WPBL_FINDER_CLUBS, WPBL_FINDER_SIDES, WPBL_FINDER_OPTS)
      for (const p of read) {
        const label = labels[p.side]
        if (label && !p.ignored.length && !named.has(signature(p))) named.set(signature(p), label)
      }
    }
    namedBySection.set(section, named)
  }
  return named
}

/** The question's own name ("Grand slams"), or the board's statement of it. */
function questionTitle(section: FinderSection, q: Question): string {
  return namedQuestions(section).get(signature(q)) ?? describeFinderQuery(q.side, q)
}

// TWO ROWS NEVER SHARE A TITLE. "3 strikeouts in an inning" offered "Strikeouts at least 3" twice (a
// pitcher's inning, a club's half at the plate), "Sato vs Hunters" "Ayami Sato vs BOS" four times,
// and the difference sat at the end of a subtitle a phone cuts off. Rows that collide take the first
// qualifier that tells them all apart: who the line belongs to, then the grain, then both.
const GRAIN_PHRASE: Record<ParsedFinder['per'], string> = {
  game: 'in a game', club: 'in a game', inning: 'in an inning', season: 'in a season', pa: 'in a plate appearance',
}
const GRAIN_NOUN: Record<ParsedFinder['per'], string> = {
  game: 'games', club: 'club games', inning: 'innings', season: 'seasons', pa: 'plate appearances',
}
/** Whose line a question counts: a club's for a club's game or half-inning, and for a run of plays
 *  at the plate (back-to-back home runs are two batters'), else the side's player. */
function whose(q: Pick<ParsedFinder, 'side' | 'per' | 'byClub'> & { conditions?: ParsedFinder['conditions'] }): string {
  if (q.per === 'club' || q.byClub || (q.per === 'inning' && q.side === 'hitting')) return 'by a club'
  if (q.side === 'hitting' && q.conditions?.some(c => RUN_FIELDS.has(c.field))) return 'by a club'
  return q.side === 'pitching' ? 'by a pitcher' : q.side === 'fielding' ? 'by a fielder' : 'by a batter'
}
const sideWord = (side: Side) => (side === 'pitching' ? 'pitching' : side === 'fielding' ? 'fielding' : 'batting')

/** `rows` with every shared title told apart, by the first of `qualifiers(row)` that separates the
 *  rows sharing it (or all of them joined), added by `add`. Rows with a title of their own are left. */
export function distinctTitles<T extends { title: string }>(
  rows: T[], qualifiers: (row: T) => string[], add: (title: string, qualifier: string) => string = (t, q) => `${t} ${q}`,
): T[] {
  const byTitle = new Map<string, T[]>()
  for (const r of rows) byTitle.set(r.title, [...(byTitle.get(r.title) ?? []), r])
  const renamed = new Map<T, string>()
  for (const [title, same] of byTitle) {
    if (same.length < 2) continue
    const quals = same.map(qualifiers)
    const width = Math.max(...quals.map(q => q.length))
    let pick: (q: string[]) => string = q => q.join(' ')
    for (let i = 0; i < width; i++) {
      if (new Set(quals.map(q => q[i] ?? '')).size === same.length) { pick = q => q[i] ?? ''; break }
    }
    same.forEach((r, i) => { const q = pick(quals[i]); if (q) renamed.set(r, add(title, q)) })
  }
  return rows.map(r => (renamed.has(r) ? { ...r, title: renamed.get(r)! } : r))
}

// ONE PLATE APPEARANCE IS ONE LINE ON EACH SIDE, so "grand slams" read for the batters and for the
// pitchers is one set of plays, counted twice under two rows with the same count. With no club or
// venue to cut it (both of which mean something different on each side), the second reading goes.
// Not the runs of plays: back-to-back home runs by a club and allowed by one pitcher are different
// runs once the pitcher changes in the middle of one.
const RUN_FIELDS = new Set(['hrrow', 'krow', 'retired'])
function dropPaTwins<T extends { parsed: ParsedFinder }>(rows: T[]): T[] {
  const kept: T[] = []
  for (const r of rows) {
    const p = r.parsed
    const plain = p.per === 'pa' && !p.teamId && !p.oppId && p.venue === 'any' && !p.ignored.length
      && !p.conditions.some(c => RUN_FIELDS.has(c.field))
    const twin = plain && kept.some(k => k.parsed.per === 'pa' && k.parsed.side !== p.side && k.parsed.season === p.season
      && !k.parsed.teamId && !k.parsed.oppId && k.parsed.venue === 'any' && !k.parsed.ignored.length
      && signature({ ...k.parsed, side: p.side }) === signature(p))
    if (!twin) kept.push(r)
  }
  return kept
}

/** The cuts in words for a subtitle: "since Aug 1", "last 10 games", "vs LHP". */
function cutBits(side: FinderBoardSide, p: Pick<ParsedFinder, 'from' | 'to' | 'last' | 'hand'> & { per?: FinderPer }): string[] {
  // "Since Aug 1" reads "since Aug 1" mid-line; a month keeps its capital, and so does LHP.
  return describeFinderCuts(side, p).map(c => c.text.replace(/^(Since|Through|Last|Vs)\b/, w => w.toLowerCase()))
}

/** Which lines a question searches, and any club, venue and year: "Pitching lines · vs SF · 2026". */
function scopeBits(section: FinderSection, p: Pick<ParsedFinder, 'side' | 'per' | 'teamId' | 'oppId' | 'venue' | 'season' | 'byClub' | 'from' | 'to' | 'last' | 'hand'>): string[] {
  const sideWord = p.side === 'pitching' ? 'Pitching' : p.side === 'fielding' ? 'Fielding' : 'Batting'
  const bits = [p.per === 'season' ? `${sideWord}, season totals` : p.per === 'inning' ? `${sideWord}, ${p.byClub ? 'club innings' : 'single innings'}`
    : p.per === 'pa' ? `${sideWord}, plate appearances` : p.per === 'club' ? `${sideWord}, club games` : `${sideWord} lines`]
  if (p.teamId) bits.push(`for ${clubLabel(section, p.teamId)}`)
  if (p.oppId) bits.push(`vs ${clubLabel(section, p.oppId)}`)
  if (p.venue === 'home') bits.push('at home')
  if (p.venue === 'away') bits.push('on the road')
  bits.push(...cutBits(p.side, p))
  if (p.season) bits.push(String(p.season))
  return bits
}

/**
 * "Sato vs hunters", "Whitmore off Schroder", "Whitmore 2-hit games": a Find question naming players,
 * read against the roster the section hands in (src/league/playerQuestion.ts), as rows. WPBL only,
 * since MLB's Find has no play log for a matchup and its search has no roster in the browser.
 * `name` turns a player id into the name the row says; `club` a club id into its name.
 */
export function playerQuestionRows(
  section: FinderSection, text: string, roster: readonly RosterPlayer[], club: (id: string) => string,
): PlayerQuestionRow[] {
  if (section !== 'wpbl') return []
  const name = (id: string | null) => roster.find(p => p.id === id)?.name ?? ''
  const rows = parsePlayerQuestion(text, roster, WPBL_FINDER_CLUBS, WPBL_FINDER_SIDES, WPBL_FINDER_OPTS).map(q => {
    const href = wpblFinderHref(q)
    const field = q.record ? finderFields(q.side, q.per).find(f => f.key === q.conditions[0]?.field) : null
    const asked = field ? `most ${field.label.toLowerCase()} in ${q.per === 'inning' ? 'an inning' : 'a game'}`
      : q.conditions.length ? questionTitle(section, q) : ''
    const where = [q.oppId && `vs ${club(q.oppId)}`, q.teamId && `for ${club(q.teamId)}`,
      q.venue === 'home' ? 'at home' : q.venue === 'away' ? 'on the road' : null, ...cutBits(q.side, q)].filter(Boolean).join(', ')
    const who = q.kind === 'matchup' ? `${name(q.batterId)} vs ${name(q.pitcherId)}` : name(q.playerId ?? q.batterId ?? q.pitcherId)
    const title = q.kind === 'club' ? [who, where].filter(Boolean).join(' ') : asked ? `${who}: ${asked}` : who
    // The club already said in a club row's title is not said again under it.
    const bits = scopeBits(section, q.kind === 'club' ? { ...q, teamId: null, oppId: null, venue: 'any', from: null, to: null, last: null, hand: null } : q)
    return { key: `player-q-${href}`, title, subtitle: bits.join(' · '), href, matchup: q.kind === 'matchup', q }
  })
  // One player's question read at two grains, or on both sides: the grain, or the side and the grain.
  return distinctTitles(rows, r => [GRAIN_NOUN[r.q.per], `${sideWord(r.q.side)} ${GRAIN_NOUN[r.q.per]}`], (t, q) => `${t} (${q})`)
    .map(({ q: _q, ...row }) => row)
}

/** Every reading of `text` as a question for this section's Find board, best first. */
export function finderSuggestions(section: FinderSection, text: string): FinderSuggestion[] {
  const record = section === 'wpbl' ? inningRecord(text) : null
  const parsed = section === 'mlb'
    ? parseFinderText(text, MLB_FINDER_CLUBS)
    : parseFinderText(record?.text ?? text, WPBL_FINDER_CLUBS, WPBL_FINDER_SIDES, WPBL_FINDER_OPTS)
      .filter(p => !record || (p.per === 'inning' && p.conditions.length === 1))
  const rows = parsed
    // MLB's board reads no cut off its address (src/mlb/views/FindView.tsx), so a cut there is no row.
    .filter(p => section === 'wpbl' || !(p.from || p.to || p.last || p.hand))
    .map(p => {
    const field = record ? finderFields(p.side, 'inning').find(f => f.key === p.conditions[0].field) : null
    const title = field ? `Most ${field.label.toLowerCase()} in an inning` : questionTitle(section, p)
    const bits = scopeBits(section, p)
    // Said, not dropped: Find cannot ask about a named player, so "Whitmore 2 hr" is everyone's
    // two-homer games, and the row has to admit the name went unused.
    if (p.ignored.length) bits.push(`not used: ${p.ignored.join(' ')}`)
    const href = section === 'mlb' ? mlbFinderHref(p) : wpblFinderHref(p)
    return { key: `finder-${href}`, title, subtitle: bits.join(' · '), href, parsed: p }
  })
  return [...clubRecordRows(section, text), ...distinctTitles(dropPaTwins(rows), r => [whose(r.parsed), GRAIN_PHRASE[r.parsed.per]])]
}

/** "Hunters home record", "Queens last 10": the club's games there, whose answer is the record. */
function clubRecordRows(section: FinderSection, text: string): FinderSuggestion[] {
  if (section !== 'wpbl') return []
  const r = parseClubRecord(text, WPBL_FINDER_CLUBS)
  if (!r) return []
  const parsed: ParsedFinder = { side: 'hitting', per: 'club', conditions: [], teamId: r.teamId, oppId: r.oppId, venue: r.venue,
    ignored: [], season: r.season, from: r.from ?? null, to: r.to ?? null, last: r.last ?? null }
  const name = WPBL_TEAMS[r.teamId]?.name ?? r.teamId
  const where = [r.oppId && `vs ${WPBL_TEAMS[r.oppId]?.name ?? r.oppId}`, r.venue === 'home' ? 'at home' : r.venue === 'away' ? 'on the road' : null,
    ...cutBits('hitting', parsed)].filter(Boolean)
  const href = wpblFinderHref(parsed)
  return [{ key: `finder-${href}`, title: `${name} record ${where.join(', ')}`.trim(), subtitle: ['Club games', r.season && String(r.season)].filter(Boolean).join(' · '), href, parsed }]
}

export interface LeaderSuggestion {
  key: string
  /** "Most home runs", "Lowest ERA". */
  title: string
  /** "Hitting · 2026", for Recent. */
  subtitle: string
  /** The two halves of it, which the palette lays out around the leader. */
  side: string
  span: string
  href: string
  parsed: ParsedLeader
  /** What the row's link ranks, in the stats table's terms, for the section to name the leader. */
  ask: LeaderAsk
}

// The finder's field keys as each section's stats table names its columns. Only where they differ;
// a field neither table has a column for (holds, times on base) is left out, and offers no row.
const SAME = (keys: string) => Object.fromEntries(keys.split(' ').map(k => [k, k]))
// The season figures (OPS+, wRC+, FIP...) have the same column key in both tables. WAR is WPBL's
// alone: the site computes it from the league's own plays, and has no MLB WAR to rank.
const HIT_ADVANCED = 'opsPlus wrcPlus woba iso babip kPct bbPct'
const PIT_ADVANCED = 'eraPlus fip kbb kPct bbPct babip'
const BOARD_COLUMNS: Record<FinderSection, Record<RankSide, Record<string, string>>> = {
  wpbl: {
    hitting: SAME(`avg obp slg ops hr rbi r h sb cs 2b 3b tb bb so hbp gdp pa ab g ${HIT_ADVANCED}`),
    pitching: { ...SAME(`era whip w l sv so ip h r er bb hr hbp wp bk bf gs g ${PIT_ADVANCED}`), pitches: 'p' },
    overall: SAME('war wpa'),
  },
  mlb: {
    hitting: { ...SAME(`g pa ab r h 2b 3b hr rbi sb cs bb avg obp slg ops tb gdp hbp ${HIT_ADVANCED}`), so: 'k' },
    pitching: { ...SAME(`era g gs sv ip h r er hr bb hbp bk wp bf whip ${PIT_ADVANCED}`), so: 'k', pitches: 'p', w: 'wl' },
    overall: {},
  },
}

/** The section's stats-table column for a finder field, or null where the table has none. */
export function boardColumn(section: FinderSection, side: RankSide, field: string): string | null {
  return BOARD_COLUMNS[section][side][field] ?? null
}

const RATES = new Set(['avg', 'obp', 'slg', 'ops', 'era', 'whip'])

/**
 * What MLB's all-time board can rank honestly, by finder field and the order asked for. That board
 * is not every player who ever played: it is the union of StatsAPI's top 100 on each of a fixed set
 * of career sorts (`CAREER_SORTS` in mlb/api.ts), so sorting it on anything else, or the other way
 * on a counting stat, ranks a hundred-odd players picked for some other reason. "Fewest home runs
 * all time" would come out as the fewest among the home run leaders. Pinned against CAREER_SORTS in
 * leaderSearch.test.ts, since the two lists must not drift apart.
 */
export const MLB_CAREER_RANKABLE: Record<FinderSide, Record<string, { stat: string; orders: ('asc' | 'desc')[] }>> = {
  hitting: {
    h: { stat: 'hits', orders: ['desc'] }, hr: { stat: 'homeRuns', orders: ['desc'] },
    rbi: { stat: 'rbi', orders: ['desc'] }, '2b': { stat: 'doubles', orders: ['desc'] },
    '3b': { stat: 'triples', orders: ['desc'] }, sb: { stat: 'stolenBases', orders: ['desc'] },
    bb: { stat: 'baseOnBalls', orders: ['desc'] }, so: { stat: 'strikeOuts', orders: ['desc'] },
    avg: { stat: 'avg', orders: ['desc', 'asc'] }, obp: { stat: 'obp', orders: ['desc', 'asc'] },
    slg: { stat: 'slg', orders: ['desc', 'asc'] }, ops: { stat: 'ops', orders: ['desc', 'asc'] },
  },
  pitching: {
    w: { stat: 'wins', orders: ['desc'] }, ip: { stat: 'inningsPitched', orders: ['desc'] },
    so: { stat: 'strikeOuts', orders: ['desc'] }, sv: { stat: 'saves', orders: ['desc'] },
    era: { stat: 'era', orders: ['asc', 'desc'] }, whip: { stat: 'whip', orders: ['asc', 'desc'] },
  },
}

export interface LeaderOptions {
  /** How many seasons the section has on record (the search bridge's `seasonCount`). */
  seasonCount?: number | null
}

function leaderTitle(p: ParsedLeader): string {
  const desc = p.dir ? p.dir === 'desc' : !rankLowerBetter(p.side, p.field)
  // A season figure keeps its own spelling: "Highest wRC+", "Most WAR".
  const own = rankField(p.field)
  if (own) return `${own.rate ? (desc ? 'Highest' : 'Lowest') : (desc ? 'Most' : 'Fewest')} ${own.label}`
  const side = p.side === 'overall' ? 'hitting' : p.side
  const label = finderFields(side, 'season').find(f => f.key === p.field)?.label ?? p.field
  const word = RATES.has(p.field) ? (desc ? 'Highest' : 'Lowest') : (desc ? 'Most' : 'Fewest')
  // "Most home runs", but "Lowest ERA": an initialism keeps its capitals.
  return `${word} ${label === label.toUpperCase() ? label : label.toLowerCase()}`
}

/** A ranking typed as words, as rows linking to the section's stats table sorted on that stat. */
export function leaderSuggestions(section: FinderSection, text: string, opts: LeaderOptions = {}): LeaderSuggestion[] {
  const rows = parseLeaderText(text).flatMap(p => {
    const sort = BOARD_COLUMNS[section][p.side][p.field]
    if (!sort) return []
    let href: string
    if (p.career && section === 'mlb') {
      const order = p.dir ?? (rankLowerBetter(p.side, p.field) ? 'asc' : 'desc')
      if (p.side === 'overall' || !MLB_CAREER_RANKABLE[p.side][p.field]?.orders.includes(order)) return []
      href = mlbUrlFor({ view: 'stats', lb: p.side as FinderSide, sort, dir: p.dir, allTime: true }, CURRENT_SEASON)
    } else if (p.career) {
      // WPBL's table is one season at a time, which is the league's whole history only until a
      // second season is on record. Past that, no row rather than one season called "all time".
      if (opts.seasonCount !== 1) return []
      const params = new URLSearchParams({ board: 'players', side: p.side, sort })
      if (p.dir) params.set('dir', p.dir)
      href = `/wpbl/stats?${params}`
    } else if (section === 'mlb') {
      href = mlbUrlFor({ view: 'stats', lb: p.side as FinderSide, sort, dir: p.dir, season: p.season }, CURRENT_SEASON)
    } else {
      const params = new URLSearchParams({ board: 'players', side: p.side, sort })
      if (p.dir) params.set('dir', p.dir)
      if (p.season) params.set('season', String(p.season))
      href = `/wpbl/stats?${params}`
    }
    // The year by number wherever the shell knows it: MLB's is the calendar's, and WPBL's arrives
    // with the leader (LeaderPeek.season), which is the newest season with a final.
    const span = p.career ? (section === 'mlb' ? 'All time' : 'All time, one season so far')
      : String(p.season ?? (section === 'mlb' ? CURRENT_SEASON : 'This season'))
    const sideLabel = p.side === 'pitching' ? 'Pitching' : p.side === 'overall' ? 'Overall' : 'Hitting'
    const subtitle = [sideLabel, span].join(' · ')
    const ask = { side: p.side, sort, dir: p.dir, season: p.season, career: p.career }
    return [{ key: `leader-${href}`, title: leaderTitle(p), subtitle, side: sideLabel, span, href, parsed: p, ask }]
  })
  // "most strikeouts" ranks the pitchers and the batters: "Most strikeouts by a pitcher", "by a batter".
  return distinctTitles(rows, r => [r.parsed.side === 'pitching' ? 'by a pitcher' : r.parsed.side === 'hitting' ? 'by a batter' : ''])
}

export interface TeamRankSuggestion {
  key: string
  /** "Lowest ERA by a team", or "San Francisco Firebells team ERA" when a club was named. */
  title: string
  subtitle: string
  href: string
}

// MLB's Teams board has the plain columns only (SeasonGridView takes HITTING_STAT_DEFS and
// PITCHING_STAT_DEFS), so an advanced figure there would open the board on its default sort while
// the row promised another: no row instead. WPBL's builds from the same columns as its players.
const MLB_TEAM_SORTS: Record<FinderSide, Set<string>> = {
  hitting: new Set(HITTING_STAT_DEFS.map(d => d.key)),
  pitching: new Set(PITCHING_STAT_DEFS.map(d => d.key)),
}

function clubFullName(section: FinderSection, id: string): string | null {
  if (section === 'mlb') return mlbClubById(Number(id))?.name ?? null
  const t = WPBL_TEAMS[id]
  return t ? `${t.city} ${t.name}` : null
}

/** "SF team ERA", "most runs by a team": the section's team stats board, sorted on the stat. */
export function teamRankSuggestions(section: FinderSection, text: string): TeamRankSuggestion[] {
  const rows = parseTeamRankText(text, sectionClubs(section)).flatMap(({ leader: p, clubIds }) => {
    const side = p.side as FinderSide
    const sort = BOARD_COLUMNS[section][side][p.field]
    if (!sort || (section === 'mlb' && !MLB_TEAM_SORTS[side].has(sort))) return []
    let href: string
    if (section === 'mlb') {
      href = mlbUrlFor({ view: 'teamStats', lb: side, sort, dir: p.dir, season: p.season }, CURRENT_SEASON)
    } else {
      const params = new URLSearchParams({ board: 'teams', side, sort })
      if (p.dir) params.set('dir', p.dir)
      if (p.season) params.set('season', String(p.season))
      href = `/wpbl/stats?${params}`
    }
    const span = String(p.season ?? (section === 'mlb' ? CURRENT_SEASON : 'This season'))
    const subtitle = ['Team stats', side === 'pitching' ? 'Pitching' : 'Hitting', span].join(' · ')
    const club = clubIds.length === 1 ? clubFullName(section, clubIds[0]) : null
    const ranked = leaderTitle(p)
    // "Lowest ERA" names the ranking; with a club named, the stat alone is the question.
    const stat = ranked.replace(/^(Most|Fewest|Highest|Lowest) /, '')
    const title = club ? `${club} team ${stat}` : `${ranked} by a team`
    return [{ key: `team-rank-${href}-${club ?? ''}`, title, subtitle, href, side }]
  })
  return distinctTitles(rows, r => [r.side === 'pitching' ? 'pitching' : 'hitting'], (t, q) => `${t} (${q})`)
    .map(({ side: _side, ...row }) => row)
}

/** "best catcher", "most hr by a shortstop", "top relievers": the players board, narrowed to the
 *  position or role (`pos=`, src/league/positionFilter.ts) and sorted on the stat when one was
 *  named. The same shape as a ranking row, so the palette draws it as one. */
export function positionRankSuggestions(section: FinderSection, text: string): Omit<LeaderSuggestion, 'parsed' | 'ask' | 'side' | 'span'>[] {
  return parsePositionRank(text).flatMap(({ pos, leader: p }) => {
    const def = positionFilterDef(pos)
    const side = def.side
    const sort = p ? BOARD_COLUMNS[section][side][p.field] : null
    if (p && !sort) return []
    let href: string
    if (section === 'mlb') {
      href = mlbUrlFor({ view: 'stats', lb: side, sort, dir: p?.dir ?? null, season: p?.season ?? null, who: pos }, CURRENT_SEASON)
    } else {
      const params = new URLSearchParams({ board: 'players', side })
      if (sort) params.set('sort', sort)
      if (p?.dir) params.set('dir', p.dir)
      if (p?.season) params.set('season', String(p.season))
      params.set('pos', pos)
      href = `/wpbl/stats?${params}`
    }
    const who = def.plural.toLowerCase()
    const title = p ? `${leaderTitle(p)} among ${who}` : `Best ${who}`
    const span = String(p?.season ?? (section === 'mlb' ? CURRENT_SEASON : 'This season'))
    const subtitle = [side === 'pitching' ? 'Pitching stats' : 'Hitting stats', span, `${def.plural} only`].join(' · ')
    return [{ key: `pos-rank-${href}`, title, subtitle, href }]
  })
}

export interface RecordSuggestion {
  key: string
  /** "Most home runs in a game", "Longest scoreless outing". */
  title: string
  subtitle: string
  href: string
  /** The Bests card to scroll to (lib/sectionScroll.ts), `best-<board key>`. Absent on a record the
   *  Find board answers, which has no card. */
  scrollTo?: string
}

// The finder's fields as the Bests boards key them (league/bests.ts, shared by both sections). Only
// the measures a board exists for: a record nobody keeps (batter strikeouts, walks) offers no row.
const BEST_BOARDS: Record<FinderSide, Record<string, { key: string; label: string }>> = {
  hitting: {
    tb: { key: 'tb', label: 'Most total bases in a game' }, rbi: { key: 'rbi', label: 'Most RBI in a game' },
    h: { key: 'h', label: 'Most hits in a game' }, hr: { key: 'hr', label: 'Most home runs in a game' },
    ob: { key: 'ob', label: 'Most times on base in a game' }, sb: { key: 'sb', label: 'Most stolen bases in a game' },
  },
  pitching: {
    so: { key: 'so', label: 'Most strikeouts in a game' }, ip: { key: 'outs', label: 'Longest outing' },
    outs: { key: 'outs', label: 'Longest outing' }, scoreless: { key: 'scoreless', label: 'Longest scoreless outing' },
    pitches: { key: 'pitches', label: 'Most pitches in a game' },
  },
}

/**
 * "most hr in a game", "longest scoreless outing", "most walks in a game", "most strikeouts in an
 * inning vs Boston": a record. The Bests board at that record's card where one keeps it and nothing
 * narrows it; otherwise the Find board at that grain, asking for at least one and ranked highest
 * first, so the record is its first row. Before the Find half, a record no card keeps ("most walks
 * in a game") offered nothing at all (Nov 10, 2026 probe).
 */
export function recordSuggestions(section: FinderSection, text: string): RecordSuggestion[] {
  const seen = new Set<string>()
  const bestsRow = (s: FinderSide, board: { key: string; label: string }): RecordSuggestion[] => {
    if (seen.has(board.key)) return []
    seen.add(board.key)
    const href = section === 'mlb'
      ? mlbUrlFor({ view: 'bests', lb: s }, CURRENT_SEASON)
      : `/wpbl/stats?${new URLSearchParams({ board: 'bests', side: s })}`
    return [{
      key: `record-${href}-${board.key}`, title: board.label,
      subtitle: `Bests · the single-game record, ${s === 'pitching' ? 'pitching' : 'hitting'}`,
      href, scrollTo: `best-${board.key}`,
    }]
  }
  // The outing records, which are the Bests board's own measures and no Find field.
  const outings = parseRecordText(text).flatMap(({ side, field }) => {
    const board = BEST_BOARDS[side as FinderSide][field]
    return board && (field === 'outs' || field === 'scoreless') ? bestsRow(side as FinderSide, board) : []
  })
  // "Most X in an inning" said bare is already the Find reading's (inningRecord), which also knows
  // "biggest innings"; this takes the inning records that reading cannot, with a club or a year.
  const innings = section === 'wpbl' && !inningRecord(text)
  // A SEASON is the stats tables' to rank. Find answers only the counts they have no column for
  // ("most singles", "most errors", "most baserunners allowed"), and only when no ranking row does.
  const seasons = !leaderSuggestions(section, text).length && !scopedRankSuggestions(section, text).length
  const read = parseRecordQuestion(text, sectionClubs(section), { season: seasons, plays: section === 'wpbl' })
    .filter(r => r.per !== 'inning' || innings)
    // MLB stores no fielding lines, so its Find has no Fielding side.
    .filter(r => r.side !== 'fielding' || section === 'wpbl')
  const found: (RecordSuggestion & { who?: string })[] = [...outings, ...read.flatMap(r => {
    // FIND BEFORE BESTS. A record asked for is a night, and the Find reading answers in the row
    // ("Record 3 · Kelsie Whitmore, Aug 3") and opens that night's box score when one game holds it
    // (finderAnswerRow), where the Bests card was one more page to read before the game. Bests keeps
    // the measures Find has no field for, and MLB keeps it whole: its search has no Find answers.
    const field = finderFields(r.side, r.per).find(f => f.key === r.field)
    const board = r.per === 'game' && r.side !== 'fielding' ? BEST_BOARDS[r.side][r.field] : undefined
    const bests = board && r.side !== 'fielding' && !r.teamId && !r.oppId && r.venue === 'any' && r.season == null
    if (bests && (!field || section === 'mlb')) return bestsRow(r.side as FinderSide, board)
    if (!field) return []
    const parsed = { ...r, conditions: [{ field: r.field, op: 'gte' as const, value: 1 }], ignored: [] }
    const href = section === 'mlb' ? mlbFinderHref({ ...parsed, side: r.side === 'pitching' ? 'pitching' : 'hitting' }) : wpblFinderHref(parsed)
    if (seen.has(href)) return []
    seen.add(href)
    const where = [r.teamId && `for ${clubLabel(section, r.teamId)}`, r.oppId && `vs ${clubLabel(section, r.oppId)}`,
      r.venue === 'home' ? 'at home' : r.venue === 'away' ? 'on the road' : null, r.season && String(r.season)].filter(Boolean)
    const club = r.per === 'club' || (r.per === 'inning' && (r.side === 'hitting' || !!r.byClub))
    return [{
      who: whose(r),
      key: `record-${href}`,
      // The record book's own name for it where Bests keeps one ("Most RBI in a game", "Longest outing").
      title: bests ? board!.label : [`Most ${field.label.toLowerCase()}${r.per === 'season' ? '' : ` in ${r.per === 'inning' ? 'an inning' : 'a game'}`}${r.per === 'club' || r.byClub ? ' by a club' : ''}`, ...where].join(' '),
      subtitle: `Find · ${r.side === 'pitching' ? 'Pitching' : r.side === 'fielding' ? 'Fielding' : club ? 'Clubs' : 'Batting'}, ${r.per === 'inning' ? 'single innings' : r.per === 'season' ? 'season totals' : r.per === 'club' ? 'club games' : 'single games'}`,
      href,
    }]
  })]
  // "most strikeouts in an inning": a pitcher's inning and a club's half at the plate, told apart.
  return distinctTitles(found, r => [r.who ?? ''], (t, q) => (t.includes(q) ? t : `${t} ${q}`))
    .map(({ who: _who, ...row }) => row)
}

/**
 * "hr vs boston", "hits against the hunters", "strikeouts at home": who has the most against one club
 * or at one place, as the Find board's season grain asking for at least one, ranked highest first.
 * Beside the team-total row the same words also read as ("Boston Hunters team home runs"), since
 * either could be meant.
 */
export function scopedRankSuggestions(section: FinderSection, text: string): RecordSuggestion[] {
  return parseScopedRank(text, sectionClubs(section)).flatMap(r => {
    const field = finderFields(r.side, 'season').find(f => f.key === r.field)
    if (!field) return []
    // MLB's board reads no cut off its address, so a cut there is no row.
    if (section === 'mlb' && (r.from || r.to || r.last || r.hand)) return []
    // A rate's low end can be the good one (ERA), so it asks for every season (at least 0) and the board
    // ranks it; a count asks for at least one. A rate over a cut carries its own smaller bar.
    const lower = rankLowerBetter(r.side, r.field)
    const rate = !!r.bar
    const conditions = [{ field: r.field, op: 'gte' as const, value: rate && lower ? 0 : 1 },
      ...(r.bar ? [{ field: r.bar.field, op: 'gte' as const, value: r.bar.value }] : [])]
    const parsed = { ...r, per: 'season' as const, conditions, ignored: [] }
    const href = section === 'mlb' ? mlbFinderHref(parsed) : wpblFinderHref(parsed)
    const where = [r.oppId && `vs ${clubLabel(section, r.oppId)}`, r.teamId && `for ${clubLabel(section, r.teamId)}`,
      r.venue === 'home' ? 'at home' : r.venue === 'away' ? 'on the road' : null, ...cutBits(r.side, { ...r, per: 'season' }),
      r.season && String(r.season)].filter(Boolean)
    const lead = rate ? (lower ? 'Lowest' : 'Highest') : 'Most'
    return [{
      // "Highest batting average", "Highest OPS": an initialism keeps its capitals.
      key: `scoped-${href}`, title: [`${lead} ${/^[A-Z]{2}/.test(field.label) ? field.label : field.label.toLowerCase()}`, ...where].join(' '),
      subtitle: `Find · ${r.side === 'pitching' ? 'Pitching' : 'Batting'}, season totals`, href,
    }]
  })
}

/** A ranking row's leader in words: "Kelsie Whitmore leads with 9", "Kelsie Whitmore and 1 more lead
 *  with 9", or "4 tied at 9" once the lead is shared by more than two and one name would mislead. */
export function peekText(p: LeaderPeek): string {
  if (p.others >= 2) return `${p.others + 1} tied at ${p.value}`
  return p.others ? `${p.name} and 1 more lead with ${p.value}` : `${p.name} leads with ${p.value}`
}

export interface ClubPageSuggestion {
  key: string
  /** "Los Angeles Dodgers roster". */
  title: string
  href: string
  /** The part of the page to scroll to once it opens (lib/sectionScroll.ts), or null for a page
   *  that is the answer whole. */
  scrollTo: ClubPagePart | null
}

const PART_LABEL: Record<ClubPagePart, string> = {
  roster: 'roster', schedule: 'schedule', stats: 'team stats', leaders: 'team leaders', standings: 'standings',
}

/** "SF schedule", "Dodgers roster": the club's page, opened at that part of it. */
export function clubPageSuggestions(section: FinderSection, text: string): ClubPageSuggestion[] {
  const clubs = section === 'mlb' ? MLB_FINDER_CLUBS : WPBL_FINDER_CLUBS
  return parseClubPage(text, clubs).flatMap<ClubPageSuggestion>(({ clubId, part }) => {
    if (section === 'mlb') {
      const club = mlbClubById(Number(clubId))
      if (!club) return []
      // MLB's club page has leaders and its division but no team-stats card, so "stats" is the
      // leaders, the nearest thing on it.
      const to: ClubPagePart = part === 'stats' ? 'leaders' : part
      const label = to === 'standings' ? 'division standings' : PART_LABEL[to]
      return [{ key: `club-${clubId}-${to}`, title: `${club.name} ${label}`, href: mlbTeamPath(club.id), scrollTo: to }]
    }
    const team = WPBL_TEAMS[clubId]
    if (!team) return []
    const name = `${team.city} ${team.name}`
    // A WPBL club's page has no standings of its own: four clubs are one table, on its own tab.
    if (part === 'standings') return [{ key: `club-${clubId}-standings`, title: 'WPBL standings', href: '/wpbl/standings', scrollTo: null }]
    return [{
      key: `club-${clubId}-${part}`, title: `${name} ${PART_LABEL[part]}`,
      href: wpblTeamPath(team, Object.values(WPBL_TEAMS)), scrollTo: part,
    }]
  })
}

/** The clubs each section's questions can name, for the shell's own readers. */
export const sectionClubs = (section: FinderSection) => section === 'mlb' ? MLB_FINDER_CLUBS : WPBL_FINDER_CLUBS

/**
 * "Firebells vs Hunters" with no day: the pairing's season-series page, every meeting and the
 * leaders in them. WPBL only: MLB's series pages are the postseason bracket's slots, and a
 * regular-season pairing has no page there, so its two clubs get their latest and next game instead.
 */
export function matchupSuggestions(section: FinderSection, text: string): { key: string; title: string; href: string }[] {
  if (section !== 'wpbl') return []
  const q = parseGameQuery(text, WPBL_FINDER_CLUBS)
  if (!q || q.when || q.clubs.length !== 2) return []
  const teams = Object.values(WPBL_TEAMS)
  const out: { key: string; title: string; href: string }[] = []
  for (const a of q.clubs[0]) {
    for (const b of q.clubs[1]) {
      const ta = WPBL_TEAMS[a], tb = WPBL_TEAMS[b]
      if (!ta || !tb || a === b) continue
      const href = wpblSeriesPath(ta, tb, teams)
      out.push({ key: `matchup-${href}`, title: `${ta.name} vs ${tb.name}`, href })
    }
  }
  return out
}

export interface DefinitionSuggestion {
  key: string
  /** "OPS: On-base plus slugging". */
  title: string
  /** The plain-English half, or where it opens when the expansion is all there is. */
  subtitle: string
  href: string
  /** The scroll request that opens the page at the term (lib/sectionScroll.ts). */
  scrollTo: string
}

/**
 * "what is OPS+", "FIP", "wRC+ meaning": the term on the section's glossary page. `asked` says the
 * text was put as a question, which puts these rows first; a bare term goes after the rankings.
 */
export function definitionSuggestions(section: FinderSection, text: string): { rows: DefinitionSuggestion[]; asked: boolean } {
  const terms = section === 'mlb' ? MLB_STAT_TERMS : STAT_TERMS
  const page = section === 'mlb' ? MLB_GLOSSARY_PAGE : WPBL_GLOSSARY_PAGE
  const { keys, asked } = askedTerms(text, terms)
  return {
    asked,
    rows: keys.map(k => ({
      key: `term-${k}`, title: `${k}: ${terms[k].full}`,
      subtitle: terms[k].plain ?? 'Rules & glossary', href: page, scrollTo: glossaryTermKey(k),
    })),
  }
}
