---
name: ship
description: Ship the current work to main through a self-merging pull request, then watch CI and fix real failures. Use when the user says ship it, push it, open the PR, or land this.
---

# Ship

`main` takes only pull requests, and each one merges itself once `check` and `layout` pass
(CLAUDE.md, House rules). This is that flow end to end. Run it only when the user asked to ship.

1. **Branch.** On `main`, create a feature branch named for the change (`git switch -c <name>`).
   Never commit to `main`.
2. **Check locally first.** `npm run typecheck`, `npm run lint` (must print nothing) and
   `npx vitest related --run <changed files>`. A UI change whose fetches changed needs
   `npm run sweep:record -- --merge --routes <routes>` and the fixtures in the same commit
   (src/CLAUDE.md).
3. **Commit.** Stage the files by name. The message explains why, not what, with no em dashes and
   American spelling; the pre-commit hook checks the last two. End with the attribution trailer
   the session gives.
4. **Push and open the PR.** `git push -u origin <branch>`, then
   `gh pr create --fill && gh pr merge --auto --squash`. The title and body become the squashed
   commit on `main`, so they follow the same rules as the message. If `gh` is not on PATH it is at
   `C:\Program Files\GitHub CLI\gh.exe`.
5. **Watch CI yourself.** Run `gh pr checks <number> --watch` in the background (never poll in a
   loop, never turn on the app's auto-fix). On a real failure, read the log
   (`gh run view <id> --log-failed`), fix it on the branch and push again. A `layout` failure CI
   sees and the machine does not is the slower runner: reproduce with `--cpu 4` (docs/CI.md).
6. **Stacked PRs.** When one merges, rebase the PR stacked on it onto `main` and push with
   `--force-with-lease`.
7. **Report** the PR link and its state in one line. Stop any dev servers and background tasks
   started along the way.
