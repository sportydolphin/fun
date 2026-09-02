import React from 'react'
import { Box, Typography } from '@mui/material'
import { WPBL_ACCENT } from './constants'

// A plain-language reference for the WPBL's public stats feed: where it lives, what each
// endpoint returns, and the things worth knowing before you pull from it. Written up as
// findings for other developers, not as a how-to for cloning this site. This is the same
// feed this site reads from (see supabase/functions/wpbl-ingest), but it does not touch or
// expose this site's own database. Linked from the WPBL footer and reachable at /wpbl/api.

const FEED = 'https://stats.womensprobaseballleague.com/v1'

// ─── Small presentational primitives ────────────────────────────────────────────

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0, mt: 1, mb: 0.5, p: 1.5, borderRadius: 2,
        bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
        border: '1px solid', borderColor: 'divider',
        overflowX: 'auto', fontSize: '0.78rem', lineHeight: 1.6,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        color: 'text.primary', whiteSpace: 'pre',
      }}
    >
      {children}
    </Box>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <Box component="code" sx={{
      px: 0.5, py: 0.15, borderRadius: 0.75, fontSize: '0.85em',
      bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    }}>
      {children}
    </Box>
  )
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <Typography component="h2" sx={{ fontSize: '1.1rem', fontWeight: 800, mt: 4, mb: 1, letterSpacing: '-0.2px' }}>
      {children}
    </Typography>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <Typography sx={{ fontSize: '0.92rem', lineHeight: 1.65, color: 'text.secondary', mb: 1.25 }}>{children}</Typography>
}

// One documented endpoint: method + path + what it returns.
function EndpointCard({ path, purpose, returns }: { path: string; purpose: string; returns: string }) {
  return (
    <Box sx={{ mb: 1.25, p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
        <Box component="span" sx={{ fontSize: '0.68rem', fontWeight: 800, color: '#16a34a', letterSpacing: 0.5 }}>GET</Box>
        <Box component="span" sx={{ fontSize: '0.88rem', fontWeight: 700, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', color: 'var(--wpbl-accent-fg)', wordBreak: 'break-all' }}>
          {path}
        </Box>
      </Box>
      <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', mt: 0.4, lineHeight: 1.5 }}>{purpose}</Typography>
      <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.disabled', mt: 1, mb: 0.5 }}>Returns</Typography>
      {/* Pre-formatted so the shape reads top-to-bottom instead of wrapping into a wall;
          horizontal scroll keeps a wide line from breaking the layout on narrow screens. */}
      <Box
        component="pre"
        sx={{
          m: 0, p: 1.25, borderRadius: 1.5,
          bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
          border: '1px solid', borderColor: 'divider',
          overflowX: 'auto', fontSize: '0.72rem', lineHeight: 1.6,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          color: 'text.secondary', whiteSpace: 'pre',
        }}
      >
        {returns}
      </Box>
    </Box>
  )
}

// One gotcha worth knowing before you build.
function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 1.25 }}>
      <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, mb: 0.2 }}>{title}</Typography>
      <Typography sx={{ fontSize: '0.88rem', color: 'text.secondary', lineHeight: 1.6 }}>{children}</Typography>
    </Box>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────────

