# TrackMan: where the rest of the season's tracking data is, and how to get it

**Status, Sep 5, 2026: we hold 766 tracked rows across 2 of 25 finals, and there is no
second public copy of the rest anywhere on the internet.** That is a search result, not a
guess, and this file is what makes it re-checkable instead of something the next person
re-derives from scratch. Run [`npm run probe-tracking`](../scripts/probe-wpbl-tracking.mjs)
to re-ask every question below in one pass.

**The data exists.** The league keeps publishing graphics built on radar numbers, all 2026
games are played at one venue (Robin Roberts Stadium, Springfield IL), so there is one
install, one account, and a complete season sitting inside it. Nothing about this is a
capture problem on their side. It is a publishing decision, and that is what makes the
non-technical route at the bottom of this file the highest-probability one, rather than a
consolation prize.

## What closed, and exactly when

| | Before Sep 1, 2026 | Now |
| --- | --- | --- |
| `/v1/games/{id}/activity` | open, paginated, the uncapped source | `401 missing api key` |
| `/v1/games/{id}/pitches` | open | `401 missing api key` |
| boxscore `tracking_activity` | up to 200 embedded events per game | empty, even for the two games that HAVE tracking |
| `stats.womensprobaseballleague.com` root | public | behind a login |
| `/v1/games`, `/v1/games/{id}/boxscore` | open | still open, which is everything the ingest needs |

The 766 rows we hold survive only because `ingestBoxscore` guards the tracking write with
`if (tracking.length)`. An empty fetch writes nothing rather than deleting, unlike
`syncGameRows`, which clears a game's rows when the feed sends none. Do not tidy that
asymmetry: the day it is tidied is the day the gate deletes our only copy.

## What the search actually turned up

Every claim here is a search result as of Sep 5, 2026, and every one of them is negative.
They are recorded because a negative that took an hour to establish is worth exactly as much
as a positive the next time somebody asks.

- **No third party has more than we do.** [wpblscores.com/tracking](https://wpblscores.com/tracking/)
  publishes a ball-tracking leaderboard whose season numbers are *empty*: it renders "no
  tracked measurements yet" and says the values appear once tracking is live for a game. It is
  a rival aggregator hitting the same feed, and it did not even catch the August batch. The
  other two public WPBL sites ([wpblstats.com](https://wpblstats.com/),
  [backstopwpbl.com](https://backstopwpbl.com/stats/)) carry conventional box-score stats and
  no radar at all. **We are, as far as the public web goes, the only holder of WPBL TrackMan
  data.**
- **No public dataset, scraper or mirror exists.** No GitHub project, Kaggle dataset or
  archive of the WPBL feed is indexed anywhere. Searches for a WPBL scraper return MLB
  Statcast tooling and nothing else.
- **No TrackMan partnership was ever announced.** TrackMan publicised 2026 deals with the CAA,
  the Prospect League, D1Baseball and the WBSC. There is no WPBL announcement, so there is no
  partner-side portal or press page to read, and no public leaderboard of the kind TrackMan
  runs for some partner leagues.
- **The broadcast is ESPN's.** ESPN holds the media rights (37 games, ESPN Select in the US,
  YouTube internationally, 11 simulcast on Scripps). ESPN publishes no scoreboard, gamecast or
  box score for the WPBL, so the usual undocumented-but-open `site.api.espn.com` route has
  nothing behind it for this league. Worth one re-check if ESPN ever adds a WPBL scoreboard
  page, because that API is public and pitch-level for the sports it does carry.
- **A player portal exists** at `playerportal.womensprobaseballleague.com`. Players plausibly
  see their own tracking there. It is account-gated, it is not ours, and it stays off the
  table. It is listed here so nobody spends an afternoon rediscovering it.

## The routes, ranked

**1. Ask the league.** Highest probability by a distance, and the only one that yields the
whole season rather than fragments. The gate went up on Sep 1 with the site login, which reads
like a platform change rather than a decision about us specifically, and the request costs one
email. Draft below.

**2. Archived JSON.** The endpoints were open and public for a month. An archived response
needs nobody's permission to read, and a pre-Sep-1 boxscore snapshot carries up to 200 embedded
events for whatever game it caught. That is short of a full game (roughly 380) but it is 200
more than we have for any third game. `probe-tracking` queries the Wayback CDX index and the
Common Crawl index for the whole host and fetches anything that looks like tracking. Low odds
that a crawler happened to walk a JSON API, worth the two requests to find out.

**3. The league's own public client.** If the explorer page still serves anonymously and its
bundle carries the key it uses, that key is public by construction and we are an intended
reader. `probe-tracking` reads the bundles and reports which endpoints and which auth mechanism
they name. If they name a login session, that is a real answer: the door is not merely locked,
the public page that opens it is gone, and route 1 is the only way through.

**4. Broadcast OCR.** The one route that needs nobody's cooperation. We already hold YouTube
ids for 20 of 25 finals. If the broadcast scorebug prints pitch velocity, velocity is
reconstructable per pitch by OCR against the play log we already have, which is keyed on
`(game_id, sequence)` and would line up. It recovers velocity only: no spin, no extension, no
break, no exit velocity except where a graphic happens to show one. It is real work and it
carries a rights question about the video, so it is a project rather than an afternoon. Cost
it honestly before starting, and note that it produces DERIVED numbers that must never be
written into `wpbl_pitch_tracking` beside league-published ones without a column saying which
is which.

**5. Wait.** `wpbl-tracking-watch` runs daily, year-round, and notices the day anything lands
in our mirror. It costs one query a day and it is already running. It is not evidence of
anything while it stays quiet, because it reads our own tables and the endpoints that fill
them are gated: silence means the gate, not the league's radar.

## What is off the table

- Guessing, brute-forcing or reusing an API key. `probe-tracking` sends anonymous requests and
  the same requests the league's own public page sends, and nothing else.
- Logging in to the player portal, or to the stats site, with anyone's credentials.
- Republishing another site's numbers as ours.

## The email to send

To the league's media or stats contact, or whoever answers press mail. Short, specific, and it
names what we do with the data, because a league that has just put a login on its stats site is
being asked to make an exception and deserves to know for what.

> Subject: WPBL stats API: read access to the pitch tracking endpoints
>
> Hello,
>
> I run sportydolphin.fun/wpbl, an independent WPBL stats site that has mirrored the league's
> public feed since opening day: schedule, standings, box scores, play-by-play, and a
> pitch-by-pitch board built from the feed's own pitch sequences. It is free, it has no ads, and
> it credits the league as the source throughout.
>
> Until Sep 1 the feed's `/v1/games/{id}/activity` endpoint was open, and I captured tracking
> for the Aug 1 and Aug 2 games (766 pitches). It now answers `401 missing api key`, and the box
> score's embedded `tracking_activity` returns empty, so the rest of the season's tracking is
> not reachable. I assume this came with the stats site's new login rather than being aimed at
> anyone in particular.
>
> Could I get a read-only API key for those endpoints, or a one-off export of the season's
> tracking data? I am happy to agree to any attribution, rate limit or caching terms you want,
> and to hold anything you would rather not have public.
>
> Thank you for the season. It has been a great one to cover.

If the answer is no, that is a complete answer: record it here with the date and stop probing.
A "no" is worth more than an open question, because it ends the recurring cost of re-asking.
