import React, { createContext, useContext, useState, useEffect } from 'react';
import { ThemeProvider as MuiThemeProvider, createTheme, Theme } from '@mui/material/styles';

type ThemeMode = 'light' | 'dark';
// What the reader chose. `mode` above is always the RESOLVED light/dark that the app renders
// from; this is the preference behind it, where 'system' means "follow the device".
export type ThemePref = 'light' | 'dark' | 'system';

// ─── Surfaces ──────────────────────────────────────────────────────────────────
//
// The page, the cards on it, and what floats over it. Settled Oct 11, 2026 after a look at Material 3,
// Apple's HIG, GitHub Primer, Radix, Vercel's Geist and Linear, which agree on the shape of it:
//
//   - A LIGHTER DARK SURFACE MEANS "CLOSER". Apple calls it elevated and gives it to sheets and
//     popovers; Material 3 lifts a surface to say it overlaps. A page whose every card is lifted says
//     nothing with it, and reads as grey boxes holding grey boxes. So in dark mode a card is the page
//     colour and its outline alone draws it (`flat`), and the lifted tone is spent only on what
//     actually floats: sheets, the side panel, menus, popovers, the bottom bar. That is `raised`,
//     reached as `background.raised`, and every ModalShell re-points `background.paper` at it for
//     everything inside, so a sticky header in a sheet still matches the sheet.
//   - NEAR-BLACK, NOT BLACK: pure black costs readability (halation on white text) for a battery
//     saving of a fraction of a percent, and leaves no room under a lifted surface.
//   - FILLS AS WHITE AT LOW ALPHA (`action.hover`), so a stripe or a hover works on any surface.
//
// Light mode keeps white cards on an off-white page, which is the standard light pattern and has
// none of the dark problem. The six skins this replaced were a dev A/B picker; the knobs below are
// the same idea at the level the research actually argued about, and DevSettings drives them.

export type DarkPage = 'charcoal' | 'neutral' | 'deep' | 'slate' | 'dim';

/** The dark page candidates. Charcoal is the shipped one; the rest bracket it. */
export const DARK_PAGES: Record<DarkPage, { label: string; hex: string }> = {
  charcoal: { label: 'Charcoal', hex: '#0f1115' },
  neutral:  { label: 'Neutral',  hex: '#111214' },
  deep:     { label: 'Deep',     hex: '#0a0b0d' },
  slate:    { label: 'Slate',    hex: '#0d1117' },
  dim:      { label: 'Dim',      hex: '#14181f' },
};

export interface SurfacePrefs {
  darkPage: DarkPage;
  /** `flat`: a card is the page colour and its outline. `raised`: a card is the lifted tone. */
  darkCards: 'flat' | 'raised';
  /** How far a floating surface lifts off the dark page, as white mixed into it. */
  darkLift: number;
  /** A card's outline in dark mode, as white alpha. Row rules (`divider`) stay at 0.22. */
  darkOutline: number;
  /** Hover, stripes and other subtle fills in dark mode (`action.hover`), as white alpha. */
  darkFill: number;
  /** A card's outline in light mode, as black alpha. */
  lightOutline: number;
}

export const DEFAULT_SURFACES: SurfacePrefs = {
  darkPage: 'charcoal',
  darkCards: 'flat',
  // 4% white over charcoal lands on about the grey cards used to be, so a sheet looks as it did.
  darkLift: 0.04,
  // THE OUTLINES ARE HELD TO 3:1 AGAINST THE PAGE, WCAG's floor for the edge of a component
  // (CLAUDE.md, "Borders"). 0.28 and 0.34 measured 2.49:1 and 2.36:1, so an outline was the faintest
  // thing a reader had to see to tell where one card ended; 0.34 and 0.42 are where 3:1 lands on
  // these pages, and these sit a step above so rounding cannot drop them under it. The layout
  // sweep checks every drawn border against this floor in both themes.
  darkOutline: 0.36,
  darkFill: 0.08,
  lightOutline: 0.44,
};

/** What DevSettings offers for each number. */
export const SURFACE_CHOICES = {
  darkLift: [0.025, 0.04, 0.06, 0.08],
  darkOutline: [0.22, 0.28, 0.36, 0.46],
  darkFill: [0.04, 0.06, 0.08],
  lightOutline: [0.26, 0.34, 0.44, 0.52],
} as const;

