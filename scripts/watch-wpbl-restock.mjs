#!/usr/bin/env node
/**
 * watch-wpbl-restock.mjs: announce in Discord when a sold-out item on the league's shop
 * comes back.
 *
 * WHY THIS EXISTS. The giveaway winner chose a cap that is out of stock, and the shop has no
 * back-in-stock notification of its own. Refreshing a product page by hand for an unknown
 * number of days is exactly the sort of thing to hand to a cron job.
 *
 * HOW IT KNOWS. Shopify serves /products/<handle>.js on every storefront: about 3 KB of JSON
 * with an explicit `available` boolean per variant. That is the supported, stable way to ask,
 * and robots.txt permits it (only /cart.js and the checkout paths are disallowed). Scraping
 * the rendered page would be worse on every axis: bigger, slower, and it moves whenever the
 * theme does.
 *
 * WHAT IT WILL NOT DO. It notifies a human and stops there. It never adds to a cart and never
 * touches checkout. The store's own robots.txt asks that checkout stay human, and buying a
 * $40 cap the moment it appears is not a thing to automate on someone's behalf anyway.
 *
 * IT ANNOUNCES A CHANGE, NOT A STATE. Running every 10 minutes, "it is in stock" is true for
 * as long as the item sits there, so posting that every run would be 144 messages a day. The
 * job posts on the EDGE, out of stock to in stock, and records what it saw in
 * wpbl_restock_watch.last_available. When the item sells out again the row re-arms itself, so
 * a second restock is announced like the first.
 *
 * THE FAILURE THAT MATTERS IS SILENCE. A watcher nobody hears from looks exactly like a
 * watcher with nothing to report. If the store stops answering, the job says so in the same
 * channel, ONCE (error_notified_at), after the outage has lasted long enough to not be a
 * blip. Missing the restock because the job quietly died is the whole risk here.
 *
 * Usage:
 *   npm run restock-watch                 # check, post if anything came back
 *   npm run restock-watch -- --dry-run    # check and render; writes nothing, posts nothing
 *   npm run restock-watch -- --status     # print the table, check nothing
 *   npm run restock-watch -- --test-post  # post a sample message, to prove the webhook works
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_RESTOCK_WEBHOOK_URL.
 * Optional: DISCORD_RESTOCK_MENTION (e.g. "<@1234567890>"), prepended so it pings a phone
 * rather than waiting to be noticed.
 */

import { createClient } from '@supabase/supabase-js'
// supabase-js constructs a realtime client even though nothing here subscribes, and Node < 22
// has no global WebSocket, so it needs `ws` handed to it or it throws at construction. Same
// line, same reason, as the sibling Discord scripts.
import ws from 'ws'
import { pathToFileURL } from 'node:url'

// Run only when invoked directly. Imported (by the tests, which exercise the decisions below
// without a database or a webhook) this file must define and not do.
const IS_ENTRYPOINT = process.argv[1] != null
  && import.meta.url === pathToFileURL(process.argv[1]).href

// ─── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const WEBHOOK_URL = (process.env.DISCORD_RESTOCK_WEBHOOK_URL ?? '').trim()
const MENTION = (process.env.DISCORD_RESTOCK_MENTION ?? '').trim()

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const STATUS = args.has('--status')
const TEST_POST = args.has('--test-post')

// How long the store has to be unreachable before we say so. Six hours is ~36 consecutive
// failed checks: comfortably past a deploy, a blip or a rate-limit, and still far short of
// the day or more that would make a missed restock likely.
const ERROR_QUIET_HOURS = 6

// Shopify is fine with this rate, but be a courteous client about it: identify honestly
// rather than pretending to be a browser, so the store can see what we are and block us if
// they would rather we stopped.
const USER_AGENT =
  'sportydolphin.fun restock watcher (+https://sportydolphin.fun; contact via the WPBL fan Discord)'

const FETCH_TIMEOUT_MS = 15_000

