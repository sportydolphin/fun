// /wpbl/series/<a>-vs-<b>: one pairing of clubs over the season.
//
// SIX PAGES, ONE PER PAIRING, AND THE ONLY PAGES BUILT AROUND ONE. Four clubs play the same six
// series all season, so "how have the Firebells done against Boston" is the question a fan of this
// league asks most, and until now the answer was a 4-1 chip on a club page. Here it is the record,
// every meeting with a link into Game Center, who hit and who pitched in those games, and which
// batter had the better of which pitcher. All of it from data the section already holds.
//
// IN THE SITEMAP, unlike a player comparison: six pages a reader can search for by name, not
// thousands of machine-made pairs. See WPBL_SERIES_BASE in routes.ts.
//
// EVERY READ IS ALREADY CACHED APP-WIDE (the schedule, the clubs, the roster, the league's lines and
// its plate appearances), so a reader arriving from the standings or a club page costs nothing. The
// plays only feed the matchups at the bottom, and nothing above them waits on that read.
//
// LOADING IS THE PAGE DRAWN EMPTY: the title (the slug names both clubs, and the bundled club list
// can spell them before any read), the record box, five meetings, five leaders a side and five
// matchups a side, each at its loaded size.
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, Skeleton, useMediaQuery, useTheme } from '@mui/material'
import {
  fetchWpblSchedule, getCachedWpblSchedule, fetchWpblTeams, getCachedWpblTeams,
  fetchWpblAllPlayers, getCachedWpblAllPlayers, fetchWpblAllLines, getCachedWpblAllLines,
  fetchWpblAllMatchupPlays, getCachedWpblAllMatchupPlays, computeStandings,
} from './api'
import { seasonSeries, seriesGames, seriesLeaders, seriesQualifiers, type SeriesMeeting } from './derive/seasonSeries'
import { batterPitcherMatchups, matchupBoard, type WpblMatchupLine } from './derive/matchups'
import { buildBracket } from './derive/bracket'
import type { SeasonScope } from './season'
import { fmtRate } from './stats'
import { outsToIp } from './innings'
import {
  WPBL_MATCHUPS_PAGE, findWpblSeriesPair, wpblSeriesSlugFromPath, wpblSeriesPath,
  wpblComparePath, wpblGamePath, wpblPlayerPath, wpblTeamPath,
} from './routes'
import { SegNav, TeamBadge, TYPE_SCALE, FOCUS_RING, TextGhost, LeaderRow, hoverOnly, pressable, chromePx } from './ui'
import { SECTION_CAPTION_SX, useRankInk } from './cardParts'
import { WpblLinkProvider } from './LinkContext'
import { useEraBasis } from './EraBasisContext'
import { WPBL_TEAMS, wpblFullName } from './constants'
import WpblPage, { SectionHeading } from './WpblPage'
import { setDynamicSeo } from '../seo'
import { linkTo, UNSTYLED_LINK } from '../nav'
import { track, EVENTS } from '../lib/analytics'
import type { WpblGame, WpblPlayer, WpblTeam } from './types'

const isModified = (e: React.MouseEvent) =>
  e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

/** Rows per board. Five meetings is a regular-season series, and five a side is as many leaders
 *  and matchups as clear the bar in most pairings. */
const ROWS = 5

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })

type Club = Pick<WpblTeam, 'id' | 'name' | 'city' | 'abbr'>

