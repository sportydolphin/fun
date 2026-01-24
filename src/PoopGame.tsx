import React, { useEffect, useState, useRef } from 'react'
import { Box, Typography, Button, LinearProgress, TextField } from '@mui/material'
import { usePoopGame } from './hooks/usePoopGame'
import { BOWEL_TIERS, holdCost } from './constants'

export default function PoopGame() {
  const {
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
    startHold,
    stopHold,
    setCount,
  } = usePoopGame()

  const poopButtonRef = useRef<HTMLButtonElement>(null)
  const pressTimer = useRef<number | null>(null)

  return (
    <Box sx={{ maxWidth: 760, mx: 'auto', p: 2 }}>
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
            color: var(--crit-color-1);
          }
          50% {
            color: var(--crit-color-2);
          }
        }
        .crit-flash {
          animation: crit-flash 0.4s ease-in-out 3;
        }
      `}</style>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4" component="h1">Poop Pile</Typography>
        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="body2">Pile size</Typography>
          <Typography variant="h5" fontWeight={800}>{count}</Typography>
        </Box>
      </Box>

      <Box sx={{ mt: 1.5, mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Your bowels: <strong>{BOWEL_TIERS[bowelTier].name}</strong>
          {bowelTier < BOWEL_TIERS.length - 1 && (
            <span> · Upgrade to: {BOWEL_TIERS[bowelTier+1].name} at {nextTierCostFor(bowelTier).toLocaleString()} poops</span>
          )}
        </Typography>
        {bowelTier < BOWEL_TIERS.length - 1 && (
          <Box sx={{ mt: 1 }}>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, Math.round((count / nextTierCostFor(bowelTier)) * 100))}
              sx={{ height: 8, borderRadius: 4 }}
            />
          </Box>
        )}
      </Box>

      <Box sx={{ mt: 1.25, display: 'flex', gap: 2.5, alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Tap or press space to poop{holdEnabled && ' (or hold to continuous poop)'}
          </Typography>
          <Box sx={{ position: 'relative', width: '100%' }}>
            <Button
              ref={poopButtonRef}
              variant="outlined"
              sx={{
                width: '100%',
                aspectRatio: '1',
                p: 0,
                fontSize: 120,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
                minWidth: 'auto',
              }}
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
                stopHold()
              }}
              onMouseLeave={() => {
                if (pressTimer.current) {
                  window.clearTimeout(pressTimer.current)
                  pressTimer.current = null
                }
                stopHold()
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
                stopHold()
              }}
            >
              💩
            </Button>
            {lastGain !== null && (
              <Typography
                sx={{
                  position: 'absolute',
                  bottom: -28,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontWeight: 800,
                  fontSize: 18,
                  color: lastWasCrit ? '#dc2626' : 'text.primary',
                }}
                className={lastWasCrit ? 'crit-flash' : ''}
              >
                +{lastGain}{lastWasCrit ? ' CRIT!' : ''}
              </Typography>
            )}
          </Box>
        </Box>

        <Box sx={{ minWidth: 240, pt: 0.75 }}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
              Crit chance · Diarrhea boys
            </Typography>
            <Typography variant="h6" sx={{ mb: 1 }}>
              {critChance}% · {diarrheaBoys}
            </Typography>
            {critChance < 5 && (
              <Button
                variant="outlined"
                onClick={buyCrit}
                disabled={count < critCost}
                fullWidth
              >
                +1% crit ({critCost.toLocaleString()})
              </Button>
            )}
          </Box>

          {diarrheaBoys < 10 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
                Diarrhea boy
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                {diarrheaBoys} boys (+{diarrheaBoys}/sec)
              </Typography>
              <Button
                variant="outlined"
                onClick={buyDiarrheaBoy}
                disabled={count < diarrheaCost}
                fullWidth
              >
                +1 boy ({diarrheaCost.toLocaleString()})
              </Button>
            </Box>
          )}

          {!holdEnabled && (
            <Box sx={{ mb: 2 }}>
              <Button
                variant="outlined"
                onClick={buyHold}
                disabled={count < holdCost}
                fullWidth
              >
                Hold unlock ({holdCost})
              </Button>
            </Box>
          )}

          {holdEnabled && bowelTier > 0 && holdSpeed < bowelTier + 1 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75 }}>
                Hold speed
              </Typography>
              <Typography variant="body2" sx={{ mb: 0.75 }}>
                {holdSpeed}x/sec
              </Typography>
              <Button
                variant="outlined"
                onClick={buyHoldSpeed}
                disabled={count < holdSpeedCostFor(bowelTier)}
                fullWidth
                size="small"
              >
                +1 speed ({Math.round(holdSpeedCostFor(bowelTier)).toLocaleString()})
              </Button>
            </Box>
          )}

          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
              Bowel tier
            </Typography>
            {bowelTier < BOWEL_TIERS.length - 1 ? (
              <>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  <strong>{BOWEL_TIERS[bowelTier+1].name}</strong>
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
                  Cost: {nextTierCostFor(bowelTier).toLocaleString()}
                </Typography>
                <Button
                  variant="outlined"
                  onClick={buyBowelTier}
                  disabled={count < nextTierCostFor(bowelTier)}
                  fullWidth
                >
                  Unlock
                </Button>
              </>
            ) : (
              <Typography variant="caption" color="success.main">
                ✓ Max tier reached
              </Typography>
            )}
          </Box>

          <Box sx={{ pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
            <details style={{ fontSize: 12 }}>
              <summary style={{ cursor: 'pointer' }}>
                Options
              </summary>
              <Button
                variant="outlined"
                onClick={reset}
                fullWidth
                sx={{ mt: 1, fontSize: 12 }}
                size="small"
              >
                Reset Game
              </Button>
              {typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
                <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
                  <Typography variant="caption" fontWeight={700} color="error.main" sx={{ mb: 1 }}>
                    Admin Mode
                  </Typography>
                  <TextField
                    type="number"
                    placeholder="Add poops and press Enter"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const target = e.target as any;
                        const value = parseInt(target.value) || 0
                        if (value > 0) {
                          setCount(c => c + value)
                          target.value = ''
                        }
                      }
                    }}
                    fullWidth
                    size="small"
                    variant="outlined"
                  />
                </Box>
              )}
            </details>
          </Box>
        </Box>
      </Box>

      <Box sx={{ mt: 2.25, minHeight: 56, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }} aria-live="polite">
        {pile}
        {count > 10000 && (
          <Typography sx={{ ml: 1 }} color="text.secondary">
            +{count - 10000} more
          </Typography>
        )}
      </Box>

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
    </Box>
  )
}
