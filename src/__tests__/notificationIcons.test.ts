// ─── Stored notifications never keep the softball ─────────────────────────────
//
// WPBL is baseball. The reminder catalog shipped the softball glyph for a while, and
// because the emoji is baked into the push payload and stored on arrival, correcting
// the catalog left every already-delivered notification wrong on screen for the rest
// of its two-week life. The store rewrites the retired glyph when it reads
// localStorage; this pins that, and pins that it rewrites nothing else.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const STORAGE_KEY = 'sd_notifications'
const SOFTBALL = '\u{1F94E}'
const BASEBALL = '⚾'
const TROPHY   = '\u{1F3C6}'

function seed(icon: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    items: [{
      id: 'wpbl-game-start-123',
      type: 'wpbl_game_start',
      title: 'WPBL game starting soon',
      body: 'Boston Hunters @ San Francisco Sea Lions. First pitch in 30 min.',
      url: '/wpbl?view=home',
      icon,
      source: 'event',
      createdAt: Date.now(),
      read: false,
    }],
  }))
}

async function firstIcon(): Promise<string> {
  const { useNotifications } = await import('../lib/notifications')
  const { result } = renderHook(() => useNotifications())
  return result.current.items[0].icon
}

describe('stored notification icons', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('rewrites a stored softball to a baseball', async () => {
    seed(SOFTBALL)
    expect(await firstIcon()).toBe(BASEBALL)
  })

  it('leaves an icon that was never retired alone', async () => {
    seed(TROPHY)
    expect(await firstIcon()).toBe(TROPHY)
  })
})
