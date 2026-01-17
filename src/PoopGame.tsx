import React, { useEffect, useState, useRef } from 'react'

export default function PoopGame() {
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
  const [holdEnabled, setHoldEnabled] = useState(() => {
    try { const raw = localStorage.getItem('poop_hold'); return raw === '1' } catch (e) { return false }
  })
  const holdCost = 100
  const [holdSpeed, setHoldSpeed] = useState(() => {
    try { const raw = localStorage.getItem('poop_hold_speed'); return raw ? parseInt(raw, 10) : 1 } catch (e) { return 1 }
  })
  function holdSpeedCostFor(tierIndex: number) {
    return nextTierCostFor(tierIndex) / 2
  }

  const BOWEL_TIERS = [
    { name: 'Paper Bowels', color: '#e6e6e6', emoji: '🧻' },
    { name: 'Wood Bowels', color: '#c18f5d', emoji: '🪵' },
    { name: 'Stone Bowels', color: '#9ca3af', emoji: '🪨' },
    { name: 'Iron Bowels', color: '#9aa6b2', emoji: '⛓️' },
    { name: 'Golden Bowels', color: '#fbbf24', emoji: '🪙' },
    { name: 'Diamond Bowels', color: '#60a5fa', emoji: '💎' },
  ]

  const [bowelTier, setBowelTier] = useState(() => {
    try { const raw = localStorage.getItem('poop_bowel_tier'); return raw ? parseInt(raw, 10) : 0 } catch (e) { return 0 }
  })

  function nextTierCostFor(tierIndex: number) {
    return 1000 * Math.pow(10, tierIndex)
  }

  const [lastGain, setLastGain] = useState<number | null>(null)
  const [lastWasCrit, setLastWasCrit] = useState(false)
  const [flyingPoops, setFlyingPoops] = useState<Array<{id: number, left: number, delay: number}>>([])
  const poopButtonRef = useRef<HTMLButtonElement>(null)
  const flyingIdRef = useRef(0)

  useEffect(() => { try { localStorage.setItem('poop_count', String(count)) } catch (e) {} }, [count])
  useEffect(() => { try { localStorage.setItem('poop_crit', String(critChance)) } catch (e) {} }, [critChance])
  useEffect(() => { try { localStorage.setItem('poop_crit_cost', String(critCost)) } catch (e) {} }, [critCost])
  useEffect(() => { try { localStorage.setItem('poop_hold', holdEnabled ? '1' : '0') } catch (e) {} }, [holdEnabled])
  useEffect(() => { try { localStorage.setItem('poop_bowel_tier', String(bowelTier)) } catch (e) {} }, [bowelTier])
  useEffect(() => { try { localStorage.setItem('poop_hold_speed', String(holdSpeed)) } catch (e) {} }, [holdSpeed])

  const holdInterval = useRef<number | null>(null)
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

  useEffect(() => {
    // If we're currently holding and holdSpeed changed, restart the interval with new speed
    if (holdInterval.current !== null) {
      stopHold()
      startHold()
    }
  }, [holdSpeed])

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
  }, [holdEnabled, addPoop])

  function reset() {
    setCount(0)
    setCritChance(0)
    setCritCost(10)
    setHoldEnabled(false)
    setBowelTier(0)
    setHoldSpeed(1)
    try {
      localStorage.removeItem('poop_count')
      localStorage.removeItem('poop_crit')
      localStorage.removeItem('poop_crit_cost')
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

  const emojiCount = Math.min(count, 10000)
  const pile = Array.from({ length: emojiCount }, (_, i) => (
    <span key={i} className="poop-emoji" style={{fontSize: 20, margin: 2}}>💩</span>
  ))

  return (
    <div className="poop-game" style={{maxWidth:760, margin:'0 auto', padding:20}}>
      <style>{`
        @keyframes poop-fly {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-200px) scale(0.5);
          }
        }
        .flying-poop {
          position: fixed;
          font-size: 24px;
          pointer-events: none;
          animation: poop-fly 0.8s ease-out forwards;
        }
        @keyframes crit-flash {
          0%, 100% {
            color: #dc2626;
          }
          50% {
            color: #ef4444;
          }
        }
        .crit-flash {
          animation: crit-flash 0.4s ease-in-out 3;
        }
      `}</style>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <h1>Poop Pile</h1>
        <div style={{textAlign:'right'}}>
          <div>Pile size</div>
          <div style={{fontSize:20, fontWeight:800}}>{count}</div>
        </div>
      </div>

      <div style={{marginTop:12, marginBottom:16}}>
        <div style={{fontSize:13,color:'#475569'}}>
          Your bowels: <strong>{BOWEL_TIERS[bowelTier].name}</strong>
          {bowelTier < BOWEL_TIERS.length - 1 && (
            <span> · Upgrade to: {BOWEL_TIERS[bowelTier+1].name} at {nextTierCostFor(bowelTier).toLocaleString()} poops</span>
          )}
        </div>
        {bowelTier < BOWEL_TIERS.length - 1 && (
          <div style={{marginTop:8}}>
            <div style={{height:8, background:'#e6eef6', borderRadius:8, overflow:'hidden'}}>
              <div style={{height:'100%', width: `${Math.min(100, Math.round((count / nextTierCostFor(bowelTier)) * 100))}%`, background:'#60a5fa'}} />
            </div>
          </div>
        )}
      </div>

      <div style={{marginTop:10, display:'flex', gap:20, alignItems:'flex-start'}}>
        <div style={{flex:1}}>
          <div style={{fontSize:13,color:'#64748b', marginBottom:12}}>Tap or press space to poop{holdEnabled && ' (or hold to continuous poop)'}</div>
          <div style={{position:'relative', display:'inline-block', width:'100%'}}>
            <button
              className="project-btn"
              ref={poopButtonRef}
              style={{width:'100%', aspectRatio:'1', padding:0, fontSize:120, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1}}
              onMouseDown={() => {
                pressTimer.current = window.setTimeout(() => {
                  pressTimer.current = null
                  if (holdEnabled) startHold()
                }, 350)
              }}
              onMouseUp={() => {
                if (pressTimer.current) {
                  window.clearTimeout(pressTimer.current)
                  pressTimer.current = null
                  addPoop()
                  return
                }
                if (holdInterval.current) stopHold()
              }}
              onMouseLeave={() => {
                if (pressTimer.current) {
                  window.clearTimeout(pressTimer.current)
                  pressTimer.current = null
                }
                if (holdInterval.current) stopHold()
              }}
              onTouchStart={() => {
                pressTimer.current = window.setTimeout(() => {
                  pressTimer.current = null
                  if (holdEnabled) startHold()
                }, 350)
              }}
              onTouchEnd={() => {
                if (pressTimer.current) {
                  window.clearTimeout(pressTimer.current)
                  pressTimer.current = null
                  addPoop()
                  return
                }
                if (holdInterval.current) stopHold()
              }}
            >
              💩
            </button>
            {lastGain !== null && (
              <div style={{position:'absolute', bottom:'-28px', left:'50%', transform:'translateX(-50%)', fontWeight:800, fontSize:18, color:lastWasCrit?'#dc2626':'#0f172a'}} className={lastWasCrit?'crit-flash':''}>
                +{lastGain}{lastWasCrit?' CRIT!':''}
              </div>
            )}
          </div>
        </div>

        <div style={{minWidth:240, paddingTop:6}}>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:12,color:'#64748b', marginBottom:8}}>Crit chance</div>
            <div style={{fontSize:18, fontWeight:700, marginBottom:8}}>{critChance}%</div>
            {(critChance > 0 || count >= 10) && (
              <button className="project-btn" onClick={buyCrit} disabled={count < critCost} style={{width:'100%'}}>
                +1% crit ({critCost.toLocaleString()})
              </button>
            )}
          </div>

          {(holdEnabled || count >= holdCost) && (
            <div style={{marginBottom:16}}>
              {!holdEnabled ? (
                <button className="project-btn" onClick={buyHold} disabled={count < holdCost} style={{width:'100%'}}>
                  Hold unlock ({holdCost})
                </button>
              ) : (
                <>
                  {bowelTier > 0 && holdSpeed < bowelTier + 1 && (
                    <div>
                      <div style={{fontSize:12,color:'#64748b', marginBottom:6}}>Hold speed</div>
                      <div style={{fontSize:14, fontWeight:700, marginBottom:6}}>{holdSpeed}x/sec</div>
                      <button className="project-btn" onClick={buyHoldSpeed} disabled={count < holdSpeedCostFor(bowelTier)} style={{width:'100%', fontSize:12}}>
                        +1 speed ({Math.round(holdSpeedCostFor(bowelTier)).toLocaleString()})
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div style={{marginBottom:16}}>
            <div style={{fontSize:12,color:'#64748b', marginBottom:8}}>Bowel tier</div>
            {bowelTier < BOWEL_TIERS.length - 1 ? (
              <>
                <div style={{fontSize:13,color:'#0f172a', marginBottom:8}}><strong>{BOWEL_TIERS[bowelTier+1].name}</strong></div>
                <div style={{fontSize:12,color:'#475569', marginBottom:8}}>Cost: {nextTierCostFor(bowelTier).toLocaleString()}</div>
                <button className="project-btn" onClick={buyBowelTier} disabled={count < nextTierCostFor(bowelTier)} style={{width:'100%'}}>
                  Unlock
                </button>
              </>
            ) : (
              <div style={{fontSize:12,color:'#059669'}}>✓ Max tier reached</div>
            )}
          </div>

          <div style={{paddingTop:12, borderTop:'1px solid #e2e8f0'}}>
            <details style={{fontSize:12}}>
              <summary style={{color:'#64748b', cursor:'pointer', padding:'8px 0'}}>Options</summary>
              <button className="project-btn" onClick={reset} style={{width:'100%', marginTop:8, fontSize:12}}>
                Reset Game
              </button>
              {typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
                <div style={{marginTop:12, paddingTop:12, borderTop:'1px solid #e2e8f0'}}>
                  <div style={{fontSize:12, fontWeight:700, color:'#dc2626', marginBottom:8}}>Admin Mode</div>
                  <input
                    type="number"
                    placeholder="Add poops and press Enter"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const value = parseInt(e.currentTarget.value) || 0
                        if (value > 0) {
                          setCount(c => c + value)
                          e.currentTarget.value = ''
                        }
                      }
                    }}
                    style={{width:'100%', padding:'6px 8px', fontSize:12, borderRadius:4, border:'1px solid #cbd5e1', boxSizing:'border-box'}}
                  />
                </div>
              )}
            </details>
          </div>
        </div>
      </div>

      <div style={{marginTop:18, minHeight:56, display:'flex', flexWrap:'wrap', alignItems:'center'}} aria-live="polite">
        {pile}
        {count > 10000 && <div style={{marginLeft:8,color:'#64748b'}}>+{count - 10000} more</div>}
      </div>

      {flyingPoops.map(poop => {
        const rect = poopButtonRef.current?.getBoundingClientRect()
        const x = rect ? rect.left + rect.width / 2 : 0
        const y = rect ? rect.top + rect.height / 2 : 0
        return (
          <div
            key={poop.id}
            className="flying-poop"
            style={{
              left: `${x + poop.left}px`,
              top: `${y}px`,
              animationDelay: `${poop.delay}ms`
            }}
          >
            💩
          </div>
        )
      })}
    </div>
  )
}
