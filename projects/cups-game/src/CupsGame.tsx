import React, { useEffect, useState, useCallback } from 'react'
import { Box, Typography, Button, Card, CardContent } from '@mui/material'
import '../styles.css'

type Cup = { width: number; height: number; fill: number; water: number }

function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min }
function randFloat(min: number, max: number) { return Math.random() * (max - min) + min }

function makeCup(): Cup {
  const width = rand(80, 160)
  const height = rand(140, 300)
  const fill = Math.round(randFloat(0.08, 0.96) * 100) / 100
  const water = width * height * fill
  return { width, height, fill, water }
}

function makePairForStreak(streak: number): [Cup, Cup] {
  // Start easy (bigger relative differences) and make it harder as streak increases
  const baseMinRatio = 0.25 // 25% difference at streak=0
  const decreasePerStreak = 0.03
  const minRatio = Math.max(0.02, baseMinRatio - decreasePerStreak * streak)
  let attempts = 0
  while (true) {
    const a = makeCup()
    const b = makeCup()
    const rel = Math.abs(a.water - b.water) / Math.max(a.water, b.water)
    if (rel >= minRatio) return [a, b]
    attempts++
    if (attempts > 200) return [a, b]
  }
}

function renderCupElement(cup: Cup) {
  return (
    <Card sx={{ minWidth: 120, height: 400 }}>
      <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', textAlign: 'center' }}>
        <Box sx={{ position: 'relative', mx: 'auto', width: cup.width, height: cup.height, border: 1, borderTop: 0, borderColor: 'grey.300', borderRadius: 1, overflow: 'hidden' }}>
          <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${cup.fill * 100}%`, bgcolor: 'primary.main' }} />
        </Box>
        <Typography variant="body2" sx={{ mt: 1 }}>
          {Math.round(cup.fill * 100)}% filled
        </Typography>
      </CardContent>
    </Card>
  )
}

export default function CupsGame() {
  const [pair, setPair] = useState<[Cup, Cup] | null>(null)
  const [streak, setStreak] = useState(0)
  const [message, setMessage] = useState('')
  const [disabled, setDisabled] = useState(false)
  const [feedback, setFeedback] = useState<{ correct: 0 | 1 | null, incorrect: 0 | 1 | null }>({ correct: null, incorrect: null })
  const [result, setResult] = useState<{ correct: 0 | 1 | null, chosen: 0 | 1 | null }>({ correct: null, chosen: null })

  function pickPairFor(streakValue: number) {
    const newPair = makePairForStreak(streakValue)
    setPair(newPair)
    setMessage('')
    setDisabled(false)
    setFeedback({ correct: null, incorrect: null })
    setResult({ correct: null, chosen: null })
  }

  useEffect(() => {
    // initial pair on mount
    pickPairFor(streak)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChoice = (side: 0 | 1) => {
    if (!pair || disabled) return
    const [cup0, cup1] = pair
    const correct = cup0.water > cup1.water ? 0 : 1
    setResult({ correct, chosen: side })
    setDisabled(true)
    if (side === correct) {
      setMessage('Correct — next pair!')
      // increment streak and schedule next pair using the new streak value
      setStreak(prev => {
        const next = prev + 1
        setTimeout(() => {
          setResult({ correct: null, chosen: null })
          pickPairFor(next)
        }, 1000)
        return next
      })
    } else {
      setMessage(`Wrong — final streak ${streak}. Click Restart to try again.`)
      setTimeout(() => {
        setResult({ correct: null, chosen: null })
        setPair(null)
      }, 1000)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pair || disabled) return
      if (e.key === '1') handleChoice(0)
      if (e.key === '2') handleChoice(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pair, disabled])

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="body1" sx={{ mb: 2, textAlign: 'center' }}>
        Streak: <strong>{streak}</strong>
      </Typography>
      <Box sx={{ textAlign: 'center', mb: 2 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Cups Compare
        </Typography>
        <Typography variant="body1" gutterBottom>
          Pick the cup which has more water. Keep going until you make a mistake.
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, mb: 2, maxWidth: 500, mx: 'auto' }}>
        <Box
          sx={{
            flex: 1,
            p: 2,
            border: 1,
            borderColor: pair ? 'primary.main' : 'grey.300',
            borderRadius: 1,
            cursor: pair ? 'pointer' : 'default',
            bgcolor:
              result.correct === 0 && result.chosen !== null
                ? 'success.main'
                : result.chosen === 0 && result.correct !== 0 && result.chosen !== null
                ? 'error.main'
                : undefined,
            '&:hover': pair ? { bgcolor: 'action.hover' } : {},
          }}
          role="button"
          tabIndex={0}
          aria-label="Left cup"
          onClick={() => handleChoice(0)}
        >
          {pair ? renderCupElement(pair[0]) : <Typography>No cup</Typography>}
        </Box>
        <Box
          sx={{
            flex: 1,
            p: 2,
            border: 1,
            borderColor: pair ? 'primary.main' : 'grey.300',
            borderRadius: 1,
            cursor: pair ? 'pointer' : 'default',
            bgcolor:
              result.correct === 1 && result.chosen !== null
                ? 'success.main'
                : result.chosen === 1 && result.correct !== 1 && result.chosen !== null
                ? 'error.main'
                : undefined,
            '&:hover': pair ? { bgcolor: 'action.hover' } : {},
          }}
          role="button"
          tabIndex={0}
          aria-label="Right cup"
          onClick={() => handleChoice(1)}
        >
          {pair ? renderCupElement(pair[1]) : <Typography>No cup</Typography>}
        </Box>
      </Box>
      <Typography variant="body1" aria-live="polite" sx={{ mb: 2, textAlign: 'center' }}>
        {message}
      </Typography>
      <Box sx={{ textAlign: 'center' }}>
        <Button variant="outlined" onClick={() => { setStreak(0); pickPairFor(0) }}>
          Restart
        </Button>
      </Box>
    </Box>
  )
}
