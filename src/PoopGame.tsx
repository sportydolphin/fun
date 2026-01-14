import React, { useEffect, useState } from 'react'

export default function PoopGame() {
  const [count, setCount] = useState(() => {
    try {
      const raw = localStorage.getItem('poop_count')
      return raw ? parseInt(raw, 10) : 0
    } catch (e) { return 0 }
  })

  useEffect(() => {
    try { localStorage.setItem('poop_count', String(count)) } catch (e) {}
  }, [count])

  function addPoop() { setCount(c => c + 1) }
  function reset() { setCount(0); try { localStorage.removeItem('poop_count') } catch (e) {} }

  // show a visual pile but cap number of emojis rendered for performance
  const emojiCount = Math.min(count, 40)
  const pile = Array.from({ length: emojiCount }, (_, i) => (
    <span key={i} style={{fontSize: 20, margin: 2}}>💩</span>
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

      <p className="hint">Tap the button to add to your pile. It persists across refresh.</p>

      <div style={{display:'flex', gap:12, marginTop:12}}>
        <button className="project-btn" onClick={addPoop}>Poop</button>
        <button className="project-btn" onClick={reset}>Reset</button>
      </div>

      <div style={{marginTop:18, minHeight:56, display:'flex', flexWrap:'wrap', alignItems:'center'}} aria-live="polite">
        {pile}
        {count > 40 && <div style={{marginLeft:8,color:'#64748b'}}>+{count - 40} more</div>}
      </div>
    </div>
  )
}
