/**
 * wpbl-clip-tags.mjs: which game, at-bat, players and club a WPBL YouTube Short shows.
 *
 * Pure: no network, no database. scripts/sync-wpbl-youtube.mjs loads the rows and writes the
 * result into wpbl_video_tags; src/wpbl/__tests__/clipTags.test.ts runs it against real titles.
 *
 * WHY THIS IS A MATCHER AND NOT A PARSER. No Short's title names its game. What a title does name,
 * about a third of the time, is a player and a thing that happened ("GIANELLONI GRAND SLAM",
 * "Yonetani with a 2 RBI double!"), and play-by-play records both. So a clip is pinned by finding
 * the one play that agrees with its title, in a game that was played shortly before it was posted.
 * Measured on the 2026 season's 176 in-season Shorts: about 65 pin to one at-bat this way.
 *
 * FOUR LEVELS, and the rule is to stop at the level the evidence supports:
 *   play    the player and the event agree with exactly one play
 *   game    the game but not the at-bat: two plays agree, or the player is named with no event
 *           and the clip went up while that game was on, or a club is named while it was playing
 *   player  a player, no game: an interview, a feature, a pre-season clip
 *   team    a club, no game: "How the Queens are preparing for the Postseason"
 * A club named OUTSIDE a game is never pinned to one: that is what put features on games in the
 * first trial, and a clip on the wrong game is worse than a clip on none.
 *
 * NAMES. A player is found by full name, then by a surname or first name that belongs to exactly
 * one player on the roster. A single-word match must be capitalised in the title (every Short
 * title capitalises names, and "out of the park" must not find Jua Park), and must not be a word
 * on NAME_STOPWORDS. A surname two players share ("Kim", "Hastings") is kept only if exactly one
 * of them played in the game the clip is pinned to.
 *
 * TIMES. A game's start is its stored wall clock read as Central (the same rule as gameStartMs in
 * src/wpbl/constants.ts, which this cannot import: that module pulls in Vite assets).
 */

const WPBL_TZ = 'America/Chicago'
const HOUR = 3600 * 1000

// How long after first pitch a clip can still be about that game, when the title names an event
// the play-by-play can confirm. The league posts most clips during the game (median 3.3h after
// first pitch in 2026) and the rest by the next evening.
const EVENT_WINDOW_MS = 48 * HOUR
// Without a confirmable event, only a clip posted while the game was on (or just after) is read
// as being from it. A seven-inning game runs about two and a half hours, but opening day's
// ceremonies and postgame clips ran long: "LA comes back from down 4 runs!!" went up 6h02m after
// first pitch. Eight reaches 1 AM Central, and the next morning's features went up 16 hours or
// more after first pitch, so they still fall outside.
const LIVE_WINDOW_MS = 8 * HOUR
// A clip is never from a game that had not started when it was posted; the slack covers a
// start time the feed has a few minutes wrong.
const EARLY_SLACK_MS = 15 * 60 * 1000

// Single words that are also a player's first or last name and turn up in titles as ordinary
// words or places. A full-name match still finds these players ("Jua Park 3 RBI Double!!").
const NAME_STOPWORDS = new Set([
  'park', 'day', 'frank', 'rice', 'grace', 'blunt', 'huff', 'lee', 'london', 'denver', 'sydney',
  'trinity', 'jordan', 'madison', 'rio', 'moore', 'everett', 'curtis', 'barry', 'zion', 'murphy',
  'scrappy', 'ela', 'emi', 'liz', 'kate', 'clara', 'nadia', 'olivia', 'chloe', 'emily', 'sarah',
])

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 }

