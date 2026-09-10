import React, { useEffect, useMemo, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, Divider,
  CircularProgress, Menu, MenuItem, Tooltip, useMediaQuery, useTheme,
} from '@mui/material'
import {
  Close, ContentCopy, PersonOffOutlined, RestartAlt, MoreHoriz, Check,
} from '@mui/icons-material'
import {
  fetchAdminUsers, setUserDeleted, setUserRole, userLeague, userIsReachable,
  SITE_ROLES,
} from './lib/adminUsers'
import type { AdminUser, SiteRole, UserLeague } from './lib/adminUsers'
import { WPBL_TEAMS } from './wpbl/constants'
import { TeamBadge } from './wpbl/ui'
import { UserDetailDialog } from './AdminUserDetail'

// ─── The Users panel ──────────────────────────────────────────────────────────
//
// WHAT THIS REPLACED, AND WHY IT HAD TO. The old roster was a maxWidth="sm" dialog with a
// 400px scroll box and five columns: name, joined, picks, accuracy, deactivate. It was built
// when the site was an MLB predictions game and it described exactly that, so on a roster of
// 150 accounts that are overwhelmingly WPBL readers, four of its five columns were blank and
// the interesting question (who actually reads this, on which section, with what turned on)
// could not be asked at all. The width was the smaller half of the problem: a desktop had
// roughly 1100 unused pixels either side of a table that was clipping its own id column.
//
// THE DATA IS THE REAL CHANGE. Everything describing a WPBL reader lives in a table RLS'd to
// own-rows-only, so the browser could not see it; it now comes from `admin_user_roster`, one
// owner-guarded security-definer RPC. See src/lib/adminUsers.ts.
//
// TWO LAYOUTS, NOT ONE RESPONSIVE TABLE. Nine columns of small numbers is right on a desktop
// and unreadable on a 375px phone, and the usual answer (let it scroll sideways) hides the
// columns that carry the answer behind a gesture nobody makes. Under `md` the same rows are
// cards. Both read the same derived values, so there is one definition of "reads WPBL" and
// one of "reachable"; they live in adminUsers.ts with tests, not here.

/** Compact relative time. "3d", "5w". A column this narrow cannot spend four characters on "ago". */
function ago(iso: string | null): string {
  if (!iso) return '—'
  const d = Date.now() - new Date(iso).getTime()
  const h = Math.floor(d / 3_600_000)
  if (h < 1) return 'now'
  if (h < 24) return `${h}h`
  const days = Math.floor(h / 24)
  if (days < 14) return `${days}d`
  if (days < 60) return `${Math.floor(days / 7)}w`
  return `${Math.floor(days / 30)}mo`
}

const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString())

// ─── Sorting ──────────────────────────────────────────────────────────────────
//
// DEFAULT IS LAST SEEN, NOT JOIN DATE, and that is a change of question. The old panel
// answered "who signed up recently", which on a roster that stopped being new months ago is
// a list of the least engaged people on the site. "Who is actually here" puts the accounts
// worth knowing about at the top and pushes the sign-up-and-vanished tail to the bottom
// where it belongs.
type SortKey = 'last_seen' | 'created_at' | 'events' | 'username' | 'push_devices' | 'predictions'
  | 'wpbl_events' | 'series_picks'

const SORTS: Record<SortKey, (u: AdminUser) => number | string> = {
  last_seen:    u => (u.last_seen ? Date.parse(u.last_seen) : 0),
  created_at:   u => Date.parse(u.created_at),
  events:       u => u.events,
  username:     u => u.username.toLowerCase(),
  push_devices: u => u.push_devices,
  predictions:  u => u.predictions ?? -1,
  wpbl_events:  u => u.wpbl_events,
  series_picks: u => u.series_picks,
}

/**
 * The sorts, named.
 *
 * THE COLUMN HEADERS ALREADY SORTED, and that was the whole problem: a header you have to
 * think to click is not a feature anybody finds, and half of these orders are not reachable
 * from one at all. "Longest away" and "Oldest account" are the same two columns as their
 * opposites with the arrow the other way, and nothing on a header says that is available.
 *
 * Each entry carries its OWN direction, because the useful end differs per column and asking
 * a reader to pick a column and then a direction is two decisions where they had one question.
 * The headers still work and stay in sync with this: both write the same (sort, desc) pair.
 */
