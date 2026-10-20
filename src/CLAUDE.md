# UI rules for both sections

Loaded when you read anything under `src/`. The section-specific traps are in `src/wpbl/CLAUDE.md`.

- **Loading states: every one is the loaded page drawn empty, so nothing moves when content
  lands.** That covers index.html's static toolbar, each tab's skeleton, and any card's own
  loading branch. Each must take exactly the box its content will: the same title in the same
  place (a title needs no data, so draw the real words), the same padding, badge sizes and row
  heights. Build them from the components the loaded view uses (`TabTitle`, `SectionLabel`,
  `radarBox`), not from hand-picked numbers. A one-line "Loading." in a card that will hold a
  chart is a jump. Where the shape depends on data nothing has yet, reserve the most likely
  shape; the calendar alone can tell the offseason (`offseasonByCalendar`). **Measure it; don't
  judge it by eye.** Load with `?devSlowMount=3000` (the static bar) or `?devSlow=2500` (the
  skeletons; 8s trips the request timeout and shows "No teams yet"), see
  [`src/dev/slowLoad.ts`](dev/slowLoad.ts), and compare element rects against the loaded
  page at 375, 760, 960 and 1440. A hidden browser pane records no layout-shift entries, so
  compare rects rather than trusting CLS. It also fires no `requestAnimationFrame`, even while it
  reports itself visible, so anything scheduled on one (a scroll, a measurement) never happens
  there: check those in Playwright's Chrome, as the sweep does. `npm run sweep -- --shift` does exactly this against the
  dev server ([`scripts/layout-sweep.mjs`](../scripts/layout-sweep.mjs)); `--routes` narrows it.
  **CI runs it on every pull request** (the `layout` check, eight parallel slices, skipped for a pull request that touches no UI) from a recorded
  snapshot of the data, with the clock frozen at the moment it was taken. A query the snapshot
  lacks fails the job and prints the routes to record, so a change to what a page fetches comes with
  `npm run sweep:record -- --merge --routes <those>` (or the "Sweep: record" workflow on the branch)
  and the new files under `scripts/fixtures/layout-sweep/` in the same pull request.
  The accepted-findings baseline is empty: fix a finding, don't baseline it. A failure CI sees and
  your machine doesn't is CI's slower runner catching a real loading phase; reproduce it with
  `--cpu 4` and the job's `sweep-shots` artifact ([docs/CI.md](../docs/CI.md)).

- **Borders: every outline is at least 3:1 against what is behind it, in both themes.** WCAG's
  floor for the edge of a component, and it covers anything bordered on all four sides: a card, a
  chip, a button, a box nested in a card, a club's ring. Three tokens, in
  [`src/ui/card.tsx`](ui/card.tsx): `borderColor: 'outline'` (the theme's `palette.outline`,
  which `CARD_BORDER` and `INNER_BORDER` also return) for a plain box, `edge(colour)` for a club's
  or a status's own colour, which lifts it just far enough, and `ACCENT_EDGE` for the site blue.
  **Never fade a colour with an alpha suffix to make a border** (`${teamColor}55`): fading can only
  lower contrast, and most clubs' primaries are navy or brown, which is how the MLB bracket's
  decided series came out at 1.2:1 on the dark page. `divider` is for the rule BETWEEN rows, one
  side only, and stays lighter on purpose. The layout sweep measures every outline on every page
  and fails the `layout` check under 3:1; exempt are row rules, anything disabled or deliberately
  faded (an eliminated club at 50%), and anything sitting on a photo.

- **Accessibility is checked twice, and both must stay clean.** The lint runs `eslint-plugin-jsx-a11y`:
  a click handler on something that is not a link or a button needs `pressable(fn)` from
  [`src/ui/interaction.ts`](ui/interaction.ts) (role, tab stop, Enter and Space), and a link that
  must also record its open passes the callback to `linkTo(to, onOpen)` rather than adding an
  `onClick` beside the spread. A scrim or an event barrier is not a control and says so in a
  disable comment with the reason. The layout sweep runs axe-core on every page in both themes for
  text contrast and names: an icon-only control needs an `aria-label`, a decorative image `alt=""`.
  **Never fade text with `opacity`** to make something recessive (an eliminated club, a heatmap
  cell): it takes the text under 4.5:1 along with everything else. Use the secondary ink, and fade
  only the logo or the fill (`heatCell` in [`src/lib/contrast.ts`](lib/contrast.ts)).

