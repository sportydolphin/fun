import React from 'react'
import { Box, Typography } from '@mui/material'
import { useWpblAccent } from './accent'

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
  const accent = useWpblAccent()
  return (
    <Box sx={{ mb: 1.25, p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
        <Box component="span" sx={{ fontSize: '0.68rem', fontWeight: 800, color: '#16a34a', letterSpacing: 0.5 }}>GET</Box>
        <Box component="span" sx={{ fontSize: '0.88rem', fontWeight: 700, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', color: accent, wordBreak: 'break-all' }}>
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
    <Box sx={{ maxWidth: 760, mx: 'auto', px: { xs: 2, sm: 3 }, pb: 6 }}>
      <Typography component="h1" sx={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.4px', mb: 0.5 }}>
        Getting WPBL data
      </Typography>
      <Typography sx={{ fontSize: '0.95rem', color: 'text.secondary', lineHeight: 1.6, mb: 1 }}>
        The Women's Pro Baseball League publishes a free public JSON feed with the schedule, box
        scores, play-by-play, and TrackMan pitch tracking. This is a reference for reading it: where
        it lives, what comes back, and the things I learned along the way.
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
      <P>Everything lives under one base URL. There is no key and no signup. Requests are plain HTTP GET and come back as JSON.</P>
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
        purpose="TrackMan tracking for a game (pitch velocity, spin, and hit distance). Paginated with limit and offset."
        returns={`{
  "activity": [
    {
      "activity_id", "kind", "release_speed",
      "spin_rate_rpm", "plate_location_height", ...
    }
  ]
}`}
      />

      <H2>Try it</H2>
      <P>List every game:</P>
      <CodeBlock>{`curl "${FEED}/games"`}</CodeBlock>
      <P>Take a <Code>game_id</Code> from that response and pull its box score:</P>
      <CodeBlock>{`curl "${FEED}/games/<GAME_ID>/boxscore"`}</CodeBlock>
      <P>Page through its pitch tracking, 1000 events at a time:</P>
      <CodeBlock>{`curl "${FEED}/games/<GAME_ID>/activity?limit=1000&offset=0"`}</CodeBlock>

      <H2>Things worth knowing</H2>
      <Note title="Start times read one hour early">
        For the 2026 season, <Code>scheduled_start</Code> comes back one hour before the real first
        pitch. A 6:30 PM Central game shows as 5:30. Add an hour to get the true start. The whole
        2026 season is on Central time with no daylight-saving change, so a flat one-hour shift is
        exact. Check this yourself if you read this in a later season.
      </Note>
      <Note title="Use /activity for full tracking, not the box score">
        The box score also embeds a <Code>tracking_activity</Code> array, but the server caps it at
        200 events and a full game has closer to 380. The <Code>/games/{'{id}'}/activity</Code>
        endpoint is the uncapped, paginated source, and it adds hit distance the box score copy
        leaves out. Read from there and page until a request returns fewer rows than your limit.
      </Note>
      <Note title="Tracking data is very limited so far">
        As of this writing, TrackMan tracking (pitch velocity, spin, hit distance) exists for only the
        first two games of the season, and it is unclear whether any more is coming. Later games may
        never get it. Treat a game with no tracking as the normal case, not an error, and don't count
        on the pitch/hit data being there for most of the schedule.
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