export default function WpblSeriesPage({ path, onNavigate, onOpenGame }: {
  path: string
  /** The shell's navigation for a standalone page: a player or a pair opens over this page. */
  onNavigate: (to: string) => void
  onOpenGame: (g: WpblGame, ctx: { teams: WpblTeam[]; games: WpblGame[] }) => void
}) {
  const [games, setGames] = useState<WpblGame[]>(() => getCachedWpblSchedule() ?? [])
  const [teams, setTeams] = useState<WpblTeam[]>(() => getCachedWpblTeams() ?? [])
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [lines, setLines] = useState(() => getCachedWpblAllLines())
  const [plays, setPlays] = useState(() => getCachedWpblAllMatchupPlays())
  const [loading, setLoading] = useState(() => !getCachedWpblSchedule() || !getCachedWpblAllLines())
  const [scope, setScope] = useState<SeasonScope>('regular')

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblSchedule(), fetchWpblTeams(), fetchWpblAllPlayers(), fetchWpblAllLines()])
      .then(([g, t, p, l]) => {
        if (cancelled) return
        setGames(g); setTeams(t); setPlayers(p); setLines(l)
      })
      .catch(() => { /* the empty states below are the whole error path */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    // Its own promise: the matchups are the last block on the page and nothing above waits on them.
    fetchWpblAllMatchupPlays().then(pl => { if (!cancelled) setPlays(pl) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // The bundled club list names the pair before the clubs' read lands, so the title is real from
  // the first frame. Drawn in the canonical (alphabetical) order whichever way the address has it,
  // so the page always reads the way its canonical URL and every link to it do. Production 301s
  // the other spelling anyway; this covers a client-side move to it.
  const clubs: Club[] = teams.length > 0 ? teams : Object.values(WPBL_TEAMS)
  const slug = wpblSeriesSlugFromPath(path) ?? ''
  const pair = findWpblSeriesPair(slug, clubs)
  const [A, B] = pair ? [...pair].sort((x, y) => x.name.localeCompare(y.name)) : [null, null]
  const canonical = A && B ? wpblSeriesPath(A, B, clubs) : null

  useEffect(() => {
    if (!A || !B || !canonical) return
    const here = path.replace(/\/+$/, '')
    setDynamicSeo({
      path: here,
      seo: {
        title: `${A.name} vs ${B.name}: the 2026 WPBL season series | sportydolphin.fun`,
        description: `The ${wpblFullName(A)} against the ${wpblFullName(B)} in the 2026 Women's Pro Baseball League: the season series, every meeting, the leaders in those games and the batter vs pitcher matchups between them.`,
        canonical,
      },
    })
    return () => setDynamicSeo(null)
  }, [A, B, canonical, path])

  if (!A || !B) return <NotASeries clubs={clubs} />

  return (
    <WpblLinkProvider roster={players} schedule={games} teams={teams}>
      <SeriesBody
        A={A} B={B} clubs={clubs} teams={teams} games={games} players={players}
        lines={lines} plays={plays} loading={loading} scope={scope} setScope={setScope}
        onNavigate={onNavigate} onOpenGame={onOpenGame}
      />
    </WpblLinkProvider>
  )
}

function SeriesBody({ A, B, clubs, teams, games, players, lines, plays, loading, scope, setScope, onNavigate, onOpenGame }: {
  A: Club; B: Club; clubs: Club[]; teams: WpblTeam[]; games: WpblGame[]; players: WpblPlayer[]
  lines: ReturnType<typeof getCachedWpblAllLines>
  plays: ReturnType<typeof getCachedWpblAllMatchupPlays>
  loading: boolean
  scope: SeasonScope; setScope: (s: SeasonScope) => void
  onNavigate: (to: string) => void
  onOpenGame: (g: WpblGame, ctx: { teams: WpblTeam[]; games: WpblGame[] }) => void
}) {
  const ink = useRankInk()
  const { fmtEra } = useEraBasis()
  const skeleton = loading && games.length === 0

  const series = useMemo(() => seasonSeries(games, A.id, B.id), [games, A.id, B.id])
  // The bracket names a postseason meeting ("Semifinal A"), so a reader can tell a final from a
  // semifinal without opening the game.
  const round = useMemo(() => {
    if (!series.postseason || teams.length === 0) return null
    const bracket = buildBracket(computeStandings(teams, games), games)
    const all = bracket ? [...bracket.semifinals, bracket.championship] : []
    return all.find(s => {
      const ids = [s.home.team?.id, s.away.team?.id]
      return ids.includes(A.id) && ids.includes(B.id)
    }) ?? null
  }, [series.postseason, teams, games, A.id, B.id])

  const hasPostseason = series.postseason != null
  const effScope: SeasonScope = hasPostseason ? scope : 'regular'
  const leaders = useMemo(
    () => (lines ? seriesLeaders(players, lines.batting, lines.pitching, games, A.id, B.id, effScope) : null),
    [players, lines, games, A.id, B.id, effScope])

  const matchupLines = useMemo(() => {
    if (!plays) return null
    const ids = new Set(seriesGames(games, A.id, B.id).map(g => g.id))
    return batterPitcherMatchups(plays.filter(p => ids.has(p.game_id)), games, { scope: effScope })
  }, [plays, games, A.id, B.id, effScope])
  const batterEdge = useMemo(() => (matchupLines ? matchupBoard(matchupLines, 'batter').slice(0, ROWS) : []), [matchupLines])
  const pitcherEdge = useMemo(() => (matchupLines ? matchupBoard(matchupLines, 'pitcher').slice(0, ROWS) : []), [matchupLines])

  const playerById = useMemo(() => new Map(players.map(p => [p.id, p])), [players])
  const openPlayer = (p: WpblPlayer) => onNavigate(wpblPlayerPath(p, players))

  const { regular, postseason } = series
  const played = regular.aWins + regular.bWins
  const others = useMemo(() => {
    const out: { href: string; label: string }[] = []
    for (let i = 0; i < clubs.length; i++) {
      for (let j = i + 1; j < clubs.length; j++) {
        // Named in the URL's order, so a label and the page it opens agree on which club comes first.
        const [x, y] = [clubs[i], clubs[j]].sort((p, q) => p.name.localeCompare(q.name))
        if ([x.id, y.id].includes(A.id) && [x.id, y.id].includes(B.id)) continue
        out.push({ href: wpblSeriesPath(x, y, clubs), label: `${x.name} vs ${y.name}` })
      }
    }
    return out.sort((p, q) => p.label.localeCompare(q.label))
  }, [clubs, A.id, B.id])

  // `noSsr` so the first frame already draws the tiles: rows that became tiles after mount would
  // reflow the whole page under them.
  const tiles = useMediaQuery(useTheme().breakpoints.up('md'), { noSsr: true })
  const [postOpen, setPostOpen] = useState(false)
  const regularMeetings = series.meetings.filter(m => !m.postseason)
  const postMeetings = series.meetings.filter(m => m.postseason)
  const meetingRow = (m: SeriesMeeting) => (
    <MeetingRow
      key={m.game.id} m={m} clubs={clubs} A={A} B={B} round={round?.label ?? null}
      meetingNo={series.meetings.filter(x => x.postseason === m.postseason && x.game.game_date <= m.game.game_date).length}
      standing={standing}
      href={teams.length > 0 ? wpblGamePath(m.game, teams, games) : null}
      onOpen={() => onOpenGame(m.game, { teams, games })}
      tile={tiles}
    />
  )

  const standing = (aw: number, bw: number) =>
    aw === bw ? `Tied ${aw}–${bw}` : aw > bw ? `${A.abbr} ${aw}–${bw}` : `${B.abbr} ${bw}–${aw}`

  const leader = regular.aWins > regular.bWins ? A.name : B.name
  const verdict = skeleton ? null
    : played === 0 ? (series.meetings.length > 0 ? 'Season series not started' : 'No meetings scheduled')
    : series.remaining > 0
      ? (regular.aWins === regular.bWins ? 'Season series tied' : `${leader} lead the season series`)
      : (regular.aWins === regular.bWins ? 'Season series split' : `${leader} won the season series`)

  const scopeNote = effScope === 'regular' ? 'the regular season' : effScope === 'postseason' ? 'the postseason' : 'every meeting'
  const qual = leaders ? seriesQualifiers(leaders.gamesPlayed) : null

  return (
    <WpblPage
      title={`${A.name} vs ${B.name}`}
      standfirst={`The ${wpblFullName(A)} and the ${wpblFullName(B)} in 2026: every meeting, the leaders in those games, and which batters had the better of which pitchers.`}
    >
      {/* ── The record ─────────────────────────────────────────────────── */}
      <Box sx={{
        display: 'grid', alignItems: 'center',
        gridTemplateColumns: { xs: 'minmax(0, 1fr) minmax(0, 1fr)', md: 'minmax(0, 1fr) auto minmax(0, 1fr)' },
        columnGap: { xs: 1, sm: 2, md: 3 }, rowGap: { xs: 1, md: 1.5 }, p: { xs: 1.5, sm: 2, md: 3 }, borderRadius: 2,
        border: '1px solid', borderColor: 'outline', bgcolor: 'background.paper',
      }}>
        {/* Two columns and nothing between them on a phone. A middle column holding the verdict
            changed width as it landed and moved both sides; a label there left a phone 57px for
            "Firebells". The verdict and the runs take their own full-width lines under the clubs.
            On a desktop the middle holds only a dash, whose width never changes, and each club
            gathers toward it like a scoreboard: pinned to the card's far edges, the two win counts
            sat 900px apart around an empty band. */}
        <ClubSide club={A} clubs={clubs} wins={regular.aWins} skeleton={skeleton} align="left" />
        <Typography aria-hidden sx={{ display: { xs: 'none', md: 'block' }, fontSize: '2.5rem', fontWeight: 300, lineHeight: 1, color: 'text.secondary' }}>–</Typography>
        <ClubSide club={B} clubs={clubs} wins={regular.bWins} skeleton={skeleton} align="right" />
        <Box sx={{ gridColumn: '1 / -1', textAlign: 'center', '& > *': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }}>
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700 }}>
            {skeleton ? <TextGhost>Firebells won the season series</TextGhost> : verdict}
          </Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
            {skeleton ? <TextGhost>Runs: Firebells 00, Queens 00</TextGhost> : `Runs: ${A.name} ${regular.aRuns}, ${B.name} ${regular.bRuns}`}
          </Typography>
        </Box>
      </Box>
      {/* ── Every meeting ──────────────────────────────────────────────── */}
      {/* THE SAME SHAPE FOR EVERY PAIR: the regular season's meetings, then one postseason row,
          which says the pair did not meet there or holds the series result and opens its games.
          Listed in full, the final's five games made one page five rows longer than the next, a
          length nothing can know before the schedule lands, so the page jumped when it did. */}
      <SectionHeading seen="series">Every meeting</SectionHeading>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, ...(tiles ? MEETING_GRID_SX : {}) }} aria-hidden={skeleton || undefined}>
        {skeleton
          ? Array.from({ length: ROWS + 1 }, (_, i) => <MeetingGhost key={i} tile={tiles} />)
          : <>
            {regularMeetings.map(m => meetingRow(m))}
            <PostseasonRow
              post={postseason
                ? (round ? { title: round.label, result: round.summary } : { title: 'Postseason', result: standing(postseason.aWins, postseason.bWins) })
                : null}
              count={postMeetings.length} open={postOpen} tile={tiles}
              onToggle={() => {
                setPostOpen(o => !o)
                track(EVENTS.WPBL_PAGE_CONTROL, { page: 'series', control: 'postseason_games', value: postOpen ? 'close' : 'open' })
              }}
            />
            {postOpen && postMeetings.map(m => meetingRow(m))}
          </>}
      </Box>
      {!skeleton && series.meetings.length === 0 && (
        <Typography sx={{ color: 'text.secondary', fontSize: TYPE_SCALE.body, py: 2 }}>
          These two clubs have no games on the schedule yet.
        </Typography>
      )}

      {/* ── In these games ─────────────────────────────────────────────── */}
      <SectionHeading seen="series">Series leaders</SectionHeading>
      {/* Drawn for every pair and only hidden for one that never met in the postseason, so the
          leaders below sit at the same depth on all six pages and do not move when the
          schedule lands. */}
      {/* A desktop puts the caption beside the toggle it describes, rather than a lone toggle at
          the right edge over a caption at the left. */}
      <Box sx={{
        display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) auto' }, alignItems: 'center',
        columnGap: 3, mb: 1,
      }}>
      <Box sx={{ mb: { xs: 1.5, md: 0 }, gridRow: { md: 1 }, gridColumn: { md: 2 }, visibility: hasPostseason || skeleton ? 'visible' : 'hidden' }} aria-hidden={!hasPostseason || undefined}>
        <SegNav
          options={[
            { value: 'regular', label: 'Regular' },
            { value: 'postseason', label: 'Playoffs' },
            { value: 'all', label: 'Both' },
          ]}
          value={effScope}
          onChange={v => {
            setScope(v as SeasonScope)
            track(EVENTS.WPBL_PAGE_CONTROL, { page: 'series', control: 'scope', value: v })
          }}
          mb={0}
          size="sm"
        />
      </Box>
      <Typography sx={{ ...SECTION_CAPTION_SX, mb: 0, gridRow: { md: 1 }, gridColumn: { md: 1 } }}>
        {qual
          ? `In ${scopeNote} between these clubs. At least ${qual.minPa} plate appearances or ${outsToIp(qual.minOuts)} innings.`
          : <TextGhost>In the regular season between these clubs. At least 12 plate appearances or 4.0 innings.</TextGhost>}
      </Typography>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: 4, rowGap: 2 }}>
        <Board title="At the plate" empty="Nobody has enough plate appearances in these games yet." skeleton={!leaders}>
          {leaders?.batters.slice(0, ROWS).map((b, i) => {
            const t = b.season.totals
            return (
              <LeaderRow
                key={b.season.player.id} rank={i + 1} player={b.season.player} name={b.season.player.name}
                teamId={b.teamId} value={fmtRate(t.ops)} unit="OPS" accent={ink} onOpen={openPlayer}
                sub={`${t.h}-for-${t.ab}${t.hr ? `, ${t.hr} HR` : ''}${t.rbi ? `, ${t.rbi} RBI` : ''}${t.bb ? `, ${t.bb} BB` : ''}`}
              />
            )
          })}
        </Board>
        <Board title="On the mound" empty="Nobody has enough innings in these games yet." skeleton={!leaders}>
          {leaders?.pitchers.slice(0, ROWS).map((p, i) => {
            const t = p.season.totals
            return (
              <LeaderRow
                key={p.season.player.id} rank={i + 1} player={p.season.player} name={p.season.player.name}
                teamId={p.teamId} value={fmtEra(t.era)} unit="ERA" accent={ink} onOpen={openPlayer}
                sub={`${outsToIp(t.outs)} IP, ${t.so} SO, ${t.bb} BB${t.w ? `, ${t.w}-${t.l}` : ''}`}
              />
            )
          })}
        </Board>
      </Box>

      {/* ── Batter vs pitcher ──────────────────────────────────────────── */}
      <SectionHeading seen="series">Batter vs pitcher</SectionHeading>
      <Typography sx={{ ...SECTION_CAPTION_SX, mb: 1 }}>
        The most lopsided matchups between these clubs in {scopeNote}, three plate appearances or more.{' '}
        <Box component="a" {...linkTo(WPBL_MATCHUPS_PAGE)} sx={{
          // UNDERLINED: it is the colour of the sentence it ends, so the line is the only thing
          // that says it is a link (1.02:1 against the text around it in light mode).
          ...UNSTYLED_LINK, color: ink, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: '2px', ...FOCUS_RING,
        }}>
          Every matchup in the league
        </Box>
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: 4, rowGap: 2 }}>
        <Board title="Batter edge" empty="No batter has a clear edge over a pitcher in these games." skeleton={!matchupLines}>
          {batterEdge.map(l => (
            <MatchupRow key={`${l.batterId}|${l.pitcherId}`} l={l} lead="batter" clubs={clubs} ink={ink}
              href={pairHref(l, 'batter', playerById, players)} onNavigate={onNavigate} />
          ))}
        </Board>
        <Board title="Pitcher edge" empty="No pitcher has a clear edge over a batter in these games." skeleton={!matchupLines}>
          {pitcherEdge.map(l => (
            <MatchupRow key={`${l.batterId}|${l.pitcherId}`} l={l} lead="pitcher" clubs={clubs} ink={ink}
              href={pairHref(l, 'pitcher', playerById, players)} onNavigate={onNavigate} />
          ))}
        </Board>
      </Box>

      {/* ── The other five ─────────────────────────────────────────────── */}
      {/* Real links to every other pairing, so each of the six pages is one step from the rest. */}
      <SectionHeading>The other series</SectionHeading>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {others.map(o => (
          <Box key={o.href} {...linkTo(o.href)} sx={{
            ...UNSTYLED_LINK, fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'text.secondary',
            px: 1.25, py: 0.6, borderRadius: 999, border: '1px solid', borderColor: 'outline',
            ...hoverOnly({ color: 'text.primary', borderColor: 'text.secondary' }), ...FOCUS_RING,
          }}>{o.label}</Box>
        ))}
      </Box>
    </WpblPage>
  )
}

