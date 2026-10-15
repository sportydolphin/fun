// The empty box's "Try" rows are the search's manual, and each one promises an answer. A parser
// change that stops one answering would leave the manual teaching a phrasing that finds nothing,
// which nobody would report. Each example is pinned to the row it is there to show; the plain names
// and the page are answered by the sections' own searches and the page list, not by a parser here.

import { describe, expect, it } from 'vitest'
import { PALETTE_EXAMPLES } from '../CommandPalette'
import { clubPageSuggestions, definitionSuggestions, finderSuggestions, leaderSuggestions, matchupSuggestions, sectionClubs, teamRankSuggestions } from '../finderSearch'
import { mightBeFinderQuestion } from '../finderGate'
import { parseCompareText, parseGameQuery, typedPart, typedStat } from '../league/finderParse'
import type { NavSection } from '../sectionNav'

type Shows = 'name' | 'stat' | 'part' | 'leader' | 'team' | 'game' | 'series' | 'compare' | 'find' | 'club' | 'term' | 'page'

const answers: Record<Shows, (s: NavSection, q: string) => boolean> = {
  name: () => true,
  page: () => true,
  stat: (_s, q) => !!typedStat(q),
  part: (_s, q) => typedPart(q) != null,
  leader: (s, q) => leaderSuggestions(s, q, { seasonCount: 1 }).length > 0,
  team: (s, q) => teamRankSuggestions(s, q).length > 0,
  game: (s, q) => !!parseGameQuery(q, sectionClubs(s)),
  series: (s, q) => matchupSuggestions(s, q).length > 0,
  compare: (_s, q) => !!parseCompareText(q),
  find: (s, q) => mightBeFinderQuestion(q) && finderSuggestions(s, q).length > 0,
  club: (s, q) => clubPageSuggestions(s, q).length > 0,
  term: (s, q) => definitionSuggestions(s, q).rows.length > 0,
}

const SHOWS: Record<NavSection, Shows[]> = {
  wpbl: ['name', 'stat', 'part', 'leader', 'team', 'game', 'series', 'compare', 'find', 'club', 'term', 'page', 'name'],
  mlb: ['name', 'stat', 'part', 'leader', 'team', 'game', 'compare', 'find', 'club', 'term', 'page', 'name'],
}

describe('the empty search box examples', () => {
  for (const section of ['wpbl', 'mlb'] as const) {
    it(`each ${section} example answers with the row it is there to show`, () => {
      const examples = PALETTE_EXAMPLES[section]
      expect(examples.map(e => e.q)).toHaveLength(SHOWS[section].length)
      examples.forEach((e, i) => expect(answers[SHOWS[section][i]](section, e.q), `${e.q} as ${SHOWS[section][i]}`).toBe(true))
    })
  }
})
