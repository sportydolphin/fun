import { FIRST_KINDS } from './firsts'
import { plateAppearanceLines, runnerResolver, type PlateAppearanceLine } from './inningLines'
import { countsInStandings } from './season'
import type { League, LeagueGame, RunValuePlay } from './types'

/**
 * LIVE NOTES: every first, record, milestone, streak and rarity a game produces, as it is played,
 * each with the earlier plays that prove it. The owner reads all of them in /admin; readers see the
 * few that score highest (ROADMAP-WPBL, "Live notes").
 *
 * ONE WALK OVER EVERY GAME, IN THE ORDER THEY WERE PLAYED. History is whatever came before a play, so
 * the same function answers a live game (its plays so far are simply the last ones walked) and a
 * finished one (each note fires at the play that made it true). It is pure and cheap, about 4,000
 * rows a season, so a live page reruns it on every poll: a note a correction removes is simply no
 * longer produced, which matters because the league edits finals for days.
 *
 * BUILT ON WHAT FIND READS. The plate appearances are `plateAppearanceLines` and the kinds of play
 * are `FIRST_KINDS`, so a note can never disagree with a Find answer or a first about what happened.
 * What only a league's own text can say (the throw chain of a double play, who was charged with an
 * error) comes in through `NotesSource.read`, and who stood at a position through `fielderAt`.
 *
 * COUNTED AT EVERY LENS. A play yields facts (a home run, a 6-4-3 double play, a runner thrown out at
 * home 7-2), and each fact is counted at every lens it has: the league ever, the postseason, the
 * season, the club, the player's career and season, the pitcher it came against, the batter and
 * pitcher pair, and the crew, the exact defenders in a chain. The first three times at a lens are
 * notes, and so are round numbers. That is what makes the owner's list as wide as the log allows;
 * the score decides what a reader sees.
 *
 * THE POSTSEASON NEVER REACHES A SEASON LENS, a season record or a season leader (countsInStandings,
 * src/wpbl/CLAUDE.md). It has a lens of its own and counts toward "ever".
 */

// ── Types ───────────────────────────────────────────────────────────────────────

export type NoteCategory = 'first' | 'rare' | 'milestone' | 'record' | 'streak' | 'watch' | 'situation' | 'matchup' | 'leader'

/** Where a fact is counted. `against` is the pitcher it came against; `pair` the batter against that
 *  pitcher; `crew` the defenders in a throw chain, in order. */
export type NoteLens = 'league' | 'postseason' | 'season' | 'club' | 'club-season' | 'player' | 'player-season'
  | 'against' | 'pair' | 'crew' | 'game'

export type NotePos = 'p' | 'c' | '1b' | '2b' | '3b' | 'ss' | 'lf' | 'cf' | 'rf'
const POS_NUMBER: Record<NotePos, number> = { p: 1, c: 2, '1b': 3, '2b': 4, '3b': 5, ss: 6, lf: 7, cf: 8, rf: 9 }
const OUTFIELD = new Set<NotePos>(['lf', 'cf', 'rf'])

/** A play the note points back to. `sequence` is null for a whole game (a final score, a situation). */
export interface NotePlace { game_id: string; sequence: number | null; date: string }

export interface LiveNote {
  /** Stable across reruns, so a note already shown or posted can be recognized. */
  key: string
  /** Notes in one group describe one thing as it grows (a no-hitter through 5, then 6); the latest wins. */
  group: string
  category: NoteCategory
  /** What happened: 'hr', 'dp:6-4-3', 'record:p.h', 'watch:no-hitter'. */
  kind: string
  lens: NoteLens
  text: string
  /** A second line: the record it beat, the history behind a situation. */
  detail: string | null
  players: string[]
  clubs: string[]
  game_id: string
  /** The row it fires on (Game Center's `#play-N`); null before the first pitch. */
  sequence: number | null
  inning: number | null
  half: 'top' | 'bottom' | null
  /** Which time this is at its lens, for a counted note. */
  nth: number | null
  /** The earlier times, oldest first, at most ten; `beforeTotal` is all of them. */
  before: NotePlace[]
  beforeTotal: number
  score: number
  /** A later note in the same group replaced it. */
  superseded: boolean
  /** Among the few a reader sees. */
  public: boolean
}

/** A chain of throws the scorer wrote, read by the league's own adapter. */
export interface ThrowChain {
  what: 'dp' | 'tp' | 'out'
  /** The base a runner was put out at, for `out`. */
  base: 'first' | 'second' | 'third' | 'home' | null
  chain: NotePos[]
  how: 'cs' | 'pk' | null
}

/** What only the league's own text says about a row. */
export interface PlayReading { chains: ThrowChain[]; errors: NotePos[] }

export interface NotesSource<G extends LeagueGame> {
  league: League
  /** "WPBL", as the text names the league. */
  leagueName: string
  /** Every game of every season with plays: history is all of it. */
  games: readonly G[]
  /** Every row of those games, corrections applied. */
  plays: readonly RunValuePlay[]
  season: (g: G) => number | null
  /** Sorts the games: date, then first pitch. */
  when: (g: G) => string
  playerName: (id: string) => string
  clubName: (id: string) => string
  read?: (p: RunValuePlay) => PlayReading
  /** Who played a position for a club at a row; null when the log cannot say. */
  fielderAt?: (gameId: string, clubId: string, pos: NotePos, sequence: number) => string | null
}

export interface NotesOptions {
  /** A note at or above this score can be shown to readers. */
  publicBar?: number
  /** At most this many public notes a game. */
  publicCap?: number
}

/** Set from the 2026 backtest (`npm run notes -- --season`): about two a game, none at all in a quiet
 *  one. At 60 it was nearly three a game; at 65, under two. */
export const PUBLIC_BAR = 62
export const PUBLIC_CAP = 4

// ── Facts ───────────────────────────────────────────────────────────────────────

/** One thing that happened, to be counted at each of its lenses. */
interface Fact {
  kind: string
  /** "home run", "6-4-3 double play". */
  noun: string
  /** The pitcher's side of it: "home run allowed". Present only where it reads. */
  against?: string
  /** Happens about once a game or more, so only its first time and big round numbers are notes. */
  common: boolean
  owner: string | null
  club: string | null
  pitcher: string | null
  /** Counted against the batter and pitcher pair. */
  pair?: boolean
  crew?: string[]
  /** Whole-game facts (a final score) have no owner lens even with a club. */
  leagueOnly?: boolean
  /** One shape of a kind counted on its own (a 9-4-5 assist, a 15–11 final): new far more often
   *  than the kind, so its firsts score below the kind's. */
  variant?: boolean
  /** One player's view of a kind counted elsewhere (a catcher's runners caught stealing): its own
   *  league count would repeat that kind's. */
  playerOnly?: boolean
  /** A club's own count (its wins): "the first win in WPBL history" says nothing, so no league lens. */
  clubOnly?: boolean
}

