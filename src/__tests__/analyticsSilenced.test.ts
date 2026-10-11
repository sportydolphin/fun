// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { silenced } from '../lib/analytics'

// The dev server talks to the production project, so until Oct 10, 2026 every local session wrote
// real rows: most of the site's app_error reports were one developer's hot reloads.

afterEach(() => { vi.unstubAllEnvs(); localStorage.clear() })

describe('silenced', () => {
  it('refuses a test run', () => {
    expect(silenced()).toBe(true)
  })
  it('refuses the dev server', () => {
    vi.stubEnv('MODE', 'development')
    vi.stubEnv('DEV', true)
    expect(silenced()).toBe(true)
  })
  it('lets a dev build send when asked to, for watching a new event arrive', () => {
    vi.stubEnv('MODE', 'development')
    vi.stubEnv('DEV', true)
    localStorage.setItem('sdDevTrack', '1')
    expect(silenced()).toBe(false)
  })
  it('sends from a production build, where the opt-in is never read', () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('DEV', false)
    expect(silenced()).toBe(false)
  })
})
