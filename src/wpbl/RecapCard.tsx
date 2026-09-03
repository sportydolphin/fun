import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, useMediaQuery } from '@mui/material'
import type { WpblGame, WpblTeam, WpblPlayer, WpblBattingLine, WpblPitchingLine, WpblGamePlay, WpblRecapPlay, WpblVideo } from './types'
import { buildRecap, leagueRecapContext, type GameRecap, type RecapStar } from './derive/recap'
import { seriesContext } from './derive/series'
import { fetchWpblGameLines, fetchWpblGameRecapPlays } from './api'
import { SectionCard, TeamBadge, PlayerPortrait, CARD_BORDER, FittedName, TAPPABLE, hoverOnly, chromePx, TYPE_SCALE } from './ui'
import { WPBL_ACCENT, relativeDayLabel, wpblFullName } from './constants'
import { GameHighlightCard } from './Highlights'
import { linkColor, useWpblGameLink, useWpblPlayerLink, type WpblPlayerLinkProps } from './LinkContext'

const MEDAL = ['🥇', '🥈', '🥉']

/** Whether the reader has opened Last Game on a phone. Same spelling as the bracket's key, and
 *  the same reasoning: the choice persists, so opening it once is not a decision to re-make on
 *  every visit. */
const LAST_GAME_OPEN_KEY = 'wpbl:lastGameOpen'

// ── Shared bits ─────────────────────────────────────────────────────────────────

function StarRow({ star, medal, name, teamId, portraitSize = 30, medalSize = 20, fitKey, link }: {
  star: RecapStar; medal: string; name: string; teamId: string | null
  portraitSize?: number; medalSize?: number; fitKey?: number
  /** Spread from `playerLink(player, onOpenPlayer)`, so the row is a real
   *  <a href="/wpbl/players/…> rather than a Box with a click handler. Googlebot does not
   *  fire click handlers, and these are the only player names on the section's landing page:
   *  see the linkTo() note in CLAUDE.md, and `/mlb` sitting undiscovered for months. Empty
   *  when there is no player to point at, which leaves the row inert exactly as before. */
  link?: WpblPlayerLinkProps
}) {
  const tappable = !!(link?.href || link?.onClick)
  // `name` is always the full name — the portrait headshot is keyed on it, and it stays the
  // hover title whenever the visible label has been shortened.
  return (
    <Box {...link}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.6, cursor: tappable ? 'pointer' : 'default',
        '&:hover': tappable ? { '& .starname': { textDecoration: 'underline' } } : undefined }}>
      <Box sx={{ fontSize: medalSize * 0.05 + 'rem', width: medalSize / 16 + 'rem', textAlign: 'center', flexShrink: 0 }}>{medal}</Box>
      <PlayerPortrait name={name} teamId={teamId} size={portraitSize} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <FittedName name={name} className="starname" fitKey={fitKey} sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700 }} />
        {/* The statline is deliberately kept out of the column's intrinsic width, so the
            three columns are sized by their NAMES and a wordy stat line can't take room
            from a neighbour's name. A percentage min-width is ignored while the browser
            measures max-content, so this contributes 0 there and still fills the column
            once the width is settled. */}
        <Box sx={{ width: 0, minWidth: '100%' }}>
          {/* Never truncated. The stat line is the thing a reader opened the card for — a
              name cut short is still recognisable, "3-for-4, 2B, 2 R" is just wrong. It
              wraps to a second line instead, which costs a few pixels of height in a card
              that has them to spare. Widening the column instead wouldn't work: the modal
              is capped at 520px and the row doesn't wrap, so three columns competing for
              statline width would only shrink each other back to truncating. */}
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.35 }}>
            {star.statline}
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

// Width of the element, tracked so the names inside it re-fit when the row resizes (a
// window drag, the phone turning, the modal changing size). Font loading counts too: a
// name measured in the fallback face is measured wrong, so a completed webfont swap
// nudges the key as well.
//
// A callback ref rather than a mount effect: the recap renders nothing until its box score
// arrives, so on the first pass there is no row to observe. An effect with an empty
// dependency list runs exactly then, finds no element, and never looks again — leaving the
// names stuck at whatever they were first measured at, through every later resize.
function useFitKey(): [(node: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)

  const setRef = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!node) return   // React passes null on unmount, which is the disconnect above
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(node)
    observer.current = ro
  }, [])

  useEffect(() => {
    let live = true
    document.fonts?.ready.then(() => { if (live) setWidth(w => w + 0.5) })
    return () => { live = false }
  }, [])

  return [setRef, width]
}

// ── Full recap (GameDetail "Recap" tab) ──────────────────────────────────────────

