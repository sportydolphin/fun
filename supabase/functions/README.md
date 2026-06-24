# Edge Functions

## delete-account

Lets a signed-in user delete their own account (used by the "Delete Account" button in Settings). It has to run server-side with the **service role key** — that key can never be shipped to the browser, which is why this is a Supabase Edge Function instead of a plain client-side call.

It verifies the caller's JWT first and only ever deletes *that* user's own row — never an arbitrary id passed in from the client.

### One-time setup

1. Install the Supabase CLI if you don't have it: `npm install -g supabase`
2. Log in: `supabase login`
3. Link this repo to the project (run from the repo root): `supabase link --project-ref <your-project-ref>` — the project ref is in the Supabase dashboard URL (`supabase.com/dashboard/project/<ref>`) or under Project Settings → General.
4. Deploy: `supabase functions deploy delete-account`

That's it — no secrets to configure manually. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available inside every Edge Function for the linked project.

### Redeploying after edits

Just re-run `supabase functions deploy delete-account` — it overwrites the previous version.

### Testing

Once deployed, the "Delete Account" button in the site's Settings dialog calls it directly (`supabase.functions.invoke('delete-account')`). To test from the CLI instead:

```sh
curl -i --request POST 'https://<project-ref>.supabase.co/functions/v1/delete-account' \
  --header "Authorization: Bearer <a real user access token>"
```
