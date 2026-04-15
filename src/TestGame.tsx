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
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Fish {
  x: number; y: number;
  angle: number;
  speed: number;
  wanderAngle: number;
  tailPhase: number;
}

interface Bubble { x: number; y: number; r: number; vy: number; vx: number; opacity: number; }

type GameMode = 'random' | 'live';

// ─── Bowl / Plot Constants ────────────────────────────────────────────────────

const BOWL_CX = 250;
const BOWL_CY = 200;
const BOWL_R  = 165;
const GRAVEL_Y = BOWL_CY + BOWL_R * 0.56;   // top of gravel layer
// Logical coordinate bounds (same role as old PLOT_LEFT/RIGHT/TOP/BOTTOM)
const PLOT_LEFT   = BOWL_CX - BOWL_R + 30;  // ≈ 115
const PLOT_RIGHT  = BOWL_CX + BOWL_R - 30;  // ≈ 385
const PLOT_TOP    = BOWL_CY - BOWL_R + 30;  // ≈ 65
const PLOT_BOTTOM = GRAVEL_Y - 12;           // ≈ 281

// ─── Pre-generated gravel (stable — generated at module load) ─────────────────

const GRAVEL_COLORS = [
  '#c8a96e','#b8956a','#d4b483','#a08060','#c4a070',
  '#8B7355','#CD853F','#DEB887','#A0855A','#BDA06A',
];
const GRAVEL = (() => {
  const out: Array<{ x: number; y: number; r: number; color: string }> = [];
  for (let i = 0; i < 75; i++) {
    const a = -Math.PI + (i / 75) * Math.PI + Math.sin(i * 47.3) * 0.6;
    const d = ((Math.cos(i * 31.7) + 1) / 2) * (BOWL_R - 12);
    const cx = BOWL_CX + Math.cos(a) * d * 0.9;
    const cy = GRAVEL_Y + ((Math.sin(i * 13.1) + 1) / 2) * BOWL_R * 0.34;
    if (Math.hypot(cx - BOWL_CX, cy - BOWL_CY) < BOWL_R - 6)
      out.push({ x: cx, y: cy, r: 2 + ((Math.cos(i * 77.1) + 1) / 2) * 5, color: GRAVEL_COLORS[i % GRAVEL_COLORS.length] });
  }
  return out;
})();

// ─── Fish names ───────────────────────────────────────────────────────────────

const FISH_NAMES = ['Gary','Bubbles','Nemo','Finley','Splash','Goldie','Flash','Coral','Sandy','Finn','Dory','Marlin'];

// ─── Helper functions ─────────────────────────────────────────────────────────

const getRandTimer = (min: number, max: number) => {
  const lo = Math.max(1, min), hi = Math.max(lo, Math.min(120, max));
  return Math.random() * (hi - lo) + lo;
};

const percentToY = (pct: number) => {
  const lo = Math.log(1), hi = Math.log(100);
  const n = (Math.log(Math.max(1, Math.min(100, pct))) - lo) / (hi - lo);
  return PLOT_BOTTOM - n * (PLOT_BOTTOM - PLOT_TOP);
};

const yToPercent = (y: number) => {
  const lo = Math.log(1), hi = Math.log(100);
  const n = (PLOT_BOTTOM - y) / (PLOT_BOTTOM - PLOT_TOP);
  return Math.exp(lo + n * (hi - lo));
};

// ─── Draw functions ───────────────────────────────────────────────────────────

