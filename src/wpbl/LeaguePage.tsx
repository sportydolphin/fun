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
// NO TAB OF ITS OWN, DELIBERATELY. The phone's bottom bar holds five tabs and More, and a sixth tab
// does not fit (see BottomNav.tsx); the More menu and the footer link it (morePages.ts).
//
// EVERY PLAYER NAME IS STILL A REAL LINK IN THE DOCUMENT. The hometown lists are hidden with
// `display: none` rather than unmounted when their country is not picked, or when the Played filter
// leaves a player out, so the 118 anchors this page carries (the same crawl path PlayersIndex.tsx
// exists for) are always there to follow.
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import { fetchWpblAllPlayers, fetchWpblTeams, fetchWpblSchedule, fetchWpblAllLines, computeStandings, countsInStandings } from './api'
import { FOCUS_RING, TAPPABLE, TeamBadge, PillGroup, TYPE_SCALE, CARD_BORDER, pressable, TextGhost, chromePx } from './ui'
import { wpblFullName } from './constants'
import { byCountry, placeOf, flagEmojiDrawn } from './derive/hometowns'
import { currentSeason, seasonsOnRecord, seasonGames } from './season'
import { buildBracket, championResult } from './derive/bracket'
import { wpblPlayerPath, wpblTeamPath, WPBL_GLOSSARY_PAGE, wpblSeasonPath } from './routes'
import WpblPage, { SectionHeading } from './WpblPage'
import type { WpblPlayer, WpblTeam, WpblGame } from './types'
import { track, EVENTS } from '../lib/analytics'
import { isModified } from '../nav'

