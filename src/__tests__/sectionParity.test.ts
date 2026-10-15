import { describe, it, expect } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// A component FILE NAME that exists in both src/wpbl and src/mlb is usually the same thing drawn
// twice, and two copies of one thing drift one fix at a time. That is how the second alignment pass
// (ROADMAP.md) came to spend October merging chips, pills, info tips, headings and game rows that
// each section had built for itself. Neither section may import the other, so the shared half
// belongs in src/ui/ (or src/league/ for an engine), and the section file binds its own parts to it.
//
// A pair is allowed only with a reason written here. Adding one should be an argument, not a
// default. An entry whose pair is gone fails, so the list cannot outlive what it excuses.
const ALLOWED: Record<string, string> = {
  'ui.tsx': "each section's own primitives, re-exporting what has moved to src/ui",
  'PageHeading.tsx': "who owns the page's h1 differs (a context in WPBL, the address in MLB); the drawing is src/ui/heading.tsx",
  'GameLineRow.tsx': 'binds each section\'s portrait, club mark and links to src/ui/gameLine.tsx',
  'GlossaryPage.tsx': "binds each league's terms to src/ui/Glossary.tsx and StandalonePage.tsx",
  'StatsView.tsx': "each league's own boards; the table frame and head are shared (statsTableHead.ts, leaders.tsx)",
  'BestsView.tsx': "each league's inputs and controls; the engine is src/league/bests.ts, the layout src/ui/bestsBoards.tsx",
  'GamePreview.tsx': "each league's numbers, club marks and links, plus what only it has (MLB's probable starters, WPBL's leaders and rosters); the drawing is src/ui/gamePreview.tsx",
  'FindView.tsx': "each league's inputs and parts; the engine is src/league/finder.ts, the board src/ui/finderBoard.tsx",
  // Still two drawings. Each is a candidate for a shared frame, and taking it off this list is how
  // that is recorded.
  'PlayoffBracket.tsx': "not yet shared; MLB's retires with the postseason on Nov 1",
}

const componentFiles = (dir: string): string[] => readdirSync(join(process.cwd(), dir), { withFileTypes: true })
  .flatMap(e => e.isDirectory()
    ? (e.name === '__tests__' || e.name === 'dev' ? [] : componentFiles(join(dir, e.name)))
    : e.name.endsWith('.tsx') ? [e.name] : [])

describe('one drawing per thing across the two sections', () => {
  const wpbl = new Set(componentFiles('src/wpbl'))
  const mlb = new Set(componentFiles('src/mlb'))
  const both = [...wpbl].filter(f => mlb.has(f)).sort()

  it('has no component file in both sections without a written reason', () => {
    expect(both.filter(f => !(f in ALLOWED))).toEqual([])
  })

  it('has no reason left for a pair that no longer exists', () => {
    expect(Object.keys(ALLOWED).filter(f => !both.includes(f))).toEqual([])
  })

  it('reads real directories', () => {
    expect(existsSync(join(process.cwd(), 'src/wpbl'))).toBe(true)
    expect(wpbl.size).toBeGreaterThan(20)
    expect(mlb.size).toBeGreaterThan(20)
  })
})