if (IS_ENTRYPOINT) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. wpbl_restock_watch is server-only (RLS with no policies), so no other key can read or write it.')
    process.exit(1)
  }
  // Not an error, and deliberately not a failure. The workflow ships before the webhook
  // exists, and a scheduled job that red-Xes every ten minutes until someone pastes a secret
  // is a job everybody learns to ignore before it ever does anything useful. Same behaviour,
  // for the same reason, as the highlights step in wpbl-youtube-sync.
  if (!WEBHOOK_URL && !DRY_RUN && !STATUS) {
    console.log('DISCORD_RESTOCK_WEBHOOK_URL is not set, so there is nowhere to announce a restock. Doing nothing. See docs/DISCORD.md, "The restock watcher, if you want one".')
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

// ─── The two decisions ──────────────────────────────────────────────────────
//
// Pulled out as pure functions because they are the whole job, and both failure modes are
// expensive: announce on every run and the channel gets 144 messages a day and is muted;
// announce on no run and the restock passes unseen. Tested in
// src/__tests__/restockWatch.test.ts.

/**
 * Announce only on the EDGE from not-available to available.
 *
 * `last_available` is null before the first successful check, which counts as "not
 * available": a watch added while the item is already in stock should say so once rather
 * than wait for it to sell out first.
 */
export function shouldAnnounceRestock(row, available) {
  return available === true && row.last_available !== true
}

/**
 * Say something when the store has been unreachable long enough that it is not a blip, and
 * then shut up for a day. Silence is the dangerous state for a watcher, but a complaint every
 * ten minutes is just a different way of being ignored.
 *
 * Measured from the last SUCCESSFUL check, falling back to when the row was created, so a
 * watch that has never once worked still reports rather than looking merely quiet.
 */
export function shouldWarnOutage(row, now = Date.now(), quietHours = ERROR_QUIET_HOURS) {
  const blindFor = hoursSince(row.last_ok_at ?? row.created_at, now)
  return blindFor >= quietHours && hoursSince(row.error_notified_at, now) >= 24
}

// ─── The store ──────────────────────────────────────────────────────────────

/**
 * Availability for one watched row.
 *
 * Returns `available` plus the bits the message wants. A variant that has vanished from the
 * product entirely is NOT treated as unavailable: that means the row is watching something
 * that no longer exists, which is a different problem from being sold out and should not sit
 * silently reading as "still waiting".
 */
export async function checkStock({ shop_domain, product_handle, variant_id }) {
  const url = `https://${shop_domain}/products/${product_handle}.js`
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (res.status === 404) throw new Error(`Product not found at ${url} (handle changed or product removed?)`)
  if (!res.ok) throw new Error(`Store returned ${res.status} for ${url}`)

  const product = await res.json()
  const variants = Array.isArray(product.variants) ? product.variants : []
  if (variants.length === 0) throw new Error(`No variants in the response for ${product_handle}`)

  // Pinned variant, or any variant when the row does not name one.
  const watched = variant_id != null
    ? variants.filter(v => String(v.id) === String(variant_id))
    : variants

  if (variant_id != null && watched.length === 0) {
    throw new Error(`Variant ${variant_id} is no longer listed on ${product_handle}. The product may have been rebuilt with new variant ids; update wpbl_restock_watch.`)
  }

  const inStock = watched.filter(v => v.available === true)
  const priceCents = (inStock[0] ?? watched[0])?.price ?? null

  return {
    available: inStock.length > 0,
    // Only meaningful for an "any variant" watch; a pinned one always names itself.
    inStockNames: inStock.map(v => v.title).filter(t => t && t !== 'Default Title'),
    title: product.title ?? product_handle,
    price: priceCents == null ? null : `$${(priceCents / 100).toFixed(2)}`,
    productUrl: `https://${shop_domain}/products/${product_handle}`
      + (variant_id != null ? `?variant=${variant_id}` : ''),
  }
}

// ─── Discord ────────────────────────────────────────────────────────────────

async function post(content) {
  if (DRY_RUN) {
    console.log('\n─── would post ───────────────────────────────────────────')
    console.log(content)
    console.log('──────────────────────────────────────────────────────────\n')
    return
  }
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // allowed_mentions is explicit so a stray "@everyone" in a product title can never ping
    // the server. Only the id we were configured with is allowed to notify anyone.
    body: JSON.stringify({
      content,
      allowed_mentions: MENTION ? { parse: ['users', 'roles'] } : { parse: [] },
    }),
  })
  if (res.status === 429) {
    const retryMs = Math.min(10_000, Number((await res.clone().json().catch(() => ({}))).retry_after ?? 1) * 1000)
    console.warn(`⚠️   Rate limited, waiting ${retryMs}ms`)
    await sleep(retryMs)
    return post(content)
  }
  if (!res.ok) throw new Error(`Discord post failed (${res.status}): ${await res.text()}`)
}

