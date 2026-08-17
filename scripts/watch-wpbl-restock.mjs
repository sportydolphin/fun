#!/usr/bin/env node
/**
 * watch-wpbl-restock.mjs: watch the league's shop and say when something is new or back.
 *
 * WHY THIS EXISTS. It started as one question: the giveaway winner chose a cap that was out of
 * stock and the shop has no back-in-stock notification of its own. Asking that about the whole
 * catalogue is the same question 271 times, so it now mirrors the store and reports what
 * changed.
 *
 * TWO AUDIENCES, TWO VOLUMES. 241 of 271 variants are sold out at the time of writing, so a
 * single restock day could move a lot at once, and a channel that pings on all of it gets
 * muted before it is ever useful.
 *   - The SHOP channel gets everything, quietly, batched into one message per run.
 *   - The PRIVATE channel gets a loud @everyone alert, but only for products on the
 *     wpbl_restock_watch shortlist. That is the giveaway cap, and anything else worth
 *     interrupting people for.
 * A watched product restocking produces both. They are different channels for different
 * audiences, so that is a complete shop feed and a targeted alert, not a duplicate.
 *
 * HOW IT KNOWS. Shopify serves /products.json on every storefront: the published catalogue,
 * 78 products in one page here, with an explicit `available` per variant. robots.txt permits
 * it (only /cart.js and the checkout paths are disallowed) and sets no Crawl-delay. The
 * snapshot in wpbl_shop_products / wpbl_shop_variants is what last run saw, and the diff
 * against it is the entire job.
 *
 * IT ANNOUNCES A CHANGE, NOT A STATE. At ten-minute intervals "this is in stock" stays true
 * for as long as the item sits there, so the snapshot is what stops 144 messages a day. A
 * variant going false to true is a restock; a product id never seen before is new merch.
 *
 * THE FIRST RUN ANNOUNCES NOTHING. An empty snapshot would otherwise read as 78 brand-new
 * products and one enormous message. Seeding records the catalogue and stays quiet, the same
 * way post-wpbl-discord-highlights.mjs seeds. The one exception is the shortlist: a watched
 * item that is available during seeding is still shouted about, because missing that is the
 * failure this whole thing exists to prevent.
 *
 * IT NEVER BUYS. It notifies humans and stops: no cart, no checkout. The store's own
 * robots.txt asks that checkout stay human, and buying on someone's behalf the instant a page
 * changes is not a thing to automate.
 *
 * Usage:
 *   npm run restock-watch                 # check, announce what changed
 *   npm run restock-watch -- --dry-run    # check and render; writes nothing, posts nothing
 *   npm run restock-watch -- --status     # what the snapshot holds, check nothing
 *   npm run restock-watch -- --test-post  # post a sample to both webhooks, to prove they work
 *   npm run restock-watch -- --reseed     # re-record the catalogue silently, announce nothing
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *   DISCORD_RESTOCK_WEBHOOK_URL  the private channel; loud alerts for the shortlist.
 *   DISCORD_SHOP_WEBHOOK_URL     the shop channel; everything, quietly. Falls back to the
 *                                restock webhook if unset, so it degrades to one channel.
 *   DISCORD_RESTOCK_MENTION      optional. The shortlist alert pings @everyone by default;
 *                                set a user ("<@123>") or role ("<@&456>") to narrow it.
 */

import { createClient } from '@supabase/supabase-js'
// supabase-js constructs a realtime client even though nothing here subscribes, and Node < 22
// has no global WebSocket, so it needs `ws` handed to it or it throws at construction. Same
// line, same reason, as the sibling Discord scripts.
import ws from 'ws'
import { pathToFileURL } from 'node:url'

// Run only when invoked directly. Imported (by the tests, which exercise the diff and the
// message building without a database or a webhook) this file must define and not do.
const IS_ENTRYPOINT = process.argv[1] != null
  && import.meta.url === pathToFileURL(process.argv[1]).href

// ─── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const RESTOCK_WEBHOOK = (process.env.DISCORD_RESTOCK_WEBHOOK_URL ?? '').trim()
// One channel is a fine degenerate case: without its own webhook the shop feed joins the
// private channel rather than vanishing.
const SHOP_WEBHOOK = (process.env.DISCORD_SHOP_WEBHOOK_URL ?? '').trim() || RESTOCK_WEBHOOK

