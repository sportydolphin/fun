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

// A jersey number is a search mode of its own, not another scoring rule, because no name
// contains a digit and so a numeric query can only ever mean one thing. 21 of the league's
// numbers are worn by more than one player, and 49 of 119 on the roster have no number at all.
describe('searchPlayers by jersey number', () => {
  const shirts = [
    { name: 'Jua Park', jersey_number: '7' },
    { name: 'Jaida Lee', jersey_number: '7' },
    { name: 'Kelsie Whitmore', jersey_number: '3' },
    { name: 'Denver Bryant', jersey_number: '02' },
    { name: 'Unsigned Rookie', jersey_number: null },
    { name: 'Blank Shirt', jersey_number: '' },
  ]
  const names = (q: string) => searchPlayers(q, shirts).map(h => h.player.name)

  it('finds everyone wearing the number', () => {
    expect(names('7').sort()).toEqual(['Jaida Lee', 'Jua Park'])
  })

  // One character is a real search here, where a one-letter name fragment is not: the site's
  // header search will not answer under two characters, and this is why it makes an exception.
  it('takes a single digit', () => {
    expect(names('3')).toEqual(['Kelsie Whitmore'])
  })

  it('accepts a hash, because that is how a number is written everywhere else', () => {
    expect(names('#7').sort()).toEqual(['Jaida Lee', 'Jua Park'])
    expect(names('# 3')).toEqual(['Kelsie Whitmore'])
  })

  it('reads a leading zero as the same shirt', () => {
    expect(names('2')).toEqual(['Denver Bryant'])
    expect(names('02')).toEqual(['Denver Bryant'])
  })

  // With four #7s in the league the honest answer is the list. The Discord bot uses `confident`
  // to decide between answering and offering a choice, so getting this wrong would have it pick
  // one of four players and call it the answer.
  it('is confident only when one person wears the number', () => {
    expect(searchPlayers('7', shirts).every(h => h.confident)).toBe(false)
    expect(searchPlayers('3', shirts)[0].confident).toBe(true)
  })

  it('cannot find a player who has not been issued a number', () => {
    expect(searchPlayers('0', shirts)).toHaveLength(0)
  })

  // Three digits is not a jersey. Left to the name path, which finds nothing either, rather
  // than silently matching a shirt by its first two characters.
  it('does not treat a longer number as a jersey', () => {
    expect(searchPlayers('1997', shirts)).toHaveLength(0)
  })
})
