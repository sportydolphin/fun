-- add wpbl predict game
-- Created 2026-08-17. Applied then and recorded in `schema_migrations`, but the file itself
-- was never committed, which is why `npm run migrate -- status` had been reporting it as
-- "recorded as applied but no file present" ever since. Reconstructed from the live schema
-- on 2026-08-20.
--
-- **The filename is load-bearing.** The runner's version string is the filename minus `.sql`,
-- so this must stay `20260817225409_add_wpbl_predict_game` to match the row already in
-- `schema_migrations`. Rename it and the runner sees a pending migration and re-runs it
-- against production. Every statement below is idempotent anyway, but the point of the file
-- is that a database rebuilt from this repo gets these tables, which until now it would not
-- have: the /predict game existed only in production.
--
-- What it backs: the Discord `/predict` game (docs/DISCORD.md). A mod opens a round about a
-- half-inning that has not started yet, which is the thing that makes it fair; players answer
-- with message buttons; `wpbl-ingest` settles the round against the half-inning it just wrote
-- (supabase/functions/wpbl-ingest/settle-predictions.ts).
--
-- RLS is ON with NO POLICIES on all three tables, deliberately. Every write comes from a
-- service-role actor (the Cloudflare Pages Function behind /predict, and the wpbl-ingest edge
-- function), which bypasses RLS entirely. The anon key ships inside the client bundle, so the
-- browser cannot be trusted to say which Discord user a pick belongs to. No policy is what
-- makes the browser unable to read or write any of this, and that is the intent rather than
-- an oversight: do not "fix" it by adding a public-read policy.

-- ─── Rounds ───────────────────────────────────────────────────────────────────
-- One row per question a mod opens. `anchor_sequence` is where the play log stood when the
-- round opened, so settling can tell the half-inning's plays from anything already on the
-- board. `interaction_token` is the fallback path for editing the round's own message when
-- no bot token is configured; it dies after 15 minutes, and a half-inning takes about ten.
create table if not exists public.wpbl_predict_rounds (
  id                uuid primary key default gen_random_uuid(),
  game_id           uuid not null references public.wpbl_games (id) on delete cascade,
  kind              text not null check (kind = 'score'),
  guild_id          text not null,
  channel_id        text not null,
  message_id        text,
  interaction_token text,
  application_id    text,
  opened_by         text not null,
  question          text not null,
  situation         text not null,
  options           jsonb not null,
  target_inning     int  not null,
  target_half       text not null check (target_half in ('top', 'bottom')),
  anchor_sequence   int  not null default 0,
  locks_at          timestamptz not null,
  status            text not null default 'open' check (status in ('open', 'graded', 'void')),
  correct_key       text,
  outcome           text,
  detail            text,
  opened_at         timestamptz not null default now(),
  closed_at         timestamptz,
  graded_at         timestamptz
);

-- Settling asks "which rounds on this game are still open", and the game view asks for a
-- game's rounds oldest-first.
create index if not exists wpbl_predict_rounds_open_idx on public.wpbl_predict_rounds (status, game_id);
create index if not exists wpbl_predict_rounds_game_idx on public.wpbl_predict_rounds (game_id, opened_at);

-- ─── Picks ────────────────────────────────────────────────────────────────────
-- Keyed on (round, user) so a player answering twice replaces their own answer rather than
-- stuffing the ballot. `response_ms` is the tiebreak for the per-game winner: everyone who
-- gets the same number right is separated by how fast they were.
create table if not exists public.wpbl_predict_picks (
  round_id        uuid not null references public.wpbl_predict_rounds (id) on delete cascade,
  discord_user_id text not null,
  display_name    text not null default '',
  option_key      text not null,
  response_ms     int  not null default 0,
  correct         boolean,
  picked_at       timestamptz not null default now(),
  primary key (round_id, discord_user_id)
);

create index if not exists wpbl_predict_picks_user_idx on public.wpbl_predict_picks (discord_user_id);

-- ─── Winners ──────────────────────────────────────────────────────────────────
-- One row per game, written when the game goes final. Nullable winner columns because a game
-- can end with rounds played and nobody having answered any of them.
create table if not exists public.wpbl_predict_winners (
  game_id         uuid primary key references public.wpbl_games (id) on delete cascade,
  discord_user_id text,
  display_name    text,
  correct         int not null default 0,
  answered        int not null default 0,
  mean_ms         int not null default 0,
  rounds          int not null default 0,
  channel_id      text,
  message_id      text,
  announced_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- ─── RLS: on, with no policies ────────────────────────────────────────────────
-- See the header. Service-role writers bypass this; the browser gets nothing, on purpose.
alter table public.wpbl_predict_rounds  enable row level security;
alter table public.wpbl_predict_picks   enable row level security;
alter table public.wpbl_predict_winners enable row level security;
