# Discord integrations (WPBL)

Six things **post** to the WPBL fan server, all through **webhooks**: send-only HTTP, no bot
token, no gateway, nothing to keep running:

| What | Channel | Written by | Behaviour |
|---|---|---|---|
| **Watch-party board** | wherever you point its webhook | [`scripts/update-wpbl-discord-board.mjs`](../scripts/update-wpbl-discord-board.mjs) | One message, edited forever. Always shows the next few games with live countdowns. |
| **Box scores** | a different channel | [`supabase/functions/wpbl-ingest/announce-final.ts`](../supabase/functions/wpbl-ingest/announce-final.ts) and [`scripts/post-wpbl-discord-recaps.ts`](../scripts/post-wpbl-discord-recaps.ts) | One message per finished game, edited in place if the stats are corrected later. |
| **Highlight reels** | the highlights channel | [`scripts/post-wpbl-discord-highlights.mjs`](../scripts/post-wpbl-discord-highlights.mjs) | One message per YouTube highlight reel, posted once and never touched again. |
| **Shop feed** | a shop channel | [`scripts/watch-wpbl-restock.mjs`](../scripts/watch-wpbl-restock.mjs) | New merch and restocks across the whole store, batched into one message per run. Never pings. |
| **Shortlist alerts** | a private channel | the same script | A loud `@everyone` when something on the `wpbl_restock_watch` shortlist comes back. |
| **Mention watch** | a private channel | [`scripts/watch-wpbl-mentions.mjs`](../scripts/watch-wpbl-mentions.mjs) | One digest per run of the public posts where somebody is asking where to follow a WPBL game. Threads to go and answer, not content for the server. |
| **Birthdays** | a birthdays channel | [`scripts/post-wpbl-discord-birthdays.ts`](../scripts/post-wpbl-discord-birthdays.ts) | One message on the mornings someone on the roster has a birthday, and nothing on the mornings nobody does. |

A webhook is bound to one channel, so each of these needs its **own** webhook URL.

There are also two things that **answer** in the server, which webhooks cannot do:

| What | Written by | Behaviour |
|---|---|---|
| **`/player` slash command** | [`functions/discord/wpbl.ts`](../functions/discord/wpbl.ts) | Looks up any WPBL player by name and replies with their season. Suggests names as you type. |
| **`/predict`, the in-game game** | the same function, settled by [`settle-predictions.ts`](../supabase/functions/wpbl-ingest/settle-predictions.ts) | A mod opens a round on the half-inning coming up next; the channel answers with buttons; it closes itself as the inning starts and the feed settles it. One winner a game. |

## How it fits together

### The board

`wpbl-discord-board` runs every 15 minutes and edits a single message, so the channel stays
exactly one message tall. The id of the message it owns lives in `wpbl_discord_board_state`,
not in an env var, so it survives a deleted message (it recreates and re-records).

**Each game on the board links to its own watch-party event**, from a map built once and
then reused: put the event links in
[`scripts/wpbl-discord-events.txt`](../scripts/wpbl-discord-events.txt), run
`node scripts/map-wpbl-discord-events.mjs`, and it resolves each event's start time, matches
it to the `wpbl_games` row starting at the same instant, and writes
[`scripts/wpbl-event-urls.json`](../scripts/wpbl-event-urls.json), which the board script
loads. Re-run it whenever the events are replaced; it prints its pairings, lists anything it
could not match rather than guessing, and now also names any upcoming game left with no
event at all. It refuses to write an empty map over a populated one.

Two things about that map fail silently, and both have already happened:

- **The invite in each link must belong to the channel the events live on.** An invite
  carries a scheduled event only while the invite's channel IS the event's channel. The
  watch parties moved from a voice channel to a stage channel on Aug 23, 2026, the old
  invite stayed bound to the voice channel, and Discord stopped attaching the event to it:
  HTTP 200, a perfectly valid invite, `guild_scheduled_event` absent. All twenty links on
  the board became bare server invites with no RSVP, and nothing logged a thing. The fix
  was one new invite created on the stage channel; re-running the mapper against it matched
  all eleven remaining games at zero drift. Move the events again and this happens again,
  so create the invite on the new channel FIRST, then re-run the mapper.

  `https://discord.com/events/<guild>/<id>` links are the alternative: bound to the guild,
  so they survive a channel move. The cost is that Discord has no public endpoint for that
  form, so the mapper can only read those start times with `DISCORD_BOT_TOKEN` plus
  `DISCORD_GUILD_ID` (which also lets it list the guild's events and skip the txt file
  entirely). A same-channel invite needs no credential at all, which is why the txt file
  ships that form.
