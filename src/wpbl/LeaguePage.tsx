// /wpbl/league: the league itself, as opposed to its games, its clubs or its players.
//
// THE NOUN THE SECTION WAS MISSING. Everything else here is a game, a club or a player, so
// anything about the league as a thing had nowhere to be: the media shelf ended up on Home,
// and the primer, the glossary, the archive and this map had nowhere at all. This page is that
// home, and the first tenant is the one fact about the WPBL that needs no season to be true.
//
// NO NAV PILL, DELIBERATELY. It ships as a real path linked from the footer and earns a sixth
// pill from the events or does not get one. The top pills are already the least reachable part
// of an 812px phone and the sixth used to sit off-screen entirely (see BottomNav.tsx), while
// the footer is a proven crawl path: it is how Google found /privacy and /terms while /mlb sat
// undiscovered for months. Promoting this later costs four lines. Demoting it costs a redirect.
//
// WHY IT MATTERS THAT IT IS DULL TEXT. This is the only page in the section that still says
// something after the feed stops on Sep 22, and it is 118 player names as real anchors, which
// is the same crawl-path argument PlayersIndex.tsx is built on. Every name here is a link.
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import {
  fetchWpblAllPlayers, fetchWpblTeams, fetchWpblVideos, fetchWpblArticles, fetchWpblPhotos,
  getCachedWpblVideos, getCachedWpblArticles, getCachedWpblPhotos,
} from './api'
import MediaShelf from './MediaShelf'
import { Chevron, FOCUS_RING, pressable } from './ui'
import { byCountry, ageSpread, placeOf } from './derive/hometowns'
import { wpblPlayerPath } from './routes'
import type { WpblArticle, WpblPhoto, WpblPlayer, WpblTeam, WpblVideo } from './types'

const isModified = (e: React.MouseEvent) =>
  e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

