# WPBL headshot sources

One file per player, `<slug>.webp`, named by the slug of the player's roster name: the photo as it
came in, cut out of its studio white. These are not bundled. The 512s the site draws are built from
them into `src/wpbl/portraits/`:

1. Drop the photo here (the largest the league or club publishes; square is not required).
2. `python scripts/cut-out-wpbl-portraits.py <slug>` if it still has its white background.
3. `python scripts/frame-wpbl-portraits.py --sheet sheet.png`, then look at the sheet. A face box
   that missed goes in `manifest.json` as `box_set` (`[center x, center y, width]`, fractions of
   the source), and the kit in the photo as `kit`.
4. Update `KNOWN_ISSUES` in `src/wpbl/__tests__/portraitFraming.test.ts` to what the script printed.

Until Nov 5, 2026 the bundled 512s were the only copy, so the first sources here are those files.
A better photo of a player replaces their file here; the list of the ones worth replacing first is
`KNOWN_ISSUES`, and ROADMAP-UI.md "Player portraits" has the plan.
