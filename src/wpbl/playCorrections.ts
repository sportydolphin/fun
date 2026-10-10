import type { WpblCorrectionSource } from './types'

// Our corrections to the league's play log, laid over the mirror on the way out. Moved out of
// api.ts so a job without the browser's supabase client applies the same overlay.
//
// Values arrive as text because one table serves fields of several types; see the migration
// for why that beats a jsonb blob. Casting happens here, once, rather than at each call site.
const CORRECTABLE_NUMBER = new Set(['runs_scored'])
const CORRECTABLE_BOOLEAN = new Set(['is_hit', 'is_scoring_play'])

function castCorrection(field: string, value: string | null): unknown {
  if (value === null) return null
  if (CORRECTABLE_NUMBER.has(field)) return Number(value)
  if (CORRECTABLE_BOOLEAN.has(field)) return value === 'true' || value === '1'
  return value
}

/** The columns the overlay reads. */
export const CORRECTION_SELECT = 'game_id,sequence,field,new_value,source'

export interface WpblPlayCorrection {
  game_id: string; sequence: number; field: string; new_value: string | null
  /** How we know. Carried onto the play so a surface can say where an account came from; see
   *  `corrected_source` on WpblGamePlay for the reader-facing reason it has to. */
  source: WpblCorrectionSource | null
}

/** Best evidence first, matching the order docs/PLAY_VALIDATION.md sets out: somebody watched
 *  it, then a rule concluded it, then a second transcription agreed, then the league's own box
 *  score contradicted its own play log. */
const SOURCE_RANK: readonly WpblCorrectionSource[] = ['video', 'derived', 'external', 'league']
const strongestSource = (all: WpblCorrectionSource[]): WpblCorrectionSource =>
  all.reduce((best, s) => (SOURCE_RANK.indexOf(s) < SOURCE_RANK.indexOf(best) ? s : best), all[0])

/** Overlay corrections onto plays, matched on (game_id, sequence), which is the feed's own
 *  identifier for a play. Never the play's uuid, which wpbl-ingest regenerates on every
 *  reinsert and so identifies a row only for minutes.
 *
 *  `sequence` restarts at 1 in every game, so game_id is load-bearing and not belt-and-braces:
 *  the Hall of Firsts hands this the whole season at once, and on a sequence-only match one
 *  game's correction would rewrite the same-numbered play in every game. */
export function applyPlayCorrections<T extends { game_id: string; sequence: number }>(
  plays: T[], corrections: WpblPlayCorrection[],
): T[] {
  if (corrections.length === 0) return plays
  const key = (gameId: string, sequence: number) => `${gameId}:${sequence}`
  const byPlay = new Map<string, WpblPlayCorrection[]>()
  for (const c of corrections) {
    const k = key(c.game_id, c.sequence)
    const list = byPlay.get(k)
    if (list) list.push(c); else byPlay.set(k, [c])
  }
  return plays.map(play => {
    const fixes = byPlay.get(key(play.game_id, play.sequence))
    if (!fixes) return play
    const next = { ...play } as Record<string, unknown>
    for (const f of fixes) next[f.field] = castCorrection(f.field, f.new_value)
    // STAMPED ON THE PLAY, NOT STORED ANYWHERE. The mirror row is always the feed's own; this
    // says only that what the caller is now holding is not. Where a play carries corrections
    // from more than one source, the strongest wins: a reader shown one provenance should be
    // shown the best evidence behind the row rather than whichever correction was written last.
    const source = fixes.map(f => f.source).filter(Boolean) as WpblCorrectionSource[]
    if (source.length) next.corrected_source = strongestSource(source)
    return next as T
  })
}

