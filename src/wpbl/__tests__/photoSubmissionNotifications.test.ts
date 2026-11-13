import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildPhotosWaiting, buildPhotoDecided, NOTIFICATION_META, NOTIFICATION_TYPES } from '../../../shared/notifications.js'

// Fan photo submission notices (docs/FAN_UPLOADS.md). Pinned: the owner's line is one id however
// the count moves (so a push replaces the last), a fan's wording for each mix of decisions, and that
// the bell sources ask for the right rows (the owner's line excludes the reader's own; a fan's list
// is filtered to their account, since the owner's policy returns everyone's).

describe('the catalog entries', () => {
  it('lands each where it can be acted on', () => {
    expect(NOTIFICATION_META[NOTIFICATION_TYPES.WPBL_PHOTOS_WAITING].defaultUrl).toBe('/admin?tab=photos')
    expect(NOTIFICATION_META[NOTIFICATION_TYPES.WPBL_PHOTO_DECIDED].defaultUrl).toBe('/wpbl/photos/submit')
  })

  it('keeps one id for the owner\'s queue whatever the count', () => {
    expect(buildPhotosWaiting({ count: 1 }).id).toBe(buildPhotosWaiting({ count: 9 }).id)
    expect(buildPhotosWaiting({ count: 1 }).title).toBe('1 photo to review')
    expect(buildPhotosWaiting({ count: 3 }).title).toBe('3 photos to review')
  })

  it('words a fan\'s decisions for each mix', () => {
    expect(buildPhotoDecided({ key: 'a', published: 1, declined: 0 }).title).toBe('Your photo is up')
    expect(buildPhotoDecided({ key: 'a', published: 4, declined: 0 }).title).toBe('4 of your photos are up')
    const one = buildPhotoDecided({ key: 'a', published: 0, declined: 1, reason: 'Not a WPBL game' })
    expect(one.title).toBe("Your photo wasn't published")
    expect(one.body).toBe('Reason: Not a WPBL game')
    expect(buildPhotoDecided({ key: 'a', published: 2, declined: 1 }).title).toBe('2 published, 1 not')
    expect(buildPhotoDecided({ key: 'x', published: 1, declined: 0 }).id).toBe('wpbl-photo-decided:x')
  })
})

// A chainable stand-in for the supabase query builder that records every call.
const calls: Array<[string, unknown[]]> = []
let result: { count?: number | null; data?: unknown[]; error: unknown } = { error: null }
function chain(): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop: string) {
      if (prop === 'then') return (res: (v: unknown) => void) => res(result)
      return (...args: unknown[]) => { calls.push([prop, args]); return proxy }
    },
  }
  const proxy: object = new Proxy({}, handler)
  return proxy
}
vi.mock('../../lib/supabase', () => ({ supabase: { from: (t: string) => { calls.push(['from', [t]]); return chain() } } }))

import { photosWaitingSource, photoDecidedSource } from '../notifications/photoSubmissions'

beforeEach(() => { calls.length = 0; result = { error: null } })

describe('the bell sources', () => {
  it('say nothing to a signed-out reader', async () => {
    expect(await photosWaitingSource.evaluate({ userId: null })).toEqual([])
    expect(await photoDecidedSource.evaluate({ userId: null })).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('count waiting rows that are not the reader\'s, and retract at zero', async () => {
    result = { count: 2, error: null }
    const out = await photosWaitingSource.evaluate({ userId: 'owner' })
    expect(out[0].title).toBe('2 photos to review')
    expect(calls).toContainEqual(['eq', ['status', 'pending']])
    expect(calls).toContainEqual(['neq', ['user_id', 'owner']])
    result = { count: 0, error: null }
    expect(await photosWaitingSource.evaluate({ userId: 'owner' })).toEqual([])
  })

  it('lists a fan\'s own recent decisions, one line each', async () => {
    result = { data: [{ id: 's1', status: 'approved', reject_reason: null }, { id: 's2', status: 'rejected', reject_reason: 'Blurry' }], error: null }
    const out = await photoDecidedSource.evaluate({ userId: 'fan' })
    expect(calls).toContainEqual(['eq', ['user_id', 'fan']])
    expect(out.map(n => n.title)).toEqual(['Your photo is up', "Your photo wasn't published"])
    expect(out[1].body).toBe('Reason: Blurry')
  })

  it('throws on a failed read, so the bell keeps what it had', async () => {
    result = { error: new Error('offline') }
    await expect(photoDecidedSource.evaluate({ userId: 'fan' })).rejects.toThrow('offline')
  })
})
