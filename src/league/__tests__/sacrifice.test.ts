import { describe, expect, it } from 'vitest'
import { isBunt, isSacBunt } from '../sacrifice'

// Real 2026 rows. The three "SAC" rows with no "bunt" are why the rule reads the capitals: without
// them the play log had 7 sacrifice bunts against the box scores' 10.
const SAC_BUNT_WORDED = { event_type: 'groundout', narrative: 'Claire Eccles grounded out to p, SAC, bunt (0-0); Val Perez advanced to third.' }
const SAC_ONLY = { event_type: 'groundout', narrative: 'Suzuka Yamamoto grounded out to 3b, SAC (0-1 K); Ticara Geldenhuis advanced to second.' }
const SAC_ON_ERROR = { event_type: 'unknown', narrative: 'Suzu Narasaki reached first on an error by 3b, SAC (1-0 B); Madison Willan advanced to second.' }
const SAC_FLY = { event_type: 'sacrifice', narrative: 'Alli Schroder flied out to cf, sacrifice fly, RBI (0-2 KS); Lexi Hastings scored.' }
const BUNT_HIT = { event_type: 'single', narrative: 'Ayuri Shimano singled to pitcher, bunt (1-0 B).' }
const BUNT_OUT = { event_type: 'out', narrative: 'Keira Izumi out at first p to 2b, bunt (1-1 FB).' }
const GROUNDOUT = { event_type: 'groundout', narrative: 'Diana Ibarra grounded out to 2b (1-1 BK); Kylee Lahners advanced to second.' }
// A name is not the word: "Kate Blunt" must not read as a bunt.
const NAMED_BLUNT = { event_type: 'flyout', narrative: 'Kate Blunt flied out to cf (0-0).' }

describe('isSacBunt', () => {
  it('reads "SAC" with or without "bunt", and on an error', () => {
    expect([SAC_BUNT_WORDED, SAC_ONLY, SAC_ON_ERROR].map(isSacBunt)).toEqual([true, true, true])
  })
  it('never reads the sac fly, a bunt hit or an ordinary out', () => {
    expect([SAC_FLY, BUNT_HIT, BUNT_OUT, GROUNDOUT].map(isSacBunt)).toEqual([false, false, false, false])
  })
})

describe('isBunt', () => {
  it('reads every bunt, the sacrifices without the word included', () => {
    expect([SAC_BUNT_WORDED, SAC_ONLY, SAC_ON_ERROR, BUNT_HIT, BUNT_OUT].map(isBunt)).toEqual([true, true, true, true, true])
  })
  it('reads no sac fly, ordinary out or name', () => {
    expect([SAC_FLY, GROUNDOUT, NAMED_BLUNT].map(isBunt)).toEqual([false, false, false])
  })
})
