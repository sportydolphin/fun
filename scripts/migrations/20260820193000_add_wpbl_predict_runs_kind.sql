-- The predictions game ships as "how many runs", and rounds close themselves.
--
-- Two check constraints written in 20260817225409_add_wpbl_predict_game.sql are too narrow for
-- the round type that actually shipped:
--
--   • `kind` allowed only 'score', the yes/no question ("will they score next inning"). The
--     round that ships is 'runs': how many runs the side scores in the half-inning coming up,
--     answered with 0 / 1 / 2 / 3+. Both stay allowed, since the yes/no round is still a
--     legitimate second type and dropping a value from a check constraint would strip the kind
--     off any historical row that used it.
--
--   • `status` had no name for a round that has stopped taking picks but has no answer yet,
--     which is most of a round's life: picks close as the inning starts and the half-inning
--     takes about ten minutes to play out. The game used to lean on a mod running
--     `/predict lock` at first pitch; it now closes itself, on whichever comes first of the
--     round's own timer and the feed reporting that the target half-inning has begun.
--     'locked' is what the card reads from to show closed buttons and "waiting on the
--     bottom of the 4th" rather than a countdown that has already run out.
--
-- Idempotent, and safe to re-run: dropping a constraint that is not there is a no-op, and both
-- new constraints are supersets of the old ones, so no existing row can fail them.

alter table public.wpbl_predict_rounds
  drop constraint if exists wpbl_predict_rounds_kind_check;
alter table public.wpbl_predict_rounds
  add constraint wpbl_predict_rounds_kind_check check (kind in ('score', 'runs'));

alter table public.wpbl_predict_rounds
  drop constraint if exists wpbl_predict_rounds_status_check;
alter table public.wpbl_predict_rounds
  add constraint wpbl_predict_rounds_status_check check (status in ('open', 'locked', 'graded', 'void'));

-- The settle pass asks "which rounds are still live" on every ingest, every two minutes, all
-- season. The existing (status, game_id) index covers 'open' and now covers 'locked' too, which
-- is the state a round spends most of its life in.
comment on column public.wpbl_predict_rounds.status is
  'open (taking picks) -> locked (closed, half-inning not settled) -> graded | void. A void round counts for nobody, in either direction.';
