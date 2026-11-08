// Records MLB games from StatsAPI's live feed as test fixtures for the live field
// (src/mlb/liveField.ts): `npm run record-mlb-feed -- <gamePk>[:label] ... [--snapshots N]`.
//
// WHY RECORDED GAMES AND NOT HAND-WRITTEN ONES. The adapter's job is to survive what the feed
// actually does: legs of one runner's trip split across entries, the automatic runner as an
// action, a pinch runner swapped on a base, a challenge on a pitch. A hand-written fixture holds
// only the cases its author thought of. StatsAPI keeps every game's feed, and `?timecode=`
// returns the feed as it stood at any moment, so a game from July can be replayed as if it were
// live today, which is what the mid-game snapshots are for: the adapter has to read an
// in-progress feed (a half-finished plate appearance, no result yet) the same way it reads a
// final one.
//
// WHY TRIMMED. A full feed is about 750 KB, mostly hot and cold zones, season splits and box
// score stats the field never reads. The trim keeps only what `MlbLiveFeed` types, so a fixture
// is a few dozen KB gzipped. If the adapter starts reading a new field, add it to `trim` and
// record again; a test reading a field the trim dropped fails on the missing data, not silently.
import { mkdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const OUT = 'src/mlb/__tests__/fixtures/live'
const API = 'https://statsapi.mlb.com/api/v1.1/game'

type J = Record<string, unknown>
const pick = (o: unknown, keys: string[]): J | undefined => {
  if (o == null || typeof o !== 'object') return undefined
  const out: J = {}
  for (const k of keys) if ((o as J)[k] !== undefined) out[k] = (o as J)[k]
  return out
}
const ref = (r: unknown) => pick(r, ['id', 'fullName'])
const pos = (p: unknown) => pick(p, ['abbreviation'])

function trimEvent(e: J): J {
  const d = (e.details ?? {}) as J
  const pd = e.pitchData as J | undefined
  const hd = e.hitData as J | undefined
  return {
    ...pick(e, ['type', 'index', 'isPitch', 'isSubstitution', 'base', 'count', 'reviewDetails']),
    player: ref(e.player),
    replacedPlayer: ref(e.replacedPlayer),
    position: pos(e.position),
    details: {
      ...pick(d, ['description', 'eventType', 'code', 'isInPlay', 'isBall', 'isStrike']),
      call: pick(d.call, ['code', 'description']),
      type: pick(d.type, ['description']),
    },
    pitchData: pd && {
      ...pick(pd, ['startSpeed', 'strikeZoneTop', 'strikeZoneBottom']),
      coordinates: pick(pd.coordinates, ['pX', 'pZ']),
    },
    hitData: hd && {
      ...pick(hd, ['launchSpeed', 'launchAngle', 'totalDistance', 'trajectory']),
      coordinates: pick(hd.coordinates, ['coordX', 'coordY']),
    },
  }
}

function trimPlay(p: J): J {
  const m = (p.matchup ?? {}) as J
  return {
    about: pick(p.about, ['atBatIndex', 'inning', 'halfInning', 'isComplete']),
    result: pick(p.result, ['event', 'description', 'awayScore', 'homeScore']),
    matchup: {
      batter: ref(m.batter), pitcher: ref(m.pitcher),
      postOnFirst: ref(m.postOnFirst), postOnSecond: ref(m.postOnSecond), postOnThird: ref(m.postOnThird),
    },
    count: pick(p.count, ['outs']),
    playEvents: ((p.playEvents ?? []) as J[]).map(trimEvent),
    runners: ((p.runners ?? []) as J[]).map(r => {
      const d = (r.details ?? {}) as J
      return {
        movement: pick(r.movement, ['start', 'end', 'outBase', 'isOut']),
        details: { ...pick(d, ['movementReason', 'playIndex', 'eventType']), runner: ref(d.runner) },
      }
    }),
  }
}

function trim(feed: J): J {
  const gd = (feed.gameData ?? {}) as J
  const ld = (feed.liveData ?? {}) as J
  const teams = (gd.teams ?? {}) as J
  const box = ((ld.boxscore as J | undefined)?.teams ?? {}) as J
  const boxSide = (s: unknown) => {
    const t = (s ?? {}) as J
    const players: J = {}
    for (const [k, v] of Object.entries((t.players ?? {}) as J)) {
      const p = v as J
      players[k] = {
        person: ref(p.person),
        battingOrder: p.battingOrder,
        allPositions: ((p.allPositions ?? []) as J[]).map(pos),
      }
    }
    return { players, pitchers: t.pitchers }
  }
  const players: J = {}
  for (const [k, v] of Object.entries((gd.players ?? {}) as J)) players[k] = ref(v)
  return {
    gameData: {
      status: pick(gd.status, ['abstractGameState']),
      teams: { away: pick(teams.away, ['abbreviation']), home: pick(teams.home, ['abbreviation']) },
      players,
    },
    liveData: {
      plays: { allPlays: (((ld.plays as J | undefined)?.allPlays ?? []) as J[]).map(trimPlay) },
      linescore: {
        innings: (((ld.linescore as J | undefined)?.innings ?? []) as J[]).map(i => ({
          num: i.num, away: pick(i.away, ['runs']), home: pick(i.home, ['runs']),
        })),
      },
      boxscore: { teams: { away: boxSide(box.away), home: boxSide(box.home) } },
    },
  }
}

async function get(url: string): Promise<unknown> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

function save(name: string, feed: J) {
  const body = gzipSync(JSON.stringify(trim(feed)), { level: 9 })
  writeFileSync(`${OUT}/${name}.json.gz`, body)
  return body.length
}

const args = process.argv.slice(2)
const si = args.indexOf('--snapshots')
const snapshots = si >= 0 ? Number(args.splice(si, 2)[1]) : 0
if (!args.length) {
  console.error('usage: npm run record-mlb-feed -- <gamePk>[:label] ... [--snapshots N]')
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })

for (const arg of args) {
  const [pk, label] = arg.split(':')
  const name = label ? `${pk}-${label}` : pk
  const size = save(name, (await get(`${API}/${pk}/feed/live`)) as J)
  console.log(`${name}: ${(size / 1024).toFixed(1)} KB`)
  if (snapshots > 0) {
    const stamps = (await get(`${API}/${pk}/feed/live/timestamps`)) as string[]
    // Evenly through the game, skipping the pregame stamps at the start, so each snapshot lands
    // mid-game and most land mid plate appearance.
    for (let k = 1; k <= snapshots; k++) {
      const stamp = stamps[Math.floor((stamps.length * k) / (snapshots + 1))]
      const s = save(`${name}@${stamp}`, (await get(`${API}/${pk}/feed/live?timecode=${stamp}`)) as J)
      console.log(`  @${stamp}: ${(s / 1024).toFixed(1)} KB`)
    }
  }
}
