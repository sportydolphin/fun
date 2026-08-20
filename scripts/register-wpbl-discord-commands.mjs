#!/usr/bin/env node
/**
 * register-wpbl-discord-commands.mjs — tell Discord which slash commands the bot has.
 *
 * Commands are registered with Discord, not served from the app: the endpoint in
 * functions/discord/wpbl.ts only ever ANSWERS an interaction, it can't declare one. So this
 * runs by hand whenever the command list changes, which in practice means once.
 *
 * Global vs guild. A global command is visible in every server the bot is in and can take
 * up to an hour to appear. A guild command appears instantly in the one server, which is
 * what you want while setting this up. Pass DISCORD_GUILD_ID to register to a guild; leave
 * it unset to go global.
 *
 * Usage:
 *   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... \
 *     node scripts/register-wpbl-discord-commands.mjs
 *   ... --list     show what is currently registered, change nothing
 *   ... --clear    remove every command (the escape hatch for a bad registration)
 *
 * The bot token is a real credential, unlike the public key the endpoint uses. It belongs in
 * .env and nowhere else. This script is the only thing that needs it: the endpoint verifies
 * signatures with the public key and never calls the Discord API.
 */

const APP_ID = (process.env.DISCORD_APP_ID ?? '').trim()
const BOT_TOKEN = (process.env.DISCORD_BOT_TOKEN ?? '').trim()
const GUILD_ID = (process.env.DISCORD_GUILD_ID ?? '').trim()

const args = new Set(process.argv.slice(2))
const LIST = args.has('--list')
const CLEAR = args.has('--clear')

if (!APP_ID || !BOT_TOKEN) {
  console.error('❌  Set DISCORD_APP_ID and DISCORD_BOT_TOKEN (Developer Portal → your app → Bot).')
  process.exit(1)
}

const scope = GUILD_ID ? `guilds/${GUILD_ID}` : ''
const URL = `https://discord.com/api/v10/applications/${APP_ID}/${scope ? `${scope}/` : ''}commands`

// Option types, from Discord's API: 1 = SUB_COMMAND, 3 = STRING, 4 = INTEGER.
//
// `autocomplete` is what lets the endpoint suggest players while the reader types; without it
// Discord sends only the final submitted string.
//
// `default_member_permissions` on /predict is 8192 (MANAGE_MESSAGES), which hides the whole
// command from everyone who is not a mod. That is presentation, not security: a server owner
// can override it per role, so the endpoint checks the same permission itself on every
// subcommand. Players never need it either way, since they answer a round with buttons.
const MANAGE_MESSAGES = String(1 << 13)

const COMMANDS = [
  {
    name: 'player',
    description: "Look up a WPBL player's stats this season",
    options: [
      {
        name: 'name',
        description: 'Player name (partial or misspelled is fine)',
        type: 3,
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: 'predict',
    description: 'Run the in-game predictions game',
    default_member_permissions: MANAGE_MESSAGES,
    dm_permission: false,
    options: [
      {
        name: 'open',
        description: 'Ask how many runs the next half-inning brings',
        type: 1,
        options: [
          {
            name: 'seconds',
            description: 'How long picks stay open (default 120). Picks also close when the inning starts.',
            type: 4,
            required: false,
            min_value: 15,
            max_value: 600,
          },
          {
            name: 'team',
            description: 'Which game, when more than one is on',
            type: 3,
            required: false,
          },
        ],
      },
      { name: 'lock', description: 'Close picks now, without waiting for the timer', type: 1 },
      { name: 'cancel', description: 'Throw the live round away; its picks count for nothing', type: 1 },
      { name: 'standings', description: 'Post the board for this game so far', type: 1 },
      { name: 'winner', description: 'Close the game out and crown one winner', type: 1 },
    ],
  },
]

async function discord(method, body) {
  const res = await fetch(URL, {
    method,
    headers: { authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  if (!res.ok) {
    // Discord's errors here are specific and worth reading verbatim: a bad token is 401,
    // an app id that isn't yours is 403, and a malformed option is a 400 naming the field.
    throw new Error(`${method} ${res.status}: ${text}`)
  }
  return text ? JSON.parse(text) : null
}

async function main() {
  console.log(`${GUILD_ID ? `Guild ${GUILD_ID}` : 'Global'} · app ${APP_ID}`)

  if (LIST) {
    const current = await discord('GET')
    if (!current?.length) { console.log('No commands registered.'); return }
    for (const c of current) console.log(`  /${c.name} — ${c.description}`)
    return
  }

  if (CLEAR) {
    // PUT with an empty array is the documented way to remove the lot in one call.
    await discord('PUT', [])
    console.log('✅  Cleared every command.')
    return
  }

  // PUT replaces the whole set, so this is idempotent: running it twice leaves one copy of
  // each command rather than duplicates.
  const result = await discord('PUT', COMMANDS)
  for (const c of result ?? []) console.log(`✅  /${c.name}`)
  console.log(GUILD_ID
    ? 'Registered to the guild — it should appear in Discord immediately.'
    : 'Registered globally — Discord can take up to an hour to show it everywhere.')
}

main().catch(err => { console.error('❌ ', err.message); process.exit(1) })