/** The win-probability card, which pulls in the league's whole play log and a model to draw
 *  itself. Lazy so that weight lands only on a reader who has opened a finished game, rather
 *  than in the WPBL bundle everybody downloads.
 *
 *  `preloadWinProb` is the same import, called early by Game Center the moment it opens (see
 *  GameDetail). The module registry dedupes it, so by the time Suspense asks for the component
 *  it is already resolved and the fallback is never seen. Lazy loading is about what a reader
 *  DOWNLOADS, and there is no reason for it to also be about what they WAIT for. */
const WinProbView = lazy(() => import('./WinProbView'))
export const preloadWinProb = () => { void import('./WinProbView') }

export function GameRecapView({ game, teams, batting, pitching, plays, names, games = [], video, onOpenPlayer }: {
  game: WpblGame
  teams: Map<string, WpblTeam>
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  plays: WpblGamePlay[]
  names: Map<string, WpblPlayer>
  games?: WpblGame[]   // full schedule, so the recap verbs calibrate to the league's run environment
  video?: WpblVideo | null   // the league's highlight reel, when there is one: see the note where it renders
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const nameOf = useMemo(() => (id: string) => names.get(id)?.name ?? '—', [names])
  const playerLink = useWpblPlayerLink()
  const ctx = useMemo(() => leagueRecapContext(games), [games])
  // Both of these need the whole schedule and neither can be worked out from the game alone:
  // the verbs calibrate to the league's run environment, the series to the games around it.
  const series = useMemo(() => seriesContext(game, games, teams), [game, games, teams])
  const recap = useMemo(() => buildRecap(game, teams, batting, pitching, plays, nameOf, ctx, series),
    [game, teams, batting, pitching, plays, nameOf, ctx, series])
  const [starsRef, starsWidth] = useFitKey()
  if (!recap) return null

  return (
    <Box sx={{ px: 2, pb: 2, pt: 0.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* NO HEADLINE OR BLURB HERE, and that is not an omission. "Heights edge Queens / the
          Heights held on for an 8-7 win" is written for a reader who cannot see the score,
          which is exactly the Home card's job and exactly not this one's: in Game Center the
          line score sits three inches above it, with the winner in bold, so the headline
          spends 87px of a phone sheet restating what the header already said. LastGameCard
          still renders both, from the same `buildRecap`. */}

      {/* First, then: the chart is the shape of the game, and the things under it are details
          of the same game. Nothing else in the recap answers "was this close" in one look. */}
      <Suspense fallback={null}>
        <WinProbView game={game} teams={teams} plays={plays} games={games} />
      </Suspense>

      {recap.feats.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {recap.feats.map((f, i) => (
            <Box key={i} sx={{ px: 1, py: 0.4, borderRadius: 999, border: '1px solid', borderColor: CARD_BORDER,
              fontSize: TYPE_SCALE.meta, fontWeight: 600, bgcolor: 'action.hover' }}>{f}</Box>
          ))}
        </Box>
      )}

      {recap.stars.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled', mb: 0.25 }}>Stars of the game</Typography>
          {/* Mobile: stack the three stars, each on its own full-width row so the name and
              statline show in full instead of all three cramming one line and truncating.
              Desktop lays them in one row, each star starting from the width its own name
              needs — so a short name still leaves room to the other two — and then every
              column grows to share out whatever the row has left over. Without that grow the
              columns stopped at their content width and any surplus stayed blank, which is
              how a statline could end up truncated with empty space sitting beside it. */}
          <Box ref={starsRef} sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, flexWrap: 'nowrap', gap: { xs: 0, sm: 2.5 } }}>
            {recap.stars.map((s, i) => {
              const p = names.get(s.playerId)
              return (
                <Box key={s.playerId} data-star-col="" sx={{ minWidth: 0, flex: { xs: '0 1 auto', sm: '1 1 auto' } }}>
                  <StarRow star={s} medal={MEDAL[i] ?? '⭐'} name={s.name} teamId={s.teamId} fitKey={starsWidth}
                    link={playerLink(p, onOpenPlayer)} />
                </Box>
              )
            })}
          </Box>
        </Box>
      )}

      {recap.decisions.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
          {recap.decisions.map(d => (
            <Box key={d.key}>
              <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, color: d.key === 'L' ? 'text.disabled' : WPBL_ACCENT }}>{d.key}</Typography>
              <Typography component="span" sx={{ fontSize: TYPE_SCALE.body, fontWeight: 600, ml: 0.5 }}>{d.name}</Typography>
              <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', ml: 0.5 }}>{d.statline}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* The league's highlight reel, at the foot of the recap.
          It used to sit in the modal's fixed header, above the tab row, where it cost every
          tab about 90px it never got back: the header (line score, conditions, reel, tabs)
          took more than half a 690px phone screen, and the Recap pane was left with 306px to
          draw a 299px card in. A reel is a nice thing to find at the end of a recap and a poor
          thing to spend a header on, so it moved down here. GameDetail keeps a copy for the
          game that has video but no box score, since that game has no Recap tab to put it in. */}
      {video && <GameHighlightCard video={video} />}

    </Box>
  )
}