- **The map is keyed on `api_game_id`, never `wpbl_games.id`.** The ingest deletes phantom
  duplicates by `api_game_id` and reinserts the real row later with a fresh uuid, so a
  uuid-keyed map loses each game's entry days before it is played. Every past entry in the
  original file had already rotted this way, which is why the day's own game kept showing
  the generic fallback link.

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

### The birthdays

`wpbl-discord-birthdays` runs once a day at 14:00 UTC (9am at the league's Central hub in
summer, 8am in winter) and asks one question: whose birthday is it in Chicago today. Most
mornings the answer is nobody and the job posts nothing, which is the whole design. 105 of
the 118 players have a date settled enough to greet and they fall on 92 distinct days, so the
channel hears from it on roughly one morning in four.

The dates are not in the league's feed, which carries `age` and never a date. They are
collected by hand, and [`scripts/ingest-wpbl-birthdays.mjs`](../scripts/ingest-wpbl-birthdays.mjs)
reconciles two collections into `wpbl_players.birth_date`:

1. **The birthdays doc is the source of truth.** One date per player with the citations
   behind it (USA Baseball, WBSC daily reports, club Instagram accounts), and an explicit
   "we do not know" where the day has never been pinned down. Where it has a date, that date
   wins.
2. **The BDay sheet is the fallback**, for players the doc does not list. It lays everyone
   out twice, as a zodiac grid and an age-ordered list, so a sheet-only player can be checked
   against themselves; where the two halves disagree the grid wins and the row is flagged.

The doc covers the whole roster today, so the sheet is currently contributing nothing to it
beyond a second opinion. It stays wired up because the doc's coverage is a fact about today,
not a guarantee.

That reconciliation is why the poster is careful about two things:

- **Only a settled date is greeted.** `birth_date_source` records what kind of answer each
  row is: `'doc'` and `'sheet'` are settled, while `'doc-unsettled'` (the doc lists the
  player and says the date is not known) and `'sheet-conflict'` (the sheet contradicted
  itself) are not. This job greets the first two and skips the rest, because an unsettled
  date is a fine basis for a star sign on the site and not good enough to wish someone a
  happy birthday on a coin flip. Thirteen players are in that state today.
