# Design references: 14 baseball front pages (Nov 4, 2026)

Fourteen desktop front pages, captured the week after the 2026 World Series, read against the
`redesign` branch's WPBL Home. The screenshots sit beside this file in `2026-11-04/` and are
gitignored: the repo is public and they are other people's pages. Companion to
[ROADMAP-UI.md](../../ROADMAP-UI.md); where a recommendation here is taken, it moves there.

| File | Site | Tier |
|---|---|---|
| `02-athletic` | The Athletic | A |
| `08-mlb` | MLB.com | A |
| `12-cbs` | CBS Sports | A |
| `05-savant` | Baseball Savant | A (for data) |
| `04-baseball-reference` | Baseball Reference | B (for data) |
| `14-nbc` | NBC Sports | B |
| `01-si` | Sports Illustrated | B |
| `09-milb` | MiLB.com | B |
| `06-fangraphs` | FanGraphs | C |
| `10-usa-baseball` | USA Baseball | C |
| `07-espn` | ESPN | C |
| `11-yahoo` | Yahoo Sports | D |
| `03-bleacher-report` | Bleacher Report | D |
| `13-fox` | Fox Sports | D |

## The ranking, and why

**A. The ones to learn from.**

- **The Athletic.** The best page here. Three columns with one job each: the lead (photo, serif
  headline, one-sentence deck, byline), four secondary stories with small square thumbnails, and a
  text-only headline list. Brand color appears once (the trial button). Serif headlines, sans
  bylines, small letterspaced caps for the one section label. No ads, no promos, nothing competing
  with the lead. Weak spot: an empty score carousel in the offseason.
- **MLB.com.** The clearest scoreboard handling in the offseason: the strip shows the five World
  Series finals, each with its series state ("MIL wins 4-1"), not "No games". Then the lead and a
  "Latest News" list where every row carries a club mark, so the list scans by club.
  On a phone the order is nav, strip, lead, then the list.
- **CBS Sports.** The best grid. A text lead with the photo beside it, three equal thumbnails
  under it, a headline list with bylines on the right. A row of topical links under the nav
  ("Top 50 free agents", "Lockout 101") makes the season's stories one tap away. Every thumbnail is
  the same shape and corner.
- **Baseball Savant** (for a data site, the closest to us). Its front page puts data in the first
  screen: "2026 Top Performers" is a five-row board with the stat named, a face and a club mark per
  row, and two links: "Definition" and "View Leaderboard". The offseason strip opens on the
  champion ("Congrats Brewers!") and the series games. Articles carry the faces and club marks of
  the players they are about.

**B. Right in parts.**

- **Baseball Reference.** Ugly and trusted. Proves that a front page can be all data: standings,
  "Trending Player Pages", "Recent Debuts", "Born On This Day". Those daily lists are why people come
  back when nothing is happening. The layout itself (three boxed columns of mixed density, a purple
  promo slab) is not the model.
- **NBC Sports.** A strong lead (video, large serif-style headline) and a clean bulleted headline
  list with sources. Loses points for a first column that is mostly empty and a "Live and upcoming"
  shelf holding one press conference.
- **Sports Illustrated.** A clear lead plus headline list, and condensed display type that reads
  as sport. Weak spot: the strip says "NO MLB GAMES", a strip spent saying nothing.
- **MiLB.com.** MLB.com's template, so the same strengths, with a promo tile on top of the list.

**C. Useful only as warnings, with one or two good ideas.**

- **FanGraphs.** The lead is fine; everything else is green slabs. Brand color as a fill on every
  section header makes the page loud and flat. The team grid (AL clubs as a 3-column table) is a
  good, cheap way to every club.
- **USA Baseball.** A generic news template; half the first screen is a membership banner. The
  "Upcoming Events" calendar list (date, then the event) is the one good idea.
- **ESPN.** A good headline list and a sharp lead, buried under a left rail of sign-up boxes,
  "Watch" promos and a fantasy menu. Three columns, and one of them is ads for ESPN.

**D. What not to do.**

- **Yahoo Sports.** Five lists competing (Trending, Local Teams, headlines, Quick Links, Watch),
  dark, dense, purple. Nothing outranks anything. The strip shows spring training games three months
  out, the most confusing offseason state of the fourteen.
- **Bleacher Report.** An MLB page whose score strip is NBA games, a video ad as the first screen,
  emoji in headlines. The worst first screen here.
- **Fox Sports.** A third of the page is a navy panel holding the MLB logo and a Follow button.
  Nothing above the fold says anything. The club chip row (MIL, TB, LAD, ...) is the one good
  piece.

## What every good one does

