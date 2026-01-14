import React, { useEffect, useState } from 'react'

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

  const [lastGain, setLastGain] = useState<number | null>(null)

  useEffect(() => {
    try { localStorage.setItem('poop_count', String(count)) } catch (e) {}
  }, [count])

  useEffect(() => {
    try { localStorage.setItem('poop_crit', String(critChance)) } catch (e) {}
  }, [critChance])

  useEffect(() => {
    try { localStorage.setItem('poop_crit_cost', String(critCost)) } catch (e) {}
  }, [critCost])
  useEffect(() => {
    try { localStorage.setItem('poop_hold', holdEnabled ? '1' : '0') } catch (e) {}
  }, [holdEnabled])

  // refs for hold interval and keyboard state
  const holdInterval = React.useRef<number | null>(null)
  const spaceHeld = React.useRef(false)

  function stopHold() {
    if (holdInterval.current) {
      window.clearInterval(holdInterval.current)
      holdInterval.current = null
    }
  }

  function startHold() {
    if (holdInterval.current) return
    holdInterval.current = window.setInterval(() => {
      addPoopSingle()
    }, 1000)
  }

  function addPoopSingle() {
    const roll = Math.random() < (critChance / 100)
    const gain = roll ? 10 : 1
    setCount(c => c + gain)
    setLastGain(gain)
    setTimeout(() => setLastGain(null), 700)
  }

  function addPoop() {
    if (holdEnabled) {
      // single click still just gives one (or crit)
      addPoopSingle()
      return
    }
    addPoopSingle()
  }

  function reset() {
    setCount(0)
    setCritChance(0)
    setCritCost(10)
    try { localStorage.removeItem('poop_count'); localStorage.removeItem('poop_crit'); localStorage.removeItem('poop_crit_cost') } catch (e) {}
  }

  function buyCrit() {
    if (count < critCost) return
    setCount(c => c - critCost)
    setCritChance(p => p + 1)
    setCritCost(c => c * 10)
  }
  function buyHold() {
    if (count < holdCost) return
    setCount(c => c - holdCost)
    setHoldEnabled(true)
  }

  // show up to 10k emojis as requested
  const emojiCount = Math.min(count, 10000)
  const pile = Array.from({ length: emojiCount }, (_, i) => (
    <span key={i} className="poop-emoji" style={{fontSize: 20, margin: 2}}>💩</span>
  ))

  return (
    <div className="poop-game" style={{maxWidth:760, margin:'0 auto', padding:20}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <h1>Poop Pile</h1>
        <div style={{textAlign:'right'}}>
          <div>Pile size</div>
          <div style={{fontSize:20, fontWeight:800}}>{count}</div>
        </div>
      </div>

      <p className="hint">Tap to add to your pile</p>

      <div style={{display:'flex', gap:12, marginTop:12, alignItems:'center'}}>
        <button
          className="project-btn"
          onMouseDown={() => { if (holdEnabled) startHold(); }}
          onMouseUp={() => { if (holdEnabled) stopHold(); }}
          onMouseLeave={() => { if (holdEnabled) stopHold(); }}
          onTouchStart={() => { if (holdEnabled) startHold(); }}
          onTouchEnd={() => { if (holdEnabled) stopHold(); }}
          onClick={() => { if (!holdEnabled) addPoop(); }}
        >
          Poop
        </button>
        <button className="project-btn" onClick={reset}>Reset</button>
        <div style={{marginLeft:12}}>
          <div style={{fontSize:12,color:'#64748b'}}>Crit chance: <strong>{critChance}%</strong></div>
          {(critChance > 0 || count >= 10) && (
            <button className="project-btn" onClick={buyCrit} disabled={count < critCost} style={{marginTop:8}}>
              Buy +1% crit ({critCost.toLocaleString()} poops)
            </button>
          )}
          {(holdEnabled || count >= holdCost) && (
            <div style={{marginTop:8}}>
              {!holdEnabled ? (
                <button className="project-btn" onClick={buyHold} disabled={count < holdCost}>
                  Unlock hold-to-poop ({holdCost} poops)
                </button>
              ) : (
                <div style={{fontSize:12,color:'#059669',fontWeight:700}}>Hold unlocked</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{marginTop:18, minHeight:56, display:'flex', flexWrap:'wrap', alignItems:'center'}} aria-live="polite">
        {pile}
              {count > 10000 && <div style={{marginLeft:8,color:'#64748b'}}>+{count - 10000} more</div>}
      </div>

      {lastGain !== null && (
        <div style={{marginTop:10,fontWeight:800,color:lastGain>1?'#059669':'#0f172a'}}>+{lastGain}{lastGain>1?' (CRIT!)':''}</div>
      )}
      
            {/* admin only on local */}
            {typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '::1') && (
              <div style={{marginTop:18,borderTop:'1px dashed #e6edf3',paddingTop:12}}>
                <div style={{fontSize:12,color:'#64748b'}}>Admin (local only)</div>
                <div style={{display:'flex',gap:8,marginTop:8}}>
                  <input type="number" min={0} defaultValue={count} id="adminPoopSet" />
                  <button className="project-btn" onClick={() => {
                    const el = document.getElementById('adminPoopSet') as HTMLInputElement | null
                    if (!el) return
                    const v = parseInt(el.value||'0',10) || 0
                    setCount(v)
                  }}>Set poops</button>
                </div>
              </div>
            )}
    </div>
  )
}
