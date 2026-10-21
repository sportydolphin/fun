import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import WpblPage from './WpblPage'
import { ChipRow, FilterChip } from '../ui/FilterChip'
import { NameText } from '../ui/NameText'
import { PlayerPortrait, TeamBadge, TextGhost, TYPE_SCALE, FOCUS_RING, hoverOnly } from './ui'
import {
  fetchPhotosToTag, suggestPhotoTags, reportPhoto, fetchWpblAllPlayers, fetchWpblTeams,
  type PhotoToTag, type TagSubject, type TagAnswer, type ReportReason,
} from './api'
import { searchPlayers } from './playerSearch'
import { fetchWpblFanPhotoFigures } from './api/photos'
import { fanPhotoTeamName } from './fanPhotos'
import { WPBL_PHOTOS_PAGE } from './routes'
import { linkTo } from '../nav'
import { chromePx } from '../ui/scale'
import { track, EVENTS } from '../lib/analytics'
import type { WpblPlayer, WpblPhotoFigure, WpblTeam } from './types'

// /wpbl/photos/tag: one unpublished fan photo at a time, and anyone, signed in or not, says who is in
// it. See docs/PHOTO_TAGGING.md. What this page sends are SUGGESTIONS: the owner confirms each one in
// /admin before it becomes a tag, so the page promises exactly that and nothing more.
//
// Every guard is in the database (the migration 20261020200000_public_photo_tagging.sql), where a
// client cannot skip it. The page only has to report honestly what the database answered.
//
// THE NAMES ARE A CLOSED LIST: the full roster (never a club's current sheet, which drops a traded
// player), the figures the owner keeps, and the four clubs for a team photo. There is no free text,
// so there is nothing to moderate and nothing a stranger can make the page render.

/** One thing that can be picked: a player, a figure (a mascot, a manager) or a whole club. */
type Option =
  | { kind: 'player'; key: string; subject: TagSubject; label: string; player: WpblPlayer }
  | { kind: 'figure'; key: string; subject: TagSubject; label: string; figure: WpblPhotoFigure }
  | { kind: 'team'; key: string; subject: TagSubject; label: string; team: WpblTeam }

const RECENT_STORE = 'sd_photo_tag_recent'
const MAX_PICKS = 10
/** How many photos to ask for at a time; the next batch is fetched when this one runs low. */
const BATCH = 8

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_STORE) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
  } catch { return [] }
}
function writeRecent(keys: string[]) {
  try { localStorage.setItem(RECENT_STORE, JSON.stringify(keys.slice(0, 8))) } catch { /* a convenience */ }
}

/** The photo's frame: one fixed height for every photo and for the skeleton, with the photo
 *  contained inside it, so moving to the next photo (portrait or landscape) moves nothing under it,
 *  and the controls start above the fold on a phone. */
const FRAME_SX = {
  height: { xs: '42vh', sm: '50vh' }, maxHeight: chromePx(560), minHeight: chromePx(220),
  borderRadius: 2, bgcolor: '#000', overflow: 'hidden', position: 'relative',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
} as const

const REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'private_person', label: 'A member of the public is the focus' },
  { value: 'child', label: 'It shows a child' },
  { value: 'not_wpbl', label: "It isn't the WPBL" },
  { value: 'other', label: 'Something else is wrong' },
]

/** What to say about an answer that did not move the reader on. */
const NOTICE: Partial<Record<TagAnswer, string>> = {
  limited: "That's a lot of names in a short time, so we've paused you for a while. Thanks for the help; try again later.",
  invalid: "Something in that didn't match our list, so nothing was sent. Try picking the names again.",
  error: "Couldn't send that. Check your connection and try again.",
}

