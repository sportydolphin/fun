import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress, Tooltip } from '@mui/material'
import { fetchWpblPlayerLines, fetchWpblPitcherLocations, type WpblPitchLoc } from './api'
import { sumBatting, sumPitching, sumFielding, fmtRate, fmtTwo } from './stats'
import { wpblAccent, wpblFullName, outsToIp } from './constants'
import { ModalShell, PlayerPortrait, useWpblDark } from './ui'
import { PitchLocationCard } from './PitchLocation'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblFieldingLine } from './types'

// Player page (Phase 1c): profile + season totals aggregated from box-score lines,
// plus a per-game log. Public read; opened from a team's roster.

// What each abbreviation stands for — surfaced on hover/tap so the stat line isn't cryptic.
const STAT_FULL: Record<string, string> = {
  AVG: 'Batting average', OBP: 'On-base percentage', SLG: 'Slugging percentage', OPS: 'On-base plus slugging',
  G: 'Games', AB: 'At-bats', R: 'Runs', H: 'Hits', '2B': 'Doubles', '3B': 'Triples', HR: 'Home runs',
  RBI: 'Runs batted in', BB: 'Walks', SO: 'Strikeouts', SB: 'Stolen bases', TB: 'Total bases',
  ERA: 'Earned run average', WHIP: 'Walks + hits per inning pitched', 'W-L': 'Wins–Losses', SV: 'Saves',
  IP: 'Innings pitched', ER: 'Earned runs', P: 'Pitches thrown', DEC: 'Decision (W/L/S/H)', OPP: 'Opponent',
  FPCT: 'Fielding percentage', PO: 'Putouts', A: 'Assists', E: 'Errors', DP: 'Double plays',
  PB: 'Passed balls', SBA: 'Stolen bases allowed',
}
const statFull = (k: string): string => STAT_FULL[k] ?? k

// A batting line only counts as real batting if the player actually came to the plate — an
// at-bat, a walk, a HBP, or a sacrifice. Zero-PA rows (a pinch-runner who scored, a defensive
// sub) otherwise surface as an all-zero stat block and a phantom "0-for-0" game-log line, so
// we drop them entirely rather than show empty stats.
const hasPlateAppearance = (l: WpblBattingLine): boolean =>
  l.ab + l.bb + l.hbp + l.sf + l.sh > 0
// The player modal sits at zIndex 1600; MUI's tooltip defaults to 1500, so it would
// render behind the modal. Lift the popper above it.
const tipSlotProps = { popper: { sx: { zIndex: 1700 } } } as const

// A stat section (Batting / Pitching / Fielding) as its own card with a team-color spine,
// a prominent rate-stat hero row, and a tidy aligned stat line of counting stats. `meta`
// carries the sample size (e.g. "4 G · 15 AB") so a reader calibrates the rate stats — a
// .333 over 15 AB and a .333 over 400 are very different, and this season is only days old.
function StatSection({ label, color, meta, hero, line }: {
  label: string; color: string; meta?: string
  hero: { label: string; value: string }[]
  line?: [string, string | number][]
}) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.75, py: 0.9, borderBottom: '1px solid', borderColor: 'divider', borderLeft: `3px solid ${color}` }}>
        <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Typography>
        {meta && <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', ml: 'auto', fontVariantNumeric: 'tabular-nums' }}>{meta}</Typography>}
      </Box>
      <Box sx={{ px: 1.75, py: 1.5 }}>
        {/* Hero rate stats — big, evenly spaced, divided */}
        <Box sx={{ display: 'flex', mb: line && line.length ? 1.75 : 0 }}>
          {hero.map((t, i) => (
            <Tooltip key={t.label} title={statFull(t.label)} arrow enterTouchDelay={0} leaveTouchDelay={2500} slotProps={tipSlotProps}>
              <Box sx={{ flex: 1, textAlign: 'center', cursor: 'help', borderLeft: i > 0 ? '1px solid' : 'none', borderColor: 'divider' }}>
                <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>{t.value}</Typography>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.disabled' }}>{t.label}</Typography>
              </Box>
            </Tooltip>
          ))}
        </Box>
        {/* Counting stats as an aligned label-over-value line */}
        {line && line.length > 0 && <StatLine items={line} />}
      </Box>
    </Box>
  )
}

// A condensed one-line version of a stat section, for a two-way player's *secondary* skill
// when it's just a cameo (a pitcher's handful of at-bats, or a position player's mop-up
// inning). It keeps the role visible without letting a tiny sample compete visually with
// the full hero card of what the player actually does.
function StatCameo({ label, color, summary }: { label: string; color: string; summary: string }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'baseline', gap: 1.25, flexWrap: 'wrap',
      border: '1px solid', borderColor: 'divider', borderLeft: `3px solid ${color}`,
      borderRadius: 2, px: 1.75, py: 1, mb: 2,
    }}>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, flexShrink: 0 }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{summary}</Typography>
    </Box>
  )
}

