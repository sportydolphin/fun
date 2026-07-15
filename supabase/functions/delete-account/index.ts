// Deno Edge Function — deletes the calling user's own account (auth user +
// their rows in app tables). Deploy with:
//   supabase functions deploy delete-account
// See supabase/functions/README.md for the full setup walkthrough.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Supabase platform for every Edge Function in this project — no need
// to set them as secrets yourself.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Client scoped to the caller's own JWT — used only to verify who's asking.
  const callerClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await callerClient.auth.getUser()
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // Admin client (service role) — only ever acts on the verified caller's own id.
  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Clean up app tables first. Most of these are set up with
  // `on delete cascade` already, but deleting explicitly here means this
  // function doesn't silently fail to clean up if any table isn't.
  await Promise.all([
    admin.from('usernames').delete().eq('user_id', user.id),
    admin.from('user_preferences').delete().eq('user_id', user.id),
    admin.from('prediction_stats').delete().eq('user_id', user.id),
    admin.from('game_predictions').delete().eq('user_id', user.id),
    admin.from('push_subscriptions').delete().eq('user_id', user.id),
  ])

  const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id)
  if (deleteErr) {
    return new Response(JSON.stringify({ error: deleteErr.message }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
})
