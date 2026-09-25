// /wpbl/league, titled "About the league": what the WPBL is, its four clubs, and where its players
// come from.
//
// A PRIMER, NOT A GRAB-BAG. This page used to hold a reading/highlights/archive shelf, a draft-class
// model and a 118-row hometowns list, three unrelated things under a name that described none of
// them. The writing now has its own page (/wpbl/reading), the Commons archive is a category of the
// gallery, highlights sit on the season recap and each game, and the draft model is a board on
// Stats, where the rest of the numbers are. What is left answers "what is this league?" for a
// reader arriving cold, which in the offseason is most of them.
//
// THE URL STAYS /wpbl/league. It is indexed and linked; renaming the page is a title change, and
// renaming the URL would cost a redirect and the links pointing at it.
//
// NO NAV PILL, DELIBERATELY. The top pills are already the least reachable part of an 812px phone
// and a sixth would sit off-screen entirely (see BottomNav.tsx); the More menu and the footer link
// it (morePages.ts).
//
// EVERY PLAYER NAME IS STILL A REAL LINK IN THE DOCUMENT. The hometown lists are hidden with
// `display: none` rather than unmounted when their country is not picked, so the 118 anchors this
// page carries (the same crawl path PlayersIndex.tsx exists for) are always there to follow.
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { fetchWpblAllPlayers, fetchWpblTeams, fetchWpblSchedule, computeStandings, countsInStandings } from './api'
import { FOCUS_RING, TAPPABLE, TeamBadge, TYPE_SCALE, CARD_BORDER, CARD_FILL, FLAT_CARDS_DARK, hoverOnly, pressable, useWpblDark } from './ui'
import { wpblAccent, wpblFullName } from './constants'
import { byCountry, placeOf } from './derive/hometowns'
import { buildBracket, championResult } from './derive/bracket'
import { wpblPlayerPath, wpblTeamPath, WPBL_GLOSSARY_PAGE, WPBL_SEASON_PAGE } from './routes'
import WpblPage, { SectionHeading } from './WpblPage'
import type { WpblPlayer, WpblTeam, WpblGame } from './types'
import { track, EVENTS } from '../lib/analytics'

const isModified = (e: React.MouseEvent) =>
  e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