// Who the loud alert notifies. @everyone by default: in a private channel that is exactly the
// people who can see it, which is the point of putting it in one.
const MENTION = (process.env.DISCORD_RESTOCK_MENTION ?? '@everyone').trim()
// The shop feed never pings. With 241 variants sold out, a channel that notifies on every
// restock is a channel that gets muted, and a muted channel reports nothing at all.
const SHOP_MENTION = ''

const SHOP_DOMAIN = process.env.WPBL_SHOP_DOMAIN ?? 'shop.womensprobaseballleague.com'

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const STATUS = args.has('--status')
const TEST_POST = args.has('--test-post')
const RESEED = args.has('--reseed')

// Be a courteous client: identify honestly rather than impersonating a browser, so the store
// can see what we are and block us if they would rather we stopped.
const USER_AGENT =
  'sportydolphin.fun shop watcher (+https://sportydolphin.fun; contact via the WPBL fan Discord)'
const FETCH_TIMEOUT_MS = 20_000

// How long the store has to be unreachable before we say so. Six hours is ~36 consecutive
// failed runs: comfortably past a deploy, a blip or a rate limit, and far short of the day
// that would make a missed restock likely.
const ERROR_QUIET_HOURS = 6

// A Discord message caps at 2000 characters, and a wall of 60 bullet points is not read by
// anyone anyway. Past this the list is truncated and counted.
const MAX_LINES_PER_SECTION = 12

if (IS_ENTRYPOINT) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The shop tables are server-only (RLS with no policies), so no other key can read or write them.')
    process.exit(1)
  }
  // Not an error, and deliberately not a failure: the workflow ships before the webhook does,
  // and a scheduled job that red-Xes every ten minutes until someone pastes a secret is a job
  // everybody learns to ignore before it ever does anything useful.
  if (!RESTOCK_WEBHOOK && !DRY_RUN && !STATUS) {
    console.log('DISCORD_RESTOCK_WEBHOOK_URL is not set, so there is nowhere to announce anything. Doing nothing. See docs/DISCORD.md, "The restock watcher, if you want one".')
    process.exit(0)
  }
}

const supabase = SUPABASE_URL && SERVICE_KEY
  ? createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: ws },
    })
  : null

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
export const hoursSince = (iso, now = Date.now()) =>
  (iso ? (now - new Date(iso).getTime()) / 3_600_000 : Infinity)
const money = (cents) => (cents == null ? null : `$${(Number(cents) / 100).toFixed(2)}`)

// ─── The store ──────────────────────────────────────────────────────────────

/**
 * The published catalogue, flattened to what the diff needs.
 *
 * Keyed on Shopify's numeric ids rather than handles: a handle is the URL segment and changes
 * when a product is renamed, which would read as the old one vanishing and a new one arriving.
 */
export function normaliseCatalog(payload, shopDomain = SHOP_DOMAIN) {
  const products = Array.isArray(payload?.products) ? payload.products : []
  if (products.length === 0) throw new Error('Catalogue came back with no products at all, which is never right for this store')
  return products.map(p => ({
    product_id: Number(p.id),
    handle: p.handle,
    title: p.title,
    product_type: p.product_type ?? null,
    published_at: p.published_at ?? null,
    url: `https://${shopDomain}/products/${p.handle}`,
    variants: (p.variants ?? []).map(v => ({
      variant_id: Number(v.id),
      title: v.title ?? null,
      // NOTE: /products.json prices are decimal STRINGS ("39.99"), unlike the per-product
      // /products/<handle>.js endpoint, which gives integer cents. Do not "simplify" this to
      // match that one; a whole-pound price like "40" would land as 40 cents.
      price_cents: v.price == null || v.price === '' ? null : Math.round(Number(v.price) * 100),
      available: v.available === true,
    })),
  }))
}

