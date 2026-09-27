import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { isChunkLoadError, reloadForNewBuild } from '../lib/staleBuild'
import { AppErrorBoundary } from '../AppErrorBoundary'

// A page left open across a deploy asks for lazy chunks the new build no longer has. Before this,
// the rejected import unmounted the whole app: a blank screen until the reader reloaded by hand.

const reload = vi.fn()
beforeEach(() => {
  sessionStorage.clear()
  reload.mockReset()
  vi.stubGlobal('location', { ...window.location, reload })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('isChunkLoadError', () => {
  it('knows each engine’s wording for a failed chunk', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true)
  })
  it('leaves every other error alone', () => {
    expect(isChunkLoadError(new TypeError('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})

describe('reloadForNewBuild', () => {
  // A chunk that fails for another reason (offline, a broken deploy) fails again after the
  // reload, and reloading on every failure would loop forever.
  it('reloads once, then refuses inside the window', () => {
    expect(reloadForNewBuild()).toBe(true)
    expect(reloadForNewBuild()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

function Throws({ error }: { error: Error }): never { throw error }

describe('AppErrorBoundary', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })

  it('reloads for a stale chunk instead of going blank', () => {
    render(<AppErrorBoundary><Throws error={new TypeError('Failed to fetch dynamically imported module: /assets/x.js')} /></AppErrorBoundary>)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toContain('Loading the latest version')
  })

  it('offers a button when the reload has already been tried', () => {
    sessionStorage.setItem('sd_stale_build_reload_at', String(Date.now()))
    render(<AppErrorBoundary><Throws error={new TypeError('Failed to fetch dynamically imported module: /assets/x.js')} /></AppErrorBoundary>)
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByText('The site was just updated')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('never renders blank for any other crash', () => {
    render(<AppErrorBoundary><Throws error={new Error('boom')} /></AppErrorBoundary>)
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByText('Something went wrong')).toBeTruthy()
  })
})

// A crash in one board must cost that board, not the page: the toolbar and nav live outside the
// inline boundary, and moving to another path clears it.
describe('AppErrorBoundary, inline', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })

  function Page({ broken }: { broken: boolean }) {
    if (broken) throw new Error('boom')
    return <p>the other page</p>
  }

  it('keeps what is outside it, and clears when the key moves on', () => {
    const { rerender } = render(
      <div><nav>toolbar</nav><AppErrorBoundary inline resetKey="/wpbl/stats"><Page broken /></AppErrorBoundary></div>)
    expect(screen.getByText('toolbar')).toBeTruthy()
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    rerender(<div><nav>toolbar</nav><AppErrorBoundary inline resetKey="/wpbl/schedule"><Page broken={false} /></AppErrorBoundary></div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('the other page')).toBeTruthy()
  })
})
