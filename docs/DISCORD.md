# Discord integrations (WPBL)

Two things post to the WPBL fan server, both through **webhooks** — send-only HTTP, no bot
token, no gateway, nothing to keep running:

| What | Channel | Written by | Behaviour |
|---|---|---|---|
| **Watch-party board** | wherever you point its webhook | [`scripts/update-wpbl-discord-board.mjs`](../scripts/update-wpbl-discord-board.mjs) | One message, edited forever. Always shows the next few games with live countdowns. |
| **Box scores** | a different channel | [`supabase/functions/wpbl-ingest/announce-final.ts`](../supabase/functions/wpbl-ingest/announce-final.ts) and [`scripts/post-wpbl-discord-recaps.ts`](../scripts/post-wpbl-discord-recaps.ts) | One message per finished game, edited in place if the stats are corrected later. |

A webhook is bound to one channel, so each of these needs its **own** webhook URL.

## How it fits together

### The board

`wpbl-discord-board` runs every 15 minutes and edits a single message, so the channel stays
exactly one message tall. The id of the message it owns lives in `wpbl_discord_board_state`,
not in an env var, so it survives a deleted message (it recreates and re-records).

### The box scores

A finished game is posted by whichever of two writers gets there first:

- **`wpbl-ingest`** (the edge function, on its own pg_cron pass) posts the moment it sees a
  game flip from not-final to final. This is the fast path — seconds to a couple of minutes.
- **`wpbl-discord-recaps`** (the hourly GitHub Action) is the backstop and the corrections
  pass: it posts anything the ingest missed, and re-renders recent finals to edit a message
  whose stats have since changed.

They can't double-post. Each claims a game by primary key in `wpbl_discord_recap_posts`, so
the second writer's insert conflicts and it backs off. Both render through
[`src/wpbl/derive/discordRecap.ts`](../src/wpbl/derive/discordRecap.ts) and store the same
hash of the rendered message, so neither "corrects" the other's work — an unchanged game
produces an unchanged hash and no Discord call at all.

**Neither backfills.** The ingest only announces a genuine transition, so re-ingesting a
season of finished games stays silent. The scheduled job's first run against an empty
`wpbl_discord_recap_posts` posts only the most recently completed game and records the rest
as handled. Switching this on puts one game in the channel, not a season.

## One-time setup

### 1. Create the webhook

In Discord: **Channel Settings → Integrations → Webhooks → New Webhook**, then *Copy
Webhook URL*. It looks like `https://discord.com/api/webhooks/<id>/<token>`. Treat it as a
secret — anyone holding it can post to that channel.

### 2. Create the table

```bash
npm run migrate
```

Applies [`scripts/migrations/20260813223000_wpbl_discord_recap_posts.sql`](../scripts/migrations/20260813223000_wpbl_discord_recap_posts.sql).
The table is RLS-on with no policies: it is bookkeeping for a job, not public data.

### 3. Put the URL in **both** secret stores

They are separate systems and neither can see the other's:

| Store | Used by | How |
|---|---|---|
| **GitHub repo secrets** | the hourly `wpbl-discord-recaps` workflow | Settings → Secrets and variables → Actions → `DISCORD_RECAP_WEBHOOK_URL` |
| **Supabase function secrets** | `wpbl-ingest`'s immediate post | `supabase secrets set DISCORD_RECAP_WEBHOOK_URL='https://…'` |

The Supabase one is optional. Without it `announceFinal` returns on its first line and the
hourly job remains the only poster — which is a good way to deploy the function and confirm
ingestion is healthy before turning the posting on. Setting a secret needs no redeploy; the
next invocation picks it up.

### 4. Look before it sends

```bash
npm run discord-recaps -- --dry-run
```

Renders every eligible game to stdout and sends nothing. The same thing is available in CI:
run the workflow manually with **dry-run**, which also proves the secret resolves there.

Then run it for real once (workflow → **post**), and leave the schedule to it.

## Running it by hand

```bash
npm run discord-recaps -- --dry-run   # render, send nothing (anon key is fine)
npm run discord-recaps                # post the newest unposted final, update the rest
npm run discord-recaps -- --seed      # record every final as handled, post nothing
```

Posting needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `DISCORD_RECAP_WEBHOOK_URL`.
**The service-role key is not optional for a real run**: `wpbl_discord_recap_posts` is
service-role only, and any other key reads it as *empty* rather than erroring — which the
job would take to mean "nothing posted yet" and repost everything. It refuses to start
without it; `--dry-run` will run on the anon key and warn about what it cannot see.

## Notes & limitations

- **Deleting a post in Discord** is not permanent: the next pass sees the 404 and reposts.
  To retire a game for good, leave its row in `wpbl_discord_recap_posts` with a non-empty
  `content_hash` and `message_id` set to null — that is the "handled, never post" marker.
- **A message with `message_id` null and an empty `content_hash`** is a claim the edge
  function staked and never completed. The scheduled job treats that as its own to finish.
- **Corrections stop after three days** (`WINDOW_DAYS` in the poster). A revision landing
  later than that won't be picked up; the site still shows it.
- **The recap wording is the site's**, from [`src/wpbl/derive/recap.ts`](../src/wpbl/derive/recap.ts) —
  the same engine behind the Recap tab. Change it there and both follow. See
  [context.md](../context.md) for the `.ts`-extension rule that keeps that module loadable
  by Deno.
- **Nothing here pings anyone**: every payload sets `allowed_mentions: { parse: [] }`.
