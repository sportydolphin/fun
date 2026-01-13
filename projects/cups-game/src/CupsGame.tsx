import React, { useEffect, useState, useCallback } from 'react'
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
    <div className="cup-card">
      <div className="cup" style={{ width: cup.width, height: cup.height }}>
        <div className="water" style={{ height: `${cup.fill * 100}%` }} />
      </div>
      <div className="label">{Math.round(cup.fill * 100)}% filled</div>
    </div>
  )
}

export default function CupsGame() {
  const [pair, setPair] = useState<[Cup, Cup] | null>(null)
  const [streak, setStreak] = useState(0)
  const [message, setMessage] = useState('')
  const [disabled, setDisabled] = useState(false)

  function pickPairFor(streakValue: number) {
    const newPair = makePairForStreak(streakValue)
    setPair(newPair)
    setMessage('')
    setDisabled(false)
  }

  useEffect(() => {
    // initial pair on mount
    pickPairFor(streak)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChoice = (side: 0 | 1) => {
    if (!pair || disabled) return
    const chosen = pair[side]
    const other = pair[side === 0 ? 1 : 0]
    const correct = chosen.water > other.water
    setDisabled(true)
    if (correct) {
      setMessage('Correct — next pair!')
      // increment streak and schedule next pair using the new streak value
      setStreak(prev => {
        const next = prev + 1
        setTimeout(() => pickPairFor(next), 700)
        return next
      })
    } else {
      setMessage(`Wrong — final streak ${streak}. Click Restart to try again.`)
      setPair(null)
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
    <div>
      <h1>Cups Compare</h1>
      <p>Pick the cup which has more water. Keep going until you make a mistake.</p>
      <div id="status">Streak: <strong>{streak}</strong></div>
      <div className="game">
        <div
          className={`cup-slot ${pair ? '' : 'disabled'}`}
          role="button"
          tabIndex={0}
          aria-label="Left cup"
          onClick={() => handleChoice(0)}
        >
          {pair ? renderCupElement(pair[0]) : null}
        </div>
        <div
          className={`cup-slot ${pair ? '' : 'disabled'}`}
          role="button"
          tabIndex={0}
          aria-label="Right cup"
          onClick={() => handleChoice(1)}
        >
          {pair ? renderCupElement(pair[1]) : null}
        </div>
      </div>
      <div id="message" aria-live="polite">{message}</div>
      <div style={{ marginTop: 12 }}>
        <button onClick={() => { setStreak(0); pickPair() }}>Restart</button>
      </div>
    </div>
  )
}
