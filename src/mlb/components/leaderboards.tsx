import React, { useState } from 'react'
import { Box, Typography } from '@mui/material'
import { InfoTip } from './ui'
import { SectionCard, CardLink, TextGhost, TYPE_SCALE } from '../../ui/card'
import { ACCENT, TEAM_BG, TEAM_SECONDARY, HEADSHOT, HEADSHOT_THUMB, TEAM_NICKNAME } from '../constants'
import { useIsDark, useTextTone, ringColor, teamLogoBg, teamLogoSrc, teamLogoCrop, photoBorderAlpha } from '../lib/colorUtils'
import { MlbSheet } from './MlbSheet'
import { chromePx, typePx } from '../../ui/scale'
import { playerLink, teamLink, LINK_SX } from '../lib/links'

// ─── Leaderboard row model, shared by every Report Card board ───────────────

export interface LbRow {
  teamId: number
  abbr: string
  name: string
  sub?: string
  value: string
  barFraction: number   // 0..1
  label?: string        // snarky verdict, only shown in the 3-row mini card
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

export function TeamLogo({ teamId, abbr, size = 36, accent, highlighted }: {
  teamId: number; abbr: string; size?: number; accent?: string; highlighted?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const isDark = useIsDark()
  const ring = ringColor(teamId, isDark)
  return (
    <Box sx={{
      width: chromePx(size), height: chromePx(size), borderRadius: '50%', flexShrink: 0,
      bgcolor: failed ? ring : teamLogoBg(teamId, isDark),
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      boxShadow: highlighted && accent ? `0 0 0 2.5px ${accent}` : `0 0 0 1px ${ring}30`,
    }}>
      {failed ? (
        <Typography sx={{ color: '#fff', fontWeight: 900, fontSize: abbr.length > 2 ? TYPE_SCALE.nano : TYPE_SCALE.caption, lineHeight: 1 }}>
          {abbr}
        </Typography>
      ) : (
        <Box
          component="img"
          src={teamLogoSrc(teamId, isDark)}
          alt={abbr}
          crossOrigin="anonymous"
          onError={() => setFailed(true)}
          sx={{ width: '78%', height: '78%', objectFit: 'contain', display: 'block', transform: teamLogoCrop(teamId, isDark), transformOrigin: 'center' }}
        />
      )}
    </Box>
  )
}

// The bar and verdict columns are fixed so the bars line up row to row. At 124 + 54 they left a
// phone about 40px for the name, which read "Joey …" and "Los A…": narrower on a phone, the bar
// still compares the three rows and the name fits.
//
// THE NAME HAS A FLOOR AND THE BAR GIVES WAY TO IT. Fixed bars left the name whatever was over,
// and in the narrow right column of Home at 1024 with Large text that was 18px, a name drawn
// across the bar beside it. Every row carries the same floor, so the bars still shrink together
// and still line up.
const BAR_W   = { xs: chromePx(64), sm: chromePx(124) }
// The verdict column holds a word ("CONFIRMED FRAUD"), so it is sized in rem and grows with the text.
// 4rem since the verdict moved to TYPE_SCALE.caption: at 3.5 "CONFIRMED" ran 7px past it.
const LABEL_W = '4rem'

export function LeaderboardRowItem({ row, rank, accent, showLabel, onSelect, ghost }: {
  row: LbRow; rank: number; accent: string; showLabel: boolean; onSelect?: (id: number) => void
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
        : <TeamLogo teamId={row.teamId} abbr={row.abbr} accent={accent} />}

      <Box sx={{ flex: 1, minWidth: '4rem' }}>
        <Typography sx={{ fontWeight: 700, fontSize: TYPE_SCALE.body, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {/* The nickname beside a logo that already says the city: "Dodgers" rather than "Los Angeles
              Do…". Always on the three-row card, whose verdict column leaves the name the least room
              (in Home's narrow column it cut "St. Louis Ca…"); on a phone in the full sheet too. */}
          <Box component="span" sx={{ display: showLabel ? 'inline' : { xs: 'inline', sm: 'none' } }}>{g(TEAM_NICKNAME[row.teamId] ?? row.name)}</Box>
          {!showLabel && <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{g(row.name)}</Box>}
        </Typography>
        {row.sub && (
          <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.secondary', fontWeight: 500, mt: 0.1 }}>
            {g(row.sub)}
          </Typography>
        )}
      </Box>

      <Box sx={{ flexBasis: BAR_W, flexShrink: 1, flexGrow: 0, minWidth: '3.5rem' }}>
        <Box sx={{ height: chromePx(7), bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden', mb: 0.5 }}>
          {!ghost && <Box sx={{ height: '100%', width: `${Math.max(row.barFraction, 0) * 100}%`, bgcolor: accent, borderRadius: 1, opacity: 0.85, transition: 'width 0.3s' }} />}
        </Box>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, color: tone(accent), textAlign: 'right', lineHeight: 1 }}>
          {g(row.value)}
        </Typography>
      </Box>

      {showLabel && (
        <Typography sx={{
          fontSize: TYPE_SCALE.caption, fontWeight: 800, color: tone(accent),
          width: LABEL_W, flexShrink: 0, textAlign: 'right',
          letterSpacing: typePx(0.5), lineHeight: 1.25,
          textTransform: 'uppercase',
        }}>
          {g(row.label ?? '')}
        </Typography>
      )}
    </Box>
  )
}

// ─── Mini card: top 3 rows + snarky labels ───────────────────────────────────

/** What a board's three rows look like before they land: the row component itself, ghosted, so
 *  the card holds the room it will take (CLAUDE.md, loading states). The strings are only there
 *  to be measured; they are drawn as bars. The team rows reserve the record line that most of
 *  the team boards carry. */
const GHOST_TEAM_ROW: LbRow = { teamId: 0, abbr: 'MLB', name: 'Baltimore Orioles', sub: '81–81', value: '.500', barFraction: 0, label: 'Fine' }
const GHOST_PLAYER_ROW: PlayerLbRow = { playerId: 0, playerName: 'Bobby Witt Jr.', teamId: 0, teamAbbr: 'KC', value: '20', barFraction: 0, label: 'Hot' }

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
        <InfoTip text={
          <>
            <Typography sx={{ fontWeight: 700, fontSize: TYPE_SCALE.body, mb: 0.5 }}>What this shows</Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, lineHeight: 1.5 }}>{tooltipText}</Typography>
          </>
        } />
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
        ? [1, 2, 3].map(r => <LeaderboardRowItem key={r} row={GHOST_TEAM_ROW} rank={r} accent={accent} showLabel ghost />)
        : rows.slice(0, 3).map((row, idx) => (
          <LeaderboardRowItem key={row.teamId} row={row} rank={idx + 1} accent={accent} showLabel onSelect={onSelectTeam} />
        ))}
    </BoardCard>
  )
}

