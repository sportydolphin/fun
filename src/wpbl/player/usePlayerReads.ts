import { startTransition, useEffect, useState } from 'react'
import { fetchWpblPlayerLines, fetchWpblPitcherLocations, getSeedWpblPlayerLines, getCachedWpblPitcherLocations, fetchWpblArticles, getCachedWpblArticles, fetchWpblAllLines, getCachedWpblAllLines, fetchWpblPlayerMatchupPlays, getCachedWpblPlayerMatchupPlays, type WpblPitchLoc } from '../api'
import { fetchWpblAwardResults, getCachedWpblAwardResults, fanAwardsWon } from '../awardVotes'
import type { WpblAward } from '../awards'
import type { WpblBoard, WpblBoardInput } from '../searchAnswers'
import type { WpblPlayer, WpblBattingLine, WpblPitchingLine, WpblFieldingLine, WpblArticle } from '../types'

// The player card's reads. Each is seeded from the session caches on the card's first render, so
// it can draw its finished shape at once, and revalidated behind that.

/**
 * Apply a read that resolved after the card mounted.
 *
 * A TRANSITION, because these land while the sheet is still rising. Each one re-renders the whole
 * card, about 115ms on a mid-range phone, and an ordinary update does that in one block that the
 * sheet's slide and the backdrop's fade have to wait out. A transition lets React do it in slices
 * between frames. Together with handing back the previous value when nothing changed (most of
 * these are cache hits returning what the card was seeded with), it keeps the slide smooth.
 */
const lateUpdate = startTransition

function sameIds(a: { id: string }[], b: { id: string }[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id)
}

/** Same rows, field for field, for a re-read of rows the card already holds. Shallow: every field
 *  on a line is a scalar. */
function sameRows<T extends object>(a: T[], b: T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i] as Record<string, unknown>
    const xr = x as Record<string, unknown>
    const keys = Object.keys(xr)
    return keys.length === Object.keys(y).length && keys.every(k => xr[k] === y[k])
  })
}

export function usePlayerAwards(playerId: string): WpblAward[] {
  // The fan awards this player won, for the ribbon under their name. The tally read is shared and
  // cached app-wide (Home reads it for the results card), and it fails to empty, so a player page
  // never waits on it or breaks for it: the ribbon simply arrives, or does not.
  //
  // Seeded from the last tally that landed, so an award winner's band rises at its final height
  // rather than growing a row of chips mid-slide; see lateUpdate for the rest of the rule.
  const awardsFor = (id: string) => {
    const r = getCachedWpblAwardResults()
    return r ? fanAwardsWon(r, id) : []
  }
  const [awards, setAwards] = useState<WpblAward[]>(() => awardsFor(playerId))
  useEffect(() => {
    let cancelled = false
    setAwards(prev => sameIds(prev, awardsFor(playerId)) ? prev : awardsFor(playerId))
    fetchWpblAwardResults().then(r => {
      if (cancelled) return
      const won = fanAwardsWon(r, playerId)
      lateUpdate(() => setAwards(prev => (sameIds(prev, won) ? prev : won)))
    })
    return () => { cancelled = true }
  }, [playerId])
  return awards
}

export function usePlayerMatchupPlays(player: WpblPlayer) {
  // Every plate appearance she took part in, for the matchup tables: her own narrow read, or her
  // slice of the league log when another page already has it (see fetchWpblPlayerMatchupPlays).
  // Starts beside the player's own lines rather than after them, so the tables land with the
  // rest of the card instead of pushing the game log down a second later.
  const [matchupPlays, setMatchupPlays] = useState(() => getCachedWpblPlayerMatchupPlays(player))
  useEffect(() => {
    let cancelled = false
    fetchWpblPlayerMatchupPlays(player)
      .then(p => { if (!cancelled) lateUpdate(() => setMatchupPlays(p)) })
      .catch(() => { /* tables omit themselves */ })
    return () => { cancelled = true }
  }, [player])
  return matchupPlays
}

