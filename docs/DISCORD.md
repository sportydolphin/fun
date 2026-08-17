# Discord integrations (WPBL)

Five things **post** to the WPBL fan server, all through **webhooks**: send-only HTTP, no bot
token, no gateway, nothing to keep running:

| What | Channel | Written by | Behaviour |
|---|---|---|---|
| **Watch-party board** | wherever you point its webhook | [`scripts/update-wpbl-discord-board.mjs`](../scripts/update-wpbl-discord-board.mjs) | One message, edited forever. Always shows the next few games with live countdowns. |
| **Box scores** | a different channel | [`supabase/functions/wpbl-ingest/announce-final.ts`](../supabase/functions/wpbl-ingest/announce-final.ts) and [`scripts/post-wpbl-discord-recaps.ts`](../scripts/post-wpbl-discord-recaps.ts) | One message per finished game, edited in place if the stats are corrected later. |
| **Highlight reels** | the highlights channel | [`scripts/post-wpbl-discord-highlights.mjs`](../scripts/post-wpbl-discord-highlights.mjs) | One message per YouTube highlight reel, posted once and never touched again. |
| **Shop feed** | a shop channel | [`scripts/watch-wpbl-restock.mjs`](../scripts/watch-wpbl-restock.mjs) | New merch and restocks across the whole store, batched into one message per run. Never pings. |
| **Shortlist alerts** | a private channel | the same script | A loud `@everyone` when something on the `wpbl_restock_watch` shortlist comes back. |

A webhook is bound to one channel, so each of these needs its **own** webhook URL.

There is also one thing that **answers** in the server, which webhooks cannot do:

| What | Written by | Behaviour |
|---|---|---|
| **`/player` slash command** | [`functions/discord/wpbl.ts`](../functions/discord/wpbl.ts) | Looks up any WPBL player by name and replies with their season. Suggests names as you type. |

## How it fits together

### The board

`wpbl-discord-board` runs every 15 minutes and edits a single message, so the channel stays
exactly one message tall. The id of the message it owns lives in `wpbl_discord_board_state`,
not in an env var, so it survives a deleted message (it recreates and re-records).

### The box scores

A finished game is posted by whichever of two writers gets there first:

- **`wpbl-ingest`** (the edge function, on its own pg_cron pass) posts the moment it sees a
  game flip from not-final to final. This is the fast path, seconds to a couple of minutes.
- **`wpbl-discord-recaps`** (the hourly GitHub Action) is the backstop and the corrections
  pass: it posts anything the ingest missed, and re-renders recent finals to edit a message
  whose stats have since changed.

They can't double-post. Each claims a game by primary key in `wpbl_discord_recap_posts`, so
the second writer's insert conflicts and it backs off. Both render through
[`src/wpbl/derive/discordRecap.ts`](../src/wpbl/derive/discordRecap.ts) and store the same
hash of the rendered message, so neither "corrects" the other's work: an unchanged game
produces an unchanged hash and no Discord call at all.

**Neither backfills.** The ingest only announces a genuine transition, so re-ingesting a
season of finished games stays silent. The scheduled job's first run against an empty
`wpbl_discord_recap_posts` posts only the most recently completed game and records the rest
as handled. Switching this on puts one game in the channel, not a season.

### The highlight reels

The league uploads a highlights reel per game to YouTube. `wpbl-youtube-sync` already
mirrors that channel into `wpbl_videos` twice an hour, classifying each upload and
resolving a highlight's title to the game it recaps, so the poster never touches YouTube
itself. It runs as the **step straight after the sync in that same workflow**, which is why
there is no separate schedule for it: a reel reaches Discord in the same pass that
discovers it.

One message per video, keyed by YouTube id in `wpbl_discord_highlight_posts`, posted once.
There is no edit pass and no content hash, unlike the box scores. A highlight message is a
link, and the league doesn't revise an upload the way it revises a box score.

