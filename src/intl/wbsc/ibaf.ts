// The 2010 World Cup, from IBAF's own stats pages, read into the shape of a WBSC legacy page so the
// same checks and the same transform (game.ts) run on it. See "2010, from IBAF" in docs/WBSC_INGEST.md.
//
// WBSC keeps only a standings page for 2010. IBAF, which ran the event, published every game as an
// Automated ScoreBook page (box score, play-by-play, line score) on its stats site, which is gone;
// the Wayback Machine saved all 41 games that were played. The play-by-play is the same prose
// WBSC's own 2012 to 2016 logs carry ("BATISTA D stole second."), so legacy.ts reads it.
//
// NOTHING HERE IS A GUESS THE CHECKS DO NOT COVER. A name that fits nobody, or more than one, fails
// the game; so does a half whose runs differ from the line score, or a table this does not know.
// What IBAF's page lacks (player ids, the outs before each play) is made up only where game.ts and
// legacy.ts check it some other way, and said so where it is made.

import { resolveName, splitName, type LegacyPerson } from './legacy'
import type { WbscBoxRow, WbscGameData, WbscGamePage, WbscPlayRow } from './types'

/** IBAF's team names, as its pages write them, to IOC codes. One not here fails the game. */
export const IBAF_TEAMS: Readonly<Record<string, string>> = {
  'AUSTRALIA': 'AUS', 'CANADA': 'CAN', 'CUBA': 'CUB', 'HONG KONG': 'HKG', 'JAPAN': 'JPN', 'SOUTH KOREA': 'KOR',
  'NETHERLANDS': 'NED', 'PUERTO RICO': 'PUR', 'CHINESE TAIPEI': 'TPE', 'U.S.A.': 'USA', 'VENEZUELA': 'VEN',
}

/** A team's numeric id on the page (WBSC's pages number teams; IBAF's name them). */
export const ibafTeamId = (ioc: string): number => 2010_00 + Object.values(IBAF_TEAMS).sort().indexOf(ioc) + 1

/** The page's game id: the year, then IBAF's game number. Far above any WBSC game id, and readable. */
export const ibafGameId = (gameNumber: number): number => 2010_000 + gameNumber

/** The 2010 "tournament", in WBSC's id terms, so a player's id (`wbsc:p:<this>:<n>`) collides with nothing. */
export const IBAF_TOURNAMENT_ID = 2010_000

/** Where the pages were: IBAF's stats site, gone since, saved by the Wayback Machine. */
export const IBAF_2010_SOURCE = 'http://ibaf.prod.kgroup.eu/stats/2010/venezuela/games'

/**
 * IBAF's numbers for the games that were played, 41 of the 47 scheduled. The six others (7, 11,
 * 16, 23, 38, 40) are on no team's page and were not played; Hong Kong withdrew after its second
 * game. Each played game's page is in the Wayback Machine, the shorter box of game 1 included.
 */
export const IBAF_2010_GAMES: readonly number[] = [
  1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 24, 25,
  26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 39, 41, 42, 43, 44, 45, 46, 47,
]

/** The event's source: IBAF's standings page, as archived (the folder above it never was). */
export const IBAF_2010_EVENT_URL = `https://web.archive.org/web/2010/${IBAF_2010_SOURCE}/lgsumm.htm`

/** A game's page, for the links a box score's source carries: its archived `04.htm` beside the
 *  standings page for 2010, wbsc.org's box-score path for every other event. */
export function boxScoreUrl(source: string, wbscGameId: number): string {
  if (source.includes(IBAF_2010_SOURCE) && wbscGameId > IBAF_TOURNAMENT_ID && wbscGameId < IBAF_TOURNAMENT_ID + 100) {
    return `${source.replace(/\/[^/]*\.htm$/, '')}/${String(wbscGameId - IBAF_TOURNAMENT_ID).padStart(2, '0')}.htm`
  }
  return `${source}/box-score/${wbscGameId}`
}

/** One player IBAF lists, with the names split the way its pages write them: SURNAME Given. */
export interface IbafRosterPlayer extends LegacyPerson {
  team: string
}

// ── HTML ────────────────────────────────────────────────────────────────────────

const decode = (s: string): string => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))

const text = (html: string): string => decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()

