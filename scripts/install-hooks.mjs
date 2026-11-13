// Runs as `prepare`, so every `npm install` or `npm ci` points git at the committed hooks in
// .githooks/. Git never runs hooks from the repo on its own, and a hook that has to be installed
// by hand is a hook nobody has. The setting is per clone, and a worktree shares its clone's.
//
// Silent outside a git checkout (an unpacked tarball, a Docker layer), where there are no hooks
// to point at and a failure here would fail the install itself.
import { execFileSync } from 'node:child_process'

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' })
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
} catch {
  // Not a git checkout, or no git on PATH.
}
