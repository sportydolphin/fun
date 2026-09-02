import React, { createContext, useContext, useState, useEffect } from 'react';
import { ThemeProvider as MuiThemeProvider, createTheme, Theme } from '@mui/material/styles';

type ThemeMode = 'light' | 'dark';

// A "skin" is a full surface + accent treatment, flippable so several dark-mode
// directions can be A/B'd side by side before committing to one. Every non-classic
// skin follows the same rules the research settled on: no pure-neutral #121212, a
// hue-tinted near-black background with a clearly lifted surface above it, an
// integrated (not lighter-slab) header, and an accent tuned so it doesn't bloom on
// the darker canvas. Backgrounds stay fairly desaturated on purpose — every card can
// carry one of 30 saturated team colors, so the canvas behind them has to stay calm.
//   classic  — the original stock-MUI palette (baseline reference, unchanged)
//   charcoal — neutral cool near-black, the safe premium default
//   slate    — GitHub-style blue-slate, most obvious elevation ramp
//   oled     — true black (#000) for OLED phones; surfaces lift just off black
//   midnight — richer deep-navy, most "brand"/night-ballpark character
//   dim      — soft, lifted, lower-contrast; the easy-on-the-eyes option
export type ThemeSkin = 'classic' | 'charcoal' | 'slate' | 'oled' | 'midnight' | 'dim';

// Order for the dev skin control.
export const SKIN_ORDER: ThemeSkin[] = ['classic', 'charcoal', 'slate', 'oled', 'midnight', 'dim'];

interface SkinModeColors {
  default: string;   // page background
  paper: string;     // card / surface
  primary: string;   // accent
  headerBg: string;  // translucent header fill (used when integratedHeader)
}
interface SkinDef {
  label: string;
  // classic keeps the flat gray AppBar slab; the rest use an integrated, blurred,
  // sticky header that matches the page tint.
  integratedHeader: boolean;
  dark: SkinModeColors;
  light: SkinModeColors;
}

const SKINS: Record<ThemeSkin, SkinDef> = {
  classic: {
    label: 'Classic',
    integratedHeader: false,
    dark:  { default: '#121212', paper: '#1e1e1e', primary: '#90caf9', headerBg: 'rgba(30,30,30,0.8)' },
    light: { default: '#fafafa', paper: '#ffffff', primary: '#1976d2', headerBg: 'rgba(255,255,255,0.8)' },
  },
  charcoal: {
    label: '🌑 Charcoal',
    integratedHeader: true,
    // Neutral cool near-black with a faint blue tint, and a surface lifted a clear
    // step above it. The safe, premium default: calm enough behind any team color.
    dark:  { default: '#0f1115', paper: '#181b22', primary: '#60a5fa', headerBg: 'rgba(15,17,21,0.72)' },
    light: { default: '#f6f7f9', paper: '#ffffff', primary: '#2563eb', headerBg: 'rgba(246,247,249,0.8)' },
  },
  slate: {
    label: '🪨 Slate',
    integratedHeader: true,
    // GitHub-style blue-slate: more blue in the grays, biggest background↔surface
    // delta, so the elevation ramp reads most clearly.
    dark:  { default: '#0d1117', paper: '#161b22', primary: '#58a6ff', headerBg: 'rgba(13,17,23,0.72)' },
    light: { default: '#f6f8fa', paper: '#ffffff', primary: '#0969da', headerBg: 'rgba(246,248,250,0.8)' },
  },
  oled: {
    label: '⬛ OLED',
    integratedHeader: true,
    // True black for OLED phones (pixels off = battery + infinite contrast). The
    // surface lifts just off black and the accent is nudged softer so it doesn't
    // halate against pure black.
    dark:  { default: '#000000', paper: '#0c0d10', primary: '#5aa9ff', headerBg: 'rgba(0,0,0,0.72)' },
    light: { default: '#f4f4f5', paper: '#ffffff', primary: '#2563eb', headerBg: 'rgba(244,244,245,0.82)' },
  },
  midnight: {
    label: '🌌 Midnight',
    integratedHeader: true,
    // Richer deep navy — the most "brand"/night-ballpark character. Kept in check so
    // navy team cards still separate from it.
    dark:  { default: '#0a1020', paper: '#121a2e', primary: '#6ba5ff', headerBg: 'rgba(10,16,32,0.74)' },
    light: { default: '#f5f7fb', paper: '#ffffff', primary: '#2557d6', headerBg: 'rgba(245,247,251,0.82)' },
  },
  dim: {
    label: '🌙 Dim',
    integratedHeader: true,
    // Soft and lifted, lower overall contrast — text sits on a lighter base than the
    // other darks. The "easy on the eyes for a long session" option.
    dark:  { default: '#14181f', paper: '#1d222c', primary: '#7cc4ff', headerBg: 'rgba(20,24,31,0.78)' },
    light: { default: '#f5f6f8', paper: '#ffffff', primary: '#2563eb', headerBg: 'rgba(245,246,248,0.82)' },
  },
};