export const SORT_CHOICES: ReadonlyArray<{ id: string; label: string; key: SortKey; desc: boolean }> = [
  { id: 'active',  label: 'Most active',       key: 'events',       desc: true  },
  { id: 'recent',  label: 'Recently seen',     key: 'last_seen',    desc: true  },
  { id: 'away',    label: 'Longest away',      key: 'last_seen',    desc: false },
  { id: 'newest',  label: 'Newest account',    key: 'created_at',   desc: true  },
  { id: 'oldest',  label: 'Oldest account',    key: 'created_at',   desc: false },
  { id: 'name',    label: 'Name A to Z',       key: 'username',     desc: false },
  { id: 'wpbl',    label: 'Most WPBL activity', key: 'wpbl_events', desc: true  },
  { id: 'alerts',  label: 'Most alerts',       key: 'push_devices', desc: true  },
  { id: 'series',  label: 'Most series calls', key: 'series_picks', desc: true  },
  { id: 'picks',   label: 'Most MLB picks',    key: 'predictions',  desc: true  },
]

/** Sorted copy. String keys always ascend; number keys follow `desc`, since "most" is the useful end. */
export function sortUsers(users: AdminUser[], key: SortKey, desc = true): AdminUser[] {
  const get = SORTS[key]
  return [...users].sort((a, b) => {
    const x = get(a), y = get(b)
    if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y))
    return desc ? y - x : x - y
  })
}

type FilterKey = 'all' | 'wpbl' | 'mlb' | 'reachable' | 'roles' | 'quiet' | 'deleted'

const FILTERS: Array<{ key: FilterKey; label: string; test: (u: AdminUser) => boolean }> = [
  { key: 'all',       label: 'Everyone',    test: () => true },
  { key: 'wpbl',      label: 'WPBL',        test: u => { const l = userLeague(u); return l === 'wpbl' || l === 'both' } },
  { key: 'mlb',       label: 'MLB',         test: u => { const l = userLeague(u); return l === 'mlb'  || l === 'both' } },
  { key: 'reachable', label: 'Reachable',   test: userIsReachable },
  { key: 'roles',     label: 'Has a role',  test: u => u.roles.length > 0 },
  // Signed up and never did anything measurable since. The cohort worth knowing the size of.
  { key: 'quiet',     label: 'Never active', test: u => u.events === 0 },
  { key: 'deleted',   label: 'Deactivated', test: u => u.is_deleted },
]

// ─── Small parts ──────────────────────────────────────────────────────────────

const LEAGUE_LABEL: Record<UserLeague, string> = {
  wpbl: 'WPBL', mlb: 'MLB', both: 'Both', none: '—',
}

/** The WPBL/MLB split as one bar. The number alone does not show a 90/10 as different from a 50/50. */
function SplitBar({ u }: { u: AdminUser }) {
  const total = u.wpbl_events + u.mlb_events
  const league = userLeague(u)
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35, minWidth: 74 }}>
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: league === 'none' ? 'text.disabled' : 'text.secondary' }}>
        {LEAGUE_LABEL[league]}
      </Typography>
      {total > 0 && (
        <Box sx={{ display: 'flex', height: 4, borderRadius: 999, overflow: 'hidden', bgcolor: 'action.hover' }}>
          <Box sx={{ width: `${(u.wpbl_events / total) * 100}%`, bgcolor: 'var(--wpbl-accent-solid, #2563eb)' }} />
          <Box sx={{ width: `${(u.mlb_events / total) * 100}%`, bgcolor: 'warning.main' }} />
        </Box>
      )}
    </Box>
  )
}

/** Events in the window, as a number plus its size relative to the busiest account on screen. */
function ActivityCell({ u, max }: { u: AdminUser; max: number }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35, minWidth: 84 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6 }}>
        <Typography sx={{
          fontSize: '0.8rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          color: u.events ? 'text.primary' : 'text.disabled',
        }}>{num(u.events)}</Typography>
        {u.active_days > 0 && (
          <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled' }}>
            {u.active_days}d
          </Typography>
        )}
      </Box>
      <Box sx={{ height: 4, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box sx={{ width: `${max ? (u.events / max) * 100 : 0}%`, height: '100%', bgcolor: 'success.main' }} />
      </Box>
    </Box>
  )
}

/**
 * What this account has switched on.
 *
 * A DEVICE COUNT ALONE IS NOT REACHABILITY. A push subscription is consent to nothing on its
 * own (the pick-reminder backfill in 20260816073902 says so in as many words), so a reader
 * with two devices and every toggle off gets nothing and must not read as reachable here.
 * The letters are the toggles; the number is the devices.
 */
