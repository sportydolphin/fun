// /wpbl/players: every player in the league, grouped by club, each one a real link.
//
// This page exists for a reason that is not obvious from looking at it: without it the 118
// player pages have almost nothing pointing at them. A crawler reaches a player only by
// following a link, and in the app a player is opened from a stat-leader row or a team
// roster, both of which sit behind a tab and a team selection. That is a long way in from
// /wpbl, and the leader boards only ever name the top five. One flat page of anchors puts
// every player exactly one hop from a page Google already has.
//
// THE CRAWL PATH IS THE INVARIANT, not the layout. Every player's name is a real <a>, and the
// default render (Club sort, nothing typed) has all 118 of them in the DOM on first paint, which
// is what a crawler sees. The search box and the Name/Number sorts are reader conveniences layered
// over that in React state: they reorder or hide anchors the first render already contained, and a
// crawler, which does not type or click, is served the grouped roster exactly as before.
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress, Collapse } from '@mui/material'
import { ExpandMore } from '@mui/icons-material'
import { fetchWpblTeams, fetchWpblAllPlayers } from './api'
import { wpblFullName } from './constants'
import { TeamBadge, PlayerPortrait, SegNav, CARD_BORDER, TAPPABLE, FOCUS_RING, hoverOnly } from './ui'
import { wpblPlayerPath, WPBL_COMPARE_BASE } from './routes'
import { navBack } from '../nav'
import type { WpblTeam, WpblPlayer } from './types'

type SortKey = 'club' | 'name' | 'number'

/** Jersey number as a sortable value; anyone without one sorts to the end. */
function jerseyNum(p: WpblPlayer): number {
  const n = parseInt(p.jersey_number ?? '', 10)
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n
}