export async function fetchCatalog(shopDomain = SHOP_DOMAIN, fetchImpl = fetch) {
  // limit=250 is Shopify's maximum and covers this store in one page; the loop is here so a
  // growing catalogue does not silently truncate to its first page.
  const all = []
  for (let page = 1; page <= 10; page++) {
    const url = `https://${shopDomain}/products.json?limit=250&page=${page}`
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Store returned ${res.status} for ${url}`)
    const payload = await res.json()
    const batch = Array.isArray(payload?.products) ? payload.products : []
    all.push(...batch)
    if (batch.length < 250) break
  }
  return normaliseCatalog({ products: all }, shopDomain)
}

// ─── The diff, which is the whole job ───────────────────────────────────────

/**
 * What changed between the stored snapshot and the live catalogue.
 *
 * Pure, and tested, because every failure mode here is expensive and invisible: miss a
 * transition and the restock passes unnoticed; invent one and the channel gets noise it will
 * mute. `seeding` is passed rather than inferred so the caller decides, and so the tests can
 * exercise both.
 */
export function diffCatalog(live, snapshot, { seeding = false } = {}) {
  const knownProducts = new Map((snapshot.products ?? []).map(p => [Number(p.product_id), p]))
  const knownVariants = new Map((snapshot.variants ?? []).map(v => [Number(v.variant_id), v]))

  const newProducts = []
  const restocked = []

  for (const p of live) {
    const known = knownProducts.get(p.product_id)
    // Announced once, ever. A product that was delisted and came back is not new again:
    // announced_new_at is what remembers that, and it survives the delisting.
    const isNew = !known || known.announced_new_at == null

    const back = []
    for (const v of p.variants) {
      const prev = knownVariants.get(v.variant_id)
      // A variant we have never seen counts as a restock only if it is actually buyable.
      // A new sold-out size is not news.
      const wasAvailable = prev ? prev.available === true : false
      const isFirstSighting = !prev
      if (v.available && !wasAvailable) {
        // On a brand-new product, the variants are not a "restock": the product itself is the
        // news, and listing its sizes twice reads as two separate events.
        if (!(isNew && isFirstSighting)) back.push(v)
      }
    }

    // Covers both "never seen" and "seen but never announced", which is every row the
    // seeding run wrote.
    if (isNew) newProducts.push(p)
    if (back.length) restocked.push({ product: p, variants: back })
  }

  // Seeding records reality and says nothing about it.
  if (seeding) return { newProducts: [], restocked: [], delisted: [] }

  const liveIds = new Set(live.map(p => p.product_id))
  const delisted = [...knownProducts.values()]
    .filter(p => !liveIds.has(Number(p.product_id)) && p.delisted_at == null)

  return { newProducts, restocked, delisted }
}

// ─── Messages ───────────────────────────────────────────────────────────────

const bullet = (text) => `• ${text}`

function truncateList(lines) {
  if (lines.length <= MAX_LINES_PER_SECTION) return lines
  return [...lines.slice(0, MAX_LINES_PER_SECTION), `_…and ${lines.length - MAX_LINES_PER_SECTION} more_`]
}

/** Sizes worth naming. 'Default Title' is Shopify's placeholder on a single-variant product
 *  and means nothing to a reader. */
const sizeNames = (variants) =>
  variants.map(v => v.title).filter(t => t && t !== 'Default Title')

/**
 * The shop feed: one message per run covering everything that changed, or null when nothing
 * did. One message rather than one per item, because a big restock day would otherwise be
 * thirty notifications in a row.
 */
export function shopFeedMessage({ newProducts, restocked }) {
  if (!newProducts.length && !restocked.length) return null
  const parts = []

  if (newProducts.length) {
    const lines = newProducts.map(p => {
      const price = money(p.variants[0]?.price_cents)
      return bullet(`**${p.title}**${price ? ` ${price}` : ''}\n  ${p.url}`)
    })
    parts.push(`🆕 **New in the shop** (${newProducts.length})\n${truncateList(lines).join('\n')}`)
  }

  if (restocked.length) {
    const lines = restocked.map(({ product, variants }) => {
      const sizes = sizeNames(variants)
      const price = money(variants[0]?.price_cents)
      const detail = [sizes.length ? sizes.join(', ') : null, price].filter(Boolean).join(' · ')
      return bullet(`**${product.title}**${detail ? ` — ${detail}` : ''}\n  ${product.url}`)
    })
    parts.push(`🔄 **Back in stock** (${restocked.length})\n${truncateList(lines).join('\n')}`)
  }

  return parts.join('\n\n')
}

/** The loud one. Kept deliberately short: it interrupts people, so it says the thing and the
 *  link and stops. */
export function watchAlertMessage(watch, product, variants) {
  const lines = []
  if (MENTION) lines.push(MENTION)
  lines.push(`🧢 **Back in stock:** ${watch.label ?? product.title}`)
  const sizes = sizeNames(variants)
  const facts = [money(variants[0]?.price_cents), sizes.length ? `sizes: ${sizes.join(', ')}` : null]
    .filter(Boolean).join(' · ')
  if (facts) lines.push(facts)
  if (watch.note) lines.push(`_${watch.note}_`)
  lines.push(product.url)
  return lines.join('\n')
}

function outageMessage(hours, error) {
  return [
    `⚠️  **Shop watcher is blind.** No successful check for ${Math.floor(hours)}h.`,
    `Last error: \`${String(error).slice(0, 300)}\``,
    'It will keep trying and will say nothing more until it recovers. Worth a look, since a restock could pass unnoticed while this is broken.',
  ].join('\n')
}