export default function WpblLeaguePage({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [games, setGames] = useState<WpblGame[]>([])
  const [loading, setLoading] = useState(true)
  // The one country whose players are showing, or none. See the note on the chips.
  const [country, setCountry] = useState<string | null>(null)
  // Every player with a box-score line, batting or pitching: the same "appeared" PlayersIndex
  // uses. The roster holds all 118 signings, and about a third never got into a game, so without
  // this a country's list cannot say who actually played. Null until read, or if the read fails,
  // which leaves the switch out rather than offer a filter that would empty the page.
  const [appeared, setAppeared] = useState<Set<string> | null>(null)
  const [playedOnly, setPlayedOnly] = useState(false)

  useEffect(() => {
    let cancelled = false
    // The clubs and the schedule only add to the page (the club cards, the facts), so a FAILED read
    // leaves those blocks out rather than taking the roster with it. A slow one is waited for: the
    // skeleton reserves the club cards and the champions' line, and painting the page without them
    // would push the hometowns down by four cards the moment they arrived.
    Promise.allSettled([
      fetchWpblAllPlayers().then(p => { if (!cancelled) setPlayers(p) }),
      fetchWpblTeams().then(t => { if (!cancelled) setTeams(t) }),
      fetchWpblSchedule().then(g => { if (!cancelled) setGames(g) }),
      // Waited for with the rest so the chips never paint and then grow a switch above them.
      fetchWpblAllLines().then(l => {
        const ids = new Set([...l.batting, ...l.pitching].map(x => x.player_id))
        if (!cancelled && ids.size > 0) setAppeared(ids)
      }),
    ]).then(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const countries = useMemo(() => byCountry(players), [players])
  const filtering = playedOnly && appeared != null
  const shows = (p: WpblPlayer) => !filtering || !!appeared?.has(p.id)
  // The chips in the order of what they count: under Played, Japan's 8 ahead of Australia's 4, not
  // the roster order the full list sorts by. Countries with nobody left drop out.
  const chips = useMemo(() => countries
    .map(c => ({ ...c, shown: c.players.filter(p => !filtering || !!appeared?.has(p.id)).length }))
    .filter(c => c.shown > 0)
    .sort((a, b) => b.shown - a.shown || a.country.localeCompare(b.country)),
  [countries, filtering, appeared])
  // ONE SEASON'S GAMES, NEVER THE WHOLE SCHEDULE. The schedule is every season, so the club table
  // read off all of it would sum two years into one record the day 2027 has a final (15–7 under the
  // dev fake season, and "each playing 22 regular-season games"). The table is the current season;
  // the champions' line is the FIRST season's, which is what it names.
  const year = useMemo(() => currentSeason(games), [games])
  const yearGames = useMemo(() => (year == null ? games : seasonGames(games, year)), [games, year])
  const standings = useMemo(() => computeStandings(teams, yearGames), [teams, yearGames])
  const champ = useMemo(() => {
    const on = seasonsOnRecord(games)
    const first = on.length ? on[on.length - 1] : null
    if (teams.length === 0 || first == null) return null
    const firstGames = seasonGames(games, first)
    const b = buildBracket(computeStandings(teams, firstGames), firstGames)
    return b ? championResult(b) : null
  }, [games, teams])
  // Read once: whether this system draws a flag emoji as a flag (Windows draws the two letters).
  const flags = useMemo(() => flagEmojiDrawn(), [])
  // Games per club, off the data rather than written down: the most any club is SCHEDULED for in
  // the season's regular season, not the most it has played, which in May would call it a 7-game
  // season. Null until a game is final, so the line leaves itself out rather than say 0, and the
  // club table keeps the city order until there is a record to sort by.
  const anyFinal = useMemo(() => yearGames.some(g => g.status === 'final' && countsInStandings(g)), [yearGames])
  const perClub = useMemo(() => {
    if (!anyFinal) return null
    const per = new Map<string, number>()
    for (const g of yearGames) {
      if (!countsInStandings(g)) continue
      for (const id of [g.home_team_id, g.away_team_id]) per.set(id, (per.get(id) ?? 0) + 1)
    }
    return Math.max(...per.values())
  }, [yearGames, anyFinal])

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
    <>Four clubs{loading
      ? <TextGhost>, each playing 15 regular-season games</TextGhost>
      : perClub ? `, each playing ${perClub} regular-season games` : ''}.</>,
    <>Games are seven innings long, with extra innings if they are tied.</>,
    <>
      All four clubs make the postseason: the top seed plays the fourth and the second plays the
      third in best-of-three semifinals, and the winners meet in a best-of-five championship.
    </>,
  ]
  // Loading reserves the champions' line, which every season from here on has, at the width the
  // 2026 line sets in (within 1%), so it wraps where the real one will at every text size.
  if (loading) {
    facts.push(<TextGhost>The first champions were the Winning City Club, who beat the Runners-up City Nickname 3–2 in the final.</TextGhost>)
  } else if (champ) {
    facts.push(<>
      The first champions were the{' '}
      <Box {...link(wpblTeamPath(champ.champion, teams))} sx={inlineLink}>{wpblFullName(champ.champion)}</Box>
      {champ.runnerUp ? `, who beat the ${wpblFullName(champ.runnerUp)} ${champ.champWins}–${champ.rivalWins} in the final` : ''}.
    </>)
  }

  return (
    <WpblPage
      title="About the league"
      // Labeled counts, not a sentence about the page (house rule, Oct 21, 2026).
      standfirst={<>
        Since 2026 · 4 clubs
        {loading && <> <TextGhost>· 118 players · 11 countries</TextGhost></>}
        {players.length > 0 && ` · ${players.length} players`}
        {countries.length > 1 && ` · ${countries.length} countries`}
      </>}
    >
      <Box>
        <SectionHeading seen="league">How it works</SectionHeading>
        <Box component="ul" sx={{ m: 0, pl: 2.25, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {facts.map((f, i) => (
            <Typography key={i} component="li" sx={{ fontSize: TYPE_SCALE.body, lineHeight: 1.55 }}>{f}</Typography>
          ))}
        </Box>
        {/* Stacked, one link a line: side by side they wrapped mid-link on a phone. */}
        <Box sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
          <Typography sx={{ fontSize: TYPE_SCALE.body }}>
            <Box {...link(WPBL_GLOSSARY_PAGE)} sx={inlineLink}>Rules & glossary ›</Box>
          </Typography>
          {(champ || loading) && (
            <Typography sx={{ fontSize: TYPE_SCALE.body }}>
              <Box {...link(wpblSeasonPath(2026))} sx={inlineLink}>2026 season recap ›</Box>
            </Typography>
          )}
        </Box>

        {loading && (
          <>
            <SectionHeading>The clubs</SectionHeading>
            <Box aria-hidden sx={CLUB_TABLE}>
              <Box sx={CLUB_HEAD}><span>Club</span><span><TextGhost>2026</TextGhost> W–L</span></Box>
              {Array.from({ length: 4 }, (_, i) => (
                <Box key={i} sx={CLUB_ROW}>
                  <Skeleton variant="circular" width={chromePx(28)} height={chromePx(28)} sx={{ flexShrink: 0 }} />
                  <Typography sx={{ ...CLUB_NAME, flex: 1 }}><TextGhost>Los Angeles Nickname</TextGhost></Typography>
                  <Typography sx={CLUB_RECORD}><TextGhost>10–5</TextGhost></Typography>
                </Box>
              ))}
            </Box>
            <SectionHeading>Where the players are from</SectionHeading>
            <Box aria-hidden sx={{ visibility: 'hidden' }}>
              <PillGroup mb={1.25} value="all" onChange={() => {}} options={[
                { value: 'all', label: 'All 118' }, { value: 'played', label: 'Played 69' },
              ]} />
            </Box>
            <Box aria-hidden sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
              {/* Eleven chips at the lengths of the 2026 roster's country names. */}
              {[3, 6, 9, 5, 6, 11, 7, 6, 11, 14, 9].map((n, i) => (
                <Box key={i} sx={{ ...CHIP, borderColor: CARD_BORDER, bgcolor: 'action.hover' }}>
                  {flags && <TextGhost hidden>🏳</TextGhost>}
                  <Typography component="span" sx={CHIP_NAME}><TextGhost hidden>{'x'.repeat(n)}</TextGhost></Typography>
                  <Typography component="span" sx={CHIP_COUNT}><TextGhost hidden>0</TextGhost></Typography>
                </Box>
              ))}
            </Box>
          </>
        )}

        {teams.length > 0 && (
          <>
            <SectionHeading seen="league">The clubs</SectionHeading>
            {/* A RULED TABLE, NOT CARDS. Four bordered cards with a club-color stripe down each
                left edge read as template filler; a plain list with row rules is how a stat page
                sets four clubs, and the badge already carries the club's color. Ordered by the
                regular-season table, city as the tiebreak (and the whole order before a game). */}
            <Box sx={CLUB_TABLE}>
              <Box aria-hidden sx={CLUB_HEAD}><span>Club</span><span>{year != null && `${year} `}W–L</span></Box>
              {[...teams].sort((a, b) => {
                const ra = standings.findIndex(x => x.team.id === a.id)
                const rb = standings.findIndex(x => x.team.id === b.id)
                return anyFinal && ra !== rb ? ra - rb : a.city.localeCompare(b.city)
              }).map(t => {
                const record = recordOf(t.id)
                return (
                  <Box key={t.id} {...link(wpblTeamPath(t, teams))} sx={{
                    ...FOCUS_RING, ...CLUB_ROW, ...TAPPABLE,
                    textDecoration: 'none', color: 'text.primary',
                  }}>
                    <TeamBadge team={t} size={28} />
                    <Typography sx={{ ...CLUB_NAME, flex: 1, minWidth: 0 }}>{wpblFullName(t)}</Typography>
                    <Typography sx={CLUB_RECORD}>{record ?? '—'}</Typography>
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
            {appeared && (
              <PillGroup mb={1.25} value={playedOnly ? 'played' : 'all'}
                onChange={v => {
                  const on = v === 'played'
                  setPlayedOnly(on)
                  // A country with nobody who played has no chip under the filter, so it cannot
                  // stay picked with nothing on screen to unpick it.
                  if (on && country && !countries.find(c => c.country === country)?.players.some(p => appeared.has(p.id))) setCountry(null)
                  track(EVENTS.WPBL_PAGE_CONTROL, { page: 'league', control: 'played', value: v })
                }}
                options={[
                  { value: 'all', label: `All ${players.length}` },
                  { value: 'played', label: `Played ${players.filter(p => appeared.has(p.id)).length}` },
                ]} />
            )}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
              {chips.map(c => {
                const active = country === c.country
                return (
                  <Box key={c.country}
                    {...pressable(() => {
                      setCountry(active ? null : c.country)
                      track(EVENTS.WPBL_PAGE_CONTROL, { page: 'league', control: 'country', value: active ? null : c.country })
                    })}
                    aria-pressed={active}
                    sx={{
                      ...FOCUS_RING, ...CHIP,
                      cursor: 'pointer', userSelect: 'none',
                      borderColor: active ? 'primary.main' : CARD_BORDER,
                      bgcolor: active ? 'primary.main' : 'transparent',
                      color: active ? 'primary.contrastText' : 'text.primary',
                      ...(active ? null : TAPPABLE),
                    }}>
                    {flags && c.flag && <Box component="span" aria-hidden>{c.flag}</Box>}
                    <Typography component="span" sx={CHIP_NAME}>{c.country}</Typography>
                    <Typography component="span" sx={{
                      ...CHIP_COUNT,
                      color: active ? 'inherit' : 'text.secondary', opacity: active ? 0.85 : 1,
                    }}>{c.shown}</Typography>
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
                      px: 1, py: 0.6, display: shows(p) ? 'block' : 'none', ...TAPPABLE,
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

        {!loading && countries.length === 0 && (
          <Typography sx={{ color: 'text.secondary', mt: 2 }}>
            The roster loads here once the league feed has been ingested.
          </Typography>
        )}
      </Box>
    </WpblPage>
  )
}

// Shared by the loaded blocks and their skeletons, so the two cannot drift apart.
// Capped so the record sits near the name on a desktop rather than a screen's width away.
const CLUB_TABLE = { maxWidth: chromePx(520), mb: 1 } as const
const CLUB_HEAD = {
  display: 'flex', justifyContent: 'space-between', px: 1, pb: 0.5,
  borderBottom: '1px solid', borderColor: 'divider',
  fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary',
} as const
const CLUB_ROW = {
  display: 'flex', alignItems: 'center', gap: 1.25, px: 1, py: 1,
  borderBottom: '1px solid', borderColor: 'divider',
} as const
const CLUB_NAME = { fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.3 } as const
const CLUB_RECORD = { fontSize: TYPE_SCALE.body, fontWeight: 600, fontVariantNumeric: 'tabular-nums' } as const
const CHIP = {
  display: 'inline-flex', alignItems: 'center', gap: 0.6,
  px: 1, py: 0.5, borderRadius: 1, border: '1px solid',
} as const
const CHIP_NAME = { fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'inherit' } as const
const CHIP_COUNT = { fontSize: TYPE_SCALE.meta, fontWeight: 700, fontVariantNumeric: 'tabular-nums' } as const

const inlineLink = {
  color: 'var(--wpbl-accent-fg)', fontWeight: 700, textDecoration: 'none',
  '&:hover': { textDecoration: 'underline' },
} as const
