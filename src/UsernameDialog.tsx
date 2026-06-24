import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Typography, Box, CircularProgress,
} from '@mui/material'
import { CheckCircle, Cancel } from '@mui/icons-material'
import { supabase } from './lib/supabase'
import { USERNAME_RE as VALID_RE, usernameValidationMsg as validationMsg } from './lib/usernames'

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  open:            boolean
  onClose:         () => void
  userId:          string
  currentUsername: string | null
  onSaved:         (username: string) => void
}

export function UsernameDialog({ open, onClose, userId, currentUsername, onSaved }: Props) {
  const [input,   setInput]   = useState('')
  const [status,  setStatus]  = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
  const [saving,  setSaving]  = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setInput(currentUsername ?? '')
      setStatus('idle')
      setSaveErr('')
    }
  }, [open, currentUsername])

  const checkAvailability = useCallback(async (val: string) => {
    const { data } = await supabase
      .from('usernames')
      .select('user_id')
      .eq('username', val)
      .maybeSingle()
    // If the row belongs to this user it's fine (they're keeping their own name)
    if (data && data.user_id !== userId) {
      setStatus('taken')
    } else {
      setStatus('available')
    }
  }, [userId])

  const handleChange = useCallback((val: string) => {
    setInput(val)
    setSaveErr('')
    clearTimeout(debounceRef.current)

    const err = validationMsg(val)
    if (err) { setStatus('invalid'); return }

    if (val === currentUsername) { setStatus('idle'); return }

    setStatus('checking')
    debounceRef.current = setTimeout(() => checkAvailability(val), 450)
  }, [currentUsername, checkAvailability])

  const handleSave = async () => {
    if (!VALID_RE.test(input) || status === 'taken' || status === 'checking') return
    setSaving(true)
    setSaveErr('')

    const { error } = await supabase
      .from('usernames')
      .upsert({ user_id: userId, username: input }, { onConflict: 'user_id' })

    setSaving(false)

    if (error) {
      // Unique violation — race condition where someone grabbed it just before us
      if (error.code === '23505') {
        setStatus('taken')
      } else {
        setSaveErr(error.message)
      }
    } else {
      onSaved(input)
      onClose()
    }
  }

  // ── Status indicator ───────────────────────────────────────────────────────

  const fmtErr  = validationMsg(input)
  const canSave = VALID_RE.test(input) && status === 'available' && !saving
  const isUnchanged = input === currentUsername

  let helperText: React.ReactNode = ' '
  if (fmtErr && input.length > 0) {
    helperText = fmtErr
  } else if (status === 'checking') {
    helperText = (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        <CircularProgress size={10} /> Checking…
      </Box>
    )
  } else if (status === 'available') {
    helperText = (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'success.main' }}>
        <CheckCircle sx={{ fontSize: '0.85rem' }} /> Available
      </Box>
    )
  } else if (status === 'taken') {
    helperText = (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'error.main' }}>
        <Cancel sx={{ fontSize: '0.85rem' }} /> Already taken
      </Box>
    )
  } else if (saveErr) {
    helperText = saveErr
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>
        {currentUsername ? 'Change username' : 'Set a username'}
      </DialogTitle>

      <DialogContent sx={{ pt: '8px !important' }}>
        <TextField
          autoFocus fullWidth
          label="Username"
          value={input}
          onChange={e => handleChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && canSave) handleSave() }}
          inputProps={{ spellCheck: false, autoCapitalize: 'none', autoCorrect: 'off' }}
          InputProps={{
            startAdornment: (
              <Typography sx={{ color: 'text.disabled', mr: 0.25, fontSize: '1rem', lineHeight: 1, userSelect: 'none' }}>@</Typography>
            ),
          }}
          error={status === 'taken' || (!!fmtErr && input.length > 0)}
          helperText={helperText}
          FormHelperTextProps={{ component: 'div' } as object}
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>{currentUsername ? 'Cancel' : 'Skip for now'}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!canSave || isUnchanged}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
