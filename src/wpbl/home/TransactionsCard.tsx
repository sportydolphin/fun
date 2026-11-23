// Home's offseason news: every 2027 roster move, newest first. It took the season card's place beside
// Player Spotlight on Nov 21, 2026, the day of the first trade. That card had said who won since
// September; the moves are the only WPBL news that changes from week to week, and the recap page
// still has the champion.
//
// ONE ROW PER THING THAT CHANGED HANDS, under the club that got it. A trade is its rows together,
// dated once with no rule between them, so "Zettlemoyer for a 6th"
// reads as Boston getting the player and New York getting the pick, and a player-for-player deal
// reads one row each way. A trade's later rows show ⇄ in the date column, and a pick carries the
// small badge of the club it came from. The legs come from `transactions` in offseason2027.ts.
//
// FIXED ROWS, so the card is the same height loaded or not, whatever the moves: the skeleton is this
// card with `moves` null, and a season with fewer moves than ROWS fills the rest with invisible slots.
import { Box, Skeleton, Typography } from '@mui/material'
import type { WpblPlayer, WpblRosterMove, WpblTeam } from '../types'
import { SectionCard, TeamBadge, FittedName, TYPE_SCALE, TAPPABLE, FOCUS_RING, chromePx } from '../ui'
import { AGATE_SX } from '../../ui/card'
import { WPBL_ROSTERS_PAGE } from '../routes'
import { UNSTYLED_LINK, linkTo } from '../../nav'
import { track, EVENTS } from '../../lib/analytics'
import { useWpblPlayerLink } from '../LinkContext'
import { useWpblRosterMoves } from '../useRosterMoves'
import { transactions, moveLabel, pickLabel, CLUB_CITIES, ROSTER_SEASON, type TransactionLeg } from '../offseason2027'

const ROWS = 8
const BADGE = 22
/** The giving club's badge beside a traded pick: ornament, under the line's height. */
const PICK_BADGE = 14

type OpenPlayer = (p: WpblPlayer) => void

/** "Nov 21", from the announcement's calendar date. */
function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** A leg placed in the list: dated on a transaction's first row; `joined` on a trade's later rows. */
interface Slot { key: string; leg: TransactionLeg; date: string | null; joined: boolean; trade: boolean }

/** The newest transactions that fit in ROWS whole: a trade is never cut in half at the bottom. */
function slots(moves: readonly WpblRosterMove[]): Slot[] {
  const out: Slot[] = []
  for (const t of transactions(moves)) {
    if (out.length + t.legs.length > ROWS) break
    t.legs.forEach((leg, i) => out.push({
      key: `${t.key}:${i}`, leg, date: i === 0 ? t.announced_on : null, joined: i > 0, trade: t.trade,
    }))
  }
  return out
}

export function TransactionsCard({ teams, players, onOpenPlayer }: {
  teams: Map<string, WpblTeam>; players: WpblPlayer[]; onOpenPlayer: OpenPlayer
}) {
  const moves = useWpblRosterMoves()
  return <TransactionsCardView teams={teams} players={players} moves={moves} onOpenPlayer={onOpenPlayer} />
}

