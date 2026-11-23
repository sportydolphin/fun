import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import WpblPage, { SectionHeading } from './WpblPage'
import { NameText } from '../ui/NameText'
import { TextGhost, TYPE_SCALE, FOCUS_RING, hoverOnly } from './ui'
import { useAuth } from '../AuthContext'
import {
  fetchWpblAllPlayers, fetchWpblTeams, fetchUploadTerms, submitPhoto, fetchMySubmissions,
  removeMySubmission, fetchSubmissionRender,
  type UploadTerms, type SubmitAnswer, type MySubmission, type SubmissionSubject,
} from './api'
import { fetchWpblFanPhotoFigures } from './api/photos'
import { prepareForUpload } from './fanPhotoUpload'
import { SubjectPicker, useSubjectOptions, type SubjectOption } from './PhotoSubjectPicker'
import { WPBL_PHOTOS_PAGE } from './routes'
import { linkTo } from '../nav'
import { chromePx } from '../ui/scale'
import type { WpblPlayer, WpblPhotoFigure, WpblTeam } from './types'

// /wpbl/photos/submit: a signed-in fan sends their own photos (docs/FAN_UPLOADS.md, phase 3).
//
// Every guard is in the database and the endpoint (20261113170000_fan_photo_submissions.sql,
// functions/api/fan-submission.ts): sign-in, the daily limits, duplicates, blocks, the closed list
// of names. This page only reports honestly what each photo's answer was.
//
// NOTHING HERE IS PUBLIC UNTIL THE OWNER APPROVES IT. The renders go to a private bucket; the
// fan's own list shows a waiting photo through the endpoint, on their token.
//
// The browser makes the two webp renders in a canvas before anything is sent (fanPhotoUpload.ts),
// so the original file, with its location and camera data, never leaves the device.

const MAX_PHOTOS = 10
const MAX_PICKS = 10
// A phone photo is a few MB; anything this large is a raw or a video mislabeled, and decoding it
// in a canvas can take a phone's tab down.
const MAX_FILE_BYTES = 40 * 1024 * 1024
const CREDIT_STORE = 'sd_photo_credit'
const THUMB = 72

interface Draft {
  key: string
  file: File
  preview: string
  picks: SubjectOption[]
  open: boolean
  status: 'ready' | 'sending' | SubmitAnswer | 'unreadable'
}

const ANSWER: Record<Exclude<Draft['status'], 'ready'>, string> = {
  sending: 'Sending…',
  ok: 'Sent',
  duplicate: 'Already on the site or waiting',
  limited: 'Daily limit reached',
  invalid: 'Not accepted',
  signin: 'Sign in again',
  error: 'Failed to send',
  unreadable: "Couldn't read this file",
}

const STATUS_LABEL: Record<MySubmission['status'], string> = {
  pending: 'Waiting for review',
  approved: 'Published',
  rejected: 'Not published',
  removed: 'Removed',
}

function readCredit(): string {
  try { return localStorage.getItem(CREDIT_STORE) ?? '' } catch { return '' }
}
function writeCredit(v: string) {
  try { localStorage.setItem(CREDIT_STORE, v) } catch { /* a convenience */ }
}

