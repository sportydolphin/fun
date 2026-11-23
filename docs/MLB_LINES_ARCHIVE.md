# MLB lines archive

Closed MLB seasons' box-score lines live on R2, not in Postgres. Since Nov 8, 2026.

| Piece | File |
|---|---|
| Which seasons are frozen, and where they are | [`shared/mlbLinesArchive.js`](../shared/mlbLinesArchive.js) |
| The freezer | [`scripts/freeze-mlb-lines.mjs`](../scripts/freeze-mlb-lines.mjs), `npm run freeze-mlb-lines` |
| The browser's read | `fetchMlbSeasonLines` in [`src/mlb/seasonLines.ts`](../src/mlb/seasonLines.ts) |
| The nightly mirror's guard | [`scripts/sync-mlb-lines.mjs`](../scripts/sync-mlb-lines.mjs) |
| Tests | [`src/mlb/__tests__/mlbLinesArchive.test.ts`](../src/mlb/__tests__/mlbLinesArchive.test.ts) |

## Why

`mlb_batting_lines` and `mlb_pitching_lines` were 250 MB of a 407 MB database, about 9 MB a
season for 27 seasons, and a season never changes after its postseason. The Bests and Find
boards already read a season as one packed row of the `mlb_season_lines` view, so the archive is
that row, frozen: `photos.sportydolphin.fun/mlb/lines/v1/<season>.json`, about 3.7 MB and 0.7 MB
compressed. The boards load it from Cloudflare instead of Supabase, backups shrink, and the MLB
plays mirror does not share the disk with old lines.

`mlb_games` and `mlb_players` stay in Postgres (about 10 MB). The mirror decides what is new by
the games it holds, and the view lists every season from them.

## Freezing a season

Once a season's postseason is over:

1. `npm run freeze-mlb-lines -- --season <year>` uploads the file and reads it back through the
   public domain, comparing every count with the database. It deletes nothing.
2. Raise `MLB_LINES_FROZEN_THROUGH` and ship it. From then on the boards read the file.
3. `npm run freeze-mlb-lines -- --season <year> --delete --vacuum` deletes the season's lines,
   then runs `VACUUM FULL` to hand the space back. It refuses unless the season is at or below
   the shipped constant, the public copy matches, and the domain sends CORS for the site.

Each step is safe to run again. A late scorer's change to a frozen season: unfreeze it (below),
then freeze it again. The files are cached for a day.

## Undoing it

`node --env-file=.env scripts/sync-mlb-lines.mjs --season <year> --all --unfreeze` reads the
season's box scores back into Postgres (about two hours a season), then lower the constant.
Without `--unfreeze` the mirror skips a frozen season, since a pass would write its lines back
where no board reads them.

## CORS

The photo bucket (`sportydolphin-wpbl-photos`) allows GET from `https://sportydolphin.fun`,
`http://localhost:5173`, `https://fun-ege.pages.dev` and `https://*.fun-ege.pages.dev`, so
production, `npm run dev` and PR previews all read the files (set Nov 8, 2026). `wrangler r2
bucket cors set` replaces every rule at once, so list them first and keep the others. The R2 keys
in `.env` cannot change CORS; it needs `wrangler login`. The layout sweep does not need CORS: it
replays the file from its fixture.

## Result

Nov 8, 2026: every season from 2000 to 2026 frozen, the line tables emptied, and the database
from 407 MB to 157 MB.
