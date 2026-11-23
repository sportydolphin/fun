-- At-bats, sacrifice bunts and sacrifice flies against each pitcher, from the feed's own line.
--
-- WHY. A pitcher's BABIP is (H - HR) over the balls put in play, and a sacrifice bunt is not one:
-- the batter gave themself up. The batting side has `sh` and leaves it out; the pitching line had
-- no such column, so pitcher BABIP counted every bunt as a ball in play and the league read .371 on
-- Hitting and .368 on Pitching for the same 2026 balls (the gap is exactly its 10 sacrifice
-- bunts). The feed has carried all three on every pitcher's box-score line from the start (`ab`,
-- `sha`, `sfa`) and the ingest dropped them.
--
-- NULL, NOT 0, UNTIL A ROW IS WRITTEN WITH THEM. An existing row does not know its sacrifices;
-- `sumPitching` reads null as 0, which is the old arithmetic, so nothing moves until
-- scripts/backfill-wpbl-pitching-sacrifices.mjs (or a re-ingest) fills them in.

alter table public.wpbl_pitching_lines
  add column if not exists ab integer,
  add column if not exists sh integer,
  add column if not exists sf integer;

comment on column public.wpbl_pitching_lines.ab is 'At-bats against (feed `ab`).';
comment on column public.wpbl_pitching_lines.sh is 'Sacrifice bunts against (feed `sha`). Not a ball in play for BABIP.';
comment on column public.wpbl_pitching_lines.sf is 'Sacrifice flies against (feed `sfa`).';
