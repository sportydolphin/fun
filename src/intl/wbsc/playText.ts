// Our own play-by-play sentence for each World Cup play. ROADMAP-WOMENS-BASEBALL.md, stage 2.
//
// NEVER WBSC'S WORDS. The scorer's sentence ("DAY-BÉDARD Ela Zoë Mini strikes out swinging") stays in
// the gitignored archive, where the importer reads codes out of it; what a page shows is written
// here from the play's facts: what the batter did, the bases before it, the bases and outs after.
// That also makes it shorter and the names the ones the site shows.
//
// A RUNNER IS NAMED ONLY WHEN THE BASES SAY WHO. The play log carries the bases BEFORE each play;
// after it is the next play's before, within the half. A runner on a later base moved there. A
// runner gone from the bases either scored or was put out, and when a play does both to different
// runners nothing says which was which, so the sentence gives the count and names no one. The last
// play of a half has no after: whoever is still on base when the third out is made was left there,
// so its runners are named only when every one of them scored.

import type { RunValuePlay } from '../../league/types'

const BASE = ['first', 'second', 'third'] as const

const BATTER_OUT = new Set(['strikeout', 'groundout', 'flyout', 'lineout', 'popup', 'foul_out', 'sacrifice', 'out'])

/** Plays that move runners and nobody else; the batter is still at the plate. */
const RUNNER_ONLY: Readonly<Record<string, string>> = {
  stolen_base: 'stolen base',
  caught_stealing: 'caught stealing',
  pickoff: 'pickoff',
  other_out: 'out on the bases',
  wild_pitch: 'wild pitch',
  passed_ball: 'passed ball',
  balk: 'balk',
  error_advance: 'error',
  other_advance: 'advance',
}

const HR_RUNS = ['', 'solo home run', 'two-run home run', 'three-run home run', 'grand slam']

function batterPhrase(p: RunValuePlay): string | null {
  switch (p.event_type) {
    case 'single': return 'singled'
    case 'double': return 'doubled'
    case 'triple': return 'tripled'
    case 'home_run': return `hit a ${HR_RUNS[p.runs_scored ?? 1] ?? 'home run'}`
    case 'walk': return 'walked'
    case 'intent_walk': return 'was intentionally walked'
    case 'hit_by_pitch': return 'was hit by a pitch'
    case 'catcher_interference': return "reached on catcher's interference"
    case 'strikeout': {
      const last = p.pitch_sequence?.slice(-1)
      return last === 'C' ? 'struck out looking' : last === 'S' ? 'struck out swinging' : 'struck out'
    }
    case 'groundout': return 'grounded out'
    case 'flyout': return 'flied out'
    case 'lineout': return 'lined out'
    case 'popup': return 'popped out'
    case 'foul_out': return 'fouled out'
    case 'sacrifice': return 'sacrificed'
    case 'fielders_choice': return "reached on a fielder's choice"
    case 'field_error': return 'reached on an error'
    case 'out': return 'was out'
    default: return null
  }
}

/** The bases and outs after a play: the next play's before, or null after a half's last play. */
export interface After { bases: [string, string, string]; outs: number }

const basesOf = (p: RunValuePlay): [string, string, string] => [p.first_base ?? '', p.second_base ?? '', p.third_base ?? '']

/** A runner the importer could not name keeps a lineup code ("slot 1090"); say "a runner" instead. */
const who = (name: string) => (/^slot \d+$/.test(name) ? 'A runner' : name)

const runs = (n: number) => (n === 1 ? '1 run scored' : `${n} runs scored`)

const outHow = (type: string) => (type === 'caught_stealing' ? 'was caught stealing' : type === 'pickoff' ? 'was picked off' : 'was out')

/** 'A', 'A and B', 'A, B and C'. */
const list = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

/**
 * `after` is null after a half's last play, which made the third out, except the game's very last
 * play (`gameOver`): a walk-off or a run-rule hit ends the game with outs to spare, so that play
 * counts outs only when it is itself an out.
 */
