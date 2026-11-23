// One archive table (a JSON array of row objects) as a CSV file a spreadsheet opens as it is.
//
// Plain JS rather than src/ui/exportTable.ts because the Vite plugin that calls it runs in Node
// before anything is bundled, and it cannot import TypeScript. The rules match that file where they
// overlap, so a board's CSV and the season's CSV read the same way in Excel:
//
// - A UTF-8 byte-order mark first. Without it Excel reads the file as the system code page and every
//   accented name (Martínez, Höglund) comes out as mojibake.
// - CRLF between rows, as RFC 4180 has it; every spreadsheet reads it, and some read nothing else.
// - A text cell starting with = + - @ that is not a number gets a leading apostrophe, so a name or
//   a play description cannot run as a formula on the reader's machine (CSV injection).
//
// Unlike the board export it keeps the database's values as they are: a raw column, not a printed
// cell. A nested value (a line score, an id list) is written as its JSON, which is the only
// lossless flat form of it.

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?%?$/i

function cell(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/^[=+\-@\t\r]/.test(s) && !NUMERIC.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Every key any row carries, in the order first seen: the archive writes keys sorted, but a column
 *  added mid-season appears only on later rows, and a header built from row one would drop it. */
export function csvColumns(rows) {
  const seen = new Set()
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k)
  return [...seen]
}

export function rowsToCsv(rows) {
  const cols = csvColumns(rows)
  const lines = [cols.map(cell).join(',')]
  for (const r of rows) lines.push(cols.map(c => cell(r[c])).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}
