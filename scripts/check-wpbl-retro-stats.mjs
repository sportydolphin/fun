#!/usr/bin/env node
/**
 * check-wpbl-retro-stats.mjs: audit our batting lines against an independent transcription.
 *
 * WHY THIS AND NOT BASEBALL REFERENCE. BR added the WPBL to its register in Aug 2026, which
 * makes it the obvious third opinion, and it is not usable as one: their whole network answers
 * 403 to an automated fetcher and their terms forbid automated collection. Driving a browser at
 * it would be stepping around a block someone deliberately put up. There is also a question of
 * what it would prove: the league's own games carry `provider: "presto"`, and if BR's register
 * data comes from Presto too then agreement shows two parties ingested one feed the same way,
 * not that the feed is right.
 *
 * RetroWPBL (github.com/exu6jh/RetroWPBL, used with the transcriber's permission, granted
 * Aug 21, 2026) is the one source that is NOT downstream of that feed. It is one person watching
 * games and writing Retrosheet event files by hand, so where it agrees with us, two independent
 * readings of the same game agree; where it does not, one of them watched something the other
 * did not. That is the only check here that can catch an error the league itself made, which is
 * the class §8 of docs/PLAY_VALIDATION.md says nothing else can see.
 *
 * WHAT IT DOES NOT DO IS STORE ANY OF IT. `sync-wpbl-retro` deliberately mirrors only the `info`
 * records, because a second copy of the play-by-play would be a second truth with no way for a
 * reader to know which one they were looking at. This script holds their plays for as long as it
 * takes to add them up and then throws them away: it writes nothing, and its output is a
 * disagreement to go and look at, never a correction to apply.
 *
 * THE STAT SET IS DELIBERATELY NARROW. Plate appearances, at-bats, hits, doubles, triples, home
 * runs, walks, strikeouts and hit-by-pitch: everything whose Retrosheet event maps to it without
 * a judgement call. RBI is derived too but reported separately, because it depends on the
 * transcriber's `(RBI)` annotation rather than on the event code, and an annotation is a thing a
 * human can forget in a way that a `D7` is not.
 *
 * THE SOURCE LAGS AND THAT IS NORMAL. One person cannot transcribe as fast as four clubs play.
 * A game they have not written up yet is skipped and counted, never reported as a disagreement.
 *
 * Usage:
 *   node --env-file=.env scripts/check-wpbl-retro-stats.mjs
 *   node --env-file=.env scripts/check-wpbl-retro-stats.mjs --game 2026-08-20
 *   node --env-file=.env scripts/check-wpbl-retro-stats.mjs --json
 *
 * Needs SUPABASE_DB_URL. Exits 1 when anything disagrees. npm script: npm run check-retro
 */

import pg from 'pg'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const RAW = 'https://raw.githubusercontent.com/exu6jh/RetroWPBL/main'
const EVENT_FILES = ['2026BSH.EVW', '2026LAQ.EVW', '2026NYH.EVW', '2026SFF.EVW']
/** Their club codes to ours. Hard-coded for the reason sync-wpbl-retro hard-codes it: four
 *  clubs, and a wrong guess silently attributes one club's game to another. */
const TEAM_CODES = Object.freeze({ BSH: 'BOS', LAQ: 'LA', NYH: 'NY', SFF: 'SF' })

const JSON_OUT = process.argv.includes('--json')
const UPDATE_BASELINE = process.argv.includes('--update-baseline')
const baseIx = process.argv.indexOf('--baseline')
const BASELINE = baseIx > -1 ? process.argv[baseIx + 1] : null
const gameIx = process.argv.indexOf('--game')
const ONE_DATE = gameIx > -1 ? process.argv[gameIx + 1] : null

/** Accents off, case folded, spaces collapsed. Mirrors `normName` in the ingest's names.ts;
 *  the two are not shared because that file is Deno-side and type-annotated. */
const normName = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim()