/** The compare path for a matchup, with whoever has the edge first, as /wpbl/matchups builds it. */
function pairHref(l: WpblMatchupLine, lead: 'batter' | 'pitcher', byId: Map<string, WpblPlayer>, roster: WpblPlayer[]): string | null {
  const b = byId.get(l.batterId), p = byId.get(l.pitcherId)
  if (!b || !p) return null
  return lead === 'pitcher' ? wpblComparePath(p, b, roster) : wpblComparePath(b, p, roster)
}

function ClubSide({ club, clubs, wins, skeleton, align }: {
  club: Club; clubs: Club[]; wins: number; skeleton: boolean; align: 'left' | 'right'
}) {
  const right = align === 'right'
  // `noSsr` so the first frame already has the desktop badge: a 44px badge that grew to 64 after
  // mount would move the whole page under it.
  const wide = useMediaQuery(useTheme().breakpoints.up('md'), { noSsr: true })
  // One set of elements, placed by grid areas: on a phone the wins sit over the name beside the
  // badge; on a desktop all three run in a line with the wins on the inner side, next to the dash.
  const areas = right
    ? { xs: '"wins badge" "name badge"', md: '"wins name badge"' }
    : { xs: '"badge wins" "badge name"', md: '"badge name wins"' }
  return (
    <Box
      {...linkTo(wpblTeamPath(club, clubs))}
      sx={{
        ...UNSTYLED_LINK, display: 'grid', alignItems: 'center', minWidth: 0, maxWidth: '100%',
        gridTemplateAreas: areas,
        gridTemplateColumns: right
          ? { xs: 'minmax(0, 1fr) auto', md: 'auto minmax(0, auto) auto' }
          : { xs: 'auto minmax(0, 1fr)', md: 'auto minmax(0, auto) auto' },
        columnGap: { xs: 1, sm: 1.5, md: 2 },
        justifySelf: { md: right ? 'start' : 'end' },
        textAlign: right ? 'right' : 'left',
        borderRadius: 1, ...FOCUS_RING,
      }}
    >
      <Box sx={{ gridArea: 'badge', display: 'flex' }}><TeamBadge team={club} size={wide ? 64 : 44} /></Box>
      <Typography sx={{ gridArea: 'wins', fontSize: { xs: '2rem', md: '3rem' }, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {skeleton ? <TextGhost>0</TextGhost> : wins}
      </Typography>
      <Box sx={{ gridArea: 'name', minWidth: 0 }}>
        <Typography sx={{ display: { xs: 'none', md: 'block' }, fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {club.city}
        </Typography>
        <Typography sx={{
          fontSize: { xs: TYPE_SCALE.meta, md: TYPE_SCALE.heading }, fontWeight: { xs: 700, md: 800 },
          color: { xs: 'text.secondary', md: 'text.primary' }, lineHeight: { md: 1.2 },
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {club.name}
        </Typography>
      </Box>
    </Box>
  )
}

/** The phone list's one row grid, shared by the meeting rows, the postseason row and their ghosts
 *  so all of them are the same height and the columns line up down the list. */
const MEETING_ROW_SX = {
  display: 'grid', gridTemplateColumns: '3.5rem minmax(0, 1fr) auto', alignItems: 'center',
  columnGap: 1, py: 1, px: 0.5, borderRadius: 1,
} as const

/** The meetings as tiles on a desktop: three across, six from lg, where five meetings and the
 *  postseason tile make one row. As rows they ran the column's full 1100px with a date at one end,
 *  a standing at the other and a few words of score between, which was mostly empty space. */
const MEETING_GRID_SX = {
  display: 'grid', gap: 1.5,
  gridTemplateColumns: { md: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(6, minmax(0, 1fr))' },
} as const

/** A tile's frame: a bordered card, the same for a meeting, the postseason and their ghosts, so
 *  every tile in a row is one height. */
const TILE_SX = {
  display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0, height: '100%', boxSizing: 'border-box',
  p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'outline', bgcolor: 'background.paper',
} as const

const LI_ROW_SX = { borderTop: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: '1px solid', borderBottomColor: 'divider' } } as const
const ONE_LINE = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 } as const

/** A tile's top line: what it is on the left, the series or the round on the right. */
function TileHead({ left, right, rightSx }: { left: React.ReactNode; right: React.ReactNode; rightSx?: object }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, minWidth: 0 }}>
      <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{left}</Typography>
      <Typography component="span" sx={{ ...ONE_LINE, fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', ...rightSx }}>{right}</Typography>
    </Box>
  )
}

/** One meeting: date, both clubs and their runs with the winner in full weight, and either the
 *  running series or the postseason game on the right. The whole row, or tile, is the game's link.
 *  A tile lists the clubs away over home, the way a box score does, so it needs no "at". */
function MeetingRow({ m, A, B, clubs, round, meetingNo, standing, href, onOpen, tile }: {
  m: SeriesMeeting; A: Club; B: Club; clubs: Club[]; round: string | null; meetingNo: number
  standing: (a: number, b: number) => string
  href: string | null; onOpen: () => void; tile: boolean
}) {
  const g = m.game
  const away = clubs.find(c => c.id === g.away_team_id) ?? (g.away_team_id === A.id ? A : B)
  const home = clubs.find(c => c.id === g.home_team_id) ?? (g.home_team_id === A.id ? A : B)
  const final = g.status === 'final'
  const ink = (c: Club) => ({
    fontSize: TYPE_SCALE.body, fontVariantNumeric: 'tabular-nums',
    fontWeight: m.winnerId === c.id ? 800 : 600,
    color: m.winnerId && m.winnerId !== c.id ? 'text.secondary' : 'text.primary',
  }) as const
  const side = (c: Club, score: number | null) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
      <TeamBadge team={c} size={18} />
      <Typography component="span" sx={ink(c)}>
        {c.abbr}{final && score != null ? ` ${score}` : ''}
      </Typography>
    </Box>
  )
  const line = (c: Club, score: number | null) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <TeamBadge team={c} size={20} />
      <Typography component="span" sx={{ ...ink(c), ...ONE_LINE, flex: 1 }}>{c.name}</Typography>
      {final && score != null && <Typography component="span" sx={ink(c)}>{score}</Typography>}
    </Box>
  )
  const right = m.postseason
    ? (tile ? `Game ${meetingNo}` : `${round ?? 'Postseason'}, game ${meetingNo}`)
    : m.tally ? standing(m.tally.a, m.tally.b)
    : g.status === 'scheduled' ? 'Scheduled' : (g.status_detail ?? '')
  const link = href ? {
    href,
    onClick: (e: React.MouseEvent) => { if (!isModified(e)) { e.preventDefault(); onOpen() } },
  } : {}
  const linkSx = href ? { cursor: 'pointer', ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING } : {}
  if (tile) {
    return (
      <Box component="li" sx={{ minWidth: 0 }}>
        <Box component={href ? 'a' : 'div'} {...link} sx={{ ...UNSTYLED_LINK, ...TILE_SX, ...linkSx }}>
          <TileHead left={shortDate(g.game_date)} right={right} rightSx={m.postseason ? { color: 'text.primary' } : undefined} />
          {line(away, g.away_score)}
          {line(home, g.home_score)}
        </Box>
      </Box>
    )
  }
  return (
    <Box component="li" sx={LI_ROW_SX}>
      <Box component={href ? 'a' : 'div'} {...link} sx={{ ...UNSTYLED_LINK, ...MEETING_ROW_SX, ...linkSx }}>
        <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          {shortDate(g.game_date)}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          {side(away, g.away_score)}
          <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled' }}>at</Typography>
          {side(home, g.home_score)}
        </Box>
        <Typography component="span" sx={{
          fontSize: TYPE_SCALE.meta, fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap',
          color: m.postseason ? 'text.primary' : 'text.secondary',
        }}>{right}</Typography>
      </Box>
    </Box>
  )
}

/** The postseason, as one row in the meetings list or one tile in the grid: the series result and
 *  a toggle for its games, or a plain line when the pair did not meet there. Built on the meeting's
 *  own row grid or tile frame, so it is a meeting's height whichever it is. */
function PostseasonRow({ post, count, open, onToggle, tile }: {
  /** The round and its result, or null when the pair did not meet in the postseason. */
  post: { title: string; result: string } | null
  count: number; open: boolean; onToggle: () => void; tile: boolean
}) {
  const toggles = post != null && count > 0
  const toggleSx = toggles ? { cursor: 'pointer', userSelect: 'none', ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING } : {}
  const toggleProps = toggles ? { ...pressable(onToggle), 'aria-expanded': open } : {}
  const control = toggles && (
    <>
      {/* The noun goes on a phone, where "Championship: Queens win 3-2" needs its room in large
          text; the count and the arrow still say what the control does. */}
      {open ? 'Hide' : count}
      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{open ? ' games' : ` ${count === 1 ? 'game' : 'games'}`}</Box>
      {open ? ' ▴' : ' ▾'}
    </>
  )
  if (tile) {
    return (
      <Box component="li" sx={{ minWidth: 0 }}>
        {/* The round heads the tile where a meeting's date does, and the toggle takes a line of its
            own: six across, a tile has no room for "Playoffs" and "5 games" side by side. */}
        <Box {...toggleProps} sx={{ ...TILE_SX, ...toggleSx }}>
          <TileHead left={post?.title ?? 'Playoffs'} right={null} />
          <Typography sx={{ ...ONE_LINE, fontSize: TYPE_SCALE.body, fontWeight: 700, color: post ? 'text.primary' : 'text.secondary' }}>
            {post?.result ?? 'Did not meet'}
          </Typography>
          <Typography sx={{ ...ONE_LINE, fontSize: TYPE_SCALE.body, ...(toggles ? { fontWeight: 800, color: 'var(--wpbl-accent-fg)' } : { color: 'text.secondary' }) }}>
            {toggles ? control : post ? ' ' : 'in the postseason'}
          </Typography>
        </Box>
      </Box>
    )
  }
  const label = (
    <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary' }}>Playoffs</Typography>
  )
  return (
    <Box component="li" sx={LI_ROW_SX}>
      <Box {...toggleProps} sx={{ ...MEETING_ROW_SX, width: '100%', ...toggleSx }}>
        {label}
        <Typography component="span" sx={{
          ...(toggles ? { ...ONE_LINE, fontWeight: 700 } : { color: 'text.secondary' }), fontSize: TYPE_SCALE.body,
        }}>
          {post ? `${post.title}: ${post.result}` : 'Did not meet in the postseason'}
        </Typography>
        {toggles
          ? <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'var(--wpbl-accent-fg)', whiteSpace: 'nowrap' }}>{control}</Typography>
          : <span />}
      </Box>
    </Box>
  )
}

