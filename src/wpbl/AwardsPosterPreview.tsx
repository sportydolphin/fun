// DEV-ONLY. A harness for eyeballing the fan-awards story poster and its html2canvas capture without
// a closed ballot or vote data. Its own file so none of this mock data reaches the production
// bundle: main.tsx dynamic-imports it only under `import.meta.env.DEV && ?awardsPreview`. Open
// http://localhost:<port>/?awardsPreview to see the captured PNG the export would download.
import { useEffect, useRef, useState } from 'react'
import { WinnersPoster, type PosterMode } from './AwardsWinnersExport'
import { captureNode, type ShareCardData } from './awardShareCard'
import { wpblPortrait, wpblManagerPortrait } from './portraits'

/** The real 2026 winners, so the capture is verified against the actual white-background headshots
 *  rather than a lucky mock. */
const PREVIEW_WINNERS: ShareCardData[] = [
  { category: 'Most Valuable Player', name: 'Denae Benites', portraitSrc: wpblPortrait('Denae Benites'), teamId: 'NY', initials: 'DB', detail: 'New York Heights · C', stats: [{ value: '.552', label: 'AVG' }, { value: '11', label: 'HR' }, { value: '1.752', label: 'OPS' }], pct: 41 },
  { category: 'Pitcher of the Year', name: 'Gigi Schiano', portraitSrc: wpblPortrait('Gigi Schiano'), teamId: 'BOS', initials: 'GS', detail: 'Boston Hunters', stats: [{ value: '4.72', label: 'ERA' }, { value: '10', label: 'K' }, { value: '26.2', label: 'IP' }], pct: 36 },
  { category: 'Manager of the Year', name: 'Matt Williams', portraitSrc: wpblManagerPortrait('mgr:matt-williams'), teamId: 'SF', initials: 'MW', detail: 'San Francisco Firebells', stats: [{ value: '10-5', label: 'Record' }, { value: '+35', label: 'Run diff' }], pct: 45 },
  { category: 'Defensive Wizard', name: 'Ashton Lansdell', portraitSrc: wpblPortrait('Ashton Lansdell'), teamId: 'LA', initials: 'AL', detail: 'Los Angeles Queens · 3B', stats: [{ value: '15', label: 'PO' }, { value: '28', label: 'Assists' }, { value: '3', label: 'Errors' }], pct: 31 },
  { category: 'Most Aura', name: 'Denver Bryant', portraitSrc: wpblPortrait('Denver Bryant'), teamId: 'BOS', initials: 'DB', detail: 'Boston Hunters · 3B', stats: [], pct: 40 },
]

/** One captured mode: mounts the poster off-screen on its ground and shows the PNG the export makes. */
function ModeCapture({ mode }: { mode: PosterMode }) {
  const posterRef = useRef<HTMLDivElement>(null)
  const [png, setPng] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    ;(async () => {
      await new Promise(r => requestAnimationFrame(() => r(null)))
      const node = posterRef.current
      if (!node) return
      const blob = await captureNode(node, 2)
      if (blob && alive) setPng(URL.createObjectURL(blob))
    })()
    return () => { alive = false }
  }, [])
  return (
    <div>
      <div style={{ color: '#fff', fontFamily: 'sans-serif', marginBottom: 8 }}>{mode} background:</div>
      {png
        ? <img src={png} alt={`poster-${mode}`} style={{ width: 380, display: 'block', border: '2px solid #4ade80' }} />
        : <div style={{ color: '#fbbf24', fontFamily: 'sans-serif' }}>capturing…</div>}
      <div style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none' }}>
        <WinnersPoster winners={PREVIEW_WINNERS} nodeRef={posterRef} mode={mode} />
      </div>
    </div>
  )
}

export default function AwardsPosterPreview() {
  return (
    <div style={{ background: '#222', minHeight: '100vh', padding: 24, display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <ModeCapture mode="dark" />
      <ModeCapture mode="light" />
    </div>
  )
}
