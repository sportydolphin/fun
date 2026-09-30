import { describe, it, expect } from 'vitest'
import { playableIn, ASSUMED_COUNTRY } from '../videoChannels'
import { onRequestGet } from '../../../functions/api/geo'

// The league's full-game broadcasts are blocked in the United States. A video shown to a reader
// whose country cannot play it embeds as "Video unavailable", so the rule and the country it is
// asked about are pinned here. Both failures are silent: a wrong rule is a dead button, a wrong
// country hides a video from someone who could have watched it.

describe('playableIn', () => {
  const everywhere = { region_allowed: null, region_blocked: null }
  const blockedInUs = { region_allowed: null, region_blocked: ['CA', 'US'] }
  const onlyCanada = { region_allowed: ['CA'], region_blocked: null }

  it('plays a video with no restriction anywhere, including one never checked', () => {
    expect(playableIn(everywhere, 'US')).toBe(true)
    expect(playableIn({}, 'GB')).toBe(true)
  })

  it('hides a video from a country on its blocked list, and only there', () => {
    expect(playableIn(blockedInUs, 'US')).toBe(false)
    expect(playableIn(blockedInUs, 'GB')).toBe(true)
  })

  it('reads an allow-list as ONLY those countries', () => {
    expect(playableIn(onlyCanada, 'CA')).toBe(true)
    expect(playableIn(onlyCanada, 'US')).toBe(false)
  })

  // Unknown is the dev server and a failed lookup. Treated as the US, where most readers are:
  // hiding a broadcast from a reader abroad is the cheaper mistake than a dead player at home.
  it('treats an unknown country as the assumed one', () => {
    expect(ASSUMED_COUNTRY).toBe('US')
    expect(playableIn(blockedInUs, null)).toBe(false)
    expect(playableIn(everywhere, null)).toBe(true)
  })
})

describe('/api/geo', () => {
  const ask = async (cf: { country?: string } | undefined, header?: string) => {
    const request = Object.assign(new Request('https://sportydolphin.fun/api/geo', {
      headers: header ? { 'cf-ipcountry': header } : {},
    }), { cf })
    const res = await onRequestGet({ request })
    return { body: await res.json(), cache: res.headers.get('cache-control') }
  }

  it("returns Cloudflare's country for the request", async () => {
    expect((await ask({ country: 'GB' })).body).toEqual({ country: 'GB' })
    expect((await ask(undefined, 'CA')).body).toEqual({ country: 'CA' })
  })

  it("maps Cloudflare's unknown and Tor codes to null rather than a country", async () => {
    expect((await ask({ country: 'XX' })).body).toEqual({ country: null })
    expect((await ask({ country: 'T1' })).body).toEqual({ country: null })
    expect((await ask(undefined)).body).toEqual({ country: null })
  })

  // Per reader: a shared cache that kept one reader's answer would hand it to the next.
  it('is never cached by anything between here and the browser', async () => {
    expect((await ask({ country: 'US' })).cache).toBe('private, no-store')
  })
})
