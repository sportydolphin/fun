# Branch rules for `main`

The repository's rulesets, kept here so the setup is written down and can be re-applied. GitHub holds
the live copy; these files are what it was set from. Change a rule here first, then apply it.

**`main-pull-requests.json`**: `main` takes changes only through a pull request whose CI `check` job
(`.github/workflows/ci.yml`) has passed. Squash merge only, so each change lands as one commit with the
pull request's title and body as its message. No approval is required: there is one maintainer.

- **GitHub Actions bypasses it** (integration 15368, the app behind `GITHUB_TOKEN`). Four scheduled
  jobs commit generated files straight to `main`: `build-sitemap`, `pull-feature-requests`,
  `wpbl-archive` and `wpbl-discord-postseason`. They cannot go through pull requests instead, because
  GitHub does not start workflows for a pull request that `GITHUB_TOKEN` opened, so CI would never
  report and the merge would wait forever. A new job that commits to `main` needs nothing extra.
- **An admin bypasses it only through a pull request** (`bypass_mode: pull_request`): the emergency
  path is merging a pull request without waiting for CI. A plain `git push` to `main` is refused for
  everyone except Actions.
- **`strict` is off.** On, every open pull request would have to be updated each time the sitemap job
  commits, which it does daily, for no gain on a one-person repo.

**`main-history.json`** (`rules default`, id 20732753): no deleting `main` and no force-pushing it. It
covered every branch until Oct 8, 2026, which also stopped a merged branch from being deleted and a
pull-request branch from being rebased; it is `main` only now.

Apply (an admin, with `gh` logged in):

```bash
gh api -X POST repos/sportydolphin/fun/rulesets --input .github/rulesets/main-pull-requests.json
gh api -X PUT repos/sportydolphin/fun/rulesets/20732753 --input .github/rulesets/main-history.json
```

To change the pull-request ruleset later, `PUT` to its id instead of `POST` (`gh api repos/sportydolphin/fun/rulesets` lists them).
