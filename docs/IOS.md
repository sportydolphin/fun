# iOS app

The plan of record for putting sportydolphin.fun on the App Store. Started Aug 22, 2026.
The Android counterpart is [ANDROID.md](ANDROID.md), and the two are much less alike than
they look: read the next section before assuming anything carries over.

## Where this stands, Aug 22, 2026

**Nothing exists yet except the association file.**
`public/.well-known/apple-app-site-association` is live with a placeholder Team ID, and
`public/_headers` gives it the content type iOS requires. Both are pinned in
`src/__tests__/pwaShell.test.ts`. That is deliberately the first thing shipped: everything
that can go wrong with that file is a *serving* problem rather than a contents problem, so
it wants to have been deployed and checked long before an app depends on it.

Nothing else has started. No Apple Developer account, no Capacitor project, no Team ID.

## Why this is not Android with a different logo

Android took an afternoon of code because a Trusted Web Activity **is** Chrome. The web
deploy is the app deploy, and sign-in, push and the service worker all keep working because
none of them know they are inside an app.

**iOS has no TWA equivalent.** The app is a WKWebView, and three things that came free on
Android have to be rebuilt:

| | Android (TWA) | iOS (Capacitor) |
|---|---|---|
| Google sign-in | works untouched, real Chrome cookie jar | **blocked.** Google refuses OAuth in a WebView |
| Push | Web Push, same VAPID sender, one config flag | **APNs.** A second transport, a second token store, a second branch in every sender |
| Store review | Play does not care that it is a website | **guideline 4.2 exists to reject exactly this** |
| Cost | $25 once | $99 every year |
| Wall | 12 testers for 14 continuous days | none, but a 4.2 rejection restarts review |
| Toolchain | Bubblewrap on Windows | Xcode, macOS only |

The parts that DO carry over: `manifest.webmanifest` (Capacitor reads nothing from it, but
the icons and colours are the same art), `offline.html` (still the right failure page, for
the same reason: no browser chrome means Safari's own error screen would render full-screen
under our icon), and the whole idea of pointing the shell at the live site so a push to
`main` is still the app deploy.

## The free option, which should be tried first

**iOS Safari already installs this as a PWA**, and since 16.4 that install can receive Web
Push. Share ▸ Add to Home Screen. Everything it needs already ships: the manifest, `sw.js`,
and the `apple-touch-icon` plus `apple-mobile-web-app-*` tags in `index.html`.

Try it on a real iPhone before spending $99, because it may be most of what the App Store
would have bought. What it does not buy is store presence, store search, or a listing to
link to. Two known limits worth knowing before the test: **push only works from the
home-screen install, never from a Safari tab**, and the permission prompt must be raised
from a real user gesture inside that install.

## The web side

### 1. Universal Links

**Status: file live, Team ID placeholder.** This is the counterpart to
`assetlinks.json`, and it fails the same invisible way: a wrong file does not break the
site, does not break the app, and errors nowhere. Links simply keep opening in Safari,
which is also what a correct file does when no app is installed, so the two states are
indistinguishable without a device.

`public/.well-known/apple-app-site-association`. Three things about it are unusual and all
three are load-bearing:

- **No file extension.** Apple's spec says so, which means Cloudflare has no mime type to
  infer and would serve `application/octet-stream`. iOS rejects any content type but
  `application/json`, silently. The rule in `public/_headers` is the only thing arranging
  that, and it is the reason a `_headers` entry is pinned by a test.
- **Apple's CDN fetches it and does not follow redirects.** That is the same shape of trap
  that emptied the offline precache when Pages canonicalised `/offline.html` to `/offline`
  (see ANDROID.md §2). Verify against the deployed URL, never `npm run dev`.
- **The Team ID does not exist yet.** `appIDs` is `TEAMID.fun.sportydolphin.app`, and the
  real prefix is the ten character Apple Developer Team ID from enrollment. Exactly like
  Google's app signing fingerprint, it cannot be filled in ahead of the account. **Swapping
  it in is the last blocking web change**, and until then the file is inert.

The bundle id is `fun.sportydolphin.app`, the same string as the Play package id on purpose:
one name to remember, and the test asserts they agree. Like the Play id it is **frozen the
moment the first build reaches App Store Connect**.

Verify a deployed change by hand rather than by eye, since a cached or mis-typed file fails
silently. There is no Google-style checker API, so check the transport directly:

```bash
curl.exe -sI https://sportydolphin.fun/.well-known/apple-app-site-association
```

`curl.exe`, not `curl`: in PowerShell 5.1 the bare name is an alias for `Invoke-WebRequest`,
which does not take `-sI` and fails on the flags rather than on the URL.

Want a 200, `content-type: application/json`, and no redirect anywhere in the chain. On a
device, `mode=developer` in the Associated Domains entitlement bypasses Apple's CDN cache,
which otherwise holds a stale copy for up to 24 hours and makes every fix look like it did
not work.

**Do not add `www.sportydolphin.fun` to Associated Domains**, for the same reason
ANDROID.md gives: www 301s to the apex, Apple's CDN does not follow that, so the www entry
would need its own file it cannot be served. Every URL the site emits is apex already.

### 2. Auth

**Status: not started. This is the load-bearing item.**

Google returns `disallowed_useragent` for OAuth inside a WKWebView, and
`AuthContext.signInWithGoogle` (`src/AuthContext.tsx`) is exactly that call. It is not a
config problem and there is no user agent string that gets around it: the block is the
point of the policy.

The fix is to take the flow out of the WebView and into the system browser:

1. `signInWithOAuth({ provider: 'google', options: { skipBrowserRedirect: true, redirectTo: 'fun.sportydolphin.app://auth' } })` to get the URL without navigating.
2. Open it in `ASWebAuthenticationSession` (`@capacitor/browser`), which is Safari's cookie
   jar and process, so Google accepts it.