- **Both sections render at a DESKTOP SCALE in CSS, not under a `zoom`, and there are two scales.**
  Until Aug 31, 2026 the whole app sat inside `zoom: 1.4` at `md`, which split it into two
  pixel units nothing in the type system tells apart and cost five shipped bugs. `/wpbl` came out
  then and `/mlb` in Oct 2026; there is no `zoom` left on the site. The scale is keyed on
  `:root[data-app-scale]`, set per route in App.tsx, and off both sections (`/admin`, `/privacy`)
  everything stays at 1. The two scales, in `styles.css`:
  **`--app-type`** is spent on the root font size, so it moves every `rem` (the type, and the
  boxes that reserve room for type) and it MULTIPLIES with `--sd-text-scale`, the reader's
  Large text setting. **`--app-chrome`** is spent on px that is not type: MUI's whole `spacing`
  scale, `TeamBadge` / `PlayerPortrait`, the toolbar logo, and every structural length via
  `chromePx()` in [`src/ui/scale.ts`](ui/scale.ts). It deliberately EXCLUDES the text scale,
  because a tap target that grows with the reader's text size is a worse tap target.
  `AccessibilityContext` must keep PUBLISHING `--sd-text-scale` rather than setting `font-size`
  itself: an inline style beats the stylesheet, so setting it there gives a Large-text reader the
  MOBILE type size on a desktop. **One number for both sections** (`DESKTOP_SCALE` in App.tsx):
  the shared toolbar rides the root scale, so two values would resize the bar on every section
  switch. It had a `zoom` of its own while `/mlb` was zoomed, and that is gone too. See item 0 in
  [ROADMAP-WPBL.md](../ROADMAP-WPBL.md) and item 7 in [ROADMAP.md](../ROADMAP.md).

- **A fixed px size in either section is one of three things, and only two of them scale.**
  Ordinary CSS has no equivalent of `zoom`, so every length now says what it is. A box **reserving room
  for a string or a number** goes in `rem` (a rank column, a club-name column, the scoreboard
  chip): it must grow with the type or it clips, and this is the one that bites, because a box
  sized in px around a font sized in rem looks perfectly right until someone enlarges the text.
  **Structure** goes through `chromePx()` (rail widths, a dialog's cap, a card's flex basis):
  left raw it silently shrinks 40% against the type inside it, which is how the player dialog
  started wrapping a name onto two lines. **Ornament** stays raw px: hairline borders, the 6px
  live dot, a 4px scrollbar. **Letter spacing** is type, so it is `typePx()` (rem): MUI reads a
  bare `letterSpacing: 0.5` as px, which the old zoom scaled and the ramp does not, and that alone
  re-wrapped headings across `/mlb`; the lint now refuses a px one. MUI's own controls (a `Switch`, a native `select` arrow) are
  fixed px inside and stay that way on both sections. The failure is silent in every direction, and `tsc` sees none of
  it: the only check that works is opening the page and looking for a box whose content is
  wider than it is, at more than one text scale, which `npm run sweep` does at four widths and
  both text sizes. **Anything behind the experiments flag is exempt from that check by
  construction, so it is swept separately**, with `--experiments`, by the `layout experiments`
  slice in CI. That slice names its routes: put a new flagged surface behind the flag and its route goes
  in that list, or it is checked by nothing. The seeding race sat out the whole rebuild for
  exactly this reason and carried four of these bugs into September. As of Sep 14, 2026 the
  flag hides exactly one thing: the steal card on Run value. The win probability chart (v1.48.1), the Run value board (v1.52.0), the bracket and
  the seeding race (v1.59.0) all came out from behind it, and the mobile bottom nav shipped to
  every phone on Sep 14, 2026, so anything still describing those as experimental is stale.

- **`--app-header-h` is the pinned chrome's height, in plain screen pixels,** spent as a sticky
  `top` (`PINNED_CHROME` in [`stats/layout.ts`](wpbl/stats/layout.ts)). Above a phone it is the
  WHOLE of the pinned chrome: both sections' tabs live inside the toolbar
  ([`ToolbarNav.tsx`](ToolbarNav.tsx), fed by [`sectionNav.ts`](sectionNav.ts)), two rows
  of it below 1024px. There was a second variable for WPBL's own pill row until v1.124.0 removed
  that row. Use the **rect**, never `offsetHeight`: it rounds to a whole pixel, and a bar 43.67px
  tall publishing itself as 44 leaves a sub-pixel crack under it that the page scrolls through,
  one device pixel of a stats row at a time. **On a phone it is 0**: the toolbar scrolls away
  there, and the section nav is the fixed BOTTOM bar, which pins nothing at the top. What the
  bottom bar takes is reserved as padding under the page (`BOTTOM_NAV_SPACE` plus the safe-area
  inset), and anything sized to fit the screen has to subtract that itself: the stats table's cap
  did not, and for twelve days its column headers slid behind the control bar at the bottom of the
  page. This has regressed three times, once in each direction, every time by a scale being
  applied at one end of a sum and not the other.

