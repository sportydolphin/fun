-- Birth dates for WPBL players, sourced from the community-maintained "BDay" sheet
-- (scripts/ingest-wpbl-birthdays.mjs pulls it). The league's own feed carries `age` but
-- never a date, so this is the only way to get birthdays — and `age` alone can't tell you
-- when someone's birthday is, only roughly how old they are.
--
-- birth_date is nullable on purpose: the sheet covers 65 of the ~118 players on the roster,
-- and that gap is expected to persist.

alter table wpbl_players add column if not exists birth_date        date;
-- Where the date came from and how much to trust it. 'sheet' = the BDay sheet agreed with
-- itself; 'sheet-conflict' = the sheet listed two different dates for this player and the
-- zodiac grid was taken as authoritative. Nothing downstream should treat the second kind
-- as settled.
alter table wpbl_players add column if not exists birth_date_source text;

-- Zodiac sign from a date. Split out as a function so the sign is defined in exactly one
-- place — the generated column below, any backfill, and ad-hoc queries all agree.
-- IMMUTABLE is required for a generated column and is honest here: same date, same sign,
-- forever. Boundaries follow the common western tropical dates, matching the sheet.
create or replace function wpbl_zodiac(d date)
returns text
language sql
immutable
strict
as $$
  select case
    when (extract(month from d), extract(day from d)) < (1, 20)  then 'Capricorn'
    when (extract(month from d), extract(day from d)) < (2, 19)  then 'Aquarius'
    when (extract(month from d), extract(day from d)) < (3, 21)  then 'Pisces'
    when (extract(month from d), extract(day from d)) < (4, 20)  then 'Aries'
    when (extract(month from d), extract(day from d)) < (5, 21)  then 'Taurus'
    when (extract(month from d), extract(day from d)) < (6, 22)  then 'Gemini'
    when (extract(month from d), extract(day from d)) < (7, 23)  then 'Cancer'
    when (extract(month from d), extract(day from d)) < (8, 23)  then 'Leo'
    when (extract(month from d), extract(day from d)) < (9, 23)  then 'Virgo'
    when (extract(month from d), extract(day from d)) < (10, 23) then 'Libra'
    when (extract(month from d), extract(day from d)) < (11, 22) then 'Scorpio'
    when (extract(month from d), extract(day from d)) < (12, 22) then 'Sagittarius'
    else 'Capricorn'
  end
$$;

-- Generated rather than stored: a sign is a pure function of the date, so it can never drift
-- out of sync with a corrected birth_date.
alter table wpbl_players
  add column if not exists zodiac_sign text generated always as (wpbl_zodiac(birth_date)) stored;

-- Birthday lookups are "who has a birthday today/this month" — month/day, never the year.
create index if not exists wpbl_players_birthday_idx
  on wpbl_players ((extract(month from birth_date)), (extract(day from birth_date)))
  where birth_date is not null;
