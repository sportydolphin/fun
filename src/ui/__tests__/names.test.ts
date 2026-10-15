import { describe, it, expect } from 'vitest'
import { nameStages } from '../names'

describe('nameStages', () => {
  it('steps a two-part name straight to "F. Last"', () => {
    expect(nameStages('Kelsie Whitmore')).toEqual(['Kelsie Whitmore', 'K. Whitmore'])
  })

  it('keeps a surname particle with the surname', () => {
    expect(nameStages('Elly De La Cruz')).toEqual(['Elly De La Cruz', 'E. De La Cruz'])
  })

  it('keeps a generational suffix with the surname, never "F. Jr."', () => {
    expect(nameStages('Vladimir Guerrero Jr.')).toEqual(['Vladimir Guerrero Jr.', 'V. Guerrero Jr.'])
    expect(nameStages('Michael Harris II')).toEqual(['Michael Harris II', 'M. Harris II'])
    expect(nameStages('Luis García Jr.')).toEqual(['Luis García Jr.', 'L. García Jr.'])
  })

  it('drops a middle name only at the last stage', () => {
    expect(nameStages('Jung Hoo Lee')).toEqual(['Jung Hoo Lee', 'J. Hoo Lee', 'J. Lee'])
  })

  it('leaves a one-word name alone', () => {
    expect(nameStages('Ichiro')).toEqual(['Ichiro'])
  })
})
