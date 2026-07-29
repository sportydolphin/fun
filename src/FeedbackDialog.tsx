import React, { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Typography, Box, CircularProgress,
} from '@mui/material'
import { submitFeedback } from './lib/feedback'

const MAX_LEN = 2000

// A short "leave a note" box, opened from the site footer. Message required,
// email optional (prefilled when signed in). Writes to the Supabase `feedback`
// table via submitFeedback; shows a thank-you state on success.
export function FeedbackDialog({ open, onClose, userId, userEmail }: {
  open: boolean
  onClose: () => void
  userId?: string | null
  userEmail?: string | null
}) {
  const [message, setMessage] = useState('')
  const [email, setEmail]     = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState(false)
  const [failed, setFailed]   = useState(false)

  // Reset each time the dialog opens; prefill email from the signed-in account.
  useEffect(() => {
    if (open) {
      setMessage('')
      setEmail(userEmail ?? '')
      setSending(false)
      setSent(false)
      setFailed(false)
    }
  }, [open, userEmail])

  const canSend = message.trim().length > 0 && !sending

  const handleSend = async () => {
    if (!canSend) return
    setSending(true)
    setFailed(false)
    const ok = await submitFeedback({ message, email, userId })
    setSending(false)
    if (ok) {
      setSent(true)
      setTimeout(onClose, 1400)
    } else {
      setFailed(true)
    }
  }

  return (
    <Dialog open={open} onClose={sending ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Send feedback</DialogTitle>
      <DialogContent>
        {sent ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '2rem', mb: 1 }}>🙏</Typography>
            <Typography sx={{ fontWeight: 700 }}>Thanks, got it.</Typography>
            <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mt: 0.5 }}>
              Every note gets read.
            </Typography>
          </Box>
        ) : (
          <>
            <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', mb: 2 }}>
              Found a bug, or have an idea for the site? Tell me about it.
            </Typography>
            <TextField
              autoFocus
              multiline
              minRows={4}
              maxRows={10}
              fullWidth
              placeholder="What's on your mind?"
              value={message}
              onChange={e => setMessage(e.target.value.slice(0, MAX_LEN))}
              disabled={sending}
            />
            <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', textAlign: 'right', mt: 0.5 }}>
              {message.length} / {MAX_LEN}
            </Typography>
            <TextField
              fullWidth
              size="small"
              label="Email (optional, if you want a reply)"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={sending}
              sx={{ mt: 1 }}
            />
            {failed && (
              <Typography sx={{ fontSize: '0.78rem', color: 'error.main', mt: 1.5 }}>
                Something went wrong sending that. You can also email snichols246@gmail.com.
              </Typography>
            )}
          </>
        )}
      </DialogContent>
      {!sent && (
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={sending} sx={{ color: 'text.secondary' }}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={!canSend}
            variant="contained"
            startIcon={sending ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {sending ? 'Sending' : 'Send'}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  )
}
