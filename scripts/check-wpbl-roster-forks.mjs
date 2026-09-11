#!/usr/bin/env node
/**
 * check-wpbl-roster-forks.mjs: has the ingest split one player into two?
 *
 * WHY THIS EXISTS, AND THE DAY IT WOULD HAVE EARNED ITS KEEP. On Sep 10, 2026 the league
 * published New York's postseason box score with Claire O'Sullivan's first name as CATHERINE,
 * under a feed player id nobody had seen before. Postseason ids are minted fresh per context
 * (see CLAUDE.md), so the ingest fell back to matching on (club, name), "Catherine O'Sullivan"
 * matched nobody, and it inserted a new player. Her game went under the new row: three at-bats,
 * a walk and an RBI, missing from the player the site knows, plus a second player page under a
 * name no fan recognises. Nothing went red. A READER told us.
 *
 * THE FIX IS NOT A LOOSER MATCHER, which is the thing to understand before touching this.
 * `matchFeedName` in src/wpbl/feedNames.ts already handles a feed that spells a name
 * differently: it takes a prefix or a single edit on each half of the name, which is how "Emi
 * Saki" finds Emi Saiki. Catherine and Claire are four edits apart. The only way to match them
 * automatically is to accept on the surname and the club alone, and that is precisely the guess
 * a name resolver must never make: two real teammates who share a surname would be welded into
 * one person, silently, and the evidence that they were ever two would be gone.
 *
 * So the rule this file applies is the SAME rule, and it stops one step short of acting on it.
 * A club with two players sharing a surname is either a fork or a coincidence, a machine cannot
 * tell which, and a person can tell instantly. It prints what it found and goes red.
 *
 * WHY THE SIGNAL IS CLEAN. Across the 118 players on the roster there are six shared surnames
 * (Hastings, Kim, O'Sullivan, Park, Reynolds, Yamamoto) and every single pair is split across
 * two different clubs. Not one club carries two players with the same surname. So there is no
 * baseline file and no allowlist here: the expected output is nothing at all, on every ordinary
 * day, and anything it prints is worth a person's minute. If the league ever signs a genuine
 * pair of teammates who share a surname, this fires once and the answer is to add them to
 * KNOWN_PAIRS below with the date and the reason, not to widen the rule.
 *
 * WHAT IT PRINTS BESIDES THE NAMES, because a person deciding needs more than a coincidence:
 *
 *   • WHEN EACH ROW WAS CREATED. A fork is born mid-season, hours after a game. A real signing
 *     arrives with the rest of a roster import.
 *   • HOW MANY GAMES EACH HAS. The Catherine row had one line against Claire's thirteen.
 *   • WHETHER THEY HAVE EVER SHARED A BOX SCORE. This is the strongest of the three and the
 *     only one that can be conclusive on its own: two real teammates turn up in the same game
 *     eventually, and a fork NEVER can, because the feed lists one of them per game by
 *     construction. It cannot prove a fork early (a genuine pair have not shared a box score
 *     on their first day either), which is why it is reported rather than acted on.
 *
 * IT WRITES NOTHING. The repair is `wpbl_merge_players(keep, dupe)`, which absorbs the
 * duplicate's feed ids so the next pass resolves to the surviving row instead of forking
 * again. Running it is a person's call: it deletes a row, and on the one occasion the answer
 * is "those really are two players" the correct action is the opposite of a merge.
 *
 * Usage:
 *   node --env-file=.env scripts/check-wpbl-roster-forks.mjs
 *   node --env-file=.env scripts/check-wpbl-roster-forks.mjs --json
 *
 * Needs SUPABASE_DB_URL. Reads only. Exits 1 when a club carries two of a surname, 0 otherwise,
 * 2 when it could not run at all. npm script: npm run check-roster-forks
 */

import pg from 'pg'
import { pathToFileURL } from 'node:url'

const JSON_OUT = process.argv.includes('--json')

/**
 * Pairs a person has already looked at and ruled a coincidence.
 *
 * Empty, and that is the whole point of the note above: no club has two of a surname today.
 * An entry is two player uuids, the date somebody checked, and why. Never add a pair to quiet
 * a red run without checking it: the one this file was written for looked exactly like a
 * coincidence and was not.
 */
const KNOWN_PAIRS = Object.freeze([
  // ['<uuid>', '<uuid>', '2026-09-11', 'Both real: sisters, both signed in the draft.'],
])