const COMMON = new Set(['hit', 'single', 'walk', 'so', 'double', 'hbp', 'sb', 'ifh', 'wp', 'error', 'dp', 'cs', 'cs-c', 'ofa'])
const AGAINST: Record<string, string> = {
  hr: 'home run allowed', slam: 'grand slam allowed', triple: 'triple allowed', walkoff: 'walk-off allowed',
  leadoffhr: 'leadoff home run allowed', phhr: 'pinch-hit home run allowed', hbp: 'hit batter',
}
const PAIR = new Set(['hr', 'slam', 'triple', 'walkoff'])
/** Against the player who owns it: a first wild pitch is real, and no reader wants it shown. */
const NEGATIVE = new Set(['cs', 'pb', 'wp', 'bk', 'error'])
/** Rare in the league, ordinary for the player: a pickoff is a throw any pitcher or catcher makes, and
 *  its league rarity would otherwise put every player's first one in front of readers. */
const QUIET = new Set(['pk'])
const MILESTONES = [5, 10, 20, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 5000]
const PLAYER_LENSES = new Set<NoteLens>(['player', 'player-season', 'against'])

/** The noun a first's label names: "First home run" is "home run". */
const nounOf = (label: string) => label.replace(/^First\s+/, '')

// ── Text ────────────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}
const WORD: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third' }
const ord = (n: number) => WORD[n] ?? ordinal(n)
const Ord = (n: number) => { const w = ord(n); return w[0].toUpperCase() + w.slice(1) }
const digits = (chain: NotePos[]) => chain.map(p => POS_NUMBER[p]).join('-')

// ── Scoring ─────────────────────────────────────────────────────────────────────