export function useLeagueReads() {
  // Every batting and pitching line in the league, for the percentile strip. Deliberately a
  // separate piece of state from the player's own lines: this one is allowed to never arrive.
  // `fetchWpblAllLines` is cached, deduped and already prefetched when the section lands on
  // Home, so for most readers this is a cache hit and costs nothing; for the rest the ranks
  // simply appear a moment after the totals, and if it fails they never appear at all and the
  // page is exactly what it was before.
  const [leagueLines, setLeagueLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] } | null>(
    () => getCachedWpblAllLines())
  // Posts that name this player. Seeded from the shared cache so reopening a player is
  // instant, then revalidated. Most players are never written about, and for them the
  // section below simply doesn't render.
  const [articles, setArticles] = useState<WpblArticle[]>(() => getCachedWpblArticles() ?? [])

  useEffect(() => {
    let cancelled = false
    fetchWpblArticles().then(a => { if (!cancelled) lateUpdate(() => setArticles(a)) }).catch(() => { /* keep last-good */ })
    fetchWpblAllLines()
      .then(l => {
        if (cancelled) return
        // Usually the very arrays the initializer was seeded with, in which case this is no change.
        lateUpdate(() => setLeagueLines(prev => (prev && prev.batting === l.batting && prev.pitching === l.pitching ? prev : { batting: l.batting, pitching: l.pitching })))
      })
      .catch(() => { /* no ranks; the totals stand on their own */ })
    return () => { cancelled = true }
  }, [])
  return { leagueLines, articles }
}

/** The player's own lines and tracked pitches. `onSwap` runs, during render, when the mounted card
 *  is handed a different player, to reset what else on the card belonged to the last one. */
export function usePlayerLines(player: WpblPlayer, onSwap: () => void) {
  // SEEDED FROM THE SESSION CACHE, ON THE FIRST RENDER OF EVERY MOUNT.
  //
  // This card is a modal: closing it UNMOUNTS it, so reopening the same player is a fresh
  // mount and not a prop change. An initial value of `[]` with `loading: true` would therefore
  // spin again on every open, however recently the same season had been read. Lazy initializers,
  // because `player` is a prop and is available before the first paint; the effect below still
  // runs and revalidates behind whatever this put on screen.
  const seeded = getSeedWpblPlayerLines(player.id)
  const [loading, setLoading] = useState(!seeded)
  const [allBatting, setBatting] = useState<WpblBattingLine[]>(() => seeded?.batting ?? [])
  const [allPitching, setPitching] = useState<WpblPitchingLine[]>(() => seeded?.pitching ?? [])
  const [allFielding, setFielding] = useState<WpblFieldingLine[]>(() => seeded?.fielding ?? [])
  const [pitchLocs, setPitchLocs] = useState<WpblPitchLoc[]>([])

  // Every official-feed id this player has held. `api_id` alone is only the id for the player's
  // CURRENT club, and the feed mints a new one per club. The joined string IS the value passed on:
  // it is stable across re-renders where an array would not be, and it is the cache key on the
  // other side, so the two ends agree by construction.
  const feedKey = [...new Set([...(player.api_ids ?? []), player.api_id].filter(Boolean))].sort().join(',')

  // ─── Reopening a player is instant ─────────────────────────────────────────
  //
  // This card is reached from a leaderboard, which is a list of twenty of them: open, read,
  // close, open the next, come back to the first. Without a cache every one of those is a fresh
  // three-table read behind a spinner, on a season that does not change between two taps.
  //
  // THE OTHER PATH IN. The state above covers opening the card; this covers the card being
  // handed a different player while it stays mounted, which is what the "did you mean" results
  // and the next/previous controls do. Seeded DURING RENDER, not in an effect, for the same
  // reason the team rail is: an effect runs after the browser has painted, so seeding there
  // would still show a frame of spinner, or of the previous player's numbers under this
  // player's name. Cache miss falls back to the spinner, which is right for a player nobody has
  // opened.
  const [shownPlayer, setShownPlayer] = useState(player.id)
  if (shownPlayer === player.id && pitchLocs.length === 0) {
    // Seeded here rather than in the initializer above because it is keyed on `feedKey`, which
    // is derived a few lines further down and cannot be read before it exists.
    const locs = getCachedWpblPitcherLocations(feedKey)
    if (locs && locs.length > 0) setPitchLocs(locs)
  }
  if (shownPlayer !== player.id) {
    setShownPlayer(player.id)
    const seed = getSeedWpblPlayerLines(player.id)
    setBatting(seed?.batting ?? []); setPitching(seed?.pitching ?? []); setFielding(seed?.fielding ?? [])
    setLoading(!seed)
    setPitchLocs(getCachedWpblPitcherLocations(feedKey) ?? [])
    onSwap()
  }

  useEffect(() => {
    let cancelled = false
    fetchWpblPlayerLines(player.id).then(({ batting, pitching, fielding }) => {
      if (cancelled) return
      // A card seeded from the league-wide read gets the same rows back as new arrays; keeping the
      // old ones when nothing differs is what stops that from re-rendering the card mid-slide.
      lateUpdate(() => {
        setBatting(prev => (sameRows(prev, batting) ? prev : batting))
        setPitching(prev => (sameRows(prev, pitching) ? prev : pitching))
        setFielding(prev => (sameRows(prev, fielding) ? prev : fielding))
        setLoading(false)
      })
    })
    // Pitch-location tracking keys on the feed id; empty for non-pitchers / unmapped players.
    // Every id she has held, not just the current one, so a trade does not erase the half of
    // her season she threw under the old club's id.
    fetchWpblPitcherLocations(feedKey).then(locs => { if (!cancelled) lateUpdate(() => setPitchLocs(prev => (sameRows(prev, locs) ? prev : locs))) })
    return () => { cancelled = true }
  }, [player.id, feedKey])
  return { loading, allBatting, allPitching, allFielding, pitchLocs }
}

