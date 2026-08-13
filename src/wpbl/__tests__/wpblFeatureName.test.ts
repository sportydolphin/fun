import { describe, it, expect } from 'vitest'
import { wpblFeatureName } from '../ui'

// The featured-row name rule (stat-leader cards + Hall of Firsts). Its interesting behaviour
// is the part that CAN'T be seen on the site today: every current WPBL name fits inside the
// budget and passes through untouched, so the shortening stages only ever run for a future
// signing. That's exactly what's worth pinning down here.

const MAX = 26 // FEATURE_NAME_MAX in Home.tsx

describe('wpblFeatureName', () => {
  describe('stage 1 — fits, untouched', () => {
    // Every name currently on a WPBL roster should render in full at the real budget.
    it.each([
      'Kelsie Whitmore',
      'Jill Albayati',
      'Denae Benites',
      'Meggie Meidlinger',
      'Claire O\'Sullivan',
      'Rosi del Castillo',
      'Bella Espinoza Molina',
      'Flor Elena Valerio Montoya', // the longest on any roster, exactly at the budget
    ])('leaves %s alone', name => {
      expect(wpblFeatureName(name, MAX)).toBe(name)
    })
  })

  describe('stage 2 — first initial, rest intact', () => {
    it('abbreviates only the given name when that is enough', () => {
      expect(wpblFeatureName('Alexandria Featherstone', 20)).toBe('A. Featherstone')
    })

    it('keeps middle names when the result still fits', () => {
      expect(wpblFeatureName('Flor Elena Valerio Montoya', 24)).toBe('F. Elena Valerio Montoya')
    })
  })

  describe('stage 3 — first initial + surname only', () => {
    it('drops middle names once "F. Rest" is still too long', () => {
      expect(wpblFeatureName('Flor Elena Valerio Montoya', 20)).toBe('F. Montoya')
    })

    it('keeps a lowercase particle attached to the surname', () => {
      // "R. Castillo" would be wrong — the particle is part of the surname.
      expect(wpblFeatureName('Rosalinda Margarita del Castillo', 20)).toBe('R. del Castillo')
    })

    it('keeps a multi-word particle chain attached', () => {
      expect(wpblFeatureName('Maria Alejandra de la Cruz', 20)).toBe('M. de la Cruz')
    })

    it('matches particles case-insensitively', () => {
      expect(wpblFeatureName('Johanna Wilhelmina Van Der Berg', 20)).toBe('J. Van Der Berg')
    })

    it('never strips so far that only a particle remains', () => {
      // The guard stops at index 1, so the surname can never collapse to just "de".
      const out = wpblFeatureName('Ana de de de de de de de Sousa', 12)
      expect(out.startsWith('A. ')).toBe(true)
      expect(out).not.toBe('A. de')
    })
  })

  describe('stage precedence', () => {
    // Each stage is tried in order and the FIRST that fits wins, so the most informative
    // form that still fits is the one shown — a budget of exactly the stage-2 length keeps
    // the middle names rather than falling through to surname-only.
    it('prefers stage 2 when it lands exactly on the budget', () => {
      expect(wpblFeatureName('Rosalinda Margarita del Castillo', 25)).toBe('R. Margarita del Castillo')
    })

    it('falls to stage 3 one character below that', () => {
      expect(wpblFeatureName('Rosalinda Margarita del Castillo', 24)).toBe('R. del Castillo')
    })
  })

  describe('edge cases', () => {
    it('never abbreviates a single-token name — there is nothing to abbreviate to', () => {
      expect(wpblFeatureName('Ichiro', 3)).toBe('Ichiro')
    })

    it('trims surrounding whitespace', () => {
      expect(wpblFeatureName('  Kelsie Whitmore  ', MAX)).toBe('Kelsie Whitmore')
    })

    it('collapses irregular inner whitespace when it shortens', () => {
      expect(wpblFeatureName('Alexandria   Jane   Featherstone', 20)).toBe('A. Jane Featherstone')
    })

    it('handles empty and nullish input without throwing', () => {
      expect(wpblFeatureName('', MAX)).toBe('')
      expect(wpblFeatureName(null as unknown as string, MAX)).toBe('')
      expect(wpblFeatureName(undefined as unknown as string, MAX)).toBe('')
    })

    it('always returns something at or under the budget for a normal two-part name', () => {
      expect(wpblFeatureName('Bartholomew Featherstonehaugh', MAX).length).toBeLessThanOrEqual(MAX)
    })
  })
})