Counted across the fourteen. These are the conventions a reader brings to a baseball front page;
breaking one needs a reason.

1. **One lead, unmistakably.** 14 of 14 open on one large photo with one headline. Eye tracking
   on news pages finds the dominant headline, not the photo, is where the eye enters, so the
   headline sits right beside or right under the photo, never a screen away.
2. **A text headline list beside the lead.** 11 of 14 ("Headlines", "Latest News", "Top Headlines",
   "Trending"). Text only, one or two lines a row, a hairline between rows, a source or time in small
   gray. It is the densest, cheapest way to put ten entry points in the first screen. Readers scan
   down a list and often stop before a row ends, so the row's first words carry it.
3. **A score strip at the top.** 8 of 14, directly under the nav, horizontally scrolled on a
   phone. Its offseason state splits the field: the best show the last series (MLB.com, Savant);
   the worst say "No games" (SI, NBC) or go blank (The Athletic).
4. **Ten or more entry points above the fold.** The Athletic's first screen holds about 16 links;
   CBS about 14; MLB.com about 11. A lead alone is not a front page.
5. **A time on everything.** "6 hours ago", "18h", "11/3". Freshness is the reason to come back.
6. **Light pages.** 11 of 14 are white. The two dark ones (Yahoo, Bleacher Report) are the two
   most cluttered. Editorial type, serif headlines above all, is built for a light page.
