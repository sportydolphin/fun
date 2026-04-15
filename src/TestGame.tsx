import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Slider, Button, ButtonGroup, TextField, Accordion, AccordionSummary,
  AccordionDetails, Typography, Chip, CircularProgress, Tooltip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CasinoIcon from '@mui/icons-material/Casino';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import RefreshIcon from '@mui/icons-material/Refresh';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

type GameMode = 'random' | 'live';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getRandomVelocity = () => ({ vx: 1.1, vy: 1.0 });

const addBounceVariation = (velocity: number) => {
  const variation = (Math.random() - 0.5) * 0.2;
  return velocity * (1 + variation);
};

const getRandomTimerDuration = (minSeconds: number, maxSeconds: number) => {
  const min = Math.max(1, minSeconds);
  const max = Math.max(min, Math.min(120, maxSeconds));
  return Math.random() * (max - min) + min;
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function TestGame() {
  const canvasRef = useRef(null);
  const timerCanvasRef = useRef(null);
  const initialVelocity = getRandomVelocity();
  const ballRef = useRef<Ball>({
    x: 260, y: 200,
    vx: initialVelocity.vx, vy: initialVelocity.vy,
    radius: 8,
  });

  // ── Existing game state ──────────────────────────────────────────────────
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
  const [history, setHistory] = useState<Array<{
    side: 'BUY' | 'SELL'; percent: number; delta: number;
    stocksAfter: number; ts: number; price: number;
  }>>([]);

  const animationRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevVelocityRef = useRef<{ vx: number; vy: number } | null>(null);
  const balanceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const balanceAnimationRef = useRef<number | null>(null);
  const graphTimeRef = useRef<number>(0);
  const balanceSeriesRef = useRef<Array<{ t: number; v: number }>>([]);
  const [graphWindow, setGraphWindow] = useState<number>(60);
  const hoverXRef = useRef<number | null>(null);
  const hoverActiveRef = useRef<boolean>(false);

  // ── Live stock state ─────────────────────────────────────────────────────
  const [gameMode, setGameMode] = useState<GameMode>(() =>
    (localStorage.getItem('testgame_mode') as GameMode) || 'random'
  );
  const [ticker, setTicker] = useState(() => localStorage.getItem('testgame_ticker') || 'AAPL');
  const [tickerInput, setTickerInput] = useState(() => localStorage.getItem('testgame_ticker') || 'AAPL');
  const [finnhubKey, setFinnhubKey] = useState(() => localStorage.getItem('finnhub_key') || '');
  const [finnhubKeyInput, setFinnhubKeyInput] = useState(() => localStorage.getItem('finnhub_key') || '');
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [prevClose, setPrevClose] = useState<number | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState<number | null>(null);

  // Refs for use inside callbacks (avoid stale closures)
  const effectivePriceRef = useRef(10);
  const portfolioValueRef = useRef(1000);

  // ── Constants ────────────────────────────────────────────────────────────
  const PRICE_PER_STOCK = 10; // used in random mode only
  const PLOT_LEFT = 60;
  const PLOT_RIGHT = 460;
  const PLOT_TOP = 30;
  const PLOT_BOTTOM = 370;

  // ── Derived ──────────────────────────────────────────────────────────────
  const effectivePrice = gameMode === 'live' && livePrice ? livePrice : PRICE_PER_STOCK;

  // Keep refs in sync
  useEffect(() => {
    effectivePriceRef.current = effectivePrice;
  }, [effectivePrice]);

  useEffect(() => {
    portfolioValueRef.current = balance + stocks * effectivePriceRef.current;
  }, [balance, stocks, livePrice, gameMode]);

  // Persist mode and ticker
  useEffect(() => { localStorage.setItem('testgame_mode', gameMode); }, [gameMode]);
  useEffect(() => { localStorage.setItem('testgame_ticker', ticker); }, [ticker]);

  // ── Finnhub fetch ────────────────────────────────────────────────────────
  const fetchStockPrice = useCallback(async (sym?: string, key?: string) => {
    const symbol = (sym ?? ticker).toUpperCase();
    const apiKey = key ?? finnhubKey;
    if (!apiKey || !symbol) return;
    setIsFetching(true);
    setStockError(null);
    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.c || data.c === 0) throw new Error(`No price data for "${symbol}" — check the ticker symbol`);
      setLivePrice(data.c);
      effectivePriceRef.current = data.c;
      setPrevClose(data.pc ?? null);
      setLastFetchTime(Date.now());
    } catch (e: any) {
      setStockError(e.message || 'Failed to fetch price');
      setLivePrice(null);
    } finally {
      setIsFetching(false);
    }
  }, [ticker, finnhubKey]);

  // Poll every 15 s in live mode
  useEffect(() => {
    if (gameMode !== 'live' || !finnhubKey) return;
    fetchStockPrice();
    const id = setInterval(() => fetchStockPrice(), 15_000);
    return () => clearInterval(id);
  }, [gameMode, finnhubKey, ticker]);

  // ── Canvas math ──────────────────────────────────────────────────────────
  const percentToY = (percent: number) => {
    const MIN_PERCENT = 1, MAX_PERCENT = 100;
    const logMin = Math.log(MIN_PERCENT), logMax = Math.log(MAX_PERCENT);
    const normalized = (Math.log(Math.max(MIN_PERCENT, Math.min(MAX_PERCENT, percent))) - logMin) / (logMax - logMin);
    return PLOT_BOTTOM - normalized * (PLOT_BOTTOM - PLOT_TOP);
  };

  const yToPercent = (y: number) => {
    const MIN_PERCENT = 1, MAX_PERCENT = 100;
    const logMin = Math.log(MIN_PERCENT), logMax = Math.log(MAX_PERCENT);
    const normalized = (PLOT_BOTTOM - y) / (PLOT_BOTTOM - PLOT_TOP);
    return Math.exp(logMin + normalized * (logMax - logMin));
  };

  const getSplitX = () => {
    const price = effectivePriceRef.current;
    const totalValue = balance + stocks * price + 1;
    const buyPortion = Math.min(1, Math.max(0, balance / totalValue));
    return PLOT_LEFT + (PLOT_RIGHT - PLOT_LEFT) * (1 - buyPortion);
  };

  // ── Canvas drawing ───────────────────────────────────────────────────────
  const drawPlot = (ctx: CanvasRenderingContext2D, splitX: number) => {
    ctx.beginPath();
    ctx.moveTo(PLOT_LEFT, PLOT_TOP);
    ctx.lineTo(PLOT_LEFT, PLOT_BOTTOM);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(PLOT_LEFT, PLOT_BOTTOM);
    ctx.lineTo(PLOT_RIGHT, PLOT_BOTTOM);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(splitX, PLOT_BOTTOM);
    ctx.lineTo(splitX, PLOT_TOP);
    ctx.strokeStyle = '#aaa'; ctx.setLineDash([6, 6]); ctx.stroke();
    ctx.setLineDash([]);

    const tickValues = [1, 2, 5, 10, 20, 50, 100];
    for (const value of tickValues) {
      const y = percentToY(value);
      ctx.beginPath();
      ctx.moveTo(PLOT_LEFT - 5, y);
      ctx.lineTo(PLOT_LEFT + 5, y);
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke();
      ctx.font = '14px sans-serif'; ctx.textAlign = 'right';
      ctx.textBaseline = 'middle'; ctx.fillStyle = '#333';
      ctx.fillText(`${value}%`, PLOT_LEFT - 10, y);
    }

    ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
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
    ctx.lineWidth = 2; ctx.stroke();
  };

  const updateBall = (ball: Ball) => {
    ball.x += ball.vx * speed;
    ball.y += ball.vy * speed;
    const collidedLeft = ball.x - ball.radius <= PLOT_LEFT;
    const collidedRight = ball.x + ball.radius >= PLOT_RIGHT;
    const collidedTop = ball.y - ball.radius <= PLOT_TOP;
    const collidedBottom = ball.y + ball.radius >= PLOT_BOTTOM;
    if (collidedLeft || collidedRight || collidedTop || collidedBottom) {
      ball.x = Math.min(Math.max(ball.x, PLOT_LEFT + ball.radius), PLOT_RIGHT - ball.radius);
      ball.y = Math.min(Math.max(ball.y, PLOT_TOP + ball.radius), PLOT_BOTTOM - ball.radius);
      const speedMag = Math.max(0.5, Math.hypot(ball.vx, ball.vy));
      const angle = Math.random() * Math.PI * 2;
      ball.vx = Math.cos(angle) * speedMag;
      ball.vy = Math.sin(angle) * speedMag;
    }
  };

  const drawCircularTimer = (ctx: CanvasRenderingContext2D) => {
    const centerX = 100, centerY = 100, radius = 80;
    ctx.beginPath(); ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#f0f0f0'; ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();

    const progress = elapsedTime / timerDuration;
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + progress * Math.PI * 2;
    ctx.beginPath(); ctx.arc(centerX, centerY, radius - 5, startAngle, endAngle);
    ctx.strokeStyle = '#1976d2'; ctx.lineWidth = 6; ctx.stroke();

    const timeRemaining = Math.max(0, timerDuration - elapsedTime);
    ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center';
    ctx.textBaseline = 'middle'; ctx.fillStyle = '#333';
    ctx.fillText(`${Math.ceil(timeRemaining)}s`, centerX, centerY);
  };

  // ── Animation loops ──────────────────────────────────────────────────────
  const animate = () => {
    const canvas = canvasRef.current as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const splitX = getSplitX();
    drawPlot(ctx, splitX);
    if (!paused) updateBall(ballRef.current);
    drawBall(ctx, ballRef.current);
    animationRef.current = requestAnimationFrame(animate);
  };

  const animateTimer = () => {
    const canvas = timerCanvasRef.current as HTMLCanvasElement | null;
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
    const originX = padding, originY = padding;
    const nowT = graphTimeRef.current;
    const series = balanceSeriesRef.current.filter(p => p.t >= nowT - graphWindow);

    if (series.length < 2) {
      ctx.strokeStyle = '#333'; ctx.strokeRect(originX, originY, w, h);
      balanceAnimationRef.current = requestAnimationFrame(animateBalance);
      return;
    }

    const minVal = Math.min(...series.map(p => p.v));
    const maxVal = Math.max(...series.map(p => p.v));
    const range = maxVal - minVal || 1;

    ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.strokeRect(originX, originY, w, h);
    ctx.font = '12px sans-serif'; ctx.fillStyle = '#333';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(gameMode === 'live' ? 'Portfolio Value' : 'Balance', originX + 4, originY + 4);

    ctx.beginPath();
    series.forEach((p, i) => {
      const x = originX + ((p.t - (nowT - graphWindow)) / graphWindow) * w;
      const y = originY + h - ((p.v - minVal) / range) * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#1976d2'; ctx.lineWidth = 2; ctx.stroke();

    // Hover overlay
    const hoverX = hoverXRef.current;
    if (hoverX != null && hoverActiveRef.current && hoverX >= originX && hoverX <= originX + w) {
      const tHover = (nowT - graphWindow) + ((hoverX - originX) / w) * graphWindow;
      let idx = series.findIndex(p => p.t >= tHover);
      let valueAtT: number | null = null;
      if (idx === -1) valueAtT = series[series.length - 1].v;
      else if (idx === 0) valueAtT = series[0].v;
      else {
        const p0 = series[idx - 1], p1 = series[idx];
        const alpha = (tHover - p0.t) / (p1.t - p0.t || 1);
        valueAtT = p0.v + alpha * (p1.v - p0.v);
      }
      ctx.save();
      ctx.beginPath(); ctx.moveTo(hoverX, originY); ctx.lineTo(hoverX, originY + h);
      ctx.strokeStyle = '#555'; ctx.setLineDash([4, 4]); ctx.stroke();
      ctx.restore();
      if (valueAtT != null) {
        const label = `$${valueAtT.toFixed(2)}`;
        const textWidth = ctx.measureText(label).width;
        const pad = 6, boxW = textWidth + pad * 2, boxH = 20;
        let boxX = Math.max(originX + 4, Math.min(originX + w - boxW - 4, hoverX - boxW / 2));
        const boxY = originY + 6;
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.rect(boxX, boxY, boxW, boxH);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#333'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, boxX + boxW / 2, boxY + boxH / 2);
      }
    }

    balanceAnimationRef.current = requestAnimationFrame(animateBalance);
  };

  useEffect(() => {
    animate(); animateTimer(); animateBalance();
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (balanceAnimationRef.current) cancelAnimationFrame(balanceAnimationRef.current);
    };
  }, [speed, elapsedTime, isFlashing]);

  // ── Timer / trade interval ───────────────────────────────────────────────
  useEffect(() => {
    if (paused) {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      return;
    }

    timerIntervalRef.current = setInterval(() => {
      const dt = 0.05 * speed;
      graphTimeRef.current += dt;
      // Push total portfolio value to graph
      balanceSeriesRef.current.push({ t: graphTimeRef.current, v: portfolioValueRef.current });
      if (balanceSeriesRef.current.length > 5000)
        balanceSeriesRef.current.splice(0, balanceSeriesRef.current.length - 5000);

      setElapsedTime(prev => {
        const newTime = prev + 0.05 * speed;
        if (newTime >= timerDuration) {
          const price = effectivePriceRef.current;
          const splitX = getSplitX();
          const side = ballRef.current.x >= splitX ? 'BUY' : 'SELL';
          const yPercent = Math.round(yToPercent(ballRef.current.y));
          setLastLabel(`${side.toLowerCase()} ${yPercent}%`);

          setStocks(current => {
            const pct = Math.max(0, Math.min(100, yPercent)) / 100;
            if (side === 'BUY') {
              const affordable = Math.floor(balance / price);
              const cashToSpend = balance * pct;
              const desiredShares = Math.floor(cashToSpend / price);
              const delta = Math.max(0, Math.min(desiredShares, affordable));
              const next = current + delta;
              if (delta > 0) {
                setBalance(b => b - delta * price);
                setHistory(h => [...h, { side, percent: yPercent, delta, stocksAfter: next, ts: Date.now(), price }]);
              } else {
                setHistory(h => [...h, { side, percent: yPercent, delta: 0, stocksAfter: current, ts: Date.now(), price }]);
              }
              return next;
            }
            // SELL
            if (current <= 1) {
              setHistory(h => [...h, { side, percent: yPercent, delta: 0, stocksAfter: 1, ts: Date.now(), price }]);
              return 1;
            }
            const desiredSell = Math.max(1, Math.round(current * pct));
            const maxSell = Math.max(0, current - 1);
            const deltaSell = Math.max(0, Math.min(desiredSell, maxSell));
            const next = current - deltaSell;
            setBalance(b => b + deltaSell * price);
            setHistory(h => [...h, { side, percent: yPercent, delta: -deltaSell, stocksAfter: next, ts: Date.now(), price }]);
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

    return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
  }, [timerDuration, speed, timerRange, paused, balance]);

  // ── Balance canvas mouse events ──────────────────────────────────────────
  useEffect(() => {
    const canvas = balanceCanvasRef.current;
    if (!canvas) return;
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      hoverXRef.current = e.clientX - rect.left;
      hoverActiveRef.current = e.clientY - rect.top >= 0 && e.clientY - rect.top <= rect.height;
    };
    const onLeave = () => { hoverActiveRef.current = false; hoverXRef.current = null; };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    return () => { canvas.removeEventListener('mousemove', onMove); canvas.removeEventListener('mouseleave', onLeave); };
  }, []);

  // ── Pause / resume ───────────────────────────────────────────────────────
  const togglePaused = () => {
    setPaused(p => {
      const next = !p;
      if (next) {
        prevVelocityRef.current = { vx: ballRef.current.vx, vy: ballRef.current.vy };
        ballRef.current.vx = 0; ballRef.current.vy = 0;
      } else {
        const prev = prevVelocityRef.current;
        if (prev) { ballRef.current.vx = prev.vx; ballRef.current.vy = prev.vy; }
        prevVelocityRef.current = null;
      }
      return next;
    });
  };

  // ── Derived display values ───────────────────────────────────────────────
  const portfolioTotal = balance + stocks * effectivePrice;
  const priceChange = livePrice != null && prevClose != null ? livePrice - prevClose : null;
  const priceChangePct = priceChange != null && prevClose ? (priceChange / prevClose) * 100 : null;
  const lastFetchStr = lastFetchTime
    ? new Date(lastFetchTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>

      {/* ── Mode Toggle ─────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
        <ButtonGroup variant="outlined" size="small">
          <Button
            variant={gameMode === 'random' ? 'contained' : 'outlined'}
            startIcon={<CasinoIcon />}
            onClick={() => setGameMode('random')}
            sx={{ color: gameMode === 'random' ? '#fff' : 'inherit' }}
          >
            Random
          </Button>
          <Button
            variant={gameMode === 'live' ? 'contained' : 'outlined'}
            startIcon={<TrendingUpIcon />}
            onClick={() => setGameMode('live')}
            sx={{
              color: gameMode === 'live' ? '#fff' : 'inherit',
              backgroundColor: gameMode === 'live' ? '#43a047' : undefined,
              borderColor: '#43a047',
              '&:hover': { backgroundColor: gameMode === 'live' ? '#2e7d32' : undefined },
            }}
          >
            Live Stock
          </Button>
        </ButtonGroup>

        {/* ── Live Stock Info Bar ──────────────────────────────────────── */}
        {gameMode === 'live' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <TextField
              label="Ticker"
              size="small"
              value={tickerInput}
              onChange={e => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const sym = tickerInput.trim().toUpperCase();
                  setTicker(sym);
                  fetchStockPrice(sym, finnhubKey);
                }
              }}
              inputProps={{ style: { width: 64, textTransform: 'uppercase', fontWeight: 'bold' } }}
              sx={{ width: 100 }}
            />
            <Button
              size="small" variant="outlined"
              onClick={() => {
                const sym = tickerInput.trim().toUpperCase();
                setTicker(sym);
                fetchStockPrice(sym, finnhubKey);
              }}
            >
              Go
            </Button>

            {!finnhubKey && (
              <Typography variant="caption" color="warning.main" sx={{ maxWidth: 220 }}>
                ⚠ Add your free Finnhub API key in Options to enable live prices.
              </Typography>
            )}

            {finnhubKey && isFetching && <CircularProgress size={18} />}

            {finnhubKey && !isFetching && livePrice != null && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Typography variant="h6" fontWeight="bold" sx={{ lineHeight: 1 }}>
                  ${livePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Typography>
                {priceChange != null && priceChangePct != null && (
                  <Chip
                    size="small"
                    label={`${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)} (${priceChange >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}%)`}
                    color={priceChange >= 0 ? 'success' : 'error'}
                    sx={{ fontWeight: 'bold', fontSize: 12 }}
                  />
                )}
                <Tooltip title={`Last updated: ${lastFetchStr} · refreshes every 15s`}>
                  <Chip
                    size="small"
                    icon={<RefreshIcon sx={{ fontSize: '14px !important' }} />}
                    label="LIVE"
                    color="success"
                    variant="outlined"
                    sx={{ fontSize: 11, cursor: 'default' }}
                  />
                </Tooltip>
              </Box>
            )}

            {finnhubKey && stockError && (
              <Typography variant="caption" color="error.main">{stockError}</Typography>
            )}
          </Box>
        )}
      </Box>

      {/* ── Canvases ────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 4, flexWrap: 'wrap' }}>
        <Box>
          <canvas
            ref={canvasRef} width={500} height={400}
            style={{ background: '#fff', border: '1px solid #ccc' }}
          />
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <canvas
            ref={timerCanvasRef} width={200} height={200}
            style={{ background: '#fff', border: '1px solid #ccc' }}
          />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2">Window:</Typography>
            <ButtonGroup size="small">
              {[{ v: 60, label: '1m' }, { v: 300, label: '5m' }, { v: 1200, label: '20m' }].map(({ v, label }) => (
                <Button
                  key={v}
                  variant={graphWindow === v ? 'contained' : 'outlined'}
                  onClick={() => setGraphWindow(v)}
                  sx={{ color: graphWindow === v ? '#fff' : 'inherit' }}
                >
                  {label}
                </Button>
              ))}
            </ButtonGroup>
          </Box>
          <canvas
            ref={balanceCanvasRef} width={300} height={200}
            style={{ background: '#fff', border: '1px solid #ccc' }}
          />
        </Box>
      </Box>

      {/* ── Last trade label ────────────────────────────────────────────── */}
      {lastLabel && <Box sx={{ mt: 1, fontWeight: 'bold' }}>{lastLabel}</Box>}

      {/* ── Balance / portfolio display ──────────────────────────────────── */}
      {gameMode === 'random' ? (
        <>
          <Typography variant="h4" sx={{ mt: 1, fontWeight: 'bold' }}>
            Balance: ${balance.toFixed(2)}
          </Typography>
          <Box sx={{ fontWeight: 'bold' }}>
            Stocks: {stocks} (${(stocks * PRICE_PER_STOCK).toFixed(2)})
          </Box>
        </>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, mt: 1 }}>
          <Typography variant="h4" fontWeight="bold">
            Portfolio: ${portfolioTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Typography>
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Typography variant="body1" color="text.secondary">
              Cash: <strong>${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {ticker}: <strong>{stocks} shares</strong>
              {livePrice != null && (
                <> @ ${livePrice.toFixed(2)} = <strong>${(stocks * livePrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></>
              )}
            </Typography>
          </Box>
        </Box>
      )}

      {/* ── Pause / Options ─────────────────────────────────────────────── */}
      <Button
        variant="contained" color="primary" onClick={togglePaused}
        startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />}
        sx={{
          mt: 1, color: '#fff',
          backgroundColor: paused ? '#2e7d32' : '#1976d2',
          '&:hover': { backgroundColor: paused ? '#1b5e20' : '#115293' },
        }}
      >
        {paused ? 'Resume' : 'Pause'}
      </Button>

      <Button variant="outlined" onClick={() => setShowOptions(v => !v)} sx={{ mt: 1 }}>
        {showOptions ? 'Hide Options' : 'Show Options'}
      </Button>

      {showOptions && (
        <Box sx={{ width: 360, p: 2, border: '1px solid #ccc', borderRadius: 2, backgroundColor: '#fafafa' }}>

          {/* ── Finnhub API key (live mode only) ────────────────────────── */}
          {gameMode === 'live' && (
            <Box sx={{ mb: 3, pb: 2, borderBottom: '1px solid #e0e0e0' }}>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                Finnhub API Key
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 0.5 }}>
                <TextField
                  label="API Key"
                  size="small"
                  type="password"
                  value={finnhubKeyInput}
                  onChange={e => setFinnhubKeyInput(e.target.value)}
                  fullWidth
                  placeholder="your_finnhub_key_here"
                />
                <Button
                  variant="outlined"
                  onClick={() => {
                    const key = finnhubKeyInput.trim();
                    setFinnhubKey(key);
                    localStorage.setItem('finnhub_key', key);
                    if (key) fetchStockPrice(ticker, key);
                  }}
                >
                  Save
                </Button>
              </Box>
              <Typography variant="caption" color="text.secondary">
                Free key at{' '}
                <a href="https://finnhub.io" target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                  finnhub.io
                </a>{' '}
                — no credit card. Stored locally only.
              </Typography>
            </Box>
          )}

          {/* ── Ball speed ──────────────────────────────────────────────── */}
          <Box sx={{ mb: 1, fontWeight: 'bold' }}>Ball Speed: {speed.toFixed(1)}x</Box>
          <Slider
            value={speed} onChange={(_, v) => setSpeed(v as number)}
            min={0.1} max={3} step={0.1} marks valueLabelDisplay="auto"
          />

          {/* ── Timer range ─────────────────────────────────────────────── */}
          <Box sx={{ mt: 3, mb: 1, fontWeight: 'bold' }}>Timer Range (seconds)</Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              label="Min" type="number" size="small" value={timerRange[0]}
              onChange={e => {
                const min = Math.max(1, Math.min(120, Number(e.target.value) || 1));
                setTimerRange([min, Math.max(min, timerRange[1])]);
              }}
              inputProps={{ min: 1, max: 120 }}
            />
            <TextField
              label="Max" type="number" size="small" value={timerRange[1]}
              onChange={e => {
                const max = Math.max(1, Math.min(120, Number(e.target.value) || 1));
                setTimerRange([Math.min(timerRange[0], max), max]);
              }}
              inputProps={{ min: 1, max: 120 }}
            />
            <Button variant="outlined" onClick={() => {
              const [min, max] = timerRange;
              const cMin = Math.max(1, Math.min(120, min));
              const cMax = Math.max(cMin, Math.min(120, max));
              setTimerRange([cMin, cMax]);
              setElapsedTime(0);
              setTimerDuration(getRandomTimerDuration(cMin, cMax));
            }}>Apply</Button>
          </Box>

          {/* ── Add stocks ──────────────────────────────────────────────── */}
          <Box sx={{ mt: 3, display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              label="Add stocks" type="number" size="small" value={addAmount}
              onChange={e => setAddAmount(Number(e.target.value) || 0)}
              inputProps={{ min: 0, max: 100000 }}
            />
            <Button
              variant="contained"
              onClick={() => setStocks(prev => prev + Math.max(0, Math.floor(addAmount)))}
              sx={{ color: '#fff', backgroundColor: '#1976d2', '&:hover': { backgroundColor: '#115293' } }}
            >
              Add
            </Button>
          </Box>

          {/* ── Add cash ────────────────────────────────────────────────── */}
          <Box sx={{ mt: 3, display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              label="Add cash" type="number" size="small" value={addCash}
              onChange={e => setAddCash(Number(e.target.value) || 0)}
              inputProps={{ min: 0, max: 1000000 }}
            />
            <Button
              variant="contained"
              onClick={() => setBalance(prev => prev + Math.max(0, addCash))}
              sx={{ color: '#fff', backgroundColor: '#1976d2', '&:hover': { backgroundColor: '#115293' } }}
            >
              Add $
            </Button>
          </Box>

          {/* ── Transaction history ─────────────────────────────────────── */}
          <Accordion sx={{ mt: 3 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle1">Transaction History ({history.length})</Typography>
            </AccordionSummary>
            <AccordionDetails>
              {history.length === 0
                ? <Typography color="text.secondary">No transactions yet.</Typography>
                : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {history.slice().reverse().map((h, idx) => (
                      <Box key={idx} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, gap: 1 }}>
                        <span>{new Date(h.ts).toLocaleTimeString()}</span>
                        <span style={{ color: h.side === 'BUY' ? '#43a047' : '#1976d2', fontWeight: 600 }}>
                          {h.side} {Math.abs(h.delta)} @ {h.percent}%
                        </span>
                        <span style={{ color: '#888' }}>${h.price.toFixed(2)}</span>
                        <span>↳ {h.stocksAfter} shares</span>
                      </Box>
                    ))}
                  </Box>
                )
              }
            </AccordionDetails>
          </Accordion>
        </Box>
      )}
    </Box>
  );
}