The message is a title line and a bare YouTube URL, nothing else. The bare URL on its own
line is what Discord unfurls into an inline player, which is the whole point of the
channel. **Don't add a second link.** It draws its own embed card, which lands beside the
YouTube player and competes with it. That link back to the site was in the first version
and had to come out. The **final score is also deliberately absent**: the recap channel
already carries box scores, and a scoreline above the player spoils the video for anyone
who came to watch. Both are one edit away in `buildMessage` if you disagree.

**It doesn't backfill** either: the first run against an empty table posts only the newest
reel and records the rest as handled.

### The shop feed and the shortlist alerts

`wpbl-restock-watch` runs every 10 minutes and mirrors the league's Shopify catalogue, then
announces what changed. It started as one question, since the giveaway winner chose a cap that
was out of stock and the shop has no back-in-stock notification of its own; asking that about
the whole store is the same job with a snapshot behind it.

**Two audiences, two volumes.** 241 of 271 variants are sold out, so a restock day could move
a lot at once, and a channel that pings on all of it gets muted before it is ever useful.

| Channel | Secret | Gets | Pings |
|---|---|---|---|
| Shop | `DISCORD_SHOP_WEBHOOK_URL` | Everything: new merch and every restock, batched into one message per run | Never |
| Private | `DISCORD_RESTOCK_WEBHOOK_URL` | Only products on the `wpbl_restock_watch` shortlist | `@everyone` |

A shortlisted product restocking produces both. They are different channels for different
audiences, so that is a complete shop feed plus a targeted alert, not a duplicate. If
`DISCORD_SHOP_WEBHOOK_URL` is unset the feed falls back to the private channel, so the job
degrades to one channel rather than losing the feed.

**It announces a change, not a state.** At ten-minute intervals "this is in stock" stays true
for as long as the item sits there, so the snapshot in `wpbl_shop_products` /
`wpbl_shop_variants` is what stops 144 messages a day. A variant going false to true is a
restock; a product id never seen before is new merch. When something sells out again it
re-arms, so the next restock is announced like the first.

**The first run announces nothing.** An empty snapshot would otherwise read as 78 brand-new
products in one enormous message. Seeding records the catalogue and stays quiet; real changes
are announced from the second run. The one exception is the shortlist: a shortlisted item that
is available during seeding is still shouted about, because missing that is the failure the
job exists to prevent.

**It never buys.** It notifies humans and stops: no cart, no checkout. The store's own
`robots.txt` asks that checkout stay human, and buying on someone's behalf the instant a page
changes is not a thing to automate.

**How it asks.** Shopify serves `/products.json` on every storefront: the published catalogue,
78 products in one page here, with an explicit `available` per variant. `robots.txt` permits it
(only `/cart.js` and the checkout paths are disallowed) and sets no `Crawl-delay`. The watcher
sends an honest `User-Agent` naming the site rather than impersonating a browser, so the store
can identify and block it if they would rather it stopped.

**The failure that matters is silence**, because a watcher with nothing to say looks exactly
like a watcher that has died. Every run is recorded in `wpbl_shop_watch_runs`, and if the store
stops answering for six hours the job says so in the shop channel. That does not cover the job
never starting at all: see the limitations at the end of this doc.

The shortlist is a table, so adding something worth shouting about is an insert:

```sql
insert into wpbl_restock_watch (product_handle, variant_id, label, note)
values ('some-product-handle', null, 'Friendly name', 'Why we care');
```

`variant_id` null means "shout when any variant is available", which is what you want for a
product with sizes. Pin it when the product has one variant, or when a future second colourway
should not read as this one coming back. Everything else in the store is covered by the shop
feed without needing a row at all.

### The `/player` command

The only piece here that is a real bot rather than a webhook, because it has to receive
something rather than just send.

Discord runs bots two ways. A **gateway** bot holds a websocket open and needs a process
running somewhere permanently, which this project has nowhere to put. An **HTTP
interactions endpoint** instead receives each slash command as an ordinary POST and replies
in the response body. That is what this is: a Cloudflare Pages function at
`/discord/wpbl`, deployed with the site, costing nothing when nobody is asking and with no
bot process to keep alive or restart.