function Pill({ children, onClick, primary, disabled, label }: {
  children: React.ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean; label?: string
}) {
  return (
    <Box component="button" type="button" onClick={onClick} disabled={disabled} aria-label={label}
      sx={{
        font: 'inherit', fontSize: TYPE_SCALE.body, fontWeight: 800, lineHeight: 1.2,
        px: 2, py: 1.1, minHeight: chromePx(44), borderRadius: 999, cursor: disabled ? 'default' : 'pointer',
        border: '1px solid', ...FOCUS_RING,
        ...(primary
          ? { bgcolor: 'var(--wpbl-accent-solid)', borderColor: 'var(--wpbl-accent-solid)', color: '#fff' }
          : { bgcolor: 'background.paper', borderColor: 'outline', color: 'text.primary', ...hoverOnly({ bgcolor: 'action.hover' }) }),
        ...(disabled ? { bgcolor: 'action.disabledBackground', borderColor: 'outline', color: 'text.secondary' } : {}),
      }}>
      {children}
    </Box>
  )
}

/** One name the reader can pick, as a row: who, and what tells them apart (number, club, role). */
function OptionRow({ option, teams, onPick, disabled }: {
  option: Option; teams: Map<string, WpblTeam>; onPick: () => void; disabled?: boolean
}) {
  const sub = option.kind === 'player'
    ? [option.player.jersey_number ? `#${option.player.jersey_number}` : null,
       option.player.team_id ? teams.get(option.player.team_id)?.abbr : null,
       option.player.position].filter(Boolean).join(' · ')
    : option.kind === 'figure' ? option.figure.kind[0].toUpperCase() + option.figure.kind.slice(1)
    : 'Team photo: the whole club'
  return (
    <Box component="button" type="button" onClick={onPick} disabled={disabled}
      sx={{
        font: 'inherit', textAlign: 'left', width: '100%', minWidth: 0, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.75, minHeight: chromePx(48),
        borderRadius: 2, border: '1px solid', borderColor: 'outline', bgcolor: 'background.paper',
        color: 'text.primary', ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING,
      }}>
      {option.kind === 'player' ? <PlayerPortrait name={option.player.name} teamId={option.player.team_id} size={32} />
        : option.kind === 'team' ? <TeamBadge team={option.team} size={32} />
        : <Box aria-hidden sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: 'action.hover', flexShrink: 0 }} />}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <NameText name={option.label} sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700 }} />
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }} noWrap>{sub}</Typography>
      </Box>
      <Typography aria-hidden sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, color: 'var(--wpbl-accent-fg)', px: 0.5 }}>+</Typography>
    </Box>
  )
}