export function TransactionsCardView({ teams, players, moves, onOpenPlayer }: {
  teams: Map<string, WpblTeam>; players: WpblPlayer[]; moves: readonly WpblRosterMove[] | null; onOpenPlayer: OpenPlayer
}) {
  const playerLink = useWpblPlayerLink()
  const byId = new Map(players.map(p => [p.id, p]))
  const rows = moves == null ? null : slots(moves)
  return (
    // The heading opens the rosters page, as every section's heading opens more of itself.
    <SectionCard title="Transactions" titleLink={linkTo(WPBL_ROSTERS_PAGE, () => track(EVENTS.WPBL_HOME_CARD_LINK, { card: 'transactions', target: 'all' }))}>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {Array.from({ length: ROWS }, (_, i) => {
          if (rows == null) return <TransactionRow key={i} />
          const slot = rows[i]
          if (!slot) return <TransactionRow key={i} hidden={!(i === 0 && rows.length === 0)} empty={i === 0} />
          const { leg } = slot
          if (leg.kind === 'pick') {
            return <TransactionRow key={slot.key} slot={slot} team={teams.get(leg.to)} titleBadge={teams.get(leg.from)}
              title={`${ROSTER_SEASON} ${pickLabel(leg.round)}`} sub={`Traded from ${CLUB_CITIES[leg.from] ?? leg.from}`} />
          }
          const m = leg.move
          const p = m.player_id ? byId.get(m.player_id) : undefined
          const link = p ? playerLink(p, (pl: WpblPlayer) => {
            track(EVENTS.WPBL_HOME_PLAYER_OPEN, { card: 'transactions', playerId: pl.id })
            onOpenPlayer(pl)
          }) : null
          return <TransactionRow key={slot.key} slot={slot} team={teams.get(m.team_id)}
            name={p?.name ?? m.player_name ?? ''} sub={moveLabel(m)} link={link} />
        })}
      </Box>
    </SectionCard>
  )
}

/** One leg; its skeleton with no `slot`; "No moves yet" with `empty`; or with `hidden`, an invisible
 *  slot that holds the card at ROWS rows while there are fewer legs than that. Every line has a fixed
 *  height, so the skeleton and the loaded row are the same box. A player's line is `name` (fitted,
 *  and a link); a pick's is `title`. */
function TransactionRow({ slot, name, title, titleBadge, sub, team, link, hidden, empty }: {
  slot?: Slot; name?: string; title?: string; titleBadge?: WpblTeam; sub?: string; team?: WpblTeam; link?: object | null
  hidden?: boolean; empty?: boolean
}) {
  const line = { lineHeight: 1.3, height: '1.3em', minWidth: 0 } as const
  return (
    <Box component="li" aria-hidden={hidden || undefined} sx={{
      visibility: hidden ? 'hidden' : undefined,
      // A trade's later rows sit under its first with no rule between them: one announcement.
      borderTop: slot?.joined ? 0 : '1px solid', borderColor: 'divider', '&:first-of-type': { borderTop: 0 },
    }}>
      <Box {...(link ?? {})} sx={{
        ...UNSTYLED_LINK, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0,
        borderRadius: 2, px: 0.75, mx: -0.75, py: 0.625, ...(link ? { ...TAPPABLE, ...FOCUS_RING } : {}),
      }}>
        <Typography component="div" sx={{
          ...line, ...AGATE_SX, flexShrink: 0, width: '3.25rem', fontSize: TYPE_SCALE.meta, color: 'text.secondary',
        }}>
          {/* A trade's later rows carry ⇄ where the date would be, so its sides read as a pair. */}
          {slot ? (slot.date ? dayLabel(slot.date) : <Box component="span" aria-hidden sx={{ pl: '0.1rem' }}>⇄</Box>)
            : empty ? '' : <Skeleton variant="text" width="80%" />}
        </Typography>
        {team
          ? <TeamBadge team={team} size={BADGE} />
          : <Box sx={{ flexShrink: 0, width: chromePx(BADGE), height: chromePx(BADGE) }} />}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="div" sx={{ ...line, fontSize: TYPE_SCALE.body, fontWeight: 700 }}>
            {slot && name
              ? <FittedName name={name} sx={{ font: 'inherit' }} wrapperSx={{ minWidth: 0 }} />
              : slot && title
                ? <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                  {/* The club the pick came from, small, so "New York gets Boston's pick" reads at a glance. */}
                  {titleBadge && <TeamBadge team={titleBadge} size={PICK_BADGE} />}
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</Box>
                </Box>
                : empty ? 'No moves yet' : <Skeleton variant="text" width="55%" />}
          </Typography>
          <Typography noWrap component="div" sx={{ ...line, fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
            {slot ? sub : empty ? '' : <Skeleton variant="text" width="40%" />}
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}
