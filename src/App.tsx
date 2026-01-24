import React, { useEffect, useState, useCallback } from 'react'
import { Button, Typography, Box, IconButton, AppBar, Toolbar } from '@mui/material'
import { CompareArrows, Timer, FitnessCenter, EmojiNature, Brightness4, Brightness7, ShowChart } from '@mui/icons-material'
import { useTheme } from './ThemeContext'
import CupsGame from '../projects/cups-game/src/CupsGame'
import TestGame from './TestGame'
import Stopwatch from './Stopwatch'
import Newsletter from './Newsletter'
import WeightGame from './WeightGame'
import PoopGame from './PoopGame'

type Route = '/' | '/cups' | '/stopwatch' | '/weights' | '/poop' | '/testgame'

function navigate(to: string) {
  window.history.pushState({}, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function App() {
  const { mode, toggleTheme } = useTheme()
  const [path, setPath] = useState<Route | string>(window.location.pathname as Route)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname as Route)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const Home = useCallback(() => (
    <Box sx={{ textAlign: 'center', py: 4 }}>
      <Typography variant="h6" gutterBottom sx={{ mb: 4 }}>
        Select a project:
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 2, maxWidth: 800, mx: 'auto' }}>
        <Button
          variant="outlined"
          size="large"
          startIcon={<CompareArrows />}
          onClick={() => navigate('/cups')}
          sx={{ py: 2 }}
        >
          Cups Compare
        </Button>
        <Button
          variant="outlined"
          size="large"
          startIcon={<ShowChart />}
          onClick={() => navigate('/testgame')}
          sx={{ py: 2 }}
        >
          Test Game
        </Button>
        <Button
          variant="outlined"
          size="large"
          startIcon={<Timer />}
          onClick={() => navigate('/stopwatch')}
          sx={{ py: 2 }}
        >
          Stopwatch
        </Button>
        <Button
          variant="outlined"
          size="large"
          startIcon={<FitnessCenter />}
          onClick={() => navigate('/weights')}
          sx={{ py: 2 }}
        >
          Weights
        </Button>
        <Button
          variant="outlined"
          size="large"
          startIcon={<EmojiNature />}
          onClick={() => navigate('/poop')}
          sx={{ py: 2 }}
        >
          Poop Pile
        </Button>
      </Box>
    </Box>
  ), [])

  return (
    <>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
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
            <Button variant="outlined" onClick={() => navigate('/')} sx={{ mb: 2 }}>← Back</Button>
            <CupsGame />
          </Box>
        )}
        {path === '/stopwatch' && (
          <Box>
            <Button variant="outlined" onClick={() => navigate('/')} sx={{ mb: 2 }}>← Back</Button>
            <Stopwatch />
          </Box>
        )}
        {path === '/weights' && (
          <Box>
            <Button variant="outlined" onClick={() => navigate('/')} sx={{ mb: 2 }}>← Back</Button>
            <WeightGame />
          </Box>
        )}
        {path === '/poop' && (
          <Box>
            <Button variant="outlined" onClick={() => navigate('/')} sx={{ mb: 2 }}>← Back</Button>
            <PoopGame />
          </Box>
        )}
        {path === '/testgame' && (
          <Box>
            <Button variant="outlined" onClick={() => navigate('/')} sx={{ mb: 2 }}>← Back</Button>
            <TestGame />
          </Box>
        )}
        {path === '/' && (
          <Box sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, p: 2, backgroundColor: 'background.paper' }}>
            <Newsletter />
          </Box>
        )}
      </Box>
    </>
  );
}
