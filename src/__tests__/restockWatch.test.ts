import { describe, it, expect, vi } from 'vitest'
// A plain .mjs cron script with no type declarations, imported rather than reimplemented
// because the diff below IS the job: a copy living in the test would pass happily while the
// script it mirrors drifted.
import {
  diffCatalog, shopFeedMessage, watchAlertMessage, normaliseCatalog, mentionParse,
  fetchCatalog, hoursSince,
  diffLots, normaliseLots, fetchLots, auctionFeedMessage,
} from '../../scripts/watch-wpbl-restock.mjs'

// The shop watcher runs every 10 minutes over 78 products and 271 variants, 241 of them sold
// out. It has two ways to be useless: announce things that did not change (a big restock day
// becomes noise, the channel gets muted, nothing is ever read again) or miss a transition (the
// giveaway winner never learns the cap came back). diffCatalog decides both.

type V = { variant_id: number; title: string | null; price_cents: number | null; available: boolean }
const variant = (id: number, available: boolean, title: string | null = 'Default Title'): V =>
  ({ variant_id: id, title, price_cents: 3999, available })

const product = (id: number, variants: V[], over: Record<string, unknown> = {}) => ({
  product_id: id, handle: `p-${id}`, title: `Product ${id}`, product_type: 'Hat',
  published_at: '2026-08-01T00:00:00Z', url: `https://shop.example.com/products/p-${id}`,
  variants, ...over,
})

/** A snapshot in the shape loadSnapshot() returns, from the products it should remember. */
const snapshotOf = (products: ReturnType<typeof product>[], { announced = true } = {}) => ({
  products: products.map(p => ({
    product_id: p.product_id, handle: p.handle, title: p.title,
    announced_new_at: announced ? '2026-08-17T00:00:00Z' : null, delisted_at: null,
  })),
  variants: products.flatMap(p => p.variants.map(v => ({
    variant_id: v.variant_id, product_id: p.product_id, available: v.available,
  }))),
})

const EMPTY = { products: [], variants: [] }

describe('diffCatalog: restocks', () => {
  it('announces a variant going from sold out to available', () => {
    const before = [product(1, [variant(10, false)])]
    const after = [product(1, [variant(10, true)])]
    const d = diffCatalog(after, snapshotOf(before))
    expect(d.restocked).toHaveLength(1)
    expect(d.restocked[0].variants.map((v: V) => v.variant_id)).toEqual([10])
  })

  it('stays quiet while an item goes on being available', () => {
    // The reason the snapshot exists. Without it the channel gets this every ten minutes for
    // as long as the item sits on the shelf.
    const same = [product(1, [variant(10, true)])]
    expect(diffCatalog(same, snapshotOf(same)).restocked).toHaveLength(0)
  })

  it('stays quiet while an item goes on being sold out', () => {
    const same = [product(1, [variant(10, false)])]
    expect(diffCatalog(same, snapshotOf(same)).restocked).toHaveLength(0)
  })

  it('re-arms, so a second restock is announced like the first', () => {
    const inStock = [product(1, [variant(10, true)])]
    const soldOut = [product(1, [variant(10, false)])]
    expect(diffCatalog(soldOut, snapshotOf(inStock)).restocked).toHaveLength(0)  // sells out, silent
    expect(diffCatalog(inStock, snapshotOf(soldOut)).restocked).toHaveLength(1)  // returns, announced
  })

  it('names only the variants that actually came back', () => {
    const before = [product(1, [variant(10, false, 'S'), variant(11, true, 'M'), variant(12, false, 'L')])]
    const after = [product(1, [variant(10, true, 'S'), variant(11, true, 'M'), variant(12, false, 'L')])]
    const d = diffCatalog(after, snapshotOf(before))
    // M was already in stock and L is still gone; announcing either would be a lie.
    expect(d.restocked[0].variants.map((v: V) => v.title)).toEqual(['S'])
  })

  it('does not treat a newly listed sold-out size as a restock', () => {
    const before = [product(1, [variant(10, true)])]
    const after = [product(1, [variant(10, true), variant(11, false, 'XL')])]
    expect(diffCatalog(after, snapshotOf(before)).restocked).toHaveLength(0)
  })
})

