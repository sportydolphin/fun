// Dev only: a fake tagging queue, so /wpbl/photos/tag can be seen, clicked through and swept before
// the database has the queue functions, and without opening a single real photo to strangers.
// Turned on by `?devTagQueue` on the address (any value). The api module asks `devTagQueueOn()`
// behind `import.meta.env.DEV`, so none of this reaches a production bundle.
//
// It reuses whatever PUBLISHED photos the gallery already reads (their R2 urls are the only image
// bytes there are), so it shows nothing that is not already public. Writes are answered locally:
// `?devTagQueue=limited` answers every suggestion 'limited', to see that message.

import type { PhotoToTag, TagAnswer } from '../api/photoTagging'

export function devTagQueueOn(): boolean {
  if (!import.meta.env.DEV) return false
  try { return new URLSearchParams(window.location.search).has('devTagQueue') } catch { return false }
}

function devMode(): string {
  try { return new URLSearchParams(window.location.search).get('devTagQueue') ?? '' } catch { return '' }
}

const answered = new Set<string>()

/** The published photos as a queue of `count`, minus what this page load has answered or skipped. */
export async function devPhotosToTag(skip: string[], limit: number): Promise<PhotoToTag[]> {
  const { fetchWpblFanPhotos } = await import('../api/photos')
  const real = await fetchWpblFanPhotos()
  const pool = real.slice(0, 12)
  const named = answered.size
  return pool
    .filter(p => !answered.has(p.id) && !skip.includes(p.id))
    .slice(0, limit)
    .map(p => ({
      id: p.id, card_url: p.card_url, full_url: p.full_url, width: p.width, height: p.height,
      credit: p.credit, open_count: pool.length, named_count: named,
    }))
}

export async function devSuggest(photoId: string): Promise<TagAnswer> {
  await new Promise(r => setTimeout(r, 250))
  if (devMode() === 'limited') return 'limited'
  answered.add(photoId)
  return 'ok'
}

export async function devReport(photoId: string): Promise<TagAnswer> {
  await new Promise(r => setTimeout(r, 250))
  answered.add(photoId)
  return 'ok'
}
