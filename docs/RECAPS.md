# Recap links: This is Women's Baseball

Linking an independent outlet's game recaps from each game page, so a reader who has just
looked at a box score can go and read somebody's account of the same game.

**Source:** [*This is Women's Baseball*](https://thisiswomensbaseball.com), an independently
run site covering the WPBL. They write one recap per game. They are not affiliated with us or
with the league, and they say so themselves on their About page.

**Permission:** granted explicitly, to link to their game recaps (ARCHITECTURE §8). Their
footer reads "Copyright © 2026 This is Women's Baseball - All Rights Reserved", so that
permission is the whole basis for this and the credit is on every card.

---

## 1. The rule that shapes everything

> **We keep a headline, a link, their cover image's URL and a date. We link out for the
> writing. Their prose is never stored and never shown.**

`wpbl_recaps` has **no body column and no dek column**, so this is enforced by the schema
rather than by everyone remembering it. `parseRecapFeed` does not even carry their lede out of
the parser, and there is a test pinning that.

This is the same rule [READING.md](READING.md) sets for the Substack mirror, with one
difference worth stating. That feed's `description` is a dek on a 1,200-word essay; **this
feed's `description` is the lede of a 180-word recap**, which is close to half of it. So where
the Reading cards show a dek, these show none. A headline, their picture and their name is what
a link looks like.

### The image is embedded, never copied

`cover_url` is their own CDN URL and goes straight into an `<img src>`, so the bytes are served
by them on every view. We do not mirror the file.

`recapThumb()` asks their CDN for the width actually drawn, which is worth doing: the Sep 11
title card is **248 KB at source and 18 KB at `rs=w:320`**. Their CDN rejects `fmt=webp` in
every position tried, so the transform asks only for a width. It refuses to touch a URL that is
not on their image host, because appending transform parameters to an arbitrary string out of a
database is how you end up "resizing" somebody's tracking pixel.

### The credit has to say whose writing this is

The Reading rail learned this the hard way on Aug 26, 2026: readers came away believing the
person who writes the mirrored Substack ran this site. A headline and a thumbnail inside our
chrome reads as our reporting unless something says otherwise, so the card names the
publication in full, under the headline, on every instance.

**There is no personal byline to use.** Their `author` meta, their `og:site_name` and their
About page all say *This is Women's Baseball*. A contact address on the About page names a
person; that is not a byline and it is not used as one.

---

## 2. The shape of it

| Piece | File |
|---|---|
| Feed parsing, the matcher, the thumbnail rule | [`src/wpbl/derive/recaps.ts`](../src/wpbl/derive/recaps.ts) |
| The sync | [`scripts/sync-wpbl-recaps.ts`](../scripts/sync-wpbl-recaps.ts) (`npm run recaps-sync`) |
| The job | [`.github/workflows/wpbl-recaps-sync.yml`](../.github/workflows/wpbl-recaps-sync.yml) |
| The table | [`scripts/migrations/20260912061459_add_wpbl_recaps_table.sql`](../scripts/migrations/20260912061459_add_wpbl_recaps_table.sql) |
| The card | `GameRecapLinkCard` in [`src/wpbl/Reading.tsx`](../src/wpbl/Reading.tsx) |
| Where it renders | The game header in [`src/wpbl/GameDetail.tsx`](../src/wpbl/GameDetail.tsx), under the Substack story card when a game has both |
| The read | `fetchWpblRecaps` in [`src/wpbl/api.ts`](../src/wpbl/api.ts) |
| Tests | [`src/wpbl/__tests__/recaps.test.ts`](../src/wpbl/__tests__/recaps.test.ts) |

**Their feed is `/f.rss`** (Atom at `/f.atom`, same content). It carries the headline, the link,
the publication time, and the title image as the first `<img>` in `content:encoded`, which is
the same URL as the page's own `og:image`: two places they state it independently, agreeing.

**The feed stops at 50 items and ignores `?page=`, `?limit=` and `?offset=` alike.** It is a
window, not an archive. Today it reaches back to March and covers every recap of the season; it
will not, once they have published fifty more. `sitemap.blog.xml` lists all of their posts and
is the backstop for that day. Nothing reads it yet.

**The sync upserts and never deletes**, which is the other half of the same problem: a job that
reconciled by removing what it could no longer see would take the back catalogue with it the
day that window closed over August, silently.

---

## 3. Which game a headline is about

This is the only hard part. Their posts carry no game id and no date beyond a publication
timestamp, and the headline is written for a reader rather than for us.

**Measured Sep 12, 2026: 33 of 33 games placed, nothing ambiguous, every recap-era post claimed
exactly once.**

### Two phases, and the order is the design

Every tight same-night match is made **first, across all games**, before anything is allowed to
reach into the following night.

A draft that instead widened the window to a day either side for every game at once scored
**worse than the tight rule alone, 31 of 33 down to 23**. A recap posted the next night competes
with the game that night actually had, and both end up ambiguous. Phase two only ever sees a
game nothing claimed and a post nothing claimed.

### The rules, in descending confidence

| Rule | Meaning | Games |
|---|---|---:|
| `both clubs` | The headline names both of these clubs and no others | 18 |
| `clubs+score` | Two such headlines, and one carries this game's score | 0 |
| `club played once` | One club named, and that club played exactly one game that day | 13 |
| `one club+score` | One club named and the headline's score is this game's | 0 |
| `no club, sole game` | A headline naming a player and no club, on a single-game night | 1 |
| `next night` | Phase two: both clubs **and** the exact score, for a recap filed late | 1 |

Two of these were found by a rule failing:

- **`club played once` replaced "only one game was played that day."** They are the same thing
  on a quiet night, and the weaker version gives up on a two-game night where each club still
  played once. That cost one game: Aug 8 had two, and a headline naming one club that played one
  game is unambiguous whatever else it says.
- **`no club, sole game` exists for Aug 5**, where the headline is about a player's grand slam
  and names nobody's club.

`matched_by` is stored on every row. These are judgement calls about someone else's headline,
and the day one is wrong the first question is which rule made it.

### The bias is towards saying nothing

The same bias [`derive/articles.ts`](../src/wpbl/derive/articles.ts) states for the other
source. **An unmatched game shows no card**, which is a small loss. A recap of somebody else's
game shown under this one is a mistake a reader notices and does not forgive.

The sync reports unmatched games by date and matchup and never guesses at them.

---

## 4. What has not been built

- **Nothing reads `sitemap.blog.xml`.** It is the answer for the day the 50-item window closes
  over the back catalogue, and it is written down rather than built because that day has not
  come and the shape of the fix may want to change when it does.
- **Their player profiles and "Inside the Lines" posts are ignored.** 17 of the 50 posts in the
  feed are not game recaps. The matcher simply never places them, which is the correct outcome
  and needs no rule of its own.
- **No Home rail.** The recaps are per-game and that is where the link belongs. A rail on Home
  would be a second surface for someone else's writing, and the Reading rail already fills that
  slot.
