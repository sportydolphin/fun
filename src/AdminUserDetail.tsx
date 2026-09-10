import { useEffect, useMemo, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, Divider,
  CircularProgress, useMediaQuery, useTheme,
} from '@mui/material'
import { Close } from '@mui/icons-material'
import { fetchAdminUserDetail, userLeague } from './lib/adminUsers'
import type { AdminUser, AdminUserDetail } from './lib/adminUsers'
import { prettyEvent, shortDate } from './lib/analyticsAdmin'
import { WPBL_TEAMS } from './wpbl/constants'
import { TeamBadge, PlayerPortrait } from './wpbl/ui'

// ─── One person ───────────────────────────────────────────────────────────────
//
// WHAT THE ROSTER CANNOT SAY. A table row is a set of totals, and totals are the right answer
// to "who are these 150 people" and no answer at all to the question that always comes next,
// which is about one of them: what do they actually do here, and is it the thing I built. This
// is that drill-down, off a click on any row.
//
// A STACKED DIALOG RATHER THAN A SPLIT PANE. The roster's nine columns need the full 1400px,
// so a master-detail split would have to drop half of them to make room and the reader would
// lose the table they were reading to see one row of it. Stacking keeps the list underneath,
// exactly where it was, and Escape puts them back on it. It is also the pattern the panel
// already uses: modals here are drill-downs opened FROM a surface, never a second surface.
//
// EVERY SECTION HIDES ITSELF WHEN IT IS EMPTY, which is unusual on an admin screen and is the
// point. Most accounts have never sent feedback, never made a pick and never searched for
// something that was not there, so a fixed layout would be six "None" panels around the one
// section with anything in it, on nearly every user. What is left when they collapse IS the
// answer to what this person does.

/** "Sep 3" plus the year when it is not this one, for dates that can be a season old. */
function longDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 14 ? `${d}d ago` : d < 60 ? `${Math.floor(d / 7)}w ago` : `${Math.floor(d / 30)}mo ago`
}

/**
 * A pick'em category id back into something readable: "pickem:2026:semifinal:A" is
 * "Semifinal A".
 *
 * DISPLAY ONLY, and it must stay that way. The ids in wpbl_award_votes are PERMANENT (renaming
 * one orphans every answer stored under it), so this reads them and never writes them, and an
 * id it does not recognise falls back to printing itself rather than to an empty cell.
 */
export function prettyPick(category: string): string {
  const parts = category.split(':')            // pickem:2026:semifinal:A
  const round = parts[2] ?? category
  const leg   = parts[3] ? ` ${parts[3]}` : ''
  return round.charAt(0).toUpperCase() + round.slice(1) + leg
}

// ─── Parts ────────────────────────────────────────────────────────────────────

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Box sx={{
      flex: { xs: '0 0 auto', sm: '1 1 110px' }, minWidth: 100,
      px: 1.5, py: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2,
    }}>
      <Typography sx={{ fontSize: '0.56rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.disabled' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '1.1rem', fontWeight: 900, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      {sub && <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled' }}>{sub}</Typography>}
    </Box>
  )
}

/**
 * Daily activity as bars.
 *
 * Hand-rolled inline SVG, because there is no chart library in package.json and this does not
 * justify adding one: AdminPage's charts set that precedent and this is the smaller case.
 *
 * A DAY WITH NO EVENTS DRAWS NOTHING, not a one-pixel stub. The gap IS the information on this
 * chart (most accounts here are two busy days and a month of silence), and a floor would turn
 * a dead fortnight into a low hum.
 */
function ActivityChart({ series }: { series: AdminUserDetail['series'] }) {
  const max = Math.max(1, ...series.map(d => d.events))
  const W = 640, H = 64, gap = 1
  const bw = series.length ? (W - gap * (series.length - 1)) / series.length : 0
  const busiest = series.reduce((a, b) => (b.events > a.events ? b : a), series[0])

  return (
    <Box>
      <Box component="svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        role="img" aria-label={`Daily activity over ${series.length} days`}
        sx={{ width: '100%', height: 64, display: 'block' }}>
        {series.map((d, i) => {
          if (!d.events) return null
          const h = Math.max(2, (d.events / max) * H)
          return <rect key={d.date} x={i * (bw + gap)} y={H - h} width={bw} height={h}
            fill="currentColor" opacity={0.85} rx={0.5} />
        })}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.4 }}>
        <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled' }}>
          {series.length ? shortDate(series[0].date) : ''}
        </Typography>
        {busiest?.events > 0 && (
          <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled' }}>
            busiest {shortDate(busiest.date)}: {busiest.events}
          </Typography>
        )}
        <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled' }}>
          {series.length ? shortDate(series[series.length - 1].date) : ''}
        </Typography>
      </Box>
    </Box>
  )
}

