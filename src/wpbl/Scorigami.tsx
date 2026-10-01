// /wpbl/scorigami: every final score the league has produced, as a grid.
//
// One square per (winning score, losing score). A lit square is a final that has happened; the
// winning score reads down the left axis, the losing score across the top, so the square's position
// IS the score and the grid needs no number printed in it. Tap a lit square to open the first game
// that ended on it. See derive/scorigami.ts for the arithmetic and for why the postseason counts
// here when it counts nowhere else on the section.
//
// A SIBLING PAGE, not a tab: a real path linked from the footer and absent from WPBL_NAV, on the
// same footing as /wpbl/season and /wpbl/league. See WPBL_SCORIGAMI_PAGE in routes.ts. It is a
// durable, backward-looking artifact and a share image, which is exactly what earns its own URL
// rather than a card that scrolls away.
//
// PLAY replays the season onto the grid, one final at a time in date order, so a reader can watch
// it fill rather than only see where it ended. It is opt-in and the page opens on the finished grid:
// the finished grid is the thing people come to look up and link, and a page that animates on
// arrival makes them wait for it.
//
// FROM THE SCHEDULE ALONE, both cached app-wide, so on a reader who has been anywhere else on the
// section this resolves from memory and adds no request.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, CircularProgress, Switch, FormControlLabel } from '@mui/material'
import { fetchWpblSchedule, fetchWpblTeams } from './api'
import { wpblScorigami, scorigamiKey, scorigamiCountsAt, type ScorigamiCell } from './derive/scorigami'
import { wpblGamePath } from './routes'
import { FOCUS_RING, CARD_BORDER, chromePx, pressable, hoverOnly, useWpblDark } from './ui'
import { useReducedMotion } from '../AccessibilityContext'
import WpblPage from './WpblPage'
import type { WpblGame, WpblTeam } from './types'
import { track, EVENTS } from '../lib/analytics'

const isModified = (e: React.MouseEvent) =>
  e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

// The replay spreads a fixed length across however many finals there are, so it stays watchable as
// the seasons stack (about 190ms a game across 2026's finals), inside bounds that keep one step
// readable and a long history from dragging.
const REPLAY_MS = 9000
const MIN_STEP_MS = 60
const MAX_STEP_MS = 400

// The four clubs as FILLS for two small triangles side by side, a role none of the palettes in
// constants.ts is tuned for. The accents are tuned to be read as text, and Hunters green and
// Heights blue sit at almost the same lightness there (ΔL* 5 dark, 0.3 light). They differ mostly
// on the blue-yellow axis, which is the first thing the eye stops resolving on a small patch, so
// at half a 28px square they read as one colour. Same hues here, with green taken darker and blue
// lighter until the two are about 27 L* apart in both themes. Checked with CIEDE2000, normal and
// simulated protan, deutan and tritan vision.
//
// NOT solved, and not solvable with these four hues: for red-green colour blindness, Firebells red,
// Hunters green and Queens gold still sit close, because separating them costs a club its colour
// (the best-scoring palette turned Firebells pink). The legend and each square's label, which
// names both clubs, carry what the colour cannot.
const SQUARE_COLORS: Record<string, { light: string; dark: string }> = {
  BOS: { light: '#135f34', dark: '#288f55' },
  LA:  { light: '#a8761d', dark: '#e0b54f' },
  NY:  { light: '#3a9ae0', dark: '#8fd0fa' },
  SF:  { light: '#d1332f', dark: '#f05a5a' },
}
const SQUARE_NEUTRAL = { light: '#6b7280', dark: '#9ca3af' }
const squareColor = (teamId: string | null | undefined, dark: boolean): string => {
  const c = (teamId && SQUARE_COLORS[teamId]) || SQUARE_NEUTRAL
  return dark ? c.dark : c.light
}

