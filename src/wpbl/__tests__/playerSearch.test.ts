import { describe, it, expect } from 'vitest'
import { searchPlayers, normalizeName, editDistance } from '../playerSearch'

// The matcher behind the Discord bot's /player command. These cases are the actual 2026
// roster's awkward shapes: accented names someone will type unaccented, a shared surname,
// and the ordinary misspellings a fan makes in a chat box.

const roster = [
  { name: 'Kelsie Whitmore' },
  { name: 'Ayami Sato' },
  { name: 'Maïka Dumais' },
  { name: 'Andréanne Leblanc' },
  { name: 'Hyeonah Kim' },
  { name: 'Rakyung Kim' },
  { name: 'Ticara Geldenhuis' },
  { name: 'Gabrielle Haas' },
  { name: 'Alli Schroder' },
  { name: 'Molly Paddison' },
]
const best = (q: string) => searchPlayers(q, roster)[0]?.player.name ?? null
const confident = (q: string) => searchPlayers(q, roster)[0]?.confident ?? false

describe('normalizeName', () => {
  it('folds accents so an unaccented guess still matches', () => {
    expect(normalizeName('Maïka Dumais')).toBe('maika dumais')
    expect(normalizeName('Andréanne Leblanc')).toBe('andreanne leblanc')
  })
  it('drops punctuation people type inconsistently', () => {
    expect(normalizeName("O'Brien")).toBe('obrien')
    expect(normalizeName('K. Whitmore')).toBe('k whitmore')
    expect(normalizeName('Smith-Jones')).toBe('smith jones')
  })
  it('collapses whitespace and case', () => {
    expect(normalizeName('  KELSIE   whitmore ')).toBe('kelsie whitmore')
  })
})

describe('editDistance', () => {
  it('counts edits', () => {
    expect(editDistance('whitmore', 'witmore')).toBe(1)   // one deletion
    expect(editDistance('schroder', 'schroeder')).toBe(1) // one insertion
    expect(editDistance('kelsie', 'kelsey')).toBe(2)      // two substitutions, i→e and e→y
  })
  it('gives up past the cap rather than counting on', () => {
    expect(editDistance('whitmore', 'geldenhuis', 2)).toBe(3)
  })
})

describe('searchPlayers', () => {
  it('finds an exact full name', () => {
    expect(best('Kelsie Whitmore')).toBe('Kelsie Whitmore')
    expect(confident('Kelsie Whitmore')).toBe(true)
  })

  it('finds a surname alone', () => {
    expect(best('whitmore')).toBe('Kelsie Whitmore')
    expect(confident('whitmore')).toBe(true)
  })

  it('finds a first name alone', () => {
    expect(best('ayami')).toBe('Ayami Sato')
  })

  it('accepts the names in either order', () => {
    expect(best('whitmore kelsie')).toBe('Kelsie Whitmore')
  })

  it('accepts an initial with a surname', () => {
    expect(best('k whitmore')).toBe('Kelsie Whitmore')
    expect(best('kelsie w')).toBe('Kelsie Whitmore')
  })

  it('accepts a prefix of either name', () => {
    expect(best('whit')).toBe('Kelsie Whitmore')
    expect(best('geld')).toBe('Ticara Geldenhuis')
  })

  it('matches an accented name typed without accents', () => {
    expect(best('maika dumais')).toBe('Maïka Dumais')
    expect(best('andreanne')).toBe('Andréanne Leblanc')
    expect(confident('maika dumais')).toBe(true)
  })

  it('forgives ordinary misspellings', () => {
    expect(best('witmore')).toBe('Kelsie Whitmore')
    expect(best('kelsey whitmore')).toBe('Kelsie Whitmore')
    expect(best('paddisen')).toBe('Molly Paddison')
  })

  it('is case and whitespace insensitive', () => {
    expect(best('  KELSIE WHITMORE  ')).toBe('Kelsie Whitmore')
  })

  it('reports a shared surname as a tie rather than picking one', () => {
    const hits = searchPlayers('kim', roster)
    const top = hits.filter(h => h.score === hits[0].score)
    expect(top).toHaveLength(2)
    expect(top.map(h => h.player.name).sort()).toEqual(['Hyeonah Kim', 'Rakyung Kim'])
  })

  it('separates the two Kims once a first name is given', () => {
    expect(best('hyeonah kim')).toBe('Hyeonah Kim')
    expect(best('rakyung')).toBe('Rakyung Kim')
  })

  it('returns nothing for a name that is not on the roster', () => {
    expect(searchPlayers('shohei ohtani', roster)).toHaveLength(0)
  })

  it('returns nothing for an empty query', () => {
    expect(searchPlayers('', roster)).toHaveLength(0)
    expect(searchPlayers('   ', roster)).toHaveLength(0)
  })

  it('ranks an exact match above a longer name it prefixes', () => {
    const hits = searchPlayers('kim', [{ name: 'Kim' }, { name: 'Kimberley Adams' }])
    expect(hits[0].player.name).toBe('Kim')
  })

  it('does not answer confidently on a weak substring', () => {
    // "ross" appears inside "Schroder"? No — but a two-letter fragment should never be
    // treated as a decision, whatever it touches.
    expect(confident('el')).toBe(false)
  })
})
