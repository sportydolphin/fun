# UI Overhaul Roadmap

> Living document: a direction and a sequence, not a contract.
> Companions: **[ROADMAP-WPBL.md](ROADMAP-WPBL.md)** and **[ROADMAP.md](ROADMAP.md)**. Nothing
> here blocks feature work in either section. Where each phase sits against the rest is
> [ROADMAP-PRIORITIES.md](ROADMAP-PRIORITIES.md): phase 1 now, phases 2 and 3 over the winter,
> settled by March so the sweep baselines are stable for the 2027 WPBL season.
> Started: **Oct 15, 2026**. Planned as Figma first, no code until a direction was picked. Since
> **Nov 3** the direction is being set in code instead, on the `redesign` branch: WPBL Home first,
> as the precedent for the rest of the site, then page by page. The branch merges to `main` when
> the redesign is complete. "Where it landed" below is the direction as built; "Handoff" is the
> state of the branch and what is next.

---

## Where it landed (Nov 4, 2026)

A sports page, not an app dashboard: **one metaphor, the newspaper**, and whatever does not fit it
goes (Nov 4, seventh pass). Where this and the original brief below disagree, this wins.

- **One brand color, stitch red** (`BRAND`): `#f26b5b` dark, `#b3261e` light and under white text.
  Links, the active tab and focus only, since red already means live and negative.
- **Three faces, one job each** (Nov 4, Home step 3). Barlow Condensed 700 (`DISPLAY_FONT`) for
  scores, the one big number, page titles and section headings; Newsreader 600 (`HEADLINE_SX`,
  `TITLE_SX`) for the lead's headline and article and video titles, as a paper sets its headlines in
  a serif; Inter for names, prose and figures, the figures in its tabular digits (`AGATE_SX`, which
  was Barlow Semi Condensed until it read as the display face at small sizes). Never a player's
  name in Barlow or Newsreader (the name fits measure Inter).
- **Sections, not cards, in two tiers.** A section is a rule and a heading; no frame, no fill.
  News (the lead, Latest, Spotlight, the leaders) takes the heavy tier: a 2px rule in the text color
  (`SECTION_RULE`) and a heading in display capitals. What a reader browses (Reading, Watch, the
  gallery, the award results, the star sign card) is wrapped in `MinorSections`: a `divider`
  hairline and a smaller heading. Objects (a game tile, a control) keep a frame at 3:1. Spotlight
  is a section now, not a framed card, and the lead has no filled panel. A heading that links ends in a › in its own ink, never the accent.
- **Clubs as solid blocks**, square, the way a jersey or a broadcast graphic prints a club. No pale
  washes (they vanished on the light page) and no accent stripe down one edge of a rounded card (it
  read as generated). Home draws no club block now: its masthead is a standings line (below). The
  Teams tab, a club page and the league page still use `wpblField` (a mid-tone fill picked to carry
  ink).
- **Home's masthead is a standings line** (Nov 4, owner's pick from a trial against the jersey
  blocks, a line under a four-color bar, and nothing): the title on a heavy rule, then the clubs in
  the order they finished, each a place, a mark, a name and a record, with "Champions" in gold, over
  a hairline (`ClubRail`). The blocks were the heaviest thing on the page and only navigation; the
  color is left to the marks.
- **Pictures are square** (`MEDIA_RADIUS`), as a printed page runs a photo, and so are faces on
  Home: `PlayerPortrait`'s `print` is a square headshot on the club's color with no ring (the
  leader, Spotlight, the award winners, the Star of the final). Corners stay on controls and sheets.
  The player page's rounded `square` portrait has not moved yet.
- **Rows as box-score lines**: rank, the name, the club right after it, the figure in agate. No
  club-color tick (the abbreviation already says it). A face only where the face is the point (a
  leader, the Spotlight).
- **A headline list under the lead** (Nov 4, from the 14-site study in
  `docs/design-references/ANALYSIS.md`, where 11 of 14 baseball front pages run one): `LatestCard`,
  the newest league videos, the two writers' posts and This is Women's Baseball's recaps as text
  rows with a date, the week's clips as one row, at most three of a kind, four rows. The news row is
  Latest, Spotlight and the leaders, three across from lg (`NEWS_ROW_SX`), Latest first at every
  width, as a paper runs "What's News" down the left; on a phone it is straight under the lead.
  Fixed row slots, so it loads at its own height.
