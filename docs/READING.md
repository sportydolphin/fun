# Reading: the WPBL writing feed

Mirroring an independent writer's WPBL coverage into the section, so a reader who has just
looked at a box score can go read what someone thought about that game.

**Source:** [*towards a more perfect game: women's baseball & the wpbl*](https://towardsamoreperfectgame.substack.com)
by **mary mustard** ([@dijondarling](https://substack.com/@dijondarling)), a writer and
amateur ballplayer from Albany. She is not affiliated with us or with the league.

> **Not shipped yet, and it must not ship before she is asked.** The code is built and the
> table is populated, but the feature is one person's writing on someone else's site. See
> [Before this goes live](#before-this-goes-live).

---

## 1. The rule that shapes everything

The RSS feed hands over the **complete article text** in `content:encoded`. We do not store
it and we do not show it.

> **We keep a headline, a dek, a cover image, a date and a word count. We link out for the
> text. The body is fetched only to find names in it, and is never persisted.**

`wpbl_articles` has **no body column**, so this is enforced by the schema rather than by
everyone remembering it. Every card on every surface is an `<a target="_blank">` to her
post: no lightbox, no in-app reader, no iframe. That is the one deliberate difference from
the highlights rail beside it, where an embedded player genuinely beats bouncing to
YouTube. There is no equivalent gain for prose, and rendering her article inside our chrome
would make us a mirror of her writing instead of a signpost to it.

## 2. Why there is no "News" tab

The obvious shape for this was a sixth nav item. It would have been wrong three times over:

1. The nav is at five on purpose. [`BottomNav.tsx`](../src/wpbl/BottomNav.tsx) says it
   plainly: six destinations at the top of an 812px screen is the least reachable place on
   the device, and the sixth used to sit off-screen entirely.
2. We already answered this question once. Tracking was its own tab and is now a stat group
   inside Stats, with `normalizeView()` in [`WpblApp.tsx`](../src/wpbl/WpblApp.tsx) still
   catching the old links. Content earns a place, not a tab.
3. A tab implies volume. She files about twice a week. A tab showing the same six headlines
   for four days reads as a dead section; a rail that quietly refreshes reads as a live one.

"News" would also have been the wrong word. It promises wire copy (transactions, injuries,
signings) and this is one person with a strong voice writing essays titled *"Let's Watch
These Two Guys Race to Eat a Hot Dog, Slowly."* The surface is called **Reading**.

## 3. Where it appears

| Surface | Component | Shows when |
|---|---|---|
| Home rail, under Highlights | `ReadingRail` | any posts exist |
| Full archive (modal from "See all") | `ReadingArchive` | always offered |
| Game center, under the highlight reel | `GameStoryCard` | a final has a matched post |
| Player page, under the stat blocks | `WrittenAbout` | a post names that player |

All four live in [`src/wpbl/Reading.tsx`](../src/wpbl/Reading.tsx) and every one self-hides
when it has nothing, so an empty feed leaves no empty shells.

`AuthorByline` sits under the rail and at the head of the archive: her photo, her name, her
own one-line description of herself, and a link to the publication. It is the only link here
that goes somewhere other than a single article. There is deliberately no "opens in her
site" note anywhere: every card already carries a ↗, and saying it in words as well read as
apologising for the feature rather than crediting her.

The game surface is the one that justifies the feature. *"Queens Topple Heights, 10-8, In
Just Another Ballgame"* now sits in the same modal as that game's box score, play-by-play
and highlight reel. Nowhere else puts those together, because nowhere else holds both
datasets.

## 4. What gets mirrored, and what does not

**World Cup posts are skipped entirely.** Roughly half her output covers the Women's
Baseball World Cup, which this section has no teams, players or games for, so those cards
would be cards whose every link is dead.

The filter is her own tags, because a human's filing beats anything we would infer:

- a `Women's Baseball World Cup` tag **excludes**, even alongside a WPBL tag. She has one
  post tagged both, and it is a World Cup post that mentions the league, so reading the
  WPBL tag inclusively let exactly the wrong thing through;
- otherwise a `WPBL` or `Women's Pro Baseball League` tag includes;
- untagged posts are excluded. Every post in her archive carries a tag today, so an
  untagged one is new behaviour worth looking at rather than guessing about.

Today that is 11 of 23 posts.

## 5. The matching rules, and why each one is that strict

All of this is [`src/wpbl/derive/articles.ts`](../src/wpbl/derive/articles.ts), unit tested
in [`articles.test.ts`](../src/wpbl/__tests__/articles.test.ts). The bias throughout is
towards saying nothing: a post that fails to link to a player is a small loss, but a wrong
link on a player's own page is a bug the reader can only discover by reading the piece and
finding themselves absent from it.

**Players: full names only.** Surname matching was measured at two to six extra hits per
post, and every one is a coin flip: an article about the Hunters saying "Moore" could be any
of several. Full name, or nothing. Live average: **5.2 players per post**, 11 to 17 on the
game recaps.

**Clubs: named in the headline, named at least four times in the body, or the club of a
player named in the headline.** Three traps here:

- *Never match a bare city.* Her World Cup coverage names Boston and San Francisco as places
  where tournament baseball is played. Bare-city matching filed four tournament essays under
  WPBL clubs. Nicknames are unambiguous; cities are not.
- *Mentioning is not aboutness.* The threshold is measured, not guessed: across the live
  feed a club the post is actually about is named 8 to 15 times, and a passing nod on the
  way to another subject is named 1 to 3. Four sits in the empty space between them. Without
  it one essay carried all four club badges, which tells a reader nothing and crowds out the
  date and read time beside them.
- *A profile is about its subject's club, however rarely it says so.* "I Cannot Overstate to
  You How Good Denae Benites is Playing WPBL Baseball Right Now" is 722 words of Heights
  baseball that names the Heights exactly once, so the two rules above both passed it over
  and its card carried no club badge. The club of a player named in the **headline** now
  counts. Headline only: extending it to every player named anywhere in the body would undo
  the mention threshold entirely, since her game write-ups name a dozen players across both
  clubs and a few from elsewhere.

**Games: teams, date and score must all agree.** Exactly two clubs, a publish time within 48
hours of a game between them, and a score in the headline matching that game's final. Two
candidates (a doubleheader, or the same score twice in the window) resolves to none. A recap
headlined without its score simply doesn't link, which is the intended failure.

## 6. The pieces

| Piece | Where |
|---|---|
| Matching rules (pure, tested) | [`src/wpbl/derive/articles.ts`](../src/wpbl/derive/articles.ts) |
| Sync job | [`scripts/sync-wpbl-substack.ts`](../scripts/sync-wpbl-substack.ts), `npm run substack-sync` |
| Schedule | [`.github/workflows/wpbl-substack-sync.yml`](../.github/workflows/wpbl-substack-sync.yml), hourly, 12:00–23:00 UTC |
| Table | `wpbl_articles`, migration `20260818012000_add_wpbl_articles.sql` |
| Read | `fetchWpblArticles()` in [`src/wpbl/api.ts`](../src/wpbl/api.ts) |
| UI | [`src/wpbl/Reading.tsx`](../src/wpbl/Reading.tsx) |

Two sources, because they carry different things. The **archive API**
(`/api/v1/archive`) is complete rather than a recent window, and carries the tags, word
count and a stable numeric id, so it drives the list and the upsert key. Note it 400s on a
`limit` above 50, so it is paged. The **RSS feed** carries the body, so it drives entity
matching for the ~20 posts it covers; an older post keeps whatever matches it already had.

**Read time** is `ceil(word_count / 200 + video_count * 30 / 60)`, floored at 1.

The word count is Substack's own `wordcount` field, not something we compute; we could not
compute it anyway, since we never keep the body. 200wpm is deliberately slower than the ~240
the research gives for average non-fiction, because her posts are dense and the estimates
read optimistically at the faster rate.

The clips matter more than they look. She embeds YouTube clips of the plays she describes,
and the WPBL posts carry **up to five**; counting only words made a short video-heavy post
read as much quicker than it is. 30 seconds each is pitched at how she embeds them: most
carry a `?start=` deep link into a longer reel, so the reader is being pointed at one play
rather than a whole video. `countVideos()` matches the YouTube host rather than `<iframe>`
alone, because Substack injects its own iframes for subscribe widgets and would otherwise
inflate the estimate on posts with no video at all.

Images, by contrast, are folded into the rate rather than counted. Measured across her feed,
posts average **1.4 images and 4.8 caption words**, so they cost seconds. A photo essay would
read low, and that is the point at which to store a real image count.

Rounding is up, not to nearest: finishing early is a pleasant surprise, being stranded
mid-piece by a number you trusted is not.

Every post is re-upserted every run. She edits titles and covers after publishing, and
re-running the matcher lets an older post pick up players since added to the roster.

**A post outside the RSS window keeps the matches it already had.** This is load-bearing, not
a nicety. Only the ~20 posts in the feed have a body, so once a post ages out there is
nothing left to find names or embeds in, and recomputing from the headline alone would
quietly wipe what we knew: "I Cannot Overstate... Denae Benites" would fall from three
players to one a few weeks after publication, and lose its clip count with them. The sync
reads the stored row first and carries `team_ids`, `player_ids`, `game_id` and `video_count`
forward whenever the body is missing. Matches are revised only when there is an article to
revise them from.

```bash
npm run substack-sync -- --dry-run
```

A dry run needs no service-role key and writes nothing. A real run refuses to start without
`SUPABASE_SERVICE_ROLE_KEY`, because RLS would let it do all the fetching and matching and
then reject the upsert at the very last step.

## 7. Before this goes live

**Ask her.** A short note saying what we want to do, that every card links straight to her
post, and that she is credited by name on every surface. A writer with 135 subscribers on a
niche beat will very likely be glad of it, and the conversation opens the door to the better
version of this: a byline that is a person we know, not a URL we scrape. If the answer is
no, the table drops and the rail disappears with it.

**The Discord feed is deliberately not built.** It was in the plan as the last phase and it
stays unbuilt until she has said yes to the site surfaces *and* to the server specifically.
A webhook firing someone's work into a chatroom they are not in is a different ask from a
card on a site that links to them. When it is built, note the warning in
[`DISCORD.md`](DISCORD.md): Substack draws its own rich embed, so posting a bare link
alongside it produces the double-card the recap poster had to have surgery to remove.

## 8. The sync cannot run in CI

**Status: the scheduled job is disabled.** Substack serves Cloudflare's JavaScript
interstitial (`Just a moment...`) to datacenter address space, and it covers the whole host:
`/api/v1/archive` and `/feed` both answer **403** from a GitHub runner, while the identical
requests return **200** from a laptop. Every scheduled run failed, 7 for 7.

What was ruled out, so nobody repeats the experiments:

| Tried | Result |
|---|---|
| Self-identifying User-Agent | 403 |
| Real browser UA plus `accept-language` and `cache-control` | 403, identical challenge body |
| RSS feed instead of the archive API | 403, same challenge |

The challenge wants a client that executes JavaScript. Getting past it deliberately means
driving a headless browser with stealth patches, or paying a challenge-solving service. That
is bot-detection evasion rather than engineering, and it is not a thing to build against one
person's personal Substack. It is also not aimed at us: it is a generic Cloudflare rule that
treats all datacenter traffic alike.

The constraint is the IP, not the code. `npm run substack-sync` works perfectly from a normal
machine, which is how the current 11 articles got there.

**Options, in the order worth considering them:**

1. **Run it from a residential IP.** A `launchd` job on the Mac, twice a day, is the whole
   fix. She publishes roughly twice a week, so a twice-daily pass loses nothing that matters.
   It is also the only option that keeps the archive API, and with it the tags that keep
   World Cup posts out of the rail.
2. **A self-hosted runner at home.** Same effect, more machinery. Worth it only if other jobs
   end up needing one too.
3. **Subscribe by email and parse the newsletter.** Substack sends every post to subscribers,
   so a dedicated address receives the content with no web request at all. Legitimate (we
   would be a subscriber) and immune to this entirely, but a real build, and the email
   carries no tags either.
4. **Ask mary.** Worth raising alongside the permission conversation, though she almost
   certainly cannot change a Cloudflare rule Substack applies to every publication.

Not recommended: third-party RSS proxies. They route around the block on somebody else's
egress, most are themselves challenged, and they add a dependency that fails quietly.

Until one of those lands, run the sync by hand after she posts:

```bash
npm run substack-sync
```

Manual `workflow_dispatch` stays enabled deliberately, as the cheapest way to re-test the
block: if Substack ever relaxes the rule, one dry-run says so.

## 9. Open questions

- **One writer, or the first of several?** `wpbl_articles` has no author column, because
  today every row has the same author and a column of one repeated string is a lie about how
  general the system is. A second writer means a migration: an `author` column at minimum,
  probably a `publications` table. Cheap to do then, and cheaper than guessing now.
- **A portrait, if she is willing.** The byline card carries her Substack profile photo, and
  that photo is a wide shot of her on a ballfield rather than a head-and-shoulders portrait.
  There is no crop that rescues it: the source is already square, and Substack's CDN has
  Cloudinary's face gravity turned off (`g_face` returns 404), so the only option is a
  centred fill of the whole frame. It reads as a small figure rather than a face. Worth
  asking for a portrait in the same note that asks permission at all.
- **Paywalled posts.** All 23 are `audience: everyone` today. When one isn't, the card
  should say so rather than sending a reader into a wall unannounced.