function AlertCell({ u }: { u: AdminUser }) {
  const on: Array<[string, string]> = []
  if (u.notify_wpbl_all)   on.push(['A', 'Every WPBL game'])
  if (u.notify_game_start) on.push(['S', 'Game starting soon'])
  if (u.notify_picks)      on.push(['P', 'Pick reminders'])
  if (u.game_reminders)    on.push([String(u.game_reminders), `${u.game_reminders} single-game reminders`])

  if (!u.push_devices && !on.length) return <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled' }}>—</Typography>

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
      {u.push_devices > 0 && (
        <Tooltip title={`${u.push_devices} subscribed ${u.push_devices === 1 ? 'device' : 'devices'}`}>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: 'text.secondary' }}>
            {u.push_devices}×
          </Typography>
        </Tooltip>
      )}
      {on.map(([ch, title]) => (
        <Tooltip key={title} title={title}>
          <Box sx={{
            width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: 'action.selected',
          }}>
            <Typography sx={{ fontSize: '0.55rem', fontWeight: 900, lineHeight: 1 }}>{ch}</Typography>
          </Box>
        </Tooltip>
      ))}
    </Box>
  )
}

const ROLE_STYLE: Record<SiteRole, { label: string; bg: string }> = {
  collaborator: { label: 'Collaborator', bg: 'var(--wpbl-accent-solid, #2563eb)' },
  moderator:    { label: 'Moderator',    bg: '#7c3aed' },
}

function RolePills({ roles }: { roles: AdminUser['roles'] }) {
  if (!roles.length) return null
  return (
    <>
      {roles.map(r => (
        <Tooltip key={r.role} title={r.note ?? ''} disableHoverListener={!r.note}>
          <Box sx={{ px: 0.65, py: 0.1, borderRadius: 999, bgcolor: ROLE_STYLE[r.role].bg, flexShrink: 0 }}>
            <Typography sx={{ fontSize: '0.5rem', fontWeight: 900, color: '#fff', letterSpacing: 0.4, textTransform: 'uppercase' }}>
              {ROLE_STYLE[r.role].label}
            </Typography>
          </Box>
        </Tooltip>
      ))}
    </>
  )
}

/** Name, role pills, the address it signs in with, and the id. */
function Identity({ u, dense }: { u: AdminUser; dense?: boolean }) {
  // Stops the row's own click: copying an id must not also open the sheet over the table.
  const copyId = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard?.writeText(u.user_id).catch(() => {})
  }
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, flexWrap: 'wrap' }}>
        <Typography sx={{
          fontSize: dense ? '0.9rem' : '0.85rem', fontWeight: 800, wordBreak: 'break-word',
          textDecoration: u.is_deleted ? 'line-through' : 'none',
        }}>{u.username}</Typography>
        <RolePills roles={u.roles} />
        {u.is_deleted && (
          <Box sx={{ px: 0.6, py: 0.1, borderRadius: 999, bgcolor: 'error.main', flexShrink: 0 }}>
            <Typography sx={{ fontSize: '0.5rem', fontWeight: 900, color: '#fff', letterSpacing: 0.5 }}>
              DEACTIVATED
            </Typography>
          </Box>
        )}
      </Box>
      {/* The address, and how they get in. `provider` is the difference between "send them a
          reset link" and "they have no password to reset". */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.15, minWidth: 0 }}>
        <Typography sx={{
          fontSize: '0.65rem', color: 'text.secondary',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{u.email ?? '—'}</Typography>
        {u.provider !== 'email' && (
          <Typography sx={{ fontSize: '0.55rem', fontWeight: 800, color: 'text.disabled', textTransform: 'uppercase', flexShrink: 0 }}>
            {u.provider}
          </Typography>
        )}
        {!u.confirmed && (
          <Typography sx={{ fontSize: '0.55rem', fontWeight: 800, color: 'warning.main', flexShrink: 0 }}>
            UNCONFIRMED
          </Typography>
        )}
        <IconButton size="small" aria-label={`Copy id for ${u.username}`} onClick={copyId}
          sx={{ p: 0.1, color: 'text.disabled', flexShrink: 0 }}>
          <ContentCopy sx={{ fontSize: '0.6rem' }} />
        </IconButton>
      </Box>
    </Box>
  )
}

/**
 * The club they picked, if they picked one.
 *
 * EMPTY FOR EVERY ACCOUNT TODAY, AND THAT IS NOT A BUG IN THE QUERY. `wpbl_favorite_team_id`
 * is reserved: the favourite-team picker that would write it is parked on the
 * `wpbl-favorite-team` branch (see the column's own migration, and "Parked, with reasons" in
 * ROADMAP-WPBL.md). The column stays because it costs 64px and lights up the day that ships,
 * but it is not evidence that nobody has a club: nobody has been asked. Do not go looking for
 * the join that lost it.
 *
 * Not FK'd either, so a stale id draws nothing rather than blocking a preferences write.
 */