export function gameStartMs(gameDate, startTime) {
  const [y, mo, d] = String(gameDate).split('-').map(Number)
  const m = String(startTime ?? '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  // No usable time: noon Central, early enough that no clip of the game falls before it.
  let h = 12, min = 0
  if (m) {
    h = parseInt(m[1], 10) % 12
    if (/pm/i.test(m[3])) h += 12
    min = parseInt(m[2], 10)
  }
  const naive = Date.UTC(y, mo - 1, d, h, min)
  const ref = new Date(naive)
  const offset = new Date(ref.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
    - new Date(ref.toLocaleString('en-US', { timeZone: WPBL_TZ })).getTime()
  return naive + offset
}

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`]/g, "'")
const lower = (s) => fold(s).toLowerCase()

// The words of a title, each with whether it was written capitalised. A possessive is stripped
// ("Mackay's", "BENITES'") and an inner apostrophe kept ("O'Sullivan", "Mo'ne").
function titleWords(title) {
  return (fold(title).match(/[A-Za-z][A-Za-z'-]*/g) ?? []).map(raw => {
    const w = raw.replace(/'s$/i, '').replace(/'$/, '')
    return { word: w.toLowerCase(), capital: /^[A-Z]/.test(w) }
  })
}

export function buildNameIndex(players) {
  const full = []
  const bySurname = new Map()
  const byFirst = new Map()
  const add = (map, key, p) => { if (!map.has(key)) map.set(key, []); map.get(key).push(p) }
  for (const p of players) {
    const n = lower(p.name).trim()
    if (!n) continue
    full.push({ key: n, player: p })
    const parts = n.split(/\s+/)
    add(byFirst, parts[0], p)
    if (parts.length > 1) add(bySurname, parts[parts.length - 1], p)
  }
  // Longest first, so "Maria José Valenzuela" is tried before a shorter name inside it.
  full.sort((a, b) => b.key.length - a.key.length)
  return { full, bySurname, byFirst }
}

/**
 * The players a title names. Each entry is a list of candidates: one for a unique name, several
 * for a surname two players share (resolved later against the game).
 */
export function findPlayers(title, index) {
  const t = lower(title)
  const found = []
  const seen = new Set()
  const take = (list) => {
    // A name already found by a longer match is the same person: "Lexi Hastings" must not go
    // on to add the other Hastings through the shared surname.
    if (list.some(p => seen.has(p.id))) return
    list.forEach(p => seen.add(p.id))
    found.push(list)
  }
  for (const { key, player } of index.full) {
    const at = t.indexOf(key)
    if (at === -1) continue
    const before = t[at - 1], after = t[at + key.length]
    if ((before && /[a-z]/.test(before)) || (after && /[a-z]/.test(after))) continue
    take([player])
  }
  for (const { word, capital } of titleWords(title)) {
    if (!capital || NAME_STOPWORDS.has(word)) continue
    const surname = index.bySurname.get(word)
    if (surname) { take(surname); continue }
    const first = index.byFirst.get(word)
    if (first && first.length === 1 && word.length >= 4) take(first)
  }
  return found
}

/**
 * What happened, if the title says in a way play-by-play can check. `runs` is how many runners
 * crossed ON THE PLAY, the feed's `runs_scored`, which does not count a home run's batter: a grand
 * slam is 3, "a 3-run homer" 2. Null where the title does not say.
 */
export function parseEvent(title) {
  const t = lower(title)
  const num = (s) => NUMBER_WORDS[s] ?? parseInt(s, 10)
  if (/grand slam/.test(t)) return { type: 'home_run', runs: 3 }
  const nRun = t.match(/\b(\d|one|two|three|four)[- ]run (?:homer|home run|hr|shot|blast|bomb)/)
  if (nRun) return { type: 'home_run', runs: num(nRun[1]) - 1 }
  if (/solo (?:homer|home run|shot)/.test(t)) return { type: 'home_run', runs: 0 }
  if (/home ?runs?\b|homers?\b|homered|\bhrs?\b|goes yard|goner|dinger|\blebomb\b|out of the park|sends one (?:deep|all the way)|launch(?:es)? one|crush(?:es)? one|smashed that/.test(t)) {
    return { type: 'home_run', runs: null }
  }
  const rbi = t.match(/\b(\d|one|two|three|four) rbi\b|(?:drives|brings|driving|bringing) in (one|two|three|four|\d)\b/)
  const runs = rbi ? num(rbi[1] ?? rbi[2]) : null
  if (/\btriples?\b/.test(t)) return { type: 'triple', runs }
  // "double play" is a fielding play, and fielders are not named in play-by-play.
  if (/\bdoubles?\b(?! play)/.test(t)) return { type: 'double', runs }
  if (/\bsingles?\b|lines one|base hit/.test(t)) return { type: 'single', runs }
  if (/caught stealing/.test(t)) return { type: 'caught_stealing', runs: null, runner: true }
  if (/\bsteals?\b|stolen base|swipes/.test(t)) return { type: 'stolen_base', runs: null, runner: true }
  return null
}

export function buildTeamWords(teams) {
  const words = []
  for (const t of teams) {
    for (const w of [t.city, t.name, `${t.city} ${t.name}`, t.abbr]) if (w) words.push({ key: lower(w), id: t.id })
  }
  // The Firebells are "the Bells" in the league's own titles ("THE BELLS FORCE GAME 5!").
  const sf = teams.find(t => /firebells/i.test(t.name ?? ''))
  if (sf) words.push({ key: 'bells', id: sf.id })
  return words.sort((a, b) => b.key.length - a.key.length)
}

function findTeam(title, teamWords) {
  const t = ` ${lower(title).replace(/[^a-z0-9 ]/g, ' ')} `
  const ids = new Set()
  for (const { key, id } of teamWords) {
    // Abbreviations only in capitals in the original ("LA leads"), since "la" and "ny" are
    // not otherwise words but "sf" style tokens should not be read out of lowercase text.
    if (key.length <= 3) {
      if (new RegExp(`(^|[^A-Za-z])${key.toUpperCase()}([^A-Za-z]|$)`).test(fold(title))) ids.add(id)
    } else if (t.includes(` ${key} `)) ids.add(id)
  }
  return ids.size === 1 ? [...ids][0] : null
}

/**
 * Everything the matcher reads, indexed once per run.
 * `lines` are box-score rows ({ game_id, player_id, team_id }), batting and pitching together:
 * they say who played in which game and for which club THAT DAY, which a roster row cannot.
 */
export function buildClipContext({ players, teams, games, lines, plays }) {
  const gameList = games
    .filter(g => g.status === 'final' || g.status === 'live')
    .map(g => ({ ...g, startMs: gameStartMs(g.game_date, g.start_time) }))
  const gameById = new Map(gameList.map(g => [g.id, g]))
  const appearances = new Map()   // player id -> Map(game id -> team id)
  for (const l of lines) {
    if (!gameById.has(l.game_id)) continue
    if (!appearances.has(l.player_id)) appearances.set(l.player_id, new Map())
    appearances.get(l.player_id).set(l.game_id, l.team_id)
  }
  const playsByGame = new Map()
  for (const p of plays) {
    if (!playsByGame.has(p.game_id)) playsByGame.set(p.game_id, [])
    playsByGame.get(p.game_id).push(p)
  }
  return {
    nameIndex: buildNameIndex(players),
    playerById: new Map(players.map(p => [p.id, p])),
    teamWords: buildTeamWords(teams),
    games: gameList.sort((a, b) => b.startMs - a.startMs),   // newest first
    gameById, appearances, playsByGame,
  }
}

// Games a player appeared in that had started by the time of the upload, within `windowMs`,
// newest first.
function recentGames(ctx, playerId, pubMs, windowMs) {
  const apps = ctx.appearances.get(playerId)
  if (!apps) return []
  return ctx.games.filter(g => apps.has(g.id) && g.startMs - EARLY_SLACK_MS <= pubMs && pubMs - g.startMs <= windowMs)
}

function playMatches(play, player, event) {
  if (play.event_type !== event.type) return false
  if (event.runner) {
    // A runner's play is written with the runner's name first ("Amira Hondras out at second").
    if (!lower(play.narrative ?? '').startsWith(lower(player.name))) return false
  } else if (play.batter_id !== player.id) return false
  if (event.runs != null && (play.runs_scored ?? 0) !== event.runs) return false
  return true
}

/**
 * The club a player played for on the day a clip went up: the club on the latest box-score line
 * at or before it, never the roster's current club (a traded player's August clip is from the
 * August club). Null before a first game.
 */
function clubAsOf(ctx, playerId, pubMs) {
  const apps = ctx.appearances.get(playerId)
  if (!apps) return null
  const g = ctx.games.find(g => apps.has(g.id) && g.startMs - EARLY_SLACK_MS <= pubMs)
  return g ? apps.get(g.id) : null
}

/** The tag for one Short, or null when the title gives nothing to go on. */
export function tagClip(video, ctx) {
  const pubMs = Date.parse(video.published_at)
  const named = findPlayers(video.title, ctx.nameIndex)
  const event = parseEvent(video.title)

  // Unambiguous players first; a shared surname waits for a game to decide between its owners.
  const sure = named.filter(c => c.length === 1).map(c => c[0])
  const shared = named.filter(c => c.length > 1)

  let pinned = null   // { game, play|null, player|null }
  if (event) {
    for (const player of [...sure, ...shared.flat()]) {
      for (const game of recentGames(ctx, player.id, pubMs, EVENT_WINDOW_MS)) {
        const hits = (ctx.playsByGame.get(game.id) ?? []).filter(p => playMatches(p, player, event))
        if (hits.length === 0) continue
        pinned = { game, play: hits.length === 1 ? hits[0] : null, player }
        break
      }
      if (pinned) break
    }
  }
  if (!pinned) {
    // No confirmable event: a named player's game counts only if the clip went up while it was on.
    for (const player of sure) {
      const [game] = recentGames(ctx, player.id, pubMs, LIVE_WINDOW_MS)
      if (game) { pinned = { game, play: null, player }; break }
    }
  }

  // Shared surnames resolve to whoever of their owners played in the pinned game, and are dropped
  // otherwise: a clip of "Kim" with no game is not evidence of which Kim.
  const players = [...sure]
  for (const cands of shared) {
    const inGame = pinned ? cands.filter(p => ctx.appearances.get(p.id)?.has(pinned.game.id)) : []
    if (inGame.length === 1) players.push(inGame[0])
  }
  const playerIds = [...new Set(players.map(p => p.id))]

  if (pinned) {
    const { game, play, player } = pinned
    const teamId = play?.team_id ?? (player ? ctx.appearances.get(player.id)?.get(game.id) : null) ?? null
    return {
      game_id: game.id,
      play_sequence: play?.sequence ?? null,
      inning: play?.inning ?? null,
      half: play?.half ?? null,
      team_id: teamId,
      player_ids: playerIds,
      method: play ? 'play' : 'game',
    }
  }
  if (playerIds.length > 0) {
    return {
      game_id: null, play_sequence: null, inning: null, half: null,
      team_id: clubAsOf(ctx, playerIds[0], pubMs),
      player_ids: playerIds, method: 'player',
    }
  }

  const teamId = findTeam(video.title, ctx.teamWords)
  if (!teamId) return null
  // A club named while it was playing: that game. Otherwise the club alone, never a game.
  const game = ctx.games.find(g =>
    (g.home_team_id === teamId || g.away_team_id === teamId)
    && g.startMs - EARLY_SLACK_MS <= pubMs && pubMs - g.startMs <= LIVE_WINDOW_MS)
  return {
    game_id: game?.id ?? null, play_sequence: null, inning: null, half: null,
    team_id: teamId, player_ids: [], method: game ? 'game' : 'team',
  }
}