- **Print columns** (Nov 4, the margins pass, `FlushSections` in `src/ui/card.tsx`): a section's
  text is flush with its rule, and its heading 10px under the rule rather than 15. Before, a section
  kept the old card's 16px side padding with no card around it, so each rule ran past its text, two
  columns' text stood 80px apart across a 40px gutter at 1440, and on a phone every section sat 16px
  inside the masthead. Now the masthead, the lead photo and every heading share one left edge (83px
  at 1440, the 16px gutter on a phone). Opt-in per page as it is migrated; the offseason Home is the
  first. Sections stay about 45px apart, content to the next rule.
- **Headlines break like a copy desk's**: `TITLE_SX` wraps `pretty`, so no title leaves one word on
  its last line ("…Never Heard / Of"). The three faces stay: a condensed gothic for column heads,
  a serif for headlines, a sans for names and agate is how a sports page is set.
- **The lead is a front page**: the title photo at 3:2 in seven columns of twelve with its credit
  under it, and beside it a gold kicker, the club's full name as the headline at `lead`, the road
  as agate lines, the final's games (the champion's wins in bold ink, no bars), the Star and
  "Season recap ›". No black bar, no gray panel (`ChampionLead` in `home/ChampionCards.tsx`).

## Handoff (Nov 4, 2026)

Where the work is, for whoever picks it up.

- **Branch `redesign`**, checked out in its own worktree at `../fun-redesign` (beside this repo).
  Pushed to `origin/redesign`, up to date with `main` as of `c6ac96c2` (#194), no pull request
  yet: it merges to `main` in one piece when the redesign is complete, as v1.208.0. That entry in
  `src/changelog.ts` is written as of Nov 4; set its date, and its version if `main` has taken
  1.208.0 by then, at the merge.
- **The seventh and eighth passes are committed on top of it** (Nov 4, from the third audit). Seventh
  (`636ecfc0`): the lead rebuilt as a front page (`ChampionLead`, and `ChampionLeadSkeleton`
  reserving it), Spotlight as a section instead of a trading card, square `print` faces across Home,
  Reading's row thumbnails square. Eighth: the masthead's clubs in the order they finished, the star
  sign card in calendar order (signSeason still picks who fits the cap), both heading tiers in
  capitals (the minor one a size down under a hairline, the Discord row in it), gray labels at
  medium weight, the award bars dropped, and the rail arrows square with a stroked chevron (a white
  disc with a triangle read as a play button). Typecheck, lint, the tests and the sweep on `/wpbl`,
  `/wpbl/watch` and `/wpbl/photos` (`--shift --ellipsis`, and `--text large` on Home) are clean.
  Left from the audit on purpose: the leaders' 44px phone rows (that is the tap target), the
  ringed gear (the dev menu, never in production), Watch's two-line clip titles.
- **The tenth pass** (Nov 4, margins and type): print columns on the offseason Home (`FlushSections`,
  `useSectionInset` for a loading copy and the Discord row), `pretty` wrapping on titles, and Latest's
  clips row headed by the newest clip ("Clip · 3 this week") with each row centered in its slot.
  The in-season Home is not flush yet: NextGameCard bleeds its band with `mx: -2`, rebuilt in step 1.
  Sweep clean on `/wpbl`, `/wpbl/watch`, `/wpbl/reading` and `/wpbl/photos` (`--shift --ellipsis`,
  and `--text large` on Home).
- **The ninth pass** (Nov 4, from `docs/design-references/ANALYSIS.md`): the Latest list and the
  news row (see "Where it landed"), and Spotlight's face at 104 from lg with the club's short name
  there, since a third of the row cut "New York Heights · RHP · #29". Two new events,
  `wpbl_latest_shown` and `wpbl_latest_open`, in the admin funnel. Typecheck, lint, the tests (3,512)
  and the sweep on `/wpbl` (`--shift --ellipsis`) are clean. Not taken from the study yet: the score
  strip's offseason state (the final's games, as MLB.com and Savant do) waits on step 1; sections
  inset their content 16px from their rule on a phone, which the references do not (done for Home in
  the tenth pass); Watch's clips carry no date.
- **The last commit of work is the sixth pass on Home** (`ff012f33`, from the Nov 4 visual audit):
  the two section tiers, square pictures, the masthead as jerseys, the champion lead as a news
  photo, the gallery's lead photo dropped, the page reordered, the footer's wordmark, and the
  leaders and award rows simplified. All of it is in the audit list below. Typecheck, lint and the
  tests pass on it (Nov 4: 279 files, 3,506 tests); the layout sweep was not run on it.
- **Run it** with the `redesign-lan` entry in `.claude/launch.json` (port 5190, LAN-visible for a
  phone), which serves the worktree from the main checkout. That entry is itself uncommitted on the
  main checkout's `stats-phone-bar` branch.