function ClubCell({ id }: { id: string | null }) {
  const meta = id ? WPBL_TEAMS[id] : undefined
  if (!meta) return <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled' }}>—</Typography>
  return <TeamBadge team={meta} size={22} />
}

// ─── Row actions ──────────────────────────────────────────────────────────────

/**
 * Grant a role, revoke it, deactivate, restore.
 *
 * ONE MENU RATHER THAN A ROW OF BUTTONS. Deactivate needed a confirm step, which the old
 * panel spent inline: pressing the icon replaced the cell with "Deactivate? / Cancel", so on
 * a 150-row table the destructive control sat one misclick away in every single row. Putting
 * it behind a menu is the confirm step, and it frees the width for a second action rather
 * than needing a second column.
 */
function RowMenu({ u, busy, onToggleDeleted, onToggleRole }: {
  u: AdminUser
  busy: boolean
  onToggleDeleted: () => void
  onToggleRole: (role: SiteRole, granted: boolean) => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const close = () => setAnchor(null)
  const has = (r: SiteRole) => u.roles.some(x => x.role === r)

  return (
    <>
      <IconButton size="small" disabled={busy} aria-label={`Actions for ${u.username}`}
        onClick={e => { e.stopPropagation(); setAnchor(e.currentTarget) }} sx={{ color: 'text.disabled' }}>
        {busy ? <CircularProgress size={14} /> : <MoreHoriz sx={{ fontSize: '1.05rem' }} />}
      </IconButton>
      {/* Portalled into the body, but React events bubble through the COMPONENT tree, not the
          DOM one, so without this a menu click still reaches the row's handler underneath. */}
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}
        onClick={e => e.stopPropagation()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Typography sx={{ px: 2, pt: 0.5, pb: 0.75, fontSize: '0.6rem', fontWeight: 800, letterSpacing: 0.6, color: 'text.disabled', textTransform: 'uppercase' }}>
          Roles
        </Typography>
        {SITE_ROLES.map(role => (
          <MenuItem key={role} onClick={() => { onToggleRole(role, !has(role)); close() }}
            sx={{ fontSize: '0.82rem', gap: 1.25, minHeight: 36 }}>
            <Box sx={{ width: 16, display: 'flex', justifyContent: 'center' }}>
              {has(role) && <Check sx={{ fontSize: '0.9rem' }} />}
            </Box>
            {ROLE_STYLE[role].label}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => { onToggleDeleted(); close() }}
          sx={{ fontSize: '0.82rem', gap: 1.25, minHeight: 36, color: u.is_deleted ? 'text.primary' : 'error.main' }}>
          <Box sx={{ width: 16, display: 'flex', justifyContent: 'center' }}>
            {u.is_deleted
              ? <RestartAlt sx={{ fontSize: '0.95rem' }} />
              : <PersonOffOutlined sx={{ fontSize: '0.95rem' }} />}
          </Box>
          {u.is_deleted ? 'Restore account' : 'Deactivate account'}
        </MenuItem>
      </Menu>
    </>
  )
}

// ─── Desktop table ────────────────────────────────────────────────────────────

const cellSx = { px: 1.25, py: 0.85, borderTop: '1px solid', borderColor: 'divider', verticalAlign: 'middle' } as const
const headSx = {
  px: 1.25, py: 0.85, fontSize: '0.58rem', fontWeight: 800, letterSpacing: 0.6,
  textTransform: 'uppercase' as const, color: 'text.disabled', textAlign: 'left' as const,
  whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 1,
  bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', userSelect: 'none' as const,
} as const

function SortHead({ label, sortKey, active, desc, onSort, align = 'left', width }: {
  label: string; sortKey?: SortKey; active: SortKey; desc: boolean
  onSort: (k: SortKey) => void; align?: 'left' | 'center' | 'right'; width?: number
}) {
  const is = sortKey === active
  return (
    <Box component="th" scope="col" onClick={sortKey ? () => onSort(sortKey) : undefined}
      sx={{
        ...headSx, textAlign: align, width,
        cursor: sortKey ? 'pointer' : 'default',
        color: is ? 'text.primary' : 'text.disabled',
        '&:hover': sortKey ? { color: 'text.secondary' } : undefined,
      }}>
      {label}{is ? (desc ? ' ↓' : ' ↑') : ''}
    </Box>
  )
}

function UserRow({ u, max, busy, onOpen, onToggleDeleted, onToggleRole }: {
  u: AdminUser; max: number; busy: boolean
  onOpen: () => void
  onToggleDeleted: () => void
  onToggleRole: (role: SiteRole, granted: boolean) => void
}) {
  return (
    /* THE WHOLE ROW OPENS THE PERSON, and the handler is on the <tr> rather than on a wrapping
       link because a table row cannot contain one. The controls inside it (copy id, the row
       menu) stop propagation themselves; without that, copying an id would also open a sheet
       over the table you were copying from. */
    <Box component="tr" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onOpen() } }}
      sx={{
        opacity: u.is_deleted ? 0.5 : 1, cursor: 'pointer',
        '&:hover': { bgcolor: 'action.hover' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
      }}>
      <Box component="td" sx={{ ...cellSx, maxWidth: 260 }}><Identity u={u} /></Box>
      <Box component="td" sx={{ ...cellSx, fontSize: '0.72rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>{ago(u.created_at)}</Box>
      <Box component="td" sx={{ ...cellSx, fontSize: '0.72rem', whiteSpace: 'nowrap', color: u.last_seen ? 'text.secondary' : 'text.disabled' }}>{ago(u.last_seen)}</Box>
      <Box component="td" sx={cellSx}><ActivityCell u={u} max={max} /></Box>
      <Box component="td" sx={cellSx}><SplitBar u={u} /></Box>
      <Box component="td" sx={{ ...cellSx, textAlign: 'center' }}>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}><ClubCell id={u.favorite_team} /></Box>
      </Box>
      <Box component="td" sx={cellSx}><AlertCell u={u} /></Box>
      <Box component="td" sx={{ ...cellSx, textAlign: 'center', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: u.series_picks ? 'text.primary' : 'text.disabled' }}>
          {u.series_picks || '—'}
        </Typography>
      </Box>
      <Box component="td" sx={{ ...cellSx, textAlign: 'center', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        <Typography sx={{ fontSize: '0.78rem', color: u.predictions ? 'text.primary' : 'text.disabled' }}>
          {u.predictions ? `${u.correct}/${u.predictions}` : '—'}
        </Typography>
        {!!u.predictions && (
          <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>{Math.round(Number(u.accuracy))}%</Typography>
        )}
      </Box>
      <Box component="td" sx={{ ...cellSx, textAlign: 'right' }}>
        <RowMenu u={u} busy={busy} onToggleDeleted={onToggleDeleted} onToggleRole={onToggleRole} />
      </Box>
    </Box>
  )
}

// ─── Phone card ───────────────────────────────────────────────────────────────

function UserCard({ u, max, busy, onOpen, onToggleDeleted, onToggleRole }: {
  u: AdminUser; max: number; busy: boolean
  onOpen: () => void
  onToggleDeleted: () => void
  onToggleRole: (role: SiteRole, granted: boolean) => void
}) {
  return (
    <Box onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onOpen() } }}
      sx={{
        display: 'flex', alignItems: 'flex-start', gap: 1, px: 1.5, py: 1.1, cursor: 'pointer',
        borderTop: '1px solid', borderColor: 'divider', opacity: u.is_deleted ? 0.5 : 1,
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
      }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Identity u={u} dense />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 0.6, flexWrap: 'wrap' }}>
          <ActivityCell u={u} max={max} />
          <SplitBar u={u} />
          {/* The table's placeholder dashes exist to hold a column open. A card has no
              columns, so an empty one is drawn as nothing rather than as two stray dashes. */}
          {(u.push_devices > 0 || u.game_reminders > 0) && <AlertCell u={u} />}
          {u.favorite_team && <ClubCell id={u.favorite_team} />}
        </Box>
        <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', mt: 0.5 }}>
          Joined {ago(u.created_at)} ago · last seen {ago(u.last_seen)}
          {u.series_picks ? ` · ${u.series_picks} series picks` : ''}
          {u.predictions ? ` · ${u.correct}/${u.predictions} picks` : ''}
        </Typography>
      </Box>
      <RowMenu u={u} busy={busy} onToggleDeleted={onToggleDeleted} onToggleRole={onToggleRole} />
    </Box>
  )
}