function Pill({ children, onClick, primary, disabled }: {
  children: React.ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean
}) {
  return (
    <Box component="button" type="button" onClick={onClick} disabled={disabled}
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

function TextLink({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label?: string }) {
  return (
    <Box component="button" type="button" onClick={onClick} aria-label={label}
      sx={{
        font: 'inherit', fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.secondary', bgcolor: 'transparent',
        border: 0, p: 0, cursor: 'pointer', textDecoration: 'underline', ...FOCUS_RING,
      }}>
      {children}
    </Box>
  )
}

const FIELD_SX = {
  width: '100%', boxSizing: 'border-box', fontSize: TYPE_SCALE.body, fontFamily: 'inherit',
  borderRadius: 2, border: '1px solid', borderColor: 'outline', bgcolor: 'transparent', color: 'text.primary',
  px: 1.5, py: 1, outline: 'none', minHeight: chromePx(44),
  '&:focus': { borderColor: 'var(--wpbl-accent-fg)' }, '&::placeholder': { color: 'text.disabled' },
} as const

/** A thumbnail box of one fixed size, so a picture arriving moves nothing. */
function ThumbBox({ src, alt }: { src: string | null; alt: string }) {
  return (
    <Box sx={{ width: THUMB, height: THUMB, flexShrink: 0, borderRadius: 1.5, overflow: 'hidden', bgcolor: 'action.hover' }}>
      {src && <Box component="img" src={src} alt={alt} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
    </Box>
  )
}

/** A waiting photo's render comes from the private bucket on the fan's token; a published one is
 *  the public card. Rejected and removed ones are fetched too, and simply stay blank once the
 *  bucket's 30-day rule has deleted them. */
function SubmissionThumb({ sub }: { sub: MySubmission }) {
  const [src, setSrc] = useState<string | null>(sub.card_url)
  useEffect(() => {
    if (sub.card_url) return
    let url: string | null = null
    let live = true
    fetchSubmissionRender(sub.id, 'card')
      .then(b => { if (!live) return; url = URL.createObjectURL(b); setSrc(url) })
      .catch(() => { /* blank box: the render has expired or was never stored */ })
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [sub.id, sub.card_url])
  return <ThumbBox src={src} alt="" />
}

export default function PhotoSubmitPage() {
  const { user, loading: authLoading, openAuthDialog } = useAuth()

  const [players, setPlayers] = useState<WpblPlayer[] | null>(null)
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [figures, setFigures] = useState<WpblPhotoFigure[]>([])
  const [terms, setTerms] = useState<UploadTerms | null | undefined>(undefined)
  const [mine, setMine] = useState<MySubmission[] | null>(null)

  const [drafts, setDrafts] = useState<Draft[]>([])
  const [credit, setCredit] = useState(readCredit)
  const [note, setNote] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Nothing is read for a signed-out reader: there is nothing they can do here but sign in.
  useEffect(() => {
    if (!user) return
    let live = true
    Promise.all([fetchWpblAllPlayers(), fetchWpblTeams(), fetchWpblFanPhotoFigures(), fetchUploadTerms()])
      .then(([pl, tm, fg, tr]) => { if (live) { setPlayers(pl); setTeams(tm); setFigures(fg); setTerms(tr) } })
      .catch(() => { if (live) { setPlayers([]); setTerms(null) } })
    return () => { live = false }
  }, [user])

  const loadMine = useCallback(() => {
    if (!user) return
    fetchMySubmissions(user.id).then(rows => setMine(rows ?? []))
  }, [user])
  useEffect(() => loadMine(), [loadMine])

  // Object URLs for the previews are released when a draft goes and when the page does.
  const previews = useRef(new Set<string>())
  useEffect(() => () => { for (const u of previews.current) URL.revokeObjectURL(u) }, [])

  const { options, optionByKey, teamById } = useSubjectOptions(players, figures, teams)

  const addFiles = (files: FileList | null) => {
    if (!files) return
    setNotice(null)
    const room = MAX_PHOTOS - drafts.filter(d => d.status !== 'ok').length
    const picked = [...files].slice(0, Math.max(0, room))
    if (files.length > picked.length) setNotice(`Up to ${MAX_PHOTOS} photos at a time.`)
    const next = picked.map(file => {
      const preview = URL.createObjectURL(file)
      previews.current.add(preview)
      return {
        key: `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2, 8)}`,
        file, preview, picks: [], open: false,
        status: file.size > MAX_FILE_BYTES ? 'unreadable' : 'ready',
      } satisfies Draft
    })
    // Sent ones leave the list when new photos arrive: they are in "Your submissions" now.
    setDrafts(d => [...d.filter(x => x.status !== 'ok'), ...next])
    if (fileRef.current) fileRef.current.value = ''
  }

  const update = (key: string, patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) =>
    setDrafts(ds => ds.map(d => (d.key === key ? { ...d, ...(typeof patch === 'function' ? patch(d) : patch) } : d)))
  const drop = (key: string) => setDrafts(ds => {
    const gone = ds.find(d => d.key === key)
    if (gone) { URL.revokeObjectURL(gone.preview); previews.current.delete(gone.preview) }
    return ds.filter(d => d.key !== key)
  })

  const toSend = drafts.filter(d => d.status === 'ready' || d.status === 'error')
  const creditOk = credit.trim().length >= 1 && credit.trim().length <= 60
  const canSend = !sending && toSend.length > 0 && creditOk && agreed && !!terms

  const send = async () => {
    if (!canSend || !terms) return
    setSending(true); setNotice(null)
    writeCredit(credit.trim())
    for (const d of toSend) {
      update(d.key, { status: 'sending', open: false })
      let status: Draft['status']
      try {
        const prepared = await prepareForUpload(d.file)
        status = await submitPhoto(prepared, {
          credit: credit.trim(), note: note.trim(), termsVersion: terms.version,
          subjects: d.picks.map(o => o.subject as SubmissionSubject),
        })
      } catch {
        status = 'unreadable'
      }
      update(d.key, { status })
      if (status === 'signin') break
    }
    setSending(false)
    loadMine()
  }

  const remove = async (s: MySubmission) => {
    const published = s.status === 'approved'
    if (!window.confirm(published ? 'Take this photo off the site?' : 'Withdraw this photo?')) return
    const ok = await removeMySubmission(s.id)
    if (!ok) setNotice("Couldn't remove that. Try again.")
    loadMine()
  }

  const signedOut = !authLoading && !user

  return (
    <WpblPage title="Submit photos">
      <Box sx={{ maxWidth: chromePx(720) }}>
        {signedOut ? (
          <Box sx={{ py: 3 }}>
            <Pill primary onClick={() => openAuthDialog('signin')}>Sign in to submit photos</Pill>
            <Box sx={{ mt: 2 }}>
              <Box component="a" {...linkTo(WPBL_PHOTOS_PAGE)} sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'var(--wpbl-accent-fg)', textDecoration: 'none', ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING }}>
                See the photos
              </Box>
            </Box>
          </Box>
        ) : (
          <>
            <SectionHeading>Photos</SectionHeading>
            <Box component="input" ref={fileRef} type="file" accept="image/*" multiple hidden
              aria-label="Choose photos" onChange={(e: React.ChangeEvent<HTMLInputElement>) => addFiles(e.target.files)} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
              <Pill onClick={() => fileRef.current?.click()} disabled={!user || sending}>Choose photos</Pill>
              <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                {drafts.length} of {MAX_PHOTOS}
              </Typography>
            </Box>

            <Box sx={{ display: 'grid', gap: 1, mt: 1.5 }}>
              {drafts.map(d => {
                const pickedKeys = new Set(d.picks.map(o => o.key))
                const locked = d.status !== 'ready' && d.status !== 'error'
                return (
                  <Box key={d.key} sx={{ border: '1px solid', borderColor: 'outline', borderRadius: 2, p: 1 }}>
                    <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
                      <ThumbBox src={d.preview} alt={d.file.name} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography noWrap sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700 }}>{d.file.name}</Typography>
                        <Typography role="status" sx={{
                          fontSize: TYPE_SCALE.meta, fontWeight: 700,
                          color: d.status === 'ok' ? 'success.main' : d.status === 'ready' || d.status === 'sending' ? 'text.secondary' : 'error.main',
                        }}>
                          {d.status === 'ready' ? (d.picks.length ? `${d.picks.length} tagged` : 'Ready') : ANSWER[d.status]}
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                          {d.picks.map(o => (
                            <Box key={o.key} component="button" type="button" disabled={locked}
                              onClick={() => update(d.key, x => ({ picks: x.picks.filter(p => p.key !== o.key) }))}
                              aria-label={`Remove ${o.label}`}
                              sx={{ ...TAG_SX, font: 'inherit', cursor: locked ? 'default' : 'pointer', ...FOCUS_RING }}>
                              <NameText component="span" name={o.label} sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, minWidth: 0 }} />
                              {!locked && <Box component="span" aria-hidden sx={{ fontWeight: 800, color: 'text.secondary', ml: 0.25 }}>×</Box>}
                            </Box>
                          ))}
                        </Box>
                        {!locked && (
                          <Box sx={{ display: 'flex', gap: 1.5, mt: 0.75 }}>
                            <TextLink onClick={() => update(d.key, x => ({ open: !x.open }))}>
                              {d.open ? 'Done' : "Who's in it"}
                            </TextLink>
                            <TextLink onClick={() => drop(d.key)} label={`Remove ${d.file.name}`}>Remove</TextLink>
                          </Box>
                        )}
                      </Box>
                    </Box>
                    {d.open && !locked && (
                      <Box sx={{ mt: 1.25 }}>
                        <SubjectPicker id={`photo-submit-search-${d.key}`} players={players} teams={teams}
                          options={options} optionByKey={optionByKey} teamById={teamById} exclude={pickedKeys}
                          disabled={d.picks.length >= MAX_PICKS}
                          onPick={o => update(d.key, x => (x.picks.length >= MAX_PICKS || x.picks.some(p => p.key === o.key) ? {} : { picks: [...x.picks, o] }))} />
                      </Box>
                    )}
                  </Box>
                )
              })}
            </Box>

            <SectionHeading>Credit</SectionHeading>
            <Box component="input" value={credit} maxLength={60} aria-label="Credit as" placeholder="Your name or handle"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCredit(e.target.value)} sx={FIELD_SX} />

            <SectionHeading>Note</SectionHeading>
            <Box component="textarea" value={note} maxLength={500} rows={3} aria-label="Note to the reviewer"
              placeholder="Optional: the game, the date, anything useful"
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)}
              sx={{ ...FIELD_SX, resize: 'vertical' }} />

            <SectionHeading>Permission</SectionHeading>
            <Box component="label" sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', cursor: 'pointer' }}>
              <Box component="input" type="checkbox" checked={agreed} disabled={!terms}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAgreed(e.target.checked)}
                sx={{ mt: 0.4, width: 18, height: 18, flexShrink: 0, accentColor: 'var(--wpbl-accent-solid)' }} />
              <Typography component="span" sx={{ fontSize: TYPE_SCALE.body, lineHeight: 1.5 }}>
                {terms ? terms.body
                  : terms === null ? "Couldn't load the permission text. Reload the page to try again."
                  : <TextGhost>I took these photos. I give sportydolphin.fun permission to show them on its website, credited to the name I entered.</TextGhost>}
              </Typography>
            </Box>

            <Box sx={{ mt: 2.5 }}>
              <Pill primary onClick={send} disabled={!canSend}>
                {sending ? 'Sending…' : toSend.length > 1 ? `Send ${toSend.length} photos` : 'Send photo'}
              </Pill>
            </Box>
            {notice && (
              <Typography role="status" sx={{ fontSize: TYPE_SCALE.body, mt: 1.25, fontWeight: 600 }}>{notice}</Typography>
            )}

            <SectionHeading>Your submissions</SectionHeading>
            {mine === null ? (
              <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center' }}>
                <ThumbBox src={null} alt="" />
                <Typography sx={{ fontSize: TYPE_SCALE.body }}><TextGhost>Waiting for review</TextGhost></Typography>
              </Box>
            ) : mine.length === 0 ? (
              <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>None yet</Typography>
            ) : (
              <Box sx={{ display: 'grid', gap: 1 }}>
                {mine.map(s => (
                  <Box key={s.id} sx={{ display: 'flex', gap: 1.25, alignItems: 'center' }}>
                    <SubmissionThumb sub={s} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700 }}>{STATUS_LABEL[s.status]}</Typography>
                      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', overflowWrap: 'anywhere' }}>
                        {new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {s.status === 'rejected' && s.reject_reason ? ` · ${s.reject_reason}` : ''}
                      </Typography>
                    </Box>
                    {(s.status === 'pending' || s.status === 'approved') && (
                      <TextLink onClick={() => remove(s)} label={s.status === 'approved' ? 'Take this photo down' : 'Withdraw this photo'}>
                        {s.status === 'approved' ? 'Take down' : 'Withdraw'}
                      </TextLink>
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </>
        )}
      </Box>
    </WpblPage>
  )
}

const TAG_SX = {
  display: 'inline-flex', alignItems: 'center', maxWidth: '100%', px: 1.1, py: 0.4, borderRadius: 999,
  border: '1px solid', borderColor: 'var(--wpbl-accent-fg)', bgcolor: 'background.paper', color: 'text.primary',
} as const
