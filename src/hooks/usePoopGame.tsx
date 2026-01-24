import { useEffect, useRef, useState } from 'react'
import { BOWEL_TIERS, holdCost } from '../constants'

export function usePoopGame() {
  const [count, setCount] = useState(() => {
    try {
      const raw = localStorage.getItem('poop_count')
      return raw ? parseInt(raw, 10) : 0
    } catch (e) { return 0 }
  })

  const [critChance, setCritChance] = useState(() => {
    try { const raw = localStorage.getItem('poop_crit'); return raw ? parseInt(raw,10) : 0 } catch (e) { return 0 }
  })
  const [critCost, setCritCost] = useState(() => {
    try { const raw = localStorage.getItem('poop_crit_cost'); return raw ? parseInt(raw,10) : 10 } catch (e) { return 10 }
  })
  const [diarrheaBoys, setDiarrheaBoys] = useState(() => {
    try { const raw = localStorage.getItem('poop_diarrhea_boys'); return raw ? parseInt(raw,10) : 0 } catch (e) { return 0 }
  })
  const [diarrheaCost, setDiarrheaCost] = useState(() => {
    try { const raw = localStorage.getItem('poop_diarrhea_cost'); return raw ? parseInt(raw,10) : 50 } catch (e) { return 50 }
  })
  const [holdEnabled, setHoldEnabled] = useState(() => {
    try { const raw = localStorage.getItem('poop_hold'); return raw === '1' } catch (e) { return false }
  })
  const [holdSpeed, setHoldSpeed] = useState(() => {
    try { const raw = localStorage.getItem('poop_hold_speed'); return raw ? parseInt(raw, 10) : 1 } catch (e) { return 1 }
  })

  const [bowelTier, setBowelTier] = useState(() => {
    try { const raw = localStorage.getItem('poop_bowel_tier'); return raw ? parseInt(raw, 10) : 0 } catch (e) { return 0 }
  })

  const [lastGain, setLastGain] = useState<number | null>(null)
  const [lastWasCrit, setLastWasCrit] = useState(false)
  const [flyingPoops, setFlyingPoops] = useState<Array<{id: number, left: number, delay: number}>>([])
  const flyingIdRef = useRef(0)

  // Persistence
  useEffect(() => { try { localStorage.setItem('poop_count', String(count)) } catch (e) {} }, [count])
  useEffect(() => { try { localStorage.setItem('poop_crit', String(critChance)) } catch (e) {} }, [critChance])
  useEffect(() => { try { localStorage.setItem('poop_crit_cost', String(critCost)) } catch (e) {} }, [critCost])
  useEffect(() => { try { localStorage.setItem('poop_diarrhea_boys', String(diarrheaBoys)) } catch (e) {} }, [diarrheaBoys])
  useEffect(() => { try { localStorage.setItem('poop_diarrhea_cost', String(diarrheaCost)) } catch (e) {} }, [diarrheaCost])
  useEffect(() => { try { localStorage.setItem('poop_hold', holdEnabled ? '1' : '0') } catch (e) {} }, [holdEnabled])
  useEffect(() => { try { localStorage.setItem('poop_bowel_tier', String(bowelTier)) } catch (e) {} }, [bowelTier])
  useEffect(() => { try { localStorage.setItem('poop_hold_speed', String(holdSpeed)) } catch (e) {} }, [holdSpeed])

  // Intervals
  const holdInterval = useRef<number | null>(null)
  const diarrheaInterval = useRef<number | null>(null)
  const spaceHeld = useRef(false)
  const pressTimer = useRef<number | null>(null)

  function stopHold() {
    if (holdInterval.current) {
      window.clearInterval(holdInterval.current)
      holdInterval.current = null
    }
  }
  function startHold() {
    if (holdInterval.current) return
    holdInterval.current = window.setInterval(() => addPoopSingle(), 1000 / holdSpeed)
  }

  useEffect(() => {
    // If we're currently holding and holdSpeed changed, restart the interval with new speed
    if (holdInterval.current !== null) {
      stopHold()
      startHold()
    }
  }, [holdSpeed])

  useEffect(() => {
    if (diarrheaBoys > 0) {
      diarrheaInterval.current = window.setInterval(() => {
        setCount(c => c + diarrheaBoys)
      }, 1000)
    } else {
      if (diarrheaInterval.current) {
        window.clearInterval(diarrheaInterval.current)
        diarrheaInterval.current = null
      }
    }
    return () => {
      if (diarrheaInterval.current) {
        window.clearInterval(diarrheaInterval.current)
      }
    }
  }, [diarrheaBoys])

  function addPoopSingle() {
    const base = bowelTier + 1
    const roll = Math.random() < (critChance / 100)
    const gain = roll ? base * 10 : base
    setCount(c => c + gain)
    setLastGain(gain)
    setLastWasCrit(roll)
    
    // Create flying poop emojis
    const newFlying = Array.from({ length: gain }, (_, i) => ({
      id: flyingIdRef.current++,
      left: Math.random() * 80 - 40, // random offset from button
      delay: i * 30 // stagger the animation
    }))
    setFlyingPoops(prev => [...prev, ...newFlying])
    
    // Remove flying poops after animation
    newFlying.forEach(poop => {
      setTimeout(() => {
        setFlyingPoops(prev => prev.filter(p => p.id !== poop.id))
      }, 800 + poop.delay)
    })
    
    setTimeout(() => setLastGain(null), 700)
  }

  function addPoop() {
    addPoopSingle()
  }

  // Keyboard handling
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' || e.key === ' ') {
        if (spaceHeld.current) return
        spaceHeld.current = true
        if (pressTimer.current !== null) {
          // Don't trigger hold if a click press timer is active
          return
        }
        if (holdEnabled) {
          startHold()
        }
        e.preventDefault()
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space' || e.key === ' ') {
        spaceHeld.current = false
        if (holdInterval.current) {
          stopHold()
        } else if (pressTimer.current === null) {
          // Only do single poop if no click timer is active
          addPoop()
        }
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [holdEnabled])

  function reset() {
    setCount(0)
    setCritChance(0)
    setCritCost(10)
    setDiarrheaBoys(0)
    setDiarrheaCost(50)
    setHoldEnabled(false)
    setBowelTier(0)
    setHoldSpeed(1)
    try {
      localStorage.removeItem('poop_count')
      localStorage.removeItem('poop_crit')
      localStorage.removeItem('poop_crit_cost')
      localStorage.removeItem('poop_diarrhea_boys')
      localStorage.removeItem('poop_diarrhea_cost')
      localStorage.removeItem('poop_hold')
      localStorage.removeItem('poop_bowel_tier')
      localStorage.removeItem('poop_hold_speed')
    } catch (e) {}
  }

  function buyCrit() {
    if (count < critCost) return
    setCount(c => c - critCost)
    setCritChance(p => p + 1)
    setCritCost(c => c * 2)
  }
  function buyDiarrheaBoy() {
    if (count < diarrheaCost) return
    setCount(c => c - diarrheaCost)
    setDiarrheaBoys(b => b + 1)
    setDiarrheaCost(c => c + 50)
  }
  function buyHold() {
    if (count < holdCost) return
    setCount(c => c - holdCost)
    setHoldEnabled(true)
  }
  function buyHoldSpeed() {
    const cost = holdSpeedCostFor(bowelTier)
    if (count < cost) return
    setCount(c => c - cost)
    setHoldSpeed(s => s + 1)
  }
  function buyBowelTier() {
    const next = bowelTier + 1
    if (next >= BOWEL_TIERS.length) return
    const cost = nextTierCostFor(bowelTier)
    if (count < cost) return
    setCount(c => c - cost)
    setBowelTier(next)
  }

  function nextTierCostFor(tierIndex: number) {
    return 1000 * Math.pow(10, tierIndex)
  }

  function holdSpeedCostFor(tierIndex: number) {
    return nextTierCostFor(tierIndex) / 2
  }

  const emojiCount = Math.min(count, 10000)
  const pile = Array.from({ length: emojiCount }, (_, i) => (
    <span key={i} className="poop-emoji" style={{fontSize: 20, margin: 2}}>💩</span>
  ))

  return {
    count,
    critChance,
    critCost,
    diarrheaBoys,
    diarrheaCost,
    holdEnabled,
    holdSpeed,
    bowelTier,
    lastGain,
    lastWasCrit,
    flyingPoops,
    pile,
    addPoop,
    reset,
    buyCrit,
    buyDiarrheaBoy,
    buyHold,
    buyHoldSpeed,
    buyBowelTier,
    nextTierCostFor,
    holdSpeedCostFor,
    holdCost,
    BOWEL_TIERS,
    startHold,
    stopHold,
    setCount,
  }
}