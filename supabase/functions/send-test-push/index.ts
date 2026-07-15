// send-test-push — sends a one-off test Web Push to the CALLING user's own
// devices, regardless of whether there are games today. Backs the Admin panel's
// "Send test notification" button.
//
// Deploy:
//   supabase functions deploy send-test-push
// Then set the VAPID secrets once (SUPABASE_URL/SERVICE_ROLE_KEY are automatic):
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
// See docs/PUSH_NOTIFICATIONS.md for the full walkthrough.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const vapidPublic    = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate   = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject   = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:notifications@sportydolphin.fun'

  if (!vapidPublic || !vapidPrivate) {
    return json({ error: 'VAPID keys are not set for this function. Run: supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=…' }, 500)
  }

  // Verify who's calling — we only ever push to this verified user's own rows.
  const callerClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await callerClient.auth.getUser()
  if (userErr || !user) return json({ error: 'Not authenticated' }, 401)

  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data: subs, error: subsErr } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', user.id)
  if (subsErr) return json({ error: subsErr.message }, 500)
  if (!subs || subs.length === 0) {
    return json({ error: 'No subscriptions found for your account. Turn on Daily pick reminders in Settings first (on this device).' }, 400)
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)

  const payload = JSON.stringify({
    title: '⚾ Test notification',
    body:  'Push is working — you’re all set!',
    url:   '/mlb?view=home',
    tag:   'mlb-test',
  })

  let sent = 0
  let pruned = 0
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      )
      sent++
    } catch (err) {
      const code = (err as { statusCode?: number })?.statusCode
      if (code === 404 || code === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
        pruned++
      }
    }
  }

  return json({ ok: true, sent, devices: subs.length, pruned })
})
