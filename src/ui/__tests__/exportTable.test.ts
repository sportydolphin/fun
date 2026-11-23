import { describe, expect, it } from 'vitest'
import { exportCell, exportFilename, toCsv, toTsv, type ExportCol } from '../exportTable'

interface R { name: string; avg: string; hr: number | null; rec?: string }
const cols: ExportCol<R>[] = [
  { label: 'Player', cell: r => r.name },
  { label: 'AVG', cell: r => r.avg },
  { label: 'HR', cell: r => r.hr },
]

describe('exportCell', () => {
  it('keeps what a spreadsheet parses as a number', () => {
    expect(exportCell('.312')).toBe('.312')
    expect(exportCell('45.0%')).toBe('45.0%')
    expect(exportCell('+1.2')).toBe('+1.2')
    expect(exportCell(7)).toBe('7')
  })
  it('turns the no-value dash into an empty cell, so a column still sums', () => {
    expect(exportCell('—')).toBe('')
    expect(exportCell(null)).toBe('')
    expect(exportCell(Number.NaN)).toBe('')
  })
  it('turns a typographic minus into one Excel reads as negative', () => {
    expect(exportCell('−1.2')).toBe('-1.2')
  })
  it('keeps a hyphenated record from becoming a date', () => {
    expect(exportCell('10-5')).toBe('10–5')
    expect(exportCell('10–5')).toBe('10–5')
  })
  it('quotes a text cell Excel would run as a formula', () => {
    expect(exportCell('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`)
    expect(exportCell('@SUM(A1)')).toBe(`'@SUM(A1)`)
    expect(exportCell('-x')).toBe(`'-x`)
  })
})

describe('toCsv', () => {
  it('writes a header and one line per row, quoting what needs it', () => {
    const csv = toCsv<R>([
      { name: 'Ibarra, Diana', avg: '.312', hr: 4 },
      { name: 'Say "Hi"', avg: '—', hr: null },
    ], cols)
    expect(csv).toBe('Player,AVG,HR\r\n"Ibarra, Diana",.312,4\r\n"Say ""Hi""",,\r\n')
  })
})

describe('toTsv', () => {
  it('splits on tabs and flattens a tab inside a cell', () => {
    expect(toTsv<R>([{ name: 'A\tB', avg: '.250', hr: 1 }], cols)).toBe('Player\tAVG\tHR\nA B\t.250\t1\n')
  })
})

describe('exportFilename', () => {
  it('slugs the parts and skips the empty ones', () => {
    expect(exportFilename(['wpbl', 2026, null, 'hitting', 'players', ''], 'csv')).toBe('wpbl-2026-hitting-players.csv')
    expect(exportFilename([], 'csv')).toBe('stats.csv')
  })
})
