import { describe, it, expect, vi, afterEach } from 'vitest'
// A plain .mjs cron script with no type declarations, imported rather than reimplemented
// because the decisions below ARE the job: a copy living in the test would pass happily
// while the script it mirrors drifted.
import {
  shouldAnnounceRestock, shouldWarnOutage, restockMessage, checkStock, hoursSince,
} from '../../scripts/watch-wpbl-restock.mjs'

// The restock watcher runs every 10 minutes and has two ways to be useless: announce on every
// run (144 messages a day, muted within the hour) or announce on none (the restock passes and
// the giveaway winner never gets the cap). Both are decided by the two pure functions here.

const HOUR = 3_600_000
const row = (over: Record<string, unknown> = {}) => ({
  shop_domain: 'shop.example.com',
  product_handle: 'a-cap',
  variant_id: 123,
  label: 'A Cap',
  note: null,
  last_available: false,
  last_ok_at: null,
  error_notified_at: null,
  created_at: new Date().toISOString(),
  ...over,
})

afterEach(() => vi.unstubAllGlobals())

describe('shouldAnnounceRestock', () => {
  it('announces on the edge from sold out to in stock', () => {
    expect(shouldAnnounceRestock(row({ last_available: false }), true)).toBe(true)
  })

  it('stays quiet while it goes on being in stock', () => {
    // The whole reason last_available exists. Without this the channel gets a message every
    // ten minutes for as long as the item sits on the shelf.
    expect(shouldAnnounceRestock(row({ last_available: true }), true)).toBe(false)
  })

  it('stays quiet while it goes on being sold out', () => {
    expect(shouldAnnounceRestock(row({ last_available: false }), false)).toBe(false)
  })

  it('announces on a first check that finds it already in stock', () => {
    // last_available is null before the first successful check. A watch added while the item
    // happens to be available should say so, not wait for it to sell out first.
    expect(shouldAnnounceRestock(row({ last_available: null }), true)).toBe(true)
  })

  it('re-arms, so a second restock is announced like the first', () => {
    const sold = row({ last_available: true })
    expect(shouldAnnounceRestock(sold, false)).toBe(false)          // sells out, no message
    const rearmed = row({ last_available: false })                   // ... row now records false
    expect(shouldAnnounceRestock(rearmed, true)).toBe(true)          // comes back, announces
  })
})

describe('shouldWarnOutage', () => {
  const now = Date.now()
  const ago = (h: number) => new Date(now - h * HOUR).toISOString()

  it('says nothing about a blip', () => {
    expect(shouldWarnOutage(row({ last_ok_at: ago(1) }), now)).toBe(false)
  })

  it('speaks up once the outage is old enough to matter', () => {
    expect(shouldWarnOutage(row({ last_ok_at: ago(7) }), now)).toBe(true)
  })

  it('does not repeat the complaint every ten minutes', () => {
    expect(shouldWarnOutage(row({ last_ok_at: ago(20), error_notified_at: ago(2) }), now)).toBe(false)
  })

  it('complains again a day later if it is still blind', () => {
    expect(shouldWarnOutage(row({ last_ok_at: ago(50), error_notified_at: ago(25) }), now)).toBe(true)
  })

  it('reports a watch that has never once succeeded', () => {
    // last_ok_at is null forever if the handle was wrong from the start. Falling back to
    // created_at is what stops that reading as "quietly waiting".
    expect(shouldWarnOutage(row({ last_ok_at: null, created_at: ago(9) }), now)).toBe(true)
  })

  it('gives a brand new watch time to make its first check', () => {
    expect(shouldWarnOutage(row({ last_ok_at: null, created_at: ago(0.2) }), now)).toBe(false)
  })
})

describe('hoursSince', () => {
  it('treats a missing timestamp as infinitely long ago', () => {
    expect(hoursSince(null)).toBe(Infinity)
  })
})

describe('restockMessage', () => {
  const stock = {
    available: true, inStockNames: [], title: 'A Cap', price: '$39.99',
    productUrl: 'https://shop.example.com/products/a-cap?variant=123',
  }

  it('leads with the name and carries exactly one link', () => {
    const out = restockMessage(row(), stock)
    expect(out).toContain('Back in stock:')
    expect(out).toContain('A Cap')
    expect(out).toContain('$39.99')
    // One URL only: a second draws its own embed card and the two compete for attention.
    expect(out.match(/https?:\/\//g)).toHaveLength(1)
  })

  it('says the bot does not buy, because it does not', () => {
    expect(restockMessage(row(), stock).toLowerCase()).toContain('never buys')
  })

  it('lists sizes only when the watch covers more than one', () => {
    expect(restockMessage(row(), stock)).not.toContain('sizes:')
    expect(restockMessage(row(), { ...stock, inStockNames: ['M', 'L'] })).toContain('sizes: M, L')
  })
})

describe('checkStock', () => {
  const productJson = (variants: unknown[]) => ({
    ok: true, status: 200, json: async () => ({ title: 'A Cap', variants }),
  })

  it('reads availability for the pinned variant and ignores the others', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => productJson([
      { id: 123, title: 'Default Title', available: false, price: 3999 },
      { id: 999, title: 'Other Colourway', available: true, price: 3999 },
    ])))
    const out = await checkStock(row({ variant_id: 123 }))
    // The other colourway being in stock is not this cap coming back.
    expect(out.available).toBe(false)
    expect(out.price).toBe('$39.99')
  })

  it('treats any available variant as a restock when none is pinned', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => productJson([
      { id: 1, title: 'S', available: false, price: 3999 },
      { id: 2, title: 'L', available: true, price: 3999 },
    ])))
    const out = await checkStock(row({ variant_id: null }))
    expect(out.available).toBe(true)
    expect(out.inStockNames).toEqual(['L'])
  })

  it('throws rather than reporting "sold out" when the pinned variant is gone', async () => {
    // The dangerous failure: a rebuilt product gets new variant ids, the watched one vanishes,
    // and reading that as "still sold out" would wait politely forever.
    vi.stubGlobal('fetch', vi.fn(async () => productJson([{ id: 777, title: 'New', available: true, price: 3999 }])))
    await expect(checkStock(row({ variant_id: 123 }))).rejects.toThrow(/no longer listed/i)
  })

  it('throws on a 404, which means the handle moved', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
    await expect(checkStock(row())).rejects.toThrow(/not found/i)
  })

  it('throws on a store error rather than calling it sold out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })))
    await expect(checkStock(row())).rejects.toThrow(/503/)
  })

  it('identifies itself honestly instead of spoofing a browser', async () => {
    const f = vi.fn(async () => productJson([{ id: 123, title: 'Default Title', available: true, price: 3999 }]))
    vi.stubGlobal('fetch', f)
    await checkStock(row())
    const ua = (f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1]
      .headers['User-Agent']
    expect(ua).toContain('sportydolphin.fun')
    expect(ua).not.toMatch(/Mozilla/)
  })
})
