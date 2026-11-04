# UI Overhaul Roadmap

> Living document: a direction and a sequence, not a contract.
> Companions: **[ROADMAP-WPBL.md](ROADMAP-WPBL.md)** and **[ROADMAP.md](ROADMAP.md)**. Nothing
> here blocks feature work in either section. Where each phase sits against the rest is
> [ROADMAP-PRIORITIES.md](ROADMAP-PRIORITIES.md): phase 1 now, phases 2 and 3 over the winter,
> settled by March so the sweep baselines are stable for the 2027 WPBL season.
> Started: **Oct 15, 2026**. Design happens in Figma first; no code until a direction is picked.

---

## The direction: smooth, modern, Apple Sports

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
      fill or corners, one `divider` rule on top, and a 32px column gap (`SECTION_COLUMN_GAP`) in
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
- [x] **Spotlight repeated the Star of the Final** (Nov 3). Spotlight now steps to the next player
      in the rotation when it lands on the final's Star (`useChampionFinal`, shared with the
      season card). The "Scorpio Season" card and the star sign stay (owner's call, Nov 3).
- [x] **No identity** (Nov 3, v1.208.0). Was Inter on near-black, a stock link blue and a
      rainbow on the WPBL toggle. Now: one brand teal (`BRAND` in `src/ui/card.tsx`, `#2dd4bf` dark,
      `#0f766e` light, the hex refused by lint outside the token files); Barlow Condensed 700
      (`DISPLAY_FONT`, 22 KB, preloaded) for scores, the one big number on a card and page titles,
      never names; a neutral segmented league switch with no confetti. Team colors stay the only
      other decoration.
- [x] **Eyebrow caps everywhere** (Nov 3, v1.208.0). 236 `textTransform: 'uppercase'` labels; 25
      remain, all in the two roles caps keep: stat-table column heads (and one chart axis) and the
      gold champion eyebrows. Not yet a lint rule: a new caps label is caught in review.
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
      with the leader's number large, or one board with a stat picker.
- [ ] **Token drift** (phase 2, first). About 12 `borderRadius` values, 258 distinct hex colors,
      54 gradients, 64 `boxShadow`s. Radius done Nov 3: `RADIUS` (4, 8, 12px and pill), lint-enforced.
      The brand hex is lint-enforced too. Left: the other hex colors, gradients and shadows onto
      tokens, each with its lint rule.

---

## Phases

### 1. Direction (Figma only)

- [ ] Mood board from the references above.
- [ ] Token variables in Figma, both themes.
- [ ] Mock five screens, phone and desktop: WPBL home, scoreboard, Game Center, player page,
      standings.
- [ ] Pick the display face for numbers and titles, and the one brand color.
- [ ] The women's baseball shell (added Nov 1, 2026): the league list with MLB in it after the
  women's competitions, and whether `/` earns a front page. Built with phase 3; the brief is
  stage 3 of [ROADMAP-WOMENS-BASEBALL.md](ROADMAP-WOMENS-BASEBALL.md).
- [ ] Decide the open questions below.

### 2. Tokens and type, still on MUI

- [ ] Token layer as CSS variables in `styles.css`, wired into `createAppTheme` in `ThemeContext.tsx`.
- [ ] New type ramp on the existing `--app-type` scale; Inter Display subset; tabular figures.
- [ ] Move hard-coded `sx` colors and spacing onto tokens (lint rule to stop new ones).
- [ ] Re-measure name fits after the font change (`npm run sweep -- --ellipsis`).

### 3. House components in `src/ui/`

- [ ] `ScoreCard` (team tint, live glyph, score roll), `Stat`, `StatLine`, `TeamChip`,
      `DataTable`, `Section`. (Glass `BottomNav` shipped early, v1.175.0, Oct 21.)
- [ ] `ModalShell` sheets restyled to the new materials.
- [ ] Migrate WPBL page by page (the feed is quiet until spring 2027), then MLB.
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
