import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Box, Typography, IconButton } from '@mui/material'
import { Check, Close } from '@mui/icons-material'
import { Section } from '../AdminPanel'
import { TYPE_SCALE } from '../ui/card'
import {
  fetchPhotoTagReview, decideSuggestions, discardSuggester, blockSuggester, unblockSuggester,
  resolvePhotoReports, addFanPhotoSubject,
  type PhotoTagReview, type PhotoTagSuggestion, type PhotoReport,
} from './api'
import { fanPhotoTeamName } from './fanPhotos'
import type { WpblPlayer, WpblPhotoFigure, WpblPhotoSubject, WpblTeam } from './types'

// The owner's half of public photo tagging (docs/PHOTO_TAGGING.md), inside /admin's photo tool.
// Strangers' picks arrive here as SUGGESTIONS; nothing becomes a tag until it is accepted here, so
// this file is the whole of the gate between the crowd and the site.
//
// AGREEMENT IS DISTINCT ADDRESSES, NOT DISTINCT KEYS. A key lives in one browser's storage and a
// private window mints another, so "three people agree" counted by key could be one person three
// times. The database stores a salted hash of each caller's address beside the key; counting those
// makes that cost three connections. A row without an address (a direct database session) counts by
// its key.

export const REPORT_LABEL: Record<PhotoReport['reason'], string> = {
  private_person: 'private person',
  child: 'child',
  not_wpbl: 'not the WPBL',
  other: 'other',
}

/** One subject suggested for one photo, with everyone who suggested it. */
export interface SuggestionGroup {
  photoId: string
  key: string
  subject: { playerId: string } | { figureKey: string } | { teamId: string }
  ids: string[]
  /** Distinct callers: by address where there is one, else by key. */
  agree: number
}

const subjectKey = (s: Pick<PhotoTagSuggestion, 'player_id' | 'figure_key' | 'team_id'>) =>
  s.player_id ? `p:${s.player_id}` : s.team_id ? `t:${s.team_id}` : `f:${s.figure_key}`
const caller = (s: Pick<PhotoTagSuggestion, 'ip_hash' | 'suggester_key'>) => s.ip_hash ? `ip:${s.ip_hash}` : `key:${s.suggester_key}`
export const subjectKeyOfTag = (s: WpblPhotoSubject) =>
  s.player_id ? `p:${s.player_id}` : s.team_id ? `t:${s.team_id}` : `f:${s.figure_key}`

/** The pending suggestions per photo, grouped by subject, most agreed first. */
export function groupSuggestions(suggestions: PhotoTagSuggestion[]): Map<string, SuggestionGroup[]> {
  const byPhoto = new Map<string, Map<string, SuggestionGroup & { callers: Set<string> }>>()
  for (const s of suggestions) {
    if (s.status !== 'pending') continue
    const groups = byPhoto.get(s.photo_id) ?? new Map()
    byPhoto.set(s.photo_id, groups)
    const key = subjectKey(s)
    const g = groups.get(key) ?? {
      photoId: s.photo_id, key, ids: [], agree: 0, callers: new Set<string>(),
      subject: s.player_id ? { playerId: s.player_id } : s.team_id ? { teamId: s.team_id } : { figureKey: s.figure_key! },
    }
    g.ids.push(s.id)
    g.callers.add(caller(s))
    g.agree = g.callers.size
    groups.set(key, g)
  }
  const out = new Map<string, SuggestionGroup[]>()
  for (const [photoId, groups] of byPhoto) {
    out.set(photoId, [...groups.values()]
      .map(({ callers: _callers, ...g }) => g)
      .sort((a, b) => b.agree - a.agree || a.key.localeCompare(b.key)))
  }
  return out
}

/** Per browser key: what it sent and how much of it held up. The accept rate is the only evidence
 *  that could ever justify trusting anyone's picks without review, so it is shown from day one. */
export interface SuggesterStat {
  key: string
  ip: string | null
  total: number
  pending: number
  accepted: number
  rejected: number
  last: string
}

export function suggesterStats(suggestions: PhotoTagSuggestion[]): SuggesterStat[] {
  const m = new Map<string, SuggesterStat>()
  for (const s of suggestions) {
    const st = m.get(s.suggester_key) ?? { key: s.suggester_key, ip: s.ip_hash, total: 0, pending: 0, accepted: 0, rejected: 0, last: s.created_at }
    st.total++
    st[s.status]++
    if (s.created_at > st.last) { st.last = s.created_at; st.ip = s.ip_hash ?? st.ip }
    m.set(s.suggester_key, st)
  }
  return [...m.values()].sort((a, b) => b.pending - a.pending || b.last.localeCompare(a.last))
}

// ─── State shared by every photo card and tag mode ───────────────────────────────

interface TagReviewValue {
  review: PhotoTagReview
  groups: Map<string, SuggestionGroup[]>
  openReports: Map<string, PhotoReport[]>
  reload: () => Promise<void>
}

