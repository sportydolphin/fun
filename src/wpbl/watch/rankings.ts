import { gameWinProb, swingOfGame, wildestGames, winProbModel, type WildGame } from '../derive/winProbability'
import { REGULATION_INNINGS } from '../innings'
import { gameVideos } from '../videoChannels'
import type { WpblGame, WpblRunValuePlay, WpblVideo, WpblVideoTag } from '../types'

// The two Watch rows that need the win-probability model, kept in a module of their own so the page
// imports it only when a reader scrolls near them (useWatchRankings). What they rank is what no video
// site can: how much a game or a play actually mattered, from the play log rather than a view count.

export interface BestGame {
  game: WpblGame
  /** What to press play on. The condensed game over the reel: a reader sent here to watch a good
   *  game wants the game, and the reel is cut down to the runs. */
  video: WpblVideo
  /** The queue entry for every video of this game is the shelf's, so next goes to the next best game. */
  facts: string
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** Lead changes, ties and extra innings. Never the score: this row exists to be watched cold. */
export function bestGameFacts(wild: Pick<WildGame<unknown>, 'leadChanges' | 'ties' | 'innings'>): string {
  return [
    wild.innings > REGULATION_INNINGS ? 'Extra innings' : null,
    wild.leadChanges > 0 ? plural(wild.leadChanges, 'lead change') : null,
    wild.ties > 0 ? plural(wild.ties, 'tie') : null,
  ].filter(Boolean).join(' · ')
}

/**
 * Finished games with a video, loudest first, on `wildestGames`' ranking. Every season at once: Watch
 * is a catalog with no season on screen, and this ranks games rather than summing anything. Postseason
 * included, for the reason the season page gives: the final is where a reader looks first.
 */
export function bestGames(plays: WpblRunValuePlay[], games: WpblGame[], videos: readonly WpblVideo[]): BestGame[] {
  if (plays.length === 0) return []
  const wild = wildestGames(winProbModel(plays, games), plays, games.filter(g => g.status === 'final'))
  const out: BestGame[] = []
  for (const w of wild) {
    const list = gameVideos(videos, w.game.id).filter(v => v.is_short !== true)
    const video = list.find(v => v.kind === 'condensed') ?? list[0]
    if (video) out.push({ game: w.game, video, facts: bestGameFacts(w) })
  }
  return out
}

export interface BigClip {
  video: WpblVideo
  /** How far the play moved win probability, in points, whichever way. */
  points: number
  /** From `swingOfGame`, only when this is the play its game turned on. */
  label: string | null
}

/**
 * Clips pinned to a play, by how far that play moved win probability. Only a pinned clip can be on it:
 * a clip placed in a game but not an at-bat has no play to price, and a guess would be a false claim
 * about a real moment. The label is `swingOfGame`'s, which says "Biggest moment" rather than "Swing of
 * the game" where a rout was never in doubt, so this row cannot claim otherwise.
 */
export function biggestPlays(
  plays: WpblRunValuePlay[], games: WpblGame[], clips: readonly WpblVideo[], tags: ReadonlyMap<string, WpblVideoTag>,
): BigClip[] {
  if (plays.length === 0) return []
  const model = winProbModel(plays, games)
  const pinned = clips.filter(v => tags.get(v.video_id)?.play_sequence != null && tags.get(v.video_id)?.game_id)
  const wanted = new Set(pinned.map(v => tags.get(v.video_id)!.game_id!))
  const byGame = new Map<string, WpblRunValuePlay[]>()
  for (const p of plays) {
    if (!wanted.has(p.game_id)) continue
    const arr = byGame.get(p.game_id)
    if (arr) arr.push(p); else byGame.set(p.game_id, [p])
  }
  const gameById = new Map(games.map(g => [g.id, g]))
  const wps = new Map<string, ReturnType<typeof gameWinProb>>()
  const out: BigClip[] = []
  for (const video of pinned) {
    const tag = tags.get(video.video_id)!
    const gameId = tag.game_id!
    const game = gameById.get(gameId)
    const gamePlays = byGame.get(gameId)
    if (!game || !gamePlays) continue
    const wp = wps.get(gameId) ?? gameWinProb(model, gamePlays, game)
    wps.set(gameId, wp)
    const point = wp.points.find(pt => pt.play.sequence === tag.play_sequence)
    if (!point) continue
    const swing = swingOfGame(wp, game.status)
    out.push({ video, points: Math.round(Math.abs(point.swing) * 100), label: swing?.point === point ? swing.label : null })
  }
  // Newest first on a tie, so the order holds still between visits.
  return out.sort((a, b) => b.points - a.points || b.video.published_at.localeCompare(a.video.published_at))
}
