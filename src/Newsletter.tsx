import React, { useState } from 'react'
import { Box, Typography, TextField, Button } from '@mui/material'

export default function Newsletter() {
  const [email, setEmail] = useState('')
  const [pressed, setPressed] = useState(false)

  function handleSign() {
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <Box>
        <Typography variant="h5" component="h2" gutterBottom>
          Join the fun
        </Typography>
        <Typography variant="body1" gutterBottom>
          Get occasional updates and new games — no spam.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            label="Email address"
            variant="outlined"
            size="small"
          />
          <Button
            variant="outlined"
            onMouseDown={() => setPressed(true)}
            onMouseUp={() => setPressed(false)}
            onMouseLeave={() => setPressed(false)}
            onTouchStart={() => setPressed(true)}
            onTouchEnd={() => setPressed(false)}
            onClick={handleSign}
          >
            Sign up
          </Button>
        </Box>
      </Box>

      <Box aria-hidden>
        <svg width="120" height="120" viewBox="0 0 100 100">
          <rect x="6" y="6" width="88" height="88" rx="12" fill="#ef4444" stroke="#8b0000" strokeWidth="3" />
          <text x="50" y="58" textAnchor="middle" fontSize="28" fontWeight="700" fill="#fff">
            {pressed ? 'UP' : 'STOP'}
          </text>
        </svg>
      </Box>
    </Box>
  )
}
