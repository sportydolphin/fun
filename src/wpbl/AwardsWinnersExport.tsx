// Owner and testers: export every fan-award winner as one shareable poster.
//
// WHY IT IS ITS OWN FILE. The gate is a role check, and FanVote.tsx (which renders this) must
// stay free of `useIsAdmin`/`useHasRole`: routes.test.ts pins that, because a role check that
// crept into the ballot would hide the whole poll from every fan while the sitemap kept sending
// them to it. Keeping the gate here means FanVote imports a component, not a hook, and the ballot
// stays open to everyone while only the owner and testers see the export button.
//
// A ONE-PAGE STORY, one winner per row. The per-result Share button draws a square card; this draws
// a phone-shaped poster (1080 wide, story proportions) with each winner as a wide, short row so the
// whole slate reads down one column. Same `ShareCardData` and the same `captureNode` (which loads
// the font before rasterising and composites every face at full resolution), so the two surfaces
// cannot drift on who won or on how a face is drawn.
import { useEffect, useRef, useState, type CSSProperties, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { Box, Typography, Menu, MenuItem, ListItemIcon } from '@mui/material'
import { EmojiEvents, Download, LightMode, DarkMode } from '@mui/icons-material'
import { useIsAdmin } from '../lib/admin'
import { useIsTester } from '../lib/roles'
import { WinnerShareRow, captureNode, downloadBlob, type ShareCardData } from './awardShareCard'
import { FOCUS_RING, TAPPABLE, TYPE_SCALE, chromePx, hoverOnly } from './ui'

/** The reader picks the ground the poster sits on when they export. Only the ground and the text
 *  ON it (masthead, footer) change; the winner rows carry their own club colours and read on either.
 *  The footer's dolphin mark is a black frame with a white dolphin, so it needs a chip of the
 *  OPPOSITE tone to stay visible: a white chip on the dark ground, a dark chip on the light one. */
export type PosterMode = 'light' | 'dark'
const POSTER_THEME: Record<PosterMode, { bg: string; text: string; subtext: string; chip: string; gold: string }> = {
  // `gold` is the trophy and the awards line. The bright #eab308 pops on the dark ground but washes
  // out on white, so light takes a darker amber (amber-700) that reads as gold and still has contrast.
  dark: { bg: '#0b0f14', text: '#f4f6f8', subtext: 'rgba(255,255,255,0.9)', chip: '#fff', gold: '#eab308' },
  light: { bg: '#f4f6f8', text: '#0b0f14', subtext: 'rgba(11,15,20,0.72)', chip: '#0b0f14', gold: '#a16207' },
}

const POSTER_FILENAME = (mode: PosterMode) => `wpbl-fan-awards-2026-winners-${mode}.png`
/** Instagram-story proportions: 1080 wide, a 16:9-tall frame the content is centred inside so a
 *  short slate reads as a poster rather than floating at the top, while a long one grows past it and
 *  still shares fine. Fixed px so the export is identical for every reader regardless of text scale. */
const POSTER_W = 1080
const POSTER_MIN_H = 1920
const POSTER_PAD = 48
/** Space between the rows, and the wider space between the three blocks (title, rows, footer). */
const ROW_GAP = 20
const BLOCK_GAP = 52

/** The masthead: trophy, the awards line in gold, the year line large. Centred at the top of the
 *  page above the rows. The gold stays gold on either ground; the year line takes the theme text. */
function PosterHeader({ theme }: { theme: typeof POSTER_THEME[PosterMode] }) {
  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      gap: '14px', color: theme.text,
    }}>
      <EmojiEvents sx={{ fontSize: 104, color: theme.gold }} />
      {/* Literal caps, not text-transform: html2canvas drops leading glyphs from a letter-spaced
          transformed run (see captureNode). */}
      <Box sx={{ fontSize: 34, fontWeight: 900, letterSpacing: 4, color: theme.gold, lineHeight: 1 }}>
        WPBL FAN AWARDS
      </Box>
      <Box sx={{ fontSize: 76, fontWeight: 900, letterSpacing: 0.5, lineHeight: 1.02 }}>
        2026 Winners
      </Box>
    </Box>
  )
}

/** The footer wordmark, centred under the rows. The mark's chip flips with the ground so the black
 *  frame and white dolphin always sit on a contrasting tile. */
function PosterFooter({ theme }: { theme: typeof POSTER_THEME[PosterMode] }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', bgcolor: theme.chip, borderRadius: '4px', p: '2px' }}>
        <Box component="img" src="/logo-mark.png" alt="" sx={{ height: 24, width: 'auto', display: 'block' }} />
      </Box>
      <Box component="span" sx={{ fontSize: 22, fontWeight: 800, color: theme.subtext, letterSpacing: 0.3, fontFamily: '"Inter", system-ui, sans-serif' }}>
        sportydolphin.fun
      </Box>
    </Box>
  )
}

