// The branded picture of a fan-award result, and the capture that turns it into a PNG.
//
// A LEAF MODULE ON PURPOSE. Both surfaces that export awards art use this: FanVote's per-result
// Share button (one card) and AwardsWinnersExport's admin-only "all winners" poster (a grid of
// them). Keeping the card, the capture and the browser-capability probes here means neither of
// those imports the other, so the admin gate in AwardsWinnersExport never leaks into FanVote,
// which routes.test.ts pins must contain no `useIsAdmin`/`useHasRole`.
//
// The card and the capture were lifted out of FanVote. Faces are plain <img>s that html2canvas
// draws itself (see PORTRAIT FRAMING); `captureNode` only has to decode every <img> before the
// capture runs, so the same routine serves a single card and a whole poster of them alike.
import { useEffect, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Box } from '@mui/material'
import { EmojiEvents } from '@mui/icons-material'
import { wpblColor, wpblSecondary } from './constants'

/** Everything a share card needs, pre-resolved so the card itself is presentational and the
 *  capture is deterministic (fixed px, no dependence on the reader's text or chrome scale). */
export interface ShareCardData {
  category: string
  name: string
  /** The winner's face, already resolved to a plain URL. The card draws it as a background image
   *  rather than an <img>, because html2canvas 1.4 mishandles srcSet + object-fit and rendered the
   *  portrait blank; background-size: cover it renders correctly. */
  portraitSrc: string | null
  /** The winner's club, for the background gradient and the portrait's fallback fill. */
  teamId: string | null
  /** Initials for a winner with no bundled face. */
  initials: string
  detail: string
  stats: { value: string; label: string }[]
  pct: number
}

/**
 * The branded picture of one result, laid out at a fixed pixel size for html2canvas.
 *
 * EXPLICIT px, NOT THE SECTION'S SCALE. Everything on the sheet is sized in rem against
 * `--app-type` and structural px against `--app-chrome`, both of which the reader can move; a
 * capture target must not, or the same result would export at different sizes for different
 * readers. So this card hardcodes its type and spacing and forces `--app-chrome: 1` on its root,
 * which is also what keeps the portrait a known size. Dark ground on purpose: a share image is
 * seen outside the app, where it should look like itself rather than like whoever's light setting.
 */
export const SHARE_W = 540
export const SHARE_H = 540

/** PORTRAIT FRAMING. The face is a plain <img> that fills a circular, club-coloured, ringed frame,
 *  the same shape PlayerPortrait draws everywhere else on the site, which is what the section asked
 *  these to match.
 *
 *  WHY A PLAIN <img>, AND WHY NOT THE THINGS TRIED BEFORE. A CSS `background-image` renders
 *  unreliably under html2canvas on a large or tall canvas: the all-winners poster came out with
 *  blank white discs and no ring while the small single card was fine. Compositing the faces onto
 *  the finished canvas by hand (drawImage in a loop) was worse in a subtler way: it silently dropped
 *  every face past the first two or three on a memory-pressured browser, because each draw onto the
 *  poster-sized canvas is a resource the engine can refuse without erroring. A plain <img> is the one
 *  thing html2canvas draws dependably: it is how the footer wordmark renders, and that survived every
 *  export that lost the faces. html2canvas clips it to the border-radius circle and paints the CSS
 *  ring over it, so the frame needs no canvas work at all.
 *
 *  NO object-fit. The cut-out headshots are 512 squares and the frame is square, so the image fills
 *  it exactly with nothing to fit: the transparent margin above a cap lands on the club-colour fill,
 *  and the whole head is in frame (a tight crop used to push a light cap panel up against the ring
 *  and read as a white band). object-fit is also one of the properties html2canvas mishandles, so
 *  leaving it off is both correct and safer. */
/** The poster's winner cards are TALLER than the square standalone card. The all-winners poster is
 *  one column on a phone, so it can be as tall as it likes, and the extra height lets the enlarged
 *  mobile type and portrait breathe rather than clipping against a square. The title tile matches
 *  it so the grid rows stay even. */
export const POSTER_CARD_H = 620