/** A titled block. Renders nothing at all when it has nothing, which is most of them, most of the time. */
function Panel({ title, note, children, when = true }: {
  title: string; note?: string; when?: boolean; children: React.ReactNode
}) {
  if (!when) return null
  return (
    <Box sx={{ flex: '1 1 280px', minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.disabled', mb: 0.6 }}>
        {title}
      </Typography>
      {note && (
        <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', mb: 0.6, lineHeight: 1.45 }}>
          {note}
        </Typography>
      )}
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
        {children}
      </Box>
    </Box>
  )
}

/** One counted row with a share bar behind the count. */
function CountRow({ label, n, max, sub, icon, first }: {
  label: string; n: number; max: number; sub?: string; icon?: React.ReactNode; first?: boolean
}) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.7,
      borderTop: first ? 'none' : '1px solid', borderColor: 'divider',
    }}>
      {icon}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.76rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </Typography>
        {sub && <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled' }}>{sub}</Typography>}
      </Box>
      <Box sx={{ width: 46, height: 4, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden', flexShrink: 0 }}>
        <Box sx={{ width: `${max ? (n / max) * 100 : 0}%`, height: '100%', bgcolor: 'text.disabled' }} />
      </Box>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 26, textAlign: 'right', flexShrink: 0 }}>
        {n.toLocaleString()}
      </Typography>
    </Box>
  )
}

// ─── The sheet ────────────────────────────────────────────────────────────────

/**
 * The detail, or a spoofed one derived from the spoofed roster row.
 *
 * Same double gate as the roster's own: `import.meta.env.DEV` AT THE IMPORT SITE, so Vite
 * substitutes `false` and Rollup drops the generator's chunk from a production build entirely,
 * plus the localStorage flag the panel already reads.
 */
async function loadDetail(user: AdminUser, days: number): Promise<AdminUserDetail> {
  if (import.meta.env.DEV) {
    let n = 0
    try { n = Number(localStorage.getItem('sdDevFakeUsers') ?? 0) } catch { /* private mode */ }
    if (n > 0) return (await import('./dev/fakeUsers')).makeFakeDetail(user, days)
  }
  return fetchAdminUserDetail(user.user_id, days)
}