function MeetingGhost({ tile }: { tile: boolean }) {
  if (tile) {
    return (
      <Box component="li" sx={{ minWidth: 0 }}>
        <Box sx={TILE_SX}>
          <TileHead left={<TextGhost>Aug 00</TextGhost>} right={<TextGhost>SF 0–0</TextGhost>} />
          {[0, 1].map(i => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              {/* chromePx, as TeamBadge sizes itself: a raw 20 is a smaller circle than the badge on a desktop. */}
              <Skeleton variant="circular" width={chromePx(20)} height={chromePx(20)} sx={{ flexShrink: 0 }} />
              <Typography component="span" sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, flex: 1 }}><TextGhost>Firebells</TextGhost></Typography>
              <Typography component="span" sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}><TextGhost>0</TextGhost></Typography>
            </Box>
          ))}
        </Box>
      </Box>
    )
  }
  return (
    <Box component="li" sx={LI_ROW_SX}>
      <Box sx={MEETING_ROW_SX}>
        <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700 }}><TextGhost>Aug 00</TextGhost></Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {[0, 1].map(i => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <Skeleton variant="circular" width={18} height={18} />
              <Typography component="span" sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}><TextGhost>SF 0</TextGhost></Typography>
            </Box>
          ))}
        </Box>
        <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700 }}><TextGhost>SF 0–0</TextGhost></Typography>
      </Box>
    </Box>
  )
}

