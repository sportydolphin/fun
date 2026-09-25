-- Send the feedback email FROM sportydolphin.fun instead of Resend's shared onboarding address.
--
-- The first version sent from onboarding@resend.dev, which Resend allows only to the account's own
-- address, so a note addressed to support@sportydolphin.fun was refused with a 403 that reads like
-- an unverified domain. The domain has been verified in Resend for months; the sender was the
-- limit. From our own domain it can go to any address, including support@, which Cloudflare Email
-- Routing forwards on. Only `v_from` changes; see the previous migration for everything else.

create or replace function public.email_new_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key  text;
  v_to   text;
  v_from text := 'sportydolphin.fun feedback <feedback@sportydolphin.fun>';
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

