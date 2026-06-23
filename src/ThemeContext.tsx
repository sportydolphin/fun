import React, { createContext, useContext, useState, useEffect } from 'react';
import { ThemeProvider as MuiThemeProvider, createTheme, Theme } from '@mui/material/styles';

type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
  mode: ThemeMode;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

const createAppTheme = (mode: ThemeMode): Theme => createTheme({
  palette: {
    mode,
    primary: {
      main: mode === 'dark' ? '#90caf9' : '#1976d2',
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
      default: mode === 'dark' ? '#121212' : '#fafafa',
      paper: mode === 'dark' ? '#1e1e1e' : '#ffffff',
    },
  },
  typography: {
    h4: {
      fontWeight: 700,
    },
  },
});

interface AppThemeProviderProps {
  children: React.ReactNode;
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  const toggleTheme = () => {
    setMode(prev => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', next);
      return next;
    });
  };

  const theme = createAppTheme(mode);

  return (
    <ThemeContext.Provider value={{ mode, toggleTheme }}>
      <MuiThemeProvider theme={theme}>
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
};