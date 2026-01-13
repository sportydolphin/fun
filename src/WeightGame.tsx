import React, { useCallback, useEffect, useState } from 'react'

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
  const [total, setTotal] = useState(0)
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
    setTotal(t => t + 1)
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
    <div className="weight-game">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h1>Which is heavier?</h1>
        <div style={{textAlign:'right'}}>
          <div>Total rounds: <strong>{total}</strong></div>
          <div>Correct: <strong>{correct}</strong></div>
        </div>
      </div>
      <p className="hint">(First: a pound of feathers vs a pound of rocks)</p>
      <div className="pair-row">
        <button aria-label="choice-1" className={`choice ${isAnimating ? 'wrong' : ''}`} onClick={() => handleChoice(0)}>
          <div className="choice-inner">{pair[0]}</div>
          <div className="kbd">1</div>
        </button>
        <button aria-label="choice-2" className={`choice ${isAnimating ? 'wrong' : ''}`} onClick={() => handleChoice(1)}>
          <div className="choice-inner">{pair[1]}</div>
          <div className="kbd">2</div>
        </button>
      </div>
      <div className="msg">{msg}</div>
      {explain && <div className="explain">{explain}</div>}
    </div>
  )
}
