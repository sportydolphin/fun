// THE HOUSE RULES THAT CAN BE READ OFF THE TEXT (CLAUDE.md): no em dash as punctuation, and
// American spelling. Two hand sweeps on Oct 21, 2026 cleaned the copy and the comments, and both
// found what earlier sweeps had already fixed once, because nothing stopped the next change from
// bringing it back. Run by src/__tests__/houseRules.test.ts over every tracked file the lint never
// sees too (scripts/, supabase/, the docs, the workflows).
//
// It reads PROSE only. In code that means comments, string literals with a space in them, and JSX
// text, found by TypeScript's own parser: a regex over the source cannot tell `let cancelled` (an
// identifier, which stays) from "the game was cancelled" (copy, which does not). A string with no
// space is a value, not a sentence (MLB's 'Cancelled' status, MUI's 'grey.500', 'aria-labelledby'),
// and anything in backticks inside a comment or a doc quotes code. Markdown, YAML, HTML, CSS and
// SQL are read whole, less their inline code.

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

interface Finding { file: string; line: number; rule: 'em-dash' | 'spelling'; text: string }

const CODE = /\.(ts|tsx|js|mjs|cjs)$/
const PROSE = /\.(md|yml|yaml|html|css|sql)$/

/** Tracked files the rules apply to. Left out: generated output (public/), the archive, and SQL
 *  that is history rather than something anyone edits: every migration up to the day this check
 *  arrived (CLAUDE.md: never edit an applied migration) and the legacy scripts/*.sql baseline. */
function houseRuleFiles(): string[] {
  return execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(f =>
    (CODE.test(f) || PROSE.test(f))
    && !/^(public|archive|node_modules)\//.test(f)
    && !/^scripts\/[^/]+\.sql$/.test(f)
    && !(/^scripts\/migrations\/\d+_.*\.sql$/.test(f) && f.slice('scripts/migrations/'.length) < '20261022')
    // This file and its test spell the banned words in order to ban them.
    && !/(^|\/)houseRules(\.test)?\.ts$/.test(f))
}

interface Fragment { line: number; text: string; kind: 'comment' | 'string' | 'part' | 'prose' }

/** Inline code quotes code, which keeps its own spelling and may hold the "no value" glyph. */
const stripInlineCode = (s: string) => s.replace(/`[^`\n]*`/g, m => ' '.repeat(m.length))

function codeFragments(file: string, source: string): Fragment[] {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.(js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, kind)
  const out: Fragment[] = []
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1
  const push = (pos: number, text: string, k: Fragment['kind']) => {
    text.split('\n').forEach((t, i) => out.push({ line: lineOf(pos) + i, text: t, kind: k }))
  }
  const seen = new Set<number>()
  const comments = (pos: number) => {
    for (const r of ts.getLeadingCommentRanges(source, pos) ?? []) {
      if (seen.has(r.pos)) continue
      seen.add(r.pos)
      push(r.pos, stripInlineCode(source.slice(r.pos, r.end)), 'comment')
    }
  }
  const visit = (node: ts.Node) => {
    comments(node.pos)
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
      // The source text, not the cooked value: an escaped newline in a string would shift every
      // line after it.
      const start = node.getStart(sf)
      push(start, source.slice(start, node.end).replace(/^[`'"}]|[`'"]$|\$\{$/g, ''), ts.isTemplateLiteralToken(node) && !ts.isNoSubstitutionTemplateLiteral(node) ? 'part' : 'string')
    } else if (ts.isTemplateExpression(node)) {
      node.getChildren(sf).forEach(visit)
      return
    }
    if (node.kind >= ts.SyntaxKind.FirstToken && node.kind <= ts.SyntaxKind.LastToken) return
    node.getChildren(sf).forEach(visit)
  }
  visit(sf)
  comments(sf.endOfFileToken.pos)
  return out
}

function proseFragments(source: string): Fragment[] {
  return source.split('\n').map((t, i) => ({ line: i + 1, text: stripInlineCode(t), kind: 'prose' as const }))
}