export function UserDetailDialog({ user, days, onClose }: {
  /** Null closes it. The roster row is passed whole, so the header needs no second fetch. */
  user: AdminUser | null
  days: number
  onClose: () => void
}) {
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('sm'))
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)

  useEffect(() => {
    if (!user) { setDetail(null); return }
    setDetail(null)
    let alive = true
    loadDetail(user, days)
      .then(d => { if (alive) setDetail(d) })
      .catch(() => { if (alive) setDetail(null) })
    return () => { alive = false }
  }, [user, days])

  const maxAction = useMemo(() => Math.max(1, ...(detail?.actions ?? []).map(a => a.n)), [detail])
  const maxView   = useMemo(() => Math.max(1, ...(detail?.views   ?? []).map(v => v.n)), [detail])
  const maxPath   = useMemo(() => Math.max(1, ...(detail?.paths   ?? []).map(p => p.n)), [detail])
  const maxPlayer = useMemo(() => Math.max(1, ...(detail?.players ?? []).map(p => p.n)), [detail])
  const maxTeam   = useMemo(() => Math.max(1, ...(detail?.teams   ?? []).map(t => t.n)), [detail])

  if (!user) return null

  const club = user.favorite_team ? WPBL_TEAMS[user.favorite_team] : undefined
  const league = userLeague(user)

  return (
    <Dialog open onClose={onClose} fullScreen={!wide} maxWidth={false}
      PaperProps={{ sx: wide
        ? { borderRadius: 3, width: 'min(980px, 94vw)', height: 'min(860px, 90vh)', maxWidth: 'none' }
        : { borderRadius: 0 } }}>

      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, pb: 1.25 }}>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.05rem', fontWeight: 900 }}>{user.username}</Typography>
            {user.roles.map(r => (
              <Box key={r.role} sx={{ px: 0.7, py: 0.15, borderRadius: 999, bgcolor: 'var(--wpbl-accent-solid, #2563eb)' }}>
                <Typography sx={{ fontSize: '0.5rem', fontWeight: 900, color: '#fff', letterSpacing: 0.4, textTransform: 'uppercase' }}>
                  {r.role}
                </Typography>
              </Box>
            ))}
            {club && <TeamBadge team={club} size={20} />}
          </Box>
          <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary', mt: 0.2 }}>
            {user.email ?? '—'} · {user.provider} · joined {longDate(user.created_at)}
          </Typography>
        </Box>
        <IconButton size="small" aria-label="Close" onClick={onClose} sx={{ color: 'text.secondary', flexShrink: 0 }}>
          <Close sx={{ fontSize: '1.15rem' }} />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ p: 0 }}>
        {!detail ? (
          <Box sx={{ textAlign: 'center', py: 8 }}><CircularProgress size={24} /></Box>
        ) : (
          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>

            {/* Tiles. The window is on the first two and nowhere else, because everything after
                it is lifetime and mixing them silently is how a long-standing reader reads new. */}
            <Box sx={{
              display: 'flex', gap: 1,
              flexWrap: { xs: 'nowrap', sm: 'wrap' }, overflowX: { xs: 'auto', sm: 'visible' },
            }}>
              <Tile label={`Events ${days}d`} value={detail.events_window.toLocaleString()}
                sub={`${detail.active_days} active ${detail.active_days === 1 ? 'day' : 'days'}`} />
              <Tile label="Browsers" value={String(detail.browsers)} sub="in the window" />
              <Tile label="Lifetime" value={detail.lifetime_events.toLocaleString()} sub="events, all time" />
              <Tile label="First seen" value={longDate(detail.first_seen)} sub={ago(detail.first_seen)} />
              <Tile label="Last seen" value={longDate(detail.last_seen)} sub={ago(detail.last_seen)} />
              <Tile label="Reads" value={league === 'none' ? '—' : league.toUpperCase()}
                sub={`${user.wpbl_events} WPBL · ${user.mlb_events} MLB`} />
            </Box>

            {detail.events_window > 0 && (
              <Box sx={{ color: 'success.main' }}>
                <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.disabled', mb: 0.5 }}>
                  Activity, last {days} days
                </Typography>
                <ActivityChart series={detail.series} />
              </Box>
            )}

            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Panel title="What they do" when={detail.actions.length > 0}>
                {detail.actions.map((a, i) => (
                  <CountRow key={a.event} first={i === 0} label={prettyEvent(a.event)} n={a.n}
                    max={maxAction} sub={`last ${ago(a.last)}`} />
                ))}
              </Panel>

              <Panel title="Where they go" when={detail.views.length > 0 || detail.paths.length > 0}>
                {detail.views.map((v, i) => (
                  <CountRow key={`v-${v.view}`} first={i === 0}
                    label={v.view.charAt(0).toUpperCase() + v.view.slice(1)} n={v.n} max={maxView}
                    sub="WPBL tab" />
                ))}
                {detail.paths.map(p => (
                  <CountRow key={`p-${p.path}`} label={p.path} n={p.n} max={maxPath} sub="route" />
                ))}
              </Panel>

              <Panel title="Who they look at" when={detail.players.length > 0}>
                {detail.players.map((p, i) => (
                  <CountRow key={p.player_id} first={i === 0} label={p.name} n={p.n} max={maxPlayer}
                    icon={<PlayerPortrait name={p.name} teamId={p.team_id} size={22} />} />
                ))}
              </Panel>

              <Panel title="Clubs they open" when={detail.teams.length > 0}>
                {detail.teams.map((t, i) => {
                  const meta = WPBL_TEAMS[t.team_id]
                  return (
                    <CountRow key={t.team_id} first={i === 0} label={t.name} n={t.n} max={maxTeam}
                      icon={meta ? <TeamBadge team={meta} size={22} /> : undefined} />
                  )
                })}
              </Panel>

              {/* The one place a reader's typed words are stored, and only on a miss. Said out
                  loud in the panel, because a list headed "what they searched for" would be a
                  claim we deliberately do not collect. */}
              <Panel title="Came looking for, and left without"
                note="Only queries that matched nothing. A search that found something is not stored."
                when={detail.misses.length > 0}>
                {detail.misses.map((m, i) => (
                  <CountRow key={m.q} first={i === 0} label={`“${m.q}”`} n={m.n}
                    max={Math.max(...detail.misses.map(x => x.n))} />
                ))}
              </Panel>

              <Panel title="Series they called" when={detail.picks.length > 0}>
                {detail.picks.map((p, i) => (
                  <Box key={p.category} sx={{
                    display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.7,
                    borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider',
                  }}>
                    <Typography sx={{ fontSize: '0.76rem', fontWeight: 600, flex: 1 }}>
                      {prettyPick(p.category)}
                    </Typography>
                    <Typography sx={{ fontSize: '0.76rem', fontWeight: 800 }}>{p.choice}</Typography>
                  </Box>
                ))}
              </Panel>

              {/* Live opt-ins, not a history: the rows are deleted as games pass. Empty here
                  means "nothing coming up", never "never used it", and the note says so
                  because the difference is invisible and the wrong reading is the easy one. */}
              <Panel title="Game reminders set"
                note="Live opt-ins only. Rows are deleted as games pass, so this is never a history."
                when={detail.reminders.length > 0}>
                {detail.reminders.map((r, i) => (
                  <Box key={r.game_id} sx={{
                    display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.7,
                    borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider',
                  }}>
                    <Typography sx={{ fontSize: '0.76rem', fontWeight: 600, flex: 1 }}>
                      {r.away ?? '?'} at {r.home ?? '?'}
                    </Typography>
                    <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
                      {shortDate(r.game_date)}
                    </Typography>
                  </Box>
                ))}
              </Panel>
            </Box>

            {/* Full width: a note is prose and reads badly in a 280px column. */}
            {detail.feedback.length > 0 && (
              <Box>
                <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.disabled', mb: 0.6 }}>
                  What they wrote
                </Typography>
                <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                  {detail.feedback.map((f, i) => (
                    <Box key={f.created_at} sx={{ px: 1.5, py: 1, borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.3 }}>
                        <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>
                          {longDate(f.created_at)}{f.path ? ` · ${f.path}` : ''}
                        </Typography>
                        {!f.handled && (
                          <Box sx={{ px: 0.6, py: 0.1, borderRadius: 999, bgcolor: 'primary.main' }}>
                            <Typography sx={{ fontSize: '0.48rem', fontWeight: 900, color: '#fff', letterSpacing: 0.5 }}>
                              OPEN
                            </Typography>
                          </Box>
                        )}
                      </Box>
                      <Typography sx={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {f.message}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            {detail.events_window === 0 && detail.lifetime_events === 0 && (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>
                  This account has never fired an event. It signed up and did nothing else we measure.
                </Typography>
              </Box>
            )}

            <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', lineHeight: 1.5 }}>
              Browsers, not devices: one person on a phone and a laptop is two. Events begin
              Aug 5, 2026, and each one counts only from the day it was instrumented, so a
              surface can look unused when it is simply older than its measurement.
            </Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}
