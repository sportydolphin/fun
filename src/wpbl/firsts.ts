import { outsToIp } from './constants'
import type { WpblGame, WpblFirstsPlay, WpblPlayer, WpblPitchingLine } from './types'

// "Hall of Firsts" — the players who recorded each league milestone first. Event-based
// firsts (HR, strikeout, stolen base, …) come from the chronological play-by-play; win
// and complete game come from the box-score pitching lines. Each first is attributed to
// a roster player when we can resolve one, with the play narrative kept as context.

export interface WpblFirst {
  key: string
  label: string
  icon: string
  player: WpblPlayer | null
  name: string            // display name (resolved player, or the parsed runner)
  teamId: string | null
  date: string            // YYYY-MM-DD
  detail: string          // narrative / context
  featured: boolean
  order: number
}

interface Meta { label: string; icon: string; featured: boolean; order: number }
const META: Record<string, Meta> = {
  first_hr:         { label: 'First home run',      icon: '💥', featured: true,  order: 1 },
  first_grand_slam: { label: 'First grand slam',    icon: '💣', featured: true,  order: 2 },
  complete_game:    { label: 'First complete game', icon: '🎯', featured: true,  order: 3 },
  first_win:        { label: 'First win',           icon: '🏆', featured: true,  order: 4 },
  first_so:         { label: 'First strikeout',     icon: '🔥', featured: true,  order: 5 },
  first_save:       { label: 'First save',          icon: '🧤', featured: false, order: 6 },
  first_sb:         { label: 'First stolen base',   icon: '🏃', featured: true,  order: 7 },
  first_hit:        { label: 'First hit',           icon: '⚾', featured: false, order: 8 },
  first_double:     { label: 'First double',        icon: '2️⃣', featured: false, order: 9 },
  first_triple:     { label: 'First triple',        icon: '3️⃣', featured: false, order: 10 },
  first_rbi:        { label: 'First RBI',           icon: '💪', featured: false, order: 11 },
  first_walk:       { label: 'First walk',          icon: '🚶', featured: false, order: 12 },
  first_hbp:        { label: 'First hit by pitch',  icon: '🤕', featured: false, order: 13 },
  first_balk:       { label: 'First balk',          icon: '🚫', featured: false, order: 14 },
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
const cleanNarrative = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').trim() // drop trailing "(2-2 KBFB)"

// True when `a` and `b` are within one edit (insert / delete / substitute). Cheap bounded
// Levenshtein — lets feed spelling variants link to the roster (Villareal↔Villarreal,
// Gabriella↔Gabrielle) without a full DP matrix.
const within1 = (a: string, b: string): boolean => {
  if (a === b) return true
  const la = a.length, lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0
  while (i < la && i < lb && a[i] === b[i]) i++
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1)   // substitution
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1) // ins/del
}

// "6:30 PM" wall clock → minutes since midnight, for ordering games that share a date
// (doubleheaders). Unparseable/blank sorts first (0). Play sequence restarts per game, so
// without this the earlier-starting game's plays could sort after the later one's.
const startMin = (t: string | null | undefined): number => {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec((t ?? '').trim())
  if (!m) return 0
  let h = Number(m[1]) % 12
  if (/pm/i.test(m[3])) h += 12
  return h * 60 + Number(m[2])
}

// Run-scoring event types that do NOT credit the batter with an RBI (a run crossing on
// one of these is not the batter's RBI). Everything else with runs_scored > 0 counts.
const NON_RBI_EVENTS = new Set(['wild_pitch', 'passed_ball', 'balk', 'stolen_base'])

// ─── Which plays this file can possibly care about ──────────────────────────────
// The event types that name a milestone directly, and the predicate for "could this row
// ever set a first?". `fetchWpblAllPlays` turns these into a server-side filter so the
// season scan transfers only candidate rows — a little over half the play log today, and
// a falling share as the season fills with routine outs.
//
// This lives here, next to the loop that consumes it, because the two must agree: a play
// the filter drops can never set a first, and the failure mode of getting that wrong is
// silent (a milestone quietly attributed to the second player to do it). `playCanSetFirst`
// is the single definition of that boundary, and __tests__/firsts.test.ts pins the
// invariant — computeFirsts over the filtered plays must equal computeFirsts over all of
// them. Adding a new milestone to META means widening this too, and the test will say so.
export const FIRSTS_EVENT_TYPES = [
  'home_run', 'double', 'triple', 'walk', 'hit_by_pitch', 'strikeout', 'stolen_base', 'balk',
] as const

