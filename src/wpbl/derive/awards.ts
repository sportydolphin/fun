import { WPBL_AWARDS, playChoiceKey, type AwardSlate, type WpblAward } from '../awards'
import { regularSeasonLines, countsInStandings } from '../season'
import { outsToIp } from '../innings'
import { positionsPlayed } from '../positions'
import { aggregateBatting, aggregatePitching, plateAppearances, sumFielding, wpblQualifiers, QUALIFY_FLOOR_PA } from '../stats'
import { fmtMvpRuns, type MvpRace } from './mvpRace'
import { fmtWinPct, type GameWinProb } from './winProbability'
import type { TrackingBoard } from '../tracking'
import type {
  WpblBattingLine, WpblFieldingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblTeam,
} from '../types'

/**
 * The shortlists behind the fan awards ballot.
 *
 * A SHORTLIST IS NOT A RANKING, and every category says where its names came from
 * (`seededBy` in awards.ts) so a reader can tell an endorsement from a starting point. Six
 * names is what a ballot line can hold before it becomes a table nobody reads, and the
 * open-field categories exist for the questions where offering six would be inventing an
 * opinion the data does not have.
 *
 * NOTHING HERE INVENTS A NUMBER. Every seeded category reuses a figure the section already
 * publishes: the MVP race for value, the run-expectancy table for runs saved, the win model
 * for plays and games, the qualifier bar for who counts as a regular. Two surfaces disagreeing
 * about the same player is the failure this section spends the most comment on avoiding, and a
 * ballot is the worst place to introduce it, since a vote cast on one number is settled
 * forever.
 *
 * POSTSEASON IS OUT of every total, because these are the regular-season awards and because
 * the ballot opens while the playoffs are running: a shortlist that moved between a voter
 * seeing it and voting on it would be worse than a stale one. Filtering runs through
 * `regularSeasonLines`, the section's one definition.
 *
 * PURE: arrays in, plain shapes out, no supabase and no React.
 */

/** One name on a ballot line. `key` is what gets stored in `wpbl_award_votes.choice`. */
export interface AwardCandidate {
  key: string
  name: string
  /** The club to show beside her, which is "now" for a player and "then" for a play or a
   *  game. A player's roster row is the right answer for a season award: the badge should be
   *  the shirt she is wearing while the vote is open. A play belongs to the night it happened
   *  and takes its club from the game. See the trade note in CLAUDE.md. */
  teamId: string | null
  /** Set for a player pick, so a surface can draw a portrait and link to her page. */
  playerId: string | null
  /** The figure that put her on the list, already formatted. Empty on an open field. */
  line: string
  /** A second line where the first is not enough on its own: the game a play came from. */
  sub?: string
  /** Set for a game or play pick, so the card can link to Game Center. */
  gameId?: string
  sequence?: number
}

export interface AwardBallotEntry {
  award: WpblAward
  candidates: AwardCandidate[]
}

export interface AwardGameWinProb {
  game: WpblGame
  wp: GameWinProb
}

export interface AwardBallotInput {
  players: WpblPlayer[]
  teams: WpblTeam[]
  games: WpblGame[]
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  fielding: WpblFieldingLine[]
  /** The MVP race, which already prices both sides of the ball off one table. Absent until
   *  the play log has been fetched, which is a deferred read on every surface that uses it. */
  mvp?: MvpRace | null
  /** One entry per final game, priced by the win model. Absent for the same reason. */
  winProb?: readonly AwardGameWinProb[] | null
  /** Absent whenever the league is not publishing radar, which is most of the time. */
  tracking?: TrackingBoard | null
}

/** Six names, or eight where the thing being picked is a moment rather than a person: a play
 *  shortlist is drawn from 30 games and one per club per week is the least it can be. */
const SHORTLIST = 6
const MOMENT_SHORTLIST = 8

/** A defensive shortlist that included putouts would be a list of positions rather than of
 *  players: a catcher is credited a putout on every strikeout and a first baseman on every
 *  groundout, so the top six would be four catchers and two first basemen every season, in
 *  every league. Assists and double plays are the closest a box score gets to a play made. */
const GLOVE_MIN_CHANCES = 10

/** Enough of a season to be a baserunner rather than to have run once. */
const WHEELS_MIN_SB = 2