Name matching is deliberately loose, in [`src/wpbl/playerSearch.ts`](../src/wpbl/playerSearch.ts).
It takes the full name, either name alone, both in either order, an initial plus a surname,
a prefix of anything (`whit`, `kels`), and ordinary misspellings by edit distance. Accents
are folded, so `maika dumais` finds Maïka Dumais. This is a separate module from the
ingest's [`names.ts`](../supabase/functions/wpbl-ingest/names.ts) on purpose: that one
reconciles feed records and must be strict, because a wrong match forks a player's season
across two rows. A wrong match here just shows a "did you mean".

The roster is cached, which matters more than it sounds. Discord fires an autocomplete
interaction as the reader types, several per search, and each needs the whole roster to
match against, so the first version re-read every player and every team per keystroke. It
now goes through a memo in the isolate (free, instant, covers the burst within one search)
backed by the Cache API (shared across isolates in a colo, covers the gap between searches),
on a five-minute TTL. Box-score lines are deliberately left uncached: they move during a
live game, they're per player, and a stale batting line is the one thing anyone would
notice.

The reply is public so lookups can be shared. A miss, an ambiguous name, or a failure is
**ephemeral** (only the person who ran it sees it), so a channel doesn't fill up with other
people's typos. Both are built in
[`src/wpbl/discordPlayerCard.ts`](../src/wpbl/discordPlayerCard.ts) and unit tested.

## One-time setup

### 1. Create the webhook

In Discord: **Channel Settings → Integrations → Webhooks → New Webhook**, then *Copy
Webhook URL*. It looks like `https://discord.com/api/webhooks/<id>/<token>`. Treat it as a
secret: anyone holding it can post to that channel.

### 2. Create the table

```bash
npm run migrate
```

Applies [`…_wpbl_discord_recap_posts.sql`](../scripts/migrations/20260813223000_wpbl_discord_recap_posts.sql)
and [`…_wpbl_discord_highlight_posts.sql`](../scripts/migrations/20260814190000_wpbl_discord_highlight_posts.sql).
Both are RLS-on with no policies: they are bookkeeping for a job, not public data.

### 3. Put the URL in **both** secret stores

They are separate systems and neither can see the other's:

| Store | Used by | How |
|---|---|---|
| **GitHub repo secrets** | the hourly `wpbl-discord-recaps` workflow | Settings → Secrets and variables → Actions → `DISCORD_RECAP_WEBHOOK_URL` |
| **Supabase function secrets** | `wpbl-ingest`'s immediate post | `supabase secrets set DISCORD_RECAP_WEBHOOK_URL='https://…'` |

The highlights poster needs only the GitHub one, under its own name, a different webhook,
for the highlights channel: Settings → Secrets and variables → Actions →
`DISCORD_HIGHLIGHTS_WEBHOOK_URL`. Until it is set, the step in `wpbl-youtube-sync` prints a
line saying so and exits 0, so the video sync itself keeps working either way.

The Supabase one is optional. Without it `announceFinal` returns on its first line and the
hourly job remains the only poster, which is a good way to deploy the function and confirm
ingestion is healthy before turning the posting on. Setting a secret needs no redeploy; the
next invocation picks it up.

### 4. Look before it sends

```bash
npm run discord-recaps -- --dry-run
```

Renders every eligible game to stdout and sends nothing. The same thing is available in CI:
run the workflow manually with **dry-run**, which also proves the secret resolves there.

Then run it for real once (workflow → **post**), and leave the schedule to it.

### 5. The shop watcher, if you want one

It is independent of everything above: its own channel, its own webhook, its own secret.

1. Make the channel private if the alert is not for everyone (**Edit Channel → Permissions**,
   deny `@everyone` **View Channel**, allow the people who should see it). A webhook posts
   regardless of who can read the channel, so a private channel changes nothing about the job.
