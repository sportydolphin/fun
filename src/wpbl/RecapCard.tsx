import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import type { WpblGame, WpblTeam, WpblPlayer, WpblBattingLine, WpblPitchingLine, WpblGamePlay, WpblRecapPlay } from './types'
import { buildRecap, leagueRecapContext, type GameRecap, type RecapStar } from './derive/recap'
import { fetchWpblGameLines, fetchWpblGameRecapPlays } from './api'
import { SectionCard, TeamBadge, PlayerPortrait, CARD_BORDER, wpblNameStages } from './ui'
import { WPBL_ACCENT, relativeDayLabel, wpblFullName } from './constants'

const MEDAL = ['🥇', '🥈', '🥉']

// ── Shared bits ─────────────────────────────────────────────────────────────────

// A name that degrades instead of being cut off. It renders the full name, and only if the
// browser actually truncates it does it fall back to "F. Last", then "F. Surname" — so the
// name keeps every character the column can show rather than losing its end to an ellipsis.
//
// Measured, not budgeted by character count, because the three stars share one row on
// desktop and each takes only the width its own name and statline need: how much room a
// name gets depends on the other two, which no fixed budget can know. `fitKey` is the width
// of the row that holds them all — a width no name can influence. Re-fitting keyed on that
// (rather than on this element's own width, which shortening changes) is what keeps the
// steps monotonic: within one row width a name only ever gets shorter, so it settles in at
// most two passes instead of oscillating between two stages that each make the other fit.
// Unclaimed width in the row that holds all three stars: what is left after every column
// has taken what it needs. Read straight from the DOM at measure time rather than held in
// state, so it is never a frame stale — a name is only allowed to grow back into space
// that is genuinely free right now.
//
// Usually ~0 since the columns gained flex-grow and now share the surplus out among
// themselves. That didn't make the grow-back below redundant, it moved where the room shows
// up: the space this used to report as unclaimed is now inside the column's own clientWidth,
// which is the other half of that comparison.
function rowSlack(el: HTMLElement): number {
  const col = el.closest('[data-star-col]')
  const row = col?.parentElement
  if (!row) return 0
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0
  let used = gap * (row.children.length - 1)
  for (const child of Array.from(row.children)) used += (child as HTMLElement).offsetWidth
  return row.clientWidth - used
}

function FittedName({ name, className, sx, fitKey }: {
  name: string; className?: string; sx?: object; fitKey?: number
}) {
  const ref = useRef<HTMLElement | null>(null)
  const fullRef = useRef<HTMLElement | null>(null)
  const stages = useMemo(() => wpblNameStages(name), [name])
  const [stage, setStage] = useState(0)
  const grew = useRef(false)

  useLayoutEffect(() => { setStage(0); grew.current = false }, [name, fitKey])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // +1 absorbs sub-pixel rounding, which would otherwise abbreviate a name that fits.
    if (el.scrollWidth > el.clientWidth + 1) {
      // Shrink a step. This is also what walks back a growth that turned out not to fit,
      // which is why growing needs no undo of its own.
      if (stage < stages.length - 1) setStage(stage + 1)
      return
    }
    // It fits — but all three names shrink together on the first pass, and shrinking two
    // of them can leave enough room for the third to have kept its full form. Take it back
    // when the measured full name fits in this column plus the row's unclaimed width. One
    // attempt per name per row width: if two names claim the same slack at once, both
    // overflow, both fall back on the next pass, and neither tries again.
    const full = fullRef.current
    if (stage > 0 && !grew.current && full && full.offsetWidth <= el.clientWidth + rowSlack(el)) {
      grew.current = true
      setStage(0)
    }
  })

  return (
    <Box sx={{ position: 'relative' }}>
      <Typography ref={ref} className={className} noWrap title={stage > 0 ? name : undefined} sx={sx}>
        {stages[stage]}
      </Typography>
      {/* The full name, measured but never seen or read aloud, and out of flow so it adds
          nothing to the column's width. This is how a shortened name knows what it would
          cost to come back. */}
      {stage > 0 && (
        <Typography ref={fullRef} aria-hidden noWrap sx={{ ...sx, position: 'absolute', top: 0, left: 0, visibility: 'hidden', pointerEvents: 'none' }}>
          {stages[0]}
        </Typography>
      )}
    </Box>
  )
}

function StarRow({ star, medal, name, teamId, portraitSize = 30, medalSize = 20, fitKey, onClick }: {
  star: RecapStar; medal: string; name: string; teamId: string | null
  portraitSize?: number; medalSize?: number; fitKey?: number; onClick?: () => void
}) {
  // `name` is always the full name — the portrait headshot is keyed on it, and it stays the
  // hover title whenever the visible label has been shortened.
  return (
    <Box onClick={onClick}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.6, cursor: onClick ? 'pointer' : 'default',
        '&:hover': onClick ? { '& .starname': { textDecoration: 'underline' } } : undefined }}>
      <Box sx={{ fontSize: medalSize * 0.05 + 'rem', width: medalSize, textAlign: 'center', flexShrink: 0 }}>{medal}</Box>
      <PlayerPortrait name={name} teamId={teamId} size={portraitSize} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <FittedName name={name} className="starname" fitKey={fitKey} sx={{ fontSize: '0.85rem', fontWeight: 700 }} />
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
          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', lineHeight: 1.35 }}>
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

