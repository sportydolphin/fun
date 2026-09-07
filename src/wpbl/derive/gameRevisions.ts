import { outsToIp } from '../innings'
import type { WpblGameRevision, WpblRevisionChange } from '../types'

// Turning a stored revision into sentences a reader can check against their own memory of the
// game. Its own module, and pure, because the values it formats are the ONLY copy of what the
// scoring used to be: scripts/check-wpbl-drift.mjs writes them the instant before a repair
// overwrites the mirror, and nothing anywhere can recompute them afterwards. Anything that
// rendered them by reaching back at the feed would be showing the current numbers twice.
//
// Everything below is display. Which changes exist, and whether they are the league's or ours,
// was decided at write time and is not revisited here.

/** One change, ready to render: who it is about, what moved, and the two values.
 *  `before`/`after` are already strings, '—' where there is no value, because half of these
 *  come from columns where 0 and "absent" mean different things. */
export interface WpblRevisionLine {
  /** The player, or the half-inning, or null for a change to the game itself. */
  who: string | null
  /** Our player id where we have one, so the name can open the player page. */
  playerId: string | null
  what: string
  before: string
  after: string
}

/** The glyph for "no value", which is the one dash this codebase allows. */
const NONE = '—'

const BATTING_LABELS: Record<string, string> = {
  ab: 'At-bats', r: 'Runs', h: 'Hits', doubles: 'Doubles', triples: 'Triples',
  hr: 'Home runs', rbi: 'RBI', bb: 'Walks', so: 'Strikeouts', hbp: 'Hit by pitch',
  sb: 'Stolen bases', cs: 'Caught stealing', sf: 'Sacrifice flies', sh: 'Sacrifice bunts',
  ibb: 'Intentional walks', gdp: 'Grounded into DP', lob: 'Left on base',
}

const PITCHING_LABELS: Record<string, string> = {
  outs: 'Innings pitched', h: 'Hits allowed', r: 'Runs allowed', er: 'Earned runs',
  bb: 'Walks', so: 'Strikeouts', hr: 'Home runs allowed', hbp: 'Hit batters',
  ibb: 'Intentional walks', wp: 'Wild pitches', bk: 'Balks', decision: 'Decision',
}

const PLAY_LABELS: Record<string, string> = {
  outs: 'Outs',
  narrative: 'Description',
  event_type: 'Play type',
  is_hit: 'Counted as a hit',
  // NOT the batter, and the label has to say so or this reads as a wrong number. The feed's
  // `runs_scored` counts the runners who crossed, so a solo home run stores 0 and a grand slam
  // 3. Every reader of that column so far has been caught by it, a validator and two badges
  // included, which is why it is spelled out here rather than labelled "Runs".
  runs_scored: 'Runners scoring (not the batter)',
}

const DECISIONS: Record<string, string> = { W: 'Win', L: 'Loss', S: 'Save', H: 'Hold' }

/** A stored value as text. Booleans read as words, an empty decision as no value. */
function show(v: WpblRevisionChange['before'], field: string | undefined, kind: string): string {
  if (v == null || v === '') return NONE
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (kind === 'pitching' && field === 'outs') return outsToIp(Number(v))
  if (kind === 'pitching' && field === 'decision') return DECISIONS[String(v)] ?? String(v)
  return String(v)
}

/** "Top 6th". Ordinals rather than "inning 6", because that is how a play is referred to
 *  everywhere else on the page. */
function halfInning(change: WpblRevisionChange): string {
  const nth = (i: number) => {
    const rem = i % 100
    if (rem >= 11 && rem <= 13) return `${i}th`
    return `${i}${['th', 'st', 'nd', 'rd'][i % 10] ?? 'th'}`
  }
  const side = change.half === 'bottom' ? 'Bottom' : 'Top'
  return change.inning ? `${side} ${nth(change.inning)}` : side
}

/**
 * One revision, as lines to render.
 *
 * The club names are passed in rather than looked up, because the score fields are stored as
 * `away_score` / `home_score` and "Away runs" is not what anybody calls it. A caller without
 * the clubs to hand can pass nothing and gets the side instead, which is still readable.
 */
export function describeRevision(
  revision: WpblGameRevision,
  clubs: { away?: string | null; home?: string | null } = {},
): WpblRevisionLine[] {
  const club = (side: 'away' | 'home') => clubs[side] || (side === 'away' ? 'Away' : 'Home')
  const lines: WpblRevisionLine[] = []

  for (const c of revision.changes ?? []) {
    // A whole line or play that came or went. There is no pair of values to show, so the
    // sentence carries the fact and the columns carry the dash.
    if (c.change) {
      if (c.kind === 'play') {
        lines.push({
          who: halfInning(c), playerId: null,
          what: c.change === 'added' ? `Play added${c.batter ? `: ${c.batter}` : ''}`
            : `Play removed${c.batter ? `: ${c.batter}` : ''}`,
          before: c.change === 'added' ? NONE : 'was in the play-by-play',
          after: c.change === 'added' ? 'now in the play-by-play' : NONE,
        })
        continue
      }
      const sheet = c.kind === 'pitching' ? 'pitching line' : 'batting line'
      // `unidentified` is a feed entry the league published with no player id. It cannot be
      // matched to anybody, and guessing by name is exactly the mistake that put one player on
      // a club she has never played for, so it is reported as what it is.
      lines.push({
        who: c.player ?? null, playerId: c.player_id ?? null,
        what: c.change === 'added' ? `Added to the ${sheet}`
          : c.change === 'removed' ? `Removed from the ${sheet}`
            : `Listed on the ${sheet} without a league id`,
        before: c.change === 'added' ? NONE : 'was listed',
        after: c.change === 'removed' ? NONE : 'now listed',
      })
      continue
    }

    const before = show(c.before, c.field, c.kind)
    const after = show(c.after, c.field, c.kind)

    if (c.kind === 'game') {
      const side = c.field?.startsWith('home') ? 'home' : 'away'
      const stat = c.field?.endsWith('_score') ? 'runs' : c.field?.endsWith('_hits') ? 'hits' : 'errors'
      lines.push({ who: club(side), playerId: null, what: `Team ${stat}`, before, after })
      continue
    }

    if (c.kind === 'play') {
      lines.push({
        who: halfInning(c), playerId: null,
        what: `${c.batter ? `${c.batter}: ` : ''}${PLAY_LABELS[c.field ?? ''] ?? c.field ?? ''}`,
        before, after,
      })
      continue
    }

    const labels = c.kind === 'pitching' ? PITCHING_LABELS : BATTING_LABELS
    lines.push({
      who: c.player ?? null, playerId: c.player_id ?? null,
      what: labels[c.field ?? ''] ?? c.field ?? '', before, after,
    })
  }

  return lines
}

/**
 * How many changes this revision holds that are NOT being shown, because the checker capped
 * what it stored. Zero on every ordinary revision.
 *
 * It exists so a wholesale re-score cannot be reported as a small one. `change_count` is the
 * true total and the array is capped, and a page that trusted the array's length would say
 * "80 changes" about a night when three hundred things moved, which is the more misleading
 * number of the two by a distance.
 */
export function revisionOverflow(revision: WpblGameRevision): number {
  return Math.max(0, (revision.change_count ?? 0) - (revision.changes?.length ?? 0))
}
