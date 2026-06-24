# Auth emails

Two separate Supabase Dashboard settings control how the confirmation email looks. Both live outside this repo (Supabase project settings), but the template HTML is kept here so it's version-controlled.

## 1. What the email looks like (template)

**Authentication → Email Templates → "Confirm signup"** — paste in the contents of [`confirm-signup.html`](./confirm-signup.html). Keep `{{ .ConfirmationURL }}` — Supabase substitutes the real link there.

Same idea applies to the other templates in that section (Magic Link, Change Email, Reset Password) if you want them branded too — this repo currently only has the signup one since that's the one in the screenshot.

## 2. Who it's from (sender address)

Right now it sends from Supabase's shared relay (`noreply@mail.app.supabase.io`) — that's why it doesn't look "official." Changing the template alone won't fix this part; the sender is controlled by **Project Settings → Auth → SMTP Settings**, which is unset by default (so Supabase falls back to its own relay).

To send as `sportydolphin.fun`, you need:

1. A transactional email provider — Resend, Postmark, SendGrid, or Mailgun all have a free tier that's plenty for this volume. Resend is the simplest to set up.
2. Add and verify `sportydolphin.fun` (or a subdomain like `mail.sportydolphin.fun`) with that provider — it'll give you DNS records (SPF, DKIM, sometimes DMARC) to add wherever the domain's DNS is managed.
3. Once verified, the provider gives you SMTP host/port/username/password — enter those in Supabase's SMTP Settings, with sender email `noreply@sportydolphin.fun` (or similar) and sender name `sportydolphin.fun`.

Until step 2/3 are done, the template above will still apply (so the *look* improves immediately), but the from-address will keep showing the Supabase relay domain until custom SMTP is configured.
