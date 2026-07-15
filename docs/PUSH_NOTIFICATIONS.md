# Push Notifications (PWA)

The app is an installable PWA that can send Web Push notifications. The first
notification wired up is a **daily "make your picks" reminder**: once a day a
GitHub Action nudges signed-in users who still have unpicked games for today.

## How it fits together

| Piece | File | Role |
|-------|------|------|
| Manifest | `public/manifest.webmanifest` | Makes the app installable |
| Icon | `public/icon.svg` | App / notification icon (maskable) |
| Service worker | `public/sw.js` | Receives push messages, shows notifications |
| SW registration | `src/main.tsx` | Registers `/sw.js` on load |
| Client helpers | `src/lib/push.ts` | Permission + subscribe/unsubscribe + save to Supabase |
| Settings toggle | `src/SettingsDialog.tsx` | "Daily pick reminders" switch |
| Table | `scripts/create_push_subscriptions.sql` | Stores subscriptions (one row per device) |
| Sender | `scripts/send-reminders.mjs` | Server-side send via `web-push` |
| Schedule | `.github/workflows/daily-reminders.yml` | Cron that runs the sender |

Being subscribed in a browser **is** the opt-in — there's no separate preference
row. Unsubscribing removes the row.

## One-time setup

### 1. VAPID keys

Web Push authenticates the sender with a VAPID keypair. A fresh pair was
generated for this project — the public key is safe to ship to the browser; the
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

## Testing end-to-end

1. Deploy with `VITE_VAPID_PUBLIC_KEY` set (or run locally — service workers work
   on `http://localhost`).
2. Sign in, open **Settings → Notifications**, flip **Daily pick reminders** on,
   and accept the browser permission prompt. A row appears in
   `push_subscriptions`.
3. Send yourself a test push (needs the VAPID env vars locally):

   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
   VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com \
   node scripts/send-reminders.mjs --test <your-user-id>
   ```

4. Trigger the real reminder run manually from the GitHub Actions UI
   ("Daily Pick Reminders" → Run workflow), or wait for the daily cron.

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