// Counting stats as evenly-spread columns (label over value) so everything lines up in a
// clean row. Each column is hoverable and shows what the abbreviation stands for.
function StatLine({ items }: { items: [string, string | number][] }) {
  return (
    <Box sx={{ display: 'flex', overflowX: 'auto', borderTop: '1px solid', borderColor: 'divider', pt: 1.25 }}>
      {items.map(([label, value]) => (
        <Tooltip key={label} title={statFull(label)} arrow enterTouchDelay={0} leaveTouchDelay={2500} slotProps={tipSlotProps}>
          <Box sx={{ flex: '1 0 auto', minWidth: 34, textAlign: 'center', px: 0.75, cursor: 'help' }}>
            <Typography sx={{ fontSize: '0.56rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled', mb: 0.15 }}>{label}</Typography>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
          </Box>
        </Tooltip>
      ))}
    </Box>
  )
}

// Per-game log as a full stat table: Date · Opp lead columns, then the counting stats for
// that game (a batting line or a pitching line). Scrolls horizontally on narrow screens so
// the whole line — pitches thrown, hits allowed, etc. — stays available without wrapping.
function GameLogTable({ title, statHeaders, rows }: {
  title: string
  statHeaders: string[]
  rows: { date: string; opp: string; cells: (string | number)[] }[]
}) {
  if (rows.length === 0) return null
  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={sectionSx}>{title}</Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', minWidth: 'max-content', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={{ ...thSx, textAlign: 'left' }}>Date</Box>
              <Box component="th" sx={{ ...thSx, textAlign: 'left' }}>Opp</Box>
              {statHeaders.map(h => (
                <Tooltip key={h} title={statFull(h)} arrow enterTouchDelay={0} leaveTouchDelay={2500} slotProps={tipSlotProps}>
                  <Box component="th" sx={{ ...thSx, cursor: 'help' }}>{h}</Box>
                </Tooltip>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {rows.map((r, i) => (
              <Box component="tr" key={i}>
                <Box component="td" sx={{ ...tdSx, textAlign: 'left', color: 'text.disabled' }}>{r.date}</Box>
                <Box component="td" sx={{ ...tdSx, textAlign: 'left', fontWeight: 700 }}>{r.opp}</Box>
                {r.cells.map((c, j) => <Box component="td" key={j} sx={tdSx}>{c}</Box>)}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export default function PlayerDetailModal({ player, teams, games, onClose }: {
  player: WpblPlayer
  teams: WpblTeam[]
  games: WpblGame[]
  onClose: () => void
}) {
  const isDark = useWpblDark()
  const team = useMemo(() => teams.find(t => t.id === player.team_id), [teams, player.team_id])
  const gameById = useMemo(() => new Map(games.map(g => [g.id, g])), [games])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const color = team ? wpblAccent(team.id, isDark) : '#888'

  const [loading, setLoading] = useState(true)
  const [batting, setBatting] = useState<WpblBattingLine[]>([])
  const [pitching, setPitching] = useState<WpblPitchingLine[]>([])
  const [fielding, setFielding] = useState<WpblFieldingLine[]>([])
  const [pitchLocs, setPitchLocs] = useState<WpblPitchLoc[]>([])

  useEffect(() => {
    let cancelled = false
    fetchWpblPlayerLines(player.id).then(({ batting, pitching, fielding }) => {
      if (cancelled) return
      setBatting(batting); setPitching(pitching); setFielding(fielding); setLoading(false)
    })
    // Pitch-location tracking keys on the feed id; empty for non-pitchers / unmapped players.
    setPitchLocs([])
    fetchWpblPitcherLocations(player.api_id).then(locs => { if (!cancelled) setPitchLocs(locs) })
    return () => { cancelled = true }
  }, [player.id, player.api_id])

  // Only real plate appearances count as batting — a 0-for-0 pinch/defensive cameo shouldn't
  // produce an all-zero batting card or a phantom game-log row.
  const battingReal = useMemo(() => batting.filter(hasPlateAppearance), [batting])
  const bt = useMemo(() => sumBatting(battingReal), [battingReal])
  const pt = useMemo(() => sumPitching(pitching), [pitching])
  const ft = useMemo(() => sumFielding(fielding), [fielding])
  const hasBatting = battingReal.length > 0
  const hasPitching = pitching.length > 0
  const hasFielding = fielding.some(f => f.po || f.a || f.e || f.dp || f.pb)

  // Lead with the skill the player is actually here for. Position codes carry the signal —
  // any pitcher role contains a 'P' (RHP/LHP/P/SP/RP), and no position-player code does — so
  // a "RHP, UTL" leads with pitching even when the box score also shows a few at-bats. When
  // one side is a cameo (a pitcher's stray ABs, a hitter's mop-up inning) we condense it to a
  // one-liner instead of a full hero card, so genuine two-way players stand apart from
  // occasional-hitting pitchers. Thresholds are absolute (AB / outs) so they hold at any
  // sample size; the whole season is only days old.
  const isPitcherPos = /P/.test(player.position ?? '')
  const pitcherFirst = hasPitching && (!hasBatting || isPitcherPos)
  const BAT_CAMEO_AB = 10, PIT_CAMEO_OUTS = 9
  const battingCameo = pitcherFirst && hasBatting && bt.ab < BAT_CAMEO_AB
  const pitchingCameo = !pitcherFirst && hasPitching && pt.outs < PIT_CAMEO_OUTS
  const twoWay = hasBatting && hasPitching && !battingCameo && !pitchingCameo

  // Sample-size meta for each section header, flagged as thin below a rough one-week-ish bar.
  const BAT_SMALL_AB = 25, PIT_SMALL_OUTS = 30 // < ~25 AB / < 10.0 IP reads as small sample
  const battingMeta = `${bt.g} G · ${bt.ab} AB${bt.ab < BAT_SMALL_AB ? ' · small sample' : ''}`
  const pitchingMeta = `${pt.g} G · ${outsToIp(pt.outs)} IP${pt.outs < PIT_SMALL_OUTS ? ' · small sample' : ''}`

  // Opponent label for a game the player appeared in.
  const oppLabel = (gameId: string): { date: string; text: string } => {
    const g = gameById.get(gameId)
    if (!g) return { date: '', text: '' }
    const isHome = g.home_team_id === player.team_id
    const oppId = isHome ? g.away_team_id : g.home_team_id
    const opp = teamById.get(oppId)
    const date = new Date(`${g.game_date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })
    return { date, text: `${isHome ? 'vs' : '@'} ${opp?.abbr ?? oppId}` }
  }

  const subParts = [player.position, [player.bats, player.throws].filter(Boolean).join('/') ? `B/T ${player.bats || '-'}/${player.throws || '-'}` : null, player.age != null ? `${player.age} yrs` : null].filter(Boolean)

  // Stat sections as elements so the body can order them by the player's primary role. A
  // cameo secondary skill renders as a one-line summary instead of a full hero card.
  const battingEl = !hasBatting ? null : battingCameo ? (
    <StatCameo label="Batting" color={color}
      summary={`${fmtRate(bt.avg)}/${fmtRate(bt.obp)}/${fmtRate(bt.slg)} · ${bt.h}-for-${bt.ab}${bt.hr ? `, ${bt.hr} HR` : ''}${bt.rbi ? `, ${bt.rbi} RBI` : ''}`} />
  ) : (
    <StatSection
      label="Batting" color={color} meta={battingMeta}
      hero={[
        { label: 'AVG', value: fmtRate(bt.avg) }, { label: 'OBP', value: fmtRate(bt.obp) },
        { label: 'SLG', value: fmtRate(bt.slg) }, { label: 'OPS', value: fmtRate(bt.ops) },
      ]}
      line={[['G', bt.g], ['AB', bt.ab], ['R', bt.r], ['H', bt.h], ['2B', bt.doubles], ['3B', bt.triples], ['HR', bt.hr], ['RBI', bt.rbi], ['BB', bt.bb], ['SO', bt.so], ['SB', bt.sb], ['TB', bt.tb]]}
    />
  )

  const pitchingEl = !hasPitching ? null : pitchingCameo ? (
    <StatCameo label="Pitching" color={color}
      summary={`${fmtTwo(pt.era)} ERA, ${fmtTwo(pt.whip)} WHIP · ${outsToIp(pt.outs)} IP, ${pt.so} K${pt.w || pt.l ? `, ${pt.w}-${pt.l}` : ''}`} />
  ) : (
    <StatSection
      label="Pitching" color={color} meta={pitchingMeta}
      hero={[
        { label: 'ERA', value: fmtTwo(pt.era) }, { label: 'WHIP', value: fmtTwo(pt.whip) },
        { label: 'W-L', value: `${pt.w}-${pt.l}` }, ...(pt.s > 0 ? [{ label: 'SV', value: String(pt.s) }] : []),
      ]}
      line={[['G', pt.g], ['IP', outsToIp(pt.outs)], ['H', pt.h], ['R', pt.r], ['ER', pt.er], ['BB', pt.bb], ['SO', pt.so], ['HR', pt.hr]]}
    />
  )

  const pitchLocEl = pitchLocs.length > 0 ? <PitchLocationCard rows={pitchLocs} accent={color} gamesPitched={pt.g} /> : null

  const battingLogEl = !hasBatting ? null : (
    <GameLogTable
      title={hasPitching ? 'Hitting log' : 'Game log'}
      statHeaders={['AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'SO', 'SB', 'TB']}
      rows={battingReal.map(l => { const o = oppLabel(l.game_id); return { date: o.date, opp: o.text, cells: [l.ab, l.r, l.h, l.doubles, l.triples, l.hr, l.rbi, l.bb, l.so, l.sb, l.tb] } })}
    />
  )
  const pitchingLogEl = !hasPitching ? null : (
    <GameLogTable
      title={hasBatting ? 'Pitching log' : 'Game log'}
      statHeaders={['DEC', 'IP', 'H', 'R', 'ER', 'BB', 'SO', 'HR', 'P']}
      rows={pitching.map(l => { const o = oppLabel(l.game_id); return { date: o.date, opp: o.text, cells: [l.decision ?? '—', outsToIp(l.outs), l.h, l.r, l.er, l.bb, l.so, l.hr, l.pitches ?? '—'] } })}
    />
  )

  const fieldingEl = !hasFielding ? null : (
    <StatSection
      label="Fielding" color={color}
      hero={[
        { label: 'FPCT', value: fmtRate(ft.fpct) }, { label: 'PO', value: String(ft.po) },
        { label: 'A', value: String(ft.a) }, { label: 'E', value: String(ft.e) },
        ...(ft.dp ? [{ label: 'DP', value: String(ft.dp) }] : []),
        ...(ft.pb ? [{ label: 'PB', value: String(ft.pb) }] : []),
        ...(ft.sba ? [{ label: 'SBA', value: String(ft.sba) }] : []),
      ]}
    />
  )

  // Primary skill leads; pitch-location plots sit with the pitching block. Logs follow the
  // same order so the page reads top-to-bottom as one role then the other.
  const statBlocks = pitcherFirst
    ? [pitchingEl, pitchLocEl, battingEl, fieldingEl, pitchingLogEl, battingLogEl]
    : [battingEl, pitchingEl, pitchLocEl, fieldingEl, battingLogEl, pitchingLogEl]

  return (
    <ModalShell
      eyebrow={team ? wpblFullName(team) : 'Player'}
      onClose={onClose}
      maxWidth={640}
      zIndex={1600}
    >
      {/* Identity */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ width: 4, alignSelf: 'stretch', borderRadius: 3, bgcolor: color, flexShrink: 0 }} />
        <PlayerPortrait name={player.name} teamId={player.team_id} size={72} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.2rem', fontWeight: 800, lineHeight: 1.15 }}>{player.name}</Typography>
            {twoWay && (
              <Box sx={{ flexShrink: 0, px: 0.75, py: 0.15, borderRadius: 1, border: `1px solid ${color}`, color, fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Two-way
              </Box>
            )}
          </Box>
          {subParts.length > 0 && (
            <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>{subParts.join(' · ')}</Typography>
          )}
          {player.hometown && <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>{player.hometown}{player.draft_round ? ` · Round ${player.draft_round}, Pick ${player.draft_pick}` : ''}</Typography>}
        </Box>
      </Box>

      <Box sx={{ p: 2 }}>
        {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
          ) : !hasBatting && !hasPitching && !hasFielding ? (
            <Box sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
              <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>No stats yet</Typography>
              <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>Season totals appear here once this player logs a game.</Typography>
            </Box>
          ) : (
            // Ordered by primary role; nulls (absent skills) drop out cleanly.
            <>{statBlocks.map((el, i) => el && <Box key={i}>{el}</Box>)}</>
          )}
        </Box>
    </ModalShell>
  )
}

const sectionSx = { fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', mb: 1 } as const

// Game-log table cells. Headers are compact uppercase; body cells are tabular so columns
// stay aligned down the table. Both center-align (numeric); the Date/Opp lead columns
// override to left in the component.
const thSx = { fontSize: '0.56rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'text.disabled', py: 0.6, px: 0.85, textAlign: 'center', borderBottom: '1px solid', borderColor: 'divider', whiteSpace: 'nowrap' } as const
const tdSx = { fontSize: '0.8rem', fontWeight: 600, py: 0.55, px: 0.85, textAlign: 'center', borderTop: '1px solid', borderColor: 'divider', whiteSpace: 'nowrap' } as const
