import { useDark } from '../../ui/useDark'
import React from 'react'
import { Box, Typography } from '@mui/material'
import { InfoDot } from '../../ui/InfoDot'
import { SectionCard, CardLink, TextGhost, TYPE_SCALE, edge } from '../../ui/card'
import { ACCENT, TEAM_BG, TEAM_SECONDARY, HEADSHOT, HEADSHOT_THUMB, TEAM_NICKNAME } from '../constants'
import { useTextTone, edgeTone } from '../lib/colorUtils'
import { MlbSheet } from './MlbSheet'
import { TeamLogo } from './TeamLogo'
import { chromePx } from '../../ui/scale'
import { nameAtStage, useLineNameFit } from '../../ui/names'
import { playerLink, teamLink, LINK_SX } from '../lib/links'

// ─── Leaderboard row model, shared by every Report Card board ───────────────

export interface LbRow {
  teamId: number
  abbr: string
  name: string
  sub?: string
  value: string
  barFraction: number   // 0..1
}

export interface Board {
  id: string
  icon: string
  title: string
  subtitle: string
  accent: string
  tooltipText?: string
  rows: LbRow[]
  loading: boolean
}

// THE BAR RUNS UNDER THE NAME, the full width of the row's middle. It was a column of its own
// beside the name, and the two split one width: 64px of bar on a phone, a sliver for a scale
// meant to be the card's picture, and every pixel given to it came off the name ("Joey …",
// "Los A…", and in Home's narrow column at Large text a name drawn across the bar). Stacked, the
// name gets the whole line, the bar gets the whole line under it, and every row's middle is the
// same width, so the bars still start and end together and compare row to row.

