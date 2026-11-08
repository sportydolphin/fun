// Deno Edge Function: deletes the calling user's own account (auth user +
// their rows in app tables). Deploy with:
//   supabase functions deploy delete-account
// See supabase/functions/README.md for the full setup walkthrough.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Supabase platform for every Edge Function in this project, no need
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

  // Client scoped to the caller's own JWT: used only to verify who's asking.
  const callerClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await callerClient.auth.getUser()
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // Admin client (service role): only ever acts on the verified caller's own id.
  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Clean up app tables first. Some cascade from auth.users, but several hold the id in a plain
  // text column with no foreign key (usernames, survivor_*, wpbl_award_votes), so the cascade
  // never reaches them. The audit of Nov 8, 2026 found the last three missing from this list:
  // a deleted account's Streak Survivor history and pick'em answers outlived it.
  //
  // A NEW TABLE THAT STORES A USER ID GOES HERE, and on /delete-account (LegalPages.tsx).
  const steps = await Promise.all([
    admin.from('usernames').delete().eq('user_id', user.id),
    admin.from('user_preferences').delete().eq('user_id', user.id),
    admin.from('prediction_stats').delete().eq('user_id', user.id),
    admin.from('game_predictions').delete().eq('user_id', user.id),
    admin.from('push_subscriptions').delete().eq('user_id', user.id),
    admin.from('survivor_picks').delete().eq('user_id', user.id),
    admin.from('survivor_stats').delete().eq('user_id', user.id),
    // The pick'em keys its rows on the user id; the awards ballot keys on a browser key that
    // was never tied to an account (see SeriesPicks.tsx), so this reaches only the picks.
    admin.from('wpbl_award_votes').delete().eq('voter_key', user.id),
    // A photo tag describes a public photo, not the person, so it stays in the moderation queue
    // with the account link cut, as feedback does below. Its browser key and ip hash were
    // never tied to the account.
    admin.from('wpbl_photo_tag_suggestions').update({ user_id: null }).eq('user_id', user.id),

    // ANONYMIZED, NOT DELETED, and these two are the reason this list is not just the
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

  // Stop before the auth user if any cleanup failed. These calls resolve with an error rather
  // than throw, and this used to ignore them: a failed step still deleted the sign-in, which
  // left rows under an id nobody can sign in as again, so a retry from Settings was impossible.
  // Stopping here keeps the account, and the reader can simply try again.
  const failed = steps.map(s => s.error).filter(Boolean)
  if (failed.length) {
    console.error('delete-account cleanup failed', user.id, failed.map(e => e!.message))
    return new Response(JSON.stringify({ error: 'Cleanup failed; the account was not deleted.' }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

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
