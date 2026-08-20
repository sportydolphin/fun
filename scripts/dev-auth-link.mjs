#!/usr/bin/env node
/**
 * dev-auth-link.mjs: mint a real auth callback URL that points at localhost.
 *
 * THE PROBLEM THIS SOLVES. A password-reset or confirmation email cannot be tested locally by
 * clicking it. The `redirectTo` the app asks for has to be in the Supabase project's redirect
 * allow-list, and when it is not, Supabase does not fail: it silently substitutes the project's
 * Site URL. So the link lands on sportydolphin.fun, running whatever is deployed, and the
 * change you are trying to test is never executed. Nothing anywhere says this happened.
 *
 * WHAT IT DOES INSTEAD. It builds, by hand, the exact URL Supabase's `/auth/v1/verify` endpoint
 * would have redirected to, with the host swapped for your dev server:
 *
 *   http://localhost:5173/wpbl#access_token=...&refresh_token=...&expires_in=...&token_type=bearer&type=recovery
 *
 * That fragment is the whole of the callback. The tokens in it are real and were never tied to
 * an origin: the origin check happened back at the verify endpoint, which we are standing in
 * for. Paste the URL into a browser and the supabase client consumes it exactly as it would in
 * production, saves the session, and raises the same event. Every line of app code downstream
 * runs for real, including the parts that read the fragment before the client wipes it.
 *
 * HOW THE TOKENS ARE OBTAINED, without sending any email: the admin API generates the link for
 * a user (`generateLink` generates, it does not send), which hands back the one-time OTP that
 * would have been inside it; redeeming that OTP with the ordinary anon client yields the same
 * session the real link would have produced.
 *
 * This is a development tool. It needs the service-role key, so it is never run anywhere but a
 * machine you own, and the URL it prints is a live credential for that account until it expires
 * (about an hour). Do not paste it anywhere but your own browser.
 *
 * Usage:
 *   npm run auth-link -- recovery you@example.com
 *   npm run auth-link -- signup   newperson@example.com
 *   npm run auth-link -- recovery you@example.com http://localhost:5173/mlb
 *
 * Env (from .env, loaded by the npm script):
 *   VITE_SUPABASE_URL or SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const TYPES = ['recovery', 'signup']
const DEFAULT_TARGET = 'http://localhost:5173/wpbl'

const [type, email, target = DEFAULT_TARGET] = process.argv.slice(2)

function fail(msg) {
  console.error(`\n❌  ${msg}\n`)
  process.exit(1)
}

if (!TYPES.includes(type) || !email) {
  fail(
    'Usage: npm run auth-link -- <recovery|signup> <email> [target-url]\n\n' +
    '  recovery   a password-reset link for an account that already exists\n' +
    '  signup     a confirmation link, creating the account if it is new\n\n' +
    `  target-url defaults to ${DEFAULT_TARGET}`
  )
}

const URL_BASE = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL_BASE || !ANON) fail('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be in .env.')
if (!SERVICE) {
  fail(
    'SUPABASE_SERVICE_ROLE_KEY is not set.\n\n' +
    '   Generating a link without sending an email is an admin operation, so this one needs the\n' +
    '   service-role key. Copy it from the Supabase dashboard (Project Settings → API Keys →\n' +
    '   service_role) and add it to .env as SUPABASE_SERVICE_ROLE_KEY.\n\n' +
    '   It bypasses every RLS policy you have. .env is already gitignored; keep it that way.'
  )
}

const admin = createClient(URL_BASE, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
// The anon client redeems the OTP, because the session that comes back has to be an ordinary
// user session: one minted under the service-role key would carry the wrong claims entirely.
const anon = createClient(URL_BASE, ANON, { auth: { autoRefreshToken: false, persistSession: false } })

// A confirmation link is generated for an account that does not exist yet, so `signup` has to
// supply a password. Random, printed, and only ever used if you go on to sign in with it rather
// than through the link.
const password = type === 'signup' ? `dev-${randomBytes(9).toString('base64url')}` : undefined

const { data: link, error: linkErr } = await admin.auth.admin.generateLink(
  type === 'signup' ? { type, email, password } : { type, email }
)

if (linkErr) {
  const m = linkErr.message.toLowerCase()
  if (m.includes('already been registered') || m.includes('already exists')) {
    fail(`${email} already has an account, so it cannot be sent a signup link. Use \`recovery\` instead.`)
  }
  if (m.includes('user not found')) {
    fail(`No account for ${email}. Use \`signup\` to create one, or check the address.`)
  }
  fail(`Supabase would not generate the link: ${linkErr.message}`)
}

const otp = link?.properties?.email_otp
if (!otp) fail('The link was generated but carried no one-time token, so there is nothing to redeem.')

const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({ email, token: otp, type })
if (verifyErr) fail(`The one-time token would not redeem: ${verifyErr.message}`)

const session = verified?.session
if (!session) fail('The token redeemed but produced no session, so there is no callback to build.')

// Exactly the parameters `_getSessionFromURL` requires, plus the `type` that decides whether the
// client raises PASSWORD_RECOVERY or SIGNED_IN. Anything missing here and the client reports
// "No session defined in URL" and carries on as an ordinary page load.
const fragment = new URLSearchParams({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
  expires_in: String(session.expires_in ?? 3600),
  token_type: session.token_type ?? 'bearer',
  type,
})

const base = target.split('#')[0]
console.log(`\n🔗  ${type} link for ${email}\n`)
console.log(`${base}#${fragment}\n`)
if (password) console.log(`    account password: ${password}\n`)
console.log('    Open it in a browser with the dev server running on that port.')
// The client warns on the console when a callback URL is more than two minutes old. Harmless,
// and worth saying so, because it reads like something went wrong.
console.log('    Use it within a couple of minutes, or the client logs a "URL could be stale" warning.')
console.log('    It is a live session for that account. Your browser only.\n')
