import { useDark } from '../../ui/useDark'
import { useEffect, useRef } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { wpblAccent, wpblFullName } from '../constants'
import { WpblGamePreview } from '../GamePreview'
import { GameHighlightCards } from '../Highlights'
import { GameClips } from '../Watch'
import { WpblVisuallyHiddenH1 } from '../PageHeading'
import { wpblGameCard } from '../ogCard'
import { BoxTeamHeading, BoxTeamSwitch } from '../../ui/gameCenter'
import { usePhoneLayout, CARD_BORDER, TeamBadge, hoverOnly, FOCUS_RING } from '../ui'
import { typePx } from '../../ui/scale'
import { scrollBehavior } from '../../lib/motion'
import { GAME_PAGE_W } from '../layoutWidths'
import { DetailPageBar } from '../DetailPageBar'
import type { WpblTeam, WpblGame, WpblPlayer, WpblVideo } from '../types'
import { type Tab, EmptyBody } from './shared'

/**
 * Game Center as a desktop page: every board at once, no tabs.
 *
 * WHY NO TABS. The modal pages one board at a time because a phone has room for one, and that
 * shape carried over to the desktop, where it is the wrong one: a box score is read against the
 * recap that describes it, and tabs make a reader hold one in memory while they flip to the
 * other. The side panel keeps the phone's shape (it is phone-width); this is where the width goes.
 *
 * TWO COLUMNS from `lg`: the narrative on the left (Recap, or Live while the game is on, then the
 * play-by-play under it) and the numbers on the right (both box scores, stacked, then pitch data).
 * Each column is its own stack, so a long play log never pushes the box score down. Between `md`
 * and `lg` there is room for one column only, and the same four sections reflow into the order a
 * reader wants them in (narrative, box score, plays, pitch data) through `display: contents`
 * rather than a second tree.
 *
 * The tabs survive as JUMP LINKS in a pinned bar, so the boards a tab bar used to announce are
 * still named in one place and one click away.
 */
const PAGE_W = GAME_PAGE_W

// The page's boards: the modal's tabs, plus the three a game not yet played has (see the preview
// at the foot of GameCenterPage).
type Board = Tab | 'matchup' | 'leaders' | 'rosters'

const sectionId = (v: Board) => `gc-${v}`

const SECTION_LABEL: Record<Board, string> = {
  recap: 'Recap', live: 'Live', box: 'Box score', plays: 'Play-by-play', pitch: 'Pitch data',
  matchup: 'Matchup', leaders: 'Leaders', rosters: 'Rosters',
}

// Clears the toolbar and the jump bar pinned under it when a jump lands a section at the top.
const SECTION_SCROLL_MARGIN = 'calc(var(--app-header-h, 0px) + 3.5rem)'

/**
 * The page's two columns from `lg`, one below it. `display: contents` on each column below `lg`
 * hands its boards to the outer grid, where each board's `order` (see PageSection) puts all of
 * them in reading order, so one tree serves both arrangements.
 */
function PageColumns({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const col = { display: { xs: 'contents', lg: 'flex' }, flexDirection: 'column', gap: 2, minWidth: 0 } as const
  return (
    <Box sx={{
      display: 'grid', gap: 2, alignItems: 'start',
      gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1.25fr) minmax(0, 1fr)' },
    }}>
      <Box sx={col}>{left}</Box>
      <Box sx={col}>{right}</Box>
    </Box>
  )
}

function PageSection({ v, order, children }: { v: Board; order: number; children: React.ReactNode }) {
  return (
    <Box component="section" id={sectionId(v)} aria-labelledby={`${sectionId(v)}-h`} sx={{
      minWidth: 0, bgcolor: 'background.paper', border: '1px solid', borderColor: CARD_BORDER,
      borderRadius: 3, overflow: 'hidden', pb: 1.5, scrollMarginTop: SECTION_SCROLL_MARGIN,
      order: { xs: order, lg: 0 },
    }}>
      <Typography id={`${sectionId(v)}-h`} component="h2" sx={{
        px: 2, pt: 1.75, pb: 1, fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase',
        letterSpacing: typePx(0.8), color: 'text.secondary',
      }}>
        {SECTION_LABEL[v]}
      </Typography>
      {children}
    </Box>
  )
}