const EMPTY: PhotoTagReview = { open: new Set(), suggestions: [], reports: [], blocks: [] }
const TagReviewContext = createContext<TagReviewValue>({ review: EMPTY, groups: new Map(), openReports: new Map(), reload: async () => {} })
export const TagReviewProvider = TagReviewContext.Provider
export const useTagReviewContext = () => useContext(TagReviewContext)

/** Loads the review state and keeps it with the curator's other reads. `version` is bumped by the
 *  page's own reload, so one Refresh reads both. */
export function useTagReview(version: number): TagReviewValue {
  const [review, setReview] = useState<PhotoTagReview>(EMPTY)
  const reload = useCallback(async () => { setReview(await fetchPhotoTagReview()) }, [])
  useEffect(() => { reload() }, [reload, version])
  const groups = useMemo(() => groupSuggestions(review.suggestions), [review.suggestions])
  const openReports = useMemo(() => {
    const m = new Map<string, PhotoReport[]>()
    for (const r of review.reports) if (!r.resolved_at) m.set(r.photo_id, [...(m.get(r.photo_id) ?? []), r])
    return m
  }, [review.reports])
  return { review, groups, openReports, reload }
}

/** Accept one group: tag the subject (unless it already is), then mark every suggestion of it
 *  accepted. The tag goes first so a failed write never reads as an accepted suggestion. */
export async function acceptGroup(g: SuggestionGroup, tagged: Set<string>): Promise<boolean> {
  if (!tagged.has(g.key)) {
    const row = await addFanPhotoSubject(g.photoId, g.subject)
    if (!row) return false
  }
  return decideSuggestions(g.ids, 'accepted')
}

// ─── On one photo: the suggestions as ghost chips, and its reports ───────────────

export function SuggestionChips({ photoId, subjects, players, figures, teams, busy, run }: {
  photoId: string
  subjects: WpblPhotoSubject[]
  players: Map<string, WpblPlayer>
  figures: Map<string, WpblPhotoFigure>
  teams: WpblTeam[]
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<void>
}) {
  const { groups, openReports, reload } = useTagReviewContext()
  const mine = groups.get(photoId) ?? []
  const reports = openReports.get(photoId) ?? []
  if (mine.length === 0 && reports.length === 0) return null
  const tagged = new Set(subjects.map(subjectKeyOfTag))
  const name = (g: SuggestionGroup) =>
    'playerId' in g.subject ? (players.get(g.subject.playerId)?.name ?? 'Unknown player')
    : 'teamId' in g.subject ? `${fanPhotoTeamName(teams.find(t => t.id === (g.subject as { teamId: string }).teamId))} (team)`
    : (figures.get(g.subject.figureKey)?.name ?? g.subject.figureKey)
  const act = (fn: () => Promise<unknown>) => run(async () => { await fn(); await reload() })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
      {reports.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.6, p: 0.75, borderRadius: 1.5, border: '1px solid', borderColor: 'error.main' }}>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'error.main' }}>
            Reported ×{reports.length}: {[...new Set(reports.map(r => REPORT_LABEL[r.reason]))].join(', ')}
          </Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.secondary' }}>Out of the public queue until resolved.</Typography>
          <Box component="button" type="button" disabled={busy} onClick={() => act(() => resolvePhotoReports(photoId))}
            sx={{ ml: 'auto', font: 'inherit', fontSize: TYPE_SCALE.meta, fontWeight: 800, px: 1.2, py: 0.3, borderRadius: 999, cursor: 'pointer',
                  border: '1px solid', borderColor: 'outline', bgcolor: 'background.paper', color: 'text.primary' }}>
            Resolve (back in queue)
          </Box>
        </Box>
      )}
      {mine.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.6 }}>
          <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.secondary', mr: 0.2 }}>Suggested</Typography>
          {mine.map(g => (
            <Box key={g.key} sx={{
              display: 'flex', alignItems: 'center', gap: 0.2, pl: 0.9, pr: 0.3, py: 0.1, borderRadius: 999,
              border: '1px dashed', borderColor: 'outline',
            }}>
              <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 600 }}>
                {name(g)}{g.agree > 1 ? ` ×${g.agree}` : ''}{tagged.has(g.key) ? ' (tagged)' : ''}
              </Typography>
              <IconButton size="small" disabled={busy} aria-label={`Accept ${name(g)}`}
                onClick={() => act(() => acceptGroup(g, tagged))} sx={{ p: 0.15, color: 'success.main' }}>
                <Check sx={{ fontSize: TYPE_SCALE.title }} />
              </IconButton>
              <IconButton size="small" disabled={busy} aria-label={`Reject ${name(g)}`}
                onClick={() => act(() => decideSuggestions(g.ids, 'rejected'))} sx={{ p: 0.15, color: 'error.main' }}>
                <Close sx={{ fontSize: TYPE_SCALE.title }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

// ─── The section: the queue at a glance, bulk accept, and the suggesters ─────────

function SmallButton({ children, onClick, disabled, tone }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; tone?: 'danger' }) {
  return (
    <Box component="button" type="button" onClick={onClick} disabled={disabled}
      sx={{ font: 'inherit', fontSize: TYPE_SCALE.meta, fontWeight: 800, px: 1, py: 0.25, borderRadius: 999, cursor: 'pointer',
            border: '1px solid', borderColor: tone === 'danger' ? 'error.main' : 'outline', bgcolor: 'background.paper',
            color: tone === 'danger' ? 'error.main' : 'text.primary', whiteSpace: 'nowrap' }}>
      {children}
    </Box>
  )
}

export function PhotoTaggingSection({ subjectsByPhoto, onChange }: {
  subjectsByPhoto: Map<string, WpblPhotoSubject[]>
  onChange: () => void
}) {
  const { review, groups, openReports, reload } = useTagReviewContext()
  const [busy, setBusy] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const stats = useMemo(() => suggesterStats(review.suggestions), [review.suggestions])
  const blocked = useMemo(() => new Set(review.blocks.map(b => `${b.kind}:${b.value}`)), [review.blocks])
  const pending = review.suggestions.filter(s => s.status === 'pending').length
  const agreed = useMemo(() => [...groups.values()].flat().filter(g => g.agree >= 2), [groups])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn() } finally { await reload(); setBusy(false); onChange() }
  }
  const acceptAgreed = () => run(async () => {
    for (const g of agreed) await acceptGroup(g, new Set((subjectsByPhoto.get(g.photoId) ?? []).map(subjectKeyOfTag)))
  })

  const rate = (s: SuggesterStat) => (s.accepted + s.rejected > 0 ? `${Math.round(100 * s.accepted / (s.accepted + s.rejected))}%` : '—')
  const short = (v: string) => v.slice(0, 8)
  const shown = showAll ? stats : stats.slice(0, 12)

  return (
    <Section title="Public tagging">
      <Box sx={{ px: 1.5, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>
          {review.open.size} open for tagging · {pending} suggestions waiting · {openReports.size} reported ·
          {' '}{review.blocks.length} blocked. Anyone can suggest names for an open photo at /wpbl/photos/tag; nothing
          becomes a tag until accepted here. Agreement counts distinct addresses, not browsers.
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          <SmallButton disabled={busy || agreed.length === 0} onClick={acceptAgreed}>
            {`Accept all with 2+ agreeing (${agreed.length})`}
          </SmallButton>
        </Box>

        {stats.length > 0 && (
          <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={{ borderCollapse: 'collapse', fontSize: TYPE_SCALE.meta, minWidth: 520, '& td, & th': { px: 0.75, py: 0.4, textAlign: 'left', borderBottom: '1px solid', borderColor: 'divider', whiteSpace: 'nowrap' } }}>
              <thead><tr><th>Browser</th><th>Address</th><th>Sent</th><th>Waiting</th><th>Kept</th><th>Accept rate</th><th /></tr></thead>
              <tbody>
                {shown.map(s => {
                  const keyBlocked = blocked.has(`key:${s.key}`)
                  const ipBlocked = s.ip != null && blocked.has(`ip:${s.ip}`)
                  return (
                    <tr key={s.key}>
                      <td>{short(s.key)}{keyBlocked ? ' (blocked)' : ''}</td>
                      <td>{s.ip ? short(s.ip) : '—'}{ipBlocked ? ' (blocked)' : ''}</td>
                      <td>{s.total}</td><td>{s.pending}</td><td>{s.accepted}</td><td>{rate(s)}</td>
                      <td>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {s.pending > 0 && <SmallButton disabled={busy} onClick={() => run(() => discardSuggester('key', s.key))}>Reject waiting</SmallButton>}
                          {keyBlocked
                            ? <SmallButton disabled={busy} onClick={() => run(() => unblockSuggester('key', s.key))}>Unblock</SmallButton>
                            : <SmallButton tone="danger" disabled={busy} onClick={() => run(async () => { await discardSuggester('key', s.key); await blockSuggester('key', s.key) })}>Block browser</SmallButton>}
                          {s.ip && (ipBlocked
                            ? <SmallButton disabled={busy} onClick={() => run(() => unblockSuggester('ip', s.ip!))}>Unblock address</SmallButton>
                            : <SmallButton tone="danger" disabled={busy} onClick={() => run(async () => { await discardSuggester('ip', s.ip!); await blockSuggester('ip', s.ip!) })}>Block address</SmallButton>)}
                        </Box>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Box>
            {stats.length > 12 && (
              <Box sx={{ mt: 0.75 }}><SmallButton onClick={() => setShowAll(v => !v)}>{showAll ? 'Fewer' : `All ${stats.length} browsers`}</SmallButton></Box>
            )}
          </Box>
        )}
        <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.secondary' }}>
          Blocking rejects what is waiting and drops everything they send after, while telling them it worked.
          An address is a salted hash, never the address itself; one address can be a whole household or a stadium.
        </Typography>
      </Box>
    </Section>
  )
}
