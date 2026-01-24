import React, { useCallback, useEffect, useState } from 'react'
import { Box, Typography, Button, Paper } from '@mui/material'

const measures = [
  'a pound of',
  'a kilogram of',
  '100 grams of',
  'one ton of',
  'a bucket of',
  'a crate of',
  'an interstellar crate of',
  'a sack of',
  'a wheelbarrow of',
  'a mountain of'
]

const itemPool = [
  'feathers','rocks','marshmallows','bricks','confetti','lead bars','unicorn tears','gold bars',
  'sour gummy bears','anvils','puppy cuddles','cinderblocks','moonbeams','planetary cores',
  'tofu','steel beams','glitter','cement','bubble wrap','elephants','sand','pebbles','stardust','lava'
]

function randChoice<T>(arr: T[]) { return arr[Math.floor(Math.random() * arr.length)] }

function makePair(_round: number) {
  // choose a random measure (bias to simpler early)
  const measure = Math.random() < 0.6 ? measures[Math.floor(Math.random()*3)] : randChoice(measures)
  // pick two distinct random items
  let a = randChoice(itemPool)
  let b = randChoice(itemPool)
  while (b === a) b = randChoice(itemPool)
  const leftFirst = Math.random() > 0.5
  const left = `${measure} ${leftFirst ? a : b}`
  const right = `${measure} ${leftFirst ? b : a}`
  return [left, right]
}

export default function WeightGame() {
  const [round, setRound] = useState(0)
  const [pair, setPair] = useState<string[]>(makePair(0))
  const [msg, setMsg] = useState('Choose which is heavier')
  const [isAnimating, setIsAnimating] = useState(false)
  const [total, setTotal] = useState(() => {
    try {
      const v = localStorage.getItem('weights_total')
      return v ? parseInt(v, 10) : 0
    } catch (e) { return 0 }
  })
  const [correct, setCorrect] = useState(0) // will stay 0 in this trick game
  const [explain, setExplain] = useState<string | null>(null)

  useEffect(() => {
    setPair(makePair(round))
    setMsg('Choose which is heavier')
    // occasionally show an explanation after certain rounds
    if (round > 0 && (round === 2 || round === 5 || round === 9)) {
      const notes = [
        'Trick question: equal weights can still be surprising!',
        'Remember: a pound is a pound, however outrageous the container.',
        'The universe is fair... sometimes.'
      ]
      setExplain(notes[Math.floor(Math.random() * notes.length)])
    } else {
      setExplain(null)
    }
  }, [round])

  const next = useCallback(() => {
    setRound(r => r + 1)
    setIsAnimating(false)
  }, [])

  const handleChoice = (side: 0 | 1) => {
    if (isAnimating) return
    setIsAnimating(true)
    setTotal(t => {
      const next = t + 1
      try { localStorage.setItem('weights_total', String(next)) } catch (e) {}
      return next
    })
    // always incorrect for fun
    setMsg("Incorrect — they weigh the same!")
    // brief animation then progress
    setTimeout(() => {
      next()
    }, 900)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '1') handleChoice(0)
      if (e.key === '2') handleChoice(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isAnimating])

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="h1">
          Which is heavier?
        </Typography>
        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="body2">
            Total rounds: <strong>{total}</strong>
          </Typography>
          <Typography variant="body2">
            Correct: <strong>{correct}</strong>
          </Typography>
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        (First: a pound of feathers vs a pound of rocks)
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <Button
          variant="outlined"
          onClick={() => handleChoice(0)}
          disabled={isAnimating}
          sx={{ flex: 1, p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >
          <Typography variant="body1">{pair[0]}</Typography>
          <Typography variant="caption" sx={{ mt: 1 }}>1</Typography>
        </Button>
        <Button
          variant="outlined"
          onClick={() => handleChoice(1)}
          disabled={isAnimating}
          sx={{ flex: 1, p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >
          <Typography variant="body1">{pair[1]}</Typography>
          <Typography variant="caption" sx={{ mt: 1 }}>2</Typography>
        </Button>
      </Box>
      <Typography variant="body1" sx={{ mb: 1 }}>
        {msg}
      </Typography>
      {explain && (
        <Typography variant="body2" color="text.secondary">
          {explain}
        </Typography>
      )}
    </Box>
  )
}