/** A titled list of up to five rows, with a ghost list while it loads and a line when it is empty. */
function Board({ title, empty, skeleton, children }: {
  title: string; empty: string; skeleton: boolean; children?: React.ReactNode[]
}) {
  const rows = children?.filter(Boolean) ?? []
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography component="h3" sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, mb: 0.5 }}>{title}</Typography>
      {skeleton ? (
        <Box aria-hidden>
          {Array.from({ length: ROWS }, (_, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 0.5, py: 0.85, borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider' }}>
              <Box sx={{ width: '1.125rem' }} />
              <Skeleton variant="circular" width={32} height={32} />
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}><TextGhost>Firstname Lastname</TextGhost></Typography>
                <Typography sx={{ fontSize: '0.72rem' }}><TextGhost>5-for-12, 1 HR</TextGhost></Typography>
              </Box>
              <Typography sx={{ fontSize: '1.05rem', fontWeight: 800 }}><TextGhost>1.000</TextGhost></Typography>
            </Box>
          ))}
        </Box>
      ) : rows.length === 0 ? (
        <Typography sx={{ color: 'text.secondary', fontSize: TYPE_SCALE.body, py: 1 }}>{empty}</Typography>
      ) : rows}
    </Box>
  )
}

/** One matchup: whoever has the edge, then the other, then the batter's line against the pitcher.
 *  The whole row is the link to the pair's comparison, which leads with this matchup. */