// ─── Chrome ───────────────────────────────────────────────────────────────────

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Box sx={{
      // ONE SCROLLING ROW ON A PHONE. Five tiles wrapping two-per-line pushed the first
      // actual user 850px down a 812px screen, so the panel opened on a summary of a list
      // nobody could see. They stay a wrapping grid on a desktop, where there is room.
      flex: { xs: '0 0 auto', md: '1 1 120px' }, minWidth: { xs: 96, md: 110 },
      px: { xs: 1.25, md: 1.5 }, py: 1,
      border: '1px solid', borderColor: 'divider', borderRadius: 2,
    }}>
      <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.disabled' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '1.15rem', fontWeight: 900, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      {sub && <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>{sub}</Typography>}
    </Box>
  )
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <Box onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      sx={{
        px: 1.1, py: 0.4, borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
        border: '1px solid', borderColor: on ? 'transparent' : 'divider',
        bgcolor: on ? 'text.primary' : 'transparent',
      }}>
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, color: on ? 'background.paper' : 'text.secondary' }}>
        {label}
      </Typography>
    </Box>
  )
}

// The activity window. Identity, preferences and push are lifetime facts and ignore this,
// which is why only the two activity columns carry the window in their heading.
const WINDOWS = [7, 30, 90] as const

/**
 * The roster, or a spoofed one.
 *
 * `localStorage.sdDevFakeUsers = '150'` in a dev build fills the panel with generated people
 * so the layout can be worked on at full size without the real roster's names, addresses and
 * notification settings on screen. Gated on `import.meta.env.DEV` as well as the flag, so a
 * production build cannot reach it however the flag is set; the dynamic import keeps the
 * generator out of the main chunk either way.
 */