function drawBowlBackground(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(BOWL_CX, BOWL_CY, BOWL_R, 0, Math.PI * 2);
  ctx.clip();

  // Water
  const wg = ctx.createLinearGradient(BOWL_CX, BOWL_CY - BOWL_R, BOWL_CX, BOWL_CY + BOWL_R);
  wg.addColorStop(0,   'rgba(210, 240, 255, 0.55)');
  wg.addColorStop(0.5, 'rgba(180, 220, 250, 0.42)');
  wg.addColorStop(1,   'rgba(130, 185, 225, 0.68)');
  ctx.fillStyle = wg;
  ctx.fillRect(BOWL_CX - BOWL_R, BOWL_CY - BOWL_R, BOWL_R * 2, BOWL_R * 2);

  // Gravel bed
  const gg = ctx.createLinearGradient(BOWL_CX, GRAVEL_Y, BOWL_CX, BOWL_CY + BOWL_R);
  gg.addColorStop(0, '#c4a06a');
  gg.addColorStop(1, '#8B6914');
  ctx.fillStyle = gg;
  ctx.beginPath();
  ctx.ellipse(BOWL_CX, BOWL_CY + BOWL_R * 0.72, BOWL_R * 0.97, BOWL_R * 0.37, 0, 0, Math.PI * 2);
  ctx.fill();

  // Individual pebbles
  for (const g of GRAVEL) {
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
    ctx.fillStyle = g.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  ctx.restore();
}

function drawZones(ctx: CanvasRenderingContext2D, splitX: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(BOWL_CX, BOWL_CY, BOWL_R, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = 'rgba(25, 118, 210, 0.055)';
  ctx.fillRect(BOWL_CX - BOWL_R, BOWL_CY - BOWL_R, splitX - (BOWL_CX - BOWL_R), BOWL_R * 2);

  ctx.fillStyle = 'rgba(67, 160, 71, 0.055)';
  ctx.fillRect(splitX, BOWL_CY - BOWL_R, (BOWL_CX + BOWL_R) - splitX, BOWL_R * 2);

  ctx.beginPath();
  ctx.moveTo(splitX, BOWL_CY - BOWL_R);
  ctx.lineTo(splitX, BOWL_CY + BOWL_R);
  ctx.strokeStyle = 'rgba(130, 130, 130, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Zone labels inside bowl, just above gravel
  const sellMidX = BOWL_CX - BOWL_R + (splitX - (BOWL_CX - BOWL_R)) / 2;
  const buyMidX  = splitX + ((BOWL_CX + BOWL_R) - splitX) / 2;
  ctx.font = 'bold 15px sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(25, 118, 210, 0.42)';
  ctx.fillText('SELL', sellMidX, GRAVEL_Y - 6);
  ctx.fillStyle = 'rgba(67, 160, 71, 0.42)';
  ctx.fillText('BUY', buyMidX, GRAVEL_Y - 6);

  ctx.restore();
}

function drawSeaweed(ctx: CanvasRenderingContext2D, time: number) {
  const bx = BOWL_CX - BOWL_R * 0.53;
  const by = GRAVEL_Y + 4;
  const H  = 58;
  const SEGS = 8;

  ctx.save();
  ctx.beginPath();
  ctx.arc(BOWL_CX, BOWL_CY, BOWL_R, 0, Math.PI * 2);
  ctx.clip();

  ctx.beginPath();
  ctx.moveTo(bx, by);
  for (let i = 1; i <= SEGS; i++) {
    const t = i / SEGS;
    ctx.lineTo(bx + Math.sin(t * Math.PI * 1.6 + time * 1.3) * 9 * t, by - H * t);
  }
  ctx.strokeStyle = 'rgba(34, 139, 34, 0.8)';
  ctx.lineWidth = 3;
  ctx.stroke();

  for (let i = 1; i <= 4; i++) {
    const t  = i / 4.5;
    const sx = bx + Math.sin(t * Math.PI * 1.6 + time * 1.3) * 9 * t;
    const sy = by - H * t;
    const la = Math.sin(time * 1.3 + i) * 0.3 - 0.25;

    ctx.save(); ctx.translate(sx, sy); ctx.rotate(la);
    ctx.beginPath(); ctx.ellipse(11, 0, 13, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(50, 165, 55, 0.68)'; ctx.fill();
    ctx.restore();

    ctx.save(); ctx.translate(sx, sy); ctx.rotate(la + Math.PI * 0.65);
    ctx.beginPath(); ctx.ellipse(10, 0, 11, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(60, 175, 60, 0.55)'; ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawCastle(ctx: CanvasRenderingContext2D) {
  const x = BOWL_CX + BOWL_R * 0.47;
  const y = GRAVEL_Y + 1;
  const W = 34, H = 40;

  ctx.save();
  ctx.beginPath();
  ctx.arc(BOWL_CX, BOWL_CY, BOWL_R, 0, Math.PI * 2);
  ctx.clip();

  // Body
  ctx.fillStyle = 'rgba(170, 158, 142, 0.78)';
  ctx.fillRect(x - W / 2, y - H, W, H);

  // Battlements
  const mw = 7, mh = 8;
  const pitch = W / 3;
  for (let i = 0; i < 3; i++)
    ctx.fillRect(x - W / 2 + i * pitch + 1.5, y - H - mh, mw, mh);

  // Door
  ctx.fillStyle = 'rgba(55, 38, 18, 0.72)';
  ctx.beginPath();
  ctx.arc(x, y - H * 0.28, W * 0.17, Math.PI, 0);
  ctx.rect(x - W * 0.17, y - H * 0.28, W * 0.34, H * 0.28);
  ctx.fill();

  // Window
  ctx.fillStyle = 'rgba(55, 38, 18, 0.52)';
  ctx.beginPath();
  ctx.arc(x, y - H * 0.66, W * 0.11, Math.PI, 0);
  ctx.rect(x - W * 0.11, y - H * 0.66, W * 0.22, H * 0.13);
  ctx.fill();

  ctx.restore();
}

function drawBubbles(ctx: CanvasRenderingContext2D, bubbles: Bubble[]) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(BOWL_CX, BOWL_CY, BOWL_R, 0, Math.PI * 2);
  ctx.clip();
  for (const b of bubbles) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(180, 220, 255, ${b.opacity})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${b.opacity * 0.6})`;
    ctx.fill();
  }
  ctx.restore();
}

function drawGoldfish(ctx: CanvasRenderingContext2D, fish: Fish) {
  const W  = 20, H = 10;
  const wag = Math.sin(fish.tailPhase) * 9;

  ctx.save();
  ctx.beginPath();
  ctx.arc(BOWL_CX, BOWL_CY, BOWL_R, 0, Math.PI * 2);
  ctx.clip();

  ctx.save();
  ctx.translate(fish.x, fish.y);
  ctx.rotate(fish.angle);

  // Tail
  ctx.save();
  ctx.translate(-W, 0);
  for (const sign of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-6, sign * (4 - wag * 0.3 * sign), -14, sign * (9 - wag * sign), -22, sign * (13 - wag * sign));
    ctx.bezierCurveTo(-14, sign * (7 - wag * 0.5 * sign), -6, sign * 2, 0, 0);
    ctx.fillStyle = 'rgba(255, 95, 0, 0.88)';
    ctx.fill();
  }
  ctx.restore();

  // Body
  ctx.beginPath();
  ctx.ellipse(0, 0, W, H, 0, 0, Math.PI * 2);
  const bg = ctx.createRadialGradient(-5, -4, 1, 0, 0, W);
  bg.addColorStop(0,   '#FFE060');
  bg.addColorStop(0.5, '#FF8C00');
  bg.addColorStop(1,   '#CC4200');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(160, 48, 0, 0.3)';
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Dorsal fin
  ctx.beginPath();
  ctx.moveTo(-7, -H);
  ctx.bezierCurveTo(-1, -H - 11, 9, -H - 10, 13, -H);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 145, 0, 0.72)';
  ctx.fill();

  // Pectoral fin
  ctx.beginPath();
  ctx.moveTo(3, H * 0.5);
  ctx.bezierCurveTo(-1, H + 10, -9, H + 12, -14, H + 7);
  ctx.bezierCurveTo(-9, H + 1, -1, H * 0.8, 3, H * 0.5);
  ctx.fillStyle = 'rgba(255, 148, 0, 0.55)';
  ctx.fill();

  // Eye
  ctx.beginPath(); ctx.arc(W * 0.58, -H * 0.22, 3.8, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.beginPath(); ctx.arc(W * 0.58 + 0.6, -H * 0.22, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = '#111'; ctx.fill();
  ctx.beginPath(); ctx.arc(W * 0.58 + 0.2, -H * 0.22 - 1.2, 0.8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();

  ctx.restore();
  ctx.restore();
}

function drawBowlRim(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.arc(BOWL_CX, BOWL_CY, BOWL_R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(148, 198, 222, 0.88)';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(BOWL_CX - BOWL_R * 0.38, BOWL_CY - BOWL_R * 0.38, BOWL_R * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(BOWL_CX - BOWL_R * 0.52, BOWL_CY - BOWL_R * 0.53, BOWL_R * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.fill();
}

// ─── Fish physics ─────────────────────────────────────────────────────────────

function updateFish(fish: Fish, speedMult: number) {
  // Wander: gently randomize heading
  fish.wanderAngle += (Math.random() - 0.5) * 0.20;
  fish.wanderAngle *= 0.95;
  fish.angle += fish.wanderAngle * 0.07;

  // Soft circular-wall avoidance
  const dx   = fish.x - BOWL_CX;
  const dy   = fish.y - BOWL_CY;
  const dist = Math.hypot(dx, dy);
  const soft = BOWL_R - 48;
  if (dist > soft) {
    const toward = Math.atan2(-dy, -dx);
    let diff = toward - fish.angle;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    fish.angle += diff * 0.12 * Math.min(1, (dist - soft) / 32);
  }

  // Soft gravel avoidance
  const avoidY = GRAVEL_Y - 28;
  if (fish.y > avoidY) {
    const s = Math.min(1, (fish.y - avoidY) / 22);
    const up = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.5;
    let diff = up - fish.angle;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    fish.angle += diff * 0.12 * s;
  }

  // Move
  const spd = fish.speed * speedMult;
  fish.x += Math.cos(fish.angle) * spd;
  fish.y += Math.sin(fish.angle) * spd;

  // Hard circular clamp
  const dx2 = fish.x - BOWL_CX, dy2 = fish.y - BOWL_CY;
  const d2  = Math.hypot(dx2, dy2);
  if (d2 > BOWL_R - 24) {
    const sc = (BOWL_R - 24) / d2;
    fish.x = BOWL_CX + dx2 * sc;
    fish.y = BOWL_CY + dy2 * sc;
    const wn = Math.atan2(-dy2, -dx2);
    fish.angle = 2 * wn - fish.angle + (Math.random() - 0.5) * 0.4;
  }

  // Hard gravel clamp
  if (fish.y > GRAVEL_Y - 18) {
    fish.y = GRAVEL_Y - 18;
    if (Math.sin(fish.angle) > 0)
      fish.angle = -fish.angle + (Math.random() - 0.5) * 0.5;
  }

  // Tail wag
  fish.tailPhase += 0.14 * Math.max(0.6, speedMult);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TestGame() {
  // ── Canvas refs ────────────────────────────────────────────────────────────
  const canvasRef      = useRef<HTMLCanvasElement | null>(null);
  const timerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const balanceCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // ── Fish & bubbles ────────────────────────────────────────────────────────
  const fishRef = useRef<Fish>({
    x: BOWL_CX, y: BOWL_CY - 30,
    angle: 0, speed: 1.5,
    wanderAngle: 0, tailPhase: 0,
  });
  const bubblesRef = useRef<Bubble[]>([]);
  const frameTimeRef = useRef(0);

  // ── Game state ────────────────────────────────────────────────────────────
  const [speed, setSpeed]           = useState(1);
  const [timerRange, setTimerRange] = useState<[number, number]>([5, 60]);
  const [timerDuration, setTimerDuration] = useState(() => getRandTimer(5, 60));
  const [elapsedTime, setElapsedTime]     = useState(0);
  const [isFlashing, setIsFlashing]       = useState(false);
  const [lastLabel, setLastLabel]         = useState<string | null>(null);
  const [stocks, setStocks]   = useState(0);
  const [addAmount, setAddAmount] = useState(1);
  const [balance, setBalance] = useState(1000);
  const [addCash, setAddCash] = useState(100);
  const [showOptions, setShowOptions] = useState(false);
  const [paused, setPaused]   = useState(false);
  const [history, setHistory] = useState<Array<{
    side: 'BUY' | 'SELL'; percent: number; delta: number;
    stocksAfter: number; ts: number; price: number;
  }>>([]);

  const animationRef       = useRef<number | null>(null);
  const balanceAnimRef     = useRef<number | null>(null);
  const timerIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevVelocityRef    = useRef<{ angle: number } | null>(null);
  const graphTimeRef       = useRef(0);
  const balanceSeriesRef   = useRef<Array<{ t: number; v: number }>>([]);
  const [graphWindow, setGraphWindow] = useState(60);
  const hoverXRef          = useRef<number | null>(null);
  const hoverActiveRef     = useRef(false);

  // ── Live stock state ──────────────────────────────────────────────────────
  const [gameMode, setGameMode] = useState<GameMode>(
    () => (localStorage.getItem('testgame_mode') as GameMode) || 'random'
  );
  const [ticker, setTicker]             = useState(() => localStorage.getItem('testgame_ticker') || 'AAPL');
  const [tickerInput, setTickerInput]   = useState(() => localStorage.getItem('testgame_ticker') || 'AAPL');
  const [finnhubKey, setFinnhubKey]     = useState(() => localStorage.getItem('finnhub_key') || 'd7g14fpr01qqb8rhv3t0d7g14fpr01qqb8rhv3tg');
  const [finnhubKeyInput, setFinnhubKeyInput] = useState(() => localStorage.getItem('finnhub_key') || 'd7g14fpr01qqb8rhv3t0d7g14fpr01qqb8rhv3tg');
  const [livePrice, setLivePrice]   = useState<number | null>(null);
  const [prevClose, setPrevClose]   = useState<number | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState<number | null>(null);
  const [startPrice, setStartPrice]       = useState<number | null>(null);
  const [startPortfolio, setStartPortfolio] = useState<number | null>(null);

  // ── Fish name (stable) ────────────────────────────────────────────────────
  const [fishName] = useState(() => FISH_NAMES[Math.floor(Math.random() * FISH_NAMES.length)]);

  // ── Price refs (for use inside callbacks) ─────────────────────────────────
  const effectivePriceRef  = useRef(10);
  const portfolioValueRef  = useRef(1000);
  const PRICE_PER_STOCK    = 10;

  const effectivePrice = gameMode === 'live' && livePrice ? livePrice : PRICE_PER_STOCK;
  const portfolioTotal = balance + stocks * effectivePrice;

  useEffect(() => { effectivePriceRef.current = effectivePrice; }, [effectivePrice]);
  useEffect(() => { portfolioValueRef.current = portfolioTotal;  }, [portfolioTotal]);

  // ── Beat-the-market: record start when first price arrives ───────────────
  useEffect(() => {
    if (gameMode === 'live' && livePrice != null && startPrice == null) {
      setStartPrice(livePrice);
      setStartPortfolio(portfolioValueRef.current);
    }
  }, [livePrice, gameMode]);

  useEffect(() => {
    setStartPrice(null);
    setStartPortfolio(null);
    setLivePrice(null);
  }, [ticker, gameMode]);

  // ── Persistence ──────────────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem('testgame_mode',   gameMode); }, [gameMode]);
  useEffect(() => { localStorage.setItem('testgame_ticker', ticker);   }, [ticker]);

  // ── Finnhub fetch ─────────────────────────────────────────────────────────
  const fetchStockPrice = useCallback(async (sym?: string, key?: string) => {
    const symbol = (sym ?? ticker).toUpperCase();
    const apiKey = key ?? finnhubKey;
    if (!apiKey || !symbol) return;
    setIsFetching(true); setStockError(null);
    try {
      const res  = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.c || data.c === 0) throw new Error(`No data for "${symbol}"`);
      setLivePrice(data.c);
      effectivePriceRef.current = data.c;
      setPrevClose(data.pc ?? null);
      setLastFetchTime(Date.now());
    } catch (e: any) {
      setStockError(e.message || 'Fetch failed');
      setLivePrice(null);
    } finally { setIsFetching(false); }
  }, [ticker, finnhubKey]);

  useEffect(() => {
    if (gameMode !== 'live' || !finnhubKey) return;
    fetchStockPrice();
    const id = setInterval(() => fetchStockPrice(), 15_000);
    return () => clearInterval(id);
  }, [gameMode, finnhubKey, ticker]);

  // ── Coordinate math ───────────────────────────────────────────────────────
  const getSplitX = () => {
    const price = effectivePriceRef.current;
    const total = balance + stocks * price + 1;
    const buyPortion = Math.min(1, Math.max(0, balance / total));
    return PLOT_LEFT + (PLOT_RIGHT - PLOT_LEFT) * (1 - buyPortion);
  };

  // ── Main animation loop ───────────────────────────────────────────────────
  const animate = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    frameTimeRef.current += 0.016;
    const t = frameTimeRef.current;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const splitX = getSplitX();

    drawBowlBackground(ctx);
    drawZones(ctx, splitX);
    drawSeaweed(ctx, t);
    drawCastle(ctx);

    // Update & draw bubbles
    if (!paused) {
      const fish = fishRef.current;
      if (Math.random() < 0.022) {
        bubblesRef.current.push({
          x: fish.x + Math.cos(fish.angle) * 21 + (Math.random() - 0.5) * 4,
          y: fish.y + Math.sin(fish.angle) * 21 + (Math.random() - 0.5) * 4,
          r: Math.random() * 3 + 1,
          vy: -(Math.random() * 0.45 + 0.2),
          vx: (Math.random() - 0.5) * 0.3,
          opacity: 0.85,
        });
      }
      for (const b of bubblesRef.current) {
        b.y += b.vy;
        b.x += b.vx + Math.sin(b.y * 0.09) * 0.2;
        b.opacity -= 0.004;
      }
      bubblesRef.current = bubblesRef.current.filter(b => b.opacity > 0 && b.y > BOWL_CY - BOWL_R - 5);
    }

    drawBubbles(ctx, bubblesRef.current);

    if (!paused) updateFish(fishRef.current, speed);
    drawGoldfish(ctx, fishRef.current);

    drawBowlRim(ctx);

    // Flash ring when trade fires
    if (isFlashing) {
      ctx.beginPath();
      ctx.arc(BOWL_CX, BOWL_CY, BOWL_R + 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(81, 207, 102, 0.75)';
      ctx.lineWidth = 5;
      ctx.stroke();
    }

    animationRef.current = requestAnimationFrame(animate);
  };

  // ── Timer canvas ──────────────────────────────────────────────────────────
  const animateTimer = () => {
    const canvas = timerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cx = 100, cy = 100, r = 80;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f0f0f0'; ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();

    const prog = elapsedTime / timerDuration;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 5, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
    ctx.strokeStyle = '#1976d2'; ctx.lineWidth = 6; ctx.stroke();

    const secs = Math.ceil(Math.max(0, timerDuration - elapsedTime));
    ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center';
    ctx.textBaseline = 'middle'; ctx.fillStyle = '#333';
    ctx.fillText(`${secs}s`, cx, cy);
  };

  // ── Balance graph canvas ──────────────────────────────────────────────────
  const animateBalance = () => {
    const canvas = balanceCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pad = 30, w = canvas.width - pad * 2, h = canvas.height - pad * 2;
    const ox = pad, oy = pad;
    const nowT   = graphTimeRef.current;
    const series = balanceSeriesRef.current.filter(p => p.t >= nowT - graphWindow);

    if (series.length < 2) {
      ctx.strokeStyle = '#333'; ctx.strokeRect(ox, oy, w, h);
      balanceAnimRef.current = requestAnimationFrame(animateBalance);
      return;
    }

    const minV = Math.min(...series.map(p => p.v));
    const maxV = Math.max(...series.map(p => p.v));
    const rng  = maxV - minV || 1;

    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.strokeRect(ox, oy, w, h);
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#555';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(gameMode === 'live' ? 'Portfolio Value' : 'Balance', ox + 4, oy + 4);

    ctx.beginPath();
    series.forEach((p, i) => {
      const x = ox + ((p.t - (nowT - graphWindow)) / graphWindow) * w;
      const y = oy + h - ((p.v - minV) / rng) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#1976d2'; ctx.lineWidth = 2; ctx.stroke();

    // Hover tooltip
    const hx = hoverXRef.current;
    if (hx != null && hoverActiveRef.current && hx >= ox && hx <= ox + w) {
      const tHov = (nowT - graphWindow) + ((hx - ox) / w) * graphWindow;
      let idx = series.findIndex(p => p.t >= tHov);
      let val: number | null = null;
      if (idx === -1) val = series[series.length - 1].v;
      else if (idx === 0) val = series[0].v;
      else {
        const p0 = series[idx - 1], p1 = series[idx];
        const alpha = (tHov - p0.t) / (p1.t - p0.t || 1);
        val = p0.v + alpha * (p1.v - p0.v);
      }
      ctx.save();
      ctx.beginPath(); ctx.moveTo(hx, oy); ctx.lineTo(hx, oy + h);
      ctx.strokeStyle = '#555'; ctx.setLineDash([4, 4]); ctx.stroke();
      ctx.restore();
      if (val != null) {
        const label = `$${val.toFixed(2)}`;
        const tw = ctx.measureText(label).width;
        const bw = tw + 12, bh = 20;
        const bx = Math.max(ox + 4, Math.min(ox + w - bw - 4, hx - bw / 2));
        const by = oy + 6;
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#333'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + bw / 2, by + bh / 2);
      }
    }

    balanceAnimRef.current = requestAnimationFrame(animateBalance);
  };

  // ── Start all animation loops ─────────────────────────────────────────────
  useEffect(() => {
    animate(); animateTimer(); animateBalance();
    return () => {
      if (animationRef.current)   cancelAnimationFrame(animationRef.current);
      if (balanceAnimRef.current) cancelAnimationFrame(balanceAnimRef.current);
    };
  }, [speed, elapsedTime, isFlashing, paused]);

  // ── Timer / trade interval ────────────────────────────────────────────────
  useEffect(() => {
    if (paused) {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      return;
    }
    timerIntervalRef.current = setInterval(() => {
      const dt = 0.05 * speed;
      graphTimeRef.current += dt;
      balanceSeriesRef.current.push({ t: graphTimeRef.current, v: portfolioValueRef.current });
      if (balanceSeriesRef.current.length > 5000)
        balanceSeriesRef.current.splice(0, balanceSeriesRef.current.length - 5000);

      setElapsedTime(prev => {
        const next = prev + 0.05 * speed;
        if (next >= timerDuration) {
          const price   = effectivePriceRef.current;
          const splitX  = getSplitX();
          const side    = fishRef.current.x >= splitX ? 'BUY' : 'SELL';
          const yPct    = Math.round(yToPercent(fishRef.current.y));
          setLastLabel(`${fishName} ${side === 'BUY' ? 'buys' : 'sells'} ${yPct}%`);

          setStocks(cur => {
            const pct = Math.max(0, Math.min(100, yPct)) / 100;
            if (side === 'BUY') {
              const delta = Math.max(0, Math.min(Math.floor(balance * pct / price), Math.floor(balance / price)));
              const nxt   = cur + delta;
              if (delta > 0) {
                setBalance(b => b - delta * price);
                setHistory(h => [...h, { side, percent: yPct, delta, stocksAfter: nxt, ts: Date.now(), price }]);
              } else {
                setHistory(h => [...h, { side, percent: yPct, delta: 0, stocksAfter: cur, ts: Date.now(), price }]);
              }
              return nxt;
            }
            // SELL
            if (cur <= 1) {
              setHistory(h => [...h, { side, percent: yPct, delta: 0, stocksAfter: 1, ts: Date.now(), price }]);
              return 1;
            }
            const sell = Math.max(0, Math.min(Math.max(1, Math.round(cur * pct)), cur - 1));
            const nxt  = cur - sell;
            setBalance(b => b + sell * price);
            setHistory(h => [...h, { side, percent: yPct, delta: -sell, stocksAfter: nxt, ts: Date.now(), price }]);
            return nxt;
          });

          setIsFlashing(true);
          setTimeout(() => setIsFlashing(false), 1000);
          setTimerDuration(getRandTimer(timerRange[0], timerRange[1]));
          return 0;
        }
        return next;
      });
    }, 50);
    return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
  }, [timerDuration, speed, timerRange, paused, balance]);

  // ── Balance canvas mouse hover ────────────────────────────────────────────
  useEffect(() => {
    const canvas = balanceCanvasRef.current;
    if (!canvas) return;
    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      hoverXRef.current     = e.clientX - r.left;
      hoverActiveRef.current = e.clientY - r.top >= 0 && e.clientY - r.top <= r.height;
    };
    const onLeave = () => { hoverActiveRef.current = false; hoverXRef.current = null; };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    return () => { canvas.removeEventListener('mousemove', onMove); canvas.removeEventListener('mouseleave', onLeave); };
  }, []);

  // ── Pause / resume ────────────────────────────────────────────────────────
  const togglePaused = () => {
    setPaused(p => {
      const nxt = !p;
      if (nxt) {
        prevVelocityRef.current = { angle: fishRef.current.angle };
        fishRef.current.wanderAngle = 0;
      } else {
        fishRef.current.angle = prevVelocityRef.current?.angle ?? fishRef.current.angle;
        prevVelocityRef.current = null;
      }
      return nxt;
    });
  };

  // ── Derived display values ────────────────────────────────────────────────
  const priceChange    = livePrice != null && prevClose ? livePrice - prevClose : null;
  const priceChangePct = priceChange != null && prevClose ? (priceChange / prevClose) * 100 : null;
  const lastFetchStr   = lastFetchTime
    ? new Date(lastFetchTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;
  const goldfishReturn = startPortfolio ? ((portfolioTotal - startPortfolio) / startPortfolio * 100) : null;
  const buyHoldReturn  = (startPrice && livePrice) ? ((livePrice - startPrice) / startPrice * 100) : null;
  const fishWinning    = goldfishReturn != null && buyHoldReturn != null && goldfishReturn > buyHoldReturn;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>

      {/* ── Mode Toggle ──────────────────────────────────────────────────── */}
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

        {/* ── Live stock info bar ─────────────────────────────────────── */}
        {gameMode === 'live' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <TextField
              label="Ticker" size="small" value={tickerInput}
              onChange={e => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={e => {
                if (e.key === 'Enter') { const s = tickerInput.trim().toUpperCase(); setTicker(s); fetchStockPrice(s, finnhubKey); }
              }}
              inputProps={{ style: { width: 60, fontWeight: 'bold' } }}
              sx={{ width: 100 }}
            />
            <Button size="small" variant="outlined" onClick={() => { const s = tickerInput.trim().toUpperCase(); setTicker(s); fetchStockPrice(s, finnhubKey); }}>
              Go
            </Button>
            {isFetching && <CircularProgress size={18} />}
            {!isFetching && livePrice != null && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Typography variant="h6" fontWeight="bold" sx={{ lineHeight: 1 }}>
                  ${livePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Typography>
                {priceChange != null && priceChangePct != null && (
                  <Chip size="small"
                    label={`${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)} (${priceChange >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}%)`}
                    color={priceChange >= 0 ? 'success' : 'error'} sx={{ fontWeight: 'bold', fontSize: 12 }}
                  />
                )}
                <Tooltip title={`Last updated: ${lastFetchStr} · refreshes every 15s`}>
                  <Chip size="small" icon={<RefreshIcon sx={{ fontSize: '14px !important' }} />}
                    label="LIVE" color="success" variant="outlined" sx={{ fontSize: 11, cursor: 'default' }}
                  />
                </Tooltip>
              </Box>
            )}
            {stockError && <Typography variant="caption" color="error.main">{stockError}</Typography>}
          </Box>
        )}
      </Box>

      {/* ── Fish title ────────────────────────────────────────────────────── */}
      <Typography variant="subtitle2" color="text.secondary" sx={{ mt: -1 }}>
        {gameMode === 'live'
          ? `🐠 ${fishName} is managing your ${ticker} portfolio`
          : `🐠 ${fishName} is your random stock trader`}
      </Typography>

      {/* ── Canvases ──────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 4, flexWrap: 'wrap' }}>
        <canvas ref={canvasRef} width={500} height={400}
          style={{ background: '#e8f4f8', borderRadius: '50%', border: '3px solid rgba(148,198,222,0.5)', boxShadow: '0 8px 32px rgba(0,100,180,0.15)' }}
        />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
          <canvas ref={timerCanvasRef} width={200} height={200}
            style={{ background: '#fff', border: '1px solid #ccc', borderRadius: 8 }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2">Window:</Typography>
            <ButtonGroup size="small">
              {[{ v: 60, l: '1m' }, { v: 300, l: '5m' }, { v: 1200, l: '20m' }].map(({ v, l }) => (
                <Button key={v} variant={graphWindow === v ? 'contained' : 'outlined'}
                  onClick={() => setGraphWindow(v)}
                  sx={{ color: graphWindow === v ? '#fff' : 'inherit' }}
                >{l}</Button>
              ))}
            </ButtonGroup>
          </Box>
          <canvas ref={balanceCanvasRef} width={300} height={180}
            style={{ background: '#fff', border: '1px solid #ccc', borderRadius: 8 }}
          />
        </Box>
      </Box>

      {/* ── Last trade label ──────────────────────────────────────────────── */}
      {lastLabel && (
        <Box sx={{ mt: 0.5, fontStyle: 'italic', color: 'text.secondary', fontSize: 14 }}>
          💬 {lastLabel}
        </Box>
      )}

      {/* ── Portfolio display ─────────────────────────────────────────────── */}
      {gameMode === 'random' ? (
        <>
          <Typography variant="h4" fontWeight="bold">Balance: ${balance.toFixed(2)}</Typography>
          <Typography variant="body1">
            Stocks: {stocks} (${(stocks * PRICE_PER_STOCK).toFixed(2)} @ $10/share)
          </Typography>
        </>
      ) : (
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="h4" fontWeight="bold">
            Portfolio: ${portfolioTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Typography>
          <Box sx={{ display: 'flex', gap: 3, justifyContent: 'center', mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Cash: <strong>${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {ticker}: <strong>{stocks} shares</strong>
              {livePrice != null && (
                <> @ ${livePrice.toFixed(2)} = <strong>${(stocks * livePrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></>
              )}
            </Typography>
          </Box>

          {/* ── Beat the market comparison ─────────────────────────────── */}
          {goldfishReturn != null && buyHoldReturn != null && (
            <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Chip
                icon={<span style={{ fontSize: 16 }}>🐠</span>}
                label={`${fishName}: ${goldfishReturn >= 0 ? '+' : ''}${goldfishReturn.toFixed(2)}%`}
                color={goldfishReturn >= 0 ? 'success' : 'error'}
                variant="outlined" sx={{ fontWeight: 'bold', fontSize: 13 }}
              />
              <Typography variant="body2" color="text.secondary">vs</Typography>
              <Chip
                icon={<span style={{ fontSize: 16 }}>📈</span>}
                label={`Hold ${ticker}: ${buyHoldReturn >= 0 ? '+' : ''}${buyHoldReturn.toFixed(2)}%`}
                color={buyHoldReturn >= 0 ? 'success' : 'error'}
                variant="outlined" sx={{ fontWeight: 'bold', fontSize: 13 }}
              />
              {fishWinning
                ? <Chip icon={<EmojiEventsIcon />} label={`${fishName} wins! 🏆`} color="warning" sx={{ fontWeight: 'bold', fontSize: 13 }} />
                : <Chip label={`Market wins 😅`} color="default" variant="outlined" sx={{ fontWeight: 'bold', fontSize: 13 }} />
              }
            </Box>
          )}
        </Box>
      )}

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <Button variant="contained" color="primary" onClick={togglePaused}
        startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />}
        sx={{ mt: 1, color: '#fff', backgroundColor: paused ? '#2e7d32' : '#1976d2',
          '&:hover': { backgroundColor: paused ? '#1b5e20' : '#115293' } }}
      >
        {paused ? 'Resume' : 'Pause'}
      </Button>

      <Button variant="outlined" onClick={() => setShowOptions(v => !v)} sx={{ mt: 1 }}>
        {showOptions ? 'Hide Options' : 'Show Options'}
      </Button>

      {showOptions && (
        <Box sx={{ width: 360, p: 2, border: '1px solid #ccc', borderRadius: 2, backgroundColor: '#fafafa' }}>

          {gameMode === 'live' && (
            <Box sx={{ mb: 3, pb: 2, borderBottom: '1px solid #e0e0e0' }}>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>Finnhub API Key</Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 0.5 }}>
                <TextField label="API Key" size="small" type="password" value={finnhubKeyInput}
                  onChange={e => setFinnhubKeyInput(e.target.value)} fullWidth placeholder="your_key" />
                <Button variant="outlined" onClick={() => {
                  const k = finnhubKeyInput.trim();
                  setFinnhubKey(k); localStorage.setItem('finnhub_key', k);
                  if (k) fetchStockPrice(ticker, k);
                }}>Save</Button>
              </Box>
              <Typography variant="caption" color="text.secondary">
                Free key at <a href="https://finnhub.io" target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>finnhub.io</a> — stored locally only.
              </Typography>
            </Box>
          )}

          <Box sx={{ mb: 1, fontWeight: 'bold' }}>Ball Speed: {speed.toFixed(1)}x</Box>
          <Slider value={speed} onChange={(_, v) => setSpeed(v as number)} min={0.1} max={3} step={0.1} marks valueLabelDisplay="auto" />

          <Box sx={{ mt: 3, mb: 1, fontWeight: 'bold' }}>Timer Range (seconds)</Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField label="Min" type="number" size="small" value={timerRange[0]}
              onChange={e => { const n = Math.max(1, Math.min(120, Number(e.target.value) || 1)); setTimerRange([n, Math.max(n, timerRange[1])]); }}
              inputProps={{ min: 1, max: 120 }} />
            <TextField label="Max" type="number" size="small" value={timerRange[1]}
              onChange={e => { const n = Math.max(1, Math.min(120, Number(e.target.value) || 1)); setTimerRange([Math.min(timerRange[0], n), n]); }}
              inputProps={{ min: 1, max: 120 }} />
            <Button variant="outlined" onClick={() => {
              const [lo, hi] = timerRange;
              const cLo = Math.max(1, Math.min(120, lo)), cHi = Math.max(cLo, Math.min(120, hi));
              setTimerRange([cLo, cHi]); setElapsedTime(0); setTimerDuration(getRandTimer(cLo, cHi));
            }}>Apply</Button>
          </Box>

          <Box sx={{ mt: 3, display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField label="Add shares" type="number" size="small" value={addAmount}
              onChange={e => setAddAmount(Number(e.target.value) || 0)} inputProps={{ min: 0 }} />
            <Button variant="contained" onClick={() => setStocks(p => p + Math.max(0, Math.floor(addAmount)))}
              sx={{ color: '#fff', backgroundColor: '#1976d2', '&:hover': { backgroundColor: '#115293' } }}>Add</Button>
          </Box>

          <Box sx={{ mt: 3, display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField label="Add cash ($)" type="number" size="small" value={addCash}
              onChange={e => setAddCash(Number(e.target.value) || 0)} inputProps={{ min: 0 }} />
            <Button variant="contained" onClick={() => setBalance(p => p + Math.max(0, addCash))}
              sx={{ color: '#fff', backgroundColor: '#1976d2', '&:hover': { backgroundColor: '#115293' } }}>Add $</Button>
          </Box>

          <Accordion sx={{ mt: 3 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle1">Trade History ({history.length})</Typography>
            </AccordionSummary>
            <AccordionDetails>
              {history.length === 0
                ? <Typography color="text.secondary">No trades yet.</Typography>
                : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    {history.slice().reverse().map((h, i) => (
                      <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, gap: 1 }}>
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