// ── Compact last-game card (Home) — self-fetches the latest final's box + plays ────

function latestFinal(games: WpblGame[]): WpblGame | null {
  const finals = games.filter(g => g.status === 'final' && g.home_score != null && g.away_score != null && g.home_score !== g.away_score)
  if (finals.length === 0) return null
  return finals.sort((a, b) => a.game_date !== b.game_date ? (a.game_date < b.game_date ? 1 : -1)
    : (b.start_time ?? '').localeCompare(a.start_time ?? ''))[0]
}

export function LastGameCard({ games, teams, players, onOpenGame, onOpenPlayer }: {
  games: WpblGame[]
  teams: Map<string, WpblTeam>
  players: WpblPlayer[]
  onOpenGame: (g: WpblGame) => void
  /** The star's own page. Optional only so the card still renders somewhere without one; on
   *  Home it is always passed, and it is the point of the star being here. */
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const gameLink = useWpblGameLink()
  const playerLink = useWpblPlayerLink()
  const game = useMemo(() => latestFinal(games), [games])
  const [data, setData] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[]; plays: WpblRecapPlay[] } | null>(null)

  useEffect(() => {
    if (!game) { setData(null); return }
    let cancelled = false
    Promise.all([fetchWpblGameLines(game.id), fetchWpblGameRecapPlays(game.id)])
      .then(([l, pl]) => { if (!cancelled) setData({ batting: l.batting, pitching: l.pitching, plays: pl }) })
      .catch(() => { /* keep last-good; card falls back to line-score-only recap */ })
    return () => { cancelled = true }
  }, [game?.id])

  const byPlayerId = useMemo(() => new Map(players.map(p => [p.id, p])), [players])
  const nameOf = useMemo(() => (id: string) => byPlayerId.get(id)?.name ?? '—', [byPlayerId])

  const ctx = useMemo(() => leagueRecapContext(games), [games])
  const series = useMemo(() => game ? seriesContext(game, games, teams) : null, [game, games, teams])
  const recap = useMemo(() => game ? buildRecap(game, teams, data?.batting ?? [], data?.pitching ?? [], data?.plays ?? [], nameOf, ctx, series) : null,
    [game, teams, data, nameOf, ctx, series])

  const [starRef, starWidth] = useFitKey()

  // FOLDED ON A PHONE, AND WHAT FOLDS IS THE DRAWING RATHER THAN THE ANSWER.
  //
  // This card is ~340px of an 812px phone, arriving under a scoreboard strip whose first tile is
  // already this game's score, and a good part of what it spends that on is a preview of what
  // "Full recap" opens: the headline, the blurb's first sentence, the star. Shut, the subtitle
  // carries the headline, so a reader who never opens it still gets the sentence the card exists
  // to deliver, and the score is one tile up in the scoreboard either way.
  //
  // The same pattern, key spelling and reasoning as Road to the title, deliberately: two cards
  // on one page that fold differently is a worse page than either choice. `noSsr` for the reason
  // it is there too, a first paint at full height that snaps shut a frame later being worse than
  // either state. Desktop is untouched and open, where the two-column grid has the room.
  const isPhone = useMediaQuery('(max-width:599.95px)', { noSsr: true })
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(LAST_GAME_OPEN_KEY) === '1' } catch { return false }
  })
  const toggle = () => setOpen(v => {
    try { localStorage.setItem(LAST_GAME_OPEN_KEY, v ? '0' : '1') } catch { /* private mode, non-fatal */ }
    return !v
  })

  if (!game || !recap) return null
  const collapsed = isPhone && !open
  const away = teams.get(game.away_team_id), home = teams.get(game.home_team_id)
  const dateLabel = relativeDayLabel(game.game_date)

  const scoreRow = (team: WpblTeam | undefined, score: number | null, won: boolean) => team && (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <TeamBadge team={team} size={26} />
      <Typography sx={{ flex: 1, fontSize: TYPE_SCALE.title, fontWeight: won ? 800 : 600, color: won ? 'text.primary' : 'text.secondary' }}>{wpblFullName(team)}</Typography>
      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: won ? 'text.primary' : 'text.secondary' }}>{score}</Typography>
    </Box>
  )

  return (
    <SectionCard
      // Sentence case, like every other card on Home: "Next game", "MVP race", "Road to the
      // title". This was the one title-cased heading on the page.
      title="Last game"
      // The date says WHICH game and the headline says what happened in it. Open, the card
      // itself is about to say the second, so the subtitle spends its line on the first; shut,
      // the headline is the only thing left to carry the point, and "Last Game" plus a
      // scoreboard tile directly above already answers which.
      subtitle={collapsed ? recap.headline : dateLabel}
      fill
      collapsed={isPhone ? collapsed : undefined}
      onToggleCollapse={isPhone ? toggle : undefined}
      // NO LINK IN THE HEADER ON A PHONE, AND HIDING IT WHILE SHUT WAS WORSE THAN LEAVING IT.
      //
      // The first version dropped "Full recap" only while collapsed, on the grounds that a
      // chevron and a link in one phone-width header are two controls competing for one tap.
      // That made it appear ON EXPAND, in the space the finger had just tapped: measured at
      // 375px, the link lands at y 397-414 while the header that was tapped spans 379-432, and
      // its right edge sits 10px from the chevron. Tap to open, tap again to close, and the
      // second tap opens Game Center instead, because a new control grew under the thumb
      // between them. A control that appears where a finger already is has to be treated as
      // pressed, and this one navigates away from the page.
      //
      // So on a phone the header does one thing, for the whole of its width, always: it
      // toggles. The recap link moves to the foot of the body, which is both far from the
      // header and where a reader who has just read the blurb actually is. The desktop card
      // has no collapse and no thumb, and keeps the header action it always had.
      action={isPhone ? undefined : (
        <Typography {...linkColor(gameLink(game, onOpenGame), 'var(--wpbl-accent-fg)')} sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'var(--wpbl-accent-fg)', cursor: 'pointer', ...hoverOnly({ textDecoration: 'underline' }) }}>
          Full recap
        </Typography>
      )}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
        {scoreRow(away, game.away_score, recap.winner.id === away?.id)}
        {scoreRow(home, game.home_score, recap.winner.id === home?.id)}
      </Box>
      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, lineHeight: 1.2 }}>{recap.headline}</Typography>
      <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', mt: 0.5, lineHeight: 1.35 }}>{recap.blurb}</Typography>
      {recap.stars[0] && (
        // Pinned to the bottom edge: this card shares a stretched row with Leaders on Home, so
        // whichever of the two is shorter has slack to place. Above the star's rule is the
        // right place for it, since the blurb is a variable-length paragraph and extra air
        // after it reads as paragraph spacing. Wrapped rather than swapping `mt: 1` for
        // `mt: 'auto'`, so the 8px minimum gap survives when there is no slack at all.
        <Box sx={{ mt: 'auto' }}>
          {/* One star with the card to itself, so its name almost always fits in full, but it
              still gets the same fit key, so a name shortened on a narrow phone comes back when
              the phone turns. */}
          <Box ref={starRef} sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
            {/* THE STAR OPENS THE PLAYER, NOT THE GAME. It used to open the game, which is the
                one thing on this card already reachable three other ways: the score rows, the
                card's own "Full recap" and the scoreboard strip above it. Meanwhile this is the
                ONLY player name on /wpbl, and opening a player page is the retention event on
                the whole section (a browser that opens one returns at 76.5%, against 7.8% for
                one that opens neither that nor Game Center; see the traffic notes in
                ROADMAP-WPBL.md). It is also now a real anchor, so it is a crawl path from the
                landing page to a player page rather than a click handler Googlebot cannot see. */}
            <StarRow star={recap.stars[0]} medal="🥇" name={recap.stars[0].name} teamId={recap.stars[0].teamId} portraitSize={44} medalSize={30} fitKey={starWidth}
              link={playerLink(byPlayerId.get(recap.stars[0].playerId), onOpenPlayer)} />
          </Box>
        </Box>
      )}
      {/* The phone's copy of the header action, at the far end of the card. See the note on
          `action` above: on a phone the header is the collapse toggle and nothing else, so this
          is the only "Full recap" there, and it sits where a reader who has just finished the
          blurb and the star already is. Full width, because at the bottom of a card there is
          nothing to share the row with and a wider target is a better one. */}
      {isPhone && (
        <Box {...linkColor(gameLink(game, onOpenGame), 'var(--wpbl-accent-fg)')} sx={{
          mt: 1.25, pt: 1, borderTop: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', borderRadius: 1, minHeight: chromePx(28),
          fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'var(--wpbl-accent-fg)',
          ...TAPPABLE,
        }}>
          Full recap
          <Box component="span" aria-hidden sx={{ fontSize: TYPE_SCALE.title, lineHeight: 1 }}>›</Box>
        </Box>
      )}
    </SectionCard>
  )
}
