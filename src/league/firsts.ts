import type { PlateAppearanceLine } from './inningLines'
import type { LeagueGame } from './types'

/**
 * The league's firsts, asked for in the search box: "first home run", "first grand slam of 2026",
 * "firsts".
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
 * ONLY WHAT THE LOG STATES. A win, a save and a complete game are box-score facts with no single play
 * to open, and a stolen base is not a plate appearance, so none of them is a first here.
 */

export type FirstKind = 'hit' | 'hr' | 'slam' | 'double' | 'triple' | 'walk' | 'so' | 'hbp' | 'walkoff'

interface KindDef {
  kind: FirstKind
  label: string
  /** Who the first belongs to: the batter, or the pitcher for a strikeout. */
  by: 'batter' | 'pitcher'
  test: (l: PlateAppearanceLine) => boolean
  /** What a reader types for it after "first", most specific first within a kind. */
  words: RegExp
}

export const FIRST_KINDS: readonly KindDef[] = [
  { kind: 'hr', label: 'First home run', by: 'batter', test: l => l.hr > 0, words: /^(?:home\s*runs?|homers?|hr|homeruns?|dingers?)$/ },
  { kind: 'slam', label: 'First grand slam', by: 'batter', test: l => l.hr > 0 && l.on === 3, words: /^(?:grand\s*slams?|slams?)$/ },
  { kind: 'hit', label: 'First hit', by: 'batter', test: l => l.h > 0, words: /^(?:hits?|base\s*hits?)$/ },
  { kind: 'double', label: 'First double', by: 'batter', test: l => l.doubles > 0, words: /^(?:doubles?|2b)$/ },
  { kind: 'triple', label: 'First triple', by: 'batter', test: l => l.triples > 0, words: /^(?:triples?|3b)$/ },
  { kind: 'walk', label: 'First walk', by: 'batter', test: l => l.bb > 0, words: /^(?:walks?|bb|base\s+on\s+balls)$/ },
  { kind: 'so', label: 'First strikeout', by: 'pitcher', test: l => l.so > 0, words: /^(?:strikeouts?|strike\s+outs?|k|so)$/ },
  { kind: 'hbp', label: 'First hit by pitch', by: 'batter', test: l => l.hbp > 0, words: /^(?:hit\s+by\s+(?:a\s+)?pitch|hbp)$/ },
  { kind: 'walkoff', label: 'First walk-off', by: 'batter', test: l => l.walkoff > 0, words: /^(?:walk[\s-]*offs?(?:\s+hits?)?)$/ },
]

const KIND_BY_ID = new Map(FIRST_KINDS.map(k => [k.kind, k]))
export const firstKind = (kind: FirstKind): KindDef => KIND_BY_ID.get(kind)!

/** What a typed first asks: which kinds, and in which season (null: the league's first ever). */
export interface FirstQuestion { kinds: FirstKind[]; season: number | null }

const LEAD = /^\s*(?:(?:who|what)\s+(?:hit|had|got|threw|recorded|was)\s+)?(?:the\s+)?(?:(?:wpbl|league)(?:'s)?\s+)?(?:very\s+)?first\s+(?:ever\s+)?/i
const TAIL = /\s+(?:ever|in\s+(?:the\s+)?(?:wpbl|league)(?:\s+history)?|in\s+history|of\s+all\s+time)\s*$/i
const SEASON_TAIL = /\s+(?:(?:of|in)\s+(?:the\s+)?)?(20\d\d)(?:\s+season)?\s*$/i
const ALL_FIRSTS = /^\s*(?:(?:the\s+)?(?:wpbl|league)(?:'s)?\s+)?(?:hall\s+of\s+)?firsts(?:\s+(?:of|in)\s+(20\d\d))?\s*\??\s*$/i

/**
 * "first home run", "the first grand slam in wpbl history", "first hr of 2026", "firsts". Null when
 * the text is not a first. "First inning" is not one: it names an inning, which the Find parser reads.
 */
export function parseFirstText(text: string): FirstQuestion | null {
  const all = text.match(ALL_FIRSTS)
  if (all) return { kinds: FIRST_KINDS.map(k => k.kind), season: all[1] ? Number(all[1]) : null }
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

/** One first: the plate appearance it happened on, and whose it was. */
export interface FirstFound {
  kind: FirstKind
  line: PlateAppearanceLine
  /** The batter, or the pitcher for a strikeout. */
  playerId: string | null
  /** The club they played for that day, off the play, never the roster. */
  teamId: string | null
}

/**
 * The first plate appearance of each kind asked, in the order the games were played. `when` sorts
 * the games (date, then first pitch, so the second game of a doubleheader comes second); a game it
 * cannot place goes last. Lines from unfinished games count: a first is a first the moment it
 * happens.
 */
export function findFirsts<G extends LeagueGame>(lines: readonly PlateAppearanceLine[], games: readonly G[], kinds: readonly FirstKind[],
  when: (g: G) => string): FirstFound[] {
  const rank = new Map([...games].sort((a, b) => (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : a.id < b.id ? -1 : 1))
    .map((g, i) => [g.id, i]))
  const ordered = lines.filter(l => rank.has(l.game_id))
    .sort((a, b) => rank.get(a.game_id)! - rank.get(b.game_id)! || a.sequence - b.sequence)
  const out: FirstFound[] = []
  for (const kind of kinds) {
    const def = firstKind(kind)
    const line = ordered.find(def.test)
    if (!line) continue
    out.push({
      kind, line,
      playerId: def.by === 'pitcher' ? line.pitcher_id : line.batter_id,
      teamId: def.by === 'pitcher' ? line.fielding_team : line.batting_team,
    })
  }
  return out
}
