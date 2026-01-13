import React, { useEffect, useRef, useState } from 'react'

function format(ms: number) { return (ms / 1000).toFixed(3) }

export default function Stopwatch() {
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [message, setMessage] = useState('')
  const [best, setBest] = useState<{time:number,diff:number} | null>(() => {
    try {
      const raw = localStorage.getItem('stopwatch_best')
      return raw ? JSON.parse(raw) : null
    } catch (e) { return null }
  })
  const startRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        if (running) stop()
        else start()
      }
      if (e.key === 'r') resetAll()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running])

  function tick() {
    if (startRef.current == null) return
    const now = performance.now()
    setElapsed(now - startRef.current)
    rafRef.current = requestAnimationFrame(tick)
  }

  function start() {
    startRef.current = performance.now()
    setRunning(true)
    setMessage('')
    rafRef.current = requestAnimationFrame(tick)
  }

  function stop() {
    if (!running) return
    setRunning(false)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (startRef.current == null) return
    const final = performance.now() - startRef.current
    setElapsed(final)
    checkResult(final)
  }

  function resetAll() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    startRef.current = null
    rafRef.current = null
    setRunning(false)
    setElapsed(0)
    setMessage('')
  }

  function checkResult(ms: number) {
    const target = 5000
    const diff = ms - target
    const abs = Math.abs(diff)
    if (abs <= 100) setMessage(`Nice! ${format(ms)} (diff ${(diff/1000).toFixed(3)}s)`)
    else setMessage(`Close: ${format(ms)} (diff ${(diff/1000).toFixed(3)}s)`)
    // update best if this is closer
    try {
      const currentBestRaw = localStorage.getItem('stopwatch_best')
      const currentBest = currentBestRaw ? JSON.parse(currentBestRaw) : null
      if (!currentBest || Math.abs(ms - target) < currentBest.diff) {
        const newBest = { time: ms, diff: Math.abs(ms - target) }
        localStorage.setItem('stopwatch_best', JSON.stringify(newBest))
        setBest(newBest)
      }
    } catch (e) {}
  }

  return (
    <div className="container">
      <h1>Stop at 5 seconds</h1>
      <div className="display">{format(elapsed)}</div>
      <div className="controls">
        <button onClick={() => (running ? stop() : start())}>{running ? 'Stop' : 'Start'}</button>
        <button onClick={resetAll}>Reset</button>
      </div>
      <div className="result">{message}</div>
      <div style={{marginTop:8}}>
        Best: {best ? `${format(best.time)} (diff ${(best.diff/1000).toFixed(3)}s)` : '—'}
      </div>
      <p className="hint">Press <strong>Space</strong> to start/stop.</p>
    </div>
  )
}