const LIGHT_PAGE = '#f6f7f9';
const PRIMARY = { dark: '#60a5fa', light: '#2563eb' };

/** `hex` with `a` of white mixed in, as a hex: an opaque lifted tone, so it can sit under text,
 *  be a sticky header's fill and be spread into a gradient. */
function mixWhite(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const c = (n >> shift) & 255;
    return Math.round(c + (255 - c) * a).toString(16).padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** The resolved colours for one mode. Exposed so App.tsx can tint the header to the page. */
export interface Surfaces {
  page: string;
  card: string;
  raised: string;
  headerBg: string;
  cardBorder: string;
  fill: string;
}

export function resolveSurfaces(p: SurfacePrefs, mode: ThemeMode): Surfaces {
  if (mode === 'light') {
    return {
      page: LIGHT_PAGE, card: '#ffffff', raised: '#ffffff',
      headerBg: rgba(LIGHT_PAGE, 0.8),
      cardBorder: `rgba(0,0,0,${p.lightOutline})`,
      fill: 'rgba(0,0,0,0.04)',
    };
  }
  const page = DARK_PAGES[p.darkPage]?.hex ?? DARK_PAGES.charcoal.hex;
  const raised = mixWhite(page, p.darkLift);
  return {
    page, raised,
    card: p.darkCards === 'flat' ? page : raised,
    headerBg: rgba(page, 0.72),
    cardBorder: `rgba(255,255,255,${p.darkOutline})`,
    fill: `rgba(255,255,255,${p.darkFill})`,
  };
}

const SURFACES_KEY = 'sdSurfaces';

function readSurfaces(): SurfacePrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(SURFACES_KEY) ?? 'null') as Partial<SurfacePrefs> | null;
    const merged = { ...DEFAULT_SURFACES, ...(saved ?? {}) };
    if (!(merged.darkPage in DARK_PAGES)) merged.darkPage = DEFAULT_SURFACES.darkPage;
    return merged;
  } catch {
    return DEFAULT_SURFACES;
  }
}

declare module '@mui/material/styles' {
  interface Palette {
    /** THE EDGE OF A THING: a card, a chip, a button, a box nested in a card. Held to 3:1 against
     *  the page (CLAUDE.md, "Borders"), where `divider` is the lighter rule BETWEEN rows. Usable in
     *  any sx as `borderColor: 'outline'`, the same way `'divider'` is. */
    outline: string;
  }
  interface PaletteOptions {
    outline?: string;
  }
  interface TypeBackground {
    /** What floats over the page: sheets, panels, menus, the bottom bar. See Surfaces above. */
    raised: string;
  }
}

/** The theme for everything inside a floating surface: `background.paper` there IS the raised
 *  tone, so a card, a sticky table header or a pinned bar inside a sheet matches the sheet. */
export const raisedTheme = (outer: Theme): Theme => {
  // No app theme above (a test, or a component rendered on its own): nothing to re-point, and
  // MUI's default theme has no `raised` at all.
  const raised = outer?.palette?.background?.raised;
  if (!raised) return outer;
  return { ...outer, palette: { ...outer.palette, background: { ...outer.palette.background, paper: raised } } };
};