7. **Restraint with the brand color.** The A tier uses it once or twice (The Athletic's button,
   CBS's active tab). FanGraphs, which fills every header with it, is the loudest page here.
8. **Club marks as the decoration.** MLB.com's list, Savant's article footers, Fox's chip row and
   Yahoo's trending list tag items with a small club mark. The mark says the club faster than the
   name.
9. **The same sub-nav.** Scores, Schedule, Standings, Stats, Teams, in about that order, on every
   league page. Readers look for it there.
10. **One shape of picture.** Each good page picks one corner and one or two aspect ratios and
    keeps them (square corners at The Athletic, CBS, SI; MLB.com's rounded cards are consistent).

## What the bad ones do

- **Promos in the content.** ESPN's sign-up boxes, FanGraphs' app tile, USA Baseball's banner,
  Bleacher Report's car ad. Every promo is a lead the reader did not ask for.
- **A strip that says nothing**, or shows the wrong league or the wrong season.
- **Lists that compete.** Yahoo's five lists, NBC's empty first column, Fox's logo panel: space
  spent without a story in it.
- **Brand fills as section headers** (FanGraphs' green bars).
- **Emoji in headlines** (Bleacher Report).

## The redesign against them

Captured from `redesign` at `134e81df` on Nov 4: desktop 1440, phone 375, dark and light.

Already right, and confirmed by the A tier:

- **The lead as a front page**: photo at 3:2 with a credit, a serif headline beside it. The
  Athletic's grammar.
- **Three faces, one job each**: condensed display caps for section heads (SI, Fox, Yahoo, NBC all
  do this), a serif for headlines (The Athletic, NBC), a sans for names and lists.
- **Square pictures**, one ratio per role, as The Athletic and CBS do.
- **Sections as a rule and a heading, not cards.** The A tier uses hairlines and white space, never
  boxes. FanGraphs and ESPN, the boxed ones, read worse.
- **Clubs as solid blocks across the top**: the same job as Fox's chip row and FanGraphs' grid,
  done better.
- **The leaders board**: one board, stat tabs, a face for the leader. Savant's "Top Performers" is
  the same idea.
- **No promos.** The Discord invite as a row, not a box, is the right call.
- **The sub-nav order** (Home, Scores, Standings, Stats, Teams) matches the convention.

The gaps:

1. **The first screen is one story.** At 1440 the first screen is the masthead and the lead, about
   six links. Every A-tier page has 11 to 16. Nothing in the first screen changes between visits
   in the offseason, which is Home step 2's problem stated as a measurement.
2. **No headline list.** The one element 11 of 14 share is missing. The site has the material for
   it: game recaps, new Reading posts, new videos, new fan photos, award results, roster moves,
   milestones, birthdays.
3. **No score strip.** The masthead clubs hold the top of the page. In the offseason that is
   defensible; in season (Home step 1) the games must be the first line, and two strips stacked
   (clubs and games) would be one too many.
4. **Few times.** Reading has dates; Watch's clips, the gallery and Spotlight do not say when.
5. **The phone lead is inset** 16px more than the masthead and the section rules (the photo
   starts at 32px, everything else at 16px). Every reference holds one left edge.
6. **Dark first, while the type is light-page type.** The serif headline and agate lines are
   newspaper conventions, and the light screenshot reads better than the dark one already. On
   light, the masthead's near-black jerseys are the heaviest thing on the page.
7. **Every heavy heading is loud.** Display caps under a 2px rule is right for two or three
   sections. The Athletic heads its list with small letterspaced caps; the loudest thing on its
   page is the lead headline. Check that the heavy tier stays at three.
8. **The lead photo loads late on a phone** (captured mid-load: the dimmed placeholder with the
   club mark). Home step 8 already names it.

## The plan

In order. Each item names the Home step in ROADMAP-UI.md it belongs to, or a new one.

### Before Home goes to main

1. **A "Latest" list beside the lead** (answers step 2). Text rows, newest first, each a small club
   mark, a short label-style line and a time in agate gray: "Recap: LA 2–0
   SF, Game 5", "New: 12 fan photos", "Reading: The Ballad of Ayami Sato", "Birthday: R. Kim (26)".
   Eight rows, a hairline between them, "All ›" in the heading. Desktop: the right column beside the
   lead (the road and the final's games move under the headline, as The Athletic puts its deck);
   phone: directly under the lead. Fed from what the site already stores (recaps, Reading, Watch,
   photos, awards, players' birthdays), so it is never empty. Copy stays labels, not narration.
2. **The score strip, decided once for every phase** (step 1). In season: the day's games under
   the nav, live first, scrolled on a phone, replacing the masthead clubs (which move to a compact
   standings line in the lead's column). Postseason: the series, with its state on each tile
   ("LA leads 2–1"). Offseason: the final's five games and the champion, as MLB.com and Savant do,
   which lets the lead's G1 to G5 row go. Never "No games", never next season's games before
   they are public (see the next-season rule).
3. **Ten entry points in the first screen** at 1440 and at 375. The Latest list gets most of the way;
   measure it in the sweep rather than by eye.
4. **A time on every item that has one**: clips, photos, Spotlight's reason ("Birthday today" has
   it; a board finish does not need one).
5. **One left edge on a phone.** Bring the lead to the 16px gutter or say why it is inset.

### Next

6. **Light mode as an equal** (step 6). Design it rather than translate it; check the masthead jerseys
   on white (a lighter recipe or a thin trim on a white block). Consider which theme a new visitor
   gets: 11 of 14 references are light.
7. **Heavy tier at three, at most** (the lead, Latest, the leaders); everything else in the minor
   tier, and the minor heading quieter still (small letterspaced caps, as The Athletic does).
8. **The leaders board gets Savant's two links**: a definition of the stat in an `InfoDot`, and the
   heading as the link to the full board (already done).
9. **Club marks on list rows** wherever a row is about a club (Latest, Reading posts about a club,
   Watch clips), as MLB.com does. Small, the mark alone, no tick.
10. **Phone order** (step 5): nav, strip, lead photo, headline, Latest, then the sections. MLB.com's
    phone page is this order.

### Later, across the site

11. **A topical links row under the sub-nav**, by season phase, like CBS's ("Season recap",
    "Awards", "World Cup" in the offseason; "Standings race", "Leaders" in season). One line,
    no fill.
12. **A "Trending players" list** from page views (the `events` table, aggregated, never a person),
    as Baseball Reference does. Needs a check against `ADMIN_ANALYTICS.md`'s privacy section first.
13. **Daily lists in the offseason**, Baseball Reference style: birthdays (the star sign card is
    already this), "This day in the 2026 season" once the calendar reaches the season's dates.
14. **Carry the grammar to the other pages**: a Game Center opens on its lead (the score) with the
    play list as the headline list; a player page on the face and one stat line, then a list.

### Never

- A promo, banner or sign-up box in the content.
- A strip, shelf or section that shows nothing ("No games", an empty carousel, a logo panel).
- The brand color as a fill behind a heading.
- Emoji in a headline.
- More than one list competing for the right column.

## Sources

- The fourteen screenshots, `2026-11-04/`, captured Nov 4, 2026.
- MLB.com's phone layout, checked in the browser at 375 the same day.
- [Lickability, "Apple Sports"](https://lickability.com/blog/apple-sports/): compact bold score
  figures, low-key segment pickers, dense grids that keep columns aligned at large text.
- [Six Colors, "The poor design of Apple Sports"](https://sixcolors.com/link/2024/04/the-poor-design-of-apple-sports/):
  a score-only design falls down everywhere past the score.
- [Poynter, Eyetrack findings](https://poynter.org/?p=24963) and
  [journalism.co.uk on the same study](https://journalism.co.uk/news/secrets-of-readers-eyes-revealed/s2/a51049):
  dominant headlines are the entry point; readers scan down headline lists and stop early.