const LENS_WEIGHT: Record<NoteLens, number> = {
  league: 30, postseason: 22, season: 12, club: 6, 'club-season': -4, player: 8, 'player-season': -8,
  against: -2, pair: -8, crew: -8, game: 0,
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const VARIANT = -25
/** A record's weight. Every record falls in a league's first weeks, so a record set against a short
 *  history counts for less: zero at ten games of the scope, more as it deepens. */
const RECORD_LENS = { league: 20, postseason: 10, season: 8 }
const depthBonus = (games: number) => clamp(Math.round(10 * Math.log10(Math.max(games, 1) / 10)), -8, 10)

// ── The walk ────────────────────────────────────────────────────────────────────

interface Seen { n: number; last: NotePlace[] }
interface Valued { v: number; place: NotePlace; who: string }

/** A single-unit record: a player's or a club's game, an inning, a plate appearance. */
interface RecordDef { noun: string; unit: 'game' | 'inning' | 'pa'; min: number }
const RECORDS: Record<string, RecordDef> = {
  'p.h': { noun: 'hits', unit: 'game', min: 3 },
  'p.hr': { noun: 'home runs', unit: 'game', min: 2 },
  'p.2b': { noun: 'doubles', unit: 'game', min: 2 },
  'p.3b': { noun: 'triples', unit: 'game', min: 2 },
  'p.tb': { noun: 'total bases', unit: 'game', min: 8 },
  'p.bb': { noun: 'walks', unit: 'game', min: 3 },
  'p.so': { noun: 'strikeouts', unit: 'game', min: 4 },
  'p.hbp': { noun: 'times hit by a pitch', unit: 'game', min: 2 },
  'p.sb': { noun: 'stolen bases', unit: 'game', min: 2 },
  'k.so': { noun: 'strikeouts', unit: 'game', min: 7 },
  'k.pitches': { noun: 'pitches', unit: 'game', min: 95 },
  'c.r': { noun: 'runs', unit: 'game', min: 10 },
  'c.h': { noun: 'hits', unit: 'game', min: 13 },
  'c.hr': { noun: 'home runs', unit: 'game', min: 3 },
  'c.bb': { noun: 'walks', unit: 'game', min: 9 },
  'c.sb': { noun: 'stolen bases', unit: 'game', min: 4 },
  'f.so': { noun: 'strikeouts by its pitchers', unit: 'game', min: 12 },
  'i.r': { noun: 'runs', unit: 'inning', min: 5 },
  'i.h': { noun: 'hits', unit: 'inning', min: 5 },
  'i.hr': { noun: 'home runs', unit: 'inning', min: 2 },
  'i.bb': { noun: 'walks', unit: 'inning', min: 4 },
  'pa.pitches': { noun: 'pitches', unit: 'pa', min: 10 },
  'pa.fouls': { noun: 'fouls', unit: 'pa', min: 6 },
  'g.innings': { noun: 'innings', unit: 'game', min: 0 },
  'g.margin': { noun: 'run margin', unit: 'game', min: 10 },
  'g.comeback': { noun: 'run comeback', unit: 'game', min: 4 },
  'g.total': { noun: 'runs between the clubs', unit: 'game', min: 20 },
}
/** Games of a scope before it can hold a record ("most in a WPBL game" off three games is noise). */
const RECORD_HISTORY = { reg: 10, post: 6, season: 10 }

/** `weight` lifts a kind whose record is worth more than its length says: three games in a row with a
 *  home run is rarer than nine with a hit. */
interface StreakDef { label: (n: number) => string; min: number; endsMin: number; weight?: number }
const STREAKS: Record<string, StreakDef> = {
  hit: { label: n => `hit in ${n} straight games`, min: 6, endsMin: 8 },
  hr: { label: n => `homered in ${n} straight games`, min: 3, endsMin: Infinity, weight: 6 },
  ob: { label: n => `reached base in ${n} straight games`, min: 10, endsMin: 12 },
  retired: { label: n => `${n} batters retired in a row`, min: 9, endsMin: Infinity },
  krow: { label: n => `${n} strikeouts in a row`, min: 4, endsMin: Infinity },
  win: { label: n => `${n} straight wins`, min: 3, endsMin: 5 },
  loss: { label: n => `${n} straight losses`, min: 4, endsMin: 6 },
}

const LEADER_STATS: Record<string, { noun: string; min: number }> = {
  h: { noun: 'hits', min: 8 }, hr: { noun: 'home runs', min: 3 }, '2b': { noun: 'doubles', min: 4 },
  '3b': { noun: 'triples', min: 2 }, bb: { noun: 'walks', min: 6 }, sb: { noun: 'stolen bases', min: 4 },
  k: { noun: 'strikeouts', min: 15 },
}

/**
 * Every note of every game walked, by game id, in the order each fired. Pass the games a page needs
 * and their history: the walk reads them all, and a game's notes depend only on what came before it.
 */
export function liveNotes<G extends LeagueGame>(src: NotesSource<G>, opts: NotesOptions = {}): Map<string, LiveNote[]> {
  const { league, leagueName: L } = src
  const bar = opts.publicBar ?? PUBLIC_BAR
  const cap = opts.publicCap ?? PUBLIC_CAP
  const order = [...src.games].sort((a, b) => {
    const x = src.when(a), y = src.when(b)
    return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  const allPlays = [...src.plays]
  const rowsByGame = new Map<string, RunValuePlay[]>()
  for (const p of allPlays) {
    const list = rowsByGame.get(p.game_id) ?? []
    list.push(p)
    rowsByGame.set(p.game_id, list)
  }
  for (const list of rowsByGame.values()) list.sort((a, b) => a.sequence - b.sequence)
  const lineAt = new Map<string, PlateAppearanceLine>()
  for (const l of plateAppearanceLines(league, allPlays, [...src.games])) lineAt.set(l.id, l)
  const runners = runnerResolver(allPlays)
  const name = (id: string | null) => (id ? src.playerName(id) : 'Unknown')
  const club = (id: string | null) => (id ? src.clubName(id) : 'Unknown')

  // History, carried from game to game.
  const seen = new Map<string, Seen>()
  const records = new Map<string, Valued[]>()
  const streakNow = new Map<string, number>()
  const streakDone = new Map<string, Valued[]>()
  const matchups = new Map<string, { pa: number; ab: number; h: number; hr: number; bb: number; so: number }>()
  const leaders = new Map<string, Map<string, number>>()
  /** `${inning}|${deficit}` → how clubs trailing by exactly that much after that inning finished. */
  const comebacks = new Map<string, { w: number; l: number; games: NotePlace[] }>()
  const gamesIn = { reg: 0, post: 0, season: new Map<number, number>() }

  const out = new Map<string, LiveNote[]>()

  for (const g of order) {
    const rows = rowsByGame.get(g.id)
    if (!rows?.length) continue
    const post = !countsInStandings(g)
    const season = src.season(g)
    const date = g.game_date
    const notes: LiveNote[] = []
    out.set(g.id, notes)
    const at = (sequence: number | null): NotePlace => ({ game_id: g.id, sequence, date })
    const other = (team: string | null) => (team == null ? null : team === g.home_team_id ? g.away_team_id : g.home_team_id)
    let row: RunValuePlay = rows[0]
    const score = { away: 0, home: 0 }

    const push = (n: Omit<LiveNote, 'game_id' | 'sequence' | 'inning' | 'half' | 'superseded' | 'public'>
      & { sequence?: number | null }) => {
      const sequence = n.sequence === undefined ? row.sequence : n.sequence
      const r = sequence == null ? null : rows.find(x => x.sequence === sequence) ?? row
      notes.push({
        ...n, game_id: g.id, sequence, inning: r?.inning ?? null, half: r?.half ?? null,
        score: Math.round(clamp(n.score, 0, 100)), superseded: false, public: false,
      })
    }
    const gamesSoFar = () => gamesIn.reg + gamesIn.post
    /** How often a kind has happened per game, league-wide, so far; null too early to say. */
    const perGame = (kind: string): number | null => {
      const games = gamesSoFar()
      if (games < 5) return null
      return Math.max(seen.get(`league|${kind}|`)?.n ?? 0, 0.5) / games
    }
    const rarity = (kind: string) => {
      const rate = perGame(kind)
      return rate == null ? 0 : clamp(Math.round(-8 * Math.log10(rate)), -12, 16)
    }

    // ── Counted facts ──
    const lensesOf = (f: Fact): [NoteLens, string][] => {
      if (f.clubOnly) {
        if (!f.club) return []
        return !post && season != null ? [['club', f.club], ['club-season', `${f.club}|${season}`]] : [['club', f.club]]
      }
      if (f.playerOnly) {
        if (!f.owner) return []
        return !post && season != null ? [['player', f.owner], ['player-season', `${f.owner}|${season}`]] : [['player', f.owner]]
      }
      const ls: [NoteLens, string][] = [['league', '']]
      if (post) ls.push(['postseason', ''])
      else if (season != null) ls.push(['season', String(season)])
      if (f.leagueOnly) return ls
      if (f.club) {
        ls.push(['club', f.club])
        if (!post && season != null) ls.push(['club-season', `${f.club}|${season}`])
      }
      if (f.owner) {
        ls.push(['player', f.owner])
        if (!post && season != null) ls.push(['player-season', `${f.owner}|${season}`])
        if (f.pitcher && f.pair) ls.push(['pair', `${f.owner}|${f.pitcher}`])
      }
      if (f.pitcher && f.against) ls.push(['against', f.pitcher])
      if (f.crew && f.crew.length >= 2) ls.push(['crew', f.crew.join(',')])
      return ls
    }
    const textOf = (f: Fact, lens: NoteLens, n: number): string => {
      const who = name(f.owner)
      switch (lens) {
        case 'league': return `${Ord(n)} ${f.noun} in ${L} history`
        case 'postseason': return `${Ord(n)} ${f.noun} in ${L} postseason history`
        case 'season': return `${Ord(n)} ${f.noun} of ${season}`
        case 'club': return `${club(f.club)}: ${ord(n)} ${f.noun} in club history`
        case 'club-season': return `${club(f.club)}: ${ord(n)} ${f.noun} of ${season}`
        case 'player': return `${who}: ${ord(n)} career ${f.noun}`
        case 'player-season': return `${who}: ${ord(n)} ${f.noun} of ${season}`
        case 'against': return `${name(f.pitcher)}: ${ord(n)} ${f.against}`
        case 'pair': return `${who}: ${ord(n)} ${f.noun} off ${name(f.pitcher)}`
        case 'crew': return `${Ord(n)} ${f.noun} from ${(f.crew ?? []).map(name).join(' to ')}`
        default: return `${Ord(n)} ${f.noun}`
      }
    }
    /** Whether the nth time at a lens is a note, and of which category. */
    const counts = (f: Fact, lens: NoteLens, n: number): NoteCategory | null => {
      const narrow = lens === 'crew' || lens === 'pair' || lens === 'club-season' || lens === 'player-season'
      if (n === 1 && !(f.common && narrow && lens !== 'crew')) return 'first'
      if (n <= 3 && !f.common && !narrow && !f.clubOnly) return 'rare'
      if (!MILESTONES.includes(n) || lens === 'crew' || lens === 'pair') return null
      const floor = PLAYER_LENSES.has(lens) ? (f.common ? 25 : 5) : (f.common ? 100 : 10)
      return n >= floor ? 'milestone' : null
    }
    const count = (f: Fact, sequence: number | null = row.sequence) => {
      for (const [lens, id] of lensesOf(f)) {
        const sig = `${lens}|${f.kind}|${id}`
        const s = seen.get(sig) ?? { n: 0, last: [] }
        const n = s.n + 1
        const category = counts(f, lens, n)
        if (category) {
          let score = category === 'first' ? 40 + 10 : category === 'rare' ? 28 + (n === 2 ? 0 : -4)
            : 22 + 8 * Math.log10(n) + (f.common ? -10 : 0)
          // A variant's own shape is nearly always new, and a player's view repeats a kind counted
          // elsewhere, so neither takes the bonus for a kind that rarely happens.
          score += LENS_WEIGHT[lens] + (f.variant || f.playerOnly || f.clubOnly ? 0 : rarity(f.kind))
          if (f.variant && !PLAYER_LENSES.has(lens) && lens !== 'crew') score += VARIANT
          if (NEGATIVE.has(f.kind) && PLAYER_LENSES.has(lens)) score -= 15
          if (QUIET.has(f.kind) && PLAYER_LENSES.has(lens)) score -= 8
          push({
            key: `${sig}|${n}`, group: `${sig}|${n}`, category, kind: f.kind, lens, text: textOf(f, lens, n),
            detail: s.last.length ? `Last: ${s.last[s.last.length - 1].date}` : null,
            players: [f.owner, f.pitcher, ...(f.crew ?? [])].filter((x): x is string => !!x),
            clubs: f.club ? [f.club] : [], nth: n, before: [...s.last], beforeTotal: s.n, score, sequence,
          })
        }
        s.n = n
        s.last.push(at(sequence))
        if (s.last.length > 10) s.last.shift()
        seen.set(sig, s)
      }
    }

    // ── Records in a game, an inning, a plate appearance ──
    const scopes = (): { id: string; label: string; enough: boolean; depth: number }[] => {
      const list = [post
        ? { id: 'post', label: `${L} postseason`, enough: gamesIn.post >= RECORD_HISTORY.post, depth: gamesIn.post }
        : { id: 'reg', label: L, enough: gamesIn.reg >= RECORD_HISTORY.reg, depth: gamesIn.reg }]
      if (!post && season != null) {
        const depth = gamesIn.season.get(season) ?? 0
        list.push({ id: `s${season}`, label: String(season), enough: depth >= RECORD_HISTORY.season, depth })
      }
      return list
    }
    const unitWord = (u: RecordDef['unit']) => (u === 'pa' ? 'plate appearance' : u)
    /** A running total just went up: is it a record, a tie, or rare? */
    const record = (stat: string, subject: string, who: string, v: number, players: string[], clubs: string[],
      sequence: number | null = row.sequence) => {
      const def = RECORDS[stat]
      if (v < def.min) return
      for (const sc of scopes()) {
        if (!sc.enough) continue
        const hist = records.get(`${stat}|${sc.id}`) ?? []
        const max = hist.reduce((m, h) => Math.max(m, h.v), 0)
        const atLeast = hist.filter(h => h.v >= v)
        const seasonScope = sc.id.startsWith('s')
        const inWhat = seasonScope ? `a ${unitWord(def.unit)} of ${sc.label}` : `a ${sc.label} ${unitWord(def.unit)}`
        let text: string, bonus: number
        if (v > max) { text = `${who}: ${v} ${def.noun}, the most in ${inWhat}`; bonus = 18 }
        else if (v === max) { text = `${who}: ${v} ${def.noun}, tied for the most in ${inWhat}`; bonus = 6 }
        else if (atLeast.length < (seasonScope ? 2 : 5)) {
          text = `${who}: ${v} ${def.noun}, the ${ordinal(atLeast.length + 1)} time with ${v} or more in ${inWhat}`
          bonus = -4 * atLeast.length
        } else continue
        const best = [...hist].sort((a, b) => b.v - a.v)[0]
        push({
          key: `record|${stat}|${sc.id}|${subject}|${g.id}|${v}`, group: `record|${stat}|${subject}|${g.id}`,
          category: 'record', kind: `record:${stat}`, lens: seasonScope ? 'season' : post ? 'postseason' : 'league',
          text, detail: best ? `Previous best: ${best.v}, ${best.who}, ${best.place.date}` : null,
          players, clubs, nth: null, before: atLeast.slice(-10).map(h => h.place), beforeTotal: atLeast.length,
          score: 30 + (seasonScope ? RECORD_LENS.season : post ? RECORD_LENS.postseason : RECORD_LENS.league) + bonus
            + Math.min(10, 3 * (v - def.min)) + depthBonus(sc.depth),
          sequence,
        })
        return
      }
    }
    const keep = (stat: string, v: number, who: string, place: NotePlace) => {
      if (v <= 0) return
      for (const sc of scopes()) {
        const k = `${stat}|${sc.id}`
        const list = records.get(k) ?? []
        list.push({ v, place, who })
        records.set(k, list)
      }
    }

    // ── Streaks ──
    const streakBest = (kind: string, exclude: string) => {
      let best = 0
      for (const h of streakDone.get(kind) ?? []) best = Math.max(best, h.v)
      for (const [k, v] of streakNow) if (k.startsWith(`${kind}|`) && k !== `${kind}|${exclude}`) best = Math.max(best, v)
      return best
    }
    const streak = (kind: string, subject: string, who: string, n: number, players: string[], clubs: string[],
      sequence: number | null = row.sequence) => {
      const def = STREAKS[kind]
      if (n < def.min) return
      const best = streakBest(kind, subject)
      const tail = n > best && best > 0 ? `, the longest in ${L} history` : n === best ? `, tied for the longest in ${L} history` : ''
      push({
        key: `streak|${kind}|${subject}|${g.id}|${n}`, group: `streak|${kind}|${subject}|${g.id}`, category: 'streak',
        kind: `streak:${kind}`, lens: 'league', text: `${who}: ${def.label(n)}${tail}`,
        detail: best > 0 ? `${L} best before: ${best}` : null, players, clubs, nth: null, before: [], beforeTotal: 0,
        score: 28 + (def.weight ?? 0) + Math.min(15, n - def.min) + (n > best && best > 0 ? 32 : n === best ? 18 : 0), sequence,
      })
    }
    const endStreak = (kind: string, subject: string, who: string, place: NotePlace, players: string[], clubs: string[]) => {
      const n = streakNow.get(`${kind}|${subject}`) ?? 0
      streakNow.delete(`${kind}|${subject}`)
      if (n <= 0) return
      const list = streakDone.get(kind) ?? []
      list.push({ v: n, place, who })
      streakDone.set(kind, list)
      if (n >= STREAKS[kind].endsMin) {
        push({
          key: `streak-end|${kind}|${subject}|${g.id}`, group: `streak|${kind}|${subject}|${g.id}`, category: 'streak',
          kind: `streak-end:${kind}`, lens: 'league', text: `${who}: streak ends at ${n} (${STREAKS[kind].label(n)})`,
          detail: null, players, clubs, nth: null, before: [], beforeTotal: 0, score: 30 + Math.min(15, n - STREAKS[kind].endsMin),
          sequence: place.sequence,
        })
      }
    }

    // ── Leaders ──
    const lead = (stat: string, pid: string, teamId: string | null) => {
      if (post || season == null) return
      const key = `${season}|${stat}`
      const table = leaders.get(key) ?? new Map<string, number>()
      leaders.set(key, table)
      const before = table.get(pid) ?? 0
      const now = before + 1
      table.set(pid, now)
      const def = LEADER_STATS[stat]
      if (now < def.min) return
      let others = 0
      for (const [id, v] of table) if (id !== pid) others = Math.max(others, v)
      const wasSole = before > others
      if (now < others || wasSole) return
      const sole = now > others
      push({
        key: `leader|${stat}|${season}|${pid}|${now}`, group: `leader|${stat}|${g.id}`, category: 'leader',
        kind: `leader:${stat}`, lens: 'season',
        text: `${name(pid)}: ${sole ? 'takes' : 'ties for'} the ${L} lead in ${def.noun}, ${now}`,
        detail: null, players: [pid], clubs: teamId ? [teamId] : [], nth: null, before: [], beforeTotal: 0,
        score: 34 + (sole ? 8 : 0) + (stat === 'hr' ? 6 : 0),
      })
    }

    // ── This game, as it goes ──
    const tally = new Map<string, number>()
    const bump = (k: string, by = 1) => { const v = (tally.get(k) ?? 0) + by; tally.set(k, v); return v }
    const hitsAllowed = new Map<string, number>()
    const reachedAgainst = new Map<string, number>()
    const pitchersFor = new Map<string, Set<string>>()
    const cycles = new Map<string, Set<string>>()
    const met = new Set<string>()
    const firstHit = new Set<string>()
    const firstOn = new Set<string>()
    const firstHr = new Set<string>()
    const batted = new Map<string, { team: string | null; last: number }>()
    const lastRowBy = new Map<string, number>()
    const inningEnds: { inning: number; away: number; home: number }[] = []
    let deficit = { away: 0, home: 0 }
    let half: { inning: number; half: 'top' | 'bottom'; team: string | null; r: number; h: number; hr: number; bb: number; last: number } | null = null

    const closeHalf = () => {
      if (!half) return
      const h = half
      half = null
      if (h.team) {
        const who = `${club(h.team)}, ${h.half} of the ${ordinal(h.inning)}`
        for (const [stat, v] of [['i.r', h.r], ['i.h', h.h], ['i.hr', h.hr], ['i.bb', h.bb]] as const) {
          record(stat, `${h.team}|${h.inning}`, who, v, [], [h.team], h.last)
          keep(stat, v, who, at(h.last))
        }
      }
      if (h.half !== 'bottom') return
      inningEnds.push({ inning: h.inning, away: score.away, home: score.home })
      if (h.inning >= league.regulationInnings) return
      // Watches, through a full inning.
      for (const team of [g.away_team_id, g.home_team_id]) {
        if (h.inning < 4 || (hitsAllowed.get(team) ?? 0) > 0) continue
        const perfect = (reachedAgainst.get(team) ?? 0) === 0
        const kind = perfect ? 'perfect-game' : 'no-hitter'
        const before = seen.get(`league|${kind}|`)?.n ?? 0
        push({
          key: `watch|${kind}|${team}|${g.id}|${h.inning}`, group: `watch|no-hit|${team}|${g.id}`, category: 'watch',
          kind: `watch:${kind}`, lens: 'game',
          text: `${club(team)}: ${perfect ? 'perfect game' : 'no-hitter'} through ${h.inning} innings`,
          detail: before ? `${L} ${perfect ? 'perfect games' : 'no-hitters'} so far: ${before}` : `No ${L} ${perfect ? 'perfect game' : 'no-hitter'} yet`,
          players: [...(pitchersFor.get(team) ?? [])], clubs: [team], nth: null,
          before: seen.get(`league|${kind}|`)?.last ?? [], beforeTotal: before,
          score: 18 + 8 * (h.inning - 3) + (perfect ? 10 : 0) + (before ? 0 : 8), sequence: h.last,
        })
      }
      // Situations: a club well behind, against every club that stood there before.
      const diff = score.home - score.away
      const d = Math.abs(diff)
      if (h.inning >= 3 && d >= 3) {
        let w = 0, l = 0
        const games: NotePlace[] = []
        for (const [k, v] of comebacks) {
          const [inn, def] = k.split('|').map(Number)
          if (inn === h.inning && def >= d) { w += v.w; l += v.l; games.push(...v.games) }
        }
        if (w + l >= 3) {
          const trailing = diff > 0 ? g.away_team_id : g.home_team_id
          push({
            key: `situation|${trailing}|${g.id}|${h.inning}|${d}`, group: `situation|${trailing}|${g.id}`, category: 'situation',
            kind: 'situation:behind', lens: 'league', text: `${club(trailing)}: down ${d} after ${h.inning} innings`,
            detail: `Clubs down ${d} or more after ${h.inning} in ${L} history: ${w}–${l}`,
            players: [], clubs: [trailing], nth: null, before: games.slice(-10), beforeTotal: games.length,
            score: 16 + 2 * d + (w === 0 ? 12 : 0) + Math.min(8, Math.floor((w + l) / 4)), sequence: h.last,
          })
        }
      }
    }

    for (const p of rows) {
      row = p
      if (!half || half.inning !== p.inning || half.half !== p.half) {
        closeHalf()
        if (p.inning > league.regulationInnings && p.half === 'top' && !tally.has(`extra|${p.inning}`)) {
          tally.set(`extra|${p.inning}`, 1)
          if (p.inning === league.regulationInnings + 1) {
            count({ kind: 'extras', noun: 'extra-inning game', common: false, owner: null, club: null, pitcher: null, leagueOnly: true })
          }
          record('g.innings', g.id, `${club(g.away_team_id)} at ${club(g.home_team_id)}`, p.inning, [], [g.away_team_id, g.home_team_id])
        }
        half = { inning: p.inning, half: p.half, team: p.team_id, r: 0, h: 0, hr: 0, bb: 0, last: p.sequence }
      }
      half.last = p.sequence
      const batting = p.team_id
      const fielding = other(batting)
      const runs = league.runsOnPlay(p)
      if (runs > 0 && batting) {
        if (batting === g.home_team_id) score.home += runs
        else score.away += runs
        half.r += runs
        record('c.r', batting, club(batting), bump(`c.r|${batting}`, runs), [], [batting])
      }
      deficit = { away: Math.max(deficit.away, score.home - score.away), home: Math.max(deficit.home, score.away - score.home) }
      if (p.pitcher_id && fielding) {
        const set = pitchersFor.get(fielding) ?? new Set()
        set.add(p.pitcher_id)
        pitchersFor.set(fielding, set)
      }
      const line = lineAt.get(`${p.game_id}|${p.sequence}`)
      const reading = src.read?.(p) ?? { chains: [], errors: [] }

      if (line) {
        const b = line.batter_id
        const k = line.pitcher_id
        if (b) {
          batted.set(b, { team: batting, last: p.sequence })
          lastRowBy.set(b, p.sequence)
        }
        // The matchup, before this trip counts.
        if (b && k && !met.has(`${b}|${k}`)) {
          met.add(`${b}|${k}`)
          const m = matchups.get(`${b}|${k}`)
          if (m && m.pa >= 4) {
            const parts = [`${m.h}-for-${m.ab}`]
            if (m.hr) parts.push(`${m.hr} HR`)
            if (m.bb) parts.push(`${m.bb} BB`)
            if (m.so) parts.push(`${m.so} K`)
            const avg = m.ab ? m.h / m.ab : 0
            const extreme = (m.ab >= 6 && avg >= 0.5 ? 14 : 0) + (m.ab >= 7 && m.h === 0 ? 14 : 0) + (m.hr >= 2 ? 10 : 0)
            push({
              key: `matchup|${b}|${k}|${g.id}`, group: `matchup|${b}|${k}|${g.id}`, category: 'matchup', kind: 'matchup',
              lens: 'pair', text: `${name(b)} vs. ${name(k)}: ${parts.join(', ')}`, detail: `${m.pa} PA before this game`,
              players: [b, k], clubs: batting ? [batting] : [], nth: null, before: [], beforeTotal: m.pa,
              score: 10 + extreme + Math.min(6, m.pa - 4),
            })
          }
        }
        // Facts off the plate appearance, the same kinds and tests as the firsts.
        for (const def of FIRST_KINDS) {
          if (def.source !== 'pa' || !def.test(line)) continue
          const byPitcher = def.by === 'pitcher'
          count({
            kind: def.kind, noun: nounOf(def.label), against: byPitcher ? undefined : AGAINST[def.kind],
            common: COMMON.has(def.kind), owner: byPitcher ? k : b,
            club: byPitcher ? line.fielding_team : line.batting_team, pitcher: byPitcher ? null : k,
            pair: PAIR.has(def.kind),
          })
        }
        if ((line.hrrow ?? 0) === 2) count({ kind: 'b2bhr', noun: 'back-to-back home runs', common: false, owner: null, club: batting, pitcher: null })
        if ((line.hrrow ?? 0) >= 3) count({ kind: 'b3bhr', noun: 'three home runs in a row', common: false, owner: null, club: batting, pitcher: null })

        // Running totals, each checked against the record as it climbs.
        if (b) {
          const who = name(b)
          const mine = [b], clubs = batting ? [batting] : []
          if (line.h) {
            record('p.h', b, who, bump(`p.h|${b}`), mine, clubs)
            // A game streak is a regular-season run, as MLB keeps them: the postseason neither
            // extends one nor ends it.
            if (!post && !firstHit.has(b)) {
              firstHit.add(b)
              const n = (streakNow.get(`hit|${b}`) ?? 0) + 1
              streakNow.set(`hit|${b}`, n)
              streak('hit', b, who, n, mine, clubs)
            }
            const type = line.hr ? 'hr' : line.triples ? '3b' : line.doubles ? '2b' : '1b'
            const set = cycles.get(b) ?? new Set<string>()
            set.add(type)
            cycles.set(b, set)
            if (set.size === 4 && !tally.has(`cycle|${b}`)) {
              tally.set(`cycle|${b}`, 1)
              count({ kind: 'cycle', noun: 'cycle', common: false, owner: b, club: batting, pitcher: null })
            } else if (set.size === 3 && !tally.has(`cycle-watch|${b}`)) {
              tally.set(`cycle-watch|${b}`, 1)
              const missing = (['1b', '2b', '3b', 'hr'] as const).find(t => !set.has(t))!
              const word = { '1b': 'single', '2b': 'double', '3b': 'triple', hr: 'home run' }[missing]
              const before = seen.get('league|cycle|')?.n ?? 0
              push({
                key: `watch|cycle|${b}|${g.id}`, group: `watch|cycle|${b}|${g.id}`, category: 'watch', kind: 'watch:cycle',
                lens: 'game', text: `${who}: a ${word} short of the cycle`,
                detail: before ? `${L} cycles so far: ${before}` : `No ${L} cycle yet`, players: mine, clubs, nth: null,
                before: seen.get('league|cycle|')?.last ?? [], beforeTotal: before,
                score: 38 + (missing === '3b' ? -6 : 0) + (before ? 0 : 8),
              })
            }
          }
          if (line.hr) { record('p.hr', b, who, bump(`p.hr|${b}`), mine, clubs); lead('hr', b, batting) }
          if (line.hr && !post && !firstHr.has(b)) {
            firstHr.add(b)
            const n = (streakNow.get(`hr|${b}`) ?? 0) + 1
            streakNow.set(`hr|${b}`, n)
            streak('hr', b, who, n, mine, clubs)
          }
          if (line.doubles) { record('p.2b', b, who, bump(`p.2b|${b}`), mine, clubs); lead('2b', b, batting) }
          if (line.triples) { record('p.3b', b, who, bump(`p.3b|${b}`), mine, clubs); lead('3b', b, batting) }
          if (line.h) lead('h', b, batting)
          if (line.tb) record('p.tb', b, who, bump(`p.tb|${b}`, line.tb), mine, clubs)
          if (line.bb) { record('p.bb', b, who, bump(`p.bb|${b}`), mine, clubs); lead('bb', b, batting) }
          if (line.so) record('p.so', b, who, bump(`p.so|${b}`), mine, clubs)
          if (line.hbp) record('p.hbp', b, who, bump(`p.hbp|${b}`), mine, clubs)
          if (!post && (line.h || line.bb || line.hbp) && !firstOn.has(b)) {
            firstOn.add(b)
            const n = (streakNow.get(`ob|${b}`) ?? 0) + 1
            streakNow.set(`ob|${b}`, n)
            streak('ob', b, who, n, mine, clubs)
          }
        }
        if (k) {
          const who = name(k), mine = [k], clubs = fielding ? [fielding] : []
          if (line.so) { record('k.so', k, who, bump(`k.so|${k}`), mine, clubs); lead('k', k, fielding) }
          if (line.pitches) record('k.pitches', k, who, bump(`k.pitches|${k}`, line.pitches), mine, clubs)
          if ((line.retired ?? 0) > 0) streak('retired', k, who, line.retired, mine, clubs)
          if ((line.krow ?? 0) > 0) streak('krow', k, who, line.krow, mine, clubs)
          if ((line.retired ?? 0) > 0) { const l = streakDone.get('retired') ?? []; l.push({ v: line.retired, place: at(p.sequence), who }); streakDone.set('retired', l) }
          if ((line.krow ?? 0) > 0) { const l = streakDone.get('krow') ?? []; l.push({ v: line.krow, place: at(p.sequence), who }); streakDone.set('krow', l) }
        }
        if (batting) {
          if (line.h) { record('c.h', batting, club(batting), bump(`c.h|${batting}`), [], [batting]); half.h++ }
          if (line.hr) { record('c.hr', batting, club(batting), bump(`c.hr|${batting}`), [], [batting]); half.hr++ }
          if (line.bb) { record('c.bb', batting, club(batting), bump(`c.bb|${batting}`), [], [batting]); half.bb++ }
        }
        if (fielding) {
          if (line.h) hitsAllowed.set(fielding, (hitsAllowed.get(fielding) ?? 0) + 1)
          const own = (p.narrative ?? '').split(';')[0]
          if (line.h || line.bb || line.hbp || line.event === 'FC' || /\breached\b/i.test(own)) {
            reachedAgainst.set(fielding, (reachedAgainst.get(fielding) ?? 0) + 1)
          }
          if (line.so) record('f.so', fielding, club(fielding), bump(`f.so|${fielding}`), [], [fielding])
        }
        if (b && line.pitches) record('pa.pitches', `${p.sequence}`, name(b), line.pitches, b ? [b] : [], batting ? [batting] : [])
        if (b && line.fouls) record('pa.fouls', `${p.sequence}`, name(b), line.fouls, b ? [b] : [], batting ? [batting] : [])
        keep('pa.pitches', line.pitches, name(b), at(p.sequence))
        keep('pa.fouls', line.fouls, name(b), at(p.sequence))
      }

      // Facts off any row: the runners' plays, and the defense's.
      for (const def of FIRST_KINDS) {
        if (def.source !== 'play' || !def.test(p)) continue
        let owner: string | null = null
        let team = fielding
        if (def.by === 'pitcher') owner = p.pitcher_id
        else if (def.by === 'runner') {
          owner = runners(p).find(r => def.clause!.test(r.clause))?.id ?? null
          team = batting
        } else if (def.kind === 'pb' && fielding) owner = src.fielderAt?.(g.id, fielding, 'c', p.sequence) ?? null
        // A pickoff belongs to whoever threw it: a catcher's snap throw is not the pitcher's.
        if (def.kind === 'pk' && fielding) {
          const from = reading.chains.find(c => c.how === 'pk')?.chain[0]
          if (from && from !== 'p') owner = src.fielderAt?.(g.id, fielding, from, p.sequence) ?? null
        }
        count({ kind: def.kind, noun: nounOf(def.label), common: COMMON.has(def.kind), owner, club: team, pitcher: null })
        if (def.kind === 'sb' && owner) {
          record('p.sb', owner, name(owner), bump(`p.sb|${owner}`), [owner], batting ? [batting] : [])
          lead('sb', owner, batting)
          if (batting) record('c.sb', batting, club(batting), bump(`c.sb|${batting}`), [], [batting])
        }
      }
      if (fielding) {
        const placed = (pos: NotePos) => (pos === 'p' ? p.pitcher_id : src.fielderAt?.(g.id, fielding, pos, p.sequence) ?? null)
        for (const c of reading.chains) {
          const ds = digits(c.chain)
          const crew = c.chain.map(placed)
          const whole = crew.every(Boolean) ? (crew as string[]) : undefined
          if (c.what === 'dp' || c.what === 'tp') {
            const word = c.what === 'dp' ? 'double play' : 'triple play'
            if (c.chain.length >= 2 || c.what === 'tp') {
              count({ kind: `${c.what}:${ds}`, noun: `${ds} ${word}`, common: false, variant: true, owner: null, club: fielding, pitcher: null, crew: whole })
            }
            continue
          }
          if (c.how === 'cs' && c.chain[0] === 'c') {
            const catcher = crew[0]
            count({ kind: `cs:${ds}`, noun: `${ds} caught stealing`, common: false, variant: true, owner: null, club: fielding, pitcher: null, crew: whole })
            if (catcher) count({ kind: 'cs-c', noun: 'runner caught stealing', common: true, owner: catcher, club: fielding, pitcher: null, playerOnly: true })
            continue
          }
          if (c.how === 'pk') {
            count({ kind: `pk:${ds}`, noun: `${ds} pickoff`, common: false, variant: true, owner: null, club: fielding, pitcher: null, crew: whole })
            continue
          }
          if (OUTFIELD.has(c.chain[0]) && c.chain.length >= 2 && c.base) {
            const thrower = crew[0]
            count({ kind: `ofa:${c.base}:${ds}`, noun: `${ds} outfield assist at ${c.base}`, common: false, variant: true, owner: null, club: fielding, pitcher: null, crew: whole })
            if (thrower) count({ kind: 'ofa', noun: 'outfield assist', common: true, owner: thrower, club: fielding, pitcher: null })
          }
        }
        for (const pos of reading.errors) {
          const who = placed(pos)
          count({ kind: 'error', noun: 'error', common: true, owner: who, club: fielding, pitcher: null })
          count({ kind: `error:${pos}`, noun: `error at ${pos === 'p' ? 'pitcher' : pos === 'c' ? 'catcher' : pos.toUpperCase()}`, common: false, variant: true, owner: null, club: fielding, pitcher: null, leagueOnly: true })
        }
      }
    }

    // ── The final ──
    if (g.status === 'final') {
      row = rows[rows.length - 1]
      closeHalf()
      const lastSeq = row.sequence
      const away = g.away_score ?? score.away
      const home = g.home_score ?? score.home
      const winner = home > away ? g.home_team_id : away > home ? g.away_team_id : null
      const loser = winner == null ? null : other(winner)
      const both = [g.away_team_id, g.home_team_id]
      const title = `${club(g.away_team_id)} at ${club(g.home_team_id)}`
      if (winner && loser) {
        const hi = Math.max(away, home), lo = Math.min(away, home)
        count({ kind: `score:${hi}-${lo}`, noun: `${hi}–${lo} final`, common: false, variant: true, owner: null, club: null, pitcher: null, leagueOnly: true }, lastSeq)
        record('g.margin', g.id, `${club(winner)} over ${club(loser)}`, hi - lo, [], both, lastSeq)
        record('g.total', g.id, title, hi + lo, [], both, lastSeq)
        const down = winner === g.home_team_id ? deficit.home : deficit.away
        if (down > 0) record('g.comeback', g.id, `${club(winner)} came back from ${down} down`, down, [], [winner], lastSeq)
        const won = winner === g.home_team_id
        count({ kind: post ? 'postwin' : 'win', noun: post ? 'postseason win' : 'win', common: false, owner: null, club: winner, pitcher: null, clubOnly: true }, lastSeq)
        for (const [team, result] of post ? [] : [[winner, 'win'], [loser, 'loss']] as const) {
          const n = (streakNow.get(`${result}|${team}`) ?? 0) + 1
          endStreak(result === 'win' ? 'loss' : 'win', team, club(team), at(lastSeq), [], [team])
          streakNow.set(`${result}|${team}`, n)
          streak(result, team, club(team), n, [], [team], lastSeq)
        }
        const loserScore = won ? away : home
        const staff = [...(pitchersFor.get(winner) ?? [])]
        if (loserScore === 0) {
          count({ kind: 'shutout', noun: 'shutout', common: false, owner: null, club: winner, pitcher: null }, lastSeq)
          if (staff.length === 1) count({ kind: 'cg-shutout', noun: 'complete-game shutout', common: false, owner: staff[0], club: winner, pitcher: null }, lastSeq)
        }
      }
      for (const team of both) {
        const staff = [...(pitchersFor.get(team) ?? [])]
        if (staff.length === 1) count({ kind: 'cg', noun: 'complete game', common: false, owner: staff[0], club: team, pitcher: null }, lastSeq)
        if ((hitsAllowed.get(team) ?? 0) === 0) {
          const perfect = (reachedAgainst.get(team) ?? 0) === 0
          count({ kind: 'no-hitter', noun: 'no-hitter', common: false, owner: staff.length === 1 ? staff[0] : null, club: team, pitcher: null }, lastSeq)
          if (perfect) count({ kind: 'perfect-game', noun: 'perfect game', common: false, owner: staff.length === 1 ? staff[0] : null, club: team, pitcher: null }, lastSeq)
        }
      }
      // Streaks that did not survive the game.
      for (const [b, info] of post ? [] : batted) {
        const where = at(lastRowBy.get(b) ?? lastSeq)
        if (!firstHr.has(b)) endStreak('hr', b, name(b), where, [b], info.team ? [info.team] : [])
        if (!firstHit.has(b)) endStreak('hit', b, name(b), where, [b], info.team ? [info.team] : [])
        if (!firstOn.has(b)) endStreak('ob', b, name(b), where, [b], info.team ? [info.team] : [])
      }
      // What this game leaves for the next one.
      for (const [k, v] of tally) {
        const [stat, subject] = k.split('|')
        if (!RECORDS[stat] || RECORDS[stat].unit !== 'game') continue
        const who = stat.startsWith('p.') || stat.startsWith('k.') ? name(subject) : club(subject)
        keep(stat, v, who, at(lastSeq))
      }
      const innings = rows[rows.length - 1].inning
      keep('g.innings', innings, title, at(lastSeq))
      if (winner && loser) {
        keep('g.margin', Math.abs(home - away), `${club(winner)} over ${club(loser)}`, at(lastSeq))
        keep('g.total', home + away, title, at(lastSeq))
        const down = winner === g.home_team_id ? deficit.home : deficit.away
        if (down > 0) keep('g.comeback', down, `${club(winner)} came back from ${down} down`, at(lastSeq))
        for (const e of inningEnds) {
          const diff = e.home - e.away
          if (diff === 0) continue
          const trailing = diff > 0 ? g.away_team_id : g.home_team_id
          const k = `${e.inning}|${Math.abs(diff)}`
          const c = comebacks.get(k) ?? { w: 0, l: 0, games: [] }
          if (trailing === winner) c.w++
          else c.l++
          c.games.push(at(null))
          comebacks.set(k, c)
        }
      }
      for (const l of rows.map(r => lineAt.get(`${r.game_id}|${r.sequence}`)).filter((x): x is PlateAppearanceLine => !!x)) {
        if (!l.batter_id || !l.pitcher_id) continue
        const key = `${l.batter_id}|${l.pitcher_id}`
        const m = matchups.get(key) ?? { pa: 0, ab: 0, h: 0, hr: 0, bb: 0, so: 0 }
        m.pa++
        m.ab += l.bb || l.hbp || (l.sf ?? 0) || (l.sh ?? 0) ? 0 : 1
        m.h += l.h; m.hr += l.hr; m.bb += l.bb; m.so += l.so
        matchups.set(key, m)
      }
      if (post) gamesIn.post++
      else {
        gamesIn.reg++
        if (season != null) gamesIn.season.set(season, (gamesIn.season.get(season) ?? 0) + 1)
      }
    }

    select(notes, bar, cap)
  }
  return out
}

/** Kinds a reader would call one moment: a shutout that is also a complete game is one note, not
 *  three. The more specific kind is listed first and wins a tie. */
const FAMILY: Record<string, string> = {
  'perfect-game': 'no-hit', 'no-hitter': 'no-hit',
  'cg-shutout': 'cg', shutout: 'cg', cg: 'cg',
  slam: 'hr', phhr: 'hr', leadoffhr: 'hr', hr: 'hr',
  bunthit: 'hit', phit: 'hit', ifh: 'hit', single: 'hit', hit: 'hit',
}
const SPECIFIC = Object.keys(FAMILY)
const specific = (kind: string) => { const i = SPECIFIC.indexOf(kind); return i < 0 ? SPECIFIC.length : i }

/** Marks the notes a later one in their group replaced, then the few readers see. */
function select(notes: LiveNote[], bar: number, cap: number) {
  const latest = new Map<string, LiveNote>()
  for (const n of notes) {
    const prev = latest.get(n.group)
    if (prev) prev.superseded = true
    latest.set(n.group, n)
  }
  // One public note per thing a reader would call one moment: the widest lens of a play's fact.
  const shown = new Set<string>()
  const ranked = notes.filter(n => !n.superseded && n.score >= bar)
    .sort((a, b) => b.score - a.score || specific(a.kind) - specific(b.kind) || (a.sequence ?? -1) - (b.sequence ?? -1))
  let left = cap
  for (const n of ranked) {
    if (left <= 0) break
    const kind = n.kind.split(':')[0]
    // A family's notes name different owners (a shutout the club, a complete game its pitcher), so
    // the moment is the club's.
    const moment = FAMILY[kind]
      ? `${n.sequence}|${FAMILY[kind]}|${n.clubs[0] ?? n.players[0] ?? ''}`
      : `${n.sequence}|${kind}|${n.players[0] ?? n.clubs[0] ?? ''}`
    if (shown.has(moment)) continue
    shown.add(moment)
    n.public = true
    left--
  }
}
