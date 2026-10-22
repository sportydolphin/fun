import { useDark } from '../ui/useDark'
import { useEffect, useMemo, useState } from 'react'
import { fetchWpblAllRunValuePlays, getCachedWpblAllRunValuePlays } from './api'
import {
  gameWinProb, fmtWinPct, winProbModel, swingLabel,
  type GameWinProb, type WinProbPoint,
} from './derive/winProbability'
import { parsePlay } from './derive/playByPlay'
import { wpblAccent } from './constants'
import { WinProbChart, WinProbFrame, type Readout } from '../ui/winProbChart'
import { WIN_PROB_INFO } from './winProbInfo'
import type { WpblGame, WpblGamePlay, WpblRunValuePlay, WpblTeam } from './types'
import { ordinal } from '../lib/format'

export type { Readout }

/**
 * The shape of a game: win probability from the first pitch to the last out, and the one play
 * that moved it furthest.
 *
 * WHY A CHART AND NOT A NUMBER. Win probability at a moment is a stat; win probability over a
 * game is a story, and the story is the part a fan wants. A line that sits flat at 80% for
 * six innings and then falls off a cliff needs no explaining to anybody, which is more than
 * can be said for most of what this section computes.
 *
 * The model is in derive/winProbability.ts, built from the league's own plays. It knows
 * nothing about who is pitching, which the ⓘ says out loud. The drawing is shared with MLB's
 * Game Center (src/ui/winProbChart.tsx); this file is the model and the words.
 */

const INFO = WIN_PROB_INFO

interface Props {
  game: WpblGame
  teams: Map<string, WpblTeam>
  /** This game's plays, already loaded by Game Center. */
  plays: WpblGamePlay[]
  /** The whole schedule, not this game. The model reads the league's plays, and the only way
   *  to keep the postseason out of them is to hand it the schedule that says which is which.
   *  Passing one game would not error: the season filter excludes by the ids it KNOWS are out
   *  (see CLAUDE.md), so a partial schedule quietly lets everything through. */
  games: WpblGame[]
}

export default function WinProbView({ game, teams, plays, games }: Props) {
  // The model is league-wide, so it needs every play of the season, not this game's. The Run
  // value board fetches exactly the same list and caches it for the session, so a reader who
  // has been to Stats pays nothing here.
  const [league, setLeague] = useState<WpblRunValuePlay[] | null>(() => getCachedWpblAllRunValuePlays())
  useEffect(() => {
    if (league) return
    let cancelled = false
    fetchWpblAllRunValuePlays().then(p => { if (!cancelled) setLeague(p) }).catch(() => {})
    return () => { cancelled = true }
  }, [league])

  const wp = useMemo<GameWinProb | null>(() => {
    if (!league || plays.length === 0) return null
    const model = winProbModel(league, games.length > 0 ? games : [game])
    return gameWinProb(model, plays as WpblRunValuePlay[], game)
  }, [league, plays, game, games])

  // NOTHING HERE IS ALLOWED TO CHANGE HEIGHT ONCE IT HAS PAINTED. This card sits at the top
  // of the recap, so anything that arrives late pushes the rest of the tab down, and it
  // arrives late by construction: it needs the league's entire play log, not this game's. So
  // the frame is drawn immediately, at exactly the size it will end up, and the chart is
  // filled in underneath it. The alternative renders nothing for a second and then shoves the
  // whole recap down the screen.
  if (league === null) {
    return <WinProbFrame info={INFO}
      away={teams.get(game.away_team_id)?.abbr ?? 'AWAY'} home={teams.get(game.home_team_id)?.abbr ?? 'HOME'} />
  }
  if (!wp || wp.points.length < 2) return null
  return <WinProbCard game={game} teams={teams} wp={wp} />
}

/** Split out so the model work above stays in one place and this stays drawing. */
function WinProbCard({ game, teams, wp }: { game: WpblGame; teams: Map<string, WpblTeam>; wp: GameWinProb }) {
  // The curated foreground colors, not the primaries. Every club in this league is
  // near-black (BOS #00281e, LA #000000, NY #091b47, SF #2d1747), which is fine behind a logo
  // and useless for two areas that have to be told apart: the primaries draw Los Angeles in
  // pure black at 30% over a dark card. See the note on wpblAccent.
  const dark = useDark()
  const pts = wp.points
  const plot = useMemo(() => pts.map(p => ({ before: p.before, after: p.after, inning: p.play.inning })), [pts])

  // THE CARD ALWAYS RESTS ON A PLAY. The one that won it where a winner exists, the most
  // volatile one while a game is still being played, and in a rout the biggest of a small
  // lot. The honesty about which of those it is belongs in the LABEL, not in whether a play
  // shows (see restingReadout).
  const resting = wp.decisive ?? wp.biggest
  const restIdx = resting ? pts.indexOf(resting) : -1

  // Only while it is being played. On a final game "SF 100%" is not a forecast, it is the
  // scoreboard three inches up the sheet with a percent sign on it.
  const now = game.status === 'live' ? { text: nowLine(wp.final, game, teams), color: 'var(--wpbl-accent-fg)' } : null

  return (
    <WinProbChart
      points={plot}
      away={{ abbr: teams.get(game.away_team_id)?.abbr ?? 'AWAY', fill: wpblAccent(game.away_team_id, dark) }}
      home={{ abbr: teams.get(game.home_team_id)?.abbr ?? 'HOME', fill: wpblAccent(game.home_team_id, dark) }}
      info={INFO}
      now={now}
      accent="var(--wpbl-accent-fg)"
      marks={restIdx >= 0 ? [{ index: restIdx, color: 'var(--wpbl-accent-solid)' }] : []}
      readout={(i, canHover) => i != null ? scrubReadout(pts[i], game, teams)
        : resting ? restingReadout(resting, game, teams, canHover, resting === wp.decisive)
        : null}
    />
  )
}