2. **Channel Settings → Integrations → Webhooks → New Webhook**, copy the URL.
3. Settings → Secrets and variables → Actions → `DISCORD_RESTOCK_WEBHOOK_URL`.
   Then repeat 1 and 2 for a second, ordinary channel and add its URL as
   `DISCORD_SHOP_WEBHOOK_URL`. That one carries the whole-store feed and never pings, so it
   does not want to be the private channel. Skip it and the feed falls back to the private
   channel, which works but mixes a lot of routine traffic in with the alerts.
4. The restock alert pings **`@everyone`** by default, so the channel is actually notified
   rather than the message waiting to be noticed. In a private channel that reaches exactly
   the people who can see it. To narrow it, set `DISCORD_RESTOCK_MENTION` to a user
   (`<@123456789012345678>`) or a role (`<@&123456789012345678>`); set it to an empty value
   to ping nobody. Get an id with Developer Mode on, then right-click → *Copy ID*.
5. Prove the webhooks resolve in CI before trusting them: run **WPBL Shop Restock Watch**
   manually with **test_post** ticked. That posts a sample to each configured channel and
   checks no stock.
6. Then let it run once normally. That first real run **seeds** the catalogue and announces
   nothing; changes are announced from the run after.

Until `DISCORD_RESTOCK_WEBHOOK_URL` is set the scheduled job prints a line saying it has
nowhere to announce and exits 0. That is on purpose: the workflow ships before the secret
does, and a job that fails every ten minutes until someone pastes a URL is a job everyone
has learned to ignore by the time it matters.

```bash
npm run restock-watch -- --status     # snapshot size, the shortlist, last successful run
npm run restock-watch -- --dry-run    # check the store now; writes nothing, posts nothing
npm run restock-watch -- --reseed     # re-record the catalogue silently, announce nothing
```

All of these need `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, since the shop tables are
RLS'd with no policies and no other key can see them at all.

Use `--reseed` after a deliberate change that would otherwise produce a flood: if the store
rebuilds its catalogue and every product gets a new id, a normal run would announce all 78 as
new merch. Reseed, confirm `--status` looks right, and let the schedule resume.

## Running it by hand

```bash
npm run discord-recaps -- --dry-run   # render, send nothing (anon key is fine)
npm run discord-recaps                # post the newest unposted final, update the rest
npm run discord-recaps -- --seed      # record every final as handled, post nothing
```

```bash
npm run discord-highlights -- --dry-run   # render, send nothing (anon key is fine)
npm run discord-highlights                # post whatever reels are new
npm run discord-highlights -- --seed      # record every reel as handled, post nothing
```

In CI the highlights modes are the `highlights_mode` input on the **WPBL YouTube Sync**
workflow (`dry-run` / `post` / `seed` / `skip`); a scheduled run always takes the normal
post path.

Posting needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `DISCORD_RECAP_WEBHOOK_URL`.
**The service-role key is not optional for a real run**: `wpbl_discord_recap_posts` is
service-role only, and any other key reads it as *empty* rather than erroring, which the
job would take to mean "nothing posted yet" and repost everything. It refuses to start
without it; `--dry-run` will run on the anon key and warn about what it cannot see.

## Setting up the `/player` command

Separate from the webhooks above, and needs an actual Discord **application**.

### 1. Create the app and invite it

Discord Developer Portal → **New Application**. Under **Bot**, create the bot. Under
**OAuth2 → URL Generator**, tick the `applications.commands` scope and open the generated
URL to add it to the server. The bot needs no message permissions and never reads chat: it
only receives the interactions Discord forwards.

### 2. Register the command

```bash
DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... npm run discord-commands
```

`DISCORD_GUILD_ID` registers to that one server and appears **immediately**, which is what
you want while setting up. Leave it unset to register globally, which Discord can take an
hour to roll out. The script `PUT`s the whole command set, so re-running it replaces rather
than duplicates. `--list` shows what is registered and `--clear` removes everything.

The **bot token is a real credential** (unlike the webhook URLs, and unlike the public key
below). It is only ever needed by this script. The endpoint itself never calls Discord's
API and never sees it.

### 3. The public key

Already committed, in `functions/discord/wpbl.ts` as `PUBLIC_KEY`. Nothing to do here
unless you replace the Discord application.

It is checked in deliberately. This is a public key in the literal sense: it verifies that
a request was signed by Discord, and forging a signature needs the matching private key,
which Discord holds and never discloses. Publishing it grants nobody anything, and Discord
prints it openly in the portal. Keeping it in the repo means the endpoint survives
redeploys and Cloudflare dashboard changes with nothing to re-enter.

If the app is ever rotated, either edit that constant or set `DISCORD_PUBLIC_KEY` in the
Cloudflare environment, which takes precedence when present.

### 4. Point Discord at the endpoint

Developer Portal → General Information → **Interactions Endpoint URL**:

```
https://sportydolphin.fun/discord/wpbl
```

Discord validates it on save by sending requests with deliberately **invalid** signatures
and requiring a `401` back. The function does that, so a green save means signature
verification is working end to end.

Check the endpoint yourself before pasting it in. One line tells you everything:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://sportydolphin.fun/discord/wpbl -d '{"type":1}'
```