/**
 * Which mention categories Discord may act on, worked out from the mention WE prepended and
 * nothing else.
 *
 * Discord ignores an @everyone in a message body unless allowed_mentions says otherwise, so
 * this is the switch that decides whether an alert actually notifies anyone. Deriving it from
 * our own configured string rather than scanning the content keeps the store's text out of the
 * decision: a product renamed to "<@&123>" cannot reach a role we were not already pinging.
 */
export function mentionParse(mention) {
  const m = (mention ?? '').trim()
  if (!m) return []
  if (/@everyone|@here/.test(m)) return ['everyone']
  if (/<@&\d+>/.test(m)) return ['roles']
  if (/<@!?\d+>/.test(m)) return ['users']
  return []
}

// ─── Discord ────────────────────────────────────────────────────────────────

async function post(webhook, content, mention = '') {
  if (!webhook) { console.warn('⚠️   No webhook configured for this message; skipping.'); return }
  if (DRY_RUN) {
    console.log('\n─── would post ───────────────────────────────────────────')
    console.log(content)
    console.log(`(allowed_mentions: ${JSON.stringify(mentionParse(mention))})`)
    console.log('──────────────────────────────────────────────────────────\n')
    return
  }
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: mentionParse(mention) } }),
  })
  if (res.status === 429) {
    const retryMs = Math.min(10_000, Number((await res.clone().json().catch(() => ({}))).retry_after ?? 1) * 1000)
    console.warn(`⚠️   Rate limited, waiting ${retryMs}ms`)
    await sleep(retryMs)
    return post(webhook, content, mention)
  }
  if (!res.ok) throw new Error(`Discord post failed (${res.status}): ${await res.text()}`)
}

// ─── Persistence ────────────────────────────────────────────────────────────

// PostgREST silently caps a bare select at 1000 rows: no error, just a short array. That is
// the standing trap documented in context.md, and it is unusually nasty here, because a
// truncated snapshot does not fail, it reads as "we have never seen these variants" and
// announces hundreds of false restocks in one message. The store is 78 products / 271
// variants today, so this ceiling is far off, but it is checked rather than assumed.
const SNAPSHOT_LIMIT = 5000

async function loadSnapshot() {
  const [products, variants, watches] = await Promise.all([
    supabase.from('wpbl_shop_products').select('product_id,handle,title,announced_new_at,delisted_at').limit(SNAPSHOT_LIMIT),
    supabase.from('wpbl_shop_variants').select('variant_id,product_id,available').limit(SNAPSHOT_LIMIT),
    supabase.from('wpbl_restock_watch').select('*').eq('active', true),
  ])
  for (const [name, r] of [['products', products], ['variants', variants], ['watch', watches]]) {
    if (r.error) throw new Error(`Could not read the ${name} snapshot: ${r.error.message}`)
  }
  for (const [name, r] of [['products', products], ['variants', variants]]) {
    if ((r.data ?? []).length >= SNAPSHOT_LIMIT) {
      throw new Error(`The ${name} snapshot hit the ${SNAPSHOT_LIMIT}-row read cap, so it is a prefix rather than the whole thing. Diffing against a prefix would announce most of the catalogue as new. Page this read before letting the job run again.`)
    }
  }
  return { products: products.data ?? [], variants: variants.data ?? [], watches: watches.data ?? [] }
}

