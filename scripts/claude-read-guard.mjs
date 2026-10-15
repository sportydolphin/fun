// PreToolUse hook for Claude Code's Read tool (wired in .claude/settings.json).
//
// Refuses a WHOLE read of a very large file and tells the agent to find the part it needs first.
// A whole read of ARCHITECTURE.md or a month of the roadmap log is 30k to 60k tokens,
// it stays in the conversation for every later turn, and almost every task needs one section of
// it. A read that passes `offset` or `limit` goes through untouched, so nothing is ever out of
// reach. Raise LIMIT rather than deleting this if it gets in the way: without it, one careless
// read of the log costs more than the rest of a typical session.
import { statSync } from 'node:fs'

const LIMIT = 100_000 // bytes

let raw = ''
for await (const chunk of process.stdin) raw += chunk
let input
try { input = JSON.parse(raw) } catch { process.exit(0) }

const t = input?.tool_input ?? {}
if (!t.file_path || t.offset != null || t.limit != null) process.exit(0)

let size
try { size = statSync(t.file_path).size } catch { process.exit(0) }
if (size <= LIMIT) process.exit(0)

process.stderr.write(
  `${t.file_path} is ${Math.round(size / 1024)} KB, too large to read whole. ` +
  'Find what you need with Grep (for a doc, grep its "^#" headings), ' +
  'then Read again with offset and limit around that part.\n',
)
process.exit(2)