- **Not on this branch: `stats-phone-bar`**, uncommitted in the main checkout, cut from `main`
  before the redesign. The WPBL Stats tab's phone bar: the four-way side switch fills the line
  (`PillGroup`'s new `fill`), the "Sort WAR" pill becomes a 34px icon button (Tune) whose room is
  held on boards without one, and the ranked list's header ("WAR ↓ ▾") opens the sort sheet. It
  touches `stats/ControlBar.tsx` and `stats/RankedList.tsx`, which `redesign` also changed: expect
  a small conflict, whichever lands second.
- **Home is not done, and does not go to `main` until the owner is satisfied with it** (owner's
  call, Nov 4). The branch still merges whole; the other pages wait until Home is settled. Home's
  remaining steps, in order (the owner took 3 onward first; 1 and 2 are after):
  1. The in-season and postseason Home: the scoreboard strip, Next game, the bracket and the final
     in progress are still the old cards. Built against the dev simulation and 2026's data.
  2. A reason to come back in the offseason: ~~a "Today" line~~ the Latest list, Nov 4 (ninth
     pass, below). Left: the champion lead receding as the winter goes on.
  3. ~~Type~~ Done Nov 4: Newsreader for headlines and titles, Inter for figures.
  4. ~~Ragged desktop pairs~~ Done Nov 4: Reading takes a fourth post from `lg` with its credit
     under the posts, the leaders a 72 face and 34 rows, the award rows more room; each pair now ends
     within about 40px of the other at 1440. The lead's headline steps to 2.75rem between md and lg.
  5. A phone pass: headline over the photo or under it, the room under the Discord row, the
     footer's length, Watch's clipped clip titles. (The masthead is one line since Nov 4.)
  6. Light mode: an equal, or a translation of dark. With the jerseys gone from the masthead, the
     top of the light page is light; what is left dark is the club marks' own fills.
  7. Fan award shares need a head ("Share of votes"); edge states (no photo, awards coming down, a
     small sign).
  8. The lead photo's weight (responsive sizes, an early fetch) and the skeleton-to-content fade.
  9. Lift Home's pieces into `src/ui/` (the lead, agate lines, print headshots, the two tiers).
- **Proposed for after Home (waiting on the owner):** the player page next, before the Stats
  leaders board (readers open it most, and it still draws the rounded portrait and a club band);
  and the jersey as the one club recipe, since Home no longer draws a `wpblField` block.
- **After Home, in order:** decide the club recipe (below), then the Stats tab's Leaders board (the last
  open audit item), the scoreboard and Game Center for the 2027 feed, then the rest of WPBL page by
  page, then MLB. Re-run `npm run sweep -- --ellipsis` on each page migrated, and re-record the
  sweep baselines (`npm run sweep:record`) before the merge.
- **Decisions waiting on the owner:**
  - The club recipe for Teams, a club page's header and the league page: the jersey (the club's
    near-black primary, white ink, bright trim) or `wpblField` (Los Angeles's is gold with black ink
    in both themes since Nov 4). Home no longer draws either.
  - The open questions at the end of this file (two-club tints, light mode, glass on Android).
- **Figma was skipped.** Phase 1's Figma items (mood board, variables, five mocks) are open and
  may stay that way: the direction was set in code instead.

## Player portraits (Nov 5, 2026)

The audit: the 118 bundled headshots are 512 squares cropped once (Aug 4) from whatever photo the
league had, and the frame draws each file whole, so an odd crop is odd in the file. They come
from three shoots with no shared framing rule:

- **The league's studio shoot in club uniform, about 50.** Consistent: cap near the top, face
  about 44% of the frame's width, shoulders across the bottom edge.
- **The WPBL draft shoot, black tee and W cap, about 54.** Consistent with each other, but no club
  is in the photo; the club color behind it is the only club on the face.
- **About 12 one-offs** (college, national team, ID photos), which are the broken ones. A head with
  no shoulders: Ayuri Shimano, Olivia Bricker, Melissa Mayeux (her cut-out lost part of her
  jersey). Zoomed in and soft: Rosi del Castillo, Luciana Moreno, Chloe Atkinson. A white fringe
  left by the key: Rosi del Castillo, Melissa Mayeux, Maddison Erwin, Leah Cornish, Emily Baxter,
  Laura Hirai, Braidy Birdsall. Another team's kit: Leah Cornish (Canada), Claire and Elodie
  O'Sullivan (Australia), Laura Hirai, Sydney Barry. The cap cut by the top edge: Valerie Perez.
  Framed small: Scrappy Hopkins. Wrong club: Diana Ibarra wears New York on Los Angeles's color.