// ─── the event grammar, as it is actually used ────────────────────────────────
//
// Measured over all 2,099 play records in the four files rather than implemented from the
// Retrosheet spec, which is far larger than this transcription uses. The whole vocabulary:
// fielded outs (`63`, `8`), S/D/DGR/HR, K, W, I, HP, E, FC, C, and the baserunning events
// NP/SB/CS/PO/POCS/WP/PB/BK/OA. There are no triples in the season so far; `T` is handled
// anyway, because the day one is hit is not the day to discover it was missing.

/** Events that are not a plate appearance: the batter is still at the plate afterwards. */
const NOT_A_PA = /^(NP|SB[23H]|CS[23H]|PO[123]|POCS[23H]|WP|PB|BK|OA|DI|FLE)/

/**
 * One Retrosheet event to the batting counters it is worth. Null when the record is not a
 * plate appearance at all.
 *
 * Returns `unknown: true` rather than guessing when the primary token is not one we recognise.
 * An unrecognised event silently scored as an out would make this whole check quietly wrong in
 * the direction of agreeing with us, which is the direction that teaches nobody anything.
 */
export function batting(eventRaw) {
  // Retrosheet allows `!` (great play), `?` (uncertain) and `#` (unusual) anywhere; none of
  // them change what happened.
  let ev = String(eventRaw ?? '').replace(/[!?#]/g, '').trim()
  if (!ev) return null

  // `K+SB2` is a strikeout AND a steal on the same pitch: the batter's half is before the `+`.
  const plus = ev.indexOf('+')
  if (plus > -1) ev = ev.slice(0, plus)

  // Advancement (`.3-H(RBI);2-H`) is everything after the first `.` outside parentheses.
  let depth = 0, dot = -1
  for (let i = 0; i < ev.length; i++) {
    const ch = ev[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === '.' && depth === 0) { dot = i; break }
  }
  const advance = dot > -1 ? ev.slice(dot + 1) : ''
  const beforeAdvance = dot > -1 ? ev.slice(0, dot) : ev

  const [primaryRaw, ...mods] = beforeAdvance.split('/')
  const primary = primaryRaw.trim()
  if (!primary || NOT_A_PA.test(primary)) return null

  const mod = mods.join('/')
  const sf = /\bSF\b/.test(mod)
  const sh = /\bSH\b/.test(mod)
  // The transcriber marks every run in the advancement, so RBI is countable. On a home run the
  // batter's own run is not in the advancement, and is added back here for the same reason
  // `runsOnPlay()` exists on our side: a solo home run's advancement is empty.
  const rbi = (advance.match(/\(RBI\)/g) ?? []).length

  const z = { pa: 1, ab: 0, h: 0, b2: 0, b3: 0, hr: 0, bb: 0, so: 0, hbp: 0, sf: 0, sh: 0, rbi, unknown: false }
  if (sf) z.sf = 1
  if (sh) z.sh = 1

  if (/^S\d*$/.test(primary))              { z.ab = 1; z.h = 1 }
  else if (/^(D\d*|DGR)$/.test(primary))   { z.ab = 1; z.h = 1; z.b2 = 1 }
  else if (/^T\d*$/.test(primary))         { z.ab = 1; z.h = 1; z.b3 = 1 }
  else if (/^(HR|H)\d*$/.test(primary))    { z.ab = 1; z.h = 1; z.hr = 1; z.rbi += 1 }
  else if (/^K/.test(primary))             { z.ab = 1; z.so = 1 }
  else if (/^(W|IW|I)$/.test(primary))     { z.bb = 1 }
  else if (/^HP$/.test(primary))           { z.hbp = 1 }
  else if (/^C$/.test(primary))            { /* catcher's interference: PA, not an at-bat */ }
  else if (/^E\d/.test(primary))           { z.ab = 1 }
  else if (/^FC\d*/.test(primary))         { z.ab = 1 }
  else if (/^\d+/.test(primary))           { if (!sf && !sh) z.ab = 1 }   // fielded out, incl. `3E1`
  else                                     { z.unknown = true }
  return z
}

/**
 * Split an event file into games, keeping the id, the info block, the id-to-name table the
 * `start` and `sub` records carry, and the plays.
 *
 * Names come from the event file itself rather than from their biofile, because the file is
 * self-describing (`start,yonen201,"Natsuki Yonetani",0,1,9`) and a second source could only
 * disagree with it.
 */
export function parseGames(text) {
  const games = []
  let g = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('id,')) {
      if (g) games.push(g)
      g = { id: line.slice(3).trim(), info: {}, names: new Map(), plays: [] }
      continue
    }
    if (!g) continue
    if (line.startsWith('info,')) {
      const rest = line.slice(5), c = rest.indexOf(',')
      if (c > -1) g.info[rest.slice(0, c).trim()] = rest.slice(c + 1).trim()
    } else if (line.startsWith('start,') || line.startsWith('sub,')) {
      const cells = line.split(',')
      const id = (cells[1] ?? '').trim()
      const name = (cells[2] ?? '').replace(/^"|"$/g, '').trim()
      if (id && name) g.names.set(id, name)
    } else if (line.startsWith('play,')) {
      // play,inning,half,batterId,count,pitches,event  — the event may itself contain commas
      // inside parentheses, so take everything from the 7th field on.
      const cells = line.split(',')
      if (cells.length >= 7) g.plays.push({ batterId: (cells[3] ?? '').trim(), event: cells.slice(6).join(',') })
    }
  }
  if (g) games.push(g)
  return games
}

