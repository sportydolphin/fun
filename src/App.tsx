import React, { useEffect, useState, useCallback } from 'react'
import { Typography, Box, IconButton, AppBar, Toolbar } from '@mui/material'
import { Brightness4, Brightness7 } from '@mui/icons-material'
import { useTheme } from './ThemeContext'
import CupsGame from '../projects/cups-game/src/CupsGame'
import TestGame from './TestGame'
import Stopwatch from './Stopwatch'
import WeightGame from './WeightGame'
import PoopGame from './PoopGame'
import MlbStats from './MlbStats'

type Route = '/' | '/cups' | '/stopwatch' | '/weights' | '/poop' | '/testgame' | '/mlb'

function navigate(to: string) {
  window.history.pushState({}, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const PROJECTS = [
  { label: 'MLB Stats',     emoji: '⚾',  desc: 'Player stat card maker', path: '/mlb',      color: 'hsl(0,   68%, 42%)' },
  { label: 'Test Game',     emoji: '🐟',  desc: 'Watch the fish trade',   path: '/testgame', color: 'hsl(260, 58%, 50%)' },
  { label: 'Cups Compare',  emoji: '🥤',  desc: 'Compare liquid amounts', path: '/cups',     color: 'hsl(195, 78%, 38%)' },
  { label: 'Stopwatch',     emoji: '⏱️',  desc: 'Time your stuff',        path: '/stopwatch',color: 'hsl(28,  82%, 48%)' },
  { label: 'Weights',       emoji: '🏋️', desc: 'Track your lifts',       path: '/weights',  color: 'hsl(142, 50%, 36%)' },
  { label: 'Poop Pile',     emoji: '💩',  desc: 'Stack the poops',        path: '/poop',     color: 'hsl(24,  58%, 38%)' },
]

export default function App() {
  const { mode, toggleTheme } = useTheme()
  const [path, setPath] = useState<Route | string>(window.location.pathname as Route)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname as Route)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const Home = useCallback(() => (
    <Box sx={{ textAlign: 'center', py: 4, px: 1 }}>
      <Typography
        variant="h5"
        sx={{ fontWeight: 800, mb: 1, letterSpacing: '-0.3px' }}
      >
        what do you want to do? 🐬
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mb: 4 }}
      >
        pick something fun
      </Typography>

      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
        gap: { xs: 1.5, sm: 2 },
        maxWidth: 680,
        mx: 'auto',
      }}>
        {PROJECTS.map(p => (
          <Box
            key={p.path}
            onClick={() => navigate(p.path)}
            sx={{
              bgcolor: p.color,
              borderRadius: 3,
              p: { xs: 2, sm: 2.5 },
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 0.75,
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              userSelect: 'none',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: '0 10px 28px rgba(0,0,0,0.22)',
              },
              '&:active': {
                transform: 'translateY(-1px)',
              },
            }}
          >
            <Typography sx={{ fontSize: { xs: '2rem', sm: '2.4rem' }, lineHeight: 1 }}>
              {p.emoji}
            </Typography>
            <Typography sx={{
              color: '#fff',
              fontWeight: 700,
              fontSize: { xs: '0.85rem', sm: '0.95rem' },
              lineHeight: 1.2,
            }}>
              {p.label}
            </Typography>
            <Typography sx={{
              color: 'rgba(255,255,255,0.7)',
              fontSize: { xs: '0.7rem', sm: '0.75rem' },
              lineHeight: 1.2,
            }}>
              {p.desc}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  ), [])

  return (
    <>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 700 }}>
            sportydolphin.fun
          </Typography>
          <IconButton onClick={toggleTheme} color="inherit">
            {mode === 'dark' ? <Brightness7 /> : <Brightness4 />}
          </IconButton>
        </Toolbar>
      </AppBar>
      <Box sx={{ p: 2 }}>
        {path === '/' && <Home />}
        {path === '/cups' && (
          <Box>
            <Box onClick={() => navigate('/')} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2, cursor: 'pointer', color: 'text.secondary', fontSize: '0.85rem', fontWeight: 600, userSelect: 'none', transition: 'color 0.15s', '&:hover': { color: 'text.primary' } }}>← Back</Box>
            <CupsGame />
          </Box>
        )}
        {path === '/stopwatch' && (
          <Box>
            <Box onClick={() => navigate('/')} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2, cursor: 'pointer', color: 'text.secondary', fontSize: '0.85rem', fontWeight: 600, userSelect: 'none', transition: 'color 0.15s', '&:hover': { color: 'text.primary' } }}>← Back</Box>
            <Stopwatch />
          </Box>
        )}
        {path === '/weights' && (
          <Box>
            <Box onClick={() => navigate('/')} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2, cursor: 'pointer', color: 'text.secondary', fontSize: '0.85rem', fontWeight: 600, userSelect: 'none', transition: 'color 0.15s', '&:hover': { color: 'text.primary' } }}>← Back</Box>
            <WeightGame />
          </Box>
        )}
        {path === '/poop' && (
          <Box>
            <Box onClick={() => navigate('/')} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2, cursor: 'pointer', color: 'text.secondary', fontSize: '0.85rem', fontWeight: 600, userSelect: 'none', transition: 'color 0.15s', '&:hover': { color: 'text.primary' } }}>← Back</Box>
            <PoopGame />
          </Box>
        )}
        {path === '/testgame' && (
          <Box>
            <Box onClick={() => navigate('/')} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2, cursor: 'pointer', color: 'text.secondary', fontSize: '0.85rem', fontWeight: 600, userSelect: 'none', transition: 'color 0.15s', '&:hover': { color: 'text.primary' } }}>← Back</Box>
            <TestGame />
          </Box>
        )}
        {path === '/mlb' && (
          <Box>
            <Box onClick={() => navigate('/')} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2, cursor: 'pointer', color: 'text.secondary', fontSize: '0.85rem', fontWeight: 600, userSelect: 'none', transition: 'color 0.15s', '&:hover': { color: 'text.primary' } }}>← Back</Box>
            <MlbStats />
          </Box>
        )}
      </Box>
    </>
  )
}
