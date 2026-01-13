import React, { useCallback, useEffect, useState } from 'react'

const measures = [
  'a pound of',
  'a kilogram of',
  '100 grams of',
  'one ton of',
  'a bucket of',
  'a crate of',
  'an interstellar crate of',
]

const items = [
  ['feathers', 'rocks'],
  ['marshmallows', 'bricks'],
  ['confetti', 'lead bars'],
  ['unicorn tears', 'gold bars'],
  ['sour gummy bears', 'anvils'],
  ['puppy cuddles', 'cinderblocks'],
  ['moonbeams', 'planetary cores']
]

function makePair(i: number) {
  const mi = Math.min(i, measures.length - 1)
  const measure = measures[mi]
  const pairItems = items[Math.min(i, items.length - 1)]
  // Shuffle which item goes left/right for variety
  const leftFirst = Math.random() > 0.5
  const left = `${measure} ${leftFirst ? pairItems[0] : pairItems[1]}`
  const right = `${measure} ${leftFirst ? pairItems[1] : pairItems[0]}`
  return [left, right]
}

export default function WeightGame() {
  const [index, setIndex] = useState(0)
  const [pair, setPair] = useState<string[]>(makePair(0))
  const [msg, setMsg] = useState('Choose which is heavier')
  const [isAnimating, setIsAnimating] = useState(false)

  useEffect(() => {
    setPair(makePair(index))
    setMsg('Choose which is heavier')
  }, [index])

  const next = useCallback(() => {
    setIndex(i => i + 1)
    setIsAnimating(false)
  }, [])

  const handleChoice = (side: 0 | 1) => {
    if (isAnimating) return
    setIsAnimating(true)
    setMsg("Incorrect — they weigh the same!")
    // Show the incorrect feedback briefly then move on
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
    <div className="weight-game">
      <h1>Which is heavier?</h1>
      <p className="hint">(First: a pound of feathers vs a pound of rocks)</p>
      <div className="pair-row">
        <button className={`choice ${isAnimating ? 'wrong' : ''}`} onClick={() => handleChoice(0)}>
          <div className="choice-inner">{pair[0]}</div>
          <div className="kbd">1</div>
        </button>
        <button className={`choice ${isAnimating ? 'wrong' : ''}`} onClick={() => handleChoice(1)}>
          <div className="choice-inner">{pair[1]}</div>
          <div className="kbd">2</div>
        </button>
      </div>
      <div className="msg">{msg}</div>
    </div>
  )
}