/**
 * Their game to per-batter totals, keyed by normalized name.
 *
 * `names` is the whole FILE's id-to-name table, not the one game's. A club's event file carries
 * one `start` record per player per game, but a substitute who entered as a pinch runner and
 * later batted can appear in the plays of a game whose own `start` and `sub` lines never named
 * her. Left to the single game the report printed a Retrosheet id where a person's name goes
 * ("eynon201"), which reads as a fault in the transcription rather than in this script.
 */
export function battingFromGame(game, names = game.names) {
  const out = new Map()
  const unknown = []
  for (const p of game.plays) {
    const z = batting(p.event)
    if (!z) continue
    if (z.unknown) { unknown.push(p.event); continue }
    // An id nothing ever names is a typo in their file, and it matters that the report says so:
    // Caitlin Eynon is `eynoc201`, one Aug 22 play carries `eynon201`, and the effect is that
    // her game is split across two people. Reported as an unnamed id, the pair of findings reads
    // as one transcription slip. Reported as a mystery player, it reads as a missing batter.
    const known = game.names.get(p.batterId) ?? names.get(p.batterId)
    const name = known ?? `${p.batterId} (unnamed id in their file)`
    const key = normName(name)
    const cur = out.get(key) ?? { name, pa: 0, ab: 0, h: 0, b2: 0, b3: 0, hr: 0, bb: 0, so: 0, hbp: 0, rbi: 0 }
    for (const k of ['pa', 'ab', 'h', 'b2', 'b3', 'hr', 'bb', 'so', 'hbp', 'rbi']) cur[k] += z[k]
    out.set(key, cur)
  }
  return { batters: out, unknown }
}

/** The fields compared, and the label each gets in the report. */
const FIELDS = [
  ['pa', 'PA'], ['ab', 'AB'], ['h', 'H'], ['b2', '2B'], ['b3', '3B'],
  ['hr', 'HR'], ['bb', 'BB'], ['so', 'SO'], ['hbp', 'HBP'],
]

/** Surname plus first initial, which is how the same person survives a nickname. */
const initialKey = (name) => {
  const parts = normName(name).split(' ').filter(Boolean)
  if (parts.length < 2) return null
  return `${parts[parts.length - 1]}|${parts[0][0]}`
}

/**
 * Pair the two readings up by player.
 *
 * TWO THINGS MADE THE FIRST RUN UNREADABLE, and neither was a scoring disagreement.
 *
 * Our box score carries a LINE for everyone the feed lists, including a pitcher who never came
 * to the plate and a substitute who did not bat: `wpbl_batting_lines` stores a row whenever
 * there is a lineup spot, so those people exist here with nothing but zeros. They cannot appear
 * in a transcription of the plays because they never took one. Anyone with no plate appearance
 * on our side is therefore not a missing batter, and comparing them produced 30-odd findings a
 * night that were all the same non-fact.
 *
 * And the transcriber writes the name people use. "Addie Frank" and "Adelaide Frank" are one
 * player; so are "Britt" and "Brittany" Apgar. Matching on the full string reported each of them
 * TWICE, once as missing from each side, which is the most misleading shape a false positive
 * can take: it looks like two different errors. Surname plus first initial pairs them, and is
 * only trusted when it is unambiguous on both sides within the one game, since the fallback
 * exists to survive a nickname and not to guess between two people.
 */
