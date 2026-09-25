-- Email every new feedback note to the owner, from the database, through Resend.
--
-- WHY HERE AND NOT IN THE BROWSER. The form already inserts one row and the owner reads the
-- queue on /admin, which nobody opens unprompted: 13 notes in total, the last on Sep 17, 2026.
-- An insert trigger sees every note from every write path, needs no new endpoint or route, and
-- keeps the provider key off the client, where the anon key already proves anything shipped is
-- public.
--
-- IT MUST NEVER COST A NOTE. pg_net queues the request and returns at once, so the insert is not
-- slowed by the email API, and the whole body is wrapped so that a missing secret, a bad key or
-- a pg_net fault is a warning in the log and a row in the table, never a refused submission. The
-- queue on /admin stays the record; the email is only the nudge.
--
-- CONFIGURED BY TWO VAULT SECRETS, and a no-op until both exist:
--   resend_api_key      the Resend API key (re_...)
--   feedback_email_to   the address to deliver to
-- Set them in the SQL editor:
--   select vault.create_secret('re_...', 'resend_api_key');
--   select vault.create_secret('you@example.com', 'feedback_email_to');
-- Without a verified domain Resend delivers only to the address the account was created with,
-- from onboarding@resend.dev, which is all this needs. Verifying sportydolphin.fun in Resend
-- later means changing only `v_from`.
--
-- REPLY GOES TO THE SENDER when they left an address, so answering someone is one click.

create or replace function public.email_new_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key  text;
  v_to   text;
  v_from text := 'sportydolphin.fun feedback <onboarding@resend.dev>';
  v_body text;
  v_payload jsonb;
begin
  begin
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
    select decrypted_secret into v_to  from vault.decrypted_secrets where name = 'feedback_email_to' limit 1;
    if v_key is null or v_to is null then
      return new;
    end if;

    v_body := new.message
      || E'\n\n---\n'
      || 'From: '  || coalesce(new.email, 'no address left') || E'\n'
      || 'Signed in: ' || case when new.user_id is null then 'no' else 'yes (' || new.user_id::text || ')' end || E'\n'
      || 'Page: '  || coalesce('https://sportydolphin.fun' || new.path, 'unknown') || E'\n'
      || 'Browser: ' || coalesce(new.user_agent, 'unknown') || E'\n'
      || 'Queue: https://sportydolphin.fun/admin';

    v_payload := jsonb_build_object(
      'from', v_from,
      'to', jsonb_build_array(v_to),
      'subject', 'Feedback: ' || left(regexp_replace(new.message, '\s+', ' ', 'g'), 70),
      'text', v_body
    );
    -- Only a plausible address, so a typo in the optional field cannot make Resend refuse the
    -- whole message.
    if new.email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      v_payload := v_payload || jsonb_build_object('reply_to', new.email);
    end if;

    perform net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body    := v_payload
    );
  exception when others then
    raise warning 'email_new_feedback: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.email_new_feedback() from public;

drop trigger if exists email_new_feedback on public.feedback;
create trigger email_new_feedback
  after insert on public.feedback
  for each row
  execute function public.email_new_feedback();
