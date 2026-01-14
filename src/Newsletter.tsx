import React, { useState } from 'react'

export default function Newsletter() {
  const [email, setEmail] = useState('')
  const [pressed, setPressed] = useState(false)

  function handleSign() {
  }

  return (
    <div className="newsletter">
      <div className="newsletter-left">
        <h2>Join the fun</h2>
        <p>Get occasional updates and new games — no spam.</p>
        <div className="signup-row">
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="email-input"
            aria-label="Email address"
          />
          <button
            className="signup-btn"
            onMouseDown={() => setPressed(true)}
            onMouseUp={() => setPressed(false)}
            onMouseLeave={() => setPressed(false)}
            onTouchStart={() => setPressed(true)}
            onTouchEnd={() => setPressed(false)}
            onClick={handleSign}
          >
            Sign up
          </button>
        </div>
      </div>

      <div className="newsletter-graphic" aria-hidden>
        <svg width="120" height="120" viewBox="0 0 100 100">
          <rect x="6" y="6" width="88" height="88" rx="12" fill="#ef4444" stroke="#8b0000" strokeWidth="3" />
          <text x="50" y="58" textAnchor="middle" fontSize="28" fontWeight="700" fill="#fff">
            {pressed ? 'UP' : 'STOP'}
          </text>
        </svg>
      </div>
    </div>
  )
}
