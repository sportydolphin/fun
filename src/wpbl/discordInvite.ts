// The Home Discord invite's dismissal, and the dev-only way to undo it.
//
// A MODULE OF ITS OWN FOR THREE LINES, and the reason is bundle shape rather than tidiness.
// The dev settings menu needs the undo; App.tsx imports that menu eagerly; `WpblApp`, which
// owns Home, is `lazy()`. So reaching into Home.tsx for this would pull Home and its whole
// import graph into the main chunk for every visitor of every section, in production, to serve
// a button that only exists in dev. Nothing in here imports anything, so it costs a few bytes
// wherever it lands.

/** Where the ✕ records that a reader is done with the invite. Read once when Home mounts. */
export const DISCORD_DISMISS_KEY = 'wpbl_discord_dismissed'

/** Dev only. See devShowDiscordCard. */
export const DISCORD_DEV_SHOW_EVENT = 'sd:dev-show-discord'

/**
 * Dev only: forget the dismissal, so the invite comes back.
 *
 * There is deliberately no reader-facing way to undo an ✕ — an invite you can re-summon has
 * not really been dismissed. That leaves anyone working on the card with one look at it per
 * browser profile, and since the card renders at phone widths only, the device it is designed
 * for is also the one where clearing site data is most annoying.
 *
 * An EVENT as well as the storage write, because Home reads the flag once in a `useState`
 * initialiser: clearing the key alone would do nothing visible until the next reload, which is
 * the failure a dev tool can least afford, since it reads as a broken card rather than a
 * button that has not landed yet.
 */
export function devShowDiscordCard(): void {
  try { localStorage.removeItem(DISCORD_DISMISS_KEY) } catch { /* private mode / quota — non-fatal */ }
  window.dispatchEvent(new Event(DISCORD_DEV_SHOW_EVENT))
}