export default function PhotoTagPage() {
  const [players, setPlayers] = useState<WpblPlayer[] | null>(null)
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [figures, setFigures] = useState<WpblPhotoFigure[]>([])
  const [queue, setQueue] = useState<PhotoToTag[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [progress, setProgress] = useState<{ open: number; named: number } | null>(null)
  const [picked, setPicked] = useState<Option[]>([])
  const [query, setQuery] = useState('')
  const [club, setClub] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [reporting, setReporting] = useState(false)
  const [thanks, setThanks] = useState(0)
  const [recent, setRecent] = useState<string[]>(() => readRecent())
  // Skipped this visit. The database never hears about a skip, so the next batch is asked to leave
  // these out; a reload starts fresh, which is right for "I'll come back to it".
  const skipped = useRef<string[]>([])
  const opened = useRef(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    Promise.all([fetchWpblAllPlayers(), fetchWpblTeams(), fetchWpblFanPhotoFigures()])
      .then(([pl, tm, fg]) => { if (live) { setPlayers(pl); setTeams(tm); setFigures(fg) } })
      .catch(() => { if (live) setPlayers([]) })
    return () => { live = false }
  }, [])

  const loadMore = useCallback(async (keep: PhotoToTag[]) => {
    const rows = await fetchPhotosToTag([...skipped.current, ...keep.map(p => p.id)], BATCH)
    if (rows == null) { if (keep.length === 0) setFailed(true); setQueue(keep); return }
    setFailed(false)
    if (rows[0]) setProgress({ open: rows[0].open_count, named: rows[0].named_count })
    setQueue([...keep, ...rows.filter(r => !keep.some(k => k.id === r.id))])
  }, [])
  useEffect(() => { loadMore([]) }, [loadMore])

  const photo = queue?.[0] ?? null
  useEffect(() => {
    if (photo && !opened.current) {
      opened.current = true
      track(EVENTS.WPBL_PHOTO_TAG_OPENED, { from: document.referrer.includes('/wpbl/photos') ? 'gallery' : 'direct' })
    }
  }, [photo])

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const options = useMemo<Option[]>(() => [
    ...(players ?? []).map(p => ({ kind: 'player' as const, key: `p:${p.id}`, subject: { player: p.id }, label: p.name, player: p })),
    ...figures.map(f => ({ kind: 'figure' as const, key: `f:${f.key}`, subject: { figure: f.key }, label: f.name, figure: f })),
    ...teams.map(t => ({ kind: 'team' as const, key: `t:${t.id}`, subject: { team: t.id }, label: fanPhotoTeamName(t), team: t })),
  ], [players, figures, teams])
  const optionByKey = useMemo(() => new Map(options.map(o => [o.key, o])), [options])
  // Who the owner has already tagged on this photo. Tagging is shared, so a tagged photo stays in the
  // queue until it is published; these are shown as named and are never offered again, and the
  // database drops one that slips through.
  const taggedOptions = useMemo(() => (photo?.tagged ?? [])
    .map(s => optionByKey.get('player' in s ? `p:${s.player}` : 'team' in s ? `t:${s.team}` : `f:${s.figure}`))
    .filter((o): o is Option => !!o), [photo, optionByKey])
  const pickedKeys = useMemo(() => new Set([...picked, ...taggedOptions].map(o => o.key)), [picked, taggedOptions])

  // What the list under the search shows. A name or a number searches everyone (a number is how a
  // fan recognizes a player in a photo); with nothing typed, a club chip lists that club, and with
  // neither, nothing, so the page does not open on a wall of 118 names.
  const matches = useMemo<Option[]>(() => {
    const q = query.trim()
    if (q.length >= 1) {
      const people = searchPlayers(q, players ?? []).map(h => optionByKey.get(`p:${h.player.id}`)!).filter(Boolean)
      const lower = q.toLowerCase()
      const others = options.filter(o => o.kind !== 'player' && o.label.toLowerCase().includes(lower))
      return [...people, ...others].filter(o => !pickedKeys.has(o.key)).slice(0, 8)
    }
    if (club) {
      const roster = (players ?? []).filter(p => p.team_id === club && p.active !== false)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(p => optionByKey.get(`p:${p.id}`)!)
      const whole = optionByKey.get(`t:${club}`)
      return [...(whole ? [whole] : []), ...roster].filter(o => o && !pickedKeys.has(o.key))
    }
    return []
  }, [query, club, players, options, optionByKey, pickedKeys])
  const recentOptions = recent.map(k => optionByKey.get(k)).filter((o): o is Option => !!o && !pickedKeys.has(o.key)).slice(0, 6)

  const pick = (o: Option) => {
    if (picked.length >= MAX_PICKS || pickedKeys.has(o.key)) return
    setPicked(p => [...p, o])
    setQuery('')
    setNotice(null)
    searchRef.current?.focus()
  }
  const unpick = (key: string) => setPicked(p => p.filter(o => o.key !== key))

  const advance = useCallback((rest: PhotoToTag[]) => {
    setPicked([]); setQuery(''); setReporting(false)
    window.scrollTo({ top: 0 })
    if (rest.length <= 2) loadMore(rest)
    else setQueue(rest)
  }, [loadMore])

  const submit = async () => {
    if (!photo || picked.length === 0 || busy) return
    setBusy(true)
    const answer = await suggestPhotoTags(photo.id, picked.map(o => o.subject))
    setBusy(false)
    track(EVENTS.WPBL_PHOTO_TAG_SUBMITTED, { count: picked.length, answer })
    if (answer === 'ok' || answer === 'closed') {
      if (answer === 'ok') {
        setThanks(n => n + 1)
        const next = [...picked.map(o => o.key), ...recent.filter(k => !pickedKeys.has(k))].slice(0, 8)
        setRecent(next); writeRecent(next)
      }
      setNotice(answer === 'closed' ? 'Someone finished that one just before you. Here is the next.' : null)
      advance(queue!.slice(1))
    } else {
      setNotice(NOTICE[answer] ?? NOTICE.error!)
    }
  }

  const skip = (why: 'skip' | 'unknown') => {
    if (!photo || busy) return
    track(EVENTS.WPBL_PHOTO_TAG_SKIPPED, { why })
    skipped.current = [...skipped.current, photo.id]
    setNotice(null)
    advance(queue!.slice(1))
  }

  const report = async (reason: ReportReason) => {
    if (!photo || busy) return
    setBusy(true)
    const answer = await reportPhoto(photo.id, reason)
    setBusy(false)
    track(EVENTS.WPBL_PHOTO_TAG_REPORTED, { reason, answer })
    if (answer === 'ok' || answer === 'closed') {
      setNotice('Thanks. That photo is out of the queue until we have looked at it.')
      skipped.current = [...skipped.current, photo.id]
      advance(queue!.slice(1))
    } else {
      setNotice(NOTICE[answer] ?? NOTICE.error!)
    }
  }

  const finished = queue != null && queue.length === 0 && !failed
  useEffect(() => {
    if (finished && thanks > 0) track(EVENTS.WPBL_PHOTO_TAG_FINISHED, { named: thanks })
  }, [finished, thanks])

  const loading = queue == null || players == null

  return (
    <WpblPage title="Who's in this photo?"
      standfirst="Pick everyone you recognize. Every name is checked before it goes up.">
      {loading ? <TagSkeleton /> : failed ? (
        <EndNote title="Couldn't load the photos" body="Check your connection and try again in a moment." />
      ) : finished || !photo ? (
        thanks > 0
          ? <EndNote title="That's every photo for now" body={`Thank you: you named who is in ${thanks} ${thanks === 1 ? 'photo' : 'photos'}. They go up once they're checked.`} />
          : <EndNote title="Nothing to name right now" body="You've been through every photo waiting. More arrive after games." />
      ) : (
        <>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mb: 1, fontVariantNumeric: 'tabular-nums' }}>
            {progress ? `${progress.named} of ${progress.open} photos have a name` : ' '}
            {thanks > 0 ? ` · you've named ${thanks}` : ''}
          </Typography>

          <Box sx={FRAME_SX}>
            <Box component="img" key={photo.id} src={photo.full_url} alt={`A fan's shot from the 2026 season${photo.credit ? `, by ${photo.credit}` : ''}; ${taggedOptions.length ? `named so far: ${taggedOptions.map(o => o.label).join(', ')}` : 'who is in it is not yet known'}`}
              sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
          </Box>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mt: 0.5, minHeight: '1.4em' }}>
            {photo.credit ? `Photo: ${photo.credit}` : ' '}
          </Typography>

          {/* Who is already named (fixed), then what is picked so far (removable). Held open at one row
              so the first pick, or a photo that arrives already tagged, moves nothing. */}
          <Box aria-live="polite" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.5, minHeight: chromePx(36) }}>
            {taggedOptions.length > 0 && (
              <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', alignSelf: 'center' }}>
                Already named
              </Typography>
            )}
            {taggedOptions.map(o => (
              <Box key={o.key} sx={{
                display: 'inline-flex', alignItems: 'center', maxWidth: '100%', px: 1.25, py: 0.5, borderRadius: 999,
                border: '1px solid', borderColor: 'outline', bgcolor: 'action.hover', color: 'text.primary',
              }}>
                <NameText component="span" name={o.label} sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, minWidth: 0 }} />
              </Box>
            ))}
            {picked.length === 0 ? (taggedOptions.length > 0 ? null : (
              <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', alignSelf: 'center' }}>
                No one picked yet.
              </Typography>
            )) : picked.map(o => (
              <Box key={o.key} component="button" type="button" onClick={() => unpick(o.key)}
                aria-label={`Remove ${o.label}`}
                sx={{
                  font: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 0.5, maxWidth: '100%',
                  pl: 1.25, pr: 1, py: 0.5, borderRadius: 999, cursor: 'pointer',
                  border: '1px solid', borderColor: 'var(--wpbl-accent-fg)', bgcolor: 'background.paper', color: 'text.primary',
                  ...FOCUS_RING,
                }}>
                <NameText component="span" name={o.label} sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, minWidth: 0 }} />
                <Box component="span" aria-hidden sx={{ fontWeight: 800, color: 'text.secondary' }}>×</Box>
              </Box>
            ))}
          </Box>

          {/* The actions sit under the picks, above the search, so a long roster list never pushes
              them off the screen and they never move as the list grows. */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
            <Pill primary onClick={submit} disabled={picked.length === 0 || busy}>
              {busy ? 'Sending…' : picked.length > 1 ? `Send ${picked.length} names` : 'Send and next'}
            </Pill>
            <Pill onClick={() => skip('skip')} disabled={busy}>Skip</Pill>
            <Pill onClick={() => skip('unknown')} disabled={busy}>I don't recognize anyone</Pill>
          </Box>

          {notice && (
            <Typography role="status" sx={{ fontSize: TYPE_SCALE.body, mt: 1.5, color: 'text.primary', fontWeight: 600 }}>{notice}</Typography>
          )}

          <Box sx={{ mt: 1.5 }}>
            <Box component="label" htmlFor="photo-tag-search"
              sx={{ display: 'block', fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
              Search by name or number
            </Box>
            <Box component="input" id="photo-tag-search" ref={searchRef} value={query} autoComplete="off"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter' && matches[0]) { e.preventDefault(); pick(matches[0]) } }}
              placeholder="Kelsie, or #7"
              disabled={picked.length >= MAX_PICKS}
              sx={{
                width: '100%', boxSizing: 'border-box', fontSize: TYPE_SCALE.body, fontFamily: 'inherit',
                borderRadius: 2, border: '1px solid', borderColor: 'outline', bgcolor: 'transparent', color: 'text.primary',
                px: 1.25, py: 0.85, outline: 'none',
                '&:focus': { borderColor: 'var(--wpbl-accent-fg)' }, '&::placeholder': { color: 'text.disabled' },
              }} />
          </Box>

          {/* Narrow by club, for a fan who knows the cap before the face. */}
          <Box sx={{ mt: 1 }}>
            <ChipRow mb={0}>
              {teams.map(t => (
                <FilterChip key={t.id} active={club === t.id}
                  onClick={() => { setClub(c => (c === t.id ? null : t.id)); setQuery('') }}>{fanPhotoTeamName(t)}</FilterChip>
              ))}
            </ChipRow>
          </Box>

          {recentOptions.length > 0 && !query && !club && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, mt: 1 }}>
              <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary' }}>Recent</Typography>
              {recentOptions.map(o => (
                <FilterChip key={o.key} active={false} onClick={() => pick(o)}>{`+ ${o.label}`}</FilterChip>
              ))}
            </Box>
          )}

          {matches.length > 0 && (
            <Box role="list" aria-label="Names to pick" sx={{ display: 'grid', gap: 0.75, mt: 1, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
              {matches.map(o => (
                <Box role="listitem" key={o.key} sx={{ minWidth: 0 }}>
                  <OptionRow option={o} teams={teamById} onPick={() => pick(o)} disabled={picked.length >= MAX_PICKS} />
                </Box>
              ))}
            </Box>
          )}
          {query.trim() && matches.length === 0 && (
            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', mt: 1 }}>
              No one on our list matches that. Names come from the league's rosters only.
            </Typography>
          )}

          <Box sx={{ mt: 2.5 }}>
            {!reporting ? (
              <Box component="button" type="button" onClick={() => setReporting(true)}
                sx={{ font: 'inherit', fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', bgcolor: 'transparent',
                      border: 0, p: 0.5, cursor: 'pointer', textDecoration: 'underline', ...FOCUS_RING }}>
                Report this photo
              </Box>
            ) : (
              <Box role="group" aria-label="Why report this photo" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
                <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', width: '100%' }}>
                  What's wrong with it? It comes out of the queue straight away.
                </Typography>
                {REASONS.map(r => (
                  <FilterChip key={r.value} active={false} onClick={() => report(r.value)}>{r.label}</FilterChip>
                ))}
                <FilterChip active={false} onClick={() => setReporting(false)}>Cancel</FilterChip>
              </Box>
            )}
          </Box>

          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mt: 3, lineHeight: 1.5 }}>
            No account needed. What you pick is a suggestion: nothing appears on the site until we have checked it.
            We keep a random id for this browser and a scrambled form of your connection's address to stop spam,
            never your name or the address itself.
          </Typography>
        </>
      )}
    </WpblPage>
  )
}

