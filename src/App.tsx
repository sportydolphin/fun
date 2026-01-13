import React, { useEffect, useState, useCallback } from 'react'
import CupsGame from '../projects/cups-game/src/CupsGame'
import Stopwatch from './Stopwatch'
import Newsletter from './Newsletter'
import WeightGame from './WeightGame'

type Route = '/' | '/cups' | '/stopwatch'

function navigate(to: string) {
  window.history.pushState({}, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function App() {
  const [path, setPath] = useState<Route | string>(window.location.pathname as Route)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname as Route)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const Home = useCallback(() => (
    <div>
      <h1>sportydolphin.fun</h1>
      <p>Select a project:</p>
      <div className="projects" role="list">
        <button className="project-btn" onClick={() => navigate('/cups')}>Cups Compare</button>
        <button className="project-btn" onClick={() => navigate('/stopwatch')}>Stopwatch (stop at 5s)</button>
        <button className="project-btn" onClick={() => navigate('/weights')}>Weights (trick)</button>
      </div>
    </div>
  ), [])

  return (
    <div style={{ padding: 20 }}>
      {path === '/' && <Home />}
      <div style={{ marginTop: 28 }}>
        <Newsletter />
      </div>
      {path === '/cups' && (
        <div>
          <button onClick={() => navigate('/')} style={{ marginBottom: 12 }}>← Back</button>
          <CupsGame />
        </div>
      )}
      {path === '/stopwatch' && (
        <div>
          <button onClick={() => navigate('/')} style={{ marginBottom: 12 }}>← Back</button>
          <Stopwatch />
        </div>
      )}
      {path === '/weights' && (
        <div>
          <button onClick={() => navigate('/')} style={{ marginBottom: 12 }}>← Back</button>
          <WeightGame />
        </div>
      )}
    </div>
  )
}
