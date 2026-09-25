-- Which publication a mirrored post came from, now that there are two.
--
-- Since Sep 25, 2026 the reading feed mirrors D.A. Espinoza's The Rising Fastball beside mary
-- mustard's towards a more perfect game, both with permission. Every card has to say WHOSE
-- writing it is (docs/READING.md section 1), so the credit is looked up per row by this key; see
-- SOURCES in src/wpbl/derive/articles.ts for the keys and everything hung off them.
--
-- The default is mary's key because every row that exists today is hers, and it keeps a
-- deploy-order gap harmless: an old sync still running against the new column writes her rows
-- under her name. Post ids are unique across all of Substack, so the primary key needs nothing.

alter table public.wpbl_articles
  add column if not exists source text not null default 'towards';

create index if not exists wpbl_articles_source_idx on public.wpbl_articles (source);

comment on column public.wpbl_articles.source is
  'The publication: ''towards'' (mary mustard) or ''rising-fastball'' (D.A. Espinoza). Keys in src/wpbl/derive/articles.ts SOURCES.';