describe('diffCatalog: new products', () => {
  it('announces a product id it has never seen', () => {
    const d = diffCatalog([product(1, [variant(10, true)]), product(2, [variant(20, false)])],
      snapshotOf([product(1, [variant(10, true)])]))
    expect(d.newProducts.map((p: { product_id: number }) => p.product_id)).toEqual([2])
  })

  it('does not announce the same product as new twice', () => {
    const catalog = [product(1, [variant(10, true)])]
    expect(diffCatalog(catalog, snapshotOf(catalog)).newProducts).toHaveLength(0)
  })

  it('announces a product that was recorded but never announced', () => {
    // Exactly what the seeding run leaves behind if it is interrupted before stamping.
    const catalog = [product(1, [variant(10, true)])]
    expect(diffCatalog(catalog, snapshotOf(catalog, { announced: false })).newProducts).toHaveLength(1)
  })

  it('does not also list a new product under restocks', () => {
    // A new in-stock product is one event. Announcing the product AND its sizes reads as two
    // things happening, and doubles the length of a drop-day message for no information.
    const d = diffCatalog([product(2, [variant(20, true)])], EMPTY)
    expect(d.newProducts).toHaveLength(1)
    expect(d.restocked).toHaveLength(0)
  })
})

describe('diffCatalog: seeding', () => {
  it('announces absolutely nothing on the first run', () => {
    // 78 products would otherwise arrive as one enormous "new merch" message.
    const live = [product(1, [variant(10, true)]), product(2, [variant(20, true)])]
    const d = diffCatalog(live, EMPTY, { seeding: true })
    expect(d.newProducts).toHaveLength(0)
    expect(d.restocked).toHaveLength(0)
    expect(d.delisted).toHaveLength(0)
  })
})

describe('diffCatalog: delisting', () => {
  it('notices a product that has left the catalogue', () => {
    const d = diffCatalog([product(1, [variant(10, true)])],
      snapshotOf([product(1, [variant(10, true)]), product(2, [variant(20, true)])]))
    expect(d.delisted.map((p: { product_id: number }) => p.product_id)).toEqual([2])
  })

  it('does not re-report something already marked delisted', () => {
    const snap = snapshotOf([product(1, [variant(10, true)]), product(2, [variant(20, true)])])
    snap.products[1].delisted_at = '2026-08-17T00:00:00Z'
    expect(diffCatalog([product(1, [variant(10, true)])], snap).delisted).toHaveLength(0)
  })

  it('does not announce a returning product as new merch', () => {
    // It was delisted, not forgotten: announced_new_at survives, so its return is a restock at
    // most. Otherwise a product going in and out of the catalogue is "new" every time.
    const snap = snapshotOf([product(2, [variant(20, false)])])
    snap.products[0].delisted_at = '2026-08-17T00:00:00Z'
    const d = diffCatalog([product(2, [variant(20, true)])], snap)
    expect(d.newProducts).toHaveLength(0)
    expect(d.restocked).toHaveLength(1)
  })
})

describe('normaliseCatalog', () => {
  it('reads /products.json decimal price strings as cents', () => {
    // This endpoint gives "39.99"; the per-product .js endpoint gives integer 3999. Confusing
    // the two puts a $40 cap in the channel at $0.40.
    const [p] = normaliseCatalog({ products: [{ id: 1, handle: 'h', title: 'T', variants: [
      { id: 10, title: 'Default Title', price: '39.99', available: true },
      { id: 11, title: 'M', price: '40', available: true },
    ] }] })
    expect(p.variants[0].price_cents).toBe(3999)
    expect(p.variants[1].price_cents).toBe(4000)
  })

  it('throws on an empty catalogue rather than reading it as a mass delisting', () => {
    // A 200 with no products is the store having a bad day, not 78 items being withdrawn.
    // Accepting it would delist the entire snapshot and then announce it all back as new.
    expect(() => normaliseCatalog({ products: [] })).toThrow(/no products/i)
  })

  it('keys on the numeric id, so a renamed handle is not a new product', () => {
    const [p] = normaliseCatalog({ products: [{ id: 7, handle: 'new-name', title: 'T', variants: [] }] })
    expect(p.product_id).toBe(7)
  })
})