/**
 * A table as one or more team sections. Game 1 survives only as IBAF's shorter box, one table holding
 * both teams, each a "HONG KONG 1 (0-1)" row over a "Player ab r h rbi bb so po a lob" header; its
 * other counts are the lines under the line score ("2B - PAN T H; ..."). Made into the composite's
 * shape, a header row that opens with the team's name.
 */
function shortSections(t: string[][]): { short: boolean; rows: string[][] }[] {
  if (!t.some(r => r[0] === 'Player')) return [{ short: false, rows: t }]
  const out: { short: boolean; rows: string[][] }[] = []
  for (const [i, r] of t.entries()) {
    const team = r.length === 1 ? /^(.+?) \d+ \(\d+-\d+\)$/.exec(r[0]) : null
    if (team && t[i + 1]?.[0] === 'Player') out.push({ short: true, rows: [[team[1], ...t[i + 1].slice(1)]] })
    else if (r[0] !== 'Player' && out.length) out[out.length - 1].rows.push(r)
  }
  return out
}

/** Every table, as rows of cell text. */
function tables(html: string): string[][][] {
  return [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map(t =>
    [...t[0].matchAll(/<tr\b[\s\S]*?(?=<tr\b|<\/table>)/gi)]
      .map(r => [...r[0].matchAll(/<td\b[^>]*>([\s\S]*?)(?=<td\b|<\/tr>|$)/gi)].map(c => text(c[1])))
      .filter(r => r.length))
}

// ── Names ───────────────────────────────────────────────────────────────────────

/**
 * "BATISTA Dayana" → BATISTA, Dayana; "McCANN Amy" → McCANN, Amy. The surname is the run of words in
 * capitals; the given name is the rest. A name all in capitals ("KIM HEE JEOM") is a one-word surname
 * and a given name, as every Korean name in the event is.
 */
export function splitIbafName(name: string): { last_name: string; first_name: string } {
  const words = name.trim().split(/\s+/)
  const caps = (w: string) => /^(?:Mc|Mac)?[\p{Lu}'’.-]+$/u.test(w)
  let i = 0
  while (i < words.length && caps(words[i])) i++
  if (i === words.length && words.length > 1) i = 1
  // A lone capital after the surname is a given name's initial ("LOKKEN H Letticia"), as the box
  // score's "LOKKEN H L" reads it.
  while (i > 1 && /^\p{Lu}$/u.test(words[i - 1])) i--
  return { last_name: words.slice(0, Math.max(i, 1)).join(' '), first_name: words.slice(Math.max(i, 1)).join(' ') }
}

/**
 * Names IBAF typed wrong, keyed by team and the wrong spelling, each read against the same games'
 * box scores and play-by-play: a letter dropped or added ("VAZUEZ", "GERRISTSEN", "TARAZAONA"), the
 * given name and surname the wrong way round ("KATHERINE Welsh"), or one pitcher's given name in a
 * second form ("LEON Aracelys", whom Baseball-Reference lists as Anny León, also given as Aracelys).
 * Applied to the league list and the pitching tables alike.
 */
const NAME_FIXES: Readonly<Record<string, string>> = {
  'CUB VAZUEZ Inima': 'VAZQUEZ Inima',
  'NED GERRISTSEN Linde': 'GERRITSEN Linde',
  'VEN TARAZAONA Raiza': 'TARAZONA Raiza',
  'VEN LEON Aracelys': 'LEON Anny',
  'AUS KATHERINE Welsh': 'WELSH Katherine',
  'AUS CLARE Whittam': 'WHITTAM Clare',
  'AUS TAYLAH Welch': 'WELCH Taylah',
  'AUS McDONALD TAHLIA': 'McDONALD Tahlia',
}

/**
 * The same mistakes in the box scores and play-by-play, which write the abbreviated name, so the
 * plays name the corrected player. Per team, and only in that team's games. "HSIEH Y L" is the
 * pitcher every pitching table names Hsieh Yu-Ying.
 */
const TEXT_FIXES: Readonly<Record<string, readonly [string, string][]>> = {
  TPE: [['HSIEH Y L', 'HSIEH Y Y']],
  AUS: [['KATHERINE W', 'WELSH K'], ['CLARE W', 'WHITTAM C'], ['TAYLAH W', 'WELCH T']],
}

/** Pitching-table rows by team: each table holds both teams, the second headed by its own row. */
function pitchingTables(html: string): { ioc: string; rows: { name: string; decision: string | null; cells: string[] }[] }[] {
  const out: { ioc: string; rows: { name: string; decision: string | null; cells: string[] }[] }[] = []
  for (const t of tables(html)) {
    let cur: (typeof out)[number] | null = null
    for (const row of t) {
      const ioc = IBAF_TEAMS[row[0] ?? '']
      if (ioc && row.slice(1).join(' ') === PITCHING_COLUMNS.join(' ')) { cur = { ioc, rows: [] }; out.push(cur); continue }
      if (!cur || !row[0] || row.length !== PITCHING_COLUMNS.length + 1) continue
      const dec = /\s+([WLS])(?:,\d+(?:-\d+)?)?$/.exec(row[0])
      const raw = (dec ? row[0].slice(0, dec.index) : row[0]).trim()
      out[out.length - 1].rows.push({ name: NAME_FIXES[`${cur.ioc} ${raw}`] ?? raw, decision: dec?.[1] ?? null, cells: row.slice(1) })
    }
  }
  return out
}


/** The pitchers in a game's pitching tables, by team, with the decision cut off: "RAMOS Yaima". */
export function ibafPitcherNames(html: string): { team: string; name: string }[] {
  const out: { team: string; name: string }[] = []
  for (const t of pitchingTables(html)) for (const r of t.rows) out.push({ team: t.ioc, name: r.name })
  // The short box (game 1) writes batters' whole names too, and Hong Kong, which withdrew after two
  // games, is in no league list: that box is where its players' names are.
  for (const sec of tables(html).flatMap(shortSections)) {
    const ioc = IBAF_TEAMS[sec.rows[0]?.[0] ?? '']
    if (!sec.short || !ioc) continue
    for (const r of sec.rows.slice(1)) {
      if (r[0] === 'Totals') break
      const words = r[0].split(' ')
      if (POSITION.test(words[words.length - 1])) words.pop()
      out.push({ team: ioc, name: words.join(' ') })
    }
  }
  return out
}

/**
 * Every player: the league list (`lgplyrs.htm`, "ROKKAKU Ayako, JPN"), which has everyone who batted,
 * and the games' pitching tables, which add the pitchers who never did. A pitcher already on the
 * list (the same name, or one the list's resolves) is not added twice.
 */
export function parseIbafRoster(html: string, pitchers: readonly { team: string; name: string }[] = []): IbafRosterPlayer[] {
  const seen = new Map<string, IbafRosterPlayer>()
  const add = (team: string, raw: string) => {
    const name = NAME_FIXES[`${team} ${raw}`] ?? raw
    const key = `${team} ${name}`
    if (seen.has(key)) return
    const split = splitIbafName(name)
    const same = resolveName(`${split.last_name} ${split.first_name}`, [...seen.values()].filter(p => p.team === team))
    if (same) return
    seen.set(key, { team, id: 0, ...split })
  }
  for (const t of tables(html)) for (const row of t) {
    const m = /^(.+), ([A-Z]{3})$/.exec(row[0] ?? '')
    if (m) add(m[2], m[1])
  }
  for (const p of pitchers) add(p.team, p.name)
  // An id from the team and the name, so a name fixed later changes that player's id and nobody
  // else's (a number by position in the list would renumber the rest of the team, and every
  // decision already recorded against them in same-person.json would point at someone new).
  const out = [...seen.values()].sort((a, b) => (a.team + a.last_name + a.first_name).localeCompare(b.team + b.last_name + b.first_name))
  const taken = new Map<number, IbafRosterPlayer>()
  for (const p of out) {
    let h = 0x811c9dc5
    for (const ch of `${p.team} ${p.last_name} ${p.first_name}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0
    p.id = ibafTeamId(p.team) * 100_000 + (h % 100_000)
    const other = taken.get(p.id)
    if (other) throw new Error(`IBAF ids: ${p.last_name} ${p.first_name} and ${other.last_name} ${other.first_name} hash alike`)
    taken.set(p.id, p)
  }
  return out
}

// ── One game ────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, string> = { Jul: '07', Aug: '08', Sep: '09' }
const ORDINAL = /^(\d+)(?:st|nd|rd|th)$/

/** IBAF's game numbers, to the round labels WBSC's own older events use (editions.ts reads them). */
export function ibafRound(gameNumber: number): string {
  if (gameNumber <= 25) return 'Round 1'
  if (gameNumber <= 40) return 'Round 2'
  return ({ 41: '5th Place Game', 42: '9th Place Game', 43: '7th Place Game', 44: 'Semifinals', 45: 'Semifinals', 46: 'Bronze', 47: 'Gold' } as Record<number, string>)[gameNumber] ?? `Game ${gameNumber}`
}

const SHORT_COLUMNS = ['ab', 'r', 'h', 'rbi', 'bb', 'so', 'po', 'a', 'lob']
/** The short box's lines under the line score, to the box row's fields. */
const SHORT_LINES: Readonly<Record<string, keyof WbscBoxRow>> = {
  'E': 'field_e', '2B': 'double', '3B': 'triple', 'HR': 'hr', 'HBP': 'hbp', 'SB': 'sb', 'CS': 'cs',
  'SF': 'sf', 'SH': 'sh', 'IBB': 'ibb', 'GDP': 'gdp',
}
const BATTING_COLUMNS = ['ab', 'r', 'h', 'rbi', '2b', '3b', 'hr', 'bb', 'sb', 'cs', 'hp', 'sh', 'sf', 'so', 'ibb', 'kl', 'gdp', 'po', 'a', 'e']
const PITCHING_COLUMNS = ['ip', 'h', 'r', 'er', 'bb', 'so', 'wp', 'bk', 'hbp', 'ibb', 'ab', 'bf', 'fo', 'go', 'np']
const POSITION = /^(?:p|c|1b|2b|3b|ss|lf|cf|rf|dh|ph|pr)(?:\/(?:p|c|1b|2b|3b|ss|lf|cf|rf|dh|ph|pr))*$/

const emptyRow = (p: IbafRosterPlayer, teamId: number, spot: number, sub: number, pos: string | null): WbscBoxRow => ({
  playerid: p.id, teamid: teamId, firstname: p.first_name, lastname: p.last_name, uniform: null, pos, spot, sub,
  pa: 0, ab: 0, r: 0, h: 0, rbi: 0, double: 0, triple: 0, hr: 0, bb: 0, ibb: 0, so: 0, hbp: 0,
  sb: 0, cs: 0, sf: 0, sh: 0, gdp: 0, field_po: 0, field_a: 0, field_e: 0, field_dp: 0, field_pb: 0, field_sba: 0, field_ci: 0,
  pitch_appear: 0, pitch_ip: '0.0', pitch_bf: 0, pitch_h: 0, pitch_r: 0, pitch_er: 0, pitch_bb: 0, pitch_so: 0, pitch_hr: 0,
  pitch_hbp: 0, pitch_wp: 0, pitch_bk: 0, pitch_pitches: 0, pitch_strikes: 0, pitch_gs: 0, pitch_win: 0, pitch_loss: 0, pitch_save: 0,
})

/** A line-score row's innings: "100 (10)46" is 1, 0, 0, 10, 4, 6; an "X" is a half not batted. */
export function lineInnings(cells: string): (number | null)[] {
  const out: (number | null)[] = []
  for (const m of cells.replace(/\s+/g, '').matchAll(/\((\d+)\)|(\d)|([Xx])/g)) out.push(m[3] ? null : Number(m[1] ?? m[2]))
  return out
}

/**
 * The scorer's own notes, typed in capitals beside the generated prose, taken out, each by a rule
 * written for it; any other capitals sentence is left for legacy.ts to fail. And two hand entries
 * that contradict the plays next to them, where the next sentence says what happened. Every one is
 * checked after: the outs must still come to three a half, and the runners left on base must match.
 */
export function scorerNotes(sentences: readonly string[], report: (note: string) => void): string[] {
  const out: string[] = []
  for (const [i, s] of sentences.entries()) {
    const next = sentences[i + 1] ?? ''
    // "SUJKOWSKY ADVANCED TO 2ND BY DEFENSIVE INDIFERENCE.", "ROKKAKU ADVANCED BY RULE TO 2ND BASE.":
    // the scorer's reason for an advance the sentence before it already made, and not a move of its
    // own. Read as one, every such runner moved twice; one names a player who had left the game.
    if (/^[A-Z' -]+? ADVANCED (?:TO (?:2ND|3RD|HOME) BY DEFENSIVE INDIFERENCE|BY RULE TO (?:2ND|3RD)(?: BASE)?)\.$/.test(s)) continue
    // A mound visit, and two notes that explain the play before or after them and move nobody: "OBR
    // 13 RUNNER OUT BY INTERFERENCE." opens a half whose plays make its three outs without it, and
    // "AKIKO OUT BY RULE, BUNTING 3RD STRIKE INTO FOUL." follows the strikeout it explains.
    if (/^coaching visit to mound\.$/i.test(s)) continue
    if (/^OBR \d+ RUNNER OUT BY INTERFERENCE\.$/.test(s)) continue
    if (/^[A-Z]+ OUT BY RULE, BUNTING 3RD STRIKE INTO FOUL\.$/.test(s) && /struck out/.test(sentences[i - 1] ?? '')) continue
    // "ARAI J pinch ran for YAMAZAKI M. ARAI J pinch hit.": the runner was never on, and that player batted.
    const pr = /^(.+?) pinch ran for (.+?)\.$/.exec(s)
    if (pr && next.startsWith(`${pr[1]} pinch hit`)) { report(`"${s}" dropped: the next sentence has ${pr[1]} pinch hit`); continue }
    // "MEZA Y pinch ran for MONTIEL D. Batter set to GOMEZ L. BRITO S placed on second. MEZA Y placed
    // on first.": the tie-break runner, entered before the bases were set; the placing says it all.
    if (pr && sentences.slice(i + 1, i + 4).some(x => x.startsWith(`${pr[1]} placed on `))) continue
    out.push(s)
  }
  return out
}

export interface IbafGame {
  page: WbscGamePage
  /** What the page says that no check in game.ts holds it to, as sentences. Empty means it may be read. */
  problems: string[]
  /** What was changed on the way in, for the run log. */
  notes: string[]
}

/**
 * One archived game page, as a WBSC legacy page. `roster` is the league list; `gameNumber` IBAF's.
 */
export function parseIbafGame(raw: string, roster: readonly IbafRosterPlayer[], gameNumber: number): IbafGame {
  const problems: string[] = []
  const notes: string[] = []
  // The two teams first, from the heading, for the fixes that belong to one team's games.
  const pair = /IV Women World Cup<br>\s*([A-Z. ]+?) at ([A-Z. ]+?)(?: - Composite Box Score)?<br>/.exec(raw)
  const playing = new Set([IBAF_TEAMS[pair?.[1] ?? ''], IBAF_TEAMS[pair?.[2] ?? '']])
  let html = raw
  for (const [team, fixes] of Object.entries(TEXT_FIXES)) {
    if (playing.has(team)) for (const [from, to] of fixes) html = html.replace(new RegExp(`\\b${from}\\b`, 'g'), to)
  }
  const head = /<b>\s*IV Women World Cup<br>\s*([A-Z. ]+?) at ([A-Z. ]+?)(?: - Composite Box Score)?<br>\s*(\w{3}) (\d+), (\d{4}) at ([^(<]+?) \(([^)<]+)\)/.exec(html)
  if (!head) return { page: null as unknown as WbscGamePage, problems: ['no box score heading'], notes }
  const [, awayName, homeName, mon, day, year, city, stadium] = head
  const away = IBAF_TEAMS[awayName.trim()], home = IBAF_TEAMS[homeName.trim()]
  if (!away || !home) return { page: null as unknown as WbscGamePage, problems: [`unknown team "${!away ? awayName : homeName}"`], notes }
  const awayId = ibafTeamId(away), homeId = ibafTeamId(home)
  const rosterOf = (ioc: string) => roster.filter(p => p.team === ioc)

  const who = (name: string, ioc: string, where: string): IbafRosterPlayer | null => {
    const p = resolveName(name, rosterOf(ioc))
    if (p && p !== 'ambiguous') return p as IbafRosterPlayer
    problems.push(`${where}: "${name}" ${p === 'ambiguous' ? 'could be more than one' : 'is nobody'} on ${ioc}'s list`)
    return null
  }

  // The starters, for the batting order: "5/2b BATISTA D; 19/lf PEREZ Y; ... 13/p RAMOS Y;".
  const starters = new Map<string, { name: string; uniform: number; pos: string }[]>()
  for (const m of html.matchAll(/([A-Z. ]+?) starters:([\s\S]*?)<\/font>/g)) {
    const ioc = IBAF_TEAMS[text(m[1])]
    if (!ioc) continue
    starters.set(ioc, text(m[2]).split(';').map(s => s.trim()).filter(Boolean).map(s => {
      const x = /^(\d+)\/(\w+) (.+)$/.exec(s)
      return x ? { uniform: Number(x[1]), pos: x[2], name: x[3] } : { uniform: 0, pos: '', name: s }
    }))
  }

  // The box score: two batting tables and two pitching tables, each headed by the team's name.
  const box: Record<string, Record<string, WbscBoxRow[]>> = { [awayId]: {}, [homeId]: {} }
  const rowsOf = (teamId: number) => Object.values(box[teamId]).flat()
  const all = tables(html)
  for (const { short, rows: t } of all.flatMap(shortSections)) {
    const header = t[0] ?? []
    const ioc = IBAF_TEAMS[header[0] ?? '']
    if (!ioc || (ioc !== away && ioc !== home)) continue
    const teamId = ibafTeamId(ioc)
    const cols = header.slice(1)
    const columns = short ? SHORT_COLUMNS : BATTING_COLUMNS
    if (cols.join(' ') === columns.join(' ')) {
      if (Object.keys(box[teamId]).length) { problems.push(`${ioc}: two batting tables`); continue }
      const order = (starters.get(ioc) ?? []).map(s => ({ ...s, person: who(s.name, ioc, `${ioc} starters`) }))
      const batters = order.filter(s => s.pos !== 'p' || order.length === 9)
      let spot = 0, sub = 0, pitchers = false
      for (const cells of t.slice(1)) {
        if (cells[0] === 'Totals') break
        const words = cells[0].split(' ')
        const pos = POSITION.test(words[words.length - 1]) ? words.pop()! : null
        const p = who(words.join(' '), ioc, `${ioc} box score`)
        if (!p) continue
        const n = cells.slice(1).map(Number)
        if (n.length !== columns.length || n.some(x => !Number.isFinite(x))) { problems.push(`${ioc} box score: ${cells[0]} has ${n.length} numbers`); continue }
        const v = Object.fromEntries(BATTING_COLUMNS.map(c => [c, 0])) as Record<string, number>
        columns.forEach((c, i) => { v[c] = n[i] })
        // A starter opens a spot, anyone else is a substitute in the one open. With a DH, the
        // starting pitcher is the tenth starter: from there on the rows are the pitchers'.
        const opens = batters[spot]?.person?.id === p.id
        if (!pitchers && opens) { spot++; sub = 0 } else if (!pitchers && order.length > 9 && order[9]?.person?.id === p.id) pitchers = true
        else sub++
        const row = emptyRow(p, teamId, pitchers ? 90 : spot, pitchers ? 0 : sub, pos)
        row.uniform = order.find(s => s.person?.id === p.id)?.uniform ?? null
        Object.assign(row, {
          ab: v.ab, r: v.r, h: v.h, rbi: v.rbi, double: v['2b'], triple: v['3b'], hr: v.hr, bb: v.bb, sb: v.sb, cs: v.cs,
          hbp: v.hp, sh: v.sh, sf: v.sf, so: v.so, ibb: v.ibb, gdp: v.gdp, field_po: v.po, field_a: v.a, field_e: v.e,
        })
        const key = String(row.spot)
        ;(box[teamId][key] ??= []).push(row)
      }
    }
  }
  for (const t of pitchingTables(html)) {
    if (t.ioc !== away && t.ioc !== home) continue
    const teamId = ibafTeamId(t.ioc)
    let first = true
    for (const { name, decision, cells } of t.rows) {
      const p = who(name, t.ioc, `${t.ioc} pitching`)
      if (!p) continue
      const v = Object.fromEntries(PITCHING_COLUMNS.map((c, i) => [c, c === 'ip' ? cells[i].trim() : Number(cells[i])])) as Record<string, number | string>
      // The pitching goes on the player's batting row, so no row is a copy of another (see
      // playerLines' legacy rule), or on a row of its own (spot 90) for a pitcher who never batted.
      let row = rowsOf(teamId).find(r => r.playerid === p.id)
      if (!row) {
        row = emptyRow(p, teamId, 90, 0, 'p')
        ;(box[teamId]['90'] ??= []).push(row)
      }
      Object.assign(row, {
        pitch_appear: 1, pitch_ip: String(v.ip), pitch_h: v.h, pitch_r: v.r, pitch_er: v.er, pitch_bb: v.bb, pitch_so: v.so,
        pitch_wp: v.wp, pitch_bk: v.bk, pitch_hbp: v.hbp, pitch_bf: v.bf, pitch_pitches: v.np,
        pitch_gs: first ? 1 : 0, pitch_win: decision === 'W' ? 1 : 0, pitch_loss: decision === 'L' ? 1 : 0, pitch_save: decision === 'S' ? 1 : 0,
      })
      first = false
    }
  }
  const everyone = [...rowsOf(awayId), ...rowsOf(homeId)]
  const inGame = roster.filter(p => everyone.some(r => r.playerid === p.id))
  const page = text(html)
  if (/Score by Innings/.test(page)) {
    const block = page.slice(page.indexOf('Score by Innings'), page.indexOf(' ip h r er '))
    for (const m of block.matchAll(/\b(E|DP|LOB|2B|3B|HR|HBP|SB|CS|SF|SH|IBB|GDP|WP|PB|BK) - ([^.]+)\./g)) {
      const field = SHORT_LINES[m[1]]
      if (!field) continue
      for (const item of m[2].split(';').map(x => x.trim())) {
        const x = /^(.+?)(?: (\d+))?$/.exec(item)!
        const p = resolveName(x[1], inGame)
        if (!p || p === 'ambiguous') { problems.push(`${m[1]} - "${item}": ${p ? 'more than one player' : 'nobody in the box score'}`); continue }
        const row = everyone.find(r => r.playerid === p.id)!
        ;(row[field] as number) += Number(x[2] ?? 1)
      }
    }
  }
  // Catcher's interference is in no column, and legacy.ts counts it as a plate appearance: the
  // play-by-play's "reached on catcher's interference" is the only record of it.
  for (const m of page.matchAll(/([A-Z][A-Za-z' .-]+?) reached on catcher's interference/g)) {
    const p = resolveName(m[1].trim(), inGame)
    const row = p && p !== 'ambiguous' ? everyone.find(r => r.playerid === p.id) : null
    if (row) { row.field_ci++; notes.push(`${m[1].trim()}: a plate appearance on catcher's interference, from the play-by-play`) }
    else problems.push(`"${m[1]}" reached on catcher's interference and is nobody in the box score`)
  }
  for (const r of everyone) r.pa = r.ab + r.bb + r.hbp + r.sh + r.sf + r.field_ci
  for (const [id, ioc] of [[awayId, away], [homeId, home]] as const) if (!rowsOf(id).length) problems.push(`${ioc}: no box score`)

  // The line score: "CUBA................ 100 (10)46 - 21 8 4 (1-0)".
  // In the line-score section of a composite page, and under "Score by Innings" in the short one.
  const lineText = text(/<a name="GAME\.LIN">([\s\S]*?)Pitchers:/.exec(html)?.[1] ?? /Score by Innings([\s\S]*?)<\/pre>/.exec(html)?.[1] ?? '')
  const line = (name: string) => {
    const m = new RegExp(`${name.replace(/\./g, '\\.')}\\.*\\s+([\\d()Xx ]+?) - (\\d+) (\\d+) (\\d+)`).exec(lineText)
    if (!m) { problems.push(`no line score for ${name}`); return { innings: [] as (number | null)[], r: 0, h: 0, e: 0 } }
    return { innings: lineInnings(m[1]), r: Number(m[2]), h: Number(m[3]), e: Number(m[4]) }
  }
  const awayLine = line(awayName.trim()), homeLine = line(homeName.trim())

  // The play-by-play, by half: "<b>CUBA 1st - </b>" then the plays, then "1 run, 0 hits, 0 errors, 2 LOB."
  const ply = /<a name="GAME\.PLY">([\s\S]*?)<a name="end">/.exec(html)?.[1] ?? ''
  const all_: WbscGamePage['gamePlays']['all'] = {}
  const lob = { top: 0, bottom: 0 }
  let playorder = 0
  const pitcher = { [awayId]: 0, [homeId]: 0 }
  for (const [ioc, list] of starters) {
    const sp = list.find(s => s.pos === 'p')
    const p = sp ? who(sp.name, ioc, `${ioc} starting pitcher`) : null
    if (p) pitcher[ibafTeamId(ioc)] = p.id
  }
  for (const m of ply.matchAll(/<b>([A-Z. ]+?) (\d+(?:st|nd|rd|th)) - <\/b><\/font>([\s\S]*?)<i><b>(\d+)\s+runs?,\s+(\d+)\s+hits?,\s+(\d+)\s+errors?,\s+(\d+)\s+LOB\.<\/b><\/i>/g)) {
    const ioc = IBAF_TEAMS[m[1].trim()]
    const inning = Number(ORDINAL.exec(m[2])?.[1])
    if (!ioc || !inning) { problems.push(`a half headed "${m[1]} ${m[2]}"`); continue }
    const half = ioc === away ? 'top' : 'bottom'
    const fielding = ioc === away ? homeId : awayId
    const fieldingIoc = ioc === away ? home : away
    const runs = Number(m[4])
    lob[half] += Number(m[7])
    const cell = (half === 'top' ? awayLine : homeLine).innings[inning - 1]
    if ((cell ?? 0) !== runs) problems.push(`${ioc}: inning ${inning} play-by-play says ${runs} runs, line score has ${cell ?? 'nothing'}`)
    // A play is a sentence; a sentence ends at a full stop before the next capitalized name.
    const sentences = scorerNotes(text(m[3]).split(/(?<=\.)\s+(?=\p{Lu}|\/\s)/u).map(s => s.trim()).filter(Boolean),
      note => notes.push(`inning ${inning} ${half}: ${note}`))
    const rows: WbscPlayRow[] = []
    for (const s of sentences) {
      const change = /^(.+?) to p(?: for (.+?))?\.$/.exec(s)
      if (change && splitName(s)?.name === change[1]) {
        const p = who(change[1], fieldingIoc, `inning ${inning} ${half}, "${s}"`)
        if (p) pitcher[fielding] = p.id
      }
      rows.push({
        playorder: ++playorder, inning, batterid: 0, pitcherid: pitcher[fielding], lineupslot: 0,
        // IBAF's page holds no outs before a play. legacy.ts counts them from the prose; a null tells
        // it there is nothing to hold its count against (it checks each half ends on three instead).
        balls: 0, strikes: 0, outs: null as unknown as number,
        runner1: 0, runner2: 0, runner3: 0, runner1after: 0, runner2after: 0, runner3after: 0,
        runner1to2: 0, runner1to3: 0, runner1to4: 0, runner2to3: 0, runner2to4: 0, runner3to4: 0,
        runner1out: 0, runner2out: 0, runner3out: 0,
        result1: 0, result2: 0, result3: null, pitch_pitches: 0, pa: 0, runs: 0, narrative: s,
      })
    }
    const slot = (all_[String(inning)] ??= {})
    if (slot[half === 'top' ? 'top' : 'bot']) problems.push(`inning ${inning} ${half} appears twice`)
    slot[half === 'top' ? 'top' : 'bot'] = rows
  }

  const startTime = /Start: (\d{1,2}):(\d{2})/.exec(html)
  const time = /Time: (\d+:\d{2})/.exec(html)?.[1] ?? null
  const attendance = /Attendance: (\d+)/.exec(html)?.[1]
  const innings = Math.max(awayLine.innings.length, homeLine.innings.length)
  const gameData = {
    id: ibafGameId(gameNumber), tournamentid: IBAF_TOURNAMENT_ID, gamestatus: 3, gamestatustext: 'F',
    homeid: homeId, homeioc: home, homeruns: homeLine.r, homehits: homeLine.h, homelob: lob.bottom, homeerrors: homeLine.e,
    awayid: awayId, awayioc: away, awayruns: awayLine.r, awayhits: awayLine.h, awaylob: lob.top, awayerrors: awayLine.e,
    innings, gametypelabel: ibafRound(gameNumber),
    start: `${year}-${MONTHS[mon] ?? '00'}-${day.padStart(2, '0')} ${startTime ? `${startTime[1].padStart(2, '0')}:${startTime[2]}` : '00:00'}:00`,
    start_tz: 'America/Caracas', attendance: attendance ? Number(attendance) : null, duration: time,
    stadium: stadium.trim(), location: city.trim(),
  } as WbscGameData
  awayLine.innings.forEach((r, i) => { gameData[`runsaway${i + 1}`] = r ?? -1 })
  homeLine.innings.forEach((r, i) => { gameData[`runshome${i + 1}`] = r ?? -1 })
  if (!MONTHS[mon]) problems.push(`a date in "${mon}"`)

  return { page: { gameData, boxScore: box, gamePlays: { all: all_ }, ibaf: true }, problems, notes }
}
