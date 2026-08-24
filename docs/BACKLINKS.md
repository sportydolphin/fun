# Backlinks

Everything technical is done: ~125 real URLs, each with its own title and canonical, all of
them crawlable and in the sitemap. Nothing on the site is holding rankings back any more.
What is holding them back is that almost nothing on the internet links here, so Google has
no reason to trust the domain or to associate the word "sportydolphin" with it.

This file is the list of places worth fixing that, roughly best-first, with the wording
already written. **Every item is a person-posts-it action**: these are communities, and a
post that reads as drive-by promotion does more harm than no post at all.

One honest note on expectations: the regular season ends **Sep 6, 2026** and the feed stops
**Sep 22**. None of this moves rankings before then. It pays off as an archive, and next
season.

---

## Already done in the repo

- **README** links the live site and its main sections. GitHub marks outbound README links
  `nofollow`, so this passes little ranking signal, but it is real discovery: people find
  the repo and the repo now has a front door.
- **Sitemap** is generated daily and advertised in `robots.txt`.

## Two minutes each, do these first

- **GitHub repo "Website" field.** Settings, or the About gear on the repo home page. Set it
  to `https://sportydolphin.fun`. This is the one GitHub link that is not nofollow.
- **GitHub profile.** Same URL in the profile's website field.
- **Cloudflare: add the `www` CNAME** (see the main checklist), so `www.sportydolphin.fun`
  stops being a dead end for anyone who types it.

## The ones that actually matter

Ranked by how much a link from there is worth for *this* site, which is a function of how
topical it is, not how big the site is.

### 1. `towards a more perfect game` (Substack)

The single best target. It is the WPBL writing that already exists, it is already surfaced
on the site's Home tab, and a link from it is exactly on-topic. Mary Mustard writes it.

The site already sends her traffic by mirroring her headlines. That is a genuine reason to
be in touch, and it is not a favour being asked for nothing.

> Hi Mary,
>
> I built sportydolphin.fun, a free WPBL stats site: live scores, standings, stat leaders
> and a page for all 118 players. It also links out to your posts from the WPBL home page,
> since yours is the writing people actually want after they have looked at the numbers.
>
> No ask attached, but if a box score or a player's season line is ever useful to link to
> mid-post, every player has a permanent URL now, e.g. sportydolphin.fun/wpbl/players/ayami-sato.
> Happy to add anything that would make it more useful to you.

### 2. Reddit

`r/baseball` is large and has a strict self-promotion culture; read the rules first and
expect a post to be removed if it reads as an ad. The WPBL-specific and women's-sports
subreddits are smaller and much friendlier to this.

Post it as a thing you made and want feedback on, not as a product:

> **I built a free WPBL stats site: standings, leaders, and a page for every player**
>
> The league's own feed has the data but not much of a way to browse it, so I put a site on
> top of it: live scores, standings, sortable batting and pitching leaders, TrackMan pitch
> data where the feed carries it, and a page per player with their season line and game log.
>
> Free, no account needed, no ads. sportydolphin.fun/wpbl
>
> Happy to add anything that is missing. The postseason starts Sep 9 and I would like it to
> be genuinely useful by then.

### 3. The WPBL fan Discord

You are already in it and the bot already posts there, which makes this the least
promotional of all of them. A message in whatever channel fits, pinned if a mod is willing.
Discord links are nofollow and invisible to Google, so the value here is people, not
ranking. That is still worth having: people are what produce the links that do count.

### 4. Hacker News, `Show HN`

Worth one shot. HN cares about the build far more than the subject, so lead with the
interesting engineering rather than the baseball.

> **Show HN: A stats site for the new women's pro baseball league**
>
> The WPBL launched this year and publishes a public stats feed, so I mirrored it into
> Postgres and built a site on it: live scores, standings, leaders, TrackMan pitch data, and
> auto-generated game recaps.
>
> A few things that were more interesting than expected: the feed's `runs_scored` counts
> runners who crossed the plate but not the batter, so a solo home run reads 0; postseason
> games have to be excluded from every season aggregate and the filter has to fail open, or
> a feed rename silently renders every team at 0-0; and the whole thing is a client-rendered
> SPA, which turns out to be fine for Googlebot but only if every internal link is a real
> anchor.
>
> sportydolphin.fun/wpbl

Post on a weekday morning US time. If it sinks, leave it: reposting is against the rules and
against your interests.

### 5. The two Facebook groups, which are already working

Two large groups have had a post each and both got real traction, and the recurring question
in them ("where can I see live updates?") is the single best moment this site has to be
mentioned. Three things to know:

**No automation is possible here, and that is settled rather than unexplored.** The Groups API
was withdrawn in 2024, group posts appear in no search API, and scraping them violates the
terms whichever account does it, including the account that is a member of the group. The
mention watcher (`wpbl-mention-watch`, see [`DISCORD.md`](DISCORD.md)) covers Reddit and
Bluesky for exactly this reason and deliberately leaves Facebook alone.

**So the durable fix is structural, not faster reflexes.** Ask a mod to pin a resources comment
or add the link to the group's **Featured** section or About. That converts the recurring
question into a standing answer, works while you are asleep, and is a far better use of the
goodwill already banked than answering the same question forever. This is the highest-leverage
item in this whole file, and it costs one message:

> Hi, I posted the WPBL stats site here a little while back and it went down well. I keep
> seeing people ask where to follow games live, so rather than reply to each one: would you be
> open to putting sportydolphin.fun/wpbl in the group's Featured section or a pinned resources
> comment? Free, no ads, no account needed. Happy to leave it entirely up to you.

**Turn on All posts notifications** for both groups in the meantime. Noisy, but the question is
answerable in twenty seconds when you catch it. Answer the question first and link second: a
bare link reads as an ad and gets removed, which costs the pin as well.

### 6. Wikipedia, carefully

The WPBL article has an external links section. Wikipedia links are nofollow and editors
remove self-added links on sight, so **do not add your own**. It is listed here only so the
temptation is met with the reason not to: a removed link plus an edit history with your name
on it is worse than no link.

---

## What to expect, and how to tell it worked

Brand queries move first. Search `sportydolphin` weekly; once a couple of real links exist
the site should start answering that within a week or two.

Everything else is slow. `WPBL standings` and `WPBL stats` are winnable because the term is
new and the competition is thin, but not on a domain with no links and no history. Watch
**Search Console → Performance → Queries** rather than watching the rankings: impressions
appearing for terms you never targeted is the first sign it is working, and it shows up long
before a click does.
