// /wpbl/players: every player in the league, grouped by club, each one a real link.
//
// This page exists for a reason that is not obvious from looking at it: without it the 118
// player pages have almost nothing pointing at them. A crawler reaches a player only by
// following a link, and in the app a player is opened from a stat-leader row or a team
// roster, both of which sit behind a tab and a team selection. That is a long way in from
// /wpbl, and the leader boards only ever name the top five. One flat page of anchors puts
// every player exactly one hop from a page Google already has.
//
// It reads well enough as a page in its own right (it is the roster nobody had a single view
// of), but the crawl path is the point, so the markup stays deliberately plain: real <a>
// elements with the player's name as the link text, since anchor text is most of what tells
// a search engine what the destination is about.
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { fetchWpblTeams, fetchWpblAllPlayers } from './api'
import { wpblFullName } from './constants'
import { TeamBadge, CARD_BORDER } from './ui'
import { wpblPlayerPath } from './routes'
import type { WpblTeam, WpblPlayer } from './types'

export default function WpblPlayersIndex({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblTeams(), fetchWpblAllPlayers()])
      .then(([t, p]) => { if (!cancelled) { setTeams(t); setPlayers(p) } })
      .catch(() => { /* the empty state below is the whole error path */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Grouped by club, alphabetical within it. Free agents and anyone the feed has not
  // assigned a team land in a trailing group rather than being dropped: a player with no
  // page is exactly the problem this file is solving.
  const groups = useMemo(() => {
    const byTeam = new Map<string, WpblPlayer[]>()
    for (const p of players) {
      const key = p.team_id ?? ''
      const list = byTeam.get(key) ?? []
      list.push(p)
      byTeam.set(key, list)
    }
    const ordered = teams
      .slice()
      .sort((a, b) => wpblFullName(a).localeCompare(wpblFullName(b)))
      .map(t => ({ team: t, roster: (byTeam.get(t.id) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)) }))
      .filter(g => g.roster.length > 0)
    const loose = (byTeam.get('') ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
    return loose.length ? [...ordered, { team: null, roster: loose }] : ordered
  }, [teams, players])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', px: { xs: 2, sm: 3 }, pb: 6 }}>
      <Box
        component="a"
        href="/wpbl"
        onClick={e => { if (!isModified(e)) { e.preventDefault(); onNavigate('/wpbl') } }}
        sx={{
          textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2,
          color: 'text.secondary', fontSize: '0.85rem', fontWeight: 700,
          px: 1.25, py: 0.6, borderRadius: 999, border: '1px solid', borderColor: 'divider',
          bgcolor: 'background.paper',
          '&:hover': { color: 'text.primary', borderColor: 'text.secondary' },
        }}
      >← Back to WPBL</Box>

      <Typography component="h1" sx={{ fontSize: '1.5rem', fontWeight: 800, mb: 0.5 }}>
        WPBL Players
      </Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem', mb: 3 }}>
        Every player in the Women&rsquo;s Pro Baseball League, by club. {players.length} in all.
      </Typography>

      {groups.length === 0 && (
        <Typography sx={{ color: 'text.secondary' }}>
          The roster loads here once the league feed has been ingested.
        </Typography>
      )}

      {groups.map(({ team, roster }) => (
        <Box key={team?.id ?? 'unassigned'} sx={{ mb: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            {team && <TeamBadge team={team} size={26} />}
            <Typography component="h2" sx={{ fontSize: '1.05rem', fontWeight: 700 }}>
              {team ? wpblFullName(team) : 'Unassigned'}
            </Typography>
            <Typography sx={{ color: 'text.disabled', fontSize: '0.8rem' }}>
              {roster.length}
            </Typography>
          </Box>
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
            gap: 0.5,
            border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, p: 1.5,
            bgcolor: 'background.paper',
          }}>
            {roster.map(p => {
              // `players`, not `roster`: uniqueness is a property of the whole league, and
              // passing one club would call a shared name unique and mint a URL that
              // resolves to nobody.
              const href = wpblPlayerPath(p, players)
              return (
                <Box
                  key={p.id}
                  component="a"
                  href={href}
                  onClick={e => { if (!isModified(e)) { e.preventDefault(); onNavigate(href) } }}
                  sx={{
                    textDecoration: 'none', color: 'text.primary',
                    fontSize: '0.9rem', fontWeight: 600,
                    px: 1, py: 0.75, borderRadius: 1,
                    display: 'flex', alignItems: 'baseline', gap: 0.75,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box component="span">{p.name}</Box>
                  {p.position && (
                    <Box component="span" sx={{ color: 'text.disabled', fontSize: '0.72rem', fontWeight: 600 }}>
                      {p.position}
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** Let the browser handle cmd/ctrl/shift/middle clicks so open-in-new-tab still works. */
function isModified(e: React.MouseEvent) {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
}
