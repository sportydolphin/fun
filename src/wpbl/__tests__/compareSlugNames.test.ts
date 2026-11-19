// The compare page's loading title ghosts the names the address spells, so it wraps onto as many
// lines as the real title will. With a fixed "Firstn Lastnm vs Firstn Lastnm" it took two lines on a
// phone, the real pair took one, and every card jumped 29px when the roster landed.
import { describe, it, expect } from 'vitest'
import { namesFromCompareSlug } from '../Compare'

describe('names from a compare address', () => {
  it('splits a pair and capitalizes each word', () => {
    expect(namesFromCompareSlug('emi-saiki-vs-ayami-sato')).toEqual(['Emi Saiki', 'Ayami Sato'])
  })
  it('drops a shared name’s id suffix and keeps a hyphenated surname', () => {
    expect(namesFromCompareSlug('ela-day-bedard-vs-jane-doe-1a2b3c4d')).toEqual(['Ela Day Bedard', 'Jane Doe'])
  })
  it('reads one player from a half-made choice', () => {
    expect(namesFromCompareSlug('kelsie-whitmore')).toEqual(['Kelsie Whitmore'])
  })
})
