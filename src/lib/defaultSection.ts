// Which league section a bare visit to "/" opens on. WPBL is the site's default landing
// section; an MLB-first reader can flip it here so the root and a reopened PWA land on MLB
// instead. Device-local (no account needed), read by App's root redirect and written by
// Settings, so the two never disagree about where "/" goes.

export type DefaultSection = 'wpbl' | 'mlb'

const KEY = 'defaultSection'

export function getDefaultSection(): DefaultSection {
  try { return localStorage.getItem(KEY) === 'mlb' ? 'mlb' : 'wpbl' } catch { return 'wpbl' }
}

export function setDefaultSection(s: DefaultSection): void {
  try { localStorage.setItem(KEY, s) } catch { /* private mode / storage off */ }
}

/** The path "/" resolves to, given the stored preference. */
export function defaultSectionPath(): '/wpbl' | '/mlb' {
  return getDefaultSection() === 'mlb' ? '/mlb' : '/wpbl'
}