function EndNote({ title, body }: { title: string; body: string }) {
  return (
    <Box sx={{ py: 5, textAlign: 'center' }}>
      <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800 }}>{title}</Typography>
      <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', mt: 0.75, mb: 2 }}>{body}</Typography>
      <Box component="a" {...linkTo(WPBL_PHOTOS_PAGE)}
        sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, color: 'var(--wpbl-accent-fg)', textDecoration: 'none', ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING }}>
        See the photos
      </Box>
    </Box>
  )
}

/** The page before the queue lands, drawn as the loaded page (src/CLAUDE.md): the progress line, the
 *  frame at its fixed height, the credit, the picked row, the search, the club chips and the
 *  buttons, each in the box the loaded one takes. */
function TagSkeleton() {
  return (
    <Box aria-hidden>
      <Typography sx={{ fontSize: TYPE_SCALE.meta, mb: 1 }}><TextGhost>00 of 000 photos have a name</TextGhost></Typography>
      <Box sx={FRAME_SX}><Skeleton variant="rectangular" sx={{ position: 'absolute', inset: 0, height: '100%', bgcolor: 'grey.900' }} /></Box>
      <Typography sx={{ fontSize: TYPE_SCALE.meta, mt: 0.5, minHeight: '1.4em' }}><TextGhost>Photo: Photographer Name</TextGhost></Typography>
      <Box sx={{ display: 'flex', mt: 1.5, minHeight: chromePx(36) }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, alignSelf: 'center' }}><TextGhost>No one picked yet.</TextGhost></Typography>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
        {['Send and next', 'Skip', "I don't recognize anyone"].map(l => (
          <Box key={l} sx={{ px: 2, py: 1.1, minHeight: chromePx(44), borderRadius: 999, border: '1px solid', borderColor: 'outline',
            fontSize: TYPE_SCALE.body, fontWeight: 800, lineHeight: 1.2, boxSizing: 'border-box' }}><TextGhost>{l}</TextGhost></Box>
        ))}
      </Box>
      <Box sx={{ mt: 1.5 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, mb: 0.5 }}><TextGhost>Search by name or number</TextGhost></Typography>
        <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'outline', px: 1.25, py: 0.85, fontSize: TYPE_SCALE.body }}>
          <TextGhost>Kelsie, or #7</TextGhost>
        </Box>
      </Box>
      <Box sx={{ mt: 1 }}>
        <ChipRow mb={0}>
          {['Boston Hunters', 'Los Angeles Queens', 'New York Heights', 'San Francisco Fog'].map(n => (
            <FilterChip key={n} active={false} onClick={() => {}}><TextGhost>{n}</TextGhost></FilterChip>
          ))}
        </ChipRow>
      </Box>
    </Box>
  )
}