/** Two positions is a platoon. Three is a story. */
const UTILITY_MIN_POSITIONS = 3

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

/** Positions read back as a fan writes them: "C, 1B, LF". */
const prettyPositions = (pos: readonly string[]): string => pos.map(p => p.toUpperCase()).join(', ')

/**
 * Build the whole ballot.
 *
 * A category whose shortlist comes back empty is DROPPED rather than rendered blank. Most of
 * them can only be empty before the season has data, but two of them (`cannon`, `contact`)
 * are empty whenever the league has stopped publishing tracking, which is a normal state
 * rather than an outage, and an award nobody can be nominated for is worse than an award that
 * is not offered.
 */
export function buildAwardBallot(input: AwardBallotInput): AwardBallotEntry[] {
  const out: AwardBallotEntry[] = []
  for (const award of WPBL_AWARDS) {
    const candidates = slateFor(award.slate, input)
    if (candidates.length === 0) continue
    out.push({ award, candidates })
  }
  return out
}

function slateFor(slate: AwardSlate, input: AwardBallotInput): AwardCandidate[] {
  switch (slate) {
    case 'mvp':         return mvpSlate(input)
    case 'arm':         return armSlate(input)
    case 'glove':       return gloveSlate(input)
    case 'play':        return playSlate(input)
    case 'game':        return gameSlate(input)
    case 'wheels':      return wheelsSlate(input)
    case 'toughestOut': return toughestOutSlate(input)
    case 'workhorse':   return workhorseSlate(input)
    case 'utility':     return utilitySlate(input)
    case 'cannon':      return cannonSlate(input)
    case 'contact':     return contactSlate(input)
    case 'everyone':    return everyoneSlate(input)
  }
}

// ── Value, from the race that already prices it ─────────────────────────────────

function mvpSlate({ mvp }: AwardBallotInput): AwardCandidate[] {
  if (!mvp) return []
  return mvp.field.slice(0, SHORTLIST).map(c => ({
    // The race keys an unrostered name as `name:<lowercased>`, and that key is what gets
    // stored. It is stable for as long as the play log spells her the same way, which is the
    // best any vote for somebody with no roster row can do.
    key: c.player?.id ?? c.key,
    name: c.name,
    teamId: c.player?.team_id ?? c.teamId,
    playerId: c.player?.id ?? null,
    line: `${fmtMvpRuns(c.total)} runs added`,
    sub: c.twoWay ? 'Both sides of the ball' : undefined,
  }))
}

function armSlate({ mvp, players, pitching, games, teams }: AwardBallotInput): AwardCandidate[] {
  if (!mvp) return []
  // The gate is the section's own rate-title bar, not a number invented here, so a pitcher on
  // this list is one the stats board would also let onto a leaderboard.
  const qual = wpblQualifiers(teams, games)
  const eligible = new Set(
    aggregatePitching(players, pitching, games)
      .filter(p => p.totals.outs >= (qual.active ? qual.minOuts : 0))
      .map(p => p.player.id),
  )
  return mvp.field
    .filter(c => c.arm > 0 && c.player != null && eligible.has(c.player.id))
    .sort((a, b) => b.arm - a.arm)
    .slice(0, SHORTLIST)
    .map(c => ({
      key: c.player!.id,
      name: c.name,
      teamId: c.player!.team_id ?? c.teamId,
      playerId: c.player!.id,
      line: `${fmtMvpRuns(c.arm)} runs saved`,
    }))
}

// ── The box-score shortlists ────────────────────────────────────────────────────

function gloveSlate({ players, fielding, games }: AwardBallotInput): AwardCandidate[] {
  const byPlayer = new Map<string, WpblFieldingLine[]>()
  for (const l of regularSeasonLines(fielding, games)) {
    const arr = byPlayer.get(l.player_id) ?? []
    arr.push(l); byPlayer.set(l.player_id, arr)
  }
  const roster = new Map(players.map(p => [p.id, p]))
  const rows: { player: WpblPlayer; plays: number; line: string }[] = []
  for (const [pid, lines] of byPlayer) {
    const player = roster.get(pid)
    if (!player) continue
    const t = sumFielding(lines)
    if (t.po + t.a + t.e < GLOVE_MIN_CHANCES) continue
    rows.push({
      player,
      plays: t.a + t.dp,
      line: `${t.a} assists, ${t.dp} double plays, ${t.e} ${t.e === 1 ? 'error' : 'errors'}`,
    })
  }
  return rows
    .sort((a, b) => b.plays - a.plays || byName(a.player, b.player))
    .slice(0, SHORTLIST)
    .map(r => playerCandidate(r.player, r.line))
}