export function pairBatters(theirs, ours) {
  const oursBatted = new Map([...ours].filter(([, o]) => Number(o.pa) > 0))
  const pairs = [], unmatchedOurs = new Set(oursBatted.keys())

  const byInitial = new Map()
  for (const [k, o] of oursBatted) {
    const ik = initialKey(o.name)
    if (!ik) continue
    byInitial.set(ik, byInitial.has(ik) ? null : k)   // null marks an ambiguous key
  }
  const theirInitials = new Map()
  for (const [, t] of theirs) {
    const ik = initialKey(t.name)
    if (!ik) continue
    theirInitials.set(ik, theirInitials.has(ik) ? null : true)
  }

  for (const [k, t] of theirs) {
    if (oursBatted.has(k)) { pairs.push([t, oursBatted.get(k)]); unmatchedOurs.delete(k); continue }
    const ik = initialKey(t.name)
    const mate = ik && theirInitials.get(ik) && byInitial.get(ik)
    if (mate && unmatchedOurs.has(mate)) {
      pairs.push([t, oursBatted.get(mate)]); unmatchedOurs.delete(mate); continue
    }
    pairs.push([t, null])
  }
  for (const k of unmatchedOurs) pairs.push([null, oursBatted.get(k)])
  return pairs
}

/** One game's two readings into a list of disagreements. Pure, so it can be tested without a
 *  network or a database. */
export function diffBatters(theirs, ours) {
  const findings = []
  for (const [t, o] of pairBatters(theirs, ours)) {
    if (!t) { findings.push({ player: o.name, issue: 'batted in our box score, absent from their transcription' }); continue }
    if (!o) { findings.push({ player: t.name, issue: 'in their transcription, not in our box score' }); continue }
    const bad = FIELDS.filter(([f]) => Number(t[f]) !== Number(o[f]))
      .map(([f, label]) => `${label} theirs ${t[f]} ours ${o[f]}`)
    // RBI is reported but never on its own: it rests on an annotation rather than on the event
    // code, so a lone RBI gap is likelier to be a missed `(RBI)` than a scoring error.
    if (bad.length) {
      if (Number(t.rbi) !== Number(o.rbi)) bad.push(`RBI theirs ${t.rbi} ours ${o.rbi}`)
      findings.push({ player: o.name, issue: bad.join(', ') })
    }
  }
  return findings.sort((a, b) => a.player.localeCompare(b.player))
}

const OURS_SQL = `
  select g.game_date::text as game_date, g.home_team_id, p.name,
         sum(b.ab + b.bb + b.hbp + b.sf + b.sh) as pa,
         sum(b.ab) ab, sum(b.h) h, sum(b.doubles) b2, sum(b.triples) b3, sum(b.hr) hr,
         sum(b.bb) bb, sum(b.so) so, sum(b.hbp) hbp, sum(b.rbi) rbi
  from wpbl_batting_lines b
  join wpbl_games g on g.id = b.game_id
  join wpbl_players p on p.id = b.player_id
  where g.status = 'final'
  group by 1, 2, 3`

const fetchText = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'sportydolphin.fun retro stats check' } })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.text()
}