interface ThemeContextType {
  mode: ThemeMode;
  /** The reader's choice: an explicit light/dark, or 'system' to follow the device. */
  themePref: ThemePref;
  setThemePref: (p: ThemePref) => void;
  toggleTheme: () => void;
  surfacePrefs: SurfacePrefs;
  /** Dev only (DevSettings): try a surface setting. Persists in this browser. */
  setSurfacePrefs: (next: Partial<SurfacePrefs> | null) => void;
  surfaces: Surfaces;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

const createAppTheme = (mode: ThemeMode, prefs: SurfacePrefs): Theme => {
  const p = resolveSurfaces(prefs, mode);
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
        main: PRIMARY[mode],
      },
      secondary: {
        main: '#dc004e',
      },
      // The light values are MUI's own light-theme defaults. #4caf50 and #f44336 are its DARK-theme
      // tones, and as text on white (a W, a loss, a validation message) they measured 2.77:1 and
      // 3.68:1; these clear 4.5:1 on the page and on a card.
      success: {
        main: mode === 'dark' ? '#81c784' : '#2e7d32',
      },
      error: {
        main: mode === 'dark' ? '#f44336' : '#d32f2f',
      },
      background: {
        default: p.page,
        paper: p.card,
        raised: p.raised,
      },
      action: { hover: p.fill },
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
      // LIGHT'S DIVIDER IS THE SAME OMISSION AND IS MEASURABLY WORSE: MUI's stock
      // rgba(0,0,0,0.12) comes out at 1.32:1 on white paper and 1.31:1 on the page behind it,
      // against dark's 1.43:1, identical on every palette this app has tried because every light card is
      // #ffffff.
      //
      // 0.20 measures 1.61:1 (RGB 204 on white, a luminance delta of 31 levels up to 51).
      //
      // NOT 0.28, WHICH IS WHAT "MATCH THE DARK SIDE" WOULD MEAN. Black on white loses
      // contrast faster than white on black, so hitting dark's 2.06:1 here needs alpha 0.281,
      // and that is a visibly drawn grey rule around everything. Copying the ratio across
      // would be the wrong instinct anyway: a dark divider needs MORE ratio than a light one,
      // because dark surfaces sit near the display's black floor where panels compress (the
      // whole reason the Pixel report happened) and because glare in a dark room eats low
      // deltas. Light mode has neither problem.
      //
      // The real systems agree, and 1.61:1 is deliberately sat next to them: Material 3's
      // light `outlineVariant` (#CAC4D0 on #FFFBFE) is 1.61:1 while its DARK one is 1.79:1,
      // and GitHub Primer's light border is ~1.55:1. Both split the two modes the same way.
      ...(mode === 'light'
        ? { text: { disabled: 'rgba(0,0,0,0.58)' }, divider: 'rgba(0,0,0,0.20)' }
        : {}),

      // MUI'S STOCK DARK DIVIDER IS rgba(255,255,255,0.12), AND IT MEASURES 1.43:1 AGAINST
      // THIS APP'S CARD SURFACE. That is the line 257 borders in the app are drawn in: every
      // card outline, every row rule, every chip and input edge, on every palette tried
      // (measured 1.35:1 to 1.46:1 over the old grey cards). It was never set here, so the app
      // had simply inherited it.
      //
      // 1.43:1 is marginal on any screen and fails on some. Reported from a Pixel, where the
      // card outlines had effectively disappeared: an OLED panel renders true black and, at
      // low or adaptive brightness, resolves fewer levels near it, so a line sitting 28 RGB
      // levels above its background is exactly the kind of difference that collapses. The
      // same border on an LCD, or on a bright desk monitor, reads fine — which is why this
      // survived this long. It is not a device bug to work around; the contrast was too low
      // and the OLED was the first display honest enough to say so.
      //
      // 0.22 measures ~2.06:1 and roughly doubles the luminance delta (28 levels to 48). That
      // is deliberately NOT the 3:1 that WCAG 1.4.11 asks of a boundary that identifies a
      // control: 3:1 needs alpha 0.33, and at that weight every internal row rule in a stats
      // table becomes a hard grey line and the app reads like a spreadsheet. 2:1 is where
      // Material 3 puts its own decorative divider (`outlineVariant`), and it is a visible
      // edge on an OLED at low brightness, which is the thing that was broken.
      //
      // If a specific border ever needs to carry more than decoration (a focus ring, a
      // selected state, a control whose only boundary is its outline), it should say so at
      // its own call site rather than by dragging this token up under all 257.
      ...(mode === 'dark' ? { divider: 'rgba(255,255,255,0.22)' } : {}),

