# Push Notifications (PWA)

The app is an installable PWA that can send Web Push notifications. The first
notification wired up is a **daily "make your picks" reminder**: once a day a
GitHub Action nudges signed-in users who still have unpicked games for today.

## How it fits together

| Piece | File | Role |
|-------|------|------|
| Manifest | `public/manifest.webmanifest` | Makes the app installable |
| Icons | `public/icon-*.png`, `public/badge-96.png` | Install tiles, plus the notification image and its status-bar badge |
| Icon source | `scripts/make-brand-icons.py` | Regenerates every icon from `public/logo.png` |
| Service worker | `public/sw.js` | Receives push messages, shows notifications |
| SW registration | `src/main.tsx` | Registers `/sw.js` on load |
| Client helpers | `src/lib/push.ts` | Permission + subscribe/unsubscribe + save to Supabase |
| Settings toggle | `src/SettingsDialog.tsx` | "Daily pick reminders" switch |
| Table | `scripts/create_push_subscriptions.sql` | Stores subscriptions (one row per device) |
| Sender | `scripts/send-reminders.mjs` | Server-side send via `web-push` |
| Schedule | `.github/workflows/daily-reminders.yml` | Cron that runs the sender |
| Test button | `src/AdminPanel.tsx` → `supabase/functions/send-test-push` | Admin "send test notification to me" |

Being subscribed in a browser **is** the opt-in. There's no separate preference
row. Unsubscribing removes the row.

## One-time setup

### 1. VAPID keys

Web Push authenticates the sender with a VAPID keypair. A fresh pair was
generated for this project. The public key is safe to ship to the browser; the
private key must stay secret.

```
Public:  BCd3nM7dda8C49Th-PJSgwraiaao-pikJplq7pZDIoA_KEws4fgE3KfB1ledOmQW4S7KmNn3dcgEZBs-62X6o_A
Private: GjFZpp61joRTd1ULE6BnhG2fA2TQuacsjkQNjfSuQGg
```

To regenerate instead: `npx web-push generate-vapid-keys`.

### 2. Create the table

Run `scripts/create_push_subscriptions.sql` in the Supabase SQL editor (or
`supabase db push` if you manage migrations that way).

### 3. Client env var

Add the **public** key to your build environment so `src/lib/push.ts` can read it:

```
VITE_VAPID_PUBLIC_KEY=BCd3nM7dda8C49Th-PJSgwraiaao-pikJplq7pZDIoA_KEws4fgE3KfB1ledOmQW4S7KmNn3dcgEZBs-62X6o_A
```

Put it in `.env` (local dev) and wherever the production site's env vars live
(the host that builds/serves the static site). Without it, the Settings toggle
shows "not set up yet" and stays disabled.

### 4. GitHub Action secrets

