import { PA_SEASON_KEYS, type FinderBoardSide, type FinderCondition, type FinderPer, type FinderVenue } from './finder'
import { isQuestionWord, parseClubScope, parseFinderText, parseLeaderText, parseRecordQuestion, takeBareStat, type FinderClubAlias } from './finderParse'
import { foldName } from '../lib/fuzzyName'

/**
 * A Find question that names players: "Sato vs hunters", "Whitmore off Schroder", "Whitmore 2-hit
 * games", "Sato strikeouts in an inning".
 *
 * WHY A SEPARATE READER. The Find parser (finderParse.ts) knows the grammar of a question and nothing
 * about either section's roster, which is what keeps it pure and shared. A name is the opposite: it
 * means something only against one league's players, and whether "Sato vs Whitmore" is a batter
 * against a pitcher depends on who hits and who pitches. So the names are found here, against the
 * roster the section hands in, taken out of the text, and what is left goes to the Find parser
 * unchanged, so the rest of the question means exactly what it means without a name in it.
 *
 * THREE SHAPES. Two players, a batter and a pitcher: their plate appearances (the matchup). One player
 * and a stat question: that question asked of their lines. One player and only a club or a place:
 * their games against that club, or at home, and their season against it.
 *
 * A NAME IS MATCHED WHOLE OR BY ITS SURNAME, never by a first name alone, which is far more often
 * shared, and never where the surname is itself a word questions are made of ("Home", a stat, a
 * club's name): only the full name finds that player.
 */

export interface RosterPlayer {
  id: string
  name: string
  /** Has come to the plate, so can be a batter or a hitter's subject. */
  hits: boolean
  /** Has pitched, so can be a pitcher or a pitcher's subject. */
  pitches: boolean
  /** The side a two-way player plays most (more plate appearances than batters faced, or fewer),
   *  which goes first. Absent reads as hitting. */
  lean?: 'hitting' | 'pitching'
}

export interface PlayerQuestion {
  /** A batter against a pitcher, one player's stat question, one player against a club, or every
   *  batter's season against one pitcher (`pitcherId`). */
  kind: 'matchup' | 'player' | 'club' | 'against'
  /** Against one pitcher with a stat and no number ("hr off Whitmore"): the batters ranked by it. */
  rank?: { field: string; rate: boolean }
  side: FinderBoardSide
  per: FinderPer
  conditions: FinderCondition[]
  teamId: string | null
  oppId: string | null
  venue: FinderVenue
  season: number | null
  /** One player, at a game, a season or a pitcher's inning. */
  playerId: string | null
  /** The matchup's two, at a plate appearance; one of them alone when one player is asked there. */
  batterId: string | null
  pitcherId: string | null
  /** The player's most of one stat at a grain ("most hr in a game by Whitmore"): the condition is
   *  at least one, and Find's order is the answer. */
  record?: boolean
  /** A span, the last N games or the other player's arm (`FinderQuery`), when said. */
  from?: string | null
  to?: string | null
  last?: number | null
  hand?: 'L' | 'R' | null
}

const cutsOf = (c: { from?: string | null; to?: string | null; last?: number | null; hand?: 'L' | 'R' | null }) =>
  ({ from: c.from ?? null, to: c.to ?? null, last: c.last ?? null, hand: c.hand ?? null })

const CONNECTORS = new Set(['vs', 'vs.', 'versus', 'v', 'v.', 'against', 'off', 'facing', 'faced', 'and', 'or', '&'])
// The words that make the one player named the pitcher being faced: "3 hits off Whitmore".
const AGAINST = new Set(['vs', 'vs.', 'versus', 'v', 'v.', 'against', 'off', 'facing', 'faced'])
const RATES = new Set(['avg', 'obp', 'slg', 'ops'])
const MAX_READINGS = 4

interface Span { from: number; to: number; ids: string[]; whole: boolean }

