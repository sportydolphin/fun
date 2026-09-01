# The WPBL inaugural season, in files

`wpbl-2026/` is the public record of the Women's Pro Baseball League's first season: one JSON
file per table, plain arrays of rows, keys sorted, plus a `manifest.json` with row counts and a
digest of each file.

Written by [`scripts/export-wpbl-archive.ts`](../scripts/export-wpbl-archive.ts) and refreshed
weekly by the `wpbl-archive` workflow, which commits only when the data actually moved.

```bash
npm run archive
```

```bash
npm run archive -- --check
```

## Why it is in git

Until **Sep 22, 2026** these tables were a cache. Every row could be re-fetched from
`stats.womensprobaseballleague.com`, so losing the database would have cost a re-ingest and
nothing else. When the feed goes quiet there is nothing left to re-ingest from, and the same
tables become the only copy of the season we control: a dropped table or a lapsed project after
that date is unrecoverable, and the day it happens looks like any other day.

Git is the store because it is versioned, already mirrored to GitHub, keeps every past export
reachable, and shows in a diff exactly what moved between two runs.

## What it is not

**It is not a database backup.** It is read through the anonymous key, so it contains exactly
what the website already serves in public and cannot contain anything else. Auth, analytics
(`events`), feedback, push subscriptions and the Discord prediction game are all outside it and
are protected by nothing here. Project-level backups and point-in-time recovery are a Supabase
dashboard setting and a separate decision.

That constraint is deliberate rather than a limitation to work around. These files live in a
repository, so the one thing the export must never do is pick up a row that was not already
public, and reading as the anonymous client means RLS decides that, using the same policies
that decide what the site serves.

## What is in it

The four tables that ARE the season are `wpbl_games`, `wpbl_batting_lines`,
`wpbl_pitching_lines` and `wpbl_game_plays`. With those, every leaderboard, record,
run-expectancy table and win-probability graph on the site can be rebuilt from scratch in any
year, which is why the archive is a set of rows rather than a set of computed standings: a
derived number preserves one reading of the season, the rows preserve all of them.

Beside them: the rosters and clubs, fielding lines, the one batch of TrackMan pitch tracking the
league ever published, our own play corrections, the trade log (the only record of which club a
player was on for a given GAME rather than today), and the links to videos, articles and photos
published elsewhere. The script's header says what is left out and why, table by table.

## Restoring from it

Every file is a plain JSON array of row objects with the database's own column names, so any
client can insert them; there is no custom format to reverse. `--check` re-reads each table from
the live database and compares it against both the file on disk and the digest in the manifest,
which is what makes the copy verifiable rather than assumed.

`--check` reporting `STALE` while the season is running is normal: it means the database has
moved on since the last export, not that anything is wrong. `ALTERED` or `CORRUPT` mean the file
itself no longer matches what was written, which is the case worth acting on.