async function saveSnapshot(live, { announcedNewIds }) {
  const now = new Date().toISOString()
  const productRows = live.map(p => ({
    product_id: p.product_id, handle: p.handle, title: p.title,
    product_type: p.product_type, published_at: p.published_at,
    last_seen_at: now, delisted_at: null,
    ...(announcedNewIds.has(p.product_id) ? { announced_new_at: now } : {}),
  }))
  const variantRows = live.flatMap(p => p.variants.map(v => ({
    variant_id: v.variant_id, product_id: p.product_id, title: v.title,
    price_cents: v.price_cents, available: v.available, last_seen_at: now,
  })))

  // Products first: the variants reference them.
  const p = await supabase.from('wpbl_shop_products').upsert(productRows, { onConflict: 'product_id' })
  if (p.error) throw new Error(`Could not save products: ${p.error.message}`)
  // Chunked so one oversized request cannot fail the whole write.
  for (let i = 0; i < variantRows.length; i += 200) {
    const v = await supabase.from('wpbl_shop_variants').upsert(variantRows.slice(i, i + 200), { onConflict: 'variant_id' })
    if (v.error) throw new Error(`Could not save variants: ${v.error.message}`)
  }
}

async function recordRun(fields) {
  const r = await supabase.from('wpbl_shop_watch_runs').insert(fields)
  if (r.error) console.error(`Could not record the run: ${r.error.message}`)
}