export default function WpblApiDocs() {
  return (
    <Box sx={{ maxWidth: '47.5rem', mx: 'auto', px: { xs: 2, sm: 3 }, pb: 6 }}>
      <Typography component="h1" sx={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.4px', mb: 0.5 }}>
        Getting WPBL data
      </Typography>
      <Typography sx={{ fontSize: '0.95rem', color: 'text.secondary', lineHeight: 1.6, mb: 1 }}>
        The Women's Pro Baseball League publishes a free public JSON feed with the schedule, box
        scores, play-by-play, rosters, standings and leaderboards. This is a reference for reading
        it: where it lives, what comes back, and the things I learned along the way. Pitch tracking
        used to be in that list and closed on Sep 1, 2026; the endpoint is still documented below,
        with what it now answers.
      </Typography>
      <Box sx={{ p: 1.5, borderRadius: 2, border: '1px dashed', borderColor: 'divider', bgcolor: 'action.hover', mb: 1 }}>
        <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', lineHeight: 1.55 }}>
          This is a fan project and is not affiliated with or endorsed by the WPBL. The feed is the
          league's, not ours, so treat it as theirs: it can change or go away at any time, and there
          is no guarantee of uptime or accuracy. This guide points at the public feed only. It does
          not expose this site's database.
        </Typography>
      </Box>

      <H2>The feed</H2>
      <P>
        Everything lives under one base URL. Requests are plain HTTP GET and come back as JSON.
        No key and no signup for anything on this page, with one exception noted below: the
        pitch-tracking endpoints started asking for an API key on Sep 1, 2026.
      </P>
      <CodeBlock>{FEED}</CodeBlock>

      <H2>Endpoints</H2>
      <EndpointCard
        path="/games"
        purpose="The whole schedule with results. Each game carries its id, teams, venue, start time, status, and score."
        returns={`{
  "games": [
    {
      "game_id", "season_id", "scheduled_start",
      "home_team_id", "away_team_id", "venue",
      "status", "completed_at",
      "presto_data": { "score": { "home", "away" } }
    }
  ]
}`}
      />
      <EndpointCard
        path="/games/{id}/boxscore"
        purpose="One game in full: status, per-side totals, the line score, every player's hitting/pitching/fielding line, and the play-by-play."
        returns={`{
  "boxscore": {
    "status",
    "teams": [
      {
        "side", "totals", "line",
        "players": [ { "hitting", "pitching", "fielding" } ]
      }
    ],
    "plays": [ ... ]
  }
}`}
      />
      <EndpointCard
        path="/games/{id}/activity"
        purpose="TrackMan tracking for a game. NEEDS AN API KEY as of Sep 1, 2026: it answers 401 “missing api key” to an ordinary request. Listed because it is what the tracking fields below came from, not because you can read it."
        returns={`401 missing api key`}
      />

      <EndpointCard
        path="/teams"
        purpose="The four clubs, with their ids. You need a team_id for the two routes below."
        returns={`{ "count", "teams": [ { "team_id", "name", ... } ] }`}
      />
      <EndpointCard
        path="/teams/{id}/players"
        purpose="A club's roster. The only place the feed publishes biographical detail: birth date, hometown, height, weight, headshot, uniform number, position, and whether she is a listed starter."
        returns={`{
  "count",
  "players": [
    {
      "player_id", "first_name", "last_name",
      "dob", "hometown", "height", "weight",
      "position", "uniform", "headshot_url",
      "is_active", "is_starter", "player_status"
    }
  ]
}`}
      />
      <EndpointCard
        path="/teams/{id}/stats?season_id={season_id}"
        purpose="A club's season totals, computed by the league: a standings block plus batting, pitching and fielding. season_id is REQUIRED and comes off any game in /games; without it the response is 400."
        returns={`{
  "calculation_version", "source_through",
  "aggregation": "roster_player_sums",
  "standing": { "rank", "wins", "losses",
    "games_behind", "runs_for", "runs_against",
    "home", "away", "last_ten", "streak" },
  "batting": { ... }, "pitching": { ... },
  "fielding": { ... }
}`}
      />
      <EndpointCard
        path="/seasons/{season_id}/standings"
        purpose="The league's own standings table, the same shape as the standing block above, ranked. Carries a source_through stamp saying how current the numbers are."
        returns={`{
  "scope", "provisional", "tie_policy",
  "calculation_version", "source_through",
  "count", "standings": [ { "rank", ... } ]
}`}
      />
      <EndpointCard
        path="/seasons/{season_id}/leaders?stat={stat}"
        purpose="A single leaderboard. stat takes home_runs, batting_average, rbi, hits, era, strikeouts, wins, stolen_bases or saves; ops, whip and innings_pitched are not offered and return 400. Optional limit and qualification."
        returns={`{
  "stat", "direction", "qualification",
  "count",
  "leaders": [
    { "rank", "player_id", "player_name",
      "team_ids", "value", "games_played" }
  ]
}`}
      />
      <EndpointCard
        path="/players/{id}"
        purpose="One player. There is no way to LIST players: /players answers 404, so you reach a player through a club's roster or through a box score."
        returns={`{ "player_id", "first_name", "last_name", ... }`}
      />

      <H2>Try it</H2>
      <P>List every game:</P>
      <CodeBlock>{`curl "${FEED}/games"`}</CodeBlock>
      <P>Take a <Code>game_id</Code> from that response and pull its box score:</P>
      <CodeBlock>{`curl "${FEED}/games/<GAME_ID>/boxscore"`}</CodeBlock>
      <P>
        Those two are open. The tracking endpoint below is not, so there is no third command
        here to give you.
      </P>

      <H2>Things worth knowing</H2>
      <Note title="Start times read one hour early">
        For the 2026 season, <Code>scheduled_start</Code> comes back one hour before the real first
        pitch. A 6:30 PM Central game shows as 5:30. Add an hour to get the true start. The whole
        2026 season is on Central time with no daylight-saving change, so a flat one-hour shift is
        exact. Check this yourself if you read this in a later season.
      </Note>
      <Note title="Pitch tracking closed on Sep 1, 2026">
        This page used to tell you to page <Code>/games/{'{id}'}/activity</Code> for full TrackMan
        tracking, because the box score's own <Code>tracking_activity</Code> array is capped at 200
        events and a game has closer to 380. That is no longer readable: the endpoint answers
        <Code>401 missing api key</Code>, so does <Code>/games/{'{id}'}/pitches</Code>, and the box
        score's embedded array now comes back EMPTY even for the two games that have tracking. The
        stats site's own root went behind a login the same day. Games, teams and box scores are
        still open, which is everything else on this page.
      </Note>
      <Note title="Tracking only ever covered two games anyway">
        TrackMan tracking (pitch velocity, spin, hit distance) was published for the first two games
        of the season and then stopped, so the endpoint above closed over data that had not grown
        since Aug 2. Treat a game with no tracking as the normal case, not an error, and don't count
        on pitch or hit data for any of the schedule.
      </Note>
      <Note title="Team stats are summed over the CURRENT roster">
        <Code>/teams/{'{id}'}/stats</Code> reports <Code>aggregation: "roster_player_sums"</Code>,
        and it means what it says: the club's season totals are the sum of whoever is on its
        roster today. A player who changed clubs mid-season therefore brings her whole season with
        her, counted for the club she is on now and missing from the one she played those games
        for. The league mints a new <Code>player_id</Code> on a move, so this is easy to miss. If
        you need a club's real season, sum the box-score lines instead: each line carries the
        team she played that game for. The standings block is unaffected, being counted from
        results rather than from players.
      </Note>
      <Note title="The qualified leaderboards are empty, and that is arithmetic">
        <Code>/seasons/{'{id}'}/leaders</Code> accepts{' '}
        <Code>qualification=qualified</Code>, which resolves to{' '}
        <Code>mlb_3.1_plate_appearances_per_team_game</Code>. That is MLB's bar, and MLB plays
        nine innings. In a seven-inning league nobody clears it: as of Sep 1, 2026 the qualified
        batting-average board returns <Code>count: 0</Code>. Either read the unqualified board and
        apply your own minimum, or scale the bar the way the league's own innings do.
      </Note>
      <Note title="Watch for phantom duplicate games">
        The schedule sometimes lists a stale, never-played copy of a game next to the real one: same
        date and matchup, different <Code>game_id</Code>, stuck on a not-started status. If you see
        two games for one matchup, keep the played copy and drop the unplayed one.
      </Note>
      <Note title="Trust status.complete for finals">
        A game's list status can flip to an in-progress string around twenty minutes before first
        pitch, with no plays and a 0-0 score. The box score's <Code>status.complete</Code> is the
        reliable signal that a game is actually over. For live vs scheduled, look for real activity
        (a logged play, any ball or strike or out, a run) rather than the status text alone.
      </Note>

      <H2>Calling it from a browser</H2>
      <P>
        Read it from a server, a script, or a serverless function. A direct <Code>fetch</Code> from a
        web page can trip CORS, so from a browser, route the request through your own backend.
      </P>

      <H2>Questions</H2>
      <P>
        Pulling from the feed and something here doesn't match what you see, or something has changed?
        Use the Send feedback link in the site footer.
      </P>
    </Box>
  )
}