export default function WpblPlayersIndex({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('club')
  // Which club groups the reader has collapsed, keyed by team id ('unassigned' for the loose
  // group). Default empty, so every group opens expanded: the roster is in the DOM on first
  // paint exactly as the crawl path this page exists for depends on. Only meaningful in Club sort.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (key: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblTeams(), fetchWpblAllPlayers()])
      .then(([t, p]) => { if (!cancelled) { setTeams(t); setPlayers(p) } })
      .catch(() => { /* the empty state below is the whole error path */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // Filter first, on every mode. Name is the point; position and jersey number ride along so
  // "SS" or "24" find who you mean without a second control.
  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return players
    return players.filter(p =>
      p.name.toLowerCase().includes(q)
      || (p.position?.toLowerCase().includes(q) ?? false)
      || (p.jersey_number?.toLowerCase().includes(q) ?? false),
    )
  }, [players, q])

  // Grouped by club, alphabetical within it. Free agents and anyone the feed has not assigned a
  // team land in a trailing group rather than being dropped: a player with no page is exactly the
  // problem this file is solving. Built from the filtered set, so a search narrows each group and
  // drops the ones it empties.
  const groups = useMemo(() => {
    const byTeam = new Map<string, WpblPlayer[]>()
    for (const p of filtered) {
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
  }, [teams, filtered])

  // The flat list for Name / Number sort: one grid, no club headings, the club still readable off
  // each portrait's ring. Name is the tiebreak on Number so a club's un-numbered players stay in a
  // stable, readable order rather than whatever the fetch happened to return.
  const flat = useMemo(() => {
    const arr = filtered.slice()
    if (sort === 'number') arr.sort((a, b) => jerseyNum(a) - jerseyNum(b) || a.name.localeCompare(b.name))
    else arr.sort((a, b) => a.name.localeCompare(b.name))
    return arr
  }, [filtered, sort])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  // One cell: portrait, name (the anchor and its own crawl text), then jersey and position. In the
  // flat sorts the club abbreviation rides along too, since there is no club heading above to say it.
  const PlayerCell = ({ p, showTeam }: { p: WpblPlayer; showTeam?: boolean }) => {
    const href = wpblPlayerPath(p, players)  // `players`, not a club roster: uniqueness is a league fact
    const team = p.team_id ? teamById.get(p.team_id) : undefined
    return (
      <Box
        component="a"
        href={href}
        onClick={e => { if (!isModified(e)) { e.preventDefault(); onNavigate(href) } }}
        sx={{
          textDecoration: 'none', color: 'text.primary',
          display: 'flex', alignItems: 'center', gap: 1,
          px: 1, py: 0.75, borderRadius: 1.5, ...TAPPABLE,
        }}
      >
        <PlayerPortrait name={p.name} teamId={p.team_id} size={38} />
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.1 }}>
          <Box component="span" sx={{ fontSize: '0.9rem', fontWeight: 700, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.name}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.disabled', fontSize: '0.72rem', fontWeight: 600 }}>
            {p.jersey_number && <Box component="span">#{p.jersey_number}</Box>}
            {p.position && <Box component="span">{p.position}</Box>}
            {showTeam && team && <Box component="span" sx={{ textTransform: 'uppercase', letterSpacing: 0.3 }}>{team.abbr}</Box>}
          </Box>
        </Box>
      </Box>
    )
  }

  const GRID = {
    display: 'grid',
    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
    gap: 0.5,
    border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, p: 1,
    bgcolor: 'background.paper',
  } as const

  const shown = filtered.length

  return (
    <Box sx={{ maxWidth: '56.25rem', mx: 'auto', px: { xs: 2, sm: 3 }, pb: 6 }}>
      <Box
        component="a"
        href="/wpbl"
        onClick={e => { if (!isModified(e)) { e.preventDefault(); navBack('/wpbl') } }}
        sx={{
          textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2,
          color: 'text.secondary', fontSize: '0.85rem', fontWeight: 700,
          px: 1.25, py: 0.6, borderRadius: 999, border: '1px solid', borderColor: 'divider',
          bgcolor: 'background.paper',
          ...hoverOnly({ color: 'text.primary', borderColor: 'text.secondary' }),
        }}
      >← Back to WPBL</Box>

      <Typography component="h1" sx={{ fontSize: '1.5rem', fontWeight: 800, mb: 0.5 }}>
        WPBL Players
      </Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem', mb: 1 }}>
        Every player in the Women&rsquo;s Pro Baseball League, by club. {players.length} in all.
      </Typography>
      {/* THE ONE LINK ON THE SECTION TO THE COMPARISON PAGES, alongside the chip on a player's
          own card. They are deliberately out of the sitemap (see WPBL_COMPARE_BASE), so being
          linked is the whole of how they are found, and this is the page a crawler already
          reaches: it is the roster hub and it is linked from the footer. */}
      <Box
        component="a"
        href={WPBL_COMPARE_BASE}
        onClick={e => { if (!isModified(e)) { e.preventDefault(); onNavigate(WPBL_COMPARE_BASE) } }}
        sx={{
          display: 'inline-block', mb: 2.5, fontSize: '0.85rem', fontWeight: 700,
          color: 'primary.main', textDecoration: 'none',
          ...hoverOnly({ textDecoration: 'underline' }),
        }}
      >Compare two players →</Box>

      {/* Search + sort. The input filters every mode; the pills reorder the results (Club keeps the
          grouped view, Name and Number flatten to one list). Both are pure reader convenience: the
          first render below is the grouped roster with every name already an anchor. */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' }, gap: 1.5, mb: 2.5 }}>
        <Box
          component="input"
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          type="search"
          placeholder="Search players, positions…"
          aria-label="Search players"
          sx={{
            flex: 1, minWidth: 0, font: 'inherit', fontSize: '0.9rem',
            color: 'text.primary', bgcolor: 'background.paper',
            border: '1px solid', borderColor: 'divider', borderRadius: 999,
            px: 1.75, py: 0.9, outline: 'none',
            '&::placeholder': { color: 'text.disabled' },
            '&:focus': { borderColor: 'text.secondary' },
            ...FOCUS_RING,
          }}
        />
        <Box sx={{ flexShrink: 0 }}>
          <SegNav
            mb={0}
            value={sort}
            onChange={v => setSort(v as SortKey)}
            options={[
              { value: 'club', label: 'Club' },
              { value: 'name', label: 'Name' },
              { value: 'number', label: 'Number' },
            ]}
          />
        </Box>
      </Box>

      {players.length === 0 && (
        <Typography sx={{ color: 'text.secondary' }}>
          The roster loads here once the league feed has been ingested.
        </Typography>
      )}

      {players.length > 0 && shown === 0 && (
        <Typography sx={{ color: 'text.secondary', py: 2 }}>
          No players match &ldquo;{query.trim()}&rdquo;.
        </Typography>
      )}

      {/* Club sort: grouped, collapsible, one card per club, the crawl-path default. */}
      {sort === 'club' && groups.map(({ team, roster }) => {
        const key = team?.id ?? 'unassigned'
        const isCollapsed = collapsed.has(key)
        return (
        <Box key={key} sx={{ mb: 4 }}>
          {/* The whole header is the toggle. A real <button> so it is keyboard- and
              screen-reader-operable; the <h2> stays inside it, unchanged, so the heading
              outline the crawl path wants is intact. */}
          <Box
            component="button"
            type="button"
            onClick={() => toggle(key)}
            aria-expanded={!isCollapsed}
            aria-controls={`roster-${key}`}
            sx={{
              width: '100%', border: 0, background: 'none', p: 0, m: 0, mb: 1.5,
              display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', textAlign: 'left',
              color: 'text.primary', font: 'inherit',
              ...hoverOnly({ color: 'text.primary' }),
            }}
          >
            {team && <TeamBadge team={team} size={26} />}
            <Typography component="h2" sx={{ fontSize: '1.05rem', fontWeight: 700 }}>
              {team ? wpblFullName(team) : 'Unassigned'}
            </Typography>
            <Typography sx={{ color: 'text.disabled', fontSize: '0.8rem' }}>
              {roster.length}
            </Typography>
            <ExpandMore sx={{
              ml: 'auto', color: 'text.disabled',
              transform: isCollapsed ? 'rotate(-90deg)' : 'none',
              transition: 'transform 0.2s',
            }} />
          </Box>
          <Collapse in={!isCollapsed} id={`roster-${key}`}>
            <Box sx={GRID}>
              {roster.map(p => <PlayerCell key={p.id} p={p} />)}
            </Box>
          </Collapse>
        </Box>
        )
      })}

      {/* Name / Number sort: one flat grid, club read off each portrait's ring plus the abbr. */}
      {sort !== 'club' && shown > 0 && (
        <Box sx={GRID}>
          {flat.map(p => <PlayerCell key={p.id} p={p} showTeam />)}
        </Box>
      )}
    </Box>
  )
}

/** Let the browser handle cmd/ctrl/shift/middle clicks so open-in-new-tab still works. */
function isModified(e: React.MouseEvent) {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
}
