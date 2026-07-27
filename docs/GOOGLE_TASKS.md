# Google Tasks → feature requests

The site's feature backlog lives in Google Tasks. `npm run tasks` reads those
lists (read-only) and writes them into [feature-requests.md](feature-requests.md),
so the current wish list travels with the repo.

There is no Google Tasks connector, so this uses the Google Tasks API directly
with a personal OAuth token. It reads only your task titles, notes, and due dates,
and never writes anything back to Google.

## One-time setup

You do the Google steps once; after that it is just `npm run tasks`.

### 1. Enable the Tasks API

1. Go to <https://console.cloud.google.com/>.
2. Pick an existing project or create one (any name).
3. APIs & Services → Library → search **Google Tasks API** → **Enable**.

### 2. Create an OAuth client

1. APIs & Services → **OAuth consent screen**. Choose **External**, fill in the
   required app name + your email, and add yourself as a **Test user** (so you can
   use it without Google verifying the app). You can leave it in "Testing".
2. APIs & Services → **Credentials** → **Create credentials** → **OAuth client ID**.
3. Application type: **Desktop app**. Name it anything.
4. Copy the **Client ID** and **Client secret**.

### 3. Put the credentials in `.env`

`.env` is gitignored. Add:

```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

### 4. Mint a refresh token

```bash
node --env-file=.env scripts/google-auth.mjs
```

It prints a URL. Open it, approve read-only access to your Google Tasks, and the
script prints one more line to paste into `.env`:

```
GOOGLE_REFRESH_TOKEN=1//0g...
```

The refresh token does not expire under normal use, so this is a one-time step.

> If it says "No refresh token returned", remove the app at
> <https://myaccount.google.com/permissions> and run the command again — Google
> only returns a refresh token on the first consent.

## Pulling tasks

```bash
npm run tasks
```

Writes [feature-requests.md](feature-requests.md) with every open task, grouped by
list. Add `-- --print` to also echo it to the terminal. To pull a single list,
set `GOOGLE_TASKS_LIST` to its exact title in `.env`.

Re-run it whenever you want the file refreshed, then commit the file if you want
the updated backlog on the repo.

## Keeping it fresh automatically

`.github/workflows/pull-feature-requests.yml` runs `pull-tasks.mjs` once a day
(05:00 UTC) and commits `feature-requests.md` when it changes. It stays dormant
and skips cleanly until you add the same three credentials as **repository
secrets**:

1. GitHub repo → **Settings → Secrets and variables → Actions → New repository
   secret**.
2. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN`
   (the same values from your `.env`).

Once those exist, the daily run keeps the file current on its own. You can also
trigger it any time from the Actions tab (**Pull feature requests → Run
workflow**). Until the secrets are set, scheduled runs no-op instead of failing.

> Note: this puts your Google client secret and refresh token in GitHub secrets.
> They're read-only Tasks credentials, but if you'd rather not store them in the
> repo, skip this section and just run `npm run tasks` locally when you want a
> refresh.
