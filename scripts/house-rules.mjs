// The house-rules check (no em dash, American spelling) on a handful of files, so a slip is caught
// where it is made rather than by CI's full sweep minutes after a push. Three callers:
//
//   node scripts/house-rules.mjs <file>...   any files, from anywhere in the repo
//   node scripts/house-rules.mjs --staged    the pre-commit hook (.githooks/pre-commit)
//   node scripts/house-rules.mjs --hook      Claude Code's PostToolUse hook on Edit and Write
//                                            (.claude/settings.json): reads the tool call on stdin
//
// The rules themselves stay in src/test/houseRules.ts, which src/__tests__/houseRules.test.ts runs
// over every tracked file; this only narrows the file list. Node strips that file's types itself,
// which is why it may import nothing but `typescript` and Node's own modules.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
process.chdir(root)
const { houseRuleFindings, isHouseRuleFile } = await import(pathToFileURL(resolve(root, 'src/test/houseRules.ts')).href)

const toRepoPath = p => relative(root, resolve(p)).replaceAll('\\', '/')
const report = findings => findings
  .map(f => `${f.file}:${f.line}  ${f.rule === 'em-dash' ? `em dash: ${f.text}` : `British spelling "${f.text}"`}`)
  .join('\n')
const RULE = 'Rewrite the sentence rather than swapping the character; fix spelling in prose only (identifiers and feed values stay).'

const args = process.argv.slice(2)
let files
if (args[0] === '--hook') {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  let input
  try { input = JSON.parse(raw) } catch { process.exit(0) }
  const path = input?.tool_input?.file_path
  if (typeof path !== 'string') process.exit(0)
  files = [toRepoPath(path)]
} else if (args[0] === '--staged') {
  files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' }).split('\n')
} else {
  files = args.map(toRepoPath)
}

files = files.filter(f => f && !f.startsWith('..') && existsSync(f) && isHouseRuleFile(f))
const findings = houseRuleFindings(files)
if (findings.length === 0) process.exit(0)

if (args[0] === '--hook') {
  // "block" on a PostToolUse hook cannot undo the edit; it hands the reason back to the agent,
  // which is the point: it fixes the line in the same turn instead of after a red CI run.
  process.stdout.write(JSON.stringify({ decision: 'block', reason: `House rules (CLAUDE.md):\n${report(findings)}\n${RULE}` }))
  process.exit(0)
}
console.error(`House rules (CLAUDE.md):\n${report(findings)}\n${RULE}`)
process.exit(1)