export function GameCenterPage({
  game, away, home, eyebrow, actions, onClose, loading, hasLines, final, live, header, paneFor, tabs,
  landingTab, urlTab, teams, games, videos, onOpenTeam, onOpenPlayer, boxFor,
}: {
  game: WpblGame
  away?: WpblTeam
  home?: WpblTeam
  eyebrow: React.ReactNode
  actions: React.ReactNode
  onClose: () => void
  loading: boolean
  hasLines: boolean
  final: boolean
  live: boolean
  header: React.ReactNode
  paneFor: (v: Tab) => React.ReactNode
  tabs: Tab[]
  landingTab: Tab
  urlTab: Tab | null
  teams: WpblTeam[]
  games: WpblGame[]
  videos: WpblVideo[]
  onOpenTeam?: (t: WpblTeam) => void
  onOpenPlayer?: (p: WpblPlayer) => void
  boxFor: (team: WpblTeam) => React.ReactNode
}) {
  const has = (v: Tab) => tabs.includes(v)
  // The narrative board: Live while the game is on, its Recap once it is final.
  const main: Tab | null = has('live') ? 'live' : has('recap') ? 'recap' : null
  const jumpTo: Tab[] = [...(main ? [main] : []), 'box', 'plays', ...(has('pitch') ? ['pitch' as Tab] : [])]

  // A link that named a board (`?tab=box`) lands scrolled to it, once the boards exist. The modal
  // opens on that tab instead; here every board is already open, so the link's job is the scroll.
  // Held there while the page settles: the recap's videos, clips and stories arrive after the lines
  // do and grow the boards above, which in one column pushed a box score 560px below where the jump
  // had put it. Re-pinned on every resize for a few seconds, until the reader scrolls for themselves.
  const landed = useRef(false)
  const articleRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (landed.current || loading) return
    landed.current = true
    if (!urlTab || urlTab === landingTab || !tabs.includes(urlTab)) return
    const pin = () => document.getElementById(sectionId(urlTab))?.scrollIntoView({ block: 'start' })
    pin()
    const article = articleRef.current
    if (!article) return
    const ro = new ResizeObserver(pin)
    ro.observe(article)
    const stop = () => {
      ro.disconnect()
      clearTimeout(timer)
      for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) window.removeEventListener(ev, stop)
    }
    const timer = setTimeout(stop, 4000)
    for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) window.addEventListener(ev, stop, { passive: true })
    stopPinning.current = stop
  }, [loading, urlTab, landingTab, tabs])
  // On unmount only: `tabs` is a fresh array every render, so a cleanup on the effect above would
  // stop the pin at the very re-render (a video list landing) it exists to survive.
  const stopPinning = useRef<() => void>(undefined)
  useEffect(() => () => stopPinning.current?.(), [])

  const jump = (v: Tab) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    document.getElementById(sectionId(v))?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
  }

  const cardSx = {
    bgcolor: 'background.paper', border: '1px solid', borderColor: CARD_BORDER, borderRadius: 3, overflow: 'hidden',
  } as const

  return (
    // Wider than the section's 720px column, centred on it with a margin rather than a transform,
    // so the jump bar below can still stick (see StatsView's FULL_BLEED_W for the same choice).
    <Box component="article" ref={articleRef} sx={{ width: PAGE_W, ml: `calc((100% - ${PAGE_W}) / 2)`, pb: 4 }}>
      {/* The page's <h1>, for the same reason the modal carries one. */}
      <WpblVisuallyHiddenH1>{wpblGameCard(game, teams).ogTitle}</WpblVisuallyHiddenH1>

      <DetailPageBar onBack={onClose} eyebrow={eyebrow} actions={actions} />

      <Box sx={{ ...cardSx, pb: 1.5, mb: 1.5 }}>{header}</Box>

      {/* The jump bar: the tab bar's list of boards, as links to where each one already is. Pinned
          under the toolbar, with the score at its left, so a reader deep in the play log still sees
          the score and can get back to any board in one click. */}
      {hasLines && (
        <Box component="nav" aria-label="Game Center sections" sx={{
          position: 'sticky', top: 'var(--app-header-h, 0px)', zIndex: 3,
          bgcolor: 'background.default', py: 1, mb: 1.5,
          display: 'flex', alignItems: 'center', gap: 2,
          borderBottom: '1px solid', borderColor: 'divider',
        }}>
          {(final || live) && away && home && (
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {away.abbr} {game.away_score ?? 0}
              <Box component="span" sx={{ color: 'text.disabled', mx: 0.75 }}>·</Box>
              {home.abbr} {game.home_score ?? 0}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto', flexWrap: 'wrap' }}>
            {jumpTo.map(v => (
              <Box key={v} component="a" href={`#${sectionId(v)}`} onClick={jump(v)} sx={{
                px: 1.25, py: 0.5, borderRadius: 999, fontSize: '0.75rem', fontWeight: 700,
                color: 'text.secondary', textDecoration: 'none',
                ...hoverOnly({ bgcolor: 'action.hover', color: 'text.primary' }),
                ...FOCUS_RING,
              }}>
                {SECTION_LABEL[v]}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : hasLines && away && home ? (
        <PageColumns
          left={<>
            {main && <PageSection v={main} order={1}>{paneFor(main)}</PageSection>}
            <PageSection v="plays" order={3}>{paneFor('plays')}</PageSection>
          </>}
          right={<>
            <PageSection v="box" order={2}>
              {/* Both clubs, and neither behind a switch: a box score is two teams. Side by side when
                  the section is wide enough for two tables (one column of page, between `md` and
                  `lg`), one under the other in the right-hand column, which holds one. 24rem is the
                  floor, in rem because it is room reserved for type, and it is MEASURED: the widest
                  batting table is 23.6rem. It cannot be squeezed under that, because an auto-layout
                  table ignores a cell's max-width and the capped name column still claims its
                  full width, so a 22rem floor put the pair side by side at 1024px with one of them
                  5px too wide and a scrollbar under it. They meet from about a 1045px window.
                  Capped at 30rem when they stack below that: a box score stretched across the
                  whole page leaves a gulf between a name and its numbers. */}
              <Box sx={{ px: 2, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(24rem, 100%), 1fr))', columnGap: 2.5, rowGap: 2.5, alignItems: 'start' }}>
                {[away, home].map(t => (
                  <Box key={t.id} sx={{ minWidth: 0, maxWidth: '30rem' }}>
                    <TeamHeading team={t} />
                    {boxFor(t)}
                  </Box>
                ))}
              </Box>
            </PageSection>
            {has('pitch') && <PageSection v="pitch" order={4}>{paneFor('pitch')}</PageSection>}
          </>}
        />
      ) : final ? (
        <Box sx={{ ...cardSx, p: 2 }}>
          <EmptyBody title="Box score not available yet" hint="The feed has not posted a box score for this game." />
          {videos.length > 0 && <Box sx={{ mt: 2 }}><GameHighlightCards videos={videos} /></Box>}
          <GameClips gameId={game.id} />
        </Box>
      ) : away && home ? (
        // A game not yet played gets the same treatment as one that has been: the preview's three
        // boards laid out at once rather than behind its Matchup / Leaders / Rosters toggle, which
        // is the modal's answer to having room for one. The season bars on the left, where the
        // narrative goes on a played game; the two lists of people on the right.
        <WpblGamePreview
          away={away} home={home} teams={teams} games={games} onOpenTeam={onOpenTeam} onOpenPlayer={onOpenPlayer} rosters
          renderBoards={b => (
            <PageColumns
              left={<PageSection v="matchup" order={1}><Box sx={{ px: 2 }}>{b.matchup}</Box></PageSection>}
              right={<>
                <PageSection v="leaders" order={2}><Box sx={{ px: 2 }}>{b.leaders}</Box></PageSection>
                <PageSection v="rosters" order={3}><Box sx={{ px: 2 }}>{b.rosters}</Box></PageSection>
              </>}
            />
          )}
        />
      ) : (
        <Box sx={{ ...cardSx, p: 2 }}>
          <EmptyBody title="This game has not been played yet" hint="Check back after first pitch." />
        </Box>
      )}
    </Box>
  )
}

/**
 * One club's heading above its own box score, for the side-by-side layout at `lg`.
 *
 * Drawn to match the ACTIVE `TeamSwitch` tab exactly: same badge, same 0.94rem at weight 800,
 * same 2px rule in the club's accent. They are the same object at two widths, one of which
 * happens also to be a control, and a reader who widens the window should recognise what they
 * were tapping a moment ago rather than meet a new thing.
 */
export function TeamHeading({ team }: { team: WpblTeam }) {
  const isDark = useDark()
  return <BoxTeamHeading badge={<TeamBadge team={team} size={24} />} name={wpblFullName(team)} color={wpblAccent(team.id, isDark)} />
}

// The club switch over a phone's box score (src/ui/gameCenter.tsx, shared with MLB). The nickname
// alone on a phone ("Heights") so the two tabs share a line; "City Nickname" where there is room.
export function TeamSwitch({ away, home, value, onChange }: {
  away: WpblTeam; home: WpblTeam
  value: 'away' | 'home'; onChange: (v: 'away' | 'home') => void
}) {
  const isDark = useDark()
  const isMobile = usePhoneLayout()
  const side = (team: WpblTeam) => ({
    badge: <TeamBadge team={team} size={isMobile ? 22 : 24} />,
    name: wpblFullName(team), short: team.name, color: wpblAccent(team.id, isDark),
  })
  return <BoxTeamSwitch away={side(away)} home={side(home)} value={value} onChange={onChange} dense={isMobile} />
}
