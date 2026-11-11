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
  pa({ kind: 'hr', label: 'First home run', by: 'batter', listed: true, test: l => l.hr > 0, words: /^(?:home\s*runs?|homers?|hr|homeruns?|dingers?)$/ }),
  pa({ kind: 'slam', label: 'First grand slam', by: 'batter', listed: true, test: l => l.hr > 0 && l.on === 3, words: /^(?:grand\s*slams?|slams?)$/ }),
  pa({ kind: 'hit', label: 'First hit', by: 'batter', listed: true, test: l => l.h > 0, words: /^(?:hits?|base\s*hits?)$/ }),
  pa({ kind: 'double', label: 'First double', by: 'batter', listed: true, test: l => l.doubles > 0, words: /^(?:doubles?|2b)$/ }),
  pa({ kind: 'triple', label: 'First triple', by: 'batter', listed: true, test: l => l.triples > 0, words: /^(?:triples?|3b)$/ }),
  pa({ kind: 'walk', label: 'First walk', by: 'batter', listed: true, test: l => l.bb > 0, words: /^(?:walks?|bb|base\s+on\s+balls)$/ }),
  pa({ kind: 'so', label: 'First strikeout', by: 'pitcher', listed: true, test: l => l.so > 0, words: /^(?:strikeouts?|strike\s+outs?|k|so)$/ }),
  pa({ kind: 'hbp', label: 'First hit by pitch', by: 'batter', listed: true, test: l => l.hbp > 0, words: /^(?:hit\s+by\s+(?:a\s+)?pitch|hbp)$/ }),
  pa({ kind: 'walkoff', label: 'First walk-off', by: 'batter', listed: true, test: l => l.walkoff > 0, words: /^(?:walk[\s-]*offs?(?:\s+hits?)?)$/ }),
  pa({ kind: 'single', label: 'First single', by: 'batter', test: l => l.h > 0 && !l.doubles && !l.triples && !l.hr, words: /^(?:singles?|1b)$/ }),
  pa({ kind: 'sf', label: 'First sacrifice fly', by: 'batter', test: l => (l.sf ?? 0) > 0, words: /^(?:sac(?:rifice)?\s+fly|sac(?:rifice)?\s+flies|sf)$/ }),
  pa({ kind: 'sh', label: 'First sacrifice bunt', by: 'batter', test: l => (l.sh ?? 0) > 0, words: /^(?:sac(?:rifice)?\s+bunts?|sacrifice\s+hits?|sac|sh)$/ }),
  pa({ kind: 'bunthit', label: 'First bunt hit', by: 'batter', test: l => (l.bunt ?? 0) > 0 && l.h > 0, words: /^(?:bunt\s+(?:hit|single)s?)$/ }),
  pa({ kind: 'ifh', label: 'First infield hit', by: 'batter', test: l => (l.ifh ?? 0) > 0, words: /^(?:infield\s+(?:hit|single)s?)$/ }),
  pa({ kind: 'phhr', label: 'First pinch-hit home run', by: 'batter', test: l => (l.ph ?? 0) > 0 && l.hr > 0, words: /^(?:pinch[\s-]*hit\s+(?:home\s*runs?|homers?|hr))$/ }),
  pa({ kind: 'phit', label: 'First pinch hit', by: 'batter', test: l => (l.ph ?? 0) > 0 && l.h > 0, words: /^(?:pinch[\s-]*hits?)$/ }),
  pa({ kind: 'leadoffhr', label: 'First leadoff home run', by: 'batter', test: l => (l.leadoff ?? 0) > 0 && l.hr > 0, words: /^(?:lead[\s-]*off\s+(?:home\s*runs?|homers?|hr))$/ }),
  row({ kind: 'sb', label: 'First stolen base', by: 'runner', listed: true, clause: /\bstole\b/, test: p => runnerEvents(p).sb > 0, words: /^(?:stolen\s+bases?|steals?|sb)$/ }),
  row({ kind: 'sbh', label: 'First steal of home', by: 'runner', clause: /\bstole home\b/, test: p => runnerEvents(p).sbh > 0, words: /^(?:steals?\s+of\s+home|stolen\s+base\s+of\s+home)$/ }),
  row({ kind: 'cs', label: 'First caught stealing', by: 'runner', listed: true, clause: /caught stealing/, test: p => runnerEvents(p).cs > 0, words: /^(?:caught\s+stealing|cs)$/ }),
  row({ kind: 'pk', label: 'First pickoff', by: 'pitcher', listed: true, test: p => runnerEvents(p).pk > 0, words: /^(?:pick[\s-]*offs?)$/ }),
  row({ kind: 'wp', label: 'First wild pitch', by: 'pitcher', listed: true, test: p => runnerEvents(p).wp > 0, words: /^(?:wild\s+pitch(?:es)?|wp)$/ }),
  row({ kind: 'pb', label: 'First passed ball', by: 'field', test: p => runnerEvents(p).pb > 0, words: /^(?:passed\s+balls?|pb)$/ }),
  row({ kind: 'bk', label: 'First balk', by: 'pitcher', listed: true, test: p => runnerEvents(p).bk > 0, words: /^(?:balks?|bk)$/ }),
  row({ kind: 'dp', label: 'First double play', by: 'field', listed: true, test: says(/double play/), words: /^(?:double\s+plays?|dp|gidp)$/ }),
  row({ kind: 'tp', label: 'First triple play', by: 'field', test: says(/triple play/), words: /^(?:triple\s+plays?|tp)$/ }),
]

