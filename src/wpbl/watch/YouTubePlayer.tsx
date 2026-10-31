import { useEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { TYPE_SCALE } from '../../ui/card'
import { markWatched, resumeAt, saveProgress } from './progress'
import { track, EVENTS } from '../../lib/analytics'
import type { WpblVideo } from '../types'

// The one player every video surface uses: the Watch video page and the lightbox.
//
// ON THE IFRAME API RATHER THAN A BARE EMBED, because a bare embed cannot say when a video ended or
// how far the reader got, so nothing could advance to the next one or pick up where they left off.
//
// ONE PLAYER, RE-AIMED WITH loadVideoById, never remounted per video. Mobile browsers allow a page to
// start sound only inside a user gesture, and a fresh iframe has not had one: remounting is what made
// every "next" a second tap on the play button. A live player keeps the permission it already has.
//
// IT NEVER STANDS IN THE WAY OF THE VIDEO. If the API script cannot load (a content blocker, a
// firewall) it falls back to the plain embed the site always used: no auto-advance and no progress,
// and the video still plays. Nothing loads from YouTube until this mounts, which only a play does.

const API_SRC = 'https://www.youtube.com/iframe_api'
const API_TIMEOUT_MS = 8000
const PROGRESS_EVERY_MS = 5000
const STATE_ENDED = 0
const STATE_PLAYING = 1
const STATE_PAUSED = 2

interface YtPlayer {
  loadVideoById(args: { videoId: string; startSeconds?: number }): void
  getCurrentTime(): number
  getDuration(): number
  getIframe(): HTMLIFrameElement
  destroy(): void
}
interface YtNamespace {
  Player: new (el: HTMLElement, options: {
    host?: string; videoId: string; width?: string; height?: string
    playerVars?: Record<string, string | number>
    events?: {
      onReady?: () => void
      onStateChange?: (e: { data: number }) => void
      onError?: (e: { data: number }) => void
    }
  }) => YtPlayer
}
declare global {
  interface Window {
    YT?: YtNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let api: Promise<YtNamespace | null> | null = null

/** The API, once for the page. Null when it cannot load, and that answer stands for the visit: a
 *  second try per video would hold each one behind the same eight seconds. */
function loadApi(): Promise<YtNamespace | null> {
  if (api) return api
  api = new Promise(resolve => {
    if (window.YT?.Player) { resolve(window.YT); return }
    const timer = setTimeout(() => resolve(null), API_TIMEOUT_MS)
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      clearTimeout(timer)
      resolve(window.YT ?? null)
    }
    const script = document.createElement('script')
    script.src = API_SRC
    script.async = true
    script.onerror = () => { clearTimeout(timer); resolve(null) }
    document.head.appendChild(script)
  })
  return api
}

const youtubeUrl = (v: WpblVideo) =>
  v.is_short === true ? `https://www.youtube.com/shorts/${v.video_id}` : `https://www.youtube.com/watch?v=${v.video_id}`

/**
 * Fills its box: the caller sizes the frame, for a 16:9 or a 9:16 video. A Short always starts from
 * the top, since a resume point in a 30-second clip is only the clip with its start cut off.
 */
export function YouTubePlayer({ video, onEnded }: { video: WpblVideo; onEnded?: () => void }) {
  const id = video.video_id
  const start = () => (video.is_short === true ? 0 : resumeAt(id))
  const box = useRef<HTMLDivElement>(null)
  const player = useRef<YtPlayer | null>(null)
  const ready = useRef(false)
  const current = useRef(video)
  current.current = video
  const ended = useRef(onEnded)
  ended.current = onEnded
  const [mode, setMode] = useState<'api' | 'plain'>('api')
  const [broken, setBroken] = useState<string | null>(null)

  const save = () => {
    const p = player.current
    if (!p || !ready.current) return
    try { saveProgress(current.current.video_id, p.getCurrentTime(), p.getDuration()) } catch { /* the player is going away */ }
  }

  useEffect(() => {
    let live = true
    let tick: ReturnType<typeof setInterval> | undefined
    const stopTick = () => { if (tick) clearInterval(tick); tick = undefined }
    void loadApi().then(YT => {
      if (!live || !box.current) return
      if (!YT) { setMode('plain'); return }
      // A child made here rather than in JSX, because the API replaces this element with its iframe
      // and React must not be left holding a node that has gone.
      const host = document.createElement('div')
      box.current.appendChild(host)
      const first = current.current
      player.current = new YT.Player(host, {
        host: 'https://www.youtube-nocookie.com',
        videoId: first.video_id,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 1, rel: 0, modestbranding: 1,
          // Without it iOS Safari takes the video to its own fullscreen player on play, which for
          // a Short means leaving the page, next, previous and the title all at once.
          playsinline: 1,
          start: first.is_short === true ? 0 : resumeAt(first.video_id),
        },
        events: {
          onReady: () => {
            ready.current = true
            if (player.current) player.current.getIframe().title = current.current.title
          },
          onStateChange: e => {
            stopTick()
            if (e.data === STATE_PLAYING) tick = setInterval(save, PROGRESS_EVERY_MS)
            if (e.data === STATE_PAUSED) save()
            if (e.data === STATE_ENDED) {
              const v = current.current
              let duration = 0
              try { duration = player.current?.getDuration() ?? 0 } catch { /* the player is going away */ }
              markWatched(v.video_id, duration)
              track(EVENTS.WPBL_VIDEO_ENDED, { videoId: v.video_id, kind: v.kind })
              ended.current?.()
            }
          },
          // 100 is removed or private; 101 and 150 are its owner refusing embeds.
          onError: e => { if ([100, 101, 150].includes(e.data)) setBroken(current.current.video_id) },
        },
      })
    })
    return () => {
      live = false
      stopTick()
      save()
      ready.current = false
      try { player.current?.destroy() } catch { /* already gone */ }
      player.current = null
    }
    // Once: the video changing is the next effect's job, which is the whole point of this design.
  }, [])

  const aimed = useRef(id)
  useEffect(() => {
    if (aimed.current === id) return
    aimed.current = id
    const p = player.current
    if (!p || !ready.current) return
    p.loadVideoById({ videoId: id, startSeconds: start() })
    try { p.getIframe().title = current.current.title } catch { /* not attached yet */ }
    // `start` reads only the video this effect is keyed on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const fill = { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 } as const
  return (
    <Box ref={box} sx={{ ...fill, bgcolor: '#000', '& iframe': fill }}>
      {mode === 'plain' && (
        <Box
          key={id}
          component="iframe"
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
          title={video.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          sx={fill}
        />
      )}
      {broken === id && (
        <Box sx={{ ...fill, zIndex: 1, bgcolor: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, p: 2, textAlign: 'center' }}>
          <Typography sx={{ color: '#fff', fontSize: TYPE_SCALE.body, fontWeight: 700 }}>Not playable here</Typography>
          <Box component="a" href={youtubeUrl(video)} target="_blank" rel="noopener noreferrer"
            sx={{ color: '#fff', fontSize: TYPE_SCALE.meta, fontWeight: 700 }}>Watch on YouTube ↗</Box>
        </Box>
      )}
    </Box>
  )
}