function wheelsSlate({ players, batting, games }: AwardBallotInput): AwardCandidate[] {
  return aggregateBatting(players, batting, games)
    .filter(b => b.totals.sb >= WHEELS_MIN_SB)
    .sort((a, b) => (b.totals.sb - b.totals.cs) - (a.totals.sb - a.totals.cs)
      || b.totals.sb - a.totals.sb
      || byName(a.player, b.player))
    .slice(0, SHORTLIST)
    .map(b => playerCandidate(
      b.player,
      `${b.totals.sb} ${b.totals.sb === 1 ? 'steal' : 'steals'}, caught ${b.totals.cs}`,
    ))
}

function toughestOutSlate({ players, batting, games, teams }: AwardBallotInput): AwardCandidate[] {
  const qual = wpblQualifiers(teams, games)
  const bar = qual.active ? qual.minPa : QUALIFY_FLOOR_PA
  const rows = aggregateBatting(players, batting, games)
    .map(b => ({ ...b, pa: plateAppearances(b.totals) }))
    .filter(b => b.pa >= bar)
  return rows
    .sort((a, b) => a.totals.so / a.pa - b.totals.so / b.pa || byName(a.player, b.player))
    .slice(0, SHORTLIST)
    .map(b => playerCandidate(
      b.player,
      `Struck out in ${((b.totals.so / b.pa) * 100).toFixed(1)}% of ${b.pa} trips`,
    ))
}

function workhorseSlate({ players, pitching, games }: AwardBallotInput): AwardCandidate[] {
  return aggregatePitching(players, pitching, games)
    .filter(p => p.totals.outs > 0)
    .sort((a, b) => b.totals.outs - a.totals.outs || byName(a.player, b.player))
    .slice(0, SHORTLIST)
    .map(p => playerCandidate(
      p.player,
      `${outsToIp(p.totals.outs)} innings across ${p.totals.g} ${p.totals.g === 1 ? 'outing' : 'outings'}`,
    ))
}

function utilitySlate({ players, batting, games }: AwardBallotInput): AwardCandidate[] {
  const byPlayer = new Map<string, WpblBattingLine[]>()
  for (const l of regularSeasonLines(batting, games)) {
    const arr = byPlayer.get(l.player_id) ?? []
    arr.push(l); byPlayer.set(l.player_id, arr)
  }
  const roster = new Map(players.map(p => [p.id, p]))
  const rows: { player: WpblPlayer; positions: string[] }[] = []
  for (const [pid, lines] of byPlayer) {
    const player = roster.get(pid)
    if (!player) continue
    const positions = positionsPlayed(lines)
    if (positions.length >= UTILITY_MIN_POSITIONS) rows.push({ player, positions })
  }
  return rows
    .sort((a, b) => b.positions.length - a.positions.length || byName(a.player, b.player))
    .slice(0, SHORTLIST)
    .map(r => playerCandidate(
      r.player,
      `${r.positions.length} positions: ${prettyPositions(r.positions)}`,
    ))
}

// ── Moments, from the win model ─────────────────────────────────────────────────

function playSlate({ winProb, teams }: AwardBallotInput): AwardCandidate[] {
  if (!winProb) return []
  const names = teamNames(teams)
  const rows: { swing: number; candidate: AwardCandidate }[] = []
  for (const { game, wp } of winProb) {
    if (game.status !== 'final' || !countsInStandings(game)) continue
    // `decisive` rather than `biggest`: the largest swing toward the side that actually won.
    // The biggest swing full stop is often a rally the losing team wasted, and a card calling
    // that the play of the year reads as a mistake rather than as a different question.
    const pt = wp.decisive
    if (!pt || !pt.play.narrative) continue
    rows.push({
      swing: Math.abs(pt.swing),
      candidate: {
        key: playChoiceKey(game.id, pt.play.sequence),
        name: pt.play.narrative,
        teamId: pt.play.team_id,
        playerId: pt.play.batter_id,
        line: `Swung the game ${fmtWinPct(Math.abs(pt.swing))}`,
        sub: `${names(game.away_team_id)} at ${names(game.home_team_id)}, ${game.game_date}`,
        gameId: game.id,
        sequence: pt.play.sequence,
      },
    })
  }
  return rows.sort((a, b) => b.swing - a.swing).slice(0, MOMENT_SHORTLIST).map(r => r.candidate)
}