| Response | Meaning |
|---|---|
| `401` | Live and verifying. This is the one Discord wants. |
| `405` | The function is not being invoked. **Almost always `_routes.json`**: see the traps below. It also looks exactly like this when the function failed to build, or before it has deployed at all. |
| `503` | Older builds only, when `DISCORD_PUBLIC_KEY` was an environment variable. The key is committed now, so this should not happen. |

A `405` cost real time during setup and the build log gives nothing away, so start at
`_routes.json` rather than at the function.

## Two traps worth knowing about

### A new function route needs adding to `_routes.json`

`public/_routes.json` lists the paths that invoke the Functions worker, and it is an
allow-list:

```json
{ "version": 1, "include": ["/wpbl", "/discord/wpbl"], "exclude": [] }
```

Anything not listed is served as a static asset, so a new function under `functions/` will
compile, upload, deploy, and then never run. The build log says `Compiled Worker
successfully` either way, which makes this a genuinely quiet failure: the symptom is the new
route answering `405` to a POST and serving the SPA's HTML to a GET, indistinguishable from
a path that does not exist. Add the route here when you add the function.

The narrow list is deliberate, not an oversight: it keeps the worker off the path for every
static asset request. Widen it one route at a time rather than switching to `/*`.

### Functions can't import anything Vite-only

Cloudflare bundles `functions/` with esbuild, which has no Vite plugins. Anything a function
imports, however far down the chain, has to be plain TypeScript. `src/wpbl/constants.ts`
imports the team logos as `.webp`, so importing it from a function fails the build with
`No loader is configured for ".webp" files`: and a failed functions build does not take the
site down, it just leaves the previous deployment serving. The symptom is the new route
answering `405` forever while everything else looks healthy.

`outsToIp` is the one people reach for: import it from `./innings`, not from the
`./constants` re-export.

`functions/` was outside `tsconfig.json`'s `include` until this bot was built, so neither
Pages function was type-checked at all, the same blind spot that let the `.webp` import
through. It is in the include list now, so `npx tsc --noEmit` covers them. Bundling is a
separate check, because a type error and an unbundleable import are different failures:

```bash
npm run check-functions
```

which bundles each function exactly as Cloudflare will and fails loudly instead of silently.

## Notes & limitations

- **Deleting a post in Discord** is not permanent: the next pass sees the 404 and reposts.
  To retire a game for good, leave its row in `wpbl_discord_recap_posts` with a non-empty
  `content_hash` and `message_id` set to null, which is the "handled, never post" marker.
- **A message with `message_id` null and an empty `content_hash`** is a claim the edge
  function staked and never completed. The scheduled job treats that as its own to finish.
- **Corrections stop after three days** (`WINDOW_DAYS` in the poster). A revision landing
  later than that won't be picked up; the site still shows it.
