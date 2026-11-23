import { describe, it, expect } from 'vitest'
import { referrerHost, campaignOf } from '../lib/landing'
import { isBotAgent } from '../lib/analytics'
import { routeOf } from '../lib/webVitals'

// What a `landed` row may carry, and who never writes one. The referrer is reduced to its host
// because a full URL can hold someone's search or a private thread; the crawlers are refused
// because Google's renderer is a new "browser" on every page it draws.

describe('referrerHost', () => {
  it('keeps the host and nothing else', () => {
    expect(referrerHost('https://www.google.com/search?q=private+thing', 'sportydolphin.fun')).toBe('google.com')
    expect(referrerHost('https://l.instagram.com/?u=https%3A%2F%2Fx', 'sportydolphin.fun')).toBe('l.instagram.com')
  })
  it('names an Android app by its package', () => {
    expect(referrerHost('android-app://com.google.android.gm/', 'sportydolphin.fun')).toBe('com.google.android.gm')
  })
  it('calls this site self, and no referrer null', () => {
    expect(referrerHost('https://sportydolphin.fun/wpbl', 'www.sportydolphin.fun')).toBe('self')
    expect(referrerHost('', 'sportydolphin.fun')).toBeNull()
    expect(referrerHost('not a url', 'sportydolphin.fun')).toBeNull()
  })
})

describe('campaignOf', () => {
  it('reads utm_source, lowercased and capped', () => {
    expect(campaignOf('?utm_source=Instagram&utm_medium=bio')).toBe('instagram')
    expect(campaignOf(`?utm_source=${'a'.repeat(60)}`)).toHaveLength(40)
  })
  it('names this site’s own short links', () => {
    expect(campaignOf('?ref=short')).toBe('short')
    expect(campaignOf('')).toBeNull()
  })
})

describe('isBotAgent', () => {
  it('refuses the crawlers that run JavaScript', () => {
    expect(isBotAgent('Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true)
    expect(isBotAgent('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0 Safari/537.36')).toBe(true)
    expect(isBotAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36')).toBe(true)
    expect(isBotAgent('Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)')).toBe(true)
  })
  it('lets people through, a phone brand ending in "bot" included', () => {
    expect(isBotAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe(false)
    expect(isBotAgent('Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36')).toBe(false)
    expect(isBotAgent('')).toBe(false)
    expect(isBotAgent(undefined)).toBe(false)
  })
})

describe('routeOf', () => {
  it('collapses a video page, whose id is the page', () => {
    expect(routeOf('/wpbl/watch/m4GsxVjMhEY')).toBe('/wpbl/watch/:id')
  })
})