// Resolve a skin's colors + header behavior for the active mode. Exposed so App.tsx
// can style the header to match the chosen skin.
export interface SkinConfig extends SkinModeColors {
  integratedHeader: boolean;
  label: string;
}
function resolveSkin(skin: ThemeSkin, mode: ThemeMode): SkinConfig {
  const def = SKINS[skin];
  return { ...def[mode], integratedHeader: def.integratedHeader, label: def.label };
}

// Skin key + label pairs, in order — for the dev dropdown.
export const SKIN_OPTIONS: { key: ThemeSkin; label: string }[] =
  SKIN_ORDER.map(k => ({ key: k, label: SKINS[k].label }));

interface ThemeContextType {
  mode: ThemeMode;
  toggleTheme: () => void;
  skin: ThemeSkin;
  setSkin: (s: ThemeSkin) => void;
  cycleSkin: () => void;
  skinConfig: SkinConfig;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

const createAppTheme = (mode: ThemeMode, skin: ThemeSkin): Theme => {
  const p = SKINS[skin][mode];
  return createTheme({
    // Every `p`, `m` and `gap` in the app, times the desktop chrome scale. This is what used to
    // come free with `zoom`, and it has to be here rather than at 500 call sites: padding that
    // stays at its phone value while the type around it grows 40% is not a smaller design, it
    // is a cramped one. MUI's default 8px base is preserved at a scale of 1, so mobile and
    // every unscaled route render exactly as before. Nothing in this codebase reads
    // `theme.spacing()` in JS, so returning a calc() string is safe.
    spacing: (factor: number) => `calc(${factor * 8}px * var(--app-chrome, 1))`,
    palette: {
      mode,
      primary: {
        main: p.primary,
      },
      secondary: {
        main: '#dc004e',
      },
      success: {
        main: mode === 'dark' ? '#81c784' : '#4caf50',
      },
      error: {
        main: '#f44336',
      },
      background: {
        default: p.default,
        paper: p.paper,
      },
      // MUI's stock `text.disabled` is rgba(0,0,0,0.38) in light mode, which measures 2.65:1
      // against this app's page background, well under the 4.5:1 AA needs. It would be
      // exempt if it were only doing what its name says (a disabled control is exempt from
      // the contrast rules), but across this app it is the de-facto TERTIARY text colour:
      // measured on the stats tab alone it carries the table's column headings, the position
      // codes, the rank numbers, the "33 players · 2026 season" caption and every footer
      // link. All of that is content, and content has to be readable.
      //
      // 0.58 measures ~5.0:1 while staying clearly recessed against text.primary (0.87) and
      // text.secondary (0.6), so a genuinely disabled control still reads as disabled, just
      // not as invisible. Dark mode's rgba(255,255,255,0.5) already measures 5.19:1 and is
      // left alone.
      //
      // The cleaner fix is a real tertiary token that disabled controls don't share; this is
      // the one-line version of it that fixes every call site at once.
      ...(mode === 'light' ? { text: { disabled: 'rgba(0,0,0,0.58)' } } : {}),
    },
    components: {
      // MUI'S OWN HOVER LATCHES ON TOUCH, exactly like the app's did. IconButton paints
      // `--IconButton-hoverBg` on `:hover`, a phone applies that state on TAP, and the
      // toolbar's search, bell, theme and account buttons then sat lit until you touched
      // something else. Four round grey blobs across the top of the app, one per control the
      // reader had most recently used.
      //
      // Fixed here rather than at the call sites because these come from MUI, not from us:
      // there is no `sx` of ours to gate. The section's own controls use `hoverOnly` in
      // src/wpbl/ui.tsx, and this is the same rule for the components we did not write.
      MuiIconButton: {
        styleOverrides: {
          root: {
            '@media (hover: none)': {
              '&:hover': { backgroundColor: 'transparent' },
            },
          },
        },
      },
    },
    typography: {
      // Self-hosted Inter (see @font-face in styles.css) leads the stack so headings get a
      // real 900 weight everywhere, not the Arial faux-bold fallback. System fonts follow
      // in case the woff2 hasn't loaded yet.
      fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      h4: {
        fontWeight: 700,
      },
    },
  });
};

interface AppThemeProviderProps {
  children: React.ReactNode;
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function isSkin(v: string | null): v is ThemeSkin {
  return !!v && (SKIN_ORDER as string[]).includes(v);
}

// The shipped default skin (both modes). `classic` is kept only as a reference in the
// dev picker. Change this one value to re-default the whole site.
export const DEFAULT_SKIN: ThemeSkin = 'charcoal';

export const AppThemeProvider: React.FC<AppThemeProviderProps> = ({ children }) => {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return prefersDark() ? 'dark' : 'light';
  });

