import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BaseDiamond, basesPhrase } from '../ui'
import { BASE_PHRASE, BASE_ROW_ORDER, type BaseCode } from '../derive/runExpectancy'

// The diamond is three squares and no text, so everything true about it that a test can reach
// is in its accessible name and its two length units. Both have a way of going wrong silently:
// a name that drifts from the words the rest of the section uses, and a size that stops
// matching the scale of whatever it is standing next to.

describe('who is on base, in words', () => {
  // The promise made in basesPhrase's own comment: the same eight phrases as the run-expectancy
  // engine's, kept as two lists because the shapes differ, and kept honest by this.
  it.each(BASE_ROW_ORDER.map(b => [b] as const))('matches BASE_PHRASE for bitmask %i', bases => {
    const code = bases as BaseCode
    expect(basesPhrase(!!(code & 1), !!(code & 2), !!(code & 4))).toBe(BASE_PHRASE[code])
  })

  it('covers all eight states and repeats none', () => {
    const all = BASE_ROW_ORDER.map(b => basesPhrase(!!(b & 1), !!(b & 2), !!(b & 4)))
    expect(new Set(all).size).toBe(8)
  })

  it('reads as a sentence rather than a code', () => {
    expect(basesPhrase(false, false, false)).toBe('nobody on')
    expect(basesPhrase(true, false, true)).toBe('runners on 1st and 3rd')
    expect(basesPhrase(true, true, true)).toBe('bases loaded')
  })
})

describe('the diamond', () => {
  it('names itself, so three unlabelled squares are not the whole of it', () => {
    render(<BaseDiamond first second={false} third scale="chrome" />)
    expect(screen.getByRole('img', { name: 'runners on 1st and 3rd' })).toBeTruthy()
  })

  // The scale rules in CLAUDE.md: art in the page grows with --app-chrome, a glyph pinned to a
  // raw-px strip does not, and picking the wrong one is invisible until somebody opens the page
  // on a desktop. Neither has a default for that reason, and this is the check that the choice
  // actually reaches the style.
  // Read off the emotion rule rather than the element: `sx` compiles to a class, so the inline
  // style is empty and a test that asserts on it passes for the wrong reason the day the prop
  // stops being read at all.
  const widthRule = (container: HTMLElement): string => {
    const el = container.querySelector('[role="img"]') as HTMLElement
    const cls = Array.from(el.classList).find(c => c.startsWith('css-'))
    const rules = Array.from(document.querySelectorAll('style')).map(t => t.textContent ?? '').join('')
    const block = rules.slice(rules.indexOf(`.${cls}{`))
    return (/width:([^;]+);/.exec(block)?.[1] ?? '').trim()
  }

  it('takes the chrome scale when it is art in the page', () => {
    const { container } = render(<BaseDiamond first={false} second={false} third={false} size={22} scale="chrome" />)
    expect(widthRule(container)).toBe('calc(22px * var(--app-chrome, 1))')
  })

  it('takes plain pixels when it is pinned to a strip that does not scale', () => {
    const { container } = render(<BaseDiamond first={false} second={false} third={false} size={34} scale="none" />)
    expect(widthRule(container)).toBe('34px')
  })

  it('draws one square per base and fills only the occupied ones', () => {
    const { container } = render(<BaseDiamond first second={false} third={false} scale="none" />)
    const squares = container.querySelectorAll('[role="img"] > *')
    // Three bases, no home plate: nobody stands on it, so a fourth mark that is never filled
    // would only make the three that matter harder to count.
    expect(squares).toHaveLength(3)
  })
})