export function WinnerShareCard({ data, hideBrand = false }: {
  data: ShareCardData
  /** Drop the branding: the "WPBL Fan Awards" eyebrow AND the footer wordmark. The standalone Share
   *  card needs both, since it is a lone square seen off-site; the all-winners poster carries the
   *  eyebrow and the wordmark ONCE in its title tile, so repeating them on every card is noise. */
  hideBrand?: boolean
}) {
  const { category, name, detail, stats, pct, portraitSrc, teamId, initials } = data
  // The club's colours: primary behind the photo, secondary as the portrait ring (the one place
  // the second colour appears now that the background is a plain dark ground).
  const primary = wpblColor(teamId)
  const secondary = wpblSecondary(teamId)
  // The poster cards (no eyebrow, no footer) are centre-ALIGNED to match the title tile in the
  // grid's empty cell: portrait on top, everything stacked and centred. The standalone Share card
  // keeps the portrait beside a left-aligned name, which reads better as a lone square.
  const centered = hideBrand
  return (
    <Box
      // Force the chrome scale to 1 so PlayerPortrait/TeamBadge render at exactly the px asked for.
      style={{ ['--app-chrome' as string]: '1' } as CSSProperties}
      sx={{
        width: SHARE_W, height: centered ? POSTER_CARD_H : SHARE_H, boxSizing: 'border-box', p: '34px',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: '"Inter", system-ui, sans-serif', color: '#f4f6f8',
        // The whole card in the club's primary (a near-black team colour), with the secondary as
        // the portrait ring. Square corners, so the exported PNG is a full square rather than one
        // with transparent rounded corners.
        backgroundColor: primary,
        position: 'relative',
      }}
    >
      {/* Header: the award mark beside the section name. Dropped on the poster, which carries this
          line once in its own title. */}
      {!hideBrand && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <EmojiEvents sx={{ fontSize: 22, color: '#eab308' }} />
          <Box component="span" sx={{
            fontSize: 15, fontWeight: 800, letterSpacing: 2, color: '#aeb6bf',
          }}>WPBL FAN AWARDS</Box>
        </Box>
      )}

      {/* THE MIDDLE, VERTICALLY CENTRED. Category, then the winner, then the big share, as one block
          in the middle of the card. On the poster it is also centre-ALIGNED across the card. */}
      <Box sx={{
        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '22px', minWidth: 0,
        alignItems: centered ? 'center' : 'stretch', textAlign: centered ? 'center' : 'left',
      }}>
        <Box component="div" sx={{
          // The club's SECONDARY colour, not the accent: on a card washed in the primary, the
          // accent can be the same hue (Boston green on green) and vanish. The secondary is the
          // contrasting brand colour (Boston orange), which is also the ring and the pop here.
          // data-caption + pre-uppercased: captureNode repaints this line with the Canvas API, since
          // html2canvas drops leading words from it on some browsers (see captureNode).
          fontSize: centered ? 36 : 32, fontWeight: 900, letterSpacing: 1,
          color: secondary, lineHeight: 1.1,
        }} data-caption="1">{category.toUpperCase()}</Box>

        {/* The winner. The face is a plain <img> filling a circular, club-coloured, ringed frame:
            see PORTRAIT FRAMING for why an <img> and not a background image or a canvas composite. */}
        <Box sx={{
          display: 'flex', alignItems: 'center', minWidth: 0,
          flexDirection: centered ? 'column' : 'row', gap: centered ? '14px' : '20px',
          ...(centered ? { alignSelf: 'stretch' } : {}),
        }}>
          <Box sx={{
            width: centered ? 148 : 132, height: centered ? 148 : 132, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box',
            border: `3px solid ${secondary}`, backgroundColor: primary, overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {portraitSrc
              ? <Box component="img" src={portraitSrc} alt="" sx={{ width: '100%', height: '100%', display: 'block' }} />
              : <Box component="span" sx={{ fontSize: 44, fontWeight: 800, color: '#fff' }}>{initials}</Box>}
          </Box>
          <Box sx={{ minWidth: 0, ...(centered ? { alignSelf: 'stretch' } : { flex: 1 }) }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, justifyContent: centered ? 'center' : 'flex-start' }}>
              <Box component="span" sx={{
                // lineHeight generous enough that overflow:hidden (there for the ellipsis) does not
                // clip a descender like the g in "Gigi"; a touch of bottom padding for the same.
                fontSize: centered ? 46 : 42, fontWeight: 900, lineHeight: 1.3, letterSpacing: -0.5, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis', pb: '3px',
              }}>{name}</Box>
            </Box>
            {detail && (
              <Box component="div" sx={{ mt: '4px', fontSize: centered ? 19 : 17, color: '#aeb6bf', lineHeight: 1.3 }}>{detail}</Box>
            )}
            {stats.length > 0 && (
              <Box sx={{ mt: '12px', display: 'flex', flexWrap: 'wrap', columnGap: '18px', rowGap: '2px', alignItems: 'baseline', justifyContent: centered ? 'center' : 'flex-start' }}>
                {stats.map(s => (
                  <Box key={s.label} sx={{ display: 'flex', alignItems: 'baseline', gap: '5px' }}>
                    <Box component="span" sx={{ fontSize: centered ? 25 : 22, fontWeight: 800 }}>{s.value}</Box>
                    <Box component="span" sx={{ fontSize: centered ? 14 : 13, fontWeight: 700, letterSpacing: 0.4, color: '#8b939c' }}>{s.label.toUpperCase()}</Box>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Box>

        {/* The winning share, big, in the club's secondary so it pops off the primary ground. On the
            poster the caption stacks UNDER the percent so the big number sits on the card's centre
            line; beside it (baseline row) it would pull the number left of centre. */}
        <Box sx={{
          display: 'flex', justifyContent: centered ? 'center' : 'flex-start',
          flexDirection: centered ? 'column' : 'row',
          alignItems: centered ? 'center' : 'baseline', gap: centered ? '6px' : '12px',
        }}>
          <Box component="span" sx={{ fontSize: centered ? 90 : 78, fontWeight: 900, lineHeight: 1, letterSpacing: -1, color: secondary }}>{pct}%</Box>
          <Box component="span" sx={{ fontSize: centered ? 18 : 16, color: 'rgba(255,255,255,0.65)', letterSpacing: 0.3 }}>of the fan vote</Box>
        </Box>
      </Box>

      {/* Footer: the brand mark and the wordmark. The mark is a black frame with a white dolphin,
          so on the dark card it sits in a small white chip rather than being inverted (html2canvas
          does not apply CSS filters, so an invert would not survive the capture). Dropped on the
          poster, which carries the wordmark once in its title tile. */}
      {!hideBrand && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', flexShrink: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', bgcolor: '#fff', borderRadius: '3px', p: '1px' }}>
            <Box component="img" src="/logo-mark.png" alt="" sx={{ height: 20, width: 'auto', display: 'block' }} />
          </Box>
          <Box component="span" sx={{ fontSize: 16, fontWeight: 800, color: 'rgba(255,255,255,0.9)', letterSpacing: 0.2 }}>sportydolphin.fun</Box>
        </Box>
      )}
    </Box>
  )
}

/** One winner as a wide, short ROW, for the all-winners story poster: the club-coloured band, the
 *  face on the left, the category / name / detail / stats stacked in the middle, and the vote share
 *  large on the right. A row per winner reads down a single column, which is what makes the poster a
 *  phone-shaped one-pager rather than a tiny two-up grid. Fixed px, `--app-chrome:1` inherited from
 *  the poster. No negative letter-spacing anywhere: it is one of the things html2canvas drops
 *  glyphs on. */
export const ROW_W = 984
export const ROW_H = 208

export function WinnerShareRow({ data }: { data: ShareCardData }) {
  const { category, name, detail, stats, pct, portraitSrc, teamId, initials } = data
  const primary = wpblColor(teamId)
  const secondary = wpblSecondary(teamId)
  return (
    <Box sx={{
      width: ROW_W, height: ROW_H, boxSizing: 'border-box', display: 'flex', alignItems: 'center',
      gap: '30px', p: '30px', borderRadius: '26px', backgroundColor: primary, color: '#f4f6f8',
      fontFamily: '"Inter", system-ui, sans-serif',
    }}>
      {/* The face is a plain <img> in a circular, club-coloured, ringed frame. See PORTRAIT FRAMING. */}
      <Box sx={{
        width: 148, height: 148, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box',
        border: `4px solid ${secondary}`, backgroundColor: primary, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {portraitSrc
          ? <Box component="img" src={portraitSrc} alt="" sx={{ width: '100%', height: '100%', display: 'block' }} />
          : <Box component="span" sx={{ fontSize: 52, fontWeight: 800, color: '#fff' }}>{initials}</Box>}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* data-caption: captureNode repaints this line with the Canvas API, because html2canvas
            drops leading words from it on some browsers. Pre-uppercased so the repaint's text matches
            what is measured. */}
        <Box data-caption="1" sx={{ fontSize: 24, fontWeight: 900, letterSpacing: 1, color: secondary, lineHeight: 1.1 }}>
          {category.toUpperCase()}
        </Box>
        <Box sx={{ mt: '3px', fontSize: 46, fontWeight: 900, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pb: '2px' }}>
          {name}
        </Box>
        {detail && (
          <Box sx={{ mt: '3px', fontSize: 20, color: '#aeb6bf', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {detail}
          </Box>
        )}
        {stats.length > 0 && (
          <Box sx={{ mt: '10px', display: 'flex', flexWrap: 'wrap', columnGap: '18px', rowGap: '2px', alignItems: 'baseline' }}>
            {stats.map(s => (
              <Box key={s.label} sx={{ display: 'flex', alignItems: 'baseline', gap: '5px' }}>
                <Box component="span" sx={{ fontSize: 24, fontWeight: 800 }}>{s.value}</Box>
                <Box component="span" sx={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4, color: '#8b939c' }}>{s.label.toUpperCase()}</Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      <Box sx={{ flexShrink: 0, textAlign: 'right', ml: '16px' }}>
        <Box sx={{ fontSize: 76, fontWeight: 900, lineHeight: 1, color: secondary }}>{pct}%</Box>
        <Box sx={{ mt: '2px', fontSize: 15, color: 'rgba(255,255,255,0.6)' }}>of the vote</Box>
      </Box>
    </Box>
  )
}

export type ShareAction = 'share' | 'copy' | 'download'

/** Whether the browser can copy an image to the clipboard / share files, for deciding which menu
 *  items to offer. Guarded for SSR and older browsers. */
export const canCopyImage = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.clipboard
  && typeof navigator.clipboard.write === 'function' && typeof window.ClipboardItem !== 'undefined'
/** Whether the browser can share an actual FILE (the OS share sheet on iOS/Android), tested with a
 *  throwaway file so it is a real answer rather than just "navigator.share exists" (which is true on
 *  desktops that cannot share files). When this is true the button skips our menu and goes straight
 *  to the native sheet, which carries its own copy and save options. */
export const canNativeShareFiles = (): boolean => {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false
  try { return navigator.canShare({ files: [new File([''], 'wpbl.png', { type: 'image/png' })] }) }
  catch { return false }
}

/**
 * Rasterise a mounted share node (one card, or a poster of many) to a PNG blob.
 *
 * html2canvas draws the whole node, faces included: every portrait is a plain <img> (see PORTRAIT
 * FRAMING), which is the one image form it renders dependably, so there is no hand-compositing pass
 * to drop faces or misplace them. The only thing to get right is that every <img> in the node is
 * decoded before html2canvas reads it, or it captures a blank where the picture should be.
 */
/** Fetch the capture library ahead of a press. Share goes to the OS sheet only while the tap's
 *  user activation lasts, and Safari refuses it once that has run out, so the download must not
 *  start inside the press. Called when a results row with a share button is on screen. */
export function preloadCapture(): void {
  void import('html2canvas').catch(() => { /* the press will retry and report */ })
}

export async function captureNode(node: HTMLElement, scale = 3): Promise<Blob | null> {
  // DECODE EVERY <img> FIRST (portraits and the footer wordmark). html2canvas does not wait for
  // images to load; it draws whatever is ready the instant it runs, so a face still decoding
  // captures blank. `decode()` resolves once the bitmap is drawable; a browser without it falls
  // back to the load event. A single face that never decodes is left to its initials fallback
  // rather than blocking the whole export.
  const domImgs = Array.from(node.querySelectorAll('img'))
  await Promise.all(domImgs.map(im => {
    if (im.decode) return im.decode().catch(() => {})
    if (im.complete) return Promise.resolve()
    return new Promise<void>(r => { im.addEventListener('load', () => r(), { once: true }); im.addEventListener('error', () => r(), { once: true }) })
  }))

  // WAIT FOR THE FONT before either html2canvas OR the caption repaint below reads it. The repaint
  // measures and draws with the loaded Inter, so it must be resident first; `fonts.ready` resolves
  // once every face on the page is loaded and the explicit loads cover the exact weights the cards
  // draw, in case one is used only here and was never requested before this off-screen node mounted.
  if (typeof document !== 'undefined' && document.fonts) {
    try {
      await Promise.all([
        document.fonts.load('900 46px Inter'), document.fonts.load('900 24px Inter'),
        document.fonts.load('800 24px Inter'), document.fonts.load('700 13px Inter'),
        document.fonts.load('600 20px Inter'), document.fonts.load('400 20px Inter'),
      ])
      await document.fonts.ready
    } catch { /* fall through: a stalled font load must not block the export entirely */ }
  }

  // Force a synchronous reflow on the real font, then a short beat, before the capture.
  void node.getBoundingClientRect()
  await new Promise(r => setTimeout(r, 60))

  // Loaded on the first capture rather than with the module. It is ~48 KB gzipped, and because
  // the share card is reachable from Home it rode into the section's first load for every
  // visitor, while almost none of them ever press Share.
  const { default: html2canvas } = await import('html2canvas')
  const canvas = await html2canvas(node, { scale, backgroundColor: null, logging: false, useCORS: true })

  // REDRAW THE CAPTION TITLES OURSELVES. html2canvas's text engine drops leading glyphs, and on some
  // browsers whole leading words, from the uppercase caption lines ("MOST VALUABLE PLAYER" came out as
  // "ST VALUABLE PLAYER", then as "VALUABLE PLAYER"). It never did it in this app's own browser, only
  // on readers' machines, so no amount of font-timing or letter-spacing tuning could be verified to
  // fix it. This sidesteps the engine entirely: every element marked `data-caption` is repainted with
  // the Canvas API, which measures and draws each glyph with the SAME already-loaded font, so there is
  // no fallback-vs-real drift and a glyph cannot fall off its advance. The names, stats and percentages
  // are left to html2canvas because they never dropped; only the captions carry the marker.
  const ctx = canvas.getContext('2d')
  const captions = Array.from(node.querySelectorAll<HTMLElement>('[data-caption]'))
  if (ctx && captions.length) {
    // html2canvas leaves a +99999 translate on the context (it mounts the node at left:-99999 and
    // compensates), so reset to identity before drawing in canvas pixels.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    const nodeRect = node.getBoundingClientRect()
    const s = canvas.width / nodeRect.width
    for (const el of captions) {
      const text = (el.textContent || '').trim()
      if (!text) continue
      const st = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const left = (r.left - nodeRect.left) * s
      const top = (r.top - nodeRect.top) * s
      const w = r.width * s, h = r.height * s
      const ls = (parseFloat(st.letterSpacing) || 0) * s
      // Clear the line with the card's own solid background (walk up until a non-transparent one),
      // so nothing of html2canvas's broken render shows through the repaint.
      let bg = ''
      for (let a: HTMLElement | null = el; a; a = a.parentElement) {
        const c = getComputedStyle(a).backgroundColor
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bg = c; break }
      }
      ctx.fillStyle = bg || '#0b0f14'
      ctx.fillRect(left - 2, top - 2, w + 4, h + 4)
      // Draw glyph by glyph with the loaded font for both measure and paint: deterministic, and it
      // honours letter-spacing without html2canvas's buggy per-character path.
      ctx.font = `${st.fontStyle} ${st.fontWeight} ${parseFloat(st.fontSize) * s}px ${st.fontFamily}`
      ctx.fillStyle = st.color
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      const widths: number[] = []
      let total = 0
      for (const ch of text) { const cw = ctx.measureText(ch).width; widths.push(cw); total += cw + ls }
      total -= ls
      let cx = st.textAlign === 'center' ? left + (w - total) / 2 : left
      const cy = top + h / 2
      let i = 0
      for (const ch of text) { ctx.fillText(ch, cx, cy); cx += widths[i] + ls; i++ }
    }
  }
  return await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
}

/** Trigger a browser download of a blob under a filename. The action that cannot fail, and the
 *  fallback every share path lands on. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Mounts one share card off-screen, captures it, and performs the chosen action: the OS share
 * sheet, a clipboard copy, or a download.
 *
 * OFF-SCREEN RATHER THAN VISIBLE: the reader shares the RESULT, not a modal, so the card is
 * rendered where html2canvas can reach it but the eye cannot, and torn down when done.
 *
 * EVERY ACTION FALLS BACK TO A DOWNLOAD, which is the one that cannot fail: a share the browser
 * refuses (or the reader's browser cannot do), a copy an engine does not support. A share the
 * reader CANCELS (AbortError) is left alone rather than downloaded, since they chose to stop.
 */
export function WinnerShareLauncher({ data, action, onDone }: { data: ShareCardData; action: ShareAction; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    const slug = `${data.category}-${data.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const filename = `wpbl-${slug || 'award'}.png`
    ;(async () => {
      const node = ref.current
      if (!node) { onDone(); return }
      try {
        const blob = await captureNode(node)
        if (!alive || !blob) { onDone(); return }
        const file = new File([blob], filename, { type: 'image/png' })
        const title = `${data.category}: ${data.name}`
        if (action === 'copy') {
          try { await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]) }
          catch { downloadBlob(blob, filename) }
        } else if (action === 'share' && navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file], title }) }
          catch (err) { if ((err as { name?: string })?.name !== 'AbortError') downloadBlob(blob, filename) }
        } else {
          downloadBlob(blob, filename)
        }
      } catch (e) {
        console.warn('[awards] share capture failed:', e)
      } finally {
        if (alive) onDone()
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return createPortal(
    <div ref={ref} style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none', zIndex: -1 }}>
      <WinnerShareCard data={data} />
    </div>,
    document.body,
  )
}
