#!/usr/bin/env node
/**
 * google-auth.mjs — One-time helper to mint a Google Tasks refresh token.
 *
 * You only run this once. It opens a local consent flow, you approve read-only
 * access to your Google Tasks, and it prints a refresh token to paste into .env
 * (GOOGLE_REFRESH_TOKEN). After that, `npm run tasks` uses that token forever.
 *
 * Prereqs (see docs/GOOGLE_TASKS.md):
 *   • A Google Cloud project with the Tasks API enabled.
 *   • An OAuth client of type "Desktop app" — its client id + secret in .env as
 *     GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
 *
 * Usage:
 *   node --env-file=.env scripts/google-auth.mjs
 */

import http from 'node:http'
import crypto from 'node:crypto'

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? ''
const PORT          = Number(process.env.GOOGLE_AUTH_PORT ?? 5599)
const REDIRECT_URI  = `http://localhost:${PORT}`
const SCOPE         = 'https://www.googleapis.com/auth/tasks.readonly'

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌  Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first (see docs/GOOGLE_TASKS.md)')
  process.exit(1)
}

const state = crypto.randomBytes(16).toString('hex')

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id:     CLIENT_ID,
  redirect_uri:  REDIRECT_URI,
  response_type: 'code',
  scope:         SCOPE,
  access_type:   'offline',   // ask for a refresh token
  prompt:        'consent',    // force it even if previously granted
  state,
}).toString()

async function exchangeCode(code) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    }).toString(),
  })
  return r.json()
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI)
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
    res.writeHead(204); res.end(); return   // ignore favicon etc.
  }

  const err = url.searchParams.get('error')
  if (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end(`Authorization failed: ${err}. You can close this tab.`)
    console.error(`\n❌  Authorization was denied or failed: ${err}\n`)
    server.close(); process.exit(1)
  }

  if (url.searchParams.get('state') !== state) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('State mismatch. You can close this tab and re-run.')
    console.error('\n❌  State mismatch — possible CSRF, aborting. Re-run the script.\n')
    server.close(); process.exit(1)
  }

  const tokens = await exchangeCode(url.searchParams.get('code'))
  if (!tokens.refresh_token) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('No refresh token returned. Close this tab and re-run.')
    console.error('\n❌  No refresh_token in the response. Google only returns one on first consent —')
    console.error('    remove this app under myaccount.google.com/permissions, then re-run.\n')
    console.error('    Raw response:', JSON.stringify(tokens, null, 2))
    server.close(); process.exit(1)
  }

  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end('<h2>Done. You can close this tab and return to the terminal.</h2>')

  console.log('\n✅  Success. Paste this line into your .env file:\n')
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`)
  console.log('Then run:  npm run tasks\n')
  server.close(); process.exit(0)
})

server.listen(PORT, () => {
  console.log('\n🔗 Open this URL in your browser and approve read-only access to your Google Tasks:\n')
  console.log(`   ${authUrl}\n`)
  console.log(`Waiting for the redirect back to ${REDIRECT_URI} …  (Ctrl+C to cancel)\n`)
})