3. Catch the return with Capacitor's `appUrlOpen` listener and call
   `exchangeCodeForSession(code)`.
4. Register the custom scheme in `Info.plist` **and** in Supabase Auth's redirect allow
   list, or step 3 never fires.

**Then guideline 4.8.** Offering Google sign-in on iOS obliges the app to also offer Sign in
with Apple, including its hide-my-email option. That is a new Supabase provider, an Apple
Services ID and a signing key, and a new button in the UI. Review bounces without it, and it
is a cheap rejection to avoid by just doing it.

One interaction to watch: the app claims `/*` as a universal link, and the OAuth round trip
lands on `https://sportydolphin.fun`. Universal links do not fire for same-domain
navigations or for JS-driven redirects, so this should be fine, but it is the first thing to
suspect if sign-in bounces out of the auth sheet mid-flow.

### 3. Push

**Status: not started, and it is a second transport rather than a setting.**

Web Push does not exist inside a WKWebView. Only the home-screen Safari install gets it. So
the app needs APNs, and that means:

- `@capacitor/push-notifications`, an APNs auth key, and the Push Notifications capability.
- A device-token table alongside the existing web-push subscriptions. A user can plausibly
  hold both, so the send path has to dedupe by user rather than by subscription.
- A second branch in every sender: `scripts/send-game-start.mjs`,
  `scripts/send-reminders.mjs`, `scripts/send-wpbl-game-start.mjs`, and
  `supabase/functions/send-test-push/index.ts`. See PUSH_NOTIFICATIONS.md.
- A native re-implementation of `notificationclick` from `sw.js`: the deep-link target in
  the payload has to reach the WebView so `src/mlb/state/deepLink.ts` can act on it.

FCM can front both transports and collapse the sender work to one call, at the cost of a
Firebase project in the middle of a stack that currently has none. Worth considering, not
obviously right.

## The app side

**Status: not started.** Like the Bubblewrap project, this should live in a sibling
directory (`../sportydolphin-ios`), never in this repo: signing material and provisioning
profiles must not be able to reach a tracked file by accident.

### Prerequisites

- **A Mac.** Xcode is macOS only. GitHub Actions `macos-latest` runners can build and
  upload via fastlane later, but the first build and every WKWebView debugging session
  wants a machine in front of you.
- **Apple Developer Program, $99/year.** Recurring, unlike Play's one time $25, and the app
  is delisted if it lapses. Individual enrollment usually clears in a day or two. **The Team
  ID appears the moment it does, and that unblocks the association file.**

### Scaffold

```bash
npm i -D @capacitor/cli && npm i @capacitor/core @capacitor/ios
npx cap init sportydolphin fun.sportydolphin.app
npx cap add ios
```

Set `server.url = 'https://sportydolphin.fun'` in `capacitor.config.ts`. That keeps the TWA's
best property: the app has no copy of the site in it, so a push to `main` updates every
install with no review and no version bump. The cost is more exposure to 4.2, below. The
alternative is bundling `dist/` into the binary, which trades instant updates for a review
queue on every fix, and does not by itself make review any friendlier.

### Guideline 4.2, which is the real risk

Apple rejects apps that are a website in a wrapper, and a `server.url` Capacitor app is the
textbook case. Play does not care about this at all; App Review does, and it is the single
most likely reason this gets bounced. **Something native has to exist.**

Best fit here, in order:

1. **Live Activities.** An in-progress game on the Lock Screen and in the Dynamic Island,
   driven by ActivityKit and updated over APNs. Genuinely native, genuinely useful for a
   scores app, exactly on-brand, and the thing reviewers accept without argument. It is also
   real Swift work plus a push path that can address an activity token.
2. **A WidgetKit home-screen widget** with the day's scores. Much cheaper, still native,
   less convincing on its own.
3. Siri shortcuts, a share extension, native haptics. Filler, not a case.

Do not plan to argue the point in the review notes. Build one of the first two.

## App Store Connect

- **Listing assets:** screenshots at the 6.9" and 6.5" iPhone sizes (Apple accepts a single
  set scaled from the largest), a 1024x1024 icon with **no alpha and no rounded corners**
  (`public/icon-512.png` is the right art at the wrong size and may carry alpha: regenerate
  from `scripts/make-brand-icons.py` rather than upscaling), subtitle, description,
  keywords, and `/privacy` as the policy URL.
- **App Privacy questionnaire.** Must match reality: an email address and a Google account
  id through Supabase Auth, plus site analytics through the `events` table. Declaring less
  than is collected is the kind of thing that gets an app pulled, and it is also a
  per-datatype form rather than Play's checkbox.
- **No 12-tester wall.** TestFlight is optional and external testing needs its own (fast)
  review. Normal review is a day or two, but a 4.2 rejection restarts the clock.
- **Frozen at first submission:** the bundle id, and the app name if it is unique-checked.

## Order of work

1. Test the home-screen PWA on a real iPhone. It might end the project.
2. Enroll, get the Team ID, swap the placeholder in
   `public/.well-known/apple-app-site-association`, deploy, verify with `curl -sI`.
3. Auth rewrite plus Sign in with Apple. Can be written and tested on the web from Windows,
   before any Mac work: the ASWebAuthenticationSession leg is small, the Supabase provider
   and UI work is the bulk, and both are needed regardless.
4. On the Mac: Capacitor scaffold, run on a device, confirm sign-in end to end.
5. APNs and the sender fan-out.
6. Live Activities.
7. Listing, privacy questionnaire, submit.

Steps 3, 5 and 6 are the project. Everything else is process.