The background is the club's raw primary. Los Angeles's is `#000000`, so with `print`'s ring gone
a Los Angeles face has no edge on the dark page and is the heaviest block on the light one.

The plan, in order:

1. [x] **Sources, a manifest and one framing rule** (Nov 5: `scripts/frame-wpbl-portraits.py`,
   `art/wpbl-portraits/`, `portraitFraming.test.ts`; 33 photos carry an issue, and the share cards
   in `src/wpbl/cards/` still show the old crops until `make-wpbl-share-cards.py` is rerun).
   Keep each player's photo as it came in, as source art outside the bundle, and record per player the measured face box, where the photo is
   from, and the club in the photo, plus an optional hand-set box. One script builds the 512 and
   the 128 from that with one rule (the face's center and width at fixed fractions of the frame),
   so a new photo from any shoot lands framed like the rest. Anything the rule cannot fix (a gap
   under the shoulders, an upscale past what the source holds) is written down as an issue on the
   player, and a test holds the list, so a new one fails CI.
2. [ ] **New photos for the one-offs**, from the league or the clubs, and the draft-tee 48 when 2027's
   media day publishes. Until then (Nov 5): a source cut at the chin is held on the frame's bottom
   edge, where the cut reads as a crop (Ayuri Shimano, Olivia Bricker). A fade was the first plan
   and does not work: under a head with no shoulders there is nothing for it to fade but club color.
   Melissa Mayeux's cut-out lost part of her jersey, which only a new photo fixes.
3. [x] **The background behind a face is the club's `wpblField`** (owner's pick, Nov 5), on every
   `print` face. The raw primary was 1.1 to 1.2:1 against the dark page (the square was not there)
   and 15 to 20:1 against the light one; the field is 2.2 to 2.9:1 dark (Los Angeles's gold 9:1) and
   3.2 to 8.2:1 light. The ringed circle keeps the primary, since its ring is its edge. The club
   recipe for blocks elsewhere is still open, but faces now lean it toward `wpblField`.
4. [ ] **The club in the photo checked against the roster**, from the manifest: a trade or a draft
   photo on a new club is listed rather than found by eye.
5. [x] **The player page's rounded 84 moves to `print`**, the last frame that had not (Nov 5).
   `PlayerPortrait`'s `square` option went with it.

## The direction: smooth, modern, Apple Sports (original brief, Oct 15)

Glanceable, dark-first and calm. Team color does the decorating, so nothing else has to. One
number dominates each card, detail lives one tap deeper, and motion explains where things went.

### Why not a new component library

The site uses MUI as a styling engine, not a component kit: about 3,350 `<Box>`, 1,670
`<Typography>` and 5,260 `sx=` props, against roughly 200 real widgets (Button, TextField, Dialog,
Select, Chip). Swapping libraries would rewrite the 200 and leave the other 5,000 looking the same.
The look lives in the `sx` values, so the lever is **tokens plus a small house component set**. The
bespoke pieces (`ModalShell`, `SwipeableViews`, `BaseDiamond`, `winProbChart`, `names.ts`, the
scale system, the sweep) stay; no library ships them.

---

## Design language

| Element | Rule |
|---|---|
| Canvas | True black or near-black, dark-first. Light mode is a translation, not the source. No visible page chrome. |
| Cards | Large radius with continuous (squircle) corners. Separated by fill, not lines. Edge to edge on a phone with a 16px gutter. |
| Team color | Each game card carries a soft gradient or tint of both clubs' primaries. Tints are contrast-checked, never guessed. |
| Type | Heavy weights for scores, regular for labels, tabular figures everywhere. Two or three sizes per screen. Scores huge, everything else quiet. |
| Hierarchy | Per card: score, then status (inning, Final), then team names. Stats only on tap. |
| Density | Low on lists, rich on detail. Box score and plays sit one level down, never on the scoreboard. |
| Chrome | A league chip row, favorites pinned first, a floating bottom bar. Nothing else. |
| Materials | Glass: translucent, blurred bars and segment pickers floating over content, compacting on scroll. |
| Motion | Springs, not ease curves. Scores roll digit by digit. Cards expand into their detail view rather than cutting to a new page. |
| Live state | A small pulsing dot, the inning, and `BaseDiamond` with outs as one compact glyph. |

### Web translation

- **Font:** SF Pro's license forbids self-hosting on the web. Stack `-apple-system` first so Apple
  devices get SF, then **Inter Display** (Inter already ships, subset by `npm run subset-font`),
  with `font-variant-numeric: tabular-nums`.
- **Glass:** `backdrop-filter: blur() saturate()` over a translucent fill, on the bottom bar and
  sticky headers only.
- **Squircles:** `corner-shape: squircle` where supported, plain `border-radius` as the fallback.
- **Springs:** CSS `linear()` easing approximates spring curves with no library.
- **Card to detail:** the View Transitions API, with a shared element name on the card.
- **Score roll:** one column per digit, animated with `translateY` on change.

---

## References

### The source

- **Apple Sports** (iOS, free). Study the scoreboard, a live game, a final, and the league switcher.
- **Apple Human Interface Guidelines**: Typography, Color, Materials, Motion.
- **WWDC25, "Meet Liquid Glass"** and **"Get to know the new design system"**: the material language.
- **Apple Design Resources**: the official iOS Figma kit, on Figma Community. Start every frame from it.
- **Live Activities and Dynamic Island scores**: the most compressed score layout Apple ships.
- **Apple TV's MLS and Friday Night Baseball score bugs**: team color first, broadcast form.

### Other sports apps in a modern style

- **FotMob**: dense match data kept calm; good for how a deep Game Center stays readable.
- **Sofascore**: live momentum graphs and player ratings, a reference for `winProbChart`.
- **The Athletic**: editorial type and story-led game pages, for recaps and Reading.
- **F1 TV and the F1 app**: live timing and team-color systems across ten teams.
- **Strava**: activity cards and the stat-forward detail view.

### Non-sports apps with the same feel

- **Apple Weather**: gradient backgrounds driven by data, and modular cards of differing sizes.
- **Apple Fitness and Activity**: big numerals, rings, celebratory motion for milestones.
- **Robinhood**: one hero number and one chart per screen, with scrubbing.
- **Linear**: restraint, dark surfaces, precise type, fast motion.
- **Things 3**: whitespace, springy interactions, nothing extra.
- **Arc and Arc Search**: playful motion and color on a calm base.
- **Family (wallet)**: fluid sheets and morphing transitions, the best reference for `ModalShell`.
- **Material 3 Expressive** (Google, 2025): spring motion and shape morphing from the other platform.

### People and libraries worth reading

- **Emil Kowalski**: *animations.dev*, plus **Vaul** (drawer) and **Sonner** (toasts), both
  reference implementations of iOS-feeling web motion.
- **Rauno Freiberg** (rauno.me): interaction craft essays, especially "Invisible details of
  interaction design".
- **Vercel Geist** and **Radix Colors**: token systems with steps built for both themes.

### Galleries

- **Mobbin**: real app screenshots and flows, Apple Sports included.
- **Refero**: searchable UI references by pattern ("scoreboard", "bottom sheet").
- **Godly**: web sites with strong motion.

---

## Figma setup

- **Variables first, mirroring code.** Color roles (canvas, raised, text primary, secondary,
  tertiary, separator, accent, live) in Dark and Light modes; spacing; radius; type sizes. Name them
  as the CSS variables will be named, so handoff is a copy.
- **Team color as a variable collection**, one mode per club (WPBL's six, then MLB's 30), so one
  card component previews every club.
- **Frames:** phone 375 wide, desktop at the desktop scale (`--app-chrome`). Design both; the
  desktop side panel is its own case (`usePhoneLayout()`).
- **Long names in every mock.** Use the longest real names on the roster so the "F. Last" stages
  (`nameStages`) get designed, not discovered.
- **States per component:** loading (the loaded layout drawn empty), live, final, postponed, empty.

---

## Audit: what reads as generated (Nov 3, 2026)

A pass over the live WPBL home, WPBL stats and MLB home, phone and desktop. The site reads as a
dark admin dashboard with sports data in it. Apple Sports alone is also a template; the lead
story, the display face and team color as the only decoration are what make it this site.
Each item names the phase that carries it.

- [x] **Card soup** (Nov 3, option B). Every module was the same outlined card with a "Title ...
      Link ›" header in a two-column grid. `SectionCard` is now a section by default: no border,
      fill or corners, one rule on top (since Nov 4 a 2px rule in the text color, `SECTION_RULE`), and a 32px column gap (`SECTION_COLUMN_GAP`) in
      place of 12px. Objects keep their frame (`framed`, game tiles, the followed-team card, the
      standout card, chips and controls at 3:1). Not fill-only cards: in dark mode a lifted
      surface means "this floats" (v1.157.0), and no fill reaches 3:1 without becoming a slab
      (8% white is 1.22:1). The Borders rule in `src/CLAUDE.md` says so. Hand-drawn list boxes
      outside `SectionCard` still have frames; convert them as their pages are touched.
- [x] **No lead on the home page** (Nov 3, WPBL). Eight sections of one weight, in pairs. The
      offseason Home now opens on the champion's season card at full width, band beside the road
      to the title from `md` (`lead` on NextGameCard), then Spotlight beside the leaders and the
      award winners stacked, the gallery, the star sign card, and Reading beside Watch. Its Star of
      the final keeps a player link in the first screen. MLB already led with its World Series
      card. Left: the in-season lead (today's games) when the 2027 feed returns.
      Second pass the same day: the champion's name at `TYPE_SCALE.lead` (3.5rem) from `md`, section
      headings in the display face (`SECTION_HEADING_SX`), 24px between sections on Home, a dot
      between a leader's two figures, and About the League as a heading link, not a box.
      Third pass, the champion card: no section heading over the lead (the band says "2026 WPBL
      Champions", with "Season recap ›" on it; the h2 stays for screen readers, `headingHidden`), the
      road to the title a size up, the three blocks on the right spread down the band's height, and
      the logo watermark larger, fainter and lower so its crown no longer cuts the gold rule.
      Fourth pass, Player Spotlight: the jersey number as the card's numeral, three plain lines in
      place of seven labeled facts, the stat line a size up, the heading as the profile link (the
      footer "Full profile ›" went). Shorter now, so Home pairs it with the leaders, and the award
      winners with the star sign card (from `lg`; full width below, where two names across half a
      960 page cut "B. Espinoza-Molina"). That name on a 375 phone at large text (cut before this
      work) fits now: the star sign rows drop the face there. The face is 72 between phone and lg.
      Fifth pass, the foot of the page: About the League off the offseason Home (a heading with
      nothing under it; the footer links it), the Discord invite a section row instead of a blurple
      promo box, "Submit photos ›" in the gallery's header, and the footer's Data sources back in its
      own Reference group (the dev-only World Cup group had split it in two). The ellipsis list for
      Home is empty at every width and both text sizes.
- [x] **Clubs as solid blocks** (Nov 4). Home's masthead is the title over the four clubs, flush
      blocks of each club's own color (`wpblField`: deep fills with white ink, Los Angeles black with
      gold ink in light mode and gold with black ink in dark), square, with city, name, record and
      finish; drawn at every width, so it is the way to the clubs on a phone. The Teams tab's cards
      and a club page's header are the same block. Replaces the pale-wash tile with a colored top
      edge (first cut, same day) and the 3px left stripe on Teams: an accent edge on a rounded card
      read as generated, and the washes all but vanished on the light page (owner's call). A badge
      on a block takes the block's ink as its ring as given (`TeamBadge`'s `onFill`). The league
      page's club cards are blocks too; `AccentPanel` and the pick'em's "Your call" row trade their
      3px left rail for a square swatch before the label. No accent edge stripes are left in WPBL.
- [x] **The rest of the offseason Home** (Nov 4). Fan Award Winners: each award's name in the
      display face, the winner under it, the share in agate with a bar in the winner's club color.
      The star sign card: a calendar tile (month over day) in place of the face, today's tile the
      club's block, the sign's glyph large in the heading row. The gallery led with one landscape
      photo across the section, the rail under it (undone in the sixth pass). The footer is the
      site's name under the section rule and an index, one line per group in agate, in place of six
      link columns.
- [x] **Sixth pass: a page with an order** (Nov 4, from a second visual audit). Below the lead nothing outranked anything, nine sections in one
      heading style. Now three tiers: the lead, then Spotlight and the leaders under the heavy rule,
      then Reading beside Watch, the gallery, and the award winners beside the star sign card in the
      minor tier (`MinorSections` in `src/ui/card.tsx`), in order of what changes between visits.
      The champion lead is a news photo: the title celebration (`championPhoto` in `fanPhotos.ts`, a
      landscape team photo dated during the final or the day after, else the club's mark at the same
      height) over a bar in the club's near-black primary with gold trim, and the road, the final's
      games ("LA 7–6", one agate line each, bars in ink rather than club color) and the Star on a
      panel beside it. The gallery is the rail alone. Home's masthead clubs are jerseys (see "Where it
      landed"); Los Angeles's `wpblField` is gold with black ink in both themes. Award names are
      labels, not display caps, and the share bar is ink. The star sign card fills its empty slots
      with the next sign's players behind a "Next sign" divider (`nextSignSeason`). Leader rows lose
      the club tick and put the club after the name; the rank is the figure's size and ink; the
      leader's figure is a step smaller on a phone. Reading fits a banner cover (3:1 and wider)
      rather than cropping it, with the row rule inset; Watch labels its two shelves and puts its
      count in the heading row. Pictures are square (`MEDIA_RADIUS`). Home's h1 is in capitals
      (`HOME_TITLE_SX`). The footer's name is the toolbar's lockup (mark and "sportydolphin"), not a
      second logo in the display face, and its column is Home's width (`HOME_W`).
- [x] **Spotlight as a trading card** (Nov 4). A framed object in the club's accent: a band in the
      club's surface color with a square photo, the jersey number in the band's corner at `lead`
      size in the club's color, and the reason over the name in agate caps. Facts under it, and the
      season line along the bottom in the agate face. The date beside the heading is gone. The
      rotation now draws from players with a story (`spotlightStories`: a top-3 finish on one of
      fifteen headline boards, "1st in Strikeouts", "T1 in Wins"); a birthday still outranks it, and
      stale season rows fall back to everyone. The star sign card's "Today" is the club's color,
      not the brand red.
- [x] **Spotlight repeated the Star of the Final** (Nov 3). Spotlight now steps to the next player
      in the rotation when it lands on the final's Star (`useChampionFinal`, shared with the
      season card). The "Scorpio Season" card and the star sign stay (owner's call, Nov 3).
- [x] **No identity** (Nov 3, v1.208.0). Was Inter on near-black, a stock link blue and a
      rainbow on the WPBL toggle. Then: one brand teal (`BRAND` in `src/ui/card.tsx`, `#2dd4bf` dark,
      `#0f766e` light, the hex refused by lint outside the token files; replaced the next day, below); Barlow Condensed 700
      (`DISPLAY_FONT`, 22 KB, preloaded) for scores, the one big number on a card and page titles,
      never names; a neutral segmented league switch with no confetti. Team colors stay the only
      other decoration.
      Second pass (Nov 4): the teal was Tailwind's stock `teal-400`, the most generated color there
      is, so the brand is now **stitch red** (`#f26b5b` dark, `#b3261e` light and as the fill under
      white text). The compare page's winner wash went neutral, since a red cell read as the loser.
      Red already meant live and negative (`--wpbl-neg`); the brand is only links, the active tab and
      focus, so keep it there. A third face, **agate** (`AGATE_SX`, Barlow Semi Condensed 600, 23 KB,
      preloaded), for figures in print: stat lines, leader values, the count or date in a heading row.
      Section headings are display caps under a 2px rule in the text color (`SECTION_RULE`), the way
      a sports page heads a column. A heading that links had no › that day; it got one back in the
      heading's own ink in the sixth pass, since a phone has no hover to tell a link from a label.
- [x] **Eyebrow caps everywhere** (Nov 3, v1.208.0). 236 `textTransform: 'uppercase'` labels; 25
      remain, all in the two roles caps keep: stat-table column heads (and one chart axis) and the
      gold champion eyebrows. A third role since Nov 4: section headings, display capitals under
      the section rule. Not yet a lint rule: a new caps label is caught in review.
- [x] **The same header everywhere** (Nov 3). Every section ended in a teal "See all ›". A link to
      more of the same is now the heading itself (`SectionCard`'s `titleLink`, "2026 Leaders ›"); the
      action slot keeps a verb that goes somewhere else ("Choose a team", "Compare teams") and plain
      counts ("147 photos"). Every link checked opens more than its section shows (Fan Award Winners:
      5 of 13 categories), so none was dropped.
- [x] **Empty states as content** (Nov 3). MLB home opened on "No team followed" and "No players
      followed"; with neither, it is now one "Following" card with + Team and + Player, and an
      empty players card is its header alone. Kept for signed-out readers: follows are stored
      locally. The "empty circles" on the leader boards were portraits still lazy-loading;
      a player with no face already gets initials.
- [ ] **Leaders as widget grids** (phase 3). Four boxed top-5 lists side by side. One `DataTable`
      with the leader's number large, or one board with a stat picker. Home's card is done (Nov 4):
      one board, stat tabs (WAR, AVG, HR, ERA, K), the leader with a face and the figure in the display
      face, places 2 to 5 as box-score lines (rank, name, club, figure in the agate face; the club
      tick went in the sixth pass), a tie marked on the rank ("T2"). The Stats tab's Leaders board is
      left.
- [x] **Token drift** (Nov 3). About 12 `borderRadius` values, 215 distinct hex colors (813 uses),
      55 distinct shadows. Now: `RADIUS` (4, 8, 12px and pill); `src/ui/color.ts` for every color
      (`HUE`, `INK`, `SURFACE`, `CHAMPION`, `MARK`, `SCORIGAMI_SQUARES`) and every shadow (`SHADOW`,
      eleven named by what floats); `BRAND` for the accent. All lint-enforced in UI files; data, images,
      dev tools and admin are exempt by name (`TOKEN_FILES`). A few near-duplicates collapsed onto their
      step (MUI's reds onto `red` and `redDeep`, two chart blues onto `blue` and `blueDeep`).
      Gradients left as they are: 50, nearly all the scroll fades on sticky table columns, which are
      function rather than decoration.

---

## Phases

### 1. Direction

Planned in Figma; set in code on the `redesign` branch since Nov 3 (see "Where it landed").

- [ ] Mood board from the references above.
- [ ] Token variables in Figma, both themes.
- [ ] Mock five screens, phone and desktop: WPBL home, scoreboard, Game Center, player page,
      standings.
- [x] Pick the display face for numbers and titles, and the one brand color (Nov 3 and 4: Barlow
      Condensed, stitch red, and an agate face, Barlow Semi Condensed).
- [ ] The women's baseball shell (added Nov 1, 2026): the league list with MLB in it after the
  women's competitions, and whether `/` earns a front page. Built with phase 3; the brief is
  stage 3 of [ROADMAP-WOMENS-BASEBALL.md](ROADMAP-WOMENS-BASEBALL.md).
- [ ] Decide the open questions below.

### 2. Tokens and type, still on MUI

- [ ] Token layer as CSS variables in `styles.css`, wired into `createAppTheme` in `ThemeContext.tsx`.
- [ ] Type ramp on the existing `--app-type` scale. The faces are picked (above); the ramp is still
      `TYPE_SCALE` as it was, with `lead` added. Inter Display is dropped: the condensed faces carry
      the character it was meant to.
- [x] Move hard-coded `sx` colors onto tokens, with a lint rule to stop new ones (Nov 3: `src/ui/color.ts`,
      `BRAND`, `RADIUS`). Spacing is not on tokens yet.
- [ ] Re-measure name fits after the font change (`npm run sweep -- --ellipsis`). Clean on Home, the
      Teams tab, club pages and the league page (Nov 4); the rest as each page is migrated.

### 3. House components in `src/ui/`

- [ ] `ScoreCard` (team tint, live glyph, score roll), `Stat`, `StatLine`, `TeamChip`,
      `DataTable`, `Section`. (Glass `BottomNav` shipped early, v1.175.0, Oct 21.)
- [ ] `ModalShell` sheets restyled to the new materials.
- [ ] Migrate WPBL page by page (the feed is quiet until spring 2027), then MLB. Home is done on
      `redesign` (Nov 4); the Teams tab, a club page's header and the league page's clubs are on the
      club blocks. Next: the Stats tab's leaders board, the scoreboard and Game Center.
- [ ] Re-record the sweep baselines per page (`npm run sweep:record`).

### 4. Motion

- [ ] Card-to-detail View Transitions.
- [ ] Spring easing tokens; score roll; skeleton-to-content crossfade.
- [ ] `prefers-reduced-motion` turns all of it into plain fades.

### 5. Styling engine (optional, later)

- [ ] Once `sx` is mostly tokens, decide between Pigment CSS (lowest churn), CSS Modules or
      vanilla-extract. Emotion's runtime `sx` is the cost being removed.
- [ ] Headless primitives (Base UI first, as the nearest step from MUI) for the ~200 widgets, if
      MUI's are in the way.

---

## Open questions

- ~~**Borderless cards against the 3:1 outline rule**~~ Settled Nov 3: a read-only section has no
  outline and needs none; objects and controls keep theirs at 3:1. No fill-as-boundary.
- **Two-club gradients and text contrast.** Pick a tint recipe that passes axe on every pairing,
  or fall back to a neutral card with color only in the edges.
- **Light mode.** A true equal, or a faithful translation of dark?
- **Glass on low-end Android.** `backdrop-filter` costs; measure it on a mid-range phone before
  committing.

## Risks

- Every phase churns the sweep's shift baselines and axe results; re-record per phase.
- Name fits depend on font metrics; a new face means re-testing `nameStages` everywhere.
- The desktop scale (`chromePx`, `typePx`) must survive whatever replaces `sx`.