- **Inside the desktop side panel the viewport lies, so layout code asks `usePhoneLayout()`.**
  Since Oct 5, 2026 a WPBL player or game opens on a desktop as `ModalShell`'s `panel`, which
  renders its content under `PANEL_THEME`, a theme with every breakpoint above `xs` out of reach,
  so every `{ xs, sm, md }` in the card resolves to the phone layout in a 525px column. A raw
  `useMediaQuery('(max-width:600px)')` does not go through the theme and still sees the desktop:
  it draws the desktop layout into the panel and overflows it, with no error. Raw queries stay
  right for the DEVICE (touch, hover, swipe). Two more of the same shape: a hook in the component
  that RENDERS the shell runs outside the provider and has to be told (`wide = mdUp && !panel` in
  `PlayerDetail`), and the panel's z-index is not a constant (it rises above whatever is open each
  time it opens or swaps, so a tooltip portalled out of it reads `useShellZ()`). A swap REPLACES
  the history entry. A game's or a player's full page is the same URL as its panel; which one
  renders is `gamePage` / `playerPage` on WpblApp's history snapshot, never the address. And
  whether a click swaps or stacks depends on WHERE it came from, not what it opens: a row on the
  page swaps the panel, a link inside a card stacks, so a card's links must go through the card's
  own opener (`openPlayerFromGame`, `openGameFromPlayer`, `fromCard` in App.tsx) or Back stops
  returning to the card. See #9 in ROADMAP-WPBL.md.

- **A cancellable touch listener over scrolling content makes the scroll wait for JavaScript.**
  A `touchmove` listener with `passive: false` forces the browser to ask the page before it
  scrolls anything under it, so on a busy page the content trails the finger, and nothing errors.
  The player sheet felt like this until Oct 7, 2026 with two such listeners (the sheet's
  drag-to-dismiss and the role pager), while Home felt fine. In [`ModalShell.tsx`](ui/ModalShell.tsx)
  the drag logic is passive and its one cancelling listener (`claimer`) is attached only while every
  scroller in the sheet is at its top; the pager in [`SwipeableViews.tsx`](ui/SwipeableViews.tsx)
  is passive in pane mode, where each pane's `touch-action: pan-y` does the job `preventDefault`
  did, and attaches nothing at all for a single pane. Do not add a `passive: false` touch listener
  inside a sheet. Headless Chrome cannot show this (no display, so no real input latency); measure on
  a phone: `adb` is in `~/.bubblewrap/android_sdk/platform-tools`, `adb reverse tcp:4173 tcp:4173`
  with `vite preview --host 127.0.0.1` (preview binds IPv6 only by default, which `adb` cannot reach).

- **A page open across a deploy is on a build that no longer exists, and
  [`lib/staleBuild.ts`](lib/staleBuild.ts) is what carries it over.** Cloudflare serves only
  the current `/assets/`, so the old page's next lazy chunk 404s; until Sep 26, 2026 that
  blanked the whole app. Now the page re-reads `index.html` when the tab comes back and, if the
  entry script changed, **patches `history.pushState`** so the next in-app navigation is a full
  load. If you are ever debugging a pushState that reloads the page, that is why. A chunk that
  fails anyway reloads once (`vite:preloadError`, 10s loop guard), and `AppErrorBoundary` catches
  the rest at three layers (app, page area, each WPBL tab), reporting `app_error` / `app_updated`
  to `/admin` under "Site health". **Cancelling `vite:preloadError` does not cancel the failure:**
  Vite then resolves the import with `undefined`, and `lazy()` throws on `.default` in the second
  before the reload lands. Every reader crash of Oct 13 to 15, 2026 was this; the boundary asks
  `reloadUnderway()` and shows "Loading the latest version" instead of reporting it.

- **Internal links must be real `<a href>`, never a `Box` with only an `onClick`.** Googlebot
  does not fire click handlers, so an onClick-only control is invisible to it. `/mlb` sat
  undiscovered by Google for months for exactly this reason while `/privacy` and `/terms`,
  which the footer links properly, were found. Use `linkTo()` in
  [`src/App.tsx`](App.tsx), which supplies the href and preventDefaults so the SPA still
  handles the navigation, and lets modified clicks through so open-in-new-tab works.
