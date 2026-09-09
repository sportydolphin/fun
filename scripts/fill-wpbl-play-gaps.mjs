#!/usr/bin/env node
/**
 * fill-wpbl-play-gaps.mjs — write the plays the league published EMPTY, from RetroWPBL.
 *
 * WHAT THIS IS ALLOWED TO TOUCH, AND WHY THE LINE IS EXACTLY THERE. `sync-wpbl-retro` mirrors
 * only their `info` records, deliberately: a second copy of the play-by-play would be a second
 * truth with no way for a reader to tell which one they were reading. `check-wpbl-retro-stats`
 * says the same thing from the other side, that its output is a disagreement to go and look at
 * and never a correction to apply. Both rules hold, and neither is about the case this job
 * exists for. A row the feed published with no batter, no event and no narrative is not a
 * competing account of the play: it is the absence of one. Filling it invents no second truth
 * because there is no first.
 *
 * So: EMPTY ROWS, AND ONE OTHER THING. A row where the feed said something and RetroWPBL says
 * something else is left exactly as it is and reported, which is what the stats check is for. A
 * job that felt free to overwrite a name the league asserted would be deciding, unattended, that
 * a hand transcription outranks the league's own scorer.
 *
 * THE EXCEPTION IS A NAME THE LEAGUE'S OWN BOX SCORE RULES OUT, and it is not a second opinion,
 * it is an internal contradiction. Aug 27, LA at NY: two plate appearances in the play log carry
 * Ayami Sato, whose batting line in the same box score is 0 for 0 with no walk and no strikeout,
 * so she cannot have taken either of them. Mo'ne Davis, on the same lineup slot, has 2 at-bats, a
 * hit and a strikeout and no plays at all, and the two orphaned plays are a strikeout and a
 * single. RetroWPBL names Davis for both. Three things agree and the only dissent is one field.
 *
 * So the rule is narrow and self-checking: our name is IMPOSSIBLE (a box-score line with no plate
 * appearance) and theirs is POSSIBLE (a line with at least one), or the half-inning is skipped as
 * before. A disagreement between two players who both batted is still a person's call.
 *
 * THE ALIGNMENT IS THE RISK, and it is checked rather than assumed. Their plays and ours are
 * both in order within a half-inning, so filling row N from their row N is right only if the two
 * lists describe the same half-inning. Three gates, all of which must pass or the half-inning is
 * skipped and reported:
 *
 *   1. Same number of plays in that half-inning.
 *   2. Every row of ours that is NOT empty names the same batter as theirs at the same index.
 *      This is the load-bearing one: it is a free checksum, since a real half-inning is mostly
 *      rows we already have, and any slip in the alignment shows up as a name that disagrees.
 *   3. Every empty row's batter resolves to a player on that game's box score.
 *
 * A row whose name the box score rules out (above) is corrected instead of stopping the pass, and
 * only that row: the rest of the half-inning still has to line up.
 *
 * The Aug 20 NY at BOS game is the reason this exists: 14 rows, one in the fifth and the whole
 * of New York's sixth and seventh, carrying a pitcher and a pitch sequence and nothing else,
 * including the hit-by-pitch that scored a run. Their transcription has all of it, and lines up
 * one for one, counts included.
 *
 * IT WRITES CORRECTIONS, NEVER THE MIRROR. `wpbl_game_plays` is deleted and reinserted by
 * wpbl-ingest on every pass (see CLAUDE.md), so an edit there survives two minutes. Rows go into
 * `wpbl_play_corrections`, keyed on (game_id, sequence), which the app lays over the mirror on
 * the way out. Insert-only: a row that already exists for that field is left alone, so a
 * correction a person wrote by hand always outranks this.
 *
 * Usage:
 *   node --env-file=.env scripts/fill-wpbl-play-gaps.mjs --dry-run
 *   node --env-file=.env scripts/fill-wpbl-play-gaps.mjs
 *   node --env-file=.env scripts/fill-wpbl-play-gaps.mjs --game 2026-08-20
 *
 * Needs SUPABASE_DB_URL. npm script: npm run fill-play-gaps
 */

