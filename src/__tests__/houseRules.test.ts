import { describe, expect, it } from 'vitest'
import { houseRuleFindings } from '../test/houseRules'

// CLAUDE.md's house rules that can be read off the text: no em dash as punctuation, and American
// spelling. Every tracked file, the ones the lint never opens included (scripts/, supabase/, the
// docs, the workflows). A failure lists each line; rewrite the sentence rather than swapping the
// character, and fix the spelling in prose only (an identifier or a feed value stays as it is).

const findings = houseRuleFindings()
const list = (rule: string) => findings.filter(f => f.rule === rule).map(f => `${f.file}:${f.line}  ${f.text}`)

describe('house rules', () => {
  it('uses no em dash as punctuation', () => {
    expect(list('em-dash')).toEqual([])
  })

  it('spells American, never British', () => {
    expect(list('spelling')).toEqual([])
  })
})