export function playText(p: RunValuePlay, after: After | null, gameOver = false): string {
  const before = basesOf(p)
  const type = p.event_type ?? ''
  const runnerOnly = type in RUNNER_ONLY
  const batter = p.batter_name ?? 'The batter'
  const total = p.runs_scored ?? 0
  const batterScored = type === 'home_run' ? 1 : 0
  const runnerRuns = Math.max(0, total - batterScored)
  const batterOut = !runnerOnly && BATTER_OUT.has(type) ? 1 : 0
  const isOut = batterOut === 1 || ['caught_stealing', 'pickoff', 'other_out'].includes(type)
  const outsOnPlay = after ? after.outs - p.outs : gameOver && !isOut ? 0 : 3 - p.outs
  const runnerOuts = Math.max(0, outsOnPlay - batterOut)

  const moved: string[] = []
  const gone: string[] = []
  for (let b = 2; b >= 0; b--) {
    const r = before[b]
    if (!r) continue
    const now = after ? after.bases.indexOf(r) : -1
    if (now > b) moved.push(`${who(r)} to ${BASE[now]}`)
    else if (now < 0) gone.push(r)
  }

  // What happened to the runners no longer on base.
  const fate: string[] = []
  if (type === 'home_run') {
    // Everyone scores on a home run, and the phrase already says how many.
  } else if (!after) {
    if (runnerRuns > 0 && runnerRuns === gone.length) fate.push(`${list(gone.map(who))} scored`)
    // The third out made on the bases with one runner on: that runner is the out.
    else if (runnerOnly && runnerRuns === 0 && runnerOuts > 0 && gone.length === 1) fate.push(`${who(gone[0])} ${outHow(type)}`)
    else if (runnerRuns > 0) fate.push(runs(runnerRuns))
  } else if (gone.length && runnerOuts === 0 && runnerRuns === gone.length) {
    fate.push(`${list(gone.map(who))} scored`)
  } else if (gone.length && runnerRuns === 0 && runnerOuts === gone.length) {
    fate.push(...gone.map(r => `${who(r)} ${outHow(type)}`))
  } else if (runnerRuns > 0) {
    fate.push(runs(runnerRuns))
  }

  const sentences: string[] = []
  if (runnerOnly) {
    const label = RUNNER_ONLY[type]
    if (type === 'stolen_base') {
      sentences.push(...moved.map(m => m.replace(/ to (\w+)$/, ' stole $1')))
      sentences.push(...fate.map(f => f.replace(/ scored$/, ' stole home').replace(/^(.* and .*) stole home$/, '$1 scored')))
    } else {
      const on = ['wild_pitch', 'passed_ball', 'balk'].includes(type) ? ` on a ${label}` : type === 'error_advance' ? ' on an error' : ''
      sentences.push(...moved.map(m => m + on), ...fate.map(f => (f.endsWith('scored') ? f + on : f)))
    }
    if (!sentences.length) sentences.push(label.charAt(0).toUpperCase() + label.slice(1))
  } else {
    sentences.push(`${batter} ${batterPhrase(p) ?? 'batted'}`, ...fate, ...moved)
  }
  if (outsOnPlay === 2) sentences.push('Double play')
  if (outsOnPlay === 3) sentences.push('Triple play')
  return sentences.map(s => `${s}.`).join(' ')
}

/** Every play's sentence, in order, with the after-state worked out within each half-inning. */
export function gamePlayTexts(plays: readonly RunValuePlay[]): string[] {
  const sorted = [...plays].sort((a, b) => a.sequence - b.sequence)
  return sorted.map((p, i) => {
    const next = sorted[i + 1]
    const sameHalf = next && next.inning === p.inning && next.half === p.half
    return playText(p, sameHalf ? { bases: basesOf(next), outs: next.outs } : null, !next)
  })
}