- **An age is only printed when the feed agrees with it.** On a birthday the league's `age`
  should read either the new age or the one just retired. Anything else means the collected
  year is wrong (Edith De Leija's says 24 where the feed says 22), and then the message names
  the day and leaves the number out.

One message covers everyone who shares the day, since thirteen pairs of players do and two
posts seconds apart read like a broken bot. The name links to the player's page with the URL
in angle brackets, which stops Discord unfurling a card that would be bigger than the post.

It never backfills and never edits. A birthday is one day: a run that misses its window has
missed it, and the next morning's run does not go looking for yesterday, because a late
greeting is worse than none. What stops a double post is `wpbl_discord_birthday_posts`, keyed
by player and date. Rows are claimed **before** the message is sent, so a manual run on top of
the schedule finds the day taken and stops.

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

### The mention watcher

`wpbl-mention-watch` runs every 15 minutes, searches Reddit posts, Reddit comments and Bluesky
for people talking about the WPBL, and digests the ones worth answering into a private channel.

**It finds threads. It does not answer them.** The only place it ever posts is our own webhook.
Do not give it a credential that would let it reply anywhere else: an automated reply in
somebody else's community is spam, it gets the account banned from exactly the communities
worth being in, and the reply is the half that needs a person. The digest carries a standing
reminder to that effect at the bottom of every message, which is not decoration.

**Facebook is absent and cannot be added.** That is where the traction actually is: two large
groups, and a recurring "where can I see live updates?" question in both. There is no permitted
automated path to it. The Groups API was withdrawn in 2024, group posts appear in no search
API, and scraping them violates the terms whichever account does it, our own included. The
durable fix there is not a faster way to notice but a **pinned resource link or a Featured
entry**, which turns the recurring question into a standing answer; see
[`BACKLINKS.md`](BACKLINKS.md). X is absent for a duller reason: search costs $200/month.

**Three kinds, three urgencies.** `classify()` in the script decides from post text alone, and
both failure modes are expensive: too loose and the channel is a firehose that gets muted
inside a day, so the real question arrives where nobody is looking; too tight and it never
arrives at all.

| Kind | What it is | Ping |
|---|---|---|
| `question` | Names the league **and** asks where to follow it. The whole reason the job exists | Yes |
| `link` | Names `sportydolphin`. Either a backlink worth thanking someone for or a complaint worth answering today | Yes |
| `mention` | The league discussed, no question attached | No |

Two rules in there are load-bearing. **Intent is matched as phrases, never single words**:
"watch", "score" and "stats" appear in every second baseball post ever written. And **club
nicknames are not subject terms on their own**: "Queens", "Heights" and "Hunters" are ordinary
English words, so only the full city-and-club spellings count, plus "Firebells", which is
unique enough to stand alone.

**Seeing and announcing are separate**, which is the one non-obvious thing in the script. The
search looks back a week, so the first run can find dozens at once. Every hit is recorded in
`wpbl_mention_hits` immediately; only eight per run are announced, and a row still holding
`announced_at` null is next run's message rather than something lost. Anything still waiting
after three days is marked announced **without** being posted: somebody else has answered by
then, and a backlog that drips for a fortnight is a muted channel.

**Both sources need a credential, and neither of them looks like it does.** This is worth
writing down because both were verified by hand on Aug 24, 2026 and both surprised us:

- **Reddit** answers 403 to every anonymous read now. Not just from datacentre IPs:
  `search.json`, `old.reddit.com` and even `/r/<sub>/new.json` all refuse a residential IP with
  an honest `User-Agent`. There is nothing to fall back to, so the app-only OAuth token is
  required.
- **Bluesky**'s public AppView serves `app.bsky.actor.getProfile` and
  `app.bsky.actor.searchActors` with no credential at all, and answers
  `app.bsky.feed.searchPosts` with a **CDN 403 HTML page**, not an XRPC error body, so it does
  not read as an auth failure. Post search is the one endpoint there that needs a token.

A source with no credentials is **skipped** with an actionable line in the log. It never fails
the run and never counts towards the everything-is-down notice, so a half-configured install
reports from one source rather than alarming about the other.

**The failure that matters is silence**, since a watcher with nothing to say looks exactly like
a watcher that has died. Every run is recorded in `wpbl_mention_watch_runs`, and if every
configured source has been failing for six hours the job says so, once.

**Reddit is two sources, not one**, because its search indexes link posts and nothing else.
The question this job exists to catch is more often a reply inside somebody else's game thread
than a post of its own, so `searchRedditComments` sweeps the comment listings of a short list of
subreddits (`COMMENT_SUBREDDITS`) on the same credential. It is registered separately in
`SOURCES` so that post search going down does not cost the comment sweep, or the reverse.

**A comment is judged differently from a post, and both halves of the rule carry weight.** The
subject may come from the parent post's title, because the comment worth finding reads, in full,
*"wait, where can I watch this?"*, under a thread titled "WPBL semifinal game thread": it names
no league, so the post classifier returns null for the single most valuable thing here. But the
intent has to come from the comment's own text, and **a comment can never be a plain `mention`**.
Without that second half every one of four hundred comments under that thread inherits the league
from the title and lands in the channel, one busy night buries a week of real questions, and the
channel is muted by morning.

**Our own posts never enter the queue either**, and this stopped being hypothetical the day
the Bluesky recap poster shipped: every recap it publishes carries `sportydolphin.fun`,
`SITE_TERMS` matches that, and a site match is classified `link`, the top-urgency kind and the
one that pings. `OWN_ACCOUNTS` drops them. It matches on the **author only**, which is the
difference from the competitor rule below and is deliberate twice over. Not the domain, because
somebody *else* submitting sportydolphin.fun is a backlink and the best thing this job can find.
Not the parent, because a reply under one of our posts is somebody talking to us. **If the Reddit
account is not spelled "sportydolphin", add it to `OWN_ACCOUNTS`**: nothing in a post can tell
the job it wrote it.

**Competitors' own posts never enter the queue.** `COMPETITORS` in the script lists the sites
doing the same job (`dubsports`, `keepscore`); a result is dropped when one of them is who we
would be replying *to*, matched on the author, on the domain of a link post, and on the author of
the thread a comment sits in. Turning up under a rival's post to recommend ours is the fastest
way to be the person a community dislikes, and worse than never having found the thread. They are
dropped before the table rather than announced for a human to skip, because a channel full of
things you must not act on is a channel you skim, and the one you skim past is the one that
mattered.

**The rule reads authorship and never the text, and that distinction is the whole design.**
*"dubsports is down, anywhere else to follow the score?"* is the single best lead this job will
ever produce. A filter that dropped any post naming a competitor would throw it away and say
nothing.

**A comment listing cannot be asked for a time range.** It returns the newest hundred, so a
subreddit busier than the page budget (3 pages, reaching for 45 minutes, three times the cadence)
is one the sweep only ever sees a slice of, and nothing about that looks like a failure. So it is
measured: when a sweep comes back short *with a cursor still left over*, it says which sub and how
far back it actually reached. A **quiet** sub is short for an innocent reason, runs out of comments
and returns no cursor, and is deliberately not warned about. A sub that is gone, private, or has
banned us answers 404 or 403 and is skipped by name; every sub refusing is a real failure and is
raised as one.

### Bluesky recaps, which are not this file's subject but live next door

`wpbl-bluesky-recaps` posts a finished game to **our own** Bluesky timeline, reusing the same
`buildRecap` engine as the Discord recap. It is worth knowing about here because the two look
like the same job and are not, for one reason: **Bluesky posts cannot be edited.**

The Discord recap leans on editing. It re-renders every recent final on every run and PATCHes
the ones whose text changed, so a late scoring correction fixes itself in the channel and nobody
sees it happen. On Bluesky a post is published or deleted, in public, with nothing between. So
that job never re-sends, and instead waits: it records when it first saw a game final and
publishes on a later run, 45 minutes on, once corrections have had time to land.

The other difference is the box score itself. Discord's is a space-padded table inside a code
fence; Bluesky has no monospace and no fences, so the same string is ragged nonsense there. The
card is drawn as SVG ([`src/wpbl/derive/blueskyRecap.ts`](../src/wpbl/derive/blueskyRecap.ts),
pure and tested) and rasterised at send time.

It shares the mention watcher's credential, because both are the sportydolphin account. **That
does not soften the watcher's rule**: it finds threads and never replies to them, and nothing in
the recap poster may ever reply, quote or mention anybody. Posting our own recaps to our own
timeline is a different act from turning up in somebody else's thread.

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

### The `/predict` game ("Call It Early")

The predictions game the mods host during a live game. A mod asks the channel **how many runs**
a team will score in the half-inning **coming up next**, everyone answers by pressing one of
four buttons (0, 1, 2, 3+), picks close on their own as the inning starts, and the league's own
play-by-play settles it. The game ends when the feed sees the final, and one winner is crowned.

Nobody has to sit at a keyboard for any of that except to open a round. The ingest already
pulls the feed every two minutes, so locking, revealing and crowning all happen on a pass it
was making anyway.

The rules live in [`src/wpbl/derive/predictions.ts`](../src/wpbl/derive/predictions.ts) and
the message rendering in [`src/wpbl/discordPredictions.ts`](../src/wpbl/discordPredictions.ts).
Neither knows anything about Discord or Postgres, so both are unit tested. The I/O sits in
[`predictStore.ts`](../src/wpbl/predictStore.ts) and the lock/grade/crown pass in
[`predictEngine.ts`](../src/wpbl/predictEngine.ts), both plain `fetch` against PostgREST so
that the Cloudflare function and the Deno edge function run the same one.

#### Running one

Every subcommand is **mod-only** (`MANAGE_MESSAGES`). Players never type anything: they press
buttons.

```
/predict open              ask about the half-inning coming up next
/predict open seconds:60   a shorter voting window than the default 120
/predict open team:boston  which game, when two are on at once
/predict lock              close picks now, without waiting for either trigger
/predict cancel            abandon the round; its picks count for nothing
/predict standings         post the board so far
/predict winner            close the game out early and crown one winner
```

The natural rhythm is: **open it during the break between innings and go back to watching**.
Two things close picks and neither needs a mod:

| Trigger | What it is for |
|---|---|
| the round's own timer (`seconds`, default 120) | the ordinary case: the break between innings is about that long |
| the target half-inning starting | the one that matters, and the one that keeps the game honest |

The second is checked on the button press itself, not only on the ingest's pass, because the
ingest can be two minutes behind and a round whose inning started ninety seconds ago still
reads "open" in the table. `/predict lock` remains as a manual override for a mod who wants
picks shut early.

`/predict winner` is likewise an override rather than the normal ending: the game crowns itself
when the feed reports the final. Use it when a watch party breaks up before the last out. Any
round still unsettled when a mod ends the game is voided rather than guessed at.

**It works in a voice channel's text chat.** That is an ordinary guild channel as far as
Discord's API is concerned, so a round can run inside the watch-party voice room with nothing
special configured. Note that text-in-voice is visible to everyone with *View Channel*, not
only the people connected to voice, so the audience is the whole channel either way.

#### Why the question is always about a half-inning nobody has played

This is the design, and it is worth understanding before anyone "improves" it by asking about
the at-bat in progress. That was the first version, and it could not be made fair.

**Nothing in the feed says when a play happened.** The play-by-play carries no timestamps at
all: `pitch_events` has `code`, `type`, `sequence` and `description`, and nothing else.
`created_at` is our own insert time, and it is rewritten every time the ingest deletes and
reinserts the game. TrackMan does carry a real per-pitch clock, but only **2 of 14 games**
have it. So every clock available to us measures when we *heard* about a play, never when it
happened, and between those two moments sit two delays we cannot see: a human scorer entering
the play, then our own two-minute ingest.

**A voting window therefore cannot be closed before the event it is about.** And the exposure
is not marginal. Of the season's 983 plate appearances, 13% end within one pitch and 27%
within two; across ~3800 pitches, any single pitch has roughly a **26% chance of ending the
at-bat**. A window covering even one pitch leaves about a quarter of rounds already decided,
in reality, while the buttons are still live, and anyone watching the game can simply wait and
then click.

**Asking about the next half-inning removes the problem instead of managing it.** For a "yes"
to be observable the inning must have started and a run must have crossed; for a "no" the side
must have been retired, which is three outs. Both are minutes away from the moment the round
opens, and once the mod locks as the inning starts, the entire graded event happens after the
buttons are dead. There is nothing left to leak.

The lock timer is a **backstop for a distracted mod**, not the thing that makes the game fair.
That distinction matters: an earlier version of this document claimed the timer closed the
hole, and it did not.

`/predict open` also **refuses to target a half-inning that is already under way**, which is
the one way the unfair round could sneak back in: between innings the feed can briefly report
a half that the plays table has already moved past.

#### Adding a second round type

One ships, `kind = 'runs'`. Anything else has to pass the same test: *could a person watching
the game know the answer before picks close?* "Will they score at all next inning" (`'score'`,
which the schema still allows) and "who gets the first hit next inning" pass. Anything about
the at-bat in progress does not.

#### Who wins

Most correct calls. A tie is broken by **average** time to answer, not total. A total would
punish whoever played the most rounds, since answering ten questions accumulates ten response
times and answering two accumulates two, so the player who sat out most of the game would win
every tie. Answering more is already rewarded by the primary sort, because a round you skipped
can never be correct.

**Nobody winning is a real result.** A game where every round was voided, or where nobody
called a single one right, is announced as such rather than crowning the least wrong player.

#### How a round settles

`wpbl-ingest` runs every two minutes, and settling is a step on its normal pass, so the reveal
is automatic. A round is graded on its **target half-inning**, not on a play id or a sequence
anchor. A half-inning names itself uniquely within a game, so grading survives a feed that was
behind when the round opened, plays arriving out of order, and the fact that `wpbl_game_plays`
is a mirror whose uuids the ingest regenerates on every pass. `anchor_sequence` is stored only
to keep the grader's query small.

It settles **as early as it honestly can**. For the runs question that means the third run
crossing, because "3+" is the top bucket and nothing after that can change the answer. Short of
that it waits for evidence the frame is over, which is a play appearing in a **later**
half-inning, or the game going final. Counting outs would settle sooner, and would mean
guessing at whether the feed's `outs` column is before or after the play it sits on.

A half-inning that is **never played** is voided, not scored as "held scoreless". The home
side does not bat in the bottom of the ninth when it is already ahead, and calling that
scoreless would punish everyone who correctly said they would score in a half-inning that
never happened. Replayed across the season, the grader agrees with reality on all 195
half-innings and voids the unplayed one in all 14 games.

The bot **also** settles rounds whenever a mod asks for the board or the winner. That is
deliberate duplication of the plumbing and not of the rules: both call the same pure
functions. It means the standings are right even if the ingest is behind or has stopped,
instead of the game quietly losing its scoring while everything looks fine.

#### Revealing the answer needs a bot token, or nearly

The reveal edits the round's own message, and there are two ways to do that:

| Credential | Lifetime | Needs |
|---|---|---|
| The round's **interaction token** | 15 minutes from opening | Nothing at all |
| **`DISCORD_BOT_TOKEN`** | Forever | The app actually in the guild (the `bot` scope, not just `applications.commands`) |

A half-inning takes roughly **ten minutes** to play out, and the ingest can be two minutes
behind, so the interaction token is genuinely marginal: it covers a round that settles early
and misses one that goes the distance. Set the bot token, or expect a good share of rounds to
grade correctly while their card in the channel still looks open.

Either way the round is **graded and scored**. The picks counted, the board is right, and
`/predict standings` shows it. Only the card is stale.

## One-time setup

### 1. Create the webhook

In Discord: **Channel Settings → Integrations → Webhooks → New Webhook**, then *Copy
Webhook URL*. It looks like `https://discord.com/api/webhooks/<id>/<token>`. Treat it as a
secret: anyone holding it can post to that channel.

### 2. Create the table

```bash
npm run migrate
```

Applies [`…_wpbl_discord_recap_posts.sql`](../scripts/migrations/20260813223000_wpbl_discord_recap_posts.sql),
[`…_wpbl_discord_highlight_posts.sql`](../scripts/migrations/20260814190000_wpbl_discord_highlight_posts.sql)
and [`…_wpbl_discord_birthday_posts.sql`](../scripts/migrations/20260818100000_add_wpbl_discord_birthday_posts.sql).
All three are RLS-on with no policies: they are bookkeeping for a job, not public data.

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

The birthday poster is the same story under its own name, its own webhook, its own
channel: Settings → Secrets and variables → Actions → `DISCORD_BIRTHDAY_WEBHOOK_URL`. Until
it is set the daily workflow prints a line and exits 0, so it does not spend the next month
mailing a failed run every morning for a channel that does not exist yet.

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
   manually with **test_post** ticked. It posts the plain line `merch bot restock test` to the
   private channel and `merch bot shop feed test` to the shop channel, and checks no stock.
   It carries **no mention**, so it proves the URL reaches the channel but not that a ping
   gets through; a channel that blocks webhook mentions still looks fine here.
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

### 6. The mention watcher, if you want one

Independent of everything above: its own channel, its own webhook, its own secrets.

1. Make the channel **private**. These are threads to go and answer, and a public feed of
   "people are asking about us" reads badly to anyone who wanders in.
2. **Channel Settings → Integrations → Webhooks → New Webhook**, copy the URL, and add it as
   the Actions secret `DISCORD_MENTIONS_WEBHOOK_URL`.
3. **Reddit:** reddit.com/prefs/apps → *create another app* → type **script**. The redirect URI
   is required by the form but never used; `http://localhost` is fine. It gives an id under the
   app name and a secret. Add them as `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`. Free, and
   the app-only token allows 100 requests a **minute** against the 9 to 17 this job makes per
   run, a quarter of an hour apart. One pair of credentials covers both Reddit sources.
4. **Bluesky:** Settings → Privacy and Security → App Passwords → *Add App Password*. Add the
   handle as `BLUESKY_IDENTIFIER` and the generated password as `BLUESKY_APP_PASSWORD`.
   **Never the account password**: an app password can be revoked on its own and cannot change
   the account.
5. Optionally set `DISCORD_MENTIONS_MENTION` to a user (`<@123456789012345678>`) or role, so a
   real question reaches a phone. It fires only for `question` and `link`, never for a plain
   mention, because a channel that buzzes for those is muted before the next real question.
6. Prove the webhook resolves in CI: run **WPBL Mention Watch** manually with **test_post**
   ticked. Then run it once with **dry_run** ticked to see what the search actually returns
   before anything is written or announced.

Until `DISCORD_MENTIONS_WEBHOOK_URL` is set the scheduled job prints a line saying it has
nowhere to report and exits 0, same as the shop watcher and for the same reason.

```bash
npm run mentions-watch -- --status     # what is queued, which sources are configured
npm run mentions-watch -- --dry-run    # search now and render the digest; writes nothing
npm run mentions-watch -- --all        # ignore the per-run budget and announce everything
```

`--dry-run` deliberately needs **no** Supabase credentials, so the search terms can be tried
from a laptop, but it does need the source credentials in `.env` to have anything to search; the others need `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, since
`wpbl_mention_hits` is RLS'd with no policies.

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

```bash
npm run discord-birthdays -- --dry-run                # render, send nothing (anon key is fine)
npm run discord-birthdays                             # post today's birthdays, if there are any
npm run discord-birthdays -- --dry-run --date=2026-08-08   # rehearse another day
```

`--date` is rejected on a real run on purpose. Posting a day the calendar does not agree with
is how a greeting lands three days late.

In CI the highlights modes are the `highlights_mode` input on the **WPBL YouTube Sync**
workflow (`dry-run` / `post` / `seed` / `skip`); a scheduled run always takes the normal
post path.

### The giveaway draw

`npm run giveaway` ([`scripts/draw-discord-giveaway.mjs`](../scripts/draw-discord-giveaway.mjs))
is the one Discord tool that is neither scheduled nor triggered by a game. It **only reads**
Discord: nothing is posted and no reaction is touched, and the winner is printed for you to
announce yourself.

```bash
npm run giveaway -- <message-link>                                  # list the reactions on it
npm run giveaway -- <message-link> --emoji wpbl_pride:123 --freeze  # snapshot the entry list
npm run giveaway -- --draw                                          # draw from the frozen file
```

Freeze and draw are separate steps on purpose. The freeze is the entry list: reactions added
afterwards do not count and reactions removed afterwards do not take anyone out. A re-draw
excludes everyone already drawn, so an unresponsive winner is just the same command again, and
every draw is appended to the file's history.

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

### 2b. Switch on the `/predict` game

Off until these are done.

1. **Create the tables.**

   ```bash
   npm run migrate
   ```

   Applies [`…_add_wpbl_predict_game.sql`](../scripts/migrations/20260817225409_add_wpbl_predict_game.sql):
   `wpbl_predict_rounds`, `wpbl_predict_picks`, `wpbl_predict_winners`. RLS-on with no
   policies, like the other bookkeeping tables. Then
   [`…_add_wpbl_predict_runs_kind.sql`](../scripts/migrations/20260820193000_add_wpbl_predict_runs_kind.sql),
   which widens two check constraints the first file wrote too narrowly: `kind` to allow the
   `'runs'` round that shipped, and `status` to allow `'locked'`, the state a round sits in
   between picks closing and its half-inning finishing.

2. **Give the Pages function a service-role key.** Cloudflare Pages → your project →
   Settings → Environment variables → `SUPABASE_SERVICE_ROLE_KEY`, as an **encrypted**
   variable. Redeploy for it to take effect.

   This is the one real secret in the Pages environment, unlike the anon key beside it. It is
   unavoidable: recording a pick is a write, the predictions tables are service-role only, and
   the anon key ships inside the client bundle, so a pick recorded under it could be forged
   for any Discord user by anyone who opened dev tools.

   Note this makes the Discord bot a **third service-role writer**, which the "two write
   paths" rule in [CLAUDE.md](../CLAUDE.md) did not previously allow for. It is a deliberate
   widening, recorded there and here rather than left as an undeclared exception.

   Without the key the command answers with a plain "not configured" message rather than
   appearing to work: the predictions tables read as *empty* under the anon key rather than
   erroring, so the alternative would be rounds that open and picks that silently vanish.

3. **Re-register the commands**, which is what puts `/predict` in the picker:

   ```bash
   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... npm run discord-commands
   ```

   The script `PUT`s the whole set, so this replaces rather than duplicates, and `/player` is
   re-registered unchanged in the same call.

4. **Put the app in the guild, and give the ingest a bot token.** Strongly recommended rather
   than strictly required: without it, a round that takes a full half-inning to settle grades
   correctly but never updates its card in the channel. See the table in the section above.

   - Developer Portal → **OAuth2 → URL Generator**, tick **`bot`** as well as
     `applications.commands`, tick **Send Messages**, and open the generated URL to add it to
     the server. `/player` and the buttons work without this; editing an old message does not.
   - ```bash
     supabase secrets set DISCORD_BOT_TOKEN='...'
     ```
     No redeploy needed; the next invocation picks it up.
   - Optionally set `DISCORD_BOT_TOKEN` in the Cloudflare Pages environment too, which
     covers the bot's own backstop settle when a mod runs `/predict standings` late.

   The bot token is a **real credential**, unlike the webhook URLs and unlike the public key.

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
  [CLAUDE.md](../CLAUDE.md) for the `.ts`-extension rule that keeps that module loadable
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
- **A prediction round's card can go stale without `DISCORD_BOT_TOKEN`.** The reveal falls
  back to the round's interaction token, which Discord expires fifteen minutes after the round
  opened, and a half-inning routinely takes longer than that to play out and reach us. The
  round is **still graded and still scores**: the picks count, the board is right, and
  `/predict standings` shows it. Only the message in the channel keeps looking open. Set the
  bot token and re-invite with the `bot` scope to fix it properly.
- **Neither closer is the fairness mechanism.** What makes the game fair is that the question
  is about a half-inning that has not started; the timer and the inning-start check only stop a
  late click from being worth anything. Do not "improve" this by
  asking about the current at-bat, however tempting the drama is: the feed has no timestamps,
  so that round cannot be closed before the event it asks about. The numbers are in the
  section above and the argument is in the engine's header.
- **One open round per channel.** Two open rounds would be indistinguishable once both were
  showing buttons. `/predict cancel` clears a stuck one.
- **A half-inning already under way is refused.** Between innings the feed can briefly report
  a half that the plays table has already moved past, which is the one route by which an
  unfair round could sneak back in.
- **Two games live at once needs the `team` option.** With one game on the bot picks it, and
  it counts anything scheduled for today as well as anything live, so a round can be opened on
  the top of the 1st before first pitch. With two it refuses and lists them, because a round
  pointed at the wrong game is graded against somebody else's half-inning and nothing in the
  message would reveal that. `team:` matches a slug, an abbreviation or any part of a name.
- **A cancelled round is voided, not deleted.** Its picks stay and simply never grade, so the
  question remains in the channel's history where a mod who mis-clicked can still see it.
- **The winner is crowned by whichever gets there first, and only once.** The ingest crowns a
  game on the same not-final to final transition that posts the box score; a mod running
  `/predict winner` crowns it early. Both claim `wpbl_predict_winners` with an INSERT against
  its primary key, so the conflict IS the lock and the game cannot be announced twice.
  **Announcing needs `DISCORD_BOT_TOKEN`**, because posting a NEW message into the round's
  channel is something a webhook cannot do (a webhook is bound to one channel and a round can
  run in any of them). Without it the winner row is still written, with `announced_at` null,
  and `/predict winner` posts it as its own reply.
- **What counts as a highlight** is `classify()` in
  [`scripts/sync-wpbl-youtube.mjs`](../scripts/sync-wpbl-youtube.mjs): a title containing
  "highlight(s)" *and* a matchup separator (`@` or `vs.`). Single-play clips ("Kelsie
  Whitmore 1st WPBL homer") and full-game uploads ("WPBL: Boston Hunters @ New York
  Heights") are `other` and are not posted.