export function GameRecapView({ game, teams, batting, pitching, plays, names, games = [], onOpenPlayer }: {
  game: WpblGame
  teams: Map<string, WpblTeam>
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  plays: WpblGamePlay[]
  names: Map<string, WpblPlayer>
  games?: WpblGame[]   // full schedule, so the recap verbs calibrate to the league's run environment
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const nameOf = useMemo(() => (id: string) => names.get(id)?.name ?? '—', [names])
  const ctx = useMemo(() => leagueRecapContext(games), [games])
  const recap = useMemo(() => buildRecap(game, teams, batting, pitching, plays, nameOf, ctx),
    [game, teams, batting, pitching, plays, nameOf, ctx])
  const [starsRef, starsWidth] = useFitKey()
  if (!recap) return null

  return (
    <Box sx={{ px: 2, pb: 2, pt: 0.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <Typography sx={{ fontSize: '1.15rem', fontWeight: 700, lineHeight: 1.2 }}>{recap.headline}</Typography>
        <Typography sx={{ fontSize: '0.9rem', color: 'text.secondary', mt: 0.75, lineHeight: 1.35 }}>{recap.blurb}</Typography>
      </Box>

      {recap.feats.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {recap.feats.map((f, i) => (
            <Box key={i} sx={{ px: 1, py: 0.4, borderRadius: 999, border: '1px solid', borderColor: CARD_BORDER,
              fontSize: '0.72rem', fontWeight: 600, bgcolor: 'action.hover' }}>{f}</Box>
          ))}
        </Box>
      )}

      {recap.stars.length > 0 && (
        <Box>
          <Typography sx={{ fontSize: '0.63rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.6, color: 'text.disabled', mb: 0.25 }}>Stars of the game</Typography>
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
                    onClick={p && onOpenPlayer ? () => onOpenPlayer(p) : undefined} />
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
              <Typography component="span" sx={{ fontSize: '0.72rem', fontWeight: 800, color: d.key === 'L' ? 'text.disabled' : WPBL_ACCENT }}>{d.key}</Typography>
              <Typography component="span" sx={{ fontSize: '0.78rem', fontWeight: 600, ml: 0.5 }}>{d.name}</Typography>
              <Typography component="span" sx={{ fontSize: '0.72rem', color: 'text.secondary', ml: 0.5 }}>{d.statline}</Typography>
            </Box>
          ))}
        </Box>
      )}

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

export function LastGameCard({ games, teams, players, onOpenGame }: {
  games: WpblGame[]
  teams: Map<string, WpblTeam>
  players: WpblPlayer[]
  onOpenGame: (g: WpblGame) => void
}) {
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

  const nameOf = useMemo(() => {
    const byId = new Map(players.map(p => [p.id, p.name]))
    return (id: string) => byId.get(id) ?? '—'
  }, [players])

  const ctx = useMemo(() => leagueRecapContext(games), [games])
  const recap = useMemo(() => game ? buildRecap(game, teams, data?.batting ?? [], data?.pitching ?? [], data?.plays ?? [], nameOf, ctx) : null,
    [game, teams, data, nameOf, ctx])

  const [starRef, starWidth] = useFitKey()
  if (!game || !recap) return null
  const away = teams.get(game.away_team_id), home = teams.get(game.home_team_id)
  const dateLabel = relativeDayLabel(game.game_date)

  const scoreRow = (team: WpblTeam | undefined, score: number | null, won: boolean) => team && (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <TeamBadge team={team} size={26} />
      <Typography sx={{ flex: 1, fontSize: '0.9rem', fontWeight: won ? 800 : 600, color: won ? 'text.primary' : 'text.secondary' }}>{wpblFullName(team)}</Typography>
      <Typography sx={{ fontSize: '1rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: won ? 'text.primary' : 'text.secondary' }}>{score}</Typography>
    </Box>
  )

  return (
    <SectionCard
      title="Last Game"
      subtitle={dateLabel}
      action={
        <Typography onClick={() => onOpenGame(game)} sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--wpbl-accent-fg)', cursor: 'pointer', flexShrink: 0, '&:hover': { textDecoration: 'underline' } }}>
          Full recap
        </Typography>
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
        {scoreRow(away, game.away_score, recap.winner.id === away?.id)}
        {scoreRow(home, game.home_score, recap.winner.id === home?.id)}
      </Box>
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.2 }}>{recap.headline}</Typography>
      <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', mt: 0.5, lineHeight: 1.35 }}>{recap.blurb}</Typography>
      {recap.stars[0] && (
        // One star with the card to itself, so its name almost always fits in full — but it
        // still gets the same fit key, so a name shortened on a narrow phone comes back when
        // the phone turns.
        <Box ref={starRef} sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <StarRow star={recap.stars[0]} medal="🥇" name={recap.stars[0].name} teamId={recap.stars[0].teamId} portraitSize={44} medalSize={30} fitKey={starWidth} onClick={() => onOpenGame(game)} />
        </Box>
      )}
    </SectionCard>
  )
}