// ─── Fullscreen modal: full scrollable ranking, no snarky labels ─────────────

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
      {/* All teams, no verdict labels */}
      {rows.map((row, idx) => (
        <LeaderboardRowItem key={row.teamId} row={row} rank={idx + 1} accent={accent ?? ACCENT} showLabel={false} onSelect={onSelectTeam} />
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
  label?: string        // snarky verdict, only shown in the 3-row mini card
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
  const isDark = useIsDark()

  // WPBL's PlayerPortrait, for the two Stats boards it shares a frame with: a round face inside a
  // 2px ring of the club's second colour, so a row on /mlb/leaders and one on /wpbl/stats are the
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
          border: `2px solid ${(teamId && TEAM_SECONDARY[teamId]) || 'rgba(128,128,128,0.3)'}`,
        }}
      />
    )
  }

  // Cropped rounded-rectangle portrait, matching the home-screen player cards
  // (TopPerformers / Spotlight): the face framed near the top rather than a tight
  // circle that clips the head, inside a team-colored border.
  if (variant === 'portrait') {
    const border = teamId ? photoBorderAlpha(TEAM_BG[teamId] ?? '#888', isDark) : 'rgba(128,128,128,0.3)'
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

export function PlayerLeaderboardRowItem({ row, rank, accent, showLabel, onSelect, ghost }: {
  row: PlayerLbRow; rank: number; accent: string; showLabel: boolean; onSelect?: (id: number) => void
  /** Draw the row's exact box with nothing in it, for the card's loading state. */
  ghost?: boolean
}) {
  const isDark = useIsDark()
  const tone = useTextTone()
  const g = (text: React.ReactNode) => ghost ? <TextGhost>{text}</TextGhost> : text
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
        <Typography sx={{ fontWeight: 700, fontSize: TYPE_SCALE.body, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {g(row.playerName)}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.15 }}>
          {ghost && <Box sx={{ width: chromePx(14), height: chromePx(14), borderRadius: '50%', bgcolor: 'action.hover', flexShrink: 0 }} />}
          {!ghost && row.teamId > 0 && (
            <Box sx={{ width: chromePx(14), height: chromePx(14), borderRadius: '50%', bgcolor: teamLogoBg(row.teamId, isDark), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
              <Box
                component="img"
                src={teamLogoSrc(row.teamId, isDark)}
                alt={row.teamAbbr}
                sx={{ width: chromePx(11), height: chromePx(11), objectFit: 'contain', transform: teamLogoCrop(row.teamId, isDark), transformOrigin: 'center' }}
                onError={(ev: React.SyntheticEvent<HTMLImageElement>) => { ev.currentTarget.parentElement!.style.display = 'none' }}
              />
            </Box>
          )}
          <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.secondary', fontWeight: 600, lineHeight: 1 }}>
            {g(row.teamAbbr)}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ flexBasis: BAR_W, flexShrink: 1, flexGrow: 0, minWidth: '3.5rem' }}>
        <Box sx={{ height: chromePx(7), bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden', mb: 0.5 }}>
          {!ghost && <Box sx={{ height: '100%', width: `${Math.max(row.barFraction, 0) * 100}%`, bgcolor: accent, borderRadius: 1, opacity: 0.85, transition: 'width 0.3s' }} />}
        </Box>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, color: tone(accent), textAlign: 'right', lineHeight: 1 }}>
          {g(row.value)}
        </Typography>
      </Box>

      {showLabel && (
        <Typography sx={{
          fontSize: TYPE_SCALE.caption, fontWeight: 800, color: tone(accent),
          width: LABEL_W, flexShrink: 0, textAlign: 'right',
          letterSpacing: typePx(0.5), lineHeight: 1.25,
          textTransform: 'uppercase',
        }}>
          {g(row.label ?? '')}
        </Typography>
      )}
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
        ? [1, 2, 3].map(r => <PlayerLeaderboardRowItem key={r} row={GHOST_PLAYER_ROW} rank={r} accent={accent} showLabel ghost />)
        : rows.length === 0
          ? (
            <Typography sx={{ textAlign: 'center', py: 2.5, fontSize: TYPE_SCALE.meta, color: 'text.disabled' }}>
              No active streaks
            </Typography>
          )
          : rows.slice(0, 3).map((row, idx) => (
            <PlayerLeaderboardRowItem key={row.playerId} row={row} rank={idx + 1} accent={accent} showLabel onSelect={onSelectPlayer} />
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
        <PlayerLeaderboardRowItem key={row.playerId} row={row} rank={idx + 1} accent={accent ?? ACCENT} showLabel={false} onSelect={onSelectPlayer} />
      ))}
    </BoardSheet>
  )
}
