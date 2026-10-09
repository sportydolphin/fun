// Moving through jsdom's history, for a test that has to see where it lands.
//
// back() and forward() are asynchronous in jsdom as in a browser: the popstate arrives on a timer
// of its own. These tests used to sleep 20ms and assume it had come, which lost the race about one
// full-suite run in eight on a loaded machine (Oct 9, 2026). Wait for the event, then a tick for
// the handlers it set off.
export const traverse = (go: () => void) => new Promise<void>(resolve => {
  window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true })
  go()
})