export default function WpblLeaguePage({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [videos, setVideos] = useState<WpblVideo[]>(() => getCachedWpblVideos() ?? [])
  const [articles, setArticles] = useState<WpblArticle[]>(() => getCachedWpblArticles() ?? [])
  const [photos, setPhotos] = useState<WpblPhoto[]>(() => getCachedWpblPhotos() ?? [])

  useEffect(() => {
    let cancelled = false
    fetchWpblAllPlayers()
      .then(p => { if (!cancelled) setPlayers(p) })
      .catch(() => { /* the empty state below is the whole error path */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // The shelf's three reads, on the terms they had on Home: each one small, cached by the api
  // layer, and separately caught, so the slowest of them can never gate the roster above or
  // blank the other two. They are deliberately NOT in the promise above for that reason.
  useEffect(() => {
    let cancelled = false
    fetchWpblTeams().then(t => { if (!cancelled) setTeams(t) }).catch(() => { /* the shelf renders without club colours */ })
    fetchWpblVideos().then(v => { if (!cancelled) setVideos(v) }).catch(() => { /* keep last-good */ })
    fetchWpblArticles().then(a => { if (!cancelled) setArticles(a) }).catch(() => { /* keep last-good */ })
    fetchWpblPhotos().then(p => { if (!cancelled) setPhotos(p) }).catch(() => { /* keep last-good */ })
    return () => { cancelled = true }
  }, [])

  const countries = useMemo(() => byCountry(players), [players])
  const ages = useMemo(() => ageSpread(players), [players])
  const placed = countries.reduce((n, c) => n + c.players.length, 0)
  const widest = countries[0]?.players.length ?? 1

  // OPEN BY DEFAULT, and the state is the exceptions rather than the openings.
  //
  // Collapsed-by-default was the obvious call and it is the wrong one twice over. This page
  // exists to BE the roster: a reader who lands on eleven closed rows has been handed a table
  // of contents for a page whose contents are one tap away in every direction, and eight of
  // those eleven countries hold five players or fewer, so closing them saves a reader nothing
  // and costs them a tap. What is actually long is the USA at 64, and a per-country toggle
  // plus "Collapse all" hands that reader the short version in one press, which is the case
  // collapsing was for.
  //
  // Holding the CLOSED set, not the open one, is what keeps that default true when the
  // countries change: a twelfth country arriving in a trade renders open like the rest,
  // where a set of open names would render it closed and silently hide new players.
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set())
  const toggleCountry = (country: string) => setClosed(prev => {
    const next = new Set(prev)
    if (!next.delete(country)) next.add(country)
    return next
  })
  const allClosed = countries.length > 0 && closed.size >= countries.length
  const toggleAll = () => setClosed(allClosed ? new Set() : new Set(countries.map(c => c.country)))

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
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
        The league
      </Typography>
      {/* NO TENSE. "played its first season" is wrong while it is being played and right
          afterwards, and this page is the one built to outlive the feed, so it would be wrong
          for the six weeks it matters most or wrong forever after. A colon is not a verb. */}
      <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem', mb: 3 }}>
        The Women&rsquo;s Pro Baseball League&rsquo;s first season, 2026: four clubs and{' '}
        {players.length} players
        {countries.length > 1 && ` from ${countries.length} countries`}.
        {ages && ` The youngest is ${ages.youngest.age}, the oldest ${ages.oldest.age}, and half
          the league is ${ages.median} or under.`}
      </Typography>

      {/* Reading, Highlights and the archive, moved here off Home on Aug 27. This is where they
          belonged: all three are about the league rather than about today's games, none of them
          needs a live feed, and on Home they were three screens that 575 browsers saw and 39
          used. Above the roster, because the roster is 118 rows and anything under it is
          unreachable in practice. */}
      <Box sx={{ mb: 4 }}>
        <MediaShelf articles={articles} videos={videos} photos={photos} teams={teams} />
      </Box>

      {countries.length === 0 && (
        <Typography sx={{ color: 'text.secondary' }}>
          The roster loads here once the league feed has been ingested.
        </Typography>
      )}

      {countries.length > 0 && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
            <Typography component="h2" sx={{ fontSize: '1.15rem', fontWeight: 800, flex: 1 }}>
              Hometowns
            </Typography>
            <Box
              {...pressable(toggleAll)}
              sx={{
                ...FOCUS_RING,
                cursor: 'pointer', userSelect: 'none', flexShrink: 0,
                fontSize: '0.78rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
                px: 1, py: 0.5, borderRadius: 1.5,
                '@media (hover: hover)': { '&:hover': { bgcolor: 'action.hover' } },
              }}
            >{allClosed ? 'Expand all' : 'Collapse all'}</Box>
          </Box>
          <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem', mb: 2.5 }}>
          </Typography>

          {countries.map(c => {
            const open = !closed.has(c.country)
            return (
            <Box key={c.country} sx={{ mb: open ? 3.5 : 1.5 }}>
              {/* The whole heading row is the target, the way SectionCard's is: a chevron on
                  its own is a 22px hitbox next to a 200px bar that does nothing. */}
              <Box
                {...pressable(() => toggleCountry(c.country))}
                aria-expanded={open}
                sx={{
                  ...FOCUS_RING,
                  display: 'flex', alignItems: 'baseline', gap: 1, mb: 1, pb: 0.75,
                  borderBottom: '1px solid', borderColor: 'divider',
                  cursor: 'pointer', userSelect: 'none', WebkitTapHighlightColor: 'transparent',
                  '@media (hover: hover)': { '&:hover': { borderColor: 'text.secondary' } },
                }}
              >
                <Typography component="h3" sx={{ fontSize: '1.02rem', fontWeight: 700 }}>
                  {c.flag && <Box component="span" sx={{ mr: 0.75 }} aria-hidden>{c.flag}</Box>}
                  {c.country}
                </Typography>
                <Typography sx={{ color: 'text.disabled', fontSize: '0.82rem' }}>
                  {c.players.length}
                </Typography>
                {/* The bar is the only chart on the page, and it is a proportion of the
                    largest country rather than of the league: with the USA at 64 of 118,
                    everything else would otherwise draw as a sliver.
                    CAPPED, and not `flex: 1`. Stretched across the page the biggest country
                    draws a full-width rule under its own heading, which reads as a progress bar
                    that has finished rather than as a quantity, and the small countries become
                    a dot at the far left of an empty 1,100px. At 200px the eleven bars are
                    comparable to each other, which is the only comparison being offered. */}
                <Box sx={{
                  width: 200, maxWidth: '40%', height: 6, borderRadius: 3,
                  bgcolor: 'action.hover', ml: 0.5, alignSelf: 'center', flexShrink: 0,
                }}>
                  <Box sx={{
                    height: '100%', borderRadius: 3, bgcolor: 'var(--wpbl-accent-solid)',
                    width: `${c.players.length / widest * 100}%`,
                  }} />
                </Box>
                {/* `ml: auto` so it lands on the right edge: the rest of the row is packed
                    left, and a chevron floating in the middle of it reads as another glyph in
                    the heading rather than as the control for the row. */}
                <Box sx={{ alignSelf: 'center', ml: 'auto', pl: 0.5 }}><Chevron open={open} /></Box>
              </Box>

              {/* HIDDEN, NEVER UNMOUNTED. `display: none` is doing load-bearing work here:
                  this page is 118 player links and the crawl path they make is the reason it
                  exists, and a closed country that returns `null` deletes those anchors from
                  the document a crawler is reading. Hidden, they are still in the markup and
                  still followed. Conditional rendering here would cost the page its point,
                  invisibly, since the open default means nobody would ever see it happen. */}
              <Box sx={{
                display: open ? 'grid' : 'none',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
                gap: 0.25, mx: -1,
              }}>
                {c.players.map(p => {
                  // The whole roster, never this country's slice: whether a name is ambiguous
                  // is a fact about the league, and handing it one country would mint a clean
                  // URL for a name that two players share.
                  const href = wpblPlayerPath(p, players)
                  const place = placeOf(p.hometown)
                  return (
                    <Box
                      key={p.id}
                      component="a"
                      href={href}
                      onClick={e => { if (!isModified(e)) { e.preventDefault(); onNavigate(href) } }}
                      sx={{
                        // STACKED, not one line. Side by side, a name that wraps pushes its
                        // town out to the right and down, so no two cells in a column line up
                        // and the grid reads as debris. "Amanda Gianelloni, New Orleans,
                        // Louisiana" is the case that proves it. Two lines is one more row of
                        // height and every cell the same shape.
                        textDecoration: 'none', color: 'text.primary', borderRadius: 1.5,
                        px: 1, py: 0.6, display: 'block',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <Box component="span" sx={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, lineHeight: 1.35 }}>
                        {p.name}
                      </Box>
                      {place && (
                        <Box component="span" sx={{ display: 'block', fontSize: '0.76rem', color: 'text.disabled', lineHeight: 1.35 }}>
                          {place}
                        </Box>
                      )}
                    </Box>
                  )
                })}
              </Box>
            </Box>
            )
          })}
        </>
      )}
    </Box>
  )
}
