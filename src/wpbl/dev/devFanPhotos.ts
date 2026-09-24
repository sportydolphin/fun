// Dev only: force the Home fan-photos card on, and pad it with mock rows, so the offseason Home
// can be seen before there are twelve real published photos.
//
// A module of its own, and the same bundle-shape reason as devChampion.ts: the dev settings menu
// imports this eagerly while WpblApp (which owns Home) is lazy(), so reaching into Home for a flag
// name would pull Home's whole graph into the main chunk for every visitor. Nothing here imports a
// runtime value (the types are erased), so it costs a few bytes wherever it lands and tree-shakes
// out of production behind the `import.meta.env.DEV` guards its callers wrap it in.
//
// The mock reuses whatever REAL photos exist (their R2 urls are the only image bytes we have) and
// cycles them, tagging each to a different roster player so the rail reads as a real spread. With
// no real photo at all it falls back to a plain placeholder so the layout still renders.

import type { FanPhotoWithSubjects } from '../fanPhotos'
import type { WpblPlayer } from '../types'

/** Dev only. The Home card listens for this; the menu dispatches it. */
export const DEV_FAN_PHOTOS_EVENT = 'sd:dev-fan-photos'

const STORE_KEY = 'sd:dev-fan-photos'

function readPersisted(): boolean {
  try { return sessionStorage.getItem(STORE_KEY) === '1' } catch { return false }
}

let on: boolean = import.meta.env.DEV ? readPersisted() : false

/** Whether the mock is currently forcing the Home card on. */
export function devFanPhotosOn(): boolean { return on }

/** Dev only: turn the mock on or off. */
export function setDevFanPhotos(next: boolean): void {
  on = next
  try { sessionStorage.setItem(STORE_KEY, next ? '1' : '0') } catch { /* non-fatal */ }
  window.dispatchEvent(new CustomEvent<boolean>(DEV_FAN_PHOTOS_EVENT, { detail: next }))
}

// A grey placeholder, used only when there is not one real photo to cycle. Inline so the module
// pulls in no asset.
const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#3a3a3a"/><text x="400" y="300" fill="#888" font-family="sans-serif" font-size="28" text-anchor="middle" dominant-baseline="middle">Fan photo (mock)</text></svg>')

/**
 * Pad `real` up to `count` mock photographs, each tagged to a different player, for the dev
 * preview. Deterministic given the same inputs so it does not reshuffle every render.
 */
export function mockFanPhotos(
  real: FanPhotoWithSubjects[], players: WpblPlayer[], count: number,
): FanPhotoWithSubjects[] {
  const out: FanPhotoWithSubjects[] = [...real]
  const withGames = players.filter(p => p.name)
  for (let i = real.length; i < count; i++) {
    const base = real.length > 0 ? real[i % real.length] : null
    const player = withGames[i % Math.max(1, withGames.length)]
    out.push({
      id: `mock-${i}`,
      card_url: base?.card_url ?? PLACEHOLDER,
      full_url: base?.full_url ?? PLACEHOLDER,
      width: base?.width ?? 800,
      height: base?.height ?? 600,
      caption: null,
      credit: 'Mock Photographer',
      taken_on: null,
      game_id: null,
      sort_order: i,
      playerIds: player ? [player.id] : [],
      figureKeys: [],
      teamIds: [],
    })
  }
  return out
}
