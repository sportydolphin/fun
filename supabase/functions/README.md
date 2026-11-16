# Edge Functions

## delete-account

Lets a signed-in user delete their own account (used by the "Delete Account" button in Settings). It has to run server-side with the **service role key**: that key can never be shipped to the browser, which is why this is a Supabase Edge Function instead of a plain client-side call.

It verifies the caller's JWT first and only ever deletes *that* user's own row, never an arbitrary id passed in from the client.

### One-time setup

1. Install the Supabase CLI if you don't have it: `npm install -g supabase`
2. Log in: `supabase login`
3. Link this repo to the project (run from the repo root): `supabase link --project-ref <your-project-ref>`. The project ref is in the Supabase dashboard URL (`supabase.com/dashboard/project/<ref>`) or under Project Settings → General.
4. Deploy: `supabase functions deploy delete-account`

That's it: no secrets to configure manually. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available inside every Edge Function for the linked project.

### Redeploying after edits

Just re-run `supabase functions deploy delete-account`: it overwrites the previous version.

### Testing

Once deployed, the "Delete Account" button in the site's Settings dialog calls it directly (`supabase.functions.invoke('delete-account')`). To test from the CLI instead:

```sh
curl -i --request POST 'https://<project-ref>.supabase.co/functions/v1/delete-account' \
  --header "Authorization: Bearer <a real user access token>"
```

## admin-usage

Backs the Supabase sections of the admin Health tab: plan, estimated monthly cost, disk, database size, largest tables, storage and active users against the plan's quotas, and API requests. It calls the Supabase Management API with a personal access token, so it lives only here and the function answers only the site owner (`is_site_owner()` checked with the caller's JWT).

### Setup

1. Create a scoped token at supabase.com/dashboard/account/tokens with Read on **Organization Settings** (the plan), **Project Settings** (add-ons, disk), **Database** (the read-only queries) and **Usage Analytics** (request counts). Without Organization Settings the plan, the estimate and every quota read Unavailable.
2. `supabase secrets set MGMT_API_TOKEN=sbp_...` (the name cannot start with `SUPABASE_`, which Supabase reserves).
3. `supabase functions deploy admin-usage`

The cost is an estimate from the prices in `PLAN_TERMS` (`src/lib/supabaseUsage.ts`). The dashboard's real bill lives behind `/platform/...` endpoints that answer a personal access token with 401, so the card links the Billing page for the actual invoice.
