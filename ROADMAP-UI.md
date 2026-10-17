# UI Overhaul Roadmap

> Living document: a direction and a sequence, not a contract.
> Companions: **[ROADMAP-WPBL.md](ROADMAP-WPBL.md)** and **[ROADMAP.md](ROADMAP.md)**. Nothing
> here blocks feature work in either section. Where each phase sits against the rest is
> [ROADMAP-PRIORITIES.md](ROADMAP-PRIORITIES.md): phase 1 now, phases 2 and 3 over the winter,
> settled by March so the sweep baselines are stable for the 2027 WPBL season.
> Started: **Oct 15, 2026**. Design happens in Figma first; no code until a direction is picked.

---

## The direction: smooth, modern, Apple Sports

Glanceable, dark-first and calm. Team colour does the decorating, so nothing else has to. One
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
| Team colour | Each game card carries a soft gradient or tint of both clubs' primaries. Tints are contrast-checked, never guessed. |
| Type | Heavy weights for scores, regular for labels, tabular figures everywhere. Two or three sizes per screen. Scores huge, everything else quiet. |
| Hierarchy | Per card: score, then status (inning, Final), then team names. Stats only on tap. |
| Density | Low on lists, rich on detail. Box score and plays sit one level down, never on the scoreboard. |
| Chrome | A league chip row, favourites pinned first, a floating bottom bar. Nothing else. |
| Materials | Glass: translucent, blurred bars and segment pickers floating over content, compacting on scroll. |
| Motion | Springs, not ease curves. Scores roll digit by digit. Cards expand into their detail view rather than cutting to a new page. |
| Live state | A small pulsing dot, the inning, and `BaseDiamond` with outs as one compact glyph. |

### Web translation

- **Font:** SF Pro's licence forbids self-hosting on the web. Stack `-apple-system` first so Apple
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
- **Apple TV's MLS and Friday Night Baseball score bugs**: team colour first, broadcast form.

### Other sports apps in a modern style

- **FotMob**: dense match data kept calm; good for how a deep Game Center stays readable.
- **Sofascore**: live momentum graphs and player ratings, a reference for `winProbChart`.
- **The Athletic**: editorial type and story-led game pages, for recaps and Reading.
- **F1 TV and the F1 app**: live timing and team-colour systems across ten teams.
- **Strava**: activity cards and the stat-forward detail view.

### Non-sports apps with the same feel

- **Apple Weather**: gradient backgrounds driven by data, and modular cards of differing sizes.
- **Apple Fitness and Activity**: big numerals, rings, celebratory motion for milestones.
- **Robinhood**: one hero number and one chart per screen, with scrubbing.
- **Linear**: restraint, dark surfaces, precise type, fast motion.
- **Things 3**: whitespace, springy interactions, nothing extra.
- **Arc and Arc Search**: playful motion and colour on a calm base.
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

- **Variables first, mirroring code.** Colour roles (canvas, raised, text primary, secondary,
  tertiary, separator, accent, live) in Dark and Light modes; spacing; radius; type sizes. Name them
  as the CSS variables will be named, so handoff is a copy.
- **Team colour as a variable collection**, one mode per club (WPBL's six, then MLB's 30), so one
  card component previews every club.
- **Frames:** phone 375 wide, desktop at the desktop scale (`--app-chrome`). Design both; the
  desktop side panel is its own case (`usePhoneLayout()`).
- **Long names in every mock.** Use the longest real names on the roster so the "F. Last" stages
  (`nameStages`) get designed, not discovered.
- **States per component:** loading (the loaded layout drawn empty), live, final, postponed, empty.

---

## Phases

### 1. Direction (Figma only)

- [ ] Mood board from the references above.
- [ ] Token variables in Figma, both themes.
- [ ] Mock four screens, phone and desktop: WPBL scoreboard, Game Center, player page, standings.
- [ ] Decide the open questions below.

### 2. Tokens and type, still on MUI

- [ ] Token layer as CSS variables in `styles.css`, wired into `createAppTheme` in `ThemeContext.tsx`.
- [ ] New type ramp on the existing `--app-type` scale; Inter Display subset; tabular figures.
- [ ] Move hard-coded `sx` colours and spacing onto tokens (lint rule to stop new ones).
- [ ] Re-measure name fits after the font change (`npm run sweep -- --ellipsis`).

### 3. House components in `src/ui/`

- [ ] `ScoreCard` (team tint, live glyph, score roll), `Stat`, `StatLine`, `TeamChip`,
      `DataTable`, `Section`, glass `BottomNav`.
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

- **Borderless cards against the 3:1 outline rule** (`src/CLAUDE.md`). Does fill contrast count as
  the boundary, and at what ratio?
- **Two-club gradients and text contrast.** Pick a tint recipe that passes axe on every pairing,
  or fall back to a neutral card with colour only in the edges.
- **Light mode.** A true equal, or a faithful translation of dark?
- **Glass on low-end Android.** `backdrop-filter` costs; measure it on a mid-range phone before
  committing.

## Risks

- Every phase churns the sweep's shift baselines and axe results; re-record per phase.
- Name fits depend on font metrics; a new face means re-testing `nameStages` everywhere.
- The desktop scale (`chromePx`, `typePx`) must survive whatever replaces `sx`.