The daily sender runs in `Daily Pick Reminders`. Add these repo secrets
(Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `SUPABASE_URL` | (already set for the bots workflow) |
| `SUPABASE_SERVICE_ROLE_KEY` | (already set for the bots workflow) |
| `VAPID_PUBLIC_KEY` | the public key above |
| `VAPID_PRIVATE_KEY` | the private key above |
| `VAPID_SUBJECT` | `mailto:you@example.com` (a contact address; required by the spec) |

### 5. Test-notification edge function (for the Admin button)

The Admin panel's **"Send test notification to me"** button sends a real push to
your own devices regardless of the schedule. Sending needs the VAPID *private*
key, so it runs in an edge function (same pattern as `delete-account`):

```bash
supabase functions deploy send-test-push
supabase secrets set \
  VAPID_PUBLIC_KEY=BCd3nM7dda8C49Th-PJSgwraiaao-pikJplq7pZDIoA_KEws4fgE3KfB1ledOmQW4S7KmNn3dcgEZBs-62X6o_A \
  VAPID_PRIVATE_KEY=GjFZpp61joRTd1ULE6BnhG2fA2TQuacsjkQNjfSuQGg \
  VAPID_SUBJECT=mailto:snichols246@gmail.com
```

(`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected automatically, so don't
set those.)

## Testing end-to-end

Easiest path (no games required):

1. Deploy with `VITE_VAPID_PUBLIC_KEY` set (or run locally, since service workers work
   on `http://localhost`).
2. Sign in, open **Settings → Notifications**, flip **Daily pick reminders** on,
   and accept the browser permission prompt. A row appears in `push_subscriptions`.
3. Open the **Admin** panel → **Notifications** → **Send test notification to me**.
   You should get a notification within a couple seconds. (Requires step 5 above.)

Other ways to test the real reminder:

- **GitHub Actions UI:** *Daily Pick Reminders → Run workflow*. Leave the input
  blank for a normal run, or put your **email** (or user id) in the `test_user`
  box to force a test push to just you, bypassing the pick/schedule checks.
- **CLI:**
  ```bash
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com \
  node scripts/send-reminders.mjs --test you@example.com
  ```

> **Desktop gotcha:** browser push only arrives while the browser is running
> (Chrome/Edge keep a background process; fully quitting them stops delivery).
> Also check OS focus/Do-Not-Disturb and site notification permission if a test
> reports "sent" but nothing appears.

## Notes & limitations

- **iOS/iPadOS:** Web Push only works when the app is **installed to the Home
  Screen** (Share → Add to Home Screen), and only on iOS 16.4+. In a normal
  Safari tab, the toggle will fail to subscribe. Android/desktop Chrome, Edge,
  and Firefox work in a regular tab.
- **Schedule timing:** the cron is `0 16 * * *` (noon ET). Day games get the
  shortest heads-up; adjust the cron in the workflow if you want it earlier.
- **Stale devices:** the sender prunes subscriptions the push service reports as
  gone (HTTP 404/410) automatically.
- This is the foundation. Next candidates that reuse all of the above: "your
  team's game starting," live score/milestone alerts, offline score caching.

## WPBL game reminders

A second reminder, reusing the same subscription plumbing: the **bell on the WPBL
Home next-game card** ("Reminders for every game"). It is one standing preference,
`user_preferences.notify_wpbl_all_games`. It used to be a per-game opt-in, and the
sender still honours any `wpbl_game_reminders` rows left from that, but nothing
creates new ones.

| Piece | File | Role |
|-------|------|------|
| Toggle UI | `src/wpbl/Home.tsx` (`GameReminderRow`) | Bell + switch under the matchup |
| Client helpers | `src/wpbl/reminders.ts` | Ensures a push sub, then writes the standing pref |
| Catalog | `shared/notifications.js` (`buildWpblGameStart`) | Push content |
| Tables | `scripts/create_wpbl_game_reminders.sql` | `wpbl_game_reminders` (legacy per-game opt-ins) + `wpbl_game_start_sent` (once-only log) |
| Sender | `scripts/send-wpbl-game-start.mjs` | Cron push; fires 30 min before first pitch |
| Schedule | `.github/workflows/wpbl-game-start-reminders.yml` | Runs the sender every 10 min during game hours |
| In-site twin | `src/wpbl/notifications/gameStart.ts` | Derives the same reminder for the toolbar bell |

- **Why there is an in-site twin:** `sw.js` records a push in the bell by posting it
  to open tabs, so a reminder that arrives while the app is closed is shown by the OS
  and then exists nowhere in the app. The twin recomputes it from the schedule on
  every bell refresh, under the same id the push uses, so the two collapse into one
  row instead of doubling up. Its lead window (30 min) is hardcoded to match
  `DEFAULT_LEAD_MIN` in the sender: change one and change the other, or the bell and
  the lock screen disagree about when a game is starting.

- **Opt-in record = metric:** each opt-in is a `wpbl_game_reminders` row, so
  counting rows (or distinct `user_id`s) tells you how many fans turned reminders
  on. The client *also* fires `wpbl_game_reminder_on` / `_off` analytics events for
  the action-level funnel.
- **Sign-in required:** Web Push is user-scoped, so the toggle prompts sign-in when
  signed out (there's no anonymous reminder to store).
- **Scheduling:** `.github/workflows/wpbl-game-start-reminders.yml` runs the sender
  every 10 min during game hours. It reuses the same `SUPABASE_*` / `VAPID_*` repo
  secrets as the MLB jobs, so no new secrets needed. Trigger a one-off test from the
  Actions UI (*WPBL Game Start Reminders → Run workflow*, `test_user` = your email)
  or locally with `node scripts/send-wpbl-game-start.mjs --test <email>`.