describe('fetchCatalog', () => {
  const page = (n: number) => ({
    ok: true, status: 200,
    json: async () => ({ products: Array.from({ length: n }, (_, i) => ({
      id: i + 1, handle: `h${i}`, title: `T${i}`, variants: [{ id: 1000 + i, title: 'Default Title', price: '9.99', available: false }],
    })) }),
  })

  it('stops after a short page instead of paging forever', async () => {
    const f = vi.fn(async () => page(78))
    const out = await fetchCatalog('shop.example.com', f)
    expect(f).toHaveBeenCalledTimes(1)
    expect(out).toHaveLength(78)
  })

  it('keeps paging while pages come back full', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(page(250))
      .mockResolvedValueOnce(page(4))
    const out = await fetchCatalog('shop.example.com', f)
    expect(f).toHaveBeenCalledTimes(2)
    expect(out).toHaveLength(254)
  })

  it('throws on a store error rather than reporting an empty catalogue', async () => {
    await expect(fetchCatalog('shop.example.com', vi.fn(async () => ({ ok: false, status: 503 }))))
      .rejects.toThrow(/503/)
  })

  it('identifies itself honestly instead of spoofing a browser', async () => {
    const f = vi.fn(async () => page(1))
    await fetchCatalog('shop.example.com', f)
    const ua = (f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers['User-Agent']
    expect(ua).toContain('sportydolphin.fun')
    expect(ua).not.toMatch(/Mozilla/)
  })
})

describe('shopFeedMessage', () => {
  it('says nothing when nothing changed', () => {
    expect(shopFeedMessage({ newProducts: [], restocked: [] })).toBeNull()
  })

  it('puts everything in one message rather than one per item', () => {
    const out = shopFeedMessage({
      newProducts: [product(1, [variant(10, true)])],
      restocked: [{ product: product(2, [variant(20, true)]), variants: [variant(20, true, 'M')] }],
    }) as string
    expect(out).toContain('New in the shop')
    expect(out).toContain('Back in stock')
  })

  it('does not ping anyone', () => {
    const out = shopFeedMessage({ newProducts: [product(1, [variant(10, true)])], restocked: [] }) as string
    expect(out).not.toContain('@everyone')
    expect(out).not.toContain('@here')
  })

  it('truncates a drop-day flood instead of blowing the 2000 character limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => product(i, [variant(i * 10, true)]))
    const out = shopFeedMessage({ newProducts: many, restocked: [] }) as string
    expect(out).toContain('and 18 more')
    expect(out.length).toBeLessThan(2000)
  })

  it('hides Shopify\'s "Default Title" placeholder, which means nothing to a reader', () => {
    const out = shopFeedMessage({
      newProducts: [],
      restocked: [{ product: product(2, [variant(20, true)]), variants: [variant(20, true, 'Default Title')] }],
    }) as string
    expect(out).not.toContain('Default Title')
  })

  it('names real sizes when there are some', () => {
    const out = shopFeedMessage({
      newProducts: [],
      restocked: [{ product: product(2, []), variants: [variant(20, true, 'S'), variant(21, true, 'M')] }],
    }) as string
    expect(out).toContain('S, M')
  })
})

