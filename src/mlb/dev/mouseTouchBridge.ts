// ─── Dev-only mouse → touch bridge (mobile sim) ───────────────────────────────
// Desktop Chrome fires mouse events, not touch events, so the app's finger-driven
// gestures (the tab pager in SwipeableViews, the home leaders' category swipe, any
// horizontal drag) do nothing when you click-drag inside the phone frame. This
// synthesizes TouchEvents from the mouse so a click-drag reads as a one-finger swipe.
//
// Only installed in the *framed* app instance (isInsideDeviceFrame) and only in DEV —
// see App.tsx, which lazy-imports it so it never ships to production.

function makeTouch(target: EventTarget, x: number, y: number): Touch {
  return new Touch({
    identifier: 1,
    target: target as Element,
    clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y,
  })
}

function dispatchTouch(type: 'touchstart' | 'touchmove' | 'touchend', target: EventTarget, x: number, y: number) {
  const t = makeTouch(target, x, y)
  const ongoing = type === 'touchend' ? [] : [t]
  target.dispatchEvent(new TouchEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    touches: ongoing, targetTouches: ongoing, changedTouches: [t],
  }))
}

// Returns a cleanup that removes the listeners.
export function installMouseTouchBridge(): () => void {
  // TouchEvent/Touch constructors exist in Chromium; bail gracefully elsewhere (e.g. Safari).
  if (typeof TouchEvent !== 'function' || typeof Touch !== 'function') return () => {}

  // A mouse-drag starts a text selection; a finger-drag never does. Kill selection
  // across the whole framed document (a phone doesn't casually select on drag either)
  // via a persistent stylesheet — bulletproof, unlike toggling user-select per-drag,
  // which lost the race with selection start. Inputs/textareas stay selectable so the
  // search box still works.
  const style = document.createElement('style')
  style.setAttribute('data-mouse-touch-bridge', '')
  style.textContent =
    'html,body{-webkit-user-select:none;user-select:none;}' +
    'input,textarea,[contenteditable]{-webkit-user-select:text;user-select:text;}'
  document.head.appendChild(style)

  let down = false
  let target: EventTarget | null = null

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    down = true
    target = e.target
    if (target) dispatchTouch('touchstart', target, e.clientX, e.clientY)
  }
  const onMove = (e: MouseEvent) => {
    if (!down || !target) return
    dispatchTouch('touchmove', target, e.clientX, e.clientY)
  }
  const onUp = (e: MouseEvent) => {
    if (!down || !target) return
    dispatchTouch('touchend', target, e.clientX, e.clientY)
    down = false
    target = null
  }

  // Capture phase so we see the gesture before app handlers.
  window.addEventListener('mousedown', onDown, { capture: true })
  window.addEventListener('mousemove', onMove, { capture: true })
  window.addEventListener('mouseup', onUp, { capture: true })

  return () => {
    style.remove()
    window.removeEventListener('mousedown', onDown, { capture: true })
    window.removeEventListener('mousemove', onMove, { capture: true })
    window.removeEventListener('mouseup', onUp, { capture: true })
  }
}