async function lastGoodRun() {
  const { data } = await supabase.from('wpbl_shop_watch_runs')
    .select('ran_at,ok').eq('ok', true).order('ran_at', { ascending: false }).limit(1)
  return data?.[0] ?? null
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (TEST_POST) {
    await post(RESTOCK_WEBHOOK, [MENTION, '🧢 **Test message** from the WPBL shop watcher. If this pinged you, the restock alert will too.'].filter(Boolean).join('\n'), MENTION)
    if (SHOP_WEBHOOK && SHOP_WEBHOOK !== RESTOCK_WEBHOOK) {
      await post(SHOP_WEBHOOK, '🛍️ **Test message** from the WPBL shop watcher. New merch and restocks will appear here, quietly.', SHOP_MENTION)
    }
    console.log(DRY_RUN ? 'Dry run: nothing sent.' : '✅  Test message(s) sent.')
    return
  }

  const snapshot = await loadSnapshot()

  if (STATUS) {
    const inStock = snapshot.variants.filter(v => v.available).length
    console.log(`Snapshot: ${snapshot.products.length} products, ${snapshot.variants.length} variants, ${inStock} in stock.`)
    console.log(`Shortlist (loud alerts): ${snapshot.watches.map(w => w.label ?? w.product_handle).join(', ') || 'none'}`)
    const last = await lastGoodRun()
    console.log(`Last successful run: ${last?.ran_at ?? 'never'}`)
    return
  }

  const seeding = RESEED || snapshot.products.length === 0

  let live
  try {
    live = await fetchCatalog()
  } catch (err) {
    const message = String(err?.message ?? err)
    console.error(`⚠️   ${message}`)
    if (!DRY_RUN) {
      // A failed check is not a failed job: the store 503s, a deploy blips, and the next run
      // ten minutes later is the retry. But silence is the dangerous state for a watcher, so
      // once the outage is old enough we say so, once.
      const last = await lastGoodRun()
      const blindFor = hoursSince(last?.ran_at)
      if (blindFor >= ERROR_QUIET_HOURS) {
        await post(SHOP_WEBHOOK, outageMessage(blindFor, message), SHOP_MENTION).catch(e =>
          console.error(`   Could not post the outage notice either: ${e.message}`))
      }
      await recordRun({ ok: false, error: message.slice(0, 500) })
    }
    // Exit 0: this is an expected, self-healing condition, and a red X every ten minutes
    // teaches everyone to ignore the job.
    return
  }

  const { newProducts, restocked, delisted } = diffCatalog(live, snapshot, { seeding })

  console.log(`Catalogue: ${live.length} products, ${live.reduce((n, p) => n + p.variants.length, 0)} variants.`)
  if (seeding) {
    console.log(RESEED
      ? 'Reseeding: recording the catalogue, announcing nothing.'
      : `First run: recording ${live.length} products and announcing nothing. Real changes are announced from the next run.`)
  } else {
    console.log(`New: ${newProducts.length}  Restocked: ${restocked.length}  Delisted: ${delisted.length}`)
  }

  // ─── The loud alerts, checked even while seeding ───────────────────────────
  //
  // A watched item being available is the thing this whole job exists to catch, so it is not
  // suppressed by the first run. During seeding there is no "was", so "is available now"
  // is the trigger; afterwards it is the restock transition, same as everything else.
  const byHandle = new Map(live.map(p => [p.handle, p]))
  const announcedWatchIds = []
  for (const watch of snapshot.watches) {
    const product = byHandle.get(watch.product_handle)
    if (!product) {
      console.warn(`⚠️   Shortlisted product "${watch.product_handle}" is not in the catalogue. Update wpbl_restock_watch.`)
      continue
    }
    const wanted = watch.variant_id != null
      ? product.variants.filter(v => String(v.variant_id) === String(watch.variant_id))
      : product.variants
    if (watch.variant_id != null && wanted.length === 0) {
      console.warn(`⚠️   Shortlisted variant ${watch.variant_id} is no longer listed on ${watch.product_handle}. Update wpbl_restock_watch.`)
      continue
    }
    const hit = seeding
      ? wanted.filter(v => v.available)
      : (restocked.find(r => r.product.product_id === product.product_id)?.variants ?? [])
          .filter(v => watch.variant_id == null || String(v.variant_id) === String(watch.variant_id))
    if (!hit.length) continue

    await post(RESTOCK_WEBHOOK, watchAlertMessage(watch, product, hit), MENTION)
    announcedWatchIds.push(watch.id)
    console.log(`🔔 Loud alert sent for ${watch.label ?? watch.product_handle}`)
  }

  // ─── The quiet shop feed ──────────────────────────────────────────────────
  const feed = shopFeedMessage({ newProducts, restocked })
  if (feed) {
    await post(SHOP_WEBHOOK, feed, SHOP_MENTION)
    if (!DRY_RUN) console.log('Posted the shop feed.')
  }

  // A dry run writes NOTHING. Recording what it saw would move the snapshot past the change,
  // and the real run ten minutes later would see nothing new and stay silent. The alert would
  // be lost to having looked at it.
  if (DRY_RUN) { console.log('\nDry run: nothing written, nothing sent.'); return }

  await saveSnapshot(live, {
    // Everything present is marked announced once it has been through a real run, seeding
    // included: that is what stops the seeded catalogue reading as 78 new products next time.
    announcedNewIds: new Set(live.map(p => p.product_id)),
  })
  if (delisted.length) {
    await supabase.from('wpbl_shop_products')
      .update({ delisted_at: new Date().toISOString() })
      .in('product_id', delisted.map(p => p.product_id))
  }
  if (announcedWatchIds.length) {
    await supabase.from('wpbl_restock_watch')
      .update({ last_announced_at: new Date().toISOString() })
      .in('id', announcedWatchIds)
  }
  await recordRun({
    ok: true, products_seen: live.length,
    new_products: newProducts.length, restocks: restocked.length,
  })
}

if (IS_ENTRYPOINT) {
  main().catch(async err => {
    console.error(err)
    if (!DRY_RUN && supabase) {
      // ok:false matters: lastGoodRun() is what the outage warning measures from, so recording
      // a crash as a good run would leave the watcher permanently unable to notice it is dead.
      await recordRun({ ok: false, error: String(err?.message ?? err).slice(0, 500) }).catch(() => {})
    }
    process.exit(1)
  })
}