// EM DASH. The one `—` allowed is the glyph that means "no value": a whole string or a whole JSX
// text, the glyph quoted on its own ("—", `>—<`), or a whole Markdown table cell. Anything else is
// punctuation, and the rule is to rewrite the sentence (a colon, a full stop, a comma pair), never
// to swap the character.
function emDash(f: Fragment): boolean {
  if (!f.text.includes('—')) return false
  if (f.kind === 'string' && f.text.trim() === '—') return false
  return f.text
    .replace(/'—'|"—"|`—`/g, '')
    .replace(/>—</g, '')
    .replace(/\|\s*—\s*(?=\|)/g, '|')
    .includes('—')
}

// SPELLING. Whole words, any case. `-ise` verbs are caught by their ending, less the English words
// that end that way in America too.
const BRITISH = new RegExp('\\b(' + [
  'grey(s|ed|ing|er|est|ness|ish)?',
  '(colo|favo|hono|behavio|neighbo|harbo|rumo|labo|humo|flavo|armo|vigo|endeavo|savo|odo|parlo|valo|rigo|clamo|cando|ardo|fervo)ur(s|ed|ing|ite|ites|able|ful|less|ably|er|ers|ation)?',
  '(cent|theat|met|lit|fib|calib|sab|somb|spect|lust|meag|mit)re(s|d)?',
  '(licen|defen|offen|preten)ce(s)?',
  '(cancel|label|model|travel|signal|level|fuel|total|marshal|channel|tunnel|counsel|dial)l(ed|ing|er|ers|able)',
  'judgement(s)?', 'acknowledgement(s)?', 'catalogue(s|d)?', 'cheque(s)?', 'programme(s|d)?',
  'jewellery', 'fulfil(s|ment)?', 'enrol(s|ment)?', 'manoeuvre(s|d)?', 'ageing', 'whilst', 'amongst',
  '(ana|para|cata)ly(se|sed|sing)',
].join('|') + ')\\b', 'gi')

const ISE = /\b[a-z]*(is(e|es|ed|ing)|isations?)\b/gi
const ISE_WORDS = new Set(['rise', 'arise', 'sunrise', 'moonrise', 'uprise', 'raise', 'noise', 'poise', 'guise', 'vise', 'anise', 'elise', 'denise', 'louise', 'eloise', 'lise', 'mise'])
const ISE_ENDINGS = ['wise', 'promise', 'exercise', 'revise', 'surprise', 'premise', 'advertise', 'franchise',
  'precise', 'concise', 'merchandise', 'praise', 'disguise', 'cruise', 'compromise', 'expertise', 'enterprise',
  'despise', 'devise', 'supervise', 'improvise', 'televise', 'comprise', 'demise', 'excise', 'incise', 'bruise',
  'chastise', 'treatise', 'reprise', 'paradise', 'valise', 'turquoise', 'tortoise', 'porpoise', 'apprise',
  'chemise', 'cerise', 'marquise']

function iseIsBritish(word: string): boolean {
  const base = word.toLowerCase().replace(/(isations?|is(es|ed|ing))$/, 'ise')
  return !ISE_WORDS.has(base) && !ISE_ENDINGS.some(e => base.endsWith(e))
}

function spelling(f: Fragment): string[] {
  // A string with no space in it is a value or a key, not a sentence.
  if (f.kind !== 'comment' && f.kind !== 'prose' && !/\s/.test(f.text.trim())) return []
  // MLB's own status word, which the scoreboard shows as MLB sends it.
  const hits = [...f.text.matchAll(BRITISH)].map(m => m[0]).filter(w => w !== 'Cancelled')
  for (const m of f.text.matchAll(ISE)) if (iseIsBritish(m[0])) hits.push(m[0])
  return hits
}

export function houseRuleFindings(files = houseRuleFiles()): Finding[] {
  const out: Finding[] = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    const fragments = CODE.test(file) ? codeFragments(file, source) : proseFragments(source)
    for (const f of fragments) {
      if (emDash(f)) out.push({ file, line: f.line, rule: 'em-dash', text: f.text.trim() })
      for (const w of spelling(f)) out.push({ file, line: f.line, rule: 'spelling', text: w })
    }
  }
  return out
}