/** A row's bar: the stat against the board's range, across the whole middle of the row. */
function ScaleBar({ fraction, accent, ghost }: { fraction: number; accent: string; ghost?: boolean }) {
  return (
    <Box sx={{ height: chromePx(8), bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden', mt: 0.6 }}>
      {!ghost && <Box sx={{ height: '100%', width: `${Math.max(fraction, 0) * 100}%`, bgcolor: accent, borderRadius: 1, opacity: 0.85, transition: 'width 0.3s' }} />}
    </Box>
  )
}

/** The value, at the right end of the line under the name: just above where its bar ends. */
const VALUE_SX = { fontSize: TYPE_SCALE.meta, fontWeight: 800, textAlign: 'right', lineHeight: 1, flexShrink: 0, ml: 'auto', pl: 1 } as const

export function LeaderboardRowItem({ row, rank, accent, compact, onSelect, ghost }: {
  row: LbRow; rank: number; accent: string; compact: boolean; onSelect?: (id: number) => void
  /** Draw the row's exact box with nothing in it, for the card's loading state. */
  ghost?: boolean
}) {
  const tone = useTextTone()
  const g = (text: React.ReactNode) => ghost ? <TextGhost>{text}</TextGhost> : text
  return (
    <Box
      {...(ghost ? {} : teamLink(row.teamId, onSelect))}
      sx={{
        ...LINK_SX, display: 'flex', alignItems: 'center', gap: 1.25,
        py: 0.9, px: 0.75, borderRadius: 2,
        ...(onSelect ? { cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } } : {}),
        transition: 'background-color 0.15s',
      }}
    >
      <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled', fontWeight: 700, width: '1rem', textAlign: 'right', flexShrink: 0 }}>
        {rank}
      </Typography>

      {ghost
        ? <Box sx={{ width: chromePx(36), height: chromePx(36), borderRadius: '50%', flexShrink: 0, bgcolor: 'action.hover' }} />
        : <TeamLogo teamId={row.teamId} abbr={row.abbr} size={36} />}

      <Box sx={{ flex: 1, minWidth: '4rem' }}>
        <Typography sx={{ fontWeight: 700, fontSize: TYPE_SCALE.body, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {/* The nickname beside a logo that already says the city: "Dodgers" rather than "Los Angeles
              Do…". Always on the three-row card, which leaves the name the least room (in Home's narrow
              column it cut "St. Louis Ca…"); on a phone in the full sheet too. */}
          <Box component="span" sx={{ display: compact ? 'inline' : { xs: 'inline', sm: 'none' } }}>{g(TEAM_NICKNAME[row.teamId] ?? row.name)}</Box>
          {!compact && <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{g(row.name)}</Box>}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'baseline', mt: 0.3 }}>
          {row.sub && (
            <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.secondary', fontWeight: 500, lineHeight: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {g(row.sub)}
            </Typography>
          )}
          <Typography sx={{ ...VALUE_SX, color: tone(accent) }}>{g(row.value)}</Typography>
        </Box>
        <ScaleBar fraction={row.barFraction} accent={accent} ghost={ghost} />
      </Box>

    </Box>
  )
}

// ─── Mini card: top 3 rows ───────────────────────────────────

/** What a board's three rows look like before they land: the row component itself, ghosted, so
 *  the card holds the room it will take (CLAUDE.md, loading states). The strings are only there
 *  to be measured; they are drawn as bars. The team rows reserve the record line that most of
 *  the team boards carry. */
const GHOST_TEAM_ROW: LbRow = { teamId: 0, abbr: 'MLB', name: 'Baltimore Orioles', sub: '81–81', value: '.500', barFraction: 0 }
const GHOST_PLAYER_ROW: PlayerLbRow = { playerId: 0, playerName: 'Bobby Witt Jr.', teamId: 0, teamAbbr: 'KC', value: '20', barFraction: 0 }

/**
 * The frame every Report Card board draws in, on Home and on the Charts tab: WPBL's SectionCard,
 * with the board's emoji in its icon slot and a link in the header. Until Oct 9, 2026 each board
 * hand-rolled its own box with a ruled header, a 1rem title and a bordered pill or an expand
 * icon, which read as a second design system one card below WPBL's.
 */
function BoardCard({ icon, title, subtitle, tooltipText, actionLabel, actionHref, onExpand, children }: {
  icon: string
  title: string
  subtitle: string
  tooltipText?: string
  actionLabel: string
  actionHref?: string
  onExpand: () => void
  children: React.ReactNode
}) {
  return (
    <SectionCard
      icon={icon}
      title={title}
      subtitle={subtitle}
      titleAdornment={tooltipText ? (
        <InfoDot text={tooltipText} label="What this shows" />
      ) : undefined}
      action={<CardLink label={actionLabel} href={actionHref} onClick={onExpand} />}
    >
      {/* The rows' own hover inset, pulled back out so their content starts on the title's edge. */}
      <Box sx={{ mx: -0.75 }}>{children}</Box>
    </SectionCard>
  )
}

/** The header link. By default "All 30", opening the board's own sheet; Home's boards pass a
 *  label and an address instead, since theirs goes to the Charts tab. */
interface BoardAction {
  onExpand: () => void
  actionLabel?: string
  actionHref?: string
}

export function LeaderboardCard({ icon, title, subtitle, accent, tooltipText, rows, loading, onExpand, onSelectTeam, actionLabel, actionHref }: Omit<Board, 'id'> & BoardAction & {
  onSelectTeam?: (id: number) => void
}) {
  return (
    <BoardCard icon={icon} title={title} subtitle={subtitle} tooltipText={tooltipText}
      actionLabel={actionLabel ?? `All ${rows.length || 30}`} actionHref={actionHref} onExpand={onExpand}>
      {loading
        ? [1, 2, 3].map(r => <LeaderboardRowItem key={r} row={GHOST_TEAM_ROW} rank={r} accent={accent} compact ghost />)
        : rows.slice(0, 3).map((row, idx) => (
          <LeaderboardRowItem key={row.teamId} row={row} rank={idx + 1} accent={accent} compact onSelect={onSelectTeam} />
        ))}
    </BoardCard>
  )
}

// ─── Fullscreen modal: full scrollable ranking ─────────────

/** The sheet both fullscreen boards open in. */
function BoardSheet({ onClose, icon, title, subtitle, children }: {
  onClose: () => void
  icon?: string
  title?: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <MlbSheet onClose={onClose} maxWidth={chromePx(540)} sheet eyebrow={[icon, title].filter(Boolean).join(' ')}>
      {subtitle && (
        <Typography sx={{ px: 2, pt: 1.25, fontSize: TYPE_SCALE.meta, color: 'text.secondary', flexShrink: 0 }}>{subtitle}</Typography>
      )}
      <Box sx={{ p: 1.5 }}>{children}</Box>
    </MlbSheet>
  )
}

export function LeaderboardModal({ open, onClose, icon, title, subtitle, accent, rows, onSelectTeam }: {
  open: boolean
  onClose: () => void
  icon?: string
  title?: string
  subtitle?: string
  accent?: string
  rows: LbRow[]
  onSelectTeam?: (id: number) => void
}) {
  if (!open) return null
  return (
    <BoardSheet onClose={onClose} icon={icon} title={title} subtitle={subtitle}>
      {/* All teams */}
      {rows.map((row, idx) => (
        <LeaderboardRowItem key={row.teamId} row={row} rank={idx + 1} accent={accent ?? ACCENT} compact={false} onSelect={onSelectTeam} />
      ))}
    </BoardSheet>
  )
}

// ─── Player report cards: headshot rows for the active-streak boards ─────────

export interface PlayerLbRow {
  playerId: number
  playerName: string
  teamId: number
  teamAbbr: string
  value: string
  barFraction: number   // 0..1
}

export interface PlayerBoard {
  id: string
  icon: string
  title: string
  subtitle: string
  accent: string
  tooltipText?: string
  rows: PlayerLbRow[]
  loading: boolean
}

export function PlayerHeadshot({ playerId, name, size = 36, accent, highlighted, variant = 'circle', teamId }: {
  playerId: number; name: string; size?: number; accent?: string; highlighted?: boolean
  variant?: 'circle' | 'portrait' | 'ring'; teamId?: number
}) {
  const isDark = useDark()

  // WPBL's PlayerPortrait, for the two Stats boards it shares a frame with: a round face inside a
  // 2px ring of the club's second color, so a row on /mlb/leaders and one on /wpbl/stats are the
  // same object. The headshot box is the size given, ring included, as WPBL's is. No alt: the
  // name is printed beside it in every row that draws one.
  if (variant === 'ring') {
    return (
      <Box
        component="img"
        src={HEADSHOT_THUMB(playerId)}
        alt=""
        loading="lazy"
        sx={{
          width: chromePx(size), height: chromePx(size), borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
          bgcolor: 'action.hover',
          border: '2px solid', borderColor: teamId && TEAM_SECONDARY[teamId] ? edge(TEAM_SECONDARY[teamId]) : 'outline',
        }}
      />
    )
  }

  // Cropped rounded-rectangle portrait, matching the home-screen player cards
  // (TopPerformers / Spotlight): the face framed near the top rather than a tight
  // circle that clips the head, inside a team-colored border.
  if (variant === 'portrait') {
    const border = teamId ? edgeTone(TEAM_BG[teamId] ?? '#888', isDark) : 'rgba(128,128,128,0.3)'
    return (
      <Box sx={{
        flexShrink: 0, width: chromePx(size), height: chromePx(Math.round(size * 70 / 58)),
        borderRadius: 1.5, overflow: 'hidden',
        border: `2px solid ${border}`, bgcolor: 'action.hover',
      }}>
        <Box
          component="img"
          src={HEADSHOT(playerId)}
          alt={name}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', display: 'block' }}
        />
      </Box>
    )
  }

  return (
    <Box
      component="img"
      src={HEADSHOT(playerId)}
      alt={name}
      sx={{
        width: chromePx(size), height: chromePx(size), borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
        bgcolor: 'action.hover',
        boxShadow: highlighted && accent ? `0 0 0 2.5px ${accent}` : '0 0 0 1px rgba(128,128,128,0.25)',
      }}
    />
  )
}

export function PlayerLeaderboardRowItem({ row, rank, accent, onSelect, ghost }: {
  row: PlayerLbRow; rank: number; accent: string; onSelect?: (id: number) => void
  /** Draw the row's exact box with nothing in it, for the card's loading state. */
  ghost?: boolean
}) {
  const tone = useTextTone()
  const g = (text: React.ReactNode) => ghost ? <TextGhost>{text}</TextGhost> : text
  // "F. Last" before an ellipsis, measured against the room the row leaves (CLAUDE.md): at 375px
  // the card cut "Nolan Aren…" and "Yordan Alva…".
  const fit = useLineNameFit<HTMLElement>([row.playerName])
  return (
    <Box
      {...(ghost ? {} : playerLink(row.playerId, row.playerName, onSelect))}
      sx={{
        ...LINK_SX, display: 'flex', alignItems: 'center', gap: 1.25,
        py: 0.9, px: 0.75, borderRadius: 2,
        ...(onSelect ? { cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } } : {}),
        transition: 'background-color 0.15s',
      }}
    >
      <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled', fontWeight: 700, width: '1rem', textAlign: 'right', flexShrink: 0 }}>
        {rank}
      </Typography>

      {ghost
        // The portrait's own box: its 2px border is inside these dimensions, so a plain fill of
        // the same size holds the same room.
        ? <Box sx={{ flexShrink: 0, width: chromePx(36), height: chromePx(Math.round(36 * 70 / 58)), borderRadius: 1.5, bgcolor: 'action.hover' }} />
        : <PlayerHeadshot playerId={row.playerId} name={row.playerName} variant="portrait" teamId={row.teamId} />}

      <Box sx={{ flex: 1, minWidth: '4rem' }}>
        <Typography ref={fit.ref} sx={{ fontWeight: 700, fontSize: TYPE_SCALE.body, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {g(nameAtStage(row.playerName, fit.stage))}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.3 }}>
          {ghost && <Box sx={{ width: chromePx(14), height: chromePx(14), borderRadius: '50%', bgcolor: 'action.hover', flexShrink: 0 }} />}
          {!ghost && row.teamId > 0 && (
            <TeamLogo teamId={row.teamId} abbr={row.teamAbbr} size={14} />
          )}
          <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.secondary', fontWeight: 600, lineHeight: 1 }}>
            {g(row.teamAbbr)}
          </Typography>
          <Typography sx={{ ...VALUE_SX, color: tone(accent) }}>{g(row.value)}</Typography>
        </Box>
        <ScaleBar fraction={row.barFraction} accent={accent} ghost={ghost} />
      </Box>

    </Box>
  )
}

