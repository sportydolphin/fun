import { useEffect, useRef, useState } from 'react'
import { fetchWpblAllRunValuePlays } from '../api'
import type { BestGame, BigClip } from './rankings'
import type { WpblGame, WpblVideo, WpblVideoTag } from '../types'

// Best games and Biggest plays, computed only once a reader comes near them. They need the whole play
// log and the win model, the heaviest things on the site, and a reader who presses play on the first
// video should not pay for two rows further down. Nearly everyone reaches them on a desktop, where the
// margin takes them in on arrival; a phone waits for a scroll.

const NEAR_PX = 800

export interface WatchRankings { bestGames: BestGame[]; biggestPlays: BigClip[] }

/** `rankings` is null until they are ready, and stays null if the reads fail: the caller holds the
 *  rows' room until then, and takes them away if `failed`. `sentinel` goes on an element above them. */
export function useWatchRankings(videos: readonly WpblVideo[] | null, clips: readonly WpblVideo[], games: WpblGame[],
  tags: Map<string, WpblVideoTag>, tagsReady: boolean) {
  const sentinel = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [rankings, setRankings] = useState<WatchRankings | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = sentinel.current
    if (!el || near) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setNear(true)
    }, { rootMargin: `${NEAR_PX}px` })
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  useEffect(() => {
    if (!near || !videos || !tagsReady || games.length === 0) return
    let live = true
    Promise.all([fetchWpblAllRunValuePlays(null), import('./rankings')])
      .then(([plays, r]) => {
        if (!live) return
        setRankings({ bestGames: r.bestGames(plays, games, videos), biggestPlays: r.biggestPlays(plays, games, clips, tags) })
      })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [near, videos, clips, games, tags, tagsReady])

  return { sentinel, rankings, failed }
}