/** The restock message. One link only: a second URL draws its own embed card and the two
 *  cards compete, same reasoning as the highlights poster. */
export function restockMessage(row, stock) {
  const lines = []
  if (MENTION) lines.push(MENTION)
  lines.push(`🧢 **Back in stock:** ${row.label ?? stock.title}`)
  const facts = [stock.price, stock.inStockNames.length ? `sizes: ${stock.inStockNames.join(', ')}` : null]
    .filter(Boolean)
    .join(' · ')
  if (facts) lines.push(facts)
  if (row.note) lines.push(`_${row.note}_`)
  lines.push(stock.productUrl)
  lines.push('Grab it quickly, and check out yourself: this bot only watches, it never buys.')
  return lines.join('\n')
}

function outageMessage(row, hours, error) {
  return [
    MENTION,
    `⚠️  **Restock watcher is blind.** No successful check of ${row.label ?? row.product_handle} for ${Math.floor(hours)}h.`,
    `Last error: \`${String(error).slice(0, 300)}\``,
    'It will keep trying and will say nothing more until it recovers. Worth a look, since a restock could pass unnoticed while this is broken.',
  ].filter(Boolean).join('\n')
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (TEST_POST) {
    await post([MENTION, '🧢 **Test message** from the WPBL restock watcher. If you can read this, the webhook works.'].filter(Boolean).join('\n'))
    console.log(DRY_RUN ? 'Dry run: nothing sent.' : '✅  Test message sent.')
    return
  }

  const { data: rows, error } = await supabase
    .from('wpbl_restock_watch').select('*').eq('active', true).order('created_at')
  if (error) throw new Error(`Could not read wpbl_restock_watch: ${error.message}`)
  if (!rows?.length) {
    console.log('Nothing being watched (no active rows in wpbl_restock_watch).')
    return
  }

  if (STATUS) {
    console.table(rows.map(r => ({
      product: r.product_handle.slice(0, 44),
      variant: r.variant_id ?? 'any',
      available: r.last_available,
      checked: r.last_checked_at,
      notified: r.last_notified_at,
      error: r.last_error?.slice(0, 40) ?? null,
    })))
    return
  }

  const now = new Date().toISOString()
  for (const row of rows) {
    const name = row.label ?? row.product_handle
    let stock
    try {
      stock = await checkStock(row)
    } catch (err) {
      // A failed check is not a failed job. The store 503s, a deploy blips, the network
      // wobbles; the next run in ten minutes is the retry. What we must not do is stay quiet
      // about it forever, so once the outage is old enough we say so, once.
      const message = String(err?.message ?? err)
      console.error(`⚠️   ${name}: ${message}`)
      const blindFor = hoursSince(row.last_ok_at ?? row.created_at)
      const shouldWarn = shouldWarnOutage(row)
      if (shouldWarn) {
        try {
          await post(outageMessage(row, blindFor, message))
          console.log(`   Posted an outage notice (blind for ${Math.floor(blindFor)}h).`)
        } catch (postErr) {
          console.error(`   Could not post the outage notice either: ${postErr.message}`)
        }
      }
      if (!DRY_RUN) {
        await supabase.from('wpbl_restock_watch').update({
          last_checked_at: now,
          last_error: message.slice(0, 500),
          ...(shouldWarn ? { error_notified_at: now } : {}),
        }).eq('id', row.id)
      }
      continue
    }

    const cameBack = shouldAnnounceRestock(row, stock.available)
    console.log(`${stock.available ? '✅ in stock' : '⛔ sold out'}  ${name}${cameBack ? '  <== CAME BACK' : ''}`)

    if (cameBack) {
      await post(restockMessage(row, stock))
      if (!DRY_RUN) console.log('   Posted to Discord.')
    }

    // A dry run writes NOTHING. Recording last_available here would be the worst kind of
    // side effect: inspecting the watcher while the item happened to be in stock would move
    // the row past the edge, and the real run ten minutes later would see no change and stay
    // silent. The alert would be lost to having looked at it.
    if (DRY_RUN) continue

    await supabase.from('wpbl_restock_watch').update({
      last_available: stock.available,
      last_checked_at: now,
      last_ok_at: now,
      last_error: null,
      error_notified_at: null,
      ...(cameBack ? { last_notified_at: now } : {}),
    }).eq('id', row.id)
  }
}

if (IS_ENTRYPOINT) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