export function PlayerLeaderboardCard({ icon, title, subtitle, accent, tooltipText, rows, loading, onExpand, onSelectPlayer, actionLabel, actionHref }: Omit<PlayerBoard, 'id'> & BoardAction & {
  onSelectPlayer?: (id: number) => void
}) {
  return (
    <BoardCard icon={icon} title={title} subtitle={subtitle} tooltipText={tooltipText}
      actionLabel={actionLabel ?? (rows.length > 3 ? `All ${rows.length}` : 'All')} actionHref={actionHref} onExpand={onExpand}>
      {loading
        ? [1, 2, 3].map(r => <PlayerLeaderboardRowItem key={r} row={GHOST_PLAYER_ROW} rank={r} accent={accent} ghost />)
        : rows.length === 0
          ? (
            <Typography sx={{ textAlign: 'center', py: 2.5, fontSize: TYPE_SCALE.meta, color: 'text.disabled' }}>
              No active streaks
            </Typography>
          )
          : rows.slice(0, 3).map((row, idx) => (
            <PlayerLeaderboardRowItem key={row.playerId} row={row} rank={idx + 1} accent={accent} onSelect={onSelectPlayer} />
          ))}
    </BoardCard>
  )
}

export function PlayerLeaderboardModal({ open, onClose, icon, title, subtitle, accent, rows, onSelectPlayer }: {
  open: boolean
  onClose: () => void
  icon?: string
  title?: string
  subtitle?: string
  accent?: string
  rows: PlayerLbRow[]
  onSelectPlayer?: (id: number) => void
}) {
  if (!open) return null
  return (
    <BoardSheet onClose={onClose} icon={icon} title={title} subtitle={subtitle}>
      {rows.map((row, idx) => (
        <PlayerLeaderboardRowItem key={row.playerId} row={row} rank={idx + 1} accent={accent ?? ACCENT} onSelect={onSelectPlayer} />
      ))}
    </BoardSheet>
  )
}
