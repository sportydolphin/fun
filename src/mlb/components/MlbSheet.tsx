import React, { useEffect } from 'react'
import { ModalShell } from '../../ui/ModalShell'
import { useSheetHistory } from '../state/sheetHistory'
import { useScrollLock } from '../lib/useScrollLock'

/**
 * The shared ModalShell as a history entry: Back closes it, and every other way out (the close
 * button, Escape, the backdrop, a drag down) pops that same entry. See sheetHistory.ts.
 *
 * Mount it only while the sheet is open. Mounting IS opening, as far as history is concerned, so a
 * sheet kept mounted and hidden would hold an entry for as long as the page does. A modal that
 * takes an `open` prop returns null above this rather than passing `open` through.
 */
export function MlbSheet({ onClose, ...rest }: React.ComponentProps<typeof ModalShell>) {
  const close = useSheetHistory(onClose)
  return <ModalShell {...rest} onClose={close} />
}

/**
 * The same footing for a view that takes over the whole screen in place (the trends chart, the
 * player card) rather than opening a card over the page: Back and Escape leave fullscreen instead
 * of the page. Renders nothing; mount it only while fullscreen, and call `exitRef.current` from the
 * view's own exit control so that pops the entry too.
 */
export function FullscreenEntry({ onClose, exitRef }: {
  onClose: () => void
  exitRef: React.MutableRefObject<(() => void) | null>
}) {
  const close = useSheetHistory(onClose)
  useScrollLock()
  useEffect(() => {
    exitRef.current = close
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); exitRef.current = null }
  }, [close, exitRef])
  return null
}