/** The off-screen poster. Story proportions, the masthead and footer bracketing one column of winner
 *  rows, on the ground the reader chose. Centred in a 16:9-tall frame so a short slate sits as a
 *  poster and a long one grows past it. `--app-chrome:1` for the same reason the rows force it:
 *  portraits must render at exactly their px. */
export function WinnersPoster({ winners, nodeRef, mode = 'dark' }: { winners: ShareCardData[]; nodeRef: Ref<HTMLDivElement>; mode?: PosterMode }) {
  const theme = POSTER_THEME[mode]
  return (
    <Box
      ref={nodeRef}
      style={{ ['--app-chrome' as string]: '1' } as CSSProperties}
      sx={{
        width: POSTER_W, minHeight: POSTER_MIN_H, boxSizing: 'border-box', p: `${POSTER_PAD}px`,
        backgroundColor: theme.bg, fontFamily: '"Inter", system-ui, sans-serif',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: `${BLOCK_GAP}px`,
      }}
    >
      <PosterHeader theme={theme} />
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: `${ROW_GAP}px` }}>
        {winners.map(w => <WinnerShareRow key={w.category} data={w} />)}
      </Box>
      <PosterFooter theme={theme} />
    </Box>
  )
}

/**
 * The button, for the owner and testers. Nothing renders for anyone else, and nothing renders with
 * no winners to draw (a ballot nobody has voted in): an empty poster is not worth a button.
 */
export default function AwardsWinnersExport({ winners }: { winners: ShareCardData[] }) {
  // Both hooks run unconditionally, then OR: testers get the export while it is still a
  // tester-facing tool, and the owner always has it.
  const canExport = useIsAdmin() || useIsTester()
  const posterRef = useRef<HTMLDivElement>(null)
  // `mode` is null until the reader picks one from the menu; setting it (with the menu closed) is what
  // mounts the poster on that ground and kicks off the capture. Back to null when the capture is done.
  const [mode, setMode] = useState<PosterMode | null>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const busy = mode !== null

  // Capture once the poster is mounted on the chosen ground, then tear it down. The portal exists
  // only while a mode is set, so five big rows are not sitting off-screen the rest of the time.
  useEffect(() => {
    if (mode === null) return
    let alive = true
    ;(async () => {
      // A frame so the rows have laid out and the faces are in the DOM before html2canvas reads it.
      await new Promise(r => requestAnimationFrame(() => r(null)))
      const node = posterRef.current
      if (!node) { if (alive) setMode(null); return }
      try {
        // scale 2, not the single card's 3: the poster is already 1080px wide and story-tall, so a
        // third pass buys sharper TYPE nobody reads at that size for a much larger PNG and a canvas
        // that can trip a browser's max-area cap on a tall slate.
        const blob = await captureNode(node, 2)
        if (blob) downloadBlob(blob, POSTER_FILENAME(mode))
      } catch (e) {
        console.warn('[awards] winners poster capture failed:', e)
      } finally {
        if (alive) setMode(null)
      }
    })()
    return () => { alive = false }
  }, [mode])

  if (!canExport || winners.length === 0) return null

  const pick = (m: PosterMode) => { setAnchor(null); setMode(m) }

  return (
    <>
      <Box
        role="button"
        tabIndex={0}
        onClick={(e) => { if (!busy) setAnchor(e.currentTarget) }}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); setAnchor(e.currentTarget) } }}
        aria-haspopup="menu"
        aria-label="Export all winners as one image"
        title="Download every winner as one poster for social"
        sx={{
          ...TAPPABLE, ...FOCUS_RING, alignSelf: 'flex-start', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: chromePx(6),
          borderRadius: 999, px: chromePx(12), py: chromePx(6),
          border: '1px dashed', borderColor: 'var(--wpbl-accent-solid)', color: 'var(--wpbl-accent-solid)',
          ...hoverOnly({ bgcolor: 'var(--wpbl-accent-solid)', color: '#fff', borderStyle: 'solid' }),
        }}
      >
        <Download sx={{ fontSize: TYPE_SCALE.body }} />
        <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: 0.3 }}>
          {busy ? 'Exporting…' : `Export ${winners.length} winners`}
        </Typography>
      </Box>
      {/* Above the awards ModalShell (zIndex 1500), or the menu opens BEHIND the sheet that hosts
          this button and clicking Export looks dead. */}
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} sx={{ zIndex: 1700 }}>
        <MenuItem onClick={() => pick('dark')}>
          <ListItemIcon><DarkMode fontSize="small" /></ListItemIcon>
          Dark background
        </MenuItem>
        <MenuItem onClick={() => pick('light')}>
          <ListItemIcon><LightMode fontSize="small" /></ListItemIcon>
          Light background
        </MenuItem>
      </Menu>
      {busy && createPortal(
        <div style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none', zIndex: -1 }}>
          <WinnersPoster winners={winners} nodeRef={posterRef} mode={mode} />
        </div>,
        document.body,
      )}
    </>
  )
}
