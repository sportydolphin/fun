import { useEffect, useRef, useState } from 'react'
import ReactCrop, { centerCrop, makeAspectCrop, type PercentCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { Box, Typography, CircularProgress } from '@mui/material'
import { supabase } from '../lib/supabase'
import { updateFanPhoto, type WpblFanPhotoRow } from './api'
import { fetchRender, renderCrop, newCropVariant, originalRenders, uploadPreparedPhoto } from './fanPhotoUpload'

// Tag mode's crop step. Lazy-loaded from AdminPhotos, so the crop library and its stylesheet only
// reach the one person who presses Crop.
//
// It always cuts from the UNCROPPED original (see originalRenders), never from the current render,
// so cropping twice does not crop a crop and lose resolution each time, and "Reset" can always get
// back to the whole photograph.

const ASPECTS: Array<{ label: string; value: number | undefined }> = [
  { label: 'Free', value: undefined },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
]

const WHOLE: PercentCrop = { unit: '%', x: 0, y: 0, width: 100, height: 100 }

function Pill({ label, active = false, primary = false, disabled = false, onClick }: {
  label: string; active?: boolean; primary?: boolean; disabled?: boolean; onClick: () => void
}) {
  return (
    <Box onClick={() => { if (!disabled) onClick() }} role="button" tabIndex={0}
      onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick() } }}
      sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: { xs: 40, sm: 0 }, px: 1.6, py: 0.5, borderRadius: 999, userSelect: 'none',
        fontSize: '0.78rem', fontWeight: 800, border: '1px solid',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        borderColor: primary || active ? 'primary.main' : 'divider',
        bgcolor: primary ? 'primary.main' : active ? 'action.selected' : 'background.paper',
        color: primary ? '#fff' : active ? 'text.primary' : 'text.secondary',
      }}>{label}</Box>
  )
}

export default function PhotoCropper({ photo, onDone, onCancel }: {
  photo: WpblFanPhotoRow
  onDone: () => void
  onCancel: () => void
}) {
  const orig = originalRenders(photo)
  const origFull = orig?.full ?? null
  const [src, setSrc] = useState<{ blob: Blob; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [crop, setCrop] = useState<PercentCrop>(WHOLE)
  const [aspect, setAspect] = useState<number | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    if (!origFull) { setError('This photo has no stored original to crop from.'); return }
    let live = true
    let url = ''
    fetchRender(origFull)
      .then(blob => { if (!live) return; url = URL.createObjectURL(blob); setSrc({ blob, url }) })
      .catch(e => { if (live) setError((e as Error).message) })
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [origFull])

  const natural = () => {
    const img = imgRef.current
    return img ? { w: img.naturalWidth, h: img.naturalHeight } : null
  }

  const chooseAspect = (a: number | undefined) => {
    setAspect(a)
    const n = natural()
    if (!n) return
    setCrop(a ? centerCrop(makeAspectCrop({ unit: '%', width: 90 }, a, n.w, n.h), n.w, n.h) : WHOLE)
  }

  const isCropped = !!orig && photo.full_url !== orig.full
  const isWhole = crop.x <= 0.01 && crop.y <= 0.01 && crop.width >= 99.99 && crop.height >= 99.99

  const withToken = async (): Promise<string> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Not signed in')
    return token
  }

  const save = async () => {
    const n = natural()
    if (!src || !n || saving) return
    setSaving(true); setError(null)
    try {
      const px = {
        x: (crop.x / 100) * n.w, y: (crop.y / 100) * n.h,
        width: (crop.width / 100) * n.w, height: (crop.height / 100) * n.h,
      }
      const rendered = await renderCrop(src.blob, px)
      const loc = await uploadPreparedPhoto({ sha256: photo.sha256, ...rendered }, await withToken(), newCropVariant())
      const ok = await updateFanPhoto(photo.id, {
        card_url: loc.card_url, full_url: loc.full_url, width: rendered.width, height: rendered.height,
      })
      if (!ok) throw new Error('Saved the crop but could not update the photo')
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  // Back to the whole photograph: a pointer change, since the original renders never moved.
  const reset = async () => {
    const n = natural()
    if (!orig || !n || saving) return
    setSaving(true); setError(null)
    const ok = await updateFanPhoto(photo.id, { card_url: orig.card, full_url: orig.full, width: n.w, height: n.h })
    if (ok) onDone()
    else { setError('Could not reset the crop'); setSaving(false) }
  }

  return (
    <>
      <Box sx={{
        bgcolor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: { xs: '48vh', md: '62vh' }, flexShrink: 0,
        '& .ReactCrop__image': { maxHeight: { xs: '48vh', md: '62vh' }, maxWidth: '100%', display: 'block' },
      }}>
        {src ? (
          <ReactCrop crop={crop} aspect={aspect} keepSelection minWidth={24} minHeight={24}
            onChange={(_px, pc) => setCrop(pc)}>
            <img ref={imgRef} src={src.url} alt="Crop preview" />
          </ReactCrop>
        ) : error ? null : (
          <CircularProgress size={24} sx={{ color: '#fff' }} />
        )}
      </Box>

      <Box sx={{
        width: '100%', maxWidth: 720, mx: 'auto', p: { xs: 1.5, sm: 2 },
        display: 'flex', flexDirection: 'column', gap: 1.2,
      }}>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>
          Drag the corners to crop. The original is kept, so you can reset or re-crop later.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
          {ASPECTS.map(a => (
            <Pill key={a.label} label={a.label} active={aspect === a.value} onClick={() => chooseAspect(a.value)} />
          ))}
        </Box>
        {error && <Typography sx={{ fontSize: '0.74rem', color: 'error.main' }}>{error}</Typography>}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <Pill label="Cancel" onClick={onCancel} disabled={saving} />
          {isCropped && <Pill label="Reset to original" onClick={reset} disabled={saving || !src} />}
          <Box sx={{ flex: 1 }} />
          {saving && <CircularProgress size={16} />}
          <Pill label="Save crop" primary onClick={save} disabled={saving || !src || isWhole} />
        </Box>
      </Box>
    </>
  )
}
