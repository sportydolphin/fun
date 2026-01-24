import React, { useEffect, useRef, useState } from 'react';
import { Box, Slider, Button, ButtonGroup, TextField, Accordion, AccordionSummary, AccordionDetails, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

const getRandomVelocity = () => {
  // Use a fixed seed-like velocity so it's consistent across page loads
  // but still has a diagonal direction
  return {
    vx: 1.1,
    vy: 1.0,
  };
};

const addBounceVariation = (velocity: number) => {
  // Add small random variation (±10%) to each bounce
  const variation = (Math.random() - 0.5) * 0.2;
  return velocity * (1 + variation);
};

const getRandomTimerDuration = (minSeconds: number, maxSeconds: number) => {
  const min = Math.max(1, minSeconds);
  const max = Math.max(min, Math.min(120, maxSeconds));
  return Math.random() * (max - min) + min;
};

export default function TestGame() {
  const canvasRef = useRef(null);
  const timerCanvasRef = useRef(null);
  const initialVelocity = getRandomVelocity();
  const ballRef = useRef<Ball>({
    x: 260,
    y: 200,
    vx: initialVelocity.vx,
    vy: initialVelocity.vy,
    radius: 8,
  });
  const [speed, setSpeed] = useState(1);
  const [timerRange, setTimerRange] = useState<[number, number]>([5, 60]);
  const [timerDuration, setTimerDuration] = useState(() => getRandomTimerDuration(5, 60));
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isFlashing, setIsFlashing] = useState(false);
  const [lastLabel, setLastLabel] = useState<string | null>(null);
  const [stocks, setStocks] = useState(0);
  const [addAmount, setAddAmount] = useState(1);
    const [balance, setBalance] = useState(1000);
    const [addCash, setAddCash] = useState(100);
  const [showOptions, setShowOptions] = useState(false);
  const [paused, setPaused] = useState(false);
  const [history, setHistory] = useState<Array<{ side: 'BUY' | 'SELL'; percent: number; delta: number; stocksAfter: number; ts: number }>>([]);
  const animationRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevVelocityRef = useRef<{ vx: number; vy: number } | null>(null);
  const balanceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const balanceAnimationRef = useRef<number | null>(null);
  const graphTimeRef = useRef<number>(0);
  const balanceSeriesRef = useRef<Array<{ t: number; v: number }>>([]);
  const [graphWindow, setGraphWindow] = useState<number>(60); // seconds: 60, 300, 1200
  const hoverXRef = useRef<number | null>(null);
  const hoverActiveRef = useRef<boolean>(false);

  const PLOT_LEFT = 60;
  const PLOT_RIGHT = 460;
  const PLOT_TOP = 30;
  const PLOT_BOTTOM = 370;
  const PRICE_PER_STOCK = 10;

  // Logarithmic scale: maps percentage (1-100) to canvas y position
  const percentToY = (percent: number) => {
    const MIN_PERCENT = 1;
    const MAX_PERCENT = 100;
    const logMin = Math.log(MIN_PERCENT);
    const logMax = Math.log(MAX_PERCENT);
    const normalized = (Math.log(Math.max(MIN_PERCENT, Math.min(MAX_PERCENT, percent))) - logMin) / (logMax - logMin);
    return PLOT_BOTTOM - normalized * (PLOT_BOTTOM - PLOT_TOP);
  };

  // Inverse: maps canvas y position to percentage
  const yToPercent = (y: number) => {
    const MIN_PERCENT = 1;
    const MAX_PERCENT = 100;
    const logMin = Math.log(MIN_PERCENT);
    const logMax = Math.log(MAX_PERCENT);
    const normalized = (PLOT_BOTTOM - y) / (PLOT_BOTTOM - PLOT_TOP);
    return Math.exp(logMin + normalized * (logMax - logMin));
  };

  const getSplitX = () => {
    const totalValue = balance + stocks * PRICE_PER_STOCK + 1; // avoid div-by-zero
    const buyPortion = Math.min(1, Math.max(0, balance / totalValue));
    // Higher buyPortion shifts split left, giving BUY more space
    return PLOT_LEFT + (PLOT_RIGHT - PLOT_LEFT) * (1 - buyPortion);
  };

  const drawPlot = (ctx: CanvasRenderingContext2D, splitX: number) => {
    // Draw axes
    ctx.beginPath();
    ctx.moveTo(PLOT_LEFT, PLOT_TOP);
    ctx.lineTo(PLOT_LEFT, PLOT_BOTTOM);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(PLOT_LEFT, PLOT_BOTTOM);
    ctx.lineTo(PLOT_RIGHT, PLOT_BOTTOM);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dynamic vertical line (split)
    ctx.beginPath();
    ctx.moveTo(splitX, PLOT_BOTTOM);
    ctx.lineTo(splitX, PLOT_TOP);
    ctx.strokeStyle = '#aaa';
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Y axis ticks and labels (logarithmic scale)
    const tickValues = [1, 2, 5, 10, 20, 50, 100];
    for (const value of tickValues) {
      const y = percentToY(value);
      ctx.beginPath();
      ctx.moveTo(PLOT_LEFT - 5, y);
      ctx.lineTo(PLOT_LEFT + 5, y);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#333';
      ctx.fillText(`${value}%`, PLOT_LEFT - 10, y);
    }

    // X axis labels
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#1976d2';
    ctx.fillText('SELL', PLOT_LEFT + (splitX - PLOT_LEFT) / 2, PLOT_BOTTOM + 10);
    ctx.fillStyle = '#43a047';
    ctx.fillText('BUY', splitX + (PLOT_RIGHT - splitX) / 2, PLOT_BOTTOM + 10);
  };

  const drawBall = (ctx: CanvasRenderingContext2D, ball: Ball) => {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fillStyle = isFlashing ? '#51cf66' : '#ff6b6b';
    ctx.fill();
    ctx.strokeStyle = isFlashing ? '#2f9e44' : '#c92a2a';
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  const updateBall = (ball: Ball) => {
    const speedMultiplier = speed;
    
    // Update position
    ball.x += ball.vx * speedMultiplier;
    ball.y += ball.vy * speedMultiplier;

    // Bounce off walls with a fully random new angle each time
    const collidedLeft = ball.x - ball.radius <= PLOT_LEFT;
    const collidedRight = ball.x + ball.radius >= PLOT_RIGHT;
    const collidedTop = ball.y - ball.radius <= PLOT_TOP;
    const collidedBottom = ball.y + ball.radius >= PLOT_BOTTOM;

    if (collidedLeft || collidedRight || collidedTop || collidedBottom) {
      // Clamp inside bounds
      ball.x = Math.min(Math.max(ball.x, PLOT_LEFT + ball.radius), PLOT_RIGHT - ball.radius);
      ball.y = Math.min(Math.max(ball.y, PLOT_TOP + ball.radius), PLOT_BOTTOM - ball.radius);

      const speedMag = Math.max(0.5, Math.hypot(ball.vx, ball.vy));
      const angle = Math.random() * Math.PI * 2;
      ball.vx = Math.cos(angle) * speedMag;
      ball.vy = Math.sin(angle) * speedMag;
    }
  };

  const drawCircularTimer = (ctx: CanvasRenderingContext2D) => {
    const centerX = 100;
    const centerY = 100;
    const radius = 80;

    // Background circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#f0f0f0';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Progress arc
    const progress = elapsedTime / timerDuration;
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + progress * Math.PI * 2;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 5, startAngle, endAngle);
    ctx.strokeStyle = '#1976d2';
    ctx.lineWidth = 6;
    ctx.stroke();

    // Time text
    const timeRemaining = Math.max(0, timerDuration - elapsedTime);
    const seconds = Math.ceil(timeRemaining);
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#333';
    ctx.fillText(`${seconds}s`, centerX, centerY);
  };

  const animate = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const splitX = getSplitX();
    drawPlot(ctx, splitX);
    if (!paused) {
      updateBall(ballRef.current);
    }
    drawBall(ctx, ballRef.current);

    animationRef.current = requestAnimationFrame(animate);
  };

  const animateTimer = () => {
    const canvas = timerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawCircularTimer(ctx);
  };

  const animateBalance = () => {
    const canvas = balanceCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const padding = 30;
    const w = canvas.width - padding * 2;
    const h = canvas.height - padding * 2;
    const originX = padding;
    const originY = padding;

    const nowT = graphTimeRef.current;
    const windowT = graphWindow;
    const series = balanceSeriesRef.current.filter((p) => p.t >= nowT - windowT);
    if (series.length < 2) {
      ctx.strokeStyle = '#333';
      ctx.strokeRect(originX, originY, w, h);
      balanceAnimationRef.current = requestAnimationFrame(animateBalance);
      return;
    }

    const minVal = Math.min(...series.map((p) => p.v));
    const maxVal = Math.max(...series.map((p) => p.v));
    const range = maxVal - minVal || 1;

    // Axes/frame
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(originX, originY, w, h);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Balance`, originX + 4, originY + 4);

    // Line path
    ctx.beginPath();
    series.forEach((p, i) => {
      const x = originX + ((p.t - (nowT - windowT)) / windowT) * w;
      const y = originY + h - ((p.v - minVal) / range) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#1976d2';
    ctx.lineWidth = 2;
    ctx.stroke();

    // No inline balance number label per request

    // Hover overlay: vertical line + value label at hovered time
    const hoverX = hoverXRef.current;
    if (hoverX != null && hoverActiveRef.current) {
      const mouseX = hoverX;
      if (mouseX >= originX && mouseX <= originX + w) {
        const tHover = (nowT - windowT) + ((mouseX - originX) / w) * windowT;
        // Find nearest surrounding points
        let idx = series.findIndex((p) => p.t >= tHover);
        let valueAtT: number | null = null;
        if (idx === -1) {
          valueAtT = series[series.length - 1].v;
        } else if (idx === 0) {
          valueAtT = series[0].v;
        } else {
          const p0 = series[idx - 1];
          const p1 = series[idx];
          const alpha = (tHover - p0.t) / (p1.t - p0.t || 1);
          valueAtT = p0.v + alpha * (p1.v - p0.v);
        }

        // Draw vertical line
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(mouseX, originY);
        ctx.lineTo(mouseX, originY + h);
        ctx.strokeStyle = '#555';
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.restore();

        if (valueAtT != null) {
          const label = `$${valueAtT.toFixed(2)}`;
          ctx.font = '12px sans-serif';
          const textWidth = ctx.measureText(label).width;
          const pad = 6;
          const boxW = textWidth + pad * 2;
          const boxH = 20;
          let boxX = mouseX - boxW / 2;
          boxX = Math.max(originX + 4, Math.min(originX + w - boxW - 4, boxX));
          const boxY = originY + 6;
          // Box background
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.rect(boxX, boxY, boxW, boxH);
          ctx.fill();
          ctx.stroke();
          // Text
          ctx.fillStyle = '#333';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, boxX + boxW / 2, boxY + boxH / 2);
        }
      }
    }

    balanceAnimationRef.current = requestAnimationFrame(animateBalance);
  };

  useEffect(() => {
    animate();
    animateTimer();
    animateBalance();
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (balanceAnimationRef.current) {
        cancelAnimationFrame(balanceAnimationRef.current);
      }
    };
  }, [speed, elapsedTime, isFlashing]);

  useEffect(() => {
    if (paused) {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      return;
    }

    timerIntervalRef.current = setInterval(() => {
      // Advance virtual graph time based on ball speed and stream balance
      const dt = 0.05 * speed; // same scale as timer
      graphTimeRef.current += dt;
      const series = balanceSeriesRef.current;
      series.push({ t: graphTimeRef.current, v: balance });
      // Trim series size to reasonable length
      if (series.length > 5000) series.splice(0, series.length - 5000);

      setElapsedTime((prev) => {
        const newTime = prev + 0.05 * speed; // scale timer speed with ball speed
        if (newTime >= timerDuration) {
          // Timer reached zero
          const splitX = getSplitX();
          const side = ballRef.current.x >= splitX ? 'BUY' : 'SELL';
          const yPercent = Math.round(yToPercent(ballRef.current.y));
          setLastLabel(`${side.toLowerCase()} ${yPercent}%`);
          setStocks((current) => {
            const pct = Math.max(0, Math.min(100, yPercent)) / 100;
            if (side === 'BUY') {
              const affordable = Math.floor(balance / PRICE_PER_STOCK);
              const cashToSpend = balance * pct; // spend percent of remaining cash
              const desiredShares = Math.floor(cashToSpend / PRICE_PER_STOCK);
              const delta = Math.max(0, Math.min(desiredShares, affordable));
              const next = current + delta;
              const balanceDelta = -delta * PRICE_PER_STOCK;
              if (delta > 0) {
                setBalance((b) => b + balanceDelta);
                setHistory((h) => [...h, { side, percent: yPercent, delta, stocksAfter: next, ts: Date.now() }]);
              } else {
                setHistory((h) => [...h, { side, percent: yPercent, delta: 0, stocksAfter: current, ts: Date.now() }]);
              }
              return next;
            }
            // SELL side with floor to avoid zero
            if (current <= 1) {
              setHistory((h) => [...h, { side, percent: yPercent, delta: 0, stocksAfter: 1, ts: Date.now() }]);
              return 1;
            }
            const desiredSell = Math.max(1, Math.round(current * pct));
            const maxSell = Math.max(0, current - 1); // keep at least 1
            const deltaSell = Math.max(0, Math.min(desiredSell, maxSell));
            const next = current - deltaSell;
            const balanceDelta = deltaSell * PRICE_PER_STOCK;
            setBalance((b) => b + balanceDelta);
            setHistory((h) => [...h, { side, percent: yPercent, delta: -deltaSell, stocksAfter: next, ts: Date.now() }]);
            return next;
          });
          setIsFlashing(true);
          setTimeout(() => setIsFlashing(false), 1000);
          setTimerDuration(getRandomTimerDuration(timerRange[0], timerRange[1]));
          return 0;
        }
        return newTime;
      });
    }, 50);

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [timerDuration, speed, timerRange, paused, balance]);

  useEffect(() => {
    const canvas = balanceCanvasRef.current;
    if (!canvas) return;
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      hoverXRef.current = x;
      hoverActiveRef.current = y >= 0 && y <= rect.height;
    };
    const onLeave = () => {
      hoverActiveRef.current = false;
      hoverXRef.current = null;
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    return () => {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const togglePaused = () => {
    setPaused((p) => {
      const next = !p;
      if (next) {
        // Pausing: store current velocity and stop the ball immediately
        prevVelocityRef.current = { vx: ballRef.current.vx, vy: ballRef.current.vy };
        ballRef.current.vx = 0;
        ballRef.current.vy = 0;
      } else {
        // Resuming: restore previous velocity if available
        const prev = prevVelocityRef.current;
        if (prev) {
          ballRef.current.vx = prev.vx;
          ballRef.current.vy = prev.vy;
        }
        prevVelocityRef.current = null;
      }
      return next;
    });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 4 }}>
        <Box>
          <canvas ref={canvasRef} width={500} height={400} style={{ background: '#fff', border: '1px solid #ccc' }} />
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <canvas ref={timerCanvasRef} width={200} height={200} style={{ background: '#fff', border: '1px solid #ccc' }} />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2">Window:</Typography>
            <ButtonGroup size="small">
              <Button
                variant={graphWindow === 60 ? 'contained' : 'outlined'}
                onClick={() => setGraphWindow(60)}
                sx={{ color: graphWindow === 60 ? '#fff' : 'inherit' }}
              >
                1m
              </Button>
              <Button
                variant={graphWindow === 300 ? 'contained' : 'outlined'}
                onClick={() => setGraphWindow(300)}
                sx={{ color: graphWindow === 300 ? '#fff' : 'inherit' }}
              >
                5m
              </Button>
              <Button
                variant={graphWindow === 1200 ? 'contained' : 'outlined'}
                onClick={() => setGraphWindow(1200)}
                sx={{ color: graphWindow === 1200 ? '#fff' : 'inherit' }}
              >
                20m
              </Button>
            </ButtonGroup>
          </Box>
          <canvas ref={balanceCanvasRef} width={300} height={200} style={{ background: '#fff', border: '1px solid #ccc' }} />
        </Box>
      </Box>
      {lastLabel && (
        <Box sx={{ mt: 1, fontWeight: 'bold' }}>
          {lastLabel}
        </Box>
      )}
      <Typography variant="h4" sx={{ mt: 1, fontWeight: 'bold' }}>Balance: ${balance.toFixed(2)}</Typography>
      <Box sx={{ fontWeight: 'bold' }}>Stocks: {stocks} (${(stocks * PRICE_PER_STOCK).toFixed(2)})</Box>
      <Button
        variant="contained"
        color="primary"
        onClick={togglePaused}
        startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />}
        sx={{ mt: 1, color: '#fff', backgroundColor: paused ? '#2e7d32' : '#1976d2', '&:hover': { backgroundColor: paused ? '#1b5e20' : '#115293' } }}
        title={paused ? 'Resume' : 'Pause'}
      >
        {paused ? 'Resume' : 'Pause'}
      </Button>
      <Button variant="outlined" onClick={() => setShowOptions((v) => !v)} sx={{ mt: 1 }}>
        {showOptions ? 'Hide Options' : 'Show Options'}
      </Button>
      {showOptions && (
        <Box sx={{ width: 340, p: 2, border: '1px solid #ccc', borderRadius: 2, backgroundColor: '#fafafa' }}>
          <Box sx={{ mb: 1, fontWeight: 'bold' }}>Ball Speed: {speed.toFixed(1)}x</Box>
          <Slider
            value={speed}
            onChange={(e, newValue) => setSpeed(newValue as number)}
            min={0.1}
            max={3}
            step={0.1}
            marks
            valueLabelDisplay="auto"
          />
          <Box sx={{ mt: 3, mb: 1, fontWeight: 'bold' }}>Timer Range (seconds)</Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              label="Min"
              type="number"
              size="small"
              value={timerRange[0]}
              onChange={(e) => {
                const min = Math.max(1, Math.min(120, Number(e.target.value) || 1));
                const max = Math.max(min, timerRange[1]);
                setTimerRange([min, max]);
              }}
              inputProps={{ min: 1, max: 120 }}
            />
            <TextField
              label="Max"
              type="number"
              size="small"
              value={timerRange[1]}
              onChange={(e) => {
                const max = Math.max(1, Math.min(120, Number(e.target.value) || 1));
                const min = Math.min(timerRange[0], max);
                setTimerRange([min, max]);
              }}
              inputProps={{ min: 1, max: 120 }}
            />
            <Button variant="outlined" onClick={() => {
              const [min, max] = timerRange;
              const clampedMin = Math.max(1, Math.min(120, min));
              const clampedMax = Math.max(clampedMin, Math.min(120, max));
              setTimerRange([clampedMin, clampedMax]);
              setElapsedTime(0);
              setTimerDuration(getRandomTimerDuration(clampedMin, clampedMax));
            }}>Apply</Button>
          </Box>
          <Box sx={{ mt: 3, display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              label="Add stocks"
              type="number"
              size="small"
              value={addAmount}
              onChange={(e) => setAddAmount(Number(e.target.value) || 0)}
              inputProps={{ min: 0, max: 100000 }}
            />
            <Button
              variant="contained"
              onClick={() => setStocks((prev) => prev + Math.max(0, Math.floor(addAmount)))}
              sx={{ color: '#fff', backgroundColor: '#1976d2', '&:hover': { backgroundColor: '#115293' } }}
            >
              Add
            </Button>
          </Box>
          <Box sx={{ mt: 3, display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              label="Add cash"
              type="number"
              size="small"
              value={addCash}
              onChange={(e) => setAddCash(Number(e.target.value) || 0)}
              inputProps={{ min: 0, max: 1000000 }}
            />
            <Button
              variant="contained"
              onClick={() => setBalance((prev) => prev + Math.max(0, addCash))}
              sx={{ color: '#fff', backgroundColor: '#1976d2', '&:hover': { backgroundColor: '#115293' } }}
            >
              Add $ to Balance
            </Button>
          </Box>
          <Accordion sx={{ mt: 3 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle1">Transaction History ({history.length})</Typography>
            </AccordionSummary>
            <AccordionDetails>
              {history.length === 0 && <Typography color="text.secondary">No transactions yet.</Typography>}
              {history.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {history.slice().reverse().map((h, idx) => (
                    <Box key={idx} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                      <span>{new Date(h.ts).toLocaleTimeString()}</span>
                      <span>{h.side} {Math.abs(h.delta)} @ {h.percent}%</span>
                      <span>Stocks: {h.stocksAfter}</span>
                    </Box>
                  ))}
                </Box>
              )}
            </AccordionDetails>
          </Accordion>
        </Box>
      )}
    </Box>
  );
}