function MatchupRow({ l, lead, clubs, ink, href, onNavigate }: {
  l: WpblMatchupLine; lead: 'batter' | 'pitcher'; clubs: Club[]; ink: string
  href: string | null; onNavigate: (to: string) => void
}) {
  const badge = (ids: string[]) => {
    const c = clubs.find(x => x.id === ids[ids.length - 1])
    return c ? <TeamBadge team={c} size={16} /> : <Box sx={{ width: 16, flexShrink: 0 }} />
  }
  const [first, second] = lead === 'pitcher'
    ? [{ name: l.pitcherName, ids: l.pitcherTeamIds }, { name: l.batterName, ids: l.batterTeamIds }]
    : [{ name: l.batterName, ids: l.batterTeamIds }, { name: l.pitcherName, ids: l.pitcherTeamIds }]
  const nameSx = { fontSize: TYPE_SCALE.body, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const
  return (
    <Box
      component={href ? 'a' : 'div'}
      {...(href ? {
        href,
        'aria-label': `${l.batterName} against ${l.pitcherName}: the full matchup`,
        onClick: (e: React.MouseEvent) => {
          track(EVENTS.WPBL_COMPARE_OPENED, { from: 'series', pair: true })
          if (!isModified(e)) { e.preventDefault(); onNavigate(href) }
        },
      } : {})}
      sx={{
        ...UNSTYLED_LINK, display: 'flex', alignItems: 'center', gap: 1, px: 0.5, py: 0.85,
        borderTop: '1px solid', borderColor: 'divider', '&:first-of-type': { borderTop: 'none' },
        borderRadius: 1,
        ...(href ? { cursor: 'pointer', ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING } : {}),
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          {badge(first.ids)}
          <Typography component="span" sx={{ ...nameSx, fontWeight: 700 }}>{first.name}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, mt: 0.25 }}>
          {badge(second.ids)}
          <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', flexShrink: 0 }}>vs</Typography>
          <Typography component="span" sx={{ ...nameSx, fontSize: TYPE_SCALE.meta, fontWeight: 600, color: 'text.secondary' }}>{second.name}</Typography>
        </Box>
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, color: ink, lineHeight: 1.2 }}>
          {l.h}-for-{l.ab}
        </Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
          {[l.hr ? `${l.hr} HR` : null, l.bb ? `${l.bb} BB` : null, `${l.so} SO`].filter(Boolean).join(', ')}
        </Typography>
      </Box>
    </Box>
  )
}

/** A slug naming no pairing: say so, and offer the six that exist. */
function NotASeries({ clubs }: { clubs: Club[] }) {
  const all: { href: string; label: string }[] = []
  for (let i = 0; i < clubs.length; i++) {
    for (let j = i + 1; j < clubs.length; j++) {
      const [x, y] = [clubs[i], clubs[j]].sort((p, q) => p.name.localeCompare(q.name))
      all.push({ href: wpblSeriesPath(x, y, clubs), label: `${x.name} vs ${y.name}` })
    }
  }
  return (
    <WpblPage title="No such series" standfirst="That address does not name two clubs. These are the six season series.">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {all.map(o => (
          <Box key={o.href} {...linkTo(o.href)} sx={{ ...UNSTYLED_LINK, fontSize: TYPE_SCALE.body, fontWeight: 700, ...FOCUS_RING }}>{o.label}</Box>
        ))}
      </Box>
    </WpblPage>
  )
}
