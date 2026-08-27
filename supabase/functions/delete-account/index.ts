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

    // ANONYMISED, NOT DELETED, and these two are the reason this list is not just the
    // cascade. `events.user_id` and `feedback.user_id` are plain uuid columns with NO foreign
    // key to auth.users (see scripts/create_events.sql, scripts/create_feedback.sql), so
    // deleting the auth user does not touch them: before this, every deleted account left its
    // id sitting in the analytics log and on any note it had sent, which is personal data
    // surviving a deletion request. Nulling the column severs that link.
    //
    // Nulled rather than deleted because both tables treat a null user_id as a first-class
    // value already (signed-out visitor, anonymous sender), so the rows stay honest as counts
    // and reports without belonging to anybody. Deleting the events would silently rewrite
    // historical totals for activity that did happen, and deleting the feedback would lose an
    // open bug report; neither is what the person asked for. `feedback.email` goes too: it is
    // a reply-to the sender typed in, and someone deleting their account is not asking to be
    // written to. /delete-account states all of this, so change the two together.
    admin.from('events').update({ user_id: null }).eq('user_id', user.id),
    admin.from('feedback').update({ user_id: null, email: null }).eq('user_id', user.id),
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
