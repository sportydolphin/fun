// /wpbl/players: every player who has APPEARED in a game, grouped by club, each one a real link.
//
// ONLY PLAYERS WHO PLAYED. A roster carries people who never got into a game (49 of the league's
// 118 have no box-score line between them), and a directory of names that never played is noise a
// reader has to wade through. So this filters to anyone with at least one batting or pitching line.
// A box-score line's `player_id` is the internal player id (it is what aggregateBatting keys on),
// so "appeared" is simply: their id shows up in the season's lines.
//
// THE FULL-ROSTER CRAWL PATH STILL EXISTS, on /wpbl/league, which lists all 118 players as real
// anchors (see LeaguePage). So dropping the non-appearing players here orphans nobody: their page
// keeps its inbound link there and its sitemap entry. What this page is, then, is the who-played
// roster; the league page is the everyone-signed one.
//
// The names shown are still real <a> elements, present in the DOM on first paint (Club sort,
// nothing typed): the search box and the Name/Number sorts only reorder or hide anchors that first
// render already held, so a crawler, which does not type or click, is served the grouped roster.
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress, Collapse } from '@mui/material'
import { ExpandMore } from '@mui/icons-material'
import { fetchWpblTeams, fetchWpblAllPlayers, fetchWpblAllLines } from './api'
import { wpblFullName } from './constants'
import { TeamBadge, PlayerPortrait, SegNav, CARD_BORDER, TAPPABLE, FOCUS_RING, hoverOnly } from './ui'
import { wpblPlayerPath, WPBL_COMPARE_BASE } from './routes'
import WpblPage from './WpblPage'
import type { WpblTeam, WpblPlayer } from './types'
import { track, trackImpression, EVENTS } from '../lib/analytics'

type SortKey = 'club' | 'name' | 'number'

/** Jersey number as a sortable value; anyone without one sorts to the end. */
function jerseyNum(p: WpblPlayer): number {
  const n = parseInt(p.jersey_number ?? '', 10)
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n
}

export default function WpblPlayersIndex({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [teams, setTeams] = useState<WpblTeam[]>([])
  // The FULL roster, kept whole for one reason: wpblPlayerPath needs the whole league to decide a
  // slug is unambiguous (see routes.ts), so a path built from a filtered list could mint a URL that
  // names the wrong player. Display is the appeared subset below; slugs are always league-wide.
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  // The ids that show up in a box-score line: who actually played. A line's player_id is the
  // internal id, so this is a direct set membership against player.id.
  const [appearedIds, setAppearedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('club')
  // Which club groups the reader has collapsed, keyed by team id ('unassigned' for the loose
  // group). Default empty, so every group opens expanded: the roster is in the DOM on first
  // paint exactly as the crawl path this page exists for depends on. Only meaningful in Club sort.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (key: string) => {
    track(EVENTS.WPBL_PAGE_CONTROL, { page: 'players', control: 'collapse', value: key })
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  useEffect(() => {
    let cancelled = false
    // Lines are gated in with teams and players (not fetched after) so the page never paints the
    // full roster for a beat and then drops the non-appearing half: it opens on the filtered list.
    Promise.all([fetchWpblTeams(), fetchWpblAllPlayers(), fetchWpblAllLines()])
      .then(([t, p, lines]) => {
        if (cancelled) return
        setTeams(t); setPlayers(p)
        setAppearedIds(new Set([...lines.batting, ...lines.pitching].map(l => l.player_id)))
      })
      .catch(() => { /* the empty state below is the whole error path */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // Only players who appeared. `players` stays the whole league for slug building; this is the
  // display set everything below (groups, search, the count) is drawn from.
  const appeared = useMemo(() => players.filter(p => appearedIds.has(p.id)), [players, appearedIds])

  // Filter first, on every mode. Name is the point; position and jersey number ride along so
  // "SS" or "24" find who you mean without a second control.
  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return appeared
    return appeared.filter(p =>
      p.name.toLowerCase().includes(q)
      || (p.position?.toLowerCase().includes(q) ?? false)
      || (p.jersey_number?.toLowerCase().includes(q) ?? false),
    )
  }, [appeared, q])

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
        onClick={e => {
          track(EVENTS.WPBL_PAGE_OPEN, { page: 'players', section: query ? 'search' : sort, kind: 'player' })
          if (!isModified(e)) { e.preventDefault(); onNavigate(href) }
        }}
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
    <WpblPage
      title="WPBL Players"
      standfirst={<>Everyone who has played in the Women&rsquo;s Pro Baseball League, by club. {appeared.length} in all.</>}
    >
      {/* THE ONE LINK ON THE SECTION TO THE COMPARISON PAGES, alongside the chip on a player's
          own card. They are deliberately out of the sitemap (see WPBL_COMPARE_BASE), so being
          linked is the whole of how they are found, and this is the page a crawler already
          reaches: it is the roster hub and it is linked from the footer. */}
      <Box
        component="a"
        href={WPBL_COMPARE_BASE}
        onClick={e => {
          track(EVENTS.WPBL_COMPARE_OPENED, { from: 'players', pair: false })
          if (!isModified(e)) { e.preventDefault(); onNavigate(WPBL_COMPARE_BASE) }
        }}
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
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setQuery(e.target.value)
            // Once per load: every keystroke is a change, and "did anyone search" is the question.
            // What they then opened is on wpbl_page_open, section 'search'.
            if (e.target.value) trackImpression(EVENTS.WPBL_PAGE_CONTROL, { page: 'players', control: 'search' }, 'players|search')
          }}
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
            onChange={v => { setSort(v as SortKey); track(EVENTS.WPBL_PAGE_CONTROL, { page: 'players', control: 'sort', value: v }) }}
            options={[
              { value: 'club', label: 'Club' },
              { value: 'name', label: 'Name' },
              { value: 'number', label: 'Number' },
            ]}
          />
        </Box>
      </Box>

      {appeared.length === 0 && (
        <Typography sx={{ color: 'text.secondary' }}>
          The roster loads here once games have been played.
        </Typography>
      )}

      {appeared.length > 0 && shown === 0 && (
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
    </WpblPage>
  )
}

/** Let the browser handle cmd/ctrl/shift/middle clicks so open-in-new-tab still works. */
function isModified(e: React.MouseEvent) {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
}