async function main() {
  const url = process.env.SUPABASE_DB_URL
  if (!url) {
    console.error('SUPABASE_DB_URL is not set. Run with: node --env-file=.env scripts/check-wpbl-retro-stats.mjs')
    process.exit(2)
  }

  const files = await Promise.all(EVENT_FILES.map(f => fetchText(`${RAW}/events/${f}`)))
  const theirGames = files.flatMap(parseGames)
  // One id-to-name table over every game in every file: a player keeps her id all season, and
  // the game that happens to name her is not always the game she appears in.
  const allNames = new Map()
  for (const g of theirGames) for (const [id, nm] of g.names) if (!allNames.has(id)) allNames.set(id, nm)

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  const { rows } = await client.query(OURS_SQL)
  await client.end()

  // Ours, bucketed the way their game ids are keyed: date plus home club. Unique in a league
  // that plays every game at one park, and the same match rule sync-wpbl-retro uses.
  const ourGames = new Map()
  for (const r of rows) {
    const key = `${r.game_date}|${r.home_team_id}`
    const m = ourGames.get(key) ?? new Map()
    m.set(normName(r.name), { name: r.name, ...r })
    ourGames.set(key, m)
  }

  const report = []
  let compared = 0, notTranscribed = 0, unknownEvents = []
  for (const g of theirGames) {
    const date = (g.info.date ?? '').replace(/\//g, '-')
    const home = TEAM_CODES[g.info.hometeam ?? '']
    if (!date || !home) continue
    if (ONE_DATE && date !== ONE_DATE) continue
    const ours = ourGames.get(`${date}|${home}`)
    if (!ours) { notTranscribed++; continue }
    compared++
    const { batters, unknown } = battingFromGame(g, allNames)
    if (unknown.length) unknownEvents.push({ game: g.id, events: [...new Set(unknown)] })
    const findings = diffBatters(batters, ours)
    if (findings.length) report.push({ game: g.id, date, home, findings })
  }

  // THE BASELINE, FOR THE REASON THE PLAY-BY-PLAY VALIDATOR HAS ONE. Two people watching the
  // same game will always disagree about something, so run unattended this reports the same
  // eighteen things every night and is ignored inside a week. A finding's identity is the game
  // plus the player plus the exact disagreement, all of which are stable: the same underlying
  // slip fingerprints identically tomorrow, and a genuinely new one cannot collide with an
  // accepted one. Triage a finding, then --update-baseline to accept it.
  const fingerprint = (g, f) => `${g.game}:${f.player}:${f.issue}`
  const current = new Set()
  for (const g of report) for (const f of g.findings) current.add(fingerprint(g, f))

  if (UPDATE_BASELINE) {
    if (!BASELINE) { console.error('--update-baseline needs --baseline <file>'); process.exit(2) }
    fs.writeFileSync(BASELINE, JSON.stringify({ updated_at: new Date().toISOString(), accepted: [...current] }, null, 2) + '\n')
    console.log(`Baseline written: ${current.size} findings accepted in ${BASELINE}`)
    process.exit(0)
  }

  let accepted = new Set()
  if (BASELINE && fs.existsSync(BASELINE)) {
    accepted = new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).accepted ?? [])
  }
  const fresh = BASELINE
    ? report.map(g => ({ ...g, findings: g.findings.filter(f => !accepted.has(fingerprint(g, f))) })).filter(g => g.findings.length)
    : report

  if (JSON_OUT) {
    console.log(JSON.stringify({ generated_at: new Date().toISOString(), compared, report: fresh, unknownEvents }, null, 2))
  } else {
    console.log(`Compared ${compared} games against RetroWPBL.` +
      (notTranscribed ? ` ${notTranscribed} of their games matched none of ours.` : ''))
    for (const u of unknownEvents) {
      console.log(`\n  ${u.game}: event codes this script does not know: ${u.events.join(', ')}`)
    }
    for (const r of fresh) {
      console.log(`\n  ${r.date}  ${r.game}`)
      for (const f of r.findings) console.log(`    ${f.player.padEnd(30)} ${f.issue}`)
    }
    const n = fresh.reduce((a, r) => a + r.findings.length, 0)
    console.log(n ? `\n${n} disagreement(s) across ${fresh.length} game(s). Two readings of one game; check the video before believing either.`
      : '\nEvery batter agrees, in every game they have transcribed.')
    if (accepted.size) console.log(`Baseline: ${accepted.size} already accepted and not shown.`)
  }
  process.exit(fresh.length || unknownEvents.length ? 1 : 0)
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err); process.exit(2) })
}
