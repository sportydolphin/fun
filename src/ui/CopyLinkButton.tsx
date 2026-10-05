// A share affordance for a sheet header's `actions` slot: copies a link to whatever the sheet is
// showing, and says so. Deliberately reports failure rather than swallowing it: the whole point of
// the control is that the reader walks away holding a URL, so a silent no-op is the one outcome
// that must never look like success.
//
// WPBL built it for its player and game sheets; it lives here since MLB's series, game and player
// pages wanted the same control, and neither section imports the other. The section passes its own
// accent for the confirmation, which is the only thing that differs.
//
// The clipboard API needs a secure context. https and localhost both qualify, so the only
// realistic gap is a plain-http host on a LAN, which is why the execCommand path is still
// here as a fallback rather than being retired as legacy.
import { useCallback, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { hoverOnly } from './interaction'
import { typePx } from './scale'

export type CopyState = 'idle' | 'copied' | 'failed'

/** The copy itself and its few seconds of feedback, for a control drawn some other way. */
export function useCopyLink(url: string, onCopy?: () => void): { state: CopyState; copy: () => void } {
  const [state, setState] = useState<CopyState>('idle')
  const copy = useCallback(async () => {
    const ok = await writeClipboard(url)
    setState(ok ? 'copied' : 'failed')
    if (ok) onCopy?.()
    setTimeout(() => setState('idle'), ok ? 1600 : 2400)
  }, [url, onCopy])
  return { state, copy: () => { void copy() } }
}

export const copyLabel = (s: CopyState) => s === 'copied' ? 'Copied' : s === 'failed' ? "Couldn't copy" : 'Copy link'

export function CopyLinkButton({ url, title = 'Copy link', onCopy, copiedColor = 'success.main' }: {
  url: string
  title?: string
  /** Fired once on a SUCCESSFUL copy, for the caller to log a share. Not fired on failure:
   *  a copy that did not happen is not a share. */
  onCopy?: () => void
  copiedColor?: string
}) {
  const { state, copy } = useCopyLink(url, onCopy)
  const label = copyLabel(state)
  return (
    <Box
      onClick={copy}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy() } }}
      title={title}
      aria-label={label}
      sx={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5,
        height: 26, px: 0.9, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
        // Confirmation is the accent, failure is the theme's error colour, and idle recedes
        // to match the close button beside it.
        color: state === 'copied' ? copiedColor : state === 'failed' ? 'error.main' : 'text.disabled',
        ...hoverOnly({ bgcolor: 'action.hover', color: state === 'idle' ? 'text.primary' : undefined }),
        transition: 'color 0.15s',
      }}
    >
      <Typography sx={{ fontSize: '0.72rem', lineHeight: 1 }} aria-hidden>
        {state === 'copied' ? '✓' : state === 'failed' ? '!' : '🔗'}
      </Typography>
      <Typography sx={{
        fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(0.6),
        lineHeight: 1, whiteSpace: 'nowrap',
      }}>
        {label}
      </Typography>
    </Box>
  )
}

/** Clipboard write with the pre-secure-context fallback. Resolves false if both routes fail. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through to the textarea route */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    // Keep it off-screen and non-focusable-looking so the page doesn't visibly jump.
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}
