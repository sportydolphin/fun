import React from 'react'
import { Dialog, DialogContent, Box, Typography, Button } from '@mui/material'
import { BlockOutlined } from '@mui/icons-material'

// Shown when a signed-in account has been deactivated by the site owner (the
// is_deleted flag on their usernames row). The session has already been signed out
// by the caller; this just explains why. Not dismissable to a working app — the only
// action is to acknowledge.

export function DeactivatedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogContent sx={{ px: 3, py: 3.5, textAlign: 'center' }}>
        <Box sx={{
          width: 52, height: 52, borderRadius: '50%', mx: 'auto', mb: 1.75,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: 'error.main', color: 'error.contrastText',
        }}>
          <BlockOutlined sx={{ fontSize: '1.7rem' }} />
        </Box>

        <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, mb: 1 }}>
          Account deactivated
        </Typography>
        <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', lineHeight: 1.5, mb: 2.5 }}>
          This account has been deactivated and can no longer sign in. If you think this
          is a mistake, reach out through the feedback link in the site footer.
        </Typography>

        <Button variant="contained" onClick={onClose}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, px: 3 }}>
          OK
        </Button>
      </DialogContent>
    </Dialog>
  )
}
