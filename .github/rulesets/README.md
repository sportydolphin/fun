# Branch rules for `main`

The repository's rulesets, kept here so the setup is written down and can be re-applied. GitHub holds
the live copy; these files are what it was set from. Change a rule here first, then apply it.

**`main-pull-requests.json`**: `main` takes changes only through a pull request whose CI `check` and `layout` jobs
(`.github/workflows/ci.yml`) have passed. Squash merge only, so each change lands as one commit with the
pull request's title and body as its message. No approval is required: there is one maintainer.

- **A deploy key bypasses it**, and nothing else does: `main-bot`, write access, its private half in
  the `MAIN_BOT_DEPLOY_KEY` secret. Four scheduled jobs commit generated files straight to `main`
  (`build-sitemap`, `pull-feature-requests`, `wpbl-archive`, `wpbl-discord-postseason`), checking
  out with `ssh-key: ${{ secrets.MAIN_BOT_DEPLOY_KEY }}` so their push goes out as that key. Not
  `GITHUB_TOKEN`: a ruleset on a personal repo refuses to exempt the GitHub Actions app ("must be part
  of the ruleset source or owner organization"). Not pull requests either: the merge would wait on
  CI, and a pull request opened with `GITHUB_TOKEN` never starts it. A push made with the deploy key
  does start workflows, so CI checks what the bots commit too. **A new job that commits to `main`
  needs the same `ssh-key` line**, or its push is refused. To rotate the key: generate a new pair,
  `gh repo deploy-key add <pub> --allow-write`, `gh secret set MAIN_BOT_DEPLOY_KEY < <private>`,
  delete the old key and the local files.
- **An admin bypasses it only through a pull request** (`bypass_mode: pull_request`): the emergency
  path is merging a pull request without waiting for CI. A plain `git push` to `main` is refused for
  everyone except the deploy key.
- **`strict` is off.** On, every open pull request would have to be updated each time the sitemap job
  commits, which it does daily, for no gain on a one-person repo.

**`main-history.json`** (`rules default`, id 20732753): no deleting `main` and no force-pushing it. It
covered every branch until Oct 8, 2026, which also stopped a merged branch from being deleted and a
pull-request branch from being rebased; it is `main` only now.

Applied once, by an admin with `gh` logged in:

```bash
gh api -X POST repos/sportydolphin/fun/rulesets --input .github/rulesets/main-pull-requests.json
gh api -X PUT repos/sportydolphin/fun/rulesets/20732753 --input .github/rulesets/main-history.json
```

Both are applied (Oct 8, 2026). The pull-request ruleset is id 24741383, so a change to it is a `PUT`:

```bash
gh api -X PUT repos/sportydolphin/fun/rulesets/24741383 --input .github/rulesets/main-pull-requests.json
```
