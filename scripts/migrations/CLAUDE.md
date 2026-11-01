# Database traps

Loaded when you read a migration. Schema changes go through `npm run migrate` (see the root CLAUDE.md).

- **A PostgREST `.upsert()` needs a SELECT policy, and `wpbl_award_votes` deliberately has
  none.** An upsert becomes `insert ... on conflict do update`, and Postgres applies the
  SELECT policies to the conflicting row on that path, so the statement is refused even when
  there is nothing to conflict with. It fails as **"new row violates row-level security
  policy"**, which points at WITH CHECK expressions that are both literally `true`, and a
  plain `.insert()` of the same values succeeds. The fan-award ballot shipped this way on
  Sep 6, 2026 and every vote it ever took went nowhere; nothing noticed, because the ballot
  had no surface yet and a table at zero rows looks exactly like a poll nobody has voted in.
  Writes now go through `wpbl_cast_award_vote`, security definer, on the same footing as the
  two read RPCs beside it. **Any table whose rows the browser must not read cannot be
  upserted into by the browser**: give it a writer function instead.

- **Three write paths to the DB, and only three.** The browser writes user rows through RLS
  (events, feedback, picks; fan-award votes through their writer function); everything ingested or derived is written by service-role
  actors, the `wpbl-ingest` edge function and the GitHub Actions `scripts/*.mjs` jobs. The
  browser only reads those. The third is the **Discord bot**
  ([`functions/discord/wpbl.ts`](../../functions/discord/wpbl.ts)), which holds a service-role key
  for the `/predict` game alone: recording a pick is a write, the predictions tables are
  RLS-on with no policies, and the anon key ships in the client bundle so a pick recorded
  under it could be forged for any Discord user by anyone who opened dev tools. That is the
  whole of the exception. Do not add a fourth, and do not let the bot's key reach anything
  outside `wpbl_predict_*`.

- **A new function in `public` is callable by anyone, and `security definer` makes that dangerous.**
  Supabase's default privileges grant EXECUTE to `anon` on every function created, so a definer function
  with no check on the caller is an open door to everything its owner can write. `wpbl_merge_players` sat
  like this from Aug 22 to Nov 1, 2026, where any visitor could have merged players. Every new definer
  function either opens with `is_site_owner()` or ends in
  `revoke all on function ... from public, anon, authenticated`, unless the public is meant to call it.
  A `drop function` and re-create gets the default grants back; `create or replace` keeps the old ones.