export function playCanSetFirst(p: Pick<WpblFirstsPlay, 'event_type' | 'is_hit' | 'runs_scored' | 'narrative'>): boolean {
  if (p.is_hit) return true                                                    // first_hit
  if (FIRSTS_EVENT_TYPES.includes(p.event_type as typeof FIRSTS_EVENT_TYPES[number])) return true
  if ((p.runs_scored ?? 0) > 0) return true                                    // first_rbi (filtered again below)
  return /\bbalk\b/i.test(p.narrative ?? '')                                   // balks arrive as 'unknown'
}

export function computeFirsts(
  plays: WpblFirstsPlay[], games: WpblGame[], players: WpblPlayer[], pitching: WpblPitchingLine[],
): WpblFirst[] {
  const gById = new Map(games.map(g => [g.id, g]))
  const pById = new Map(players.map(p => [p.id, p]))
  const byName = new Map(players.map(p => [norm(p.name), p]))
  const found = new Map<string, WpblFirst>()

  // Resolve a name parsed from a narrative/play to a roster player. Exact first, then a
  // forgiving match mirroring the ingest box-score resolver so feed spelling variants still
  // link — the play log spells "Maggie Fox"/"Val Perez"/"Gabriella Haas"/"Isabella Villareal"
  // where the roster has "Maggie Foxx"/"Valerie Perez"/"Gabrielle Haas"/"Isabella Villarreal".
  // Surname and given name each match when equal, one prefixes the other, or they're within
  // one edit; only an UNAMBIGUOUS single candidate is accepted (never guess between two).
  const findByName = (raw: string): WpblPlayer | undefined => {
    const n = norm(raw)
    if (!n) return undefined
    const exact = byName.get(n)
    if (exact) return exact
    const [rf, ...rrest] = n.split(' '); const rl = rrest.join(' ')
    if (!rf || !rl) return undefined
    const near = (a: string, b: string) => a === b || a.startsWith(b) || b.startsWith(a) || within1(a, b)
    const cands = players.filter(p => {
      const [pf, ...prest] = norm(p.name).split(' '); const pl = prest.join(' ')
      return !!pf && !!pl && near(pl, rl) && near(pf, rf)
    })
    return cands.length === 1 ? cands[0] : undefined
  }

  const rec = (key: string, player: WpblPlayer | undefined, name: string, teamId: string | null, date: string, detail: string) => {
    if (found.has(key)) return
    const m = META[key]; if (!m) return
    found.set(key, { key, ...m, player: player ?? null, name, teamId, date, detail })
  }

  // ── Event firsts, scanned in true chronological order (game date, start time, then
  // sequence — start time breaks ties between two games on the same day) ──
  const ordered = plays
    .map(p => ({ p, g: gById.get(p.game_id) }))
    .filter((x): x is { p: WpblFirstsPlay; g: WpblGame } => !!x.g)
    .sort((a, b) =>
      a.g.game_date !== b.g.game_date ? (a.g.game_date < b.g.game_date ? -1 : 1)
      : startMin(a.g.start_time) !== startMin(b.g.start_time) ? startMin(a.g.start_time) - startMin(b.g.start_time)
      : a.p.sequence - b.p.sequence)

  for (const { p, g } of ordered) {
    const d = g.game_date
    // Resolve batter/pitcher by our id first, then fall back to the play's name via the
    // forgiving matcher — the feed play log spells variants ("Maggie Fox" vs roster
    // "Maggie Foxx", "Val Perez" vs "Valerie Perez") that the ingest may not have linked
    // to a batter_id. Without this fallback the genuine first (an unresolved batter) is
    // silently skipped and the milestone is misattributed to a later player.
    const bat = (p.batter_id ? pById.get(p.batter_id) : undefined) ?? findByName(p.batter_name ?? '')
    const pit = (p.pitcher_id ? pById.get(p.pitcher_id) : undefined) ?? findByName(p.pitcher_name ?? '')
    const nar = cleanNarrative(p.narrative)
    const et = p.event_type
    // Attribute even when the player can't be resolved, using the feed name + batting-side
    // slug, so the chronologically-first event still wins its "first".
    const batName = (bat?.name ?? p.batter_name ?? '').trim()
    const batTeam = bat?.team_id ?? p.team_id ?? null
    const pitName = (pit?.name ?? p.pitcher_name ?? '').trim()
    if (p.is_hit && batName) rec('first_hit', bat, batName, batTeam, d, nar)
    if (batName) {
      if (et === 'home_run') {
        rec('first_hr', bat, batName, batTeam, d, nar)
        // A grand slam is a home run with the bases loaded. The feed's runs_scored counts
        // the runners who scored, NOT the batter (a solo HR reads 0), so 3 runners scoring
        // on a home run means the bases were full.
        if (p.runs_scored === 3) rec('first_grand_slam', bat, batName, batTeam, d, nar)
      }
      if (et === 'double') rec('first_double', bat, batName, batTeam, d, nar)
      if (et === 'triple') rec('first_triple', bat, batName, batTeam, d, nar)
      if (et === 'walk') rec('first_walk', bat, batName, batTeam, d, nar)
      if (et === 'hit_by_pitch') rec('first_hbp', bat, batName, batTeam, d, nar)
      if (p.runs_scored > 0 && !NON_RBI_EVENTS.has(et ?? '')) {
        rec('first_rbi', bat, batName, batTeam, d, nar)
      }
    }
    if (et === 'strikeout' && pitName) rec('first_so', pit, pitName, pit?.team_id ?? null, d, nar)
    // Balks aren't a distinct event_type in the feed — they arrive as an 'unknown' play
    // whose narrative reads "... on a balk." (the pitcher is named). Match the narrative,
    // and credit the pitcher (their team, not the batting side).
    if ((et === 'balk' || /\bbalk\b/i.test(p.narrative)) && pitName) rec('first_balk', pit, pitName, pit?.team_id ?? null, d, nar)
    if (et === 'stolen_base') {
      // The runner is named in the narrative ("Maggie Fox stole second"), not batter_id.
      const runnerName = (p.narrative.match(/^(.+?)\s+stole\b/i)?.[1] ?? '').trim()
      const runner = findByName(runnerName)
      rec('first_sb', runner, runner?.name ?? (runnerName || 'Unknown'), runner?.team_id ?? null, d, nar)
    }
  }

  // ── Box-line firsts: first win, first complete game (earliest final game) ──
  const finals = pitching
    .map(l => ({ l, g: gById.get(l.game_id) }))
    .filter((x): x is { l: WpblPitchingLine; g: WpblGame } => !!x.g && x.g.status === 'final')
    .sort((a, b) =>
      a.g.game_date !== b.g.game_date ? (a.g.game_date < b.g.game_date ? -1 : 1)
      : startMin(a.g.start_time) - startMin(b.g.start_time))

  for (const { l, g } of finals) {
    if (l.decision === 'W') {
      const p = pById.get(l.player_id)
      rec('first_win', p, p?.name ?? '—', p?.team_id ?? l.team_id, g.game_date, `${outsToIp(l.outs)} IP, ${l.so} K`)
      break
    }
  }
  for (const { l, g } of finals) {
    if (l.decision === 'S') {
      const p = pById.get(l.player_id)
      rec('first_save', p, p?.name ?? '—', p?.team_id ?? l.team_id, g.game_date, `${outsToIp(l.outs)} IP, ${l.so} K`)
      break
    }
  }
  // A complete game = one pitcher recorded all of their team's outs in a final game.
  const perTeamGame = new Map<string, number>()
  for (const { l } of finals) {
    const k = `${l.game_id}|${l.team_id}`
    perTeamGame.set(k, (perTeamGame.get(k) ?? 0) + 1)
  }
  for (const { l, g } of finals) {
    const k = `${l.game_id}|${l.team_id}`
    if (perTeamGame.get(k) === 1 && l.outs >= 18) { // full ~7-inning outing, not a rain-shortened cameo
      const p = pById.get(l.player_id)
      rec('complete_game', p, p?.name ?? '—', p?.team_id ?? l.team_id, g.game_date, `${outsToIp(l.outs)} IP`)
      break
    }
  }

  return [...found.values()].sort((a, b) => a.order - b.order)
}