  // Until the user explicitly picks a theme via the toggle button, keep
  // following the device's color scheme — including live changes (e.g.
  // system dark mode turning on at sunset) while the app is open.
  useEffect(() => {
    if (localStorage.getItem('theme')) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setMode(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Which visual skin to render. Defaults to DEFAULT_SKIN (charcoal); a saved choice
  // from the dev picker overrides it and persists for future A/B testing.
  const [skin, setSkinState] = useState<ThemeSkin>(() => {
    const saved = localStorage.getItem('themeSkin');
    return isSkin(saved) ? saved : DEFAULT_SKIN;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  useEffect(() => {
    document.documentElement.setAttribute('data-skin', skin);
  }, [skin]);

  // The <body> background is painted by styles.css via --bg-color, which is keyed on
  // [data-theme] alone and hardcoded to the classic palette. Push the active skin's
  // surfaces into those vars so the page (and the shared launcher chrome) tracks the
  // skin instead of showing #121212 behind everything on non-classic skins.
  useEffect(() => {
    const c = resolveSkin(skin, mode);
    const root = document.documentElement;
    root.style.setProperty('--bg-color', c.default);
    root.style.setProperty('--card-bg', c.paper);
  }, [skin, mode]);

  const toggleTheme = () => {
    setMode(prev => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', next);
      return next;
    });
  };

  const setSkin = (s: ThemeSkin) => {
    localStorage.setItem('themeSkin', s);
    setSkinState(s);
  };
  const cycleSkin = () => {
    const i = SKIN_ORDER.indexOf(skin);
    setSkin(SKIN_ORDER[(i + 1) % SKIN_ORDER.length]);
  };

  const theme = createAppTheme(mode, skin);
  const skinConfig = resolveSkin(skin, mode);

  return (
    <ThemeContext.Provider value={{ mode, toggleTheme, skin, setSkin, cycleSkin, skinConfig }}>
      <MuiThemeProvider theme={theme}>
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
};