// Whether the reader wants the club split or the plain single-colour grid. Per reader and per
// browser, on by default; the plain grid is for anyone who finds four colours busier than it is
// useful, and a choice like that should not have to be made again on every visit.
const CLUB_COLORS_KEY = 'wpbl_scorigami_club_colors'
const readClubColors = (): boolean => {
  try { return localStorage.getItem(CLUB_COLORS_KEY) !== '0' } catch { return true }
}
const writeClubColors = (on: boolean) => {
  try { localStorage.setItem(CLUB_COLORS_KEY, on ? '1' : '0') } catch { /* private mode / quota */ }
}

const shortDate = (iso: string | null | undefined): string =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''

export default function WpblScorigami({ onOpenGame }: {
  // Opens a game as a modal hovering over this page, rather than navigating to it (which would
  // replace the page with WpblApp's Home). Supplied by the shell; see GameOverlayHost. The cells
  // stay real <a href>s for crawlers, with the plain click intercepted.
  onOpenGame: (g: WpblGame, ctx: { teams: WpblTeam[]; games: WpblGame[] }) => void
}) {
  const [games, setGames] = useState<WpblGame[]>([])
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblSchedule(), fetchWpblTeams()]).then(([g, t]) => {
      if (cancelled) return
      setGames(g); setTeams(t)
    }).catch(() => { /* the empty state below is the whole error path */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const grid = useMemo(() => wpblScorigami(games), [games])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const reduce = useReducedMotion()
  const dark = useWpblDark()
  const [clubColors, setClubColorsState] = useState(readClubColors)
  const setClubColors = (on: boolean) => {
    setClubColorsState(on)
    writeClubColors(on)
    track(EVENTS.WPBL_PAGE_CONTROL, { page: 'scorigami', control: 'club_colors', value: on ? 'on' : 'off' })
  }

  // Replay. `frame` is how many finals are on the grid, and null means no replay has run, which
  // draws the finished grid. A finished replay stays on its last frame, which is the same picture,
  // so the readout can keep saying where it ended. A rAF clock like the season page's races, so a
  // hidden tab pauses rather than arriving all at once.
  const total = grid.steps.length
  const [frame, setFrame] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const stepMs = Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, REPLAY_MS / Math.max(total, 1)))
  const frameRef = useRef(frame); frameRef.current = frame
  const playingRef = useRef(playing); playingRef.current = playing

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const from = frameRef.current ?? 0
    const t0 = performance.now()
    const tick = (now: number) => {
      // A rAF timestamp is the frame's START, which can be a few ms before the performance.now()
      // above. Unclamped, the first tick of a resume lands one game BACK and re-pops a square the
      // reader has already seen.
      const next = from + Math.floor(Math.max(0, now - t0) / stepMs)
      if (next >= total) { setFrame(total); setPlaying(false); return }
      setFrame(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, total, stepMs])

  // Two plain sets rather than one inside the other's updater; see SeasonShapeCard's note on why a
  // set queued from an updater can be dropped and leave playback stopped before it starts.
  const play = useCallback(() => {
    if (playingRef.current) { setPlaying(false); return }
    track(EVENTS.WPBL_PAGE_CONTROL, { page: 'scorigami', control: 'replay_play' })
    setFrame(f => (f == null || f >= total ? 0 : f))
    setPlaying(true)
  }, [total])

  const shown = useMemo(
    () => (frame == null ? null : scorigamiCountsAt(grid, frame)),
    [grid, frame],
  )
  // The cell the replay just landed on, which is the one that pops.
  const latestGame = frame != null && frame > 0 ? grid.steps[frame - 1]?.game ?? null : null
  const latestKey = frame != null && frame > 0 ? grid.steps[frame - 1]?.key ?? null : null

  // The winner and loser of the game a cell links to, by name, for the label and the aria text.
  // A box-score row carries the club it was played for, so this reads the two ids off the game
  // rather than any roster snapshot.
  const sides = (g: WpblGame) => {
    const homeWon = (g.home_score ?? 0) > (g.away_score ?? 0)
    return {
      winId: homeWon ? g.home_team_id : g.away_team_id,
      loseId: homeWon ? g.away_team_id : g.home_team_id,
    }
  }
  const cellLabel = (cell: ScorigamiCell): string => {
    const g = cell.first
    const { winId, loseId } = sides(g)
    const winName = teamById.get(winId)?.name ?? winId
    const loseName = teamById.get(loseId)?.name ?? loseId
    const more = cell.count > 1 ? ` (+${cell.count - 1} more)` : ''
    return `${winName} ${cell.win}–${cell.lose} ${loseName}, ${g.game_date}${more}`
  }

  const gameHref = (g: WpblGame) => wpblGamePath(g, teams, games)

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  }

  const hasData = grid.maxWin > 0
  const litNow = shown ? shown.size : grid.cells.size
  // Columns are losing scores 0..(maxWin-1): a loser cannot out-score the winner, so no column
  // beyond that can ever be lit. Rows are winning scores 1..maxWin, ascending downward, which
  // reads like an ordinary table and widens the lit triangle toward the bottom.
  const losers = Array.from({ length: Math.max(grid.maxWin, 1) }, (_, i) => i) // 0..maxWin-1
  const winners = Array.from({ length: grid.maxWin }, (_, i) => i + 1)         // 1..maxWin

  // The grid is exactly as wide as its data (a label track + one cell per losing score + the
  // gaps between them), which is narrower than the page column, so the intro and footnote were
  // wrapping at 60ch and ending short of the table's right edge. Compute that same width from the
  // grid's own geometry and cap the prose at it, so text and table share one right edge. The label
  // track is pinned (LABEL_COL) rather than `auto` for the same reason: an auto width can't be
  // named here. `min(…, 100%)` keeps it honest on a viewport too narrow for the full grid, where
  // the table scrolls and the text just fills the column.
  const LABEL_COL = '2.25rem'
  const GRID_GAP = 4 // px, matches the grid's own gap below
  const n = losers.length
  const gridWidth = {
    xs: `min(calc(${LABEL_COL} + ${n} * 1.75rem + ${n * GRID_GAP}px), 100%)`,
    sm: `min(calc(${LABEL_COL} + ${n} * 2.1rem + ${n * GRID_GAP}px), 100%)`,
  }

  return (
    <WpblPage
      title="WPBL Scorigami"
      standfirst={<>
        Every final score in the Women&rsquo;s Pro Baseball League, postseason included: winning
        score down the side, losing score across the top. Tap a square to open the game.
      </>}
    >
      {!hasData && (
        <Typography sx={{ color: 'text.secondary' }}>
          The grid fills in here once games go final.
        </Typography>
      )}

      {hasData && (
        // The one toolbar, capped to the grid's width so the controls sit over its right edge. The
        // count on the left becomes the replay's readout while a replay runs, so the numbers the
        // page used to spend a paragraph on are one line that also does a second job. The replay
        // readout is aria-hidden: it changes several times a second, which a live region would read
        // out as a stream of noise, and the Play button's own label says what is happening.
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5,
          mb: 1.5, maxWidth: gridWidth,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
            {frame == null ? (
              <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                <Box component="span" sx={{ fontWeight: 800, color: 'text.primary' }}>{grid.cells.size}</Box> scores
                {' · '}<Box component="span" sx={{ fontWeight: 800, color: 'text.primary' }}>{grid.totalGames}</Box> games
              </Typography>
            ) : (
              <Box aria-hidden sx={{ display: 'contents' }}>
                <Typography sx={{
                  fontSize: '1.1rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)', lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums', minWidth: '3.4em', whiteSpace: 'nowrap',
                }}>
                  {latestGame ? shortDate(latestGame.game_date) : 'Start'}
                </Typography>
                <Typography sx={{
                  fontSize: '0.78rem', color: 'text.secondary', lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                }}>
                  {frame}/{total} games
                  {/* The score count is the half a phone cannot fit beside two controls. */}
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}> · {litNow} scores</Box>
                </Typography>
              </Box>
            )}
          </Box>
          {/* The two controls side by side, so there is one place to reach for both. */}
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            <FormControlLabel
              labelPlacement="start"
              sx={{ m: 0, gap: 0.25 }}
              control={<Switch size="small" checked={clubColors} onChange={(_, on) => setClubColors(on)} />}
              label={<Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: 'text.secondary', whiteSpace: 'nowrap' }}>Club colors</Typography>}
            />
            <Box {...pressable(play)} aria-label={playing ? 'Pause' : 'Replay the season onto the grid'} sx={{
              ...FOCUS_RING, cursor: 'pointer', userSelect: 'none', flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', gap: 0.5,
              minHeight: { xs: 44, sm: chromePx(30) }, px: 1.5, borderRadius: 999,
              border: '1px solid', borderColor: CARD_BORDER,
              fontSize: '0.74rem', fontWeight: 800, color: 'var(--wpbl-accent-fg)',
              touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
            }}>
              <Box component="span" aria-hidden>{playing ? '❚❚' : '▶'}</Box>
              {playing ? 'Pause' : 'Play'}
            </Box>
          </Box>
        </Box>
      )}

      {hasData && (
        // A grid can be wider than a phone, so it gets its own horizontal scroll rather than pushing
        // the page body sideways. `mx: -2` reaches through the shell's padding to the screen edge
        // (WpblPage has none of its own on a phone) and `px: 2` puts the grid back on the gutter. `--cell` is the square size; the label track is `auto`.
        <Box sx={{ overflowX: 'auto', pb: 1, mx: { xs: -2, sm: 0 }, px: { xs: 2, sm: 0 } }}>
          <Box
            role="group"
            aria-label="Final scores by winning and losing runs. Each square is one score that has happened."
            sx={{
              '--cell': { xs: '1.75rem', sm: '2.1rem' },
              display: 'grid',
              gap: '4px',
              width: 'max-content',
              // The replay's landing: the square overshoots its size and settles while a ring fades
              // off it, so the eye finds the one square that changed among dozens that did not.
              '@keyframes wpblScorigamiPop': {
                '0%': { transform: 'scale(0.4)', boxShadow: '0 0 0 0 rgba(128,128,128,0.7)' },
                '55%': { transform: 'scale(1.25)' },
                '100%': { transform: 'scale(1)', boxShadow: '0 0 0 8px transparent' },
              },
            }}
            // The column count is data, so it is spelled here rather than in the stylesheet:
            // a fixed label track (LABEL_COL, so the prose above can match this width) plus one
            // track per losing score.
            style={{ gridTemplateColumns: `${LABEL_COL} repeat(${losers.length}, var(--cell))` }}
          >
            {/* Corner: the two axes named. Extra bottom padding on the whole header row lifts the
                axis numbers clear of the first cell row, which otherwise sit almost on top of it. */}
            <Box sx={{
              display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
              pr: 0.75, pb: 0.75,
            }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', lineHeight: 1 }}>
                W&nbsp;\&nbsp;L
              </Typography>
            </Box>
            {/* Top axis: losing scores. */}
            {losers.map(l => (
              <Box key={`h${l}`} sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', pb: 0.75 }}>
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {l}
                </Typography>
              </Box>
            ))}

            {/* One row per winning score. */}
            {winners.map(w => (
              <Box key={`r${w}`} sx={{ display: 'contents' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', pr: 0.75 }}>
                  <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {w}
                  </Typography>
                </Box>
                {losers.map(l => {
                  // A loser cannot equal or beat the winner, so those squares are impossible and
                  // simply are not drawn: an empty grid slot keeps the columns aligned.
                  if (l >= w) return <Box key={`c${w}-${l}`} sx={{ width: 'var(--cell)', height: 'var(--cell)' }} />
                  const key = scorigamiKey(w, l)
                  const cell = grid.cells.get(key)
                  // During a replay a cell shows only the games played so far.
                  const count = shown ? (shown.get(key) ?? 0) : (cell?.count ?? 0)
                  if (!cell || count === 0) {
                    // A possible score that has not happened: a faint empty square.
                    return (
                      <Box key={`c${w}-${l}`} sx={{
                        width: 'var(--cell)', height: 'var(--cell)', borderRadius: 0.75,
                        border: '1px solid', borderColor: 'divider', bgcolor: 'transparent',
                      }} />
                    )
                  }
                  const label = cellLabel(cell)
                  const href = gameHref(cell.first)
                  // The square the replay just landed on remounts under a key naming the frame, which
                  // is what restarts its animation, including for a second game on the same score.
                  const landing = key === latestKey
                  // Split down the diagonal between the two clubs of the game it links to, each half
                  // facing its own axis: the winner lower left toward the winning-score labels, the
                  // loser upper right toward the losing-score labels, so the square says who won as
                  // well as who played. See SQUARE_COLORS for why these are not the club accents. A
                  // repeated score keeps its FIRST game's colours, which is also the game that lit it
                  // in the replay, so it never recolours.
                  const { winId, loseId } = sides(cell.first)
                  const winC = squareColor(winId, dark)
                  const loseC = squareColor(loseId, dark)
                  const seam = dark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.85)'
                  return (
                    <Box
                      key={landing ? `c${w}-${l}-f${frame}` : `c${w}-${l}`}
                      component="a"
                      href={href}
                      title={label}
                      aria-label={label}
                      onClick={e => {
                        track(EVENTS.WPBL_PAGE_OPEN, { page: 'scorigami', section: 'grid', kind: 'game', value: `${w}-${l}` })
                        if (!isModified(e)) { e.preventDefault(); onOpenGame(cell.first, { teams, games }) }
                      }}
                      sx={{
                        ...FOCUS_RING,
                        width: 'var(--cell)', height: 'var(--cell)', borderRadius: 0.75,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        textDecoration: 'none', color: '#fff', cursor: 'pointer',
                        // A thin neutral seam between the halves: at this size an edge does more to
                        // tell two colours apart than the colours do. Stops at fractional px, or the
                        // diagonal renders stepped.
                        background: clubColors
                          ? `linear-gradient(45deg, ${winC} calc(50% - 0.75px), ${seam} calc(50% - 0.25px), ${seam} calc(50% + 0.25px), ${loseC} calc(50% + 0.75px))`
                          : 'var(--wpbl-accent-solid)',
                        // Not TAPPABLE: that paints the row-hover grey over the fill, which on a solid
                        // square reads as the square going blank. A lift and a slight brighten keep
                        // both clubs' colours visible under the pointer.
                        ...hoverOnly({ transform: 'scale(1.12)', filter: 'brightness(1.12)', zIndex: 1, position: 'relative' }),
                        transition: 'transform 80ms ease, filter 80ms ease',
                        ...(landing && !reduce && {
                          animation: 'wpblScorigamiPop 420ms cubic-bezier(.34,1.3,.5,1)',
                          position: 'relative', zIndex: 1,
                        }),
                      }}
                    >
                      {/* The repeat count only on the plain grid: on the split squares it is a third
                          thing competing with two colours, and it made the grid too busy to read.
                          The square's label still says how many games ended on it. */}
                      {count > 1 && !clubColors && (
                        <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, lineHeight: 1, color: '#fff' }}>
                          {count}
                        </Typography>
                      )}
                    </Box>
                  )
                })}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {hasData && (
        // The key, one line under the grid: the clubs when the split is on, then what the split and
        // the numbers mean. It replaces a footnote paragraph; the intro above already says what the
        // axes are and that a square opens its game.
        <Box sx={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.75,
          mt: 1.25, maxWidth: gridWidth,
        }}>
          {clubColors && [...teams].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(t => (
            <Box key={t.id} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
              <Box aria-hidden sx={{ width: '0.7rem', height: '0.7rem', borderRadius: 0.5, bgcolor: squareColor(t.id, dark) }} />
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1 }}>
                {t.name}
              </Typography>
            </Box>
          ))}
          <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled', lineHeight: 1.3 }}>
            {clubColors ? 'Winner lower left.' : 'A number means the score happened more than once.'}
          </Typography>
        </Box>
      )}
    </WpblPage>
  )
}