/**
 * The Stats table's own board for the span on the card (a season, or null for the career), for the
 * figures only the league can price: wOBA, wRC+ and FIP from its run values, and WAR.
 *
 * THE SEARCH BOX'S BOARD, NOT A THIRD COPY OF THE ARITHMETIC (searchAnswers.ts): the stored season
 * rows when they are current, which is one small read, else the same engines the table runs. So the
 * card, the table and the search answer can never print three different WARs for one player.
 *
 * AFTER THE CARD, NEVER BEFORE IT. Undefined until it lands, null if it failed: the card draws the
 * cells as samples until then, and as a dash after a failure. Imported on use, so the engines stay
 * out of the card's chunk, and kept per span for the session, so swapping players down a list in
 * the side panel builds it once.
 */
export function usePlayerBoard(base: Omit<WpblBoardInput, 'lines' | 'env' | 'plays'> | null): WpblBoard | null | undefined {
  const key = base && base.schedule.length > 0 && base.players.length > 0
    ? `${base.season ?? 'career'}:${base.schedule.length}:${base.players.length}:${base.eraBasis}`
    : null
  const [read, setRead] = useState<{ key: string; board: WpblBoard | null } | null>(() => {
    const done = key ? boardsDone.get(key) : undefined
    return key && done !== undefined ? { key, board: done } : null
  })
  useEffect(() => {
    if (!key || !base) return
    let cancelled = false
    let p = boardsInFlight.get(key)
    if (!p) {
      p = import('../searchAnswers')
        .then(m => m.loadWpblBoard(base, { weights: true, plays: true }))
        .catch(() => null)
        // A failure is not kept: the next card to open tries again rather than dashing for the visit.
        .then(b => { if (b) boardsDone.set(key, b); else boardsInFlight.delete(key); return b })
      boardsInFlight.set(key, p)
    }
    p.then(board => { if (!cancelled) lateUpdate(() => setRead({ key, board })) })
    return () => { cancelled = true }
    // `base` is rebuilt every render; the key is everything in it that changes the board.
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return read && read.key === key ? read.board : undefined
}
const boardsInFlight = new Map<string, Promise<WpblBoard | null>>()
const boardsDone = new Map<string, WpblBoard | null>()