describe('watchAlertMessage', () => {
  const watch = { label: 'The Cap', note: 'Giveaway prize.', variant_id: 10 }

  it('leads with @everyone so the channel is actually notified', () => {
    const out = watchAlertMessage(watch, product(1, []), [variant(10, true)])
    expect(out.split('\n')[0]).toBe('@everyone')
  })

  it('carries the label, the price and exactly one link', () => {
    const out = watchAlertMessage(watch, product(1, []), [variant(10, true)])
    expect(out).toContain('The Cap')
    expect(out).toContain('$39.99')
    expect(out).toContain('Giveaway prize.')
    expect(out.match(/https?:\/\//g)).toHaveLength(1)
  })
})

describe('mentionParse', () => {
  // Discord ignores an @everyone in the body unless allowed_mentions permits it, so this is
  // the switch that decides whether an alert notifies anyone at all.
  it('permits everyone for @everyone and @here', () => {
    expect(mentionParse('@everyone')).toEqual(['everyone'])
    expect(mentionParse('@here')).toEqual(['everyone'])
  })

  it('permits only the narrower category when the mention is narrower', () => {
    expect(mentionParse('<@&456>')).toEqual(['roles'])
    expect(mentionParse('<@123>')).toEqual(['users'])
  })

  it('permits nothing without a mention, which is how the shop feed stays silent', () => {
    expect(mentionParse('')).toEqual([])
    expect(mentionParse(null)).toEqual([])
  })

  it('permits nothing for text that is not a real mention', () => {
    // Derived from our own configured value, never from the store's text.
    expect(mentionParse('everyone')).toEqual([])
  })
})

describe('hoursSince', () => {
  it('treats a missing timestamp as infinitely long ago, so a never-run watcher warns', () => {
    expect(hoursSince(null)).toBe(Infinity)
  })
})

// ─── The Realest ────────────────────────────────────────────────────────────
//
// The second source, and a different shape of thing: 190 one-of-one memorabilia lots rather
// than a catalogue with stock levels. There is no restock to miss here, so the failures worth
// pinning are the other two: announcing the whole catalogue (the seeding run, or a snapshot
// that came back short) and announcing nothing at all (a truncated read, which the API makes
// look exactly like a complete one).

type Lot = { lot_id: string; slug: string; name: string; offer_type: string | null; price_cents: number | null; date_posted: string | null; url: string }

/** A row in the shape the API returns, so normaliseLots is exercised on the real payload. */
const apiLot = (id: string, over: Record<string, unknown> = {}) => ({
  id, slug: `lot-${id}`, name: `Lot ${id}`,
  date_posted: '2026-08-17T18:35:07.000Z', last_sold_amount: null,
  current_auction: null, ...over,
})

const lotsPage = (n: number, total: number, offset = 0) => ({
  ok: true, status: 200,
  json: async () => ({
    results: Array.from({ length: n }, (_, i) => apiLot(`u${offset + i}`)),
    pagination: { total, limit: 100, offset },
  }),
})

/** A snapshot row, in the shape loadLots() returns. */
const knownLot = (lot_id: string, announced = true) =>
  ({ lot_id, announced_new_at: announced ? '2026-08-20T00:00:00Z' : null })

describe('normaliseLots', () => {
  it('reads the price as dollars, not cents', () => {
    // The same trap as Shopify's /products.json: these are decimal STRINGS, so a round "250"
    // read as an integer lands as $2.50 and the channel quotes a game-used base at pocket money.
    const [lot] = normaliseLots({ results: [apiLot('a', {
      current_auction: { status: 'open', type: 'buy_now', buy_now_amount: '250' },
    })] })
    expect(lot.price_cents).toBe(25000)
  })

  it('quotes the live price while a lot is for sale', () => {
    const [lot] = normaliseLots({ results: [apiLot('a', {
      last_sold_amount: '99.00',
      current_auction: { status: 'open', type: 'buy_now', buy_now_amount: '249.99' },
    })] })
    expect(lot.price_cents).toBe(24999)
    expect(lot.offer_type).toBe('buy_now')
  })

  it('quotes what it went for once the sale has ended, and offers nothing', () => {
    // 187 of the 190 lots are in this state, so it is the common case rather than the edge one.
    const [lot] = normaliseLots({ results: [apiLot('a', {
      last_sold_amount: '870.00',
      current_auction: { status: 'done', type: 'buy_now', buy_now_amount: '249.99' },
    })] })
    expect(lot.price_cents).toBe(87000)
    expect(lot.offer_type).toBeNull()
  })

  it('survives a lot that has never had a price', () => {
    const [lot] = normaliseLots({ results: [apiLot('a')] })
    expect(lot.price_cents).toBeNull()
  })

  it('keys on the uuid, not the slug, so a retitled lot is not a new one', () => {
    const [lot] = normaliseLots({ results: [apiLot('a', { slug: 'renamed' })] })
    expect(lot.lot_id).toBe('a')
    expect(lot.url).toContain('/item/renamed')
  })
})

describe('fetchLots', () => {
  it('pages until it has as many lots as the API says exist', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(lotsPage(100, 190, 0))
      .mockResolvedValueOnce(lotsPage(90, 190, 100))
    const out = await fetchLots(f as never)
    expect(f).toHaveBeenCalledTimes(2)
    expect(out).toHaveLength(190)
  })

  it('stops asking once it holds as many as the total claims', async () => {
    // The short-page exit is not enough on its own: an API answering a full page forever would
    // otherwise be asked fifty times a run, by a watcher whose whole posture is asking rarely.
    const f = vi.fn(async () => lotsPage(100, 100, 0))
    await fetchLots(f as never)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('throws when it read fewer lots than pagination.total claims', async () => {
    // The whole reason the total is checked. A truncated page is a valid page, so without this
    // the missing lots are simply never announced and the channel reads as a quiet month.
    const f = vi.fn()
      .mockResolvedValueOnce(lotsPage(100, 190, 0))
      .mockResolvedValue(lotsPage(0, 190, 100))
    await expect(fetchLots(f as never)).rejects.toThrow(/Read 100 of the 190/)
  })

  it('throws when the API stops reporting a total at all', async () => {
    const noTotal = { ok: true, status: 200, json: async () => ({ results: [apiLot('a')] }) }
    await expect(fetchLots(vi.fn(async () => noTotal) as never))
      .rejects.toThrow(/pagination\.total/)
  })

  it('throws on an empty catalogue rather than reporting the shelf as bare', async () => {
    const empty = { ok: true, status: 200, json: async () => ({ results: [], pagination: { total: 0 } }) }
    await expect(fetchLots(vi.fn(async () => empty) as never)).rejects.toThrow(/never right/)
  })

  it('throws on an API error rather than reporting no lots', async () => {
    await expect(fetchLots(vi.fn(async () => ({ ok: false, status: 503 })) as never)).rejects.toThrow(/503/)
  })

  it('identifies itself honestly instead of spoofing a browser', async () => {
    // It matters more here than on the Shopify store: api.therealest.com/robots.txt is
    // Disallow: /, so a watcher arriving under a fake Chrome UA would be hiding.
    const f = vi.fn(async () => lotsPage(1, 1, 0))
    await fetchLots(f as never)
    const ua = (f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers['User-Agent']
    expect(ua).toContain('sportydolphin.fun')
    expect(ua).not.toMatch(/Mozilla/)
  })

  it('asks for the partner rather than the words "WPBL" in a title', async () => {
    // partner=WPBL is who consigned the lot; q=WPBL is a text match, and it misses the lots
    // titled only "Opening Day Game-Used Rosin Bag".
    const f = vi.fn(async () => lotsPage(1, 1, 0))
    await fetchLots(f as never)
    expect((f.mock.calls[0] as unknown as [string])[0]).toContain('partner=WPBL')
  })
})

describe('diffLots', () => {
  const live: Lot[] = normaliseLots({ results: [apiLot('a'), apiLot('b'), apiLot('c')] })

  it('announces a lot id it has never seen', () => {
    expect(diffLots(live, [knownLot('a'), knownLot('b')]).newLots.map(l => l.lot_id)).toEqual(['c'])
  })

  it('says nothing when the catalogue has not moved', () => {
    expect(diffLots(live, live.map(l => knownLot(l.lot_id))).newLots).toEqual([])
  })

  it('announces nothing at all while seeding', () => {
    // Otherwise the first run is one message containing all 190 lots.
    expect(diffLots(live, [], { seeding: true }).newLots).toEqual([])
  })

  it('announces a recorded but never-announced lot, which is every row seeding wrote', () => {
    expect(diffLots(live, live.map(l => knownLot(l.lot_id, false))).newLots).toHaveLength(3)
  })

  it('does not re-announce a lot just because it sold', () => {
    // The only state change a lot can undergo. It must not read as news.
    const sold = normaliseLots({ results: [apiLot('a', { last_sold_amount: '870.00' })] })
    expect(diffLots(sold, [knownLot('a')]).newLots).toEqual([])
  })
})

describe('auctionFeedMessage', () => {
  const lots = (n: number) => normaliseLots({
    results: Array.from({ length: n }, (_, i) => apiLot(`u${i}`, {
      current_auction: { status: 'open', type: 'buy_now', buy_now_amount: '249.99' },
    })),
  })

  it('says nothing when nothing is new', () => {
    expect(auctionFeedMessage([])).toBeNull()
  })

  it('carries the name, the price and the link', () => {
    const out = auctionFeedMessage(lots(1)) as string
    expect(out).toContain('Lot u0')
    expect(out).toContain('$249.99')
    expect(out).toContain('/item/lot-u0')
  })

  it('does not ping anyone', () => {
    const out = auctionFeedMessage(lots(1)) as string
    expect(out).not.toContain('@everyone')
    expect(out).not.toContain('@here')
  })

  it('truncates a drop day instead of blowing the 2000 character limit', () => {
    // The real drops were 70 lots on Jul 28 and 104 over Aug 4-5, so this is the normal case
    // for this source rather than a hypothetical one.
    const out = auctionFeedMessage(lots(70)) as string
    expect(out).toContain('and 58 more')
    expect(out.length).toBeLessThan(2000)
  })
})