function fakeRosterSize(): number {
  if (!import.meta.env.DEV) return 0
  try { return Number(localStorage.getItem('sdDevFakeUsers') ?? 0) } catch { return 0 }
}

async function loadRoster(days: number): Promise<AdminUser[]> {
  // THE `import.meta.env.DEV` TEST IS HERE RATHER THAN ONLY INSIDE fakeRosterSize(), because
  // it is what removes the generator from the production build. Vite substitutes the literal
  // `false` at build time, so this branch and the dynamic import inside it are provably dead
  // and Rollup drops the chunk. Behind a function call it cannot prove that, and a chunk full
  // of invented people ships (never reachable, but shipped) beside the real panel.
  if (import.meta.env.DEV) {
    const n = fakeRosterSize()
    if (n > 0) return (await import('./dev/fakeUsers')).makeFakeUsers(n)
  }
  return fetchAdminUsers(days)
}

/**
 * A write, unless the roster is spoofed, in which case it succeeds having done nothing.
 *
 * Without this the two actions are dead in dev mode: the optimistic update is applied only on
 * a true return, and the real RPC refuses a fake uuid, so a menu that appears to work does
 * nothing and the layout of the granted/deactivated states can never be looked at.
 */
const commit = (write: () => Promise<boolean>): Promise<boolean> =>
  (fakeRosterSize() > 0 ? Promise.resolve(true) : write())