- **The recap wording is the site's**, from [`src/wpbl/derive/recap.ts`](../src/wpbl/derive/recap.ts),
  the same engine behind the Recap tab. Change it there and both follow. See
  [context.md](../context.md) for the `.ts`-extension rule that keeps that module loadable
  by Deno.
- **Nothing here pings anyone, with one deliberate exception.** The board, box scores,
  highlights and `/player` all set `allowed_mentions: { parse: [] }`. The restock watcher is
  the exception and pings `@everyone` by default, because it is the one integration whose
  entire value is reaching people before the item sells out again. What Discord is allowed to
  act on is derived from the mention the job was **configured** with, never from the message
  text, so a product renamed to `<@&some-role>` cannot ping a role the job was not already
  pinging. That protection does not extend to `@everyone` itself while `@everyone` is the
  configured mention, which is a distinction without a difference: the message is pinging
  everyone either way. The
  `/player` reply also strips markdown characters out of whatever was typed before echoing
  it back, so a search string can't carry formatting into a channel message.
- **The `/player` command answers within 3 seconds or Discord gives up** and shows "the
  application did not respond". The function holds itself to a 2.2s budget so a slow or
  unreachable database produces a real message instead of that. If it ever does start
  timing out, the fix is to defer (respond type 5, then PATCH the followup) rather than to
  raise the budget.
- **The bot reads nothing.** It has no message permissions and only ever sees the
  interactions Discord forwards to it.
- **A deleted highlight post stays deleted.** Unlike the box scores, this poster never
  re-checks Discord. The row in `wpbl_discord_highlight_posts` is the whole memory. Delete
  that row to make it post again.
- **A reel only posts within four days of upload** (`WINDOW_DAYS` in the poster), so one
  that slips through can't surface a fortnight later looking like news. `--seed` ignores
  the window on purpose.
- **The shop watcher can be killed by GitHub, silently.** Scheduled workflows are disabled
  automatically after 60 days without repository activity. For a watch that may run for weeks
  waiting on a restock, that is the likeliest way it dies, and the job's own outage notice
  cannot cover it: a job that never starts cannot report on itself. If the wait gets long,
  check the workflow is still enabled.
- **`--dry-run` on the watcher writes nothing at all**, deliberately. Recording what it saw
  would move the row past the sold-out/in-stock edge, and the real run ten minutes later would
  see no change and stay silent. The alert would be lost to having looked at it.
- **A restock is announced, not secured.** Ten-minute polling plus GitHub's best-effort cron
  means the message can arrive twenty minutes after the item returns. For a popular drop that
  may be too late, and nothing here changes that: buying is a human step, on purpose.
- **A shortlisted product that leaves the catalogue is logged, not announced.** The run prints
  a warning and carries on rather than throwing, since one stale shortlist row should not stop
  the whole store being watched. Check the run log if a shortlisted item goes quiet for a
  suspiciously long time, and update `wpbl_restock_watch`.
- **An empty catalogue is treated as an error, not a mass delisting.** A 200 with no products
  is the store having a bad day. Accepting it would mark all 78 products delisted and then
  announce them all back as new the moment it recovered.
- **A drop-day message is truncated at 12 items per section**, with a count of the rest, since
  Discord caps a message at 2000 characters and nobody reads sixty bullet points anyway.
- **Prices come from `/products.json` as decimal strings** (`"39.99"`), unlike the per-product
  `/products/<handle>.js` endpoint, which gives integer cents. The two are easy to confuse and
  the symptom is a $40 cap posted at $0.40.
- **What counts as a highlight** is `classify()` in
  [`scripts/sync-wpbl-youtube.mjs`](../scripts/sync-wpbl-youtube.mjs): a title containing
  "highlight(s)" *and* a matchup separator (`@` or `vs.`). Single-play clips ("Kelsie
  Whitmore 1st WPBL homer") and full-game uploads ("WPBL: Boston Hunters @ New York
  Heights") are `other` and are not posted.