/**
 * "LA 65% → 69%".
 *
 * THE PERCENTAGES ARE THE TEAM THE PLAY LEFT IN FRONT, not a fixed side, so the second number
 * is always the bigger half of the chart and always over 50%. Pinned to the home team instead,
 * half the chart reads as a club losing, and scrubbing across a game the visitors ran away
 * with is a column of numbers falling toward zero for a team that won. It only ever changes
 * club on a lead change, which is a thing worth seeing happen under your thumb.
 *
 * The two are collapsed to one when rounding makes them equal: "38% → 38%" claims a change the
 * model is not being allowed to print (see fmtWinPct), and most plays of a game are that.
 */
function pctLine(pt: WinProbPoint, game: WpblGame, teams: Map<string, WpblTeam>): string {
  const { homeSide, abbr } = leader(pt.after, game, teams)
  const before = fmtWinPct(homeSide ? pt.before : 1 - pt.before)
  const after = fmtWinPct(homeSide ? pt.after : 1 - pt.after)
  return before === after ? `${abbr} ${after}` : `${abbr} ${before} → ${after}`
}

/** Which club a probability leaves in front, and how to name them. Shared so the header's live
 *  figure and the readout's can never pick different sides of the same number. */
function leader(p: number, game: WpblGame, teams: Map<string, WpblTeam>) {
  const homeSide = p >= 0.5
  const t = teams.get(homeSide ? game.home_team_id : game.away_team_id)
  return { homeSide, abbr: t?.abbr ?? (homeSide ? 'HOME' : 'AWAY') }
}

/**
 * "NY 63%". Where a game still being played stands, for the card header.
 *
 * Named for the club IN FRONT rather than for a fixed side, the same choice and the same
 * reason as pctLine: pinned to the home team, half the live games in the league would show a
 * number falling toward zero for the club that is winning.
 */
export function nowLine(p: number, game: WpblGame, teams: Map<string, WpblTeam>): string {
  const { homeSide, abbr } = leader(p, game, teams)
  return `${abbr} ${fmtWinPct(homeSide ? p : 1 - p)}`
}

/** The play, without the runner movements the feed hangs off the end of it: the box has two
 *  lines, and "Benitez advanced to third" is the part a reader can see on the chart anyway. */
function playText(pt: WinProbPoint): { who: string; what: string } {
  const parsed = parsePlay(pt.play.narrative ?? '', pt.play.batter_name)
  return {
    who: parsed.who ?? '',
    what: parsed.what || pt.play.narrative?.trim() || 'No play recorded',
  }
}

/** The sentence, and the name at its front for the chart to step down if the row is narrow. */
const playLine = ({ who, what }: { who: string; what: string }) =>
  ({ text: who ? `${who} ${what}.` : `${what}.`, who: who || undefined })

/** One moment of the game, as the finger passes over it. */
export function scrubReadout(
  pt: WinProbPoint,
  game: WpblGame,
  teams: Map<string, WpblTeam>,
): Readout {
  const p = pt.play
  const away = teams.get(game.away_team_id)?.abbr ?? 'AWAY'
  const home = teams.get(game.home_team_id)?.abbr ?? 'HOME'
  const play = playLine(playText(pt))
  return {
    label: `${p.half === 'bottom' ? 'Bot' : 'Top'} ${ordinal(p.inning)} · ${p.outs ?? 0} out`,
    pct: pctLine(pt, game, teams),
    ...play,
    // The scoreboard as the play left it. 60% at 1-0 and 60% at 8-7 are not the same game,
    // and the win figure alone cannot tell them apart.
    note: `${away} ${pt.awayScore}, ${home} ${pt.homeScore}`,
  }
}

/**
 * The play the card rests on, in the same three rows a scrubbed play fills.
 *
 * THE LABEL CARRIES THE HONESTY. "Swing of the game" is a claim, and in a rout it is a false
 * one: nothing decided the 17-3 on Aug 14, where the biggest play moved the game eight points
 * and was merely the largest of a hundred small ones. Showing no play there and printing a
 * sentence about the absence of one is a non-answer in the most valuable space on the card. So
 * the play always shows and the label tells the truth about it: the swing of the game where
 * there was one, the biggest moment where there was not, and "so far" while the game is still
 * being played and nothing has been decided yet.
 *
 * The sentence carries the inning, because unlike a scrubbed play this one has no row of its
 * own to say when it happened.
 */
export function restingReadout(
  pt: WinProbPoint,
  game: WpblGame,
  teams: Map<string, WpblTeam>,
  canHover: boolean,
  /** Is this the play that WON it, as opposed to merely the largest swing in it? False for a
   *  game still being played and for a tie, neither of which has a winner to have swung to. */
  decided: boolean,
): Readout {
  // The words come from derive/winProbability, which is also what the play-by-play's badge
  // reads: one definition, so the chart and the list cannot call the same play two things.
  const label = swingLabel(pt.swing, decided, game.status)
  const play = playLine(playText(pt))
  return {
    // The inning goes where a scrubbed play keeps it, at the end of the label, and not on the
    // sentence: the feed's narratives already end in their own clause ("singled to left field,
    // RBI"), and hanging "in the 1st" off that reads as though the RBI happened in the 1st.
    label: `${label} · ${ordinal(pt.play.inning)}`,
    pct: pctLine(pt, game, teams),
    ...play,
    // The affordance, not the score: the final score is on the scoreboard directly above this
    // card, and somebody already holding the chart does not need to be told they can.
    note: `${canHover ? 'Hover' : 'Hold'} the chart for any play`,
  }
}

/** "6th". Innings only, so the teens never come up. */