export function UsersPanel({ open, onClose, onChanged }: {
  open: boolean
  onClose: () => void
  onChanged?: () => void
}) {
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))

  const [users, setUsers]     = useState<AdminUser[] | null>(null)
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [query, setQuery]     = useState('')
  const [filter, setFilter]   = useState<FilterKey>('all')
  const [sort, setSort]       = useState<SortKey>('last_seen')
  const [desc, setDesc]       = useState(true)
  const [days, setDays]       = useState<number>(30)
  const [opened, setOpened]   = useState<AdminUser | null>(null)

  useEffect(() => {
    if (!open) return
    setUsers(null)
    let alive = true
    loadRoster(days)
      .then(r => { if (alive) setUsers(r) })
      .catch(() => { if (alive) setUsers([]) })
    return () => { alive = false }
  }, [open, days])

  // Reset the view, but not on a window change: re-reading 90 days should not throw away the
  // search that is the only reason you are looking at 90 days.
  useEffect(() => {
    if (open) { setQuery(''); setFilter('all'); setSort('last_seen'); setDesc(true); setOpened(null) }
  }, [open])

  const toggleDeleted = async (u: AdminUser) => {
    const next = !u.is_deleted
    setBusyId(u.user_id)
    if (await commit(() => setUserDeleted(u.user_id, next))) {
      setUsers(prev => prev?.map(x => x.user_id === u.user_id
        ? { ...x, is_deleted: next, deleted_at: next ? new Date().toISOString() : null } : x) ?? null)
      onChanged?.()
    }
    setBusyId(null)
  }

  const toggleRole = async (u: AdminUser, role: SiteRole, granted: boolean) => {
    setBusyId(u.user_id)
    if (await commit(() => setUserRole(u.user_id, role, granted))) {
      setUsers(prev => prev?.map(x => x.user_id === u.user_id
        ? { ...x, roles: granted
          ? [...x.roles, { role, note: null }]
          : x.roles.filter(r => r.role !== role) }
        : x) ?? null)
    }
    setBusyId(null)
  }

  const all = users ?? []
  const q = query.trim().toLowerCase()
  const visible = useMemo(() => {
    const test = FILTERS.find(f => f.key === filter)?.test ?? (() => true)
    const rows = all
      // Deactivated accounts are out of every view except their own filter. They are a
      // handful of rows that would otherwise sit greyed out in the middle of every sort.
      .filter(u => (filter === 'deleted' ? u.is_deleted : !u.is_deleted))
      .filter(test)
      .filter(u => !q
        || u.username.toLowerCase().includes(q)
        || (u.email ?? '').toLowerCase().includes(q)
        || u.user_id.toLowerCase().includes(q))
    return sortUsers(rows, sort, desc)
  }, [all, filter, q, sort, desc])

  // The bar scale is the busiest account ON SCREEN, not in the roster: filtered to the seven
  // people who use this every day, a shared scale would draw seven near-identical full bars.
  const max = useMemo(() => visible.reduce((m, u) => Math.max(m, u.events), 0), [visible])

  const live = all.filter(u => !u.is_deleted)
  const summary = {
    total:     live.length,
    active:    live.filter(u => u.events > 0).length,
    wpbl:      live.filter(u => { const l = userLeague(u); return l === 'wpbl' || l === 'both' }).length,
    reachable: live.filter(userIsReachable).length,
    dormant:   live.filter(u => u.events === 0).length,
  }

  const onSort = (k: SortKey) => {
    if (k === sort) setDesc(d => !d)
    else { setSort(k); setDesc(k !== 'username') }
  }

  return (
    <Dialog
      open={open} onClose={onClose}
      fullScreen={!wide}
      maxWidth={false}
      PaperProps={{ sx: wide
        ? { borderRadius: 3, width: 'min(1400px, 96vw)', height: 'min(900px, 92vh)', maxWidth: 'none' }
        : { borderRadius: 0 } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Typography sx={{ fontSize: '1.05rem', fontWeight: 900 }}>👥 Users</Typography>
          {users && (
            <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>
              {visible.length === summary.total ? `${summary.total}` : `${visible.length} of ${summary.total}`}
            </Typography>
          )}
        </Box>
        <IconButton size="small" aria-label="Close" onClick={onClose} sx={{ color: 'text.secondary' }}>
          <Close sx={{ fontSize: '1.15rem' }} />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
        {users === null ? (
          <Box sx={{ textAlign: 'center', py: 8 }}><CircularProgress size={26} /></Box>
        ) : all.length === 0 ? (
          <Box sx={{ px: 2, py: 5, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled' }}>
              No roster. Either nobody has signed up, or `admin_user_roster` has not been migrated yet.
            </Typography>
          </Box>
        ) : (
          <>
            {/* Summary. Five counts that answer "what is this roster" before any row is read. */}
            <Box sx={{
              display: 'flex', gap: 1, px: 2, pt: 1.5, pb: 1.25,
              flexWrap: { xs: 'nowrap', md: 'wrap' },
              overflowX: { xs: 'auto', md: 'visible' },
              '&::-webkit-scrollbar': { height: 4 },
            }}>
              <Tile label="Accounts" value={String(summary.total)} sub={`${all.length - summary.total} deactivated`} />
              <Tile label={`Active ${days}d`} value={String(summary.active)}
                sub={summary.total ? `${Math.round((summary.active / summary.total) * 100)}% of accounts` : undefined} />
              <Tile label="Read WPBL" value={String(summary.wpbl)} sub={`${live.filter(u => userLeague(u) === 'mlb').length} MLB only`} />
              <Tile label="Reachable" value={String(summary.reachable)} sub="push on, with a toggle set" />
              {/* NOT "picked a club", which reads 0 on every roster until the parked
                  favourite-team picker ships. A headline tile that can only say zero teaches
                  you to stop reading the row. The dormant cohort is the number actually worth
                  a tile: it is the one that says how much of the roster is nominal. */}
              <Tile label="Never active" value={String(summary.dormant)}
                sub={`of ${summary.total} accounts`} />
            </Box>

            {/* Search, window, filters. */}
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 1, px: 2, pb: 1.25,
              flexWrap: 'wrap',
            }}>
              <Box
                component="input"
                placeholder="Search name, email or id…"
                value={query}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                sx={{
                  flex: '1 1 220px', minWidth: 180, boxSizing: 'border-box', px: 1.25, py: 0.8,
                  fontSize: '0.82rem', color: 'text.primary', font: 'inherit',
                  bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider',
                  borderRadius: 1.5, outline: 'none', '&:focus': { borderColor: 'primary.main' },
                }}
              />
              {/* Native select rather than MUI's: it is one control, it needs no styling to be
                  usable, and on a phone it opens the platform's own picker instead of a menu
                  that has to fit on screen. Its value is DERIVED from (sort, desc), so
                  clicking a column header moves this too and the two can never disagree. */}
              <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: 'text.disabled' }}>
                  Sort
                </Typography>
                <Box
                  component="select"
                  value={SORT_CHOICES.find(c => c.key === sort && c.desc === desc)?.id ?? ''}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                    const c = SORT_CHOICES.find(x => x.id === e.target.value)
                    if (c) { setSort(c.key); setDesc(c.desc) }
                  }}
                  sx={{
                    px: 1, py: 0.7, fontSize: '0.78rem', font: 'inherit', fontWeight: 600,
                    color: 'text.primary', bgcolor: 'action.hover',
                    border: '1px solid', borderColor: 'divider', borderRadius: 1.5,
                    outline: 'none', cursor: 'pointer',
                    '&:focus': { borderColor: 'primary.main' },
                  }}
                >
                  {/* A header click can land on a (column, direction) pair no named choice
                      covers. Rather than silently showing the wrong label, the select says so. */}
                  {!SORT_CHOICES.some(c => c.key === sort && c.desc === desc) && (
                    <option value="">Custom</option>
                  )}
                  {SORT_CHOICES.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {WINDOWS.map(d => (
                  <Chip key={d} label={`${d}d`} on={days === d} onClick={() => setDays(d)} />
                ))}
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 0.5, px: 2, pb: 1.25, flexWrap: 'wrap' }}>
              {FILTERS.map(f => (
                <Chip key={f.key} label={f.label} on={filter === f.key} onClick={() => setFilter(f.key)} />
              ))}
            </Box>

            <Divider />

            {visible.length === 0 ? (
              <Box sx={{ px: 2, py: 5, textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled' }}>No matches.</Typography>
              </Box>
            ) : (
              <Box sx={{ flex: 1, overflow: 'auto' }}>
                {wide ? (
                  <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
                    <Box component="thead">
                      <Box component="tr">
                        <SortHead label="User"      sortKey="username"     active={sort} desc={desc} onSort={onSort} />
                        <SortHead label="Joined"    sortKey="created_at"   active={sort} desc={desc} onSort={onSort} />
                        <SortHead label="Last seen" sortKey="last_seen"    active={sort} desc={desc} onSort={onSort} />
                        <SortHead label={`Activity ${days}d`} sortKey="events" active={sort} desc={desc} onSort={onSort} />
                        <SortHead label={`Reads ${days}d`} sortKey="wpbl_events" active={sort} desc={desc} onSort={onSort} />
                        <SortHead label="Club"      active={sort} desc={desc} onSort={onSort} align="center" width={64} />
                        <SortHead label="Alerts"    sortKey="push_devices" active={sort} desc={desc} onSort={onSort} />
                        <SortHead label="Series"    sortKey="series_picks" active={sort} desc={desc} onSort={onSort} align="center" width={70} />
                        <SortHead label="MLB picks" sortKey="predictions"  active={sort} desc={desc} onSort={onSort} align="center" width={90} />
                        <SortHead label=""          active={sort} desc={desc} onSort={onSort} align="right" width={56} />
                      </Box>
                    </Box>
                    <Box component="tbody">
                      {visible.map(u => (
                        <UserRow key={u.user_id} u={u} max={max} busy={busyId === u.user_id}
                          onOpen={() => setOpened(u)}
                          onToggleDeleted={() => toggleDeleted(u)}
                          onToggleRole={(r, g) => toggleRole(u, r, g)} />
                      ))}
                    </Box>
                  </Box>
                ) : (
                  visible.map(u => (
                    <UserCard key={u.user_id} u={u} max={max} busy={busyId === u.user_id}
                      onOpen={() => setOpened(u)}
                      onToggleDeleted={() => toggleDeleted(u)}
                      onToggleRole={(r, g) => toggleRole(u, r, g)} />
                  ))
                )}
              </Box>
            )}

            {/* What the columns do NOT say. Both are counting rules a reader would otherwise
                get wrong, and both have bitten a reader of the analytics page already. */}
            <Box sx={{ px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
              <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', lineHeight: 1.5 }}>
                Activity and Reads cover the last {days} days. Everything else is lifetime.
                {wide && ' Events begin Aug 5, 2026, and an event only counts from the day it was '
                  + 'instrumented, so a quiet account may simply predate the thing that measures it.'}
              </Typography>
            </Box>
          </>
        )}
      </DialogContent>

      {/* Re-read from the live list rather than held as a snapshot, so a role granted from the
          row menu while the sheet is open shows in the sheet's own header. */}
      <UserDetailDialog
        user={opened ? (all.find(u => u.user_id === opened.user_id) ?? opened) : null}
        days={days}
        onClose={() => setOpened(null)}
      />
    </Dialog>
  )
}
