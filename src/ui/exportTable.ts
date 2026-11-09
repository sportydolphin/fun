// A STATS BOARD AS A FILE: the rows and columns on screen, written as CSV for a download or TSV
// for the clipboard. League-neutral; each section maps its own rows and columns onto `ExportCol`.
//
// THE CELLS ARE THE TEXT AS SHOWN, not the sort value. The sort value of IP is outs and of a
// record is a win share, so a spreadsheet of `value()` would disagree with the board it came
// from. What the board prints is what Excel and Sheets already parse: ".312" reads as 0.312 and
// "45.0%" as a percent. Two glyphs they do not parse are rewritten: the "no value" dash becomes an
// empty cell, so a column still sums, and the typographic minus becomes a hyphen, so "−1.2" is a
// number rather than a word.

export interface ExportCol<R> {
  label: string
  cell: (r: R) => string | number | null | undefined
}

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?%?$/i

/** A cell as a spreadsheet should read it. */
export function exportCell(v: string | number | null | undefined): string {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  const s = v.trim()
  if (s === '—' || s === '-' || s === '–') return ''
  const minus = s.replace(/^−/, '-')
  if (NUMERIC.test(minus)) return minus
  // A record or a score with a hyphen ("10-5") is a date to Excel (October 5). The en dash the
  // boards already draw is not, so a hyphenated one is given the same.
  if (/^\d+-\d+$/.test(s)) return s.replace('-', '–')
  // CSV INJECTION: a text cell opening with one of these is run as a formula by Excel. Names never
  // do, but a club or a label from the feed could, and the quote makes Excel show it as text.
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV, CRLF between rows as RFC 4180 has it. No BOM here: `downloadCsv` adds it. */
export function toCsv<R>(rows: readonly R[], cols: readonly ExportCol<R>[]): string {
  const lines = [cols.map(c => csvField(c.label))]
  for (const r of rows) lines.push(cols.map(c => csvField(exportCell(c.cell(r)))))
  return lines.map(l => l.join(',')).join('\r\n') + '\r\n'
}

/** Tab-separated, which a paste into Excel or Sheets splits into cells. A tab or line break inside
 *  a cell would split it wrongly, so those become spaces. */
export function toTsv<R>(rows: readonly R[], cols: readonly ExportCol<R>[]): string {
  const field = (s: string) => s.replace(/[\t\r\n]+/g, ' ')
  const lines = [cols.map(c => field(c.label))]
  for (const r of rows) lines.push(cols.map(c => field(exportCell(c.cell(r)))))
  return lines.map(l => l.join('\t')).join('\n') + '\n'
}

/** A filename from its parts: lowercase, hyphenated, nothing a file system refuses. */
export function exportFilename(parts: readonly (string | number | null | undefined)[], ext: string): string {
  const slug = parts.filter(p => p != null && p !== '').join('-')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return `${slug || 'stats'}.${ext}`
}

/**
 * Saves a CSV. THE BOM IS FOR EXCEL, which opens a CSV without one in the system code page, so
 * "Saiki" survives but every accented or non-Latin name turns to mojibake. Sheets and Numbers
 * ignore it.
 *
 * ON A TOUCH PHONE, THE SHARE SHEET FIRST: an installed app on iOS opens a blob download as a
 * preview with no way to keep it, and the sheet offers Save to Files, Drive and the mail apps.
 * A share the reader cancels is left alone; one the browser refuses falls back to the download.
 * Returns how the file went, for the caller's analytics.
 */
export async function downloadCsv(csv: string, filename: string): Promise<'share' | 'download' | 'canceled'> {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
  if (touch && typeof File !== 'undefined' && navigator.canShare) {
    const file = new File([blob], filename, { type: 'text/csv' })
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return 'share' }
      catch (err) { if ((err as { name?: string })?.name === 'AbortError') return 'canceled' }
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'download'
}

/** Puts text on the clipboard. Resolves false where the browser has no clipboard to write. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through to the textarea route */ }
  // Outside a secure context (a LAN dev server) the API is missing; the old route still works.
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}