const KIND_BY_ID = new Map(FIRST_KINDS.map(k => [k.kind, k]))
export const firstKind = (kind: FirstKind): KindDef => KIND_BY_ID.get(kind)!

/** What a typed first asks: which kinds, and in which season (null: the league's first ever). */
export interface FirstQuestion { kinds: FirstKind[]; season: number | null }

const LEAD = /^\s*(?:(?:who|what)\s+(?:hit|had|got|threw|recorded|was|turned|stole|committed)\s+)?(?:the\s+)?(?:(?:wpbl|league)(?:'s)?\s+)?(?:very\s+)?first\s+(?:ever\s+)?/i
const TAIL = /\s+(?:ever|in\s+(?:the\s+)?(?:wpbl|league)(?:\s+history)?|in\s+history|of\s+all\s+time)\s*$/i
const SEASON_TAIL = /\s+(?:(?:of|in)\s+(?:the\s+)?)?(20\d\d)(?:\s+season)?\s*$/i
const ALL_FIRSTS = /^\s*(?:(?:the\s+)?(?:wpbl|league)(?:'s)?\s+)?(?:hall\s+of\s+)?firsts(?:\s+(?:of|in)\s+(20\d\d))?\s*\??\s*$/i

/**
 * "first home run", "the first grand slam in wpbl history", "first hr of 2026", "firsts". Null when
 * the text is not a first. "First inning" is not one: it names an inning, which the Find parser reads.
 */
export function parseFirstText(text: string): FirstQuestion | null {
  const all = text.match(ALL_FIRSTS)
  if (all) return { kinds: FIRST_KINDS.filter(k => k.listed).map(k => k.kind), season: all[1] ? Number(all[1]) : null }
  const lead = text.match(LEAD)
  if (!lead) return null
  let rest = text.slice(lead[0].length).replace(/\?\s*$/, '').trim().toLowerCase()
  let season: number | null = null
  const s = rest.match(SEASON_TAIL)
  if (s) { season = Number(s[1]); rest = rest.slice(0, s.index).trim() }
  rest = rest.replace(TAIL, '').replace(/^(?:a|an)\s+/, '').trim()
  const def = FIRST_KINDS.find(k => k.words.test(rest))
  return def ? { kinds: [def.kind], season } : null
}

/** One first: the play it happened on, and whose it was. */
export interface FirstFound {
  kind: FirstKind
  game_id: string
  /** The row Game Center opens at (`#play-N`). */
  sequence: number
  /** The plate appearance, for a first read off one. */
  line?: PlateAppearanceLine
  /** The batter, the pitcher (a strikeout, a balk), the runner; null where only the club is known. */
  playerId: string | null
  /** The club they played for that day, off the play, never the roster. */
  teamId: string | null
}

/**
 * The first play of each kind asked, in the order the games were played. `when` sorts the games
 * (date, then first pitch, so the second game of a doubleheader comes second); a game it cannot place
 * goes last. Lines from unfinished games count: a first is a first the moment it happens. `plays` is
 * the log the lines were built from; without it the runners' kinds find nothing.
 */
export function findFirsts<G extends LeagueGame>(lines: readonly PlateAppearanceLine[], games: readonly G[], kinds: readonly FirstKind[],
  when: (g: G) => string, plays: readonly RunValuePlay[] = []): FirstFound[] {
  const rank = new Map([...games].sort((a, b) => (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : a.id < b.id ? -1 : 1))
    .map((g, i) => [g.id, i]))
  const gameById = new Map(games.map(g => [g.id, g]))
  const inOrder = <T extends { game_id: string; sequence: number }>(xs: readonly T[]) => xs.filter(x => rank.has(x.game_id))
    .sort((a, b) => rank.get(a.game_id)! - rank.get(b.game_id)! || a.sequence - b.sequence)
  const ordered = inOrder(lines)
  const rows = inOrder(plays)
  let runners: ReturnType<typeof runnerResolver> | null = null
  const out: FirstFound[] = []
  for (const kind of kinds) {
    const def = firstKind(kind)
    if (def.source === 'pa') {
      const line = ordered.find(def.test)
      if (!line) continue
      out.push({
        kind, game_id: line.game_id, sequence: line.sequence, line,
        playerId: def.by === 'pitcher' ? line.pitcher_id : line.batter_id,
        teamId: def.by === 'pitcher' ? line.fielding_team : line.batting_team,
      })
      continue
    }
    const p = rows.find(def.test)
    if (!p) continue
    // A play names only the batting club; the club in the field is the game's other one.
    const g = gameById.get(p.game_id)!
    const fielding = p.team_id == null ? null : p.team_id === g.home_team_id ? g.away_team_id : g.home_team_id
    let playerId: string | null = null
    let teamId = fielding
    if (def.by === 'pitcher') playerId = p.pitcher_id
    else if (def.by === 'runner') {
      runners ??= runnerResolver([...plays])
      playerId = runners(p).find(r => def.clause!.test(r.clause))?.id ?? null
      teamId = p.team_id
    }
    out.push({ kind, game_id: p.game_id, sequence: p.sequence, playerId, teamId })
  }
  return out
}