export default function WpblLeaguePage({ onNavigate }: { onNavigate: (to: string) => void }) {
  const dark = useWpblDark()
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [games, setGames] = useState<WpblGame[]>([])
  const [loading, setLoading] = useState(true)
  // The one country whose players are showing, or none. See the note on the chips.
  const [country, setCountry] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchWpblAllPlayers()
      .then(p => { if (!cancelled) setPlayers(p) })
      .catch(() => { /* the empty state below is the whole error path */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    // The clubs and the schedule only add to the page (the club cards, the facts), so neither
    // gates it: a slow read leaves those blocks out rather than holding the roster back.
    fetchWpblTeams().then(t => { if (!cancelled) setTeams(t) }).catch(() => { /* no club cards */ })
    fetchWpblSchedule().then(g => { if (!cancelled) setGames(g) }).catch(() => { /* no season facts */ })
    return () => { cancelled = true }
  }, [])

  const countries = useMemo(() => byCountry(players), [players])
  const standings = useMemo(() => computeStandings(teams, games), [teams, games])
  const champ = useMemo(() => {
    const b = teams.length > 0 ? buildBracket(standings, games) : null
    return b ? championResult(b) : null
  }, [standings, games, teams.length])
  // Games per club, off the data rather than written down: the most any club has played in the
  // regular season. Null until a game is final, so the line leaves itself out rather than say 0.
  const perClub = useMemo(() => {
    const regular = games.filter(g => g.status === 'final' && countsInStandings(g))
    if (regular.length === 0) return null
    return Math.max(...standings.map(r => r.wins + r.losses))
  }, [games, standings])

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  }

  const link = (href: string) => ({
    component: 'a' as const, href,
    onClick: (e: React.MouseEvent) => {
      // Players are only linked from the hometowns list and clubs only from the club cards (and the
      // champion line); anything else is one of the page's links onward to another page.
      const kind = href.includes('/players/') ? 'player' : href.includes('/teams/') ? 'team' : 'page'
      const section = kind === 'player' ? 'hometowns' : kind === 'team' ? 'clubs' : 'onward'
      track(EVENTS.WPBL_PAGE_OPEN, { page: 'league', section, kind, ...(kind === 'page' ? { value: href } : {}) })
      if (!isModified(e)) { e.preventDefault(); onNavigate(href) }
    },
  })
  const recordOf = (id: string) => {
    const r = standings.find(x => x.team.id === id)
    return r && r.wins + r.losses > 0 ? `${r.wins}–${r.losses}` : null
  }

  // The facts, in the order a newcomer needs them. Each is one plain sentence; the rules page has
  // the detail and is linked at the end.
  const facts: React.ReactNode[] = [
    <>Four clubs{perClub ? `, each playing ${perClub} regular-season games` : ''}.</>,
    <>Games are seven innings long, with extra innings if they are tied.</>,
    <>
      All four clubs make the postseason: the top seed plays the fourth and the second plays the
      third in best-of-three semifinals, and the winners meet in a best-of-five championship.
    </>,
  ]
  if (champ) {
    facts.push(<>
      The first champions were the{' '}
      <Box {...link(wpblTeamPath(champ.champion, teams))} sx={inlineLink}>{wpblFullName(champ.champion)}</Box>
      {champ.runnerUp ? `, who beat the ${wpblFullName(champ.runnerUp)} ${champ.champWins}–${champ.rivalWins} in the final` : ''}.
    </>)
  }

  return (
    <WpblPage
      title="About the league"
      standfirst={<>
        The Women&rsquo;s Pro Baseball League played its first season in 2026: four clubs
        {players.length > 0 && ` and ${players.length} players`}
        {countries.length > 1 && ` from ${countries.length} countries`}.
      </>}
    >
      <Box sx={FLAT_CARDS_DARK}>
        <SectionHeading seen="league">How it works</SectionHeading>
        <Box component="ul" sx={{ m: 0, pl: 2.25, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {facts.map((f, i) => (
            <Typography key={i} component="li" sx={{ fontSize: TYPE_SCALE.body, lineHeight: 1.55 }}>{f}</Typography>
          ))}
        </Box>
        {/* Stacked, one link a line: side by side they wrapped mid-link on a phone. */}
        <Box sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
          <Typography sx={{ fontSize: TYPE_SCALE.body }}>
            <Box {...link(WPBL_GLOSSARY_PAGE)} sx={inlineLink}>The full rules, and what every stat means ›</Box>
          </Typography>
          {champ && (
            <Typography sx={{ fontSize: TYPE_SCALE.body }}>
              <Box {...link(WPBL_SEASON_PAGE)} sx={inlineLink}>The 2026 season recap ›</Box>
            </Typography>
          )}
        </Box>

        {teams.length > 0 && (
          <>
            <SectionHeading seen="league">The clubs</SectionHeading>
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              {[...teams].sort((a, b) => a.city.localeCompare(b.city)).map(t => {
                const record = recordOf(t.id)
                return (
                  <Box key={t.id} {...link(wpblTeamPath(t, teams))} sx={{
                    ...FOCUS_RING,
                    display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1.25,
                    borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER, bgcolor: CARD_FILL,
                    borderLeft: '3px solid', borderLeftColor: wpblAccent(t.id, dark),
                    textDecoration: 'none', color: 'text.primary',
                    transition: 'border-color 0.15s',
                    ...hoverOnly({ borderColor: wpblAccent(t.id, dark) }),
                  }}>
                    <TeamBadge team={t} size={36} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, lineHeight: 1.2 }}>{wpblFullName(t)}</Typography>
                      {record && (
                        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                          {record} in the regular season
                        </Typography>
                      )}
                    </Box>
                    <Box aria-hidden sx={{ color: 'text.disabled', fontSize: TYPE_SCALE.display }}>›</Box>
                  </Box>
                )
              })}
            </Box>
          </>
        )}

        {countries.length > 0 && (
          <>
            <SectionHeading seen="league">Where the players are from</SectionHeading>
            {/* ONE COUNTRY AT A TIME, PICKED FROM CHIPS. The old page opened every country at once,
                which put 64 American names between the top of the page and the ten other countries,
                a wall nobody scrolled past. The chips are the summary (every country and its count,
                on one screen) and a tap shows that country's players. */}
            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', mb: 1.25 }}>
              Pick a country to see who is from there.
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
              {countries.map(c => {
                const active = country === c.country
                return (
                  <Box key={c.country}
                    {...pressable(() => {
                      setCountry(active ? null : c.country)
                      track(EVENTS.WPBL_PAGE_CONTROL, { page: 'league', control: 'country', value: active ? null : c.country })
                    })}
                    aria-pressed={active}
                    sx={{
                      ...FOCUS_RING,
                      display: 'inline-flex', alignItems: 'center', gap: 0.6,
                      px: 1.25, py: 0.55, borderRadius: 999, cursor: 'pointer', userSelect: 'none',
                      border: '1px solid', borderColor: active ? 'primary.main' : CARD_BORDER,
                      bgcolor: active ? 'primary.main' : 'transparent',
                      color: active ? 'primary.contrastText' : 'text.primary',
                      ...(active ? null : TAPPABLE),
                    }}>
                    {c.flag && <Box component="span" aria-hidden>{c.flag}</Box>}
                    <Typography component="span" sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'inherit' }}>{c.country}</Typography>
                    <Typography component="span" sx={{
                      fontSize: TYPE_SCALE.meta, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                      color: active ? 'inherit' : 'text.secondary', opacity: active ? 0.85 : 1,
                    }}>{c.players.length}</Typography>
                  </Box>
                )
              })}
            </Box>

            {countries.map(c => (
              // HIDDEN, NEVER UNMOUNTED: see the note at the top of the file.
              <Box key={c.country} sx={{
                display: country === c.country ? 'grid' : 'none',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
                gap: 0.25, mx: -1,
              }}>
                {c.players.map(p => {
                  // The whole roster, never this country's slice: whether a name is ambiguous is a
                  // fact about the league, and one country's list would mint a clean URL for a name
                  // two players share.
                  const href = wpblPlayerPath(p, players)
                  const place = placeOf(p.hometown)
                  return (
                    <Box key={p.id} {...link(href)} sx={{
                      textDecoration: 'none', color: 'text.primary', borderRadius: 1.5,
                      px: 1, py: 0.6, display: 'block', ...TAPPABLE,
                    }}>
                      <Box component="span" sx={{ display: 'block', fontSize: TYPE_SCALE.body, fontWeight: 600, lineHeight: 1.35 }}>
                        {p.name}
                      </Box>
                      {place && (
                        <Box component="span" sx={{ display: 'block', fontSize: TYPE_SCALE.meta, color: 'text.disabled', lineHeight: 1.35 }}>
                          {place}
                        </Box>
                      )}
                    </Box>
                  )
                })}
              </Box>
            ))}
          </>
        )}

        {countries.length === 0 && (
          <Typography sx={{ color: 'text.secondary', mt: 2 }}>
            The roster loads here once the league feed has been ingested.
          </Typography>
        )}
      </Box>
    </WpblPage>
  )
}

const inlineLink = {
  color: 'var(--wpbl-accent-fg)', fontWeight: 700, textDecoration: 'none',
  '&:hover': { textDecoration: 'underline' },
} as const