import pg from 'pg'
import { pathToFileURL } from 'node:url'
import { RAW, EVENT_FILES, fetchText, parseGames } from './check-wpbl-retro-stats.mjs'

const DRY_RUN = process.argv.includes('--dry-run')
const gameIx = process.argv.indexOf('--game')
const ONE_DATE = gameIx > -1 ? process.argv[gameIx + 1] : null

/** Their club codes to ours, hard-coded for the reason the other two retro jobs hard-code it:
 *  four clubs, and a wrong guess silently attributes one club's game to another. */
const TEAM_CODES = Object.freeze({ BSH: 'BOS', LAQ: 'LA', NYH: 'NY', SFF: 'SF' })

/** Accents off, case folded, spaces collapsed. Same rule as the stats check and the ingest. */
export const normName = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// ─── Reading one Retrosheet event ─────────────────────────────────────────────

/**
 * The nine positions, twice, because the feed writes them two ways and a filled row sits in a
 * list of real ones. A HIT names the place in full ("singled to left field", "singled to
 * shortstop"); an OUT and a throw use the scorer's abbreviations ("flied out to lf", "grounded
 * into double play ss to 2b to 1b"). Getting this wrong does not make the sentence untrue, it
 * makes it obviously not one of ours, which is the thing a reader notices first.
 */
const HIT_PLACE = {
  1: 'the pitcher', 2: 'the catcher', 3: 'first base', 4: 'second base', 5: 'third base',
  6: 'shortstop', 7: 'left field', 8: 'center field', 9: 'right field',
}
const OUT_PLACE = { 1: 'p', 2: 'c', 3: '1b', 4: '2b', 5: '3b', 6: 'ss', 7: 'lf', 8: 'cf', 9: 'rf' }
const THROW = OUT_PLACE

const BASE_WORD = { 1: 'first', 2: 'second', 3: 'third', H: 'home' }