/** Accents off, punctuation out, case folded. Mirrors `normalizeName` in src/wpbl/playerSearch.ts;
 *  they are not shared because that file is app-side TypeScript and this runs as a bare script. */
const norm = (s) => (s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[.'’`]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Everything after the given name. Kept whole so "del Castillo" and "Day Bedard" stay one
 *  surname rather than becoming a last word that two unrelated people could share. */
const surnameOf = (name) => {
  const parts = norm(name).split(' ')
  return parts.length < 2 ? parts.join(' ') : parts.slice(1).join(' ')
}

const pairKey = (a, b) => [a, b].sort().join('|')
const KNOWN = new Set(KNOWN_PAIRS.map(([a, b]) => pairKey(a, b)))

export async function findForks(db) {
  const { rows: players } = await db.query(
    `select id, name, team_id, created_at, api_ids from wpbl_players order by name`)

  // Same club, same surname. Grouped rather than compared pairwise so a club with three of a
  // surname reports once, as one group, which is how a person would want to read it.
  const groups = new Map()
  for (const p of players) {
    const key = `${p.team_id}|${surnameOf(p.name)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }

  const suspect = [...groups.values()].filter(g => g.length > 1)
    // A group every one of whose pairs has been checked is a group somebody has already ruled
    // on. Any UNchecked pair inside it brings the whole group back, which is right: a third
    // player arriving in a cleared group is new evidence.
    .filter(g => g.some((a, i) => g.slice(i + 1).some(b => !KNOWN.has(pairKey(a.id, b.id)))))
  if (suspect.length === 0) return []

  const ids = suspect.flat().map(p => p.id)
  // One query per side rather than a join: these two tables are the whole record of who played,
  // and a player can appear in either without the other (a pitcher who never bats, a position
  // player who never pitches).
  const { rows: appearances } = await db.query(
    `select player_id, game_id from wpbl_batting_lines where player_id = any($1)
     union
     select player_id, game_id from wpbl_pitching_lines where player_id = any($1)`, [ids])

  const gamesOf = new Map(ids.map(id => [id, new Set()]))
  for (const a of appearances) gamesOf.get(a.player_id)?.add(a.game_id)

  return suspect.map(group => ({
    team: group[0].team_id,
    surname: surnameOf(group[0].name),
    players: group.map(p => ({
      id: p.id,
      name: p.name,
      created_at: p.created_at,
      games: gamesOf.get(p.id).size,
      feedIds: p.api_ids ?? [],
    })),
    // The conclusive one, when it is true: a fork cannot share a box score with itself.
    sharedGames: group.length === 2
      ? [...gamesOf.get(group[0].id)].filter(g => gamesOf.get(group[1].id).has(g)).length
      : null,
  }))
}

async function main() {
  const url = process.env.SUPABASE_DB_URL
  if (!url) {
    console.error('SUPABASE_DB_URL is not set, so the roster fork check did NOT run.')
    process.exit(2)
  }
  const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await db.connect()
  let forks
  try { forks = await findForks(db) } finally { await db.end() }

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: forks.length === 0, forks }, null, 2))
    process.exit(forks.length ? 1 : 0)
  }

  if (forks.length === 0) {
    console.log('No club carries two players with the same surname.')
    process.exit(0)
  }

  console.error(`${forks.length} club/surname collision${forks.length === 1 ? '' : 's'}. `
    + 'Each is either one player the ingest split in two, or two real players who share a name.\n')
  for (const f of forks) {
    console.error(`  ${f.team} · ${f.surname}`)
    for (const p of f.players) {
      const day = String(p.created_at).slice(0, 10)
      console.error(`    ${p.name.padEnd(26)} ${String(p.games).padStart(3)} games   `
        + `added ${day}   ${p.id}`)
      if (p.feedIds.length) console.error(`      feed ids: ${p.feedIds.join(', ')}`)
    }
    if (f.sharedGames === 0) {
      console.error('    They have never appeared in the same box score, which two real '
        + 'teammates eventually do and a split player never can.')
    } else if (f.sharedGames > 0) {
      console.error(`    They have appeared in the same box score ${f.sharedGames} time`
        + `${f.sharedGames === 1 ? '' : 's'}, so they are two different players.`)
    }
    console.error('')
  }
  console.error('If it is a split, merge it (this DELETES the second row):')
  console.error("  select wpbl_merge_players('<keep uuid>', '<dupe uuid>');")
  console.error('If they are two real players, add the pair to KNOWN_PAIRS in this file.')
  process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err); process.exit(2) })
}