function gameSlate({ winProb, teams }: AwardBallotInput): AwardCandidate[] {
  if (!winProb) return []
  const names = teamNames(teams)
  return winProb
    .filter(({ game }) => game.status === 'final' && countsInStandings(game))
    .slice()
    .sort((a, b) => b.wp.excitement - a.wp.excitement)
    .slice(0, SHORTLIST)
    .map(({ game }) => ({
      key: game.id,
      name: `${names(game.away_team_id)} at ${names(game.home_team_id)}`,
      teamId: game.home_team_id,
      playerId: null,
      line: `${names(game.away_team_id)} ${game.away_score ?? 0}, ${names(game.home_team_id)} ${game.home_score ?? 0}`,
      sub: game.game_date,
      gameId: game.id,
    }))
}

// ── Radar, when there is any ────────────────────────────────────────────────────

function cannonSlate({ tracking }: AwardBallotInput): AwardCandidate[] {
  if (!tracking) return []
  return tracking.veloLeaders
    .slice(0, SHORTLIST)
    .filter(l => l.player != null)
    .map(l => ({
      key: l.player!.id,
      name: l.name,
      teamId: l.player!.team_id ?? l.teamId,
      playerId: l.player!.id,
      line: `${l.maxVelo.toFixed(1)} mph, hardest of ${l.count} tracked pitches`,
    }))
}

function contactSlate({ tracking }: AwardBallotInput): AwardCandidate[] {
  if (!tracking) return []
  const seen = new Set<string>()
  const out: AwardCandidate[] = []
  // One entry per hitter: the board is a list of batted balls, and the same swing-first
  // hitter owning three of six slots would leave a ballot with three names on it.
  for (const hit of tracking.hardestHits) {
    if (!hit.player || hit.exit == null || seen.has(hit.player.id)) continue
    seen.add(hit.player.id)
    out.push({
      key: hit.player.id,
      name: hit.name,
      teamId: hit.player.team_id ?? hit.teamId,
      playerId: hit.player.id,
      line: `${hit.exit.toFixed(1)} mph off the bat`,
      sub: hit.distance != null ? `${Math.round(hit.distance)} feet` : undefined,
      gameId: hit.gameId,
    })
    if (out.length >= SHORTLIST) break
  }
  return out
}

// ── The open field ──────────────────────────────────────────────────────────────

/** Everyone who played, for the categories no number can shortlist. Alphabetical rather than
 *  ranked on purpose: any order here would be the opinion the category exists to avoid. */
function everyoneSlate({ players, batting, pitching, games }: AwardBallotInput): AwardCandidate[] {
  const played = new Set<string>()
  for (const l of regularSeasonLines(batting, games)) played.add(l.player_id)
  for (const l of regularSeasonLines(pitching, games)) played.add(l.player_id)
  return players
    .filter(p => played.has(p.id))
    .sort(byName)
    .map(p => ({ key: p.id, name: p.name, teamId: p.team_id, playerId: p.id, line: '' }))
}

// ── Shared ──────────────────────────────────────────────────────────────────────

function playerCandidate(player: WpblPlayer, line: string): AwardCandidate {
  return { key: player.id, name: player.name, teamId: player.team_id, playerId: player.id, line }
}

/** Club nickname by id, falling back to the id itself so a club the roster fetch missed still
 *  reads as something rather than as blank. */
function teamNames(teams: readonly WpblTeam[]): (id: string | null) => string {
  const map = new Map(teams.map(t => [t.id, t.name || t.abbr || t.id]))
  return (id: string | null) => (id ? map.get(id) ?? id : '')
}