/** Split an event into its primary, its modifiers and its advancement. */
export function splitEvent(eventRaw) {
  let ev = String(eventRaw ?? '').replace(/[!?#]/g, '').trim()
  // `K+SB2` is a strikeout AND a steal on one pitch. Both halves are real here, unlike in the
  // batting audit, which only ever wanted the batter's.
  const plus = ev.indexOf('+')
  const extra = plus > -1 ? ev.slice(plus + 1) : ''
  if (plus > -1) ev = ev.slice(0, plus)

  let depth = 0, dot = -1
  for (let i = 0; i < ev.length; i++) {
    const ch = ev[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === '.' && depth === 0) { dot = i; break }
  }
  const advance = dot > -1 ? ev.slice(dot + 1) : ''
  const head = dot > -1 ? ev.slice(0, dot) : ev
  const [primary, ...mods] = head.split('/')
  return { primary: primary.trim(), mods, advance, extra }
}

/** The advancement clauses, in the order written: `3-H(RBI);2-3;1X2(64)`. */
export function advances(advance) {
  return String(advance ?? '').split(';').map(c => c.trim()).filter(Boolean).map(clause => {
    const m = clause.match(/^([B123])([-X])([123H])/)
    if (!m) return null
    return { from: m[1], to: m[3], out: m[2] === 'X', rbi: /\(RBI\)/.test(clause) }
  }).filter(Boolean)
}

/**
 * How many RUNNERS crossed the plate on this play.
 *
 * Runners, not runs: `runs_scored` on our side excludes the batter by design, so a solo home run
 * reads 0 (see runsOnPlay in src/wpbl/derive/playByPlay.ts and the entry in CLAUDE.md). A batter
 * reaching home is `B-H`, or is implicit in `HR`, and neither is counted here.
 */
export function runnersHome(event) {
  const { advance } = splitEvent(event)
  return advances(advance).filter(a => a.from !== 'B' && a.to === 'H' && !a.out).length
}

/** "grounded out to 3b", "flied out to lf", "grounded into double play ss to 2b to 1b". */
function outText(primary, mods, dp) {
  const fielders = primary.replace(/\(.*?\)/g, '').split('').filter(c => /[1-9]/.test(c)).map(Number)
  const traj = mods.find(m => /^[GLFP]$/.test(m))
  const foul = mods.includes('FL')
  const path = fielders.map(f => THROW[f] ?? `position ${f}`).join(' to ')
  if (dp) {
    const shape = traj === 'L' ? 'lined' : traj === 'P' ? 'popped' : traj === 'F' ? 'flied' : 'grounded'
    return `${shape} into double play ${path}`
  }
  const verb = traj === 'L' ? 'lined out' : traj === 'P' ? (foul ? 'fouled out' : 'popped up')
    : traj === 'F' ? 'flied out' : traj === 'G' ? 'grounded out' : 'was retired'
  // One fielder is where it was caught or fielded; more than one is a throw, and the feed names
  // the first of them ("grounded out to 3b" for a 5-3) rather than reciting the path.
  const where = OUT_PLACE[fielders[0]] ?? 'the field'
  return `${verb} to ${where}`
}

/**
 * The feed's own `event_type`, which is the half of a play the derived surfaces actually read.
 *
 * WHY IT IS WORTH SETTING AT ALL. A filled row with a sentence and `event_type: 'unknown'` reads
 * correctly and counts as nothing: run expectancy classifies plays by this field, `runsOnPlay`
 * adds the batter's own run on `home_run` alone, the recap engine looks for back-to-back home
 * runs with it, and the pitch summaries count strikeouts by it. A play we can describe and
 * cannot classify is half-restored.
 *
 * ONLY VALUES THE FEED ITSELF USES, taken from what is already in the table. An event this cannot
 * map keeps 'unknown', which is a state every consumer already handles because 549 of the
 * league's own rows carry it.
 */
export function eventType(event) {
  const { primary: p, mods } = splitEvent(event)
  const traj = mods.find(m => /^[GLFP]$/.test(m))
  if (/^S\d*$/.test(p)) return 'single'
  if (/^(D\d*|DGR\d*)$/.test(p)) return 'double'
  if (/^T\d*$/.test(p)) return 'triple'
  if (/^(HR|H)\d*$/.test(p)) return 'home_run'
  if (/^(W|IW|I)$/.test(p)) return 'walk'
  if (/^HP$/.test(p)) return 'hit_by_pitch'
  if (/^K/.test(p)) return 'strikeout'
  if (/^FC\d*/.test(p)) return 'fielders_choice'
  if (/^SB[23H]$/.test(p)) return 'stolen_base'
  if (/^CS[23H]/.test(p)) return 'caught_stealing'
  if (/^WP$/.test(p)) return 'wild_pitch'
  if (/^PB$/.test(p)) return 'passed_ball'
  if (mods.includes('SF') || mods.includes('SH')) return 'sacrifice'
  if (/^\d/.test(p)) {
    if (traj === 'G') return 'groundout'
    if (traj === 'F') return 'flyout'
    if (traj === 'L') return 'lineout'
    if (traj === 'P') return mods.includes('FL') ? 'foul_out' : 'popup'
    return 'out'
  }
  return null
}

/**
 * The ball-strike count, in the brackets the feed puts it in.
 *
 * WHY IT IS WORTH CARRYING. The play-by-play pulls the count out of the narrative into its own
 * column (`COUNT_RE` in playByPlay.ts), so a filled row without it leaves a hole in a column
 * every other row fills, which is how a restored play announces that it is not quite one.
 * Their file has it: `31` beside the pitches on every play record.
 *
 * WITHOUT THE PITCH LETTERS, though we have those too. The feed writes its own alphabet
 * (`B K S F H P`) and Retrosheet writes another (`C` for a called strike, `X` for a ball in
 * play), and a row reading "(2-2 BCBFX)" beside rows reading "(2-2 BKBF)" would be publishing
 * one league's shorthand in another's. The count itself is the same number in both.
 */
export function countText(raw) {
  const m = String(raw ?? '').trim().match(/^(\d)(\d)$/)
  return m ? ` (${m[1]}-${m[2]})` : ''
}

/**
 * One event as a sentence about the batter, plus what it does to the bases.
 *
 * Returns null for an event this does not read, which is how the caller refuses to fill a row
 * rather than filling it with a guess.
 */
export function batterText(event, batter, count = null) {
  const { primary, mods, advance } = splitEvent(event)
  const p = primary
  const runs = runnersHome(event)
  const sacFly = mods.includes('SF')
  const sacBunt = mods.includes('SH')
  const dp = mods.some(m => /DP$/.test(m)) || /^\d+\(\d\)/.test(p)
  const hitTo = (code) => HIT_PLACE[Number(String(code).replace(/[^1-9]/g, '')[0])] ?? null

  let text = null
  let lands = null   // where the batter ends up: 1, 2, 3, 'H' or null for an out

  if (/^S\d*$/.test(p))        { text = `singled${hitTo(p) ? ` to ${hitTo(p)}` : ''}`; lands = 1 }
  else if (/^(D\d*|DGR\d*)$/.test(p)) { text = `doubled${hitTo(p) ? ` to ${hitTo(p)}` : ''}`; lands = 2 }
  else if (/^T\d*$/.test(p))   { text = `tripled${hitTo(p) ? ` to ${hitTo(p)}` : ''}`; lands = 3 }
  else if (/^(HR|H)\d*$/.test(p)) { text = 'homered'; lands = 'H' }
  // "struck out" and not "struck out swinging": the feed tells the two apart and their file
  // marks only the called one (K/C), so a bare K is a strikeout of unknown kind. Writing
  // swinging would be inventing the half nobody wrote down.
  else if (/^K/.test(p))       { text = mods.includes('C') ? 'struck out looking' : 'struck out' }
  else if (/^(IW|I)$/.test(p)) { text = 'intentionally walked'; lands = 1 }
  else if (/^W$/.test(p))      { text = 'walked'; lands = 1 }
  else if (/^HP$/.test(p))     { text = 'hit by pitch'; lands = 1 }
  else if (/^C$/.test(p))      { text = 'reached on catcher’s interference'; lands = 1 }
  else if (/^E\d/.test(p))     { text = `reached first on an error by ${OUT_PLACE[Number(p[1])] ?? 'the defence'}`; lands = 1 }
  else if (/^FC\d*/.test(p))   { text = 'reached on a fielder’s choice'; lands = 1 }
  else if (/^\d/.test(p)) {
    if (sacFly) text = `${outText(p, mods, false)}, sacrifice fly`
    else if (sacBunt) text = 'sacrificed'
    else text = outText(p, mods, dp)
  }
  if (!text) return null

  // The feed writes "RBI" for one and "2 RBI" for more, and counts the batter's own run on a
  // home run even though `runs_scored` does not. Both halves of that are copied deliberately.
  const rbi = runs + (lands === 'H' ? 1 : 0)
  const rbiText = rbi > 1 ? `, ${rbi} RBI` : rbi === 1 ? ', RBI' : ''
  const sentence = `${batter} ${text}${rbiText}${countText(count)}.`
  const isHit = /^(S\d*|D\d*|DGR\d*|T\d*|HR\d*|H\d*)$/.test(p)
  return { sentence, runs, lands, isHit, primary: p, advance }
}

/**
 * A runner event: a steal, a pickoff, a balk, a wild pitch, a substitution.
 *
 * These are rows in the feed too, and two of the fourteen empty ones are exactly this. The
 * runner is named when the base state is known and described by base when it is not: the
 * transcription says which BASE moved, never who was standing on it.
 */
export function runnerText(event, bases) {
  const { primary: p, advance } = splitEvent(event)
  const who = (base) => bases?.[base] ?? null
  const named = (base, fallback) => who(base) ?? fallback

  let m
  if ((m = p.match(/^SB([23H])$/))) {
    const from = m[1] === '2' ? 1 : m[1] === '3' ? 2 : 3
    return `${named(from, 'A runner')} stole ${BASE_WORD[m[1]] ?? m[1]}.`
  }
  if ((m = p.match(/^CS([23H])\((\d+)\)$/)) || (m = p.match(/^CS([23H])$/))) {
    const from = m[1] === '2' ? 1 : m[1] === '3' ? 2 : 3
    const path = (m[2] ?? '').split('').map(f => THROW[Number(f)] ?? '').filter(Boolean).join(' to ')
    // The feed's own wording: "Elodie Ciamarro out at second c to ss, caught stealing."
    return `${named(from, 'A runner')} out at ${BASE_WORD[m[1]] ?? m[1]}${path ? ` ${path}` : ''}, caught stealing.`
  }
  if ((m = p.match(/^PO([123])\((\d+)\)$/)) || (m = p.match(/^PO([123])$/))) {
    const path = (m[2] ?? '').split('').map(f => THROW[Number(f)] ?? '').filter(Boolean).join(' to ')
    return `${named(Number(m[1]), 'A runner')} picked off ${BASE_WORD[m[1]]}${path ? ` ${path}` : ''}.`
  }
  if (/^WP$/.test(p)) return advanceSentence('advanced on a wild pitch', advance, bases)
  if (/^PB$/.test(p)) return advanceSentence('advanced on a passed ball', advance, bases)
  if (/^BK$/.test(p)) return advanceSentence('advanced on a balk', advance, bases)
  if (/^DI$/.test(p)) return advanceSentence('advanced on defensive indifference', advance, bases)
  if (/^OA$/.test(p)) return advanceSentence('advanced', advance, bases)
  // NP is a substitution the feed writes its own way, and there is nothing here to say about it.
  return null
}

/** "Val Perez advanced on a wild pitch." for each runner the clause moves. */
function advanceSentence(what, advance, bases) {
  const moved = advances(advance).filter(a => a.from !== 'B' && !a.out)
  if (!moved.length) return null
  return moved.map(a => {
    const who = bases?.[Number(a.from)] ?? 'A runner'
    return a.to === 'H' ? `${who} scored.` : `${who} ${what} to ${BASE_WORD[a.to]}.`
  }).join(' ')
}

/**
 * The bases through one half-inning, so a steal can name the runner on it.
 *
 * FAILS TO ANONYMOUS RATHER THAN TO WRONG. The moment an event moves a runner in a way this does
 * not read, the state is dropped for the rest of the half-inning and every later sentence says
 * "A runner" instead of a name. A wrong name on a play is worse than no name: it is a fact the
 * reader has no reason to doubt.
 */
export function trackBases(plays, nameOf) {
  const states = []
  let bases = { 1: null, 2: null, 3: null }
  let trusted = true
  for (const play of plays) {
    states.push(trusted ? { ...bases } : null)
    if (!trusted) continue
    const batter = nameOf(play.batterId)
    const { primary: p, advance } = splitEvent(play.event)
    const next = { ...bases }
    const moves = advances(advance)
    // Advancement describes the state BEFORE the play, so runners move out of their bases first.
    for (const a of moves) {
      if (a.from === 'B') continue
      const from = Number(a.from)
      if (bases[from]) next[from] = next[from] === bases[from] ? null : next[from]
    }
    for (const a of moves) {
      if (a.from === 'B' || a.out || a.to === 'H') continue
      const runner = bases[Number(a.from)]
      if (runner) next[Number(a.to)] = runner
    }
    // Then the batter, wherever this play leaves her.
    const bClause = moves.find(a => a.from === 'B')
    const hit = batterText(play.event, batter)
    if (bClause) { if (!bClause.out && bClause.to !== 'H') next[Number(bClause.to)] = batter }
    else if (hit?.lands && hit.lands !== 'H') next[hit.lands] = batter
    // Steals and pickoffs move a runner without a batting event of their own.
    let m
    if ((m = p.match(/^SB([23H])$/))) {
      const from = m[1] === '2' ? 1 : m[1] === '3' ? 2 : 3
      const to = m[1] === 'H' ? null : Number(m[1])
      if (to) next[to] = bases[from]
      next[from] = next[from] === bases[from] ? null : next[from]
    } else if ((m = p.match(/^CS([23H])/)) || (m = p.match(/^PO([123])/))) {
      const from = p.startsWith('PO') ? Number(m[1]) : (m[1] === '2' ? 1 : m[1] === '3' ? 2 : 3)
      next[from] = next[from] === bases[from] ? null : next[from]
    } else if (!hit && !/^(NP|WP|PB|BK|DI|OA|FLE\d)$/.test(p)) {
      // An event this file does not read. Stop naming runners rather than guess from a state
      // that may already be wrong.
      trusted = false
    }
    bases = next
  }
  return states
}

// ─── Their game against ours ──────────────────────────────────────────────────

const OUR_PLAYS_SQL = `
  select g.id as game_id, g.game_date::text as game_date, g.home_team_id, g.away_team_id,
         p.sequence, p.inning, p.half, p.batter_name, p.batter_id, p.narrative, p.event_type
  from wpbl_game_plays p
  join wpbl_games g on g.id = p.game_id
  where g.status = 'final'
  order by g.game_date, p.sequence`

// PA rather than at-bats, and the same sum plateAppearances() uses in stats.ts: `sh` is on the
// line and belongs here, so a bunt is not mistaken for never having batted.
const ROSTER_SQL = `
  select b.game_id, b.player_id, pl.name,
         coalesce(b.ab,0) + coalesce(b.bb,0) + coalesce(b.hbp,0) + coalesce(b.sf,0) + coalesce(b.sh,0) as pa
  from wpbl_batting_lines b
  join wpbl_players pl on pl.id = b.player_id`

const EXISTING_SQL = 'select game_id, sequence, field from wpbl_play_corrections'

/**
 * The event types that ARE a plate appearance, which is the only kind of row a batter's name is
 * a claim about.
 *
 * A pinch runner with no at-bat is the subject of a stolen base, a pickoff and a wild pitch, and
 * her box-score line correctly reads 0 for 0. Without this, "the box score says she never batted"
 * fires on every one of those rows and calls a correct one impossible: it flagged four across
 * Aug 1 and Aug 9 before the set existed. `unknown` is out for the same reason, since it is what
 * the feed puts on a substitution announcement.
 */
const PA_EVENTS = new Set([
  'single', 'double', 'triple', 'home_run', 'walk', 'strikeout', 'hit_by_pitch',
  'groundout', 'flyout', 'popup', 'lineout', 'foul_out', 'out', 'fielders_choice', 'sacrifice',
])

/** An empty row: what the league published when its scorer typed nothing. */
const isBlank = (row) => !String(row.narrative ?? '').trim() && !row.batter_id

/**
 * Build every correction this run would write.
 *
 * Pure so the alignment gates are testable without a database, which is the half of this job
 * that can do damage.
 */
export function planCorrections({ ourPlays, theirGame, roster, existing }) {
  const out = [], skipped = []
  const nameOf = (id) => theirGame.names.get(id) ?? id
  const paOf = (name) => roster.get(normName(name))?.pa ?? null
  const byHalf = new Map()
  for (const row of ourPlays) {
    const k = `${row.inning}|${row.half}`
    ;(byHalf.get(k) ?? byHalf.set(k, []).get(k)).push(row)
  }
  const theirHalves = new Map()
  for (const p of theirGame.plays) {
    const k = `${p.inning}|${p.side === 0 ? 'top' : 'bottom'}`
    ;(theirHalves.get(k) ?? theirHalves.set(k, []).get(k)).push(p)
  }
  // Everyone our log has batting anywhere in this game, which is how a replacement is shown to be
  // missing rather than merely elsewhere.
  const batsSomewhere = new Set(ourPlays.filter(r => r.batter_name).map(r => normName(r.batter_name)))

  const push = (row, field, oldValue, newValue, reason, source) => {
    if (existing.has(`${row.game_id}:${row.sequence}:${field}`)) return
    out.push({
      game_id: row.game_id, sequence: row.sequence, field,
      old_value: oldValue === '' || oldValue == null ? null : String(oldValue),
      new_value: newValue, reason, source,
    })
  }

  for (const [k, ours] of byHalf) {
    const theirs = theirHalves.get(k) ?? []
    const half = k.replace('|', ' ')

    // ── Pass one: a batter the league's own box score rules out ───────────────
    //
    // NO INDEX ALIGNMENT HERE, and that is the point. Our log carries rows their file does not
    // (a substitution announcement, a runner advancing), so the two lists routinely differ in
    // length in a half-inning where nothing is wrong: New York's fifth on Aug 27 is 11 rows
    // against their 10, and the strikeout that needs a name is inside it. This pass identifies
    // the play by what it WAS rather than by where it sits: their play in the same half-inning
    // whose event is the same kind, whose batter the box score says did bat, and who our log has
    // nowhere in the game. One candidate or nothing.
    for (const row of ours) {
      if (!row.batter_name || !PA_EVENTS.has(row.event_type) || paOf(row.batter_name) !== 0) continue
      const candidates = theirs.filter(t => {
        const name = nameOf(t.batterId)
        return eventType(t.event) === row.event_type
          && (paOf(name) ?? 0) > 0
          && !batsSomewhere.has(normName(name))
      })
      const unique = new Set(candidates.map(t => normName(nameOf(t.batterId))))
      if (unique.size !== 1) {
        skipped.push({ half: k, why: `row ${row.sequence}: ${row.batter_name} has no plate appearance in the box score, and ${unique.size === 0 ? 'nobody' : `${unique.size} players`} in their ${half} fits the play` })
        continue
      }
      const line = roster.get([...unique][0])
      const reason = `The league's own box score gives ${row.batter_name} no plate appearance in this game, so this play `
        + `cannot be hers. ${line.name} has the at-bats and no plays at all, the event matches, and RetroWPBL names her `
        + `(${theirGame.id}, ${half}). The play is unchanged: only the batter on it. Not a second opinion on the league's `
        + `scoring, an internal contradiction in it.`
      push(row, 'batter_name', row.batter_name, line.name, reason, 'league')
      push(row, 'batter_id', row.batter_id ?? '', line.id, reason, 'league')
      if (row.narrative && row.narrative.includes(row.batter_name)) {
        push(row, 'narrative', row.narrative, row.narrative.split(row.batter_name).join(line.name), reason, 'league')
      }
    }

    // ── Pass two: rows the league published empty ─────────────────────────────
    if (!ours.some(isBlank)) continue
    if (theirs.length !== ours.length) {
      skipped.push({ half: k, why: `${ours.length} plays here, ${theirs.length} in theirs` })
      continue
    }
    // The free checksum: every row we DO have must name their batter at the same index. A row
    // pass one is already fixing is exempt, since its name is the thing being corrected.
    const fixing = new Set(out.filter(c => c.field === 'batter_name').map(c => c.sequence))
    const mismatch = ours.findIndex((row, i) => !isBlank(row) && row.batter_name
      && !fixing.has(row.sequence)
      && normName(row.batter_name) !== normName(nameOf(theirs[i].batterId)))
    if (mismatch > -1) {
      skipped.push({ half: k, why: `row ${ours[mismatch].sequence} is ${ours[mismatch].batter_name}, theirs is ${nameOf(theirs[mismatch].batterId)}` })
      continue
    }
    const states = trackBases(theirs, nameOf)
    ours.forEach((row, i) => {
      if (!isBlank(row)) return
      const play = theirs[i]
      const batter = nameOf(play.batterId)
      const hit = batterText(play.event, batter, play.count)
      const runner = hit ? null : runnerText(play.event, states[i])
      const sentence = hit?.sentence ?? runner
      if (!sentence) { skipped.push({ half: k, why: `row ${row.sequence}: cannot read "${play.event}"` }); return }
      const playerId = hit ? (roster.get(normName(batter))?.id ?? null) : null
      if (hit && !playerId) { skipped.push({ half: k, why: `row ${row.sequence}: ${batter} is not on that box score` }); return }
      const reason = `The league published this play with no batter, no event and no narrative; `
        + `RetroWPBL has it as "${play.event}" (${theirGame.id}, ${half}). `
        + `Filled from their transcription because an empty row is an absent account rather than a competing one.`
      const fields = [['narrative', row.narrative ?? '', sentence]]
      const kind = eventType(play.event)
      if (kind && kind !== row.event_type) fields.push(['event_type', row.event_type ?? '', kind])
      if (hit) {
        fields.push(['batter_name', row.batter_name ?? '', batter])
        if (playerId) fields.push(['batter_id', row.batter_id ?? '', playerId])
        if (hit.isHit) fields.push(['is_hit', 'false', 'true'])
        // `is_scoring_play` is not a second opinion on `runs_scored`, it is the same number said
        // twice: across every stored play it is exactly `runs_scored > 0` (CLAUDE.md). Setting
        // one and not the other would put a disagreement into the data that the feed never has.
        if (hit.runs > 0) {
          fields.push(['runs_scored', '0', String(hit.runs)])
          fields.push(['is_scoring_play', 'false', 'true'])
        }
      }
      // `source` is a checked enum: video, derived, external or league. A hand transcription is
      // external, the same value the two corrections written before this job carry, and the
      // reason line names RetroWPBL and the game so the row says where it came from.
      for (const [field, oldValue, newValue] of fields) push(row, field, oldValue, newValue, reason, 'external')
    })
  }
  return { corrections: out, skipped }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.SUPABASE_DB_URL
  if (!url) {
    console.error('SUPABASE_DB_URL is not set. Run with: node --env-file=.env scripts/fill-wpbl-play-gaps.mjs')
    process.exit(2)
  }

  const files = await Promise.all(EVENT_FILES.map(f => fetchText(`${RAW}/events/${f}`)))
  const theirGames = files.flatMap(parseGames)
  const byKey = new Map()
  for (const g of theirGames) {
    const date = (g.info.date ?? '').replace(/\//g, '-')
    const home = TEAM_CODES[(g.info.hometeam ?? '').trim()] ?? null
    if (date && home) byKey.set(`${date}|${home}`, g)
  }

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  const [plays, rosters, existingRows] = await Promise.all([
    client.query(OUR_PLAYS_SQL), client.query(ROSTER_SQL), client.query(EXISTING_SQL),
  ])
  const existing = new Set(existingRows.rows.map(r => `${r.game_id}:${r.sequence}:${r.field}`))
  const rosterByGame = new Map()
  for (const r of rosters.rows) {
    const m = rosterByGame.get(r.game_id) ?? rosterByGame.set(r.game_id, new Map()).get(r.game_id)
    m.set(normName(r.name), { id: r.player_id, name: r.name, pa: Number(r.pa) })
  }
  const ourByGame = new Map()
  for (const r of plays.rows) {
    (ourByGame.get(r.game_id) ?? ourByGame.set(r.game_id, []).get(r.game_id)).push(r)
  }

  const all = [], allSkipped = []
  let considered = 0, notTranscribed = 0
  for (const [gameId, rows] of ourByGame) {
    const roster = rosterByGame.get(gameId) ?? new Map()
    // Every game with something this job could fix: a row the league published empty, or a row
    // whose batter its own box score says never batted.
    const fixable = rows.some(isBlank)
      || rows.some(r => r.batter_name && PA_EVENTS.has(r.event_type)
        && roster.get(normName(r.batter_name))?.pa === 0)
    if (!fixable) continue
    const { game_date: date, home_team_id: home } = rows[0]
    if (ONE_DATE && date !== ONE_DATE) continue
    considered++
    const theirGame = byKey.get(`${date}|${home}`)
    if (!theirGame) { notTranscribed++; allSkipped.push({ game: `${date} ${home}`, why: 'not transcribed by RetroWPBL' }); continue }
    const { corrections, skipped } = planCorrections({ ourPlays: rows, theirGame, roster, existing })
    for (const c of corrections) all.push({ ...c, date, home })
    for (const s of skipped) allSkipped.push({ game: `${date} ${home}`, ...s })
  }

  console.log(`${considered} game(s) hold a play worth filling or a batter the box score rules out.`
    + (notTranscribed ? ` ${notTranscribed} of them are not transcribed yet.` : ''))
  for (const c of all) console.log(`  ${c.date} ${c.home} seq ${c.sequence} ${c.field} <- ${c.new_value}`)
  for (const s of allSkipped) console.log(`  skipped ${s.game}${s.half ? ` ${s.half.replace('|', ' ')}` : ''}: ${s.why}`)

  if (!all.length) { console.log('Nothing to write.'); await client.end(); return }
  if (DRY_RUN) { console.log(`\nDry run: ${all.length} correction(s) not written.`); await client.end(); return }

  for (const c of all) {
    await client.query(
      `insert into public.wpbl_play_corrections (game_id, sequence, field, old_value, new_value, reason, source)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (game_id, sequence, field) do nothing`,
      [c.game_id, c.sequence, c.field, c.old_value, c.new_value, c.reason, c.source],
    )
  }
  console.log(`\nWrote ${all.length} correction(s).`)
  await client.end()
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err.message); process.exit(1) })
}
