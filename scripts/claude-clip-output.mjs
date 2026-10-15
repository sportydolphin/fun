// PostToolUse hook for Claude Code's Bash and PowerShell tools (wired in .claude/settings.json).
//
// A long command output stays in the conversation and is re-sent on every later turn, and most of
// it is noise: install logs, a build's module list, a progress meter. Past MAX_LINES this keeps
// the head and the tail (where errors and summaries land), saves the whole output to a temp file
// and says where, so nothing is out of reach: Grep or Read the file for the middle. Only what the
// agent sees changes; the command already ran. A shape the harness does not accept is ignored and
// the original output is used, so a mistake here costs tokens, never a result.
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MAX_LINES = 150
const HEAD = 40
const TAIL = 80

let raw = ''
for await (const chunk of process.stdin) raw += chunk
let input
try { input = JSON.parse(raw) } catch { process.exit(0) }

const res = input?.tool_response
if (!res || typeof res !== 'object') process.exit(0)

let changed = false
const out = { ...res }
for (const key of ['stdout', 'stderr']) {
  const text = res[key]
  if (typeof text !== 'string') continue
  const lines = text.split('\n')
  if (lines.length <= MAX_LINES) continue
  const file = join(tmpdir(), `claude-${key}-${Date.now()}.log`).replaceAll('\\', '/')
  writeFileSync(file, text)
  out[key] = [
    ...lines.slice(0, HEAD),
    `[... ${lines.length - HEAD - TAIL} lines clipped; the full ${key} is in ${file} ...]`,
    ...lines.slice(-TAIL),
  ].join('\n')
  changed = true
}
if (!changed) process.exit(0)

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: out },
}))