/** Every name in the words, as spans of word positions, longest first, at most two that do not overlap. */
function findNames(words: string[], raw: string[], roster: readonly RosterPlayer[], clubWords: ReadonlySet<string>): Span[] {
  const found: Span[] = []
  for (const p of roster) {
    const parts = foldName(p.name).split(' ').filter(Boolean)
    if (!parts.length) continue
    const surname = parts[parts.length - 1]
    // "Whitmore's": the possessive goes, but only where it was typed with its apostrophe, or "Hunters"
    // would find a player called Hunter.
    const word = (i: number) => (/['’]s$/i.test(raw[i]) ? words[i].replace(/s$/, '') : words[i])
    for (let i = 0; i < words.length; i++) {
      if (parts.length > 1 && parts.every((w, j) => (j === parts.length - 1 ? word(i + j) : words[i + j]) === w)) {
        found.push({ from: i, to: i + parts.length, ids: [p.id], whole: true })
      } else if (word(i) === surname && surname.length >= 3 && !clubWords.has(surname) && !isQuestionWord(surname)) {
        found.push({ from: i, to: i + 1, ids: [p.id], whole: false })
      }
    }
  }
  // The same words naming several players (two Satos) are one span with each of them; a whole name
  // beats a surname that is part of it.
  const merged: Span[] = []
  for (const s of found) {
    const same = merged.find(m => m.from === s.from && m.to === s.to && m.whole === s.whole)
    if (same) { if (!same.ids.includes(s.ids[0])) same.ids.push(s.ids[0]) } else merged.push({ ...s, ids: [...s.ids] })
  }
  merged.sort((a, b) => (b.to - b.from) - (a.to - a.from) || Number(b.whole) - Number(a.whole) || a.from - b.from)
  const taken: Span[] = []
  for (const s of merged) {
    if (taken.length === 2) break
    if (taken.some(t => s.from < t.to && t.from < s.to)) continue
    taken.push(s)
  }
  return taken.sort((a, b) => a.from - b.from)
}

/**
 * Every reading of `text` as a Find question about named players, best first, or an empty list when
 * it names none, or names one with nothing asked about them (a plain name is the name search's).
 */
export function parsePlayerQuestion(
  text: string, roster: readonly RosterPlayer[], clubs: readonly FinderClubAlias[],
  sides: readonly FinderBoardSide[], opts: { plays?: boolean; regulationInnings?: number } = {},
): PlayerQuestion[] {
  const raw = text.trim().split(/\s+/).filter(Boolean)
  const words = raw.map(w => foldName(w))
  const clubWords = new Set(clubs.flatMap(c => c.names.flatMap(n => foldName(n).split(' '))))
  const spans = findNames(words, raw, roster, clubWords)
  if (!spans.length) return []
  const byId = new Map(roster.map(p => [p.id, p]))
  const inSpan = (i: number) => spans.some(s => i >= s.from && i < s.to)
  const out: PlayerQuestion[] = []
  const blank = { teamId: null, oppId: null, venue: 'any' as FinderVenue, season: null, playerId: null, batterId: null, pitcherId: null }

  if (spans.length === 2) {
    // THE MATCHUP. Whatever joins the two ("vs", "off", "facing") says nothing the roles do not, so it
    // goes; which is the batter is who hits and who pitches, the first named when both could be either.
    const rest = raw.filter((w, i) => !inSpan(i) && !CONNECTORS.has(w.toLowerCase())).join(' ')
    let asked: { side: FinderBoardSide; conditions: FinderCondition[]; teamId: string | null; oppId: string | null; venue: FinderVenue; season: number | null }[]
    if (!rest.trim()) asked = [{ side: 'hitting', conditions: [], teamId: null, oppId: null, venue: 'any', season: null }]
    else {
      const read = parseFinderText(`${rest} in a plate appearance`, clubs, sides, opts).filter(p => p.per === 'pa' && !p.ignored.length)
      const scope = read.length ? null : parseClubScope(rest, clubs)
      asked = read.length ? read.slice(0, 1)
        : scope ? [{ side: 'hitting', conditions: [], teamId: scope.teamIds[0], oppId: scope.oppIds[0], venue: scope.venue, season: scope.season }]
        : []
    }
    for (const a of spans[0].ids) {
      for (const b of spans[1].ids) {
        const A = byId.get(a)!, B = byId.get(b)!
        // Both ways round possible (two two-way players): the one leaning to the plate bats, and the
        // first named when neither tells them apart.
        const ab = A.hits && B.pitches, ba = A.pitches && B.hits
        const pair = ab && ba ? (A.lean === 'pitching' && B.lean !== 'pitching' ? [B, A] : [A, B])
          : ab ? [A, B] : ba ? [B, A] : null
        if (!pair || pair[0].id === pair[1].id) continue
        for (const q of asked) {
          out.push({ ...blank, ...q, kind: 'matchup', per: 'pa', batterId: pair[0].id, pitcherId: pair[1].id })
        }
      }
    }
    return out.slice(0, MAX_READINGS)
  }

  const rest = raw.filter((_w, i) => !inSpan(i)).join(' ')
  if (!rest.trim()) return []
  const ids = spans[0].ids

  // AGAINST ONE PITCHER: "3 hits off Whitmore", "hr off Whitmore", "avg against Schroder". The word
  // before the name makes the named player the one being faced, so the question is every batter's
  // season against them, summed from the plate appearances (`seasonFromPas`), which only a section
  // reading its plays can sum. Until Nov 10, 2026 "off Whitmore" was a word left over, and no row came.
  const lead = spans[0].from > 0 ? raw[spans[0].from - 1].toLowerCase() : ''
  const pitchers = ids.filter(id => byId.get(id)!.pitches)
  if (opts.plays && sides.includes('hitting') && AGAINST.has(lead) && pitchers.length) {
    const asked = raw.filter((_w, i) => !inSpan(i) && i !== spans[0].from - 1).join(' ')
    // A count: the batters with at least that many off them over the season.
    const counted = parseFinderText(`${asked} on the season`, clubs, ['hitting'], opts)
      .filter(p => p.per === 'season' && !p.bare && !p.ignored.length && p.conditions.length && p.conditions.every(c => PA_SEASON_KEYS.has(c.field)))
      .slice(0, 1)
    // A stat alone: who has the most off them. A rate brings its own small bar, five trips.
    const ranked = counted.length ? [] : parseLeaderText(asked)
      .filter(p => p.side === 'hitting' && PA_SEASON_KEYS.has(p.field) && p.dir !== 'asc' && !p.career)
      .slice(0, 1)
    for (const id of pitchers) {
      for (const r of counted) {
        out.push({ ...blank, kind: 'against', side: 'hitting', per: 'season', conditions: r.conditions,
          teamId: r.teamId, oppId: r.oppId, venue: r.venue, season: r.season, ...cutsOf(r), pitcherId: id })
      }
      for (const r of ranked) {
        const rate = RATES.has(r.field)
        out.push({ ...blank, kind: 'against', side: 'hitting', per: 'season', season: r.season, pitcherId: id,
          conditions: [{ field: r.field, op: 'gte', value: 1 }, ...(rate ? [{ field: 'pa', op: 'gte' as const, value: 5 }] : [])],
          rank: { field: r.field, rate } })
      }
    }
    if (out.length) return out.slice(0, MAX_READINGS)
  }

  // A side the player has lines on: a pitcher's strikeouts, a hitter's hits. Fielding is anyone who plays.
  const plays = (p: RosterPlayer, side: FinderBoardSide) => (side === 'pitching' ? p.pitches : side === 'hitting' ? p.hits : p.hits || p.pitches)

  // Not a stat said with no number ("Lee hr"): the name search's row answers that with the player's
  // total, and the record, against and line-vs-club readings below own the rest of its phrasings.
  const read = parseFinderText(rest, clubs, sides, opts).filter(p => !p.ignored.length && !p.bare && !(p.per === 'inning' && p.side === 'hitting'))
  if (read.length) {
    for (const id of ids) {
      const p = byId.get(id)!
      // The parser's own order, not the player's lean: the stat already says whose question it is
      // ("2-hit games" is a hitter's, even of a two-way player who pitches more).
      for (const r of read) {
        if (!plays(p, r.side)) continue
        const own = r.per === 'pa' ? (r.side === 'pitching' ? { pitcherId: id } : { batterId: id }) : { playerId: id }
        out.push({ ...blank, kind: 'player', side: r.side, per: r.per, conditions: r.conditions,
          teamId: r.teamId, oppId: r.oppId, venue: r.venue, season: r.season, ...cutsOf(r), ...own })
      }
    }
    return out.slice(0, MAX_READINGS)
  }

  // A RECORD OF THEIR OWN: "most hr in a game by Whitmore", "Sato's most strikeouts in an inning".
  // Their lines, ranked by the stat, so the first row is the answer.
  // WPBL's alone (see above), which reads its plays: the play-log counts are records too.
  const records = parseRecordQuestion(rest.replace(/(?<![a-z])by(?![a-z])/gi, ' '), clubs, { plays: true })
    .filter(r => sides.includes(r.side) && !(r.per === 'inning' && r.side === 'hitting') && (r.per !== 'inning' || opts.plays))
  if (records.length) {
    for (const id of ids) {
      const p = byId.get(id)!
      for (const r of records) {
        if (!plays(p, r.side)) continue
        out.push({ ...blank, kind: 'player', record: true, side: r.side, per: r.per,
          conditions: [{ field: r.field, op: 'gte', value: 1 }],
          teamId: r.teamId, oppId: r.oppId, venue: r.venue, season: r.season, playerId: id })
      }
    }
    return out.slice(0, MAX_READINGS)
  }

  // ONLY WHO AND WHERE: "Sato vs hunters", "Whitmore at home". The player's games there, and the
  // season there beside it, on each side the player has lines on, the side they play most first.
  // A stat said bare ("Sato ERA vs Queens") picks the side, and asks the season there first, since
  // that line is the one with the stat on it. Without this the stat was the leftover word that made it
  // no question at all.
  const bare = parseClubScope(rest, clubs) ? null : takeBareStat(rest)
  const scope = parseClubScope(bare ? bare.rest : rest, clubs)
  if (!scope) return []
  for (const id of ids) {
    const p = byId.get(id)!
    const own: FinderBoardSide[] = bare ? bare.sides.filter(s => plays(p, s))
      : p.pitches && !p.hits ? ['pitching'] : p.hits && !p.pitches ? ['hitting']
      : p.lean === 'pitching' ? ['pitching', 'hitting'] : ['hitting', 'pitching']
    for (const side of own.filter(s => sides.includes(s))) {
      // Against one arm, a hitter's season (summed from the plate appearances) and a pitcher's plate
      // appearances, which are the grains that know the arm (FinderQuery.hand).
      const pers: FinderPer[] = scope.hand ? (side === 'hitting' ? ['season'] : opts.plays ? ['pa'] : [])
        : scope.per ? [scope.per] : bare ? ['season', 'game']
        // One game ("Whitmore last game") is that game's line; a season of it is the same line again.
        : scope.last === 1 ? ['game'] : ['game', 'season']
      for (const per of pers) {
        for (const teamId of scope.teamIds) {
          for (const oppId of scope.oppIds) {
            if (teamId && teamId === oppId) continue
            const who = per === 'pa' ? (side === 'pitching' ? { pitcherId: id } : { batterId: id }) : { playerId: id }
            out.push({ ...blank, kind: 'club', side, per, conditions: [], teamId, oppId, venue: scope.venue, season: scope.season, ...cutsOf(scope), ...who })
          }
        }
      }
    }
  }
  return out.slice(0, MAX_READINGS)
}