      // THE OUTLINE IS THAT SEPARATE TOKEN. Everything with an edge on all four sides draws it in
      // this, held to 3:1, while `divider` above stays the quieter rule between rows. Read through
      // the CSS variable so the surface settings in DevSettings move it live, like CARD_BORDER.
      outline: `var(--sd-card-border, ${p.cardBorder})`,
    },
    components: {
      // MUI's outlined controls draw their own edge at a stock weight (an input's at 23%, a chip's
      // and a toggle's at `divider`), all under 3:1. Pointed at the outline here, once, rather
      // than at every call site.
      MuiOutlinedInput: {
        styleOverrides: { notchedOutline: { borderColor: `var(--sd-card-border, ${p.cardBorder})` } },
      },
      MuiChip: {
        styleOverrides: { outlined: { borderColor: `var(--sd-card-border, ${p.cardBorder})` } },
      },
      MuiToggleButton: {
        styleOverrides: { root: { borderColor: `var(--sd-card-border, ${p.cardBorder})` } },
      },
      MuiButton: {
        styleOverrides: { outlined: { borderColor: `var(--sd-card-border, ${p.cardBorder})` } },
      },
      // EVERY MUI PAPER FLOATS: menus, popovers, dialogs, drawers and the toolbar's dropdowns. None
      // of the app's cards is an MUI Paper (they are Boxes on `background.paper`), so this gives
      // the raised tone to exactly the floating layer. `backgroundImage: none` drops MUI's dark
      // elevation overlay, which would lift each one a different amount by its `elevation` prop.
      MuiPaper: {
        styleOverrides: {
          root: { backgroundColor: p.raised, backgroundImage: 'none' },
        },
      },
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

export const AppThemeProvider: React.FC<AppThemeProviderProps> = ({ children }) => {
  // The reader's CHOICE. 'system' (the default, and what a never-toggled reader has always had)
  // follows the device; an explicit light/dark overrides it. `mode` below is the resolved value
  // everything renders from, so no consumer has to know 'system' exists.
  const [themePref, setThemePrefState] = useState<ThemePref>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    return 'system';
  });

  // The device's current scheme, tracked live so a 'system' reader flips with the OS (e.g. dark
  // mode turning on at sunset) while the app is open.
  const [systemDark, setSystemDark] = useState(prefersDark);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const mode: ThemeMode = themePref === 'system' ? (systemDark ? 'dark' : 'light') : themePref;

  // The surface settings. Shipped as DEFAULT_SURFACES; DevSettings can try others in this browser.
  const [surfacePrefs, setSurfacePrefsState] = useState<SurfacePrefs>(readSurfaces);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    // Match the first-paint bootstrap in index.html: native form controls and scrollbars follow
    // the resolved mode, not just the CSS palette, so a runtime switch is complete.
    document.documentElement.style.colorScheme = mode;
  }, [mode]);

  const surfaces = resolveSurfaces(surfacePrefs, mode);

  // The <body> background and the pre-hydration chrome are painted by styles.css from these vars,
  // and every card outline reads `--sd-card-border` (CARD_BORDER in src/ui/card.tsx), so a setting
  // moves the whole site without re-rendering a single card.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--bg-color', surfaces.page);
    root.style.setProperty('--card-bg', surfaces.card);
    root.style.setProperty('--sd-card-border', surfaces.cardBorder);
  }, [surfaces.page, surfaces.card, surfaces.cardBorder]);

  const setThemePref = (p: ThemePref) => {
    localStorage.setItem('theme', p);
    setThemePrefState(p);
  };

  // The header sun/moon button: flips to the opposite of what is showing and makes it explicit.
  // From 'system' this lands on a concrete choice, which is what a reader tapping it wants.
  const toggleTheme = () => setThemePref(mode === 'light' ? 'dark' : 'light');

  const setSurfacePrefs = (next: Partial<SurfacePrefs> | null) => {
    const merged = next ? { ...surfacePrefs, ...next } : DEFAULT_SURFACES;
    try {
      if (next) localStorage.setItem(SURFACES_KEY, JSON.stringify(merged));
      else localStorage.removeItem(SURFACES_KEY);
    } catch { /* private mode: the setting lasts this visit */ }
    setSurfacePrefsState(merged);
  };

  const theme = createAppTheme(mode, surfacePrefs);

  return (
    <ThemeContext.Provider value={{ mode, themePref, setThemePref, toggleTheme, surfacePrefs, setSurfacePrefs, surfaces }}>
      <MuiThemeProvider theme={theme}>
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
};
