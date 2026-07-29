import { useEffect } from 'react'

// Freezes <body> scroll while a modal/overlay is open, so the page behind the
// backdrop can't scroll. Ref-counted at module scope so stacked or overlapping
// modals don't unlock each other: the body only unlocks once the LAST locker
// releases (a plain per-modal `body.style.overflow` toggle unlocks early when
// modals close out of the order they opened).
//
// Usage:
//   useScrollLock()          — in a modal that is only mounted while open
//   useScrollLock(open)      — in a modal that stays mounted and toggles via a prop
let lockCount = 0
let savedOverflow = ''

export function useScrollLock(active: boolean = true) {
  useEffect(() => {
    if (!active) return
    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    lockCount++
    return () => {
      lockCount--
      if (lockCount === 0) document.body.style.overflow = savedOverflow
    }
  }, [active])
}
