-- Run in your Supabase SQL editor AFTER create_wpbl.sql + seed_wpbl.sql +
-- add_wpbl_player_fields.sql (this uses the age/hometown/status/draft columns and the
-- (team_id, name) unique index those add).
--
-- WPBL rosters from the 2026 draft. Idempotent: `on conflict (team_id, name) do nothing`
-- so re-running never duplicates. age is null where the source omitted it.
--
-- Teams loaded: BOS, LA, SF, NY (all four). Source: league 2026 draft board.
-- One source typo corrected: Abigail Moore's hometown "Arglington" -> "Arlington, Texas".

-- ─── Boston Hunters ───────────────────────────────────────────────────────────
insert into wpbl_players (team_id, name, position, bats, throws, age, hometown, status, draft_round, draft_pick) values
  ('BOS', 'Hyeonah Kim',           'C',   'R', 'R', 26,   'Seoul, South Korea',                    'Signed',  1, 4),
  ('BOS', 'Alli Schroder',         'RHP', 'R', 'R', 24,   'Fruitvale, British Columbia, Canada',   'Signed',  1, 5),
  ('BOS', 'Raine Padgham',         'RHP', 'R', 'R', 21,   'Abbotsford, British Columbia, Canada',  'Signed',  1, 12),
  ('BOS', 'Lexi Hastings',         'LF',  'L', 'L', 23,   'Holly Springs, North Carolina, USA',    'Signed',  1, 20),
  ('BOS', 'Kate Blunt',            'SS',  'R', 'R', 23,   'Ladera Ranch, California, USA',          'Signed',  2, 1),
  ('BOS', 'Denver Bryant',         '2B',  'R', 'R', 23,   'Albany, Georgia, USA',                  'Signed',  2, 8),
  ('BOS', 'Ticara Geldenhuis',     'OF',  'R', 'R', 24,   'Waterfall, Australia',                  'Signed',  2, 9),
  ('BOS', 'Suzuka Yamamoto',       'SS',  'L', 'R', 27,   'Setouchi City, Japan',                  'Signed',  2, 16),
  ('BOS', 'Maïka Dumais',          'RHP', 'L', 'R', 18,   'Quebec City, Quebec, Canada',           'Signed',  2, 17),
  ('BOS', 'Gigi Schiano',          'RHP', 'R', 'R', 19,   'Berrysburg, Pennsylvania, USA',         'Signed',  3, 4),
  ('BOS', 'Maria José Valenzuela', 'IF',  'R', 'R', 29,   'Hermosillo, Mexico',                    'Signed',  3, 5),
  ('BOS', 'Molly Paddison',        'CF',  'L', 'L', 19,   'Pullenvale, Australia',                 'Signed',  3, 12),
  ('BOS', 'Beth Greenwood',        'C',   'R', 'R', 26,   'Amherst, New Hampshire, USA',           'Signed',  3, 13),
  ('BOS', 'Sabrina Robinson',      '1B',  'S', 'R', 23,   'Morristown, New Jersey, USA',           'Signed',  3, 20),
  ('BOS', 'Gabrielle Haas',        'SS',  'R', 'R', 24,   'Palm Beach Gardens, Florida, USA',      'Drafted', 4, 1),
  ('BOS', 'Paloma Benach',         'LHP', 'L', 'L', 23,   'Washington, District of Columbia, USA', 'Drafted', 4, 8),
  ('BOS', 'Stephanie Everett',     'LF',  'R', 'R', 29,   'Silver Spring, Maryland, USA',          'Drafted', 4, 9),
  ('BOS', 'Luciana Moreno',        'IF',  'R', 'R', null, 'Sun Prairie, Wisconsin, USA',           'Drafted', 4, 16),
  ('BOS', 'Allie Bebbere',         'RHP', 'R', 'R', 31,   'Montmorency, Australia',                'Drafted', 4, 17),
  ('BOS', 'Emily Baxter',          'OF',  'L', 'R', 26,   'Oakville, Ontario, Canada',             'Drafted', 5, 4),
  ('BOS', 'Braidy Birdsall',       '2B',  'R', 'R', 20,   'Saskatoon, Saskatchewan, Canada',       'Drafted', 5, 5),
  ('BOS', 'Edith De Leija',        '3B',  'R', 'L', 22,   'Aldama, Mexico',                        'Signed',  5, 11),
  ('BOS', 'Meaghan Houk',          'IF',  'R', 'R', 23,   'Ravena, New York, USA',                 'Drafted', 5, 12),
  ('BOS', 'Laura Hirai',           'RHP', 'L', 'R', 26,   'London, United Kingdom',                'Drafted', 5, 13),
  ('BOS', 'Olivia Bricker',        'LHP', 'L', 'L', 25,   'Cincinnati, Ohio, USA',                 'Drafted', 5, 20),
  ('BOS', 'Sadie Zion',            '1B',  'L', 'L', 20,   'Danbury, Connecticut, USA',             'Drafted', 6, 1),
  ('BOS', 'Nadia Diaz',            '3B',  'R', 'R', 26,   'Cicero, New York, USA',                 'Drafted', 6, 8),
  ('BOS', 'Nylah Ramirez',         'RHP', 'R', 'R', 29,   'Brooklyn, New York, USA',               'Drafted', 6, 9),
  ('BOS', 'Clara Rice',            'C',   'R', 'R', 21,   'USA',                                   'Drafted', 6, 16),
  ('BOS', 'Mary Grace O''Neill',   'CF',  'L', 'L', 22,   'Pleasantville, New York, USA',          'Drafted', 6, 17)
on conflict (team_id, name) do nothing;

-- ─── Los Angeles Queens ───────────────────────────────────────────────────────
insert into wpbl_players (team_id, name, position, bats, throws, age, hometown, status, draft_round, draft_pick) values
  ('LA', 'Ayami Sato',          'RHP', 'R', 'R', 36,   'Tokorozawa, Japan',                   'Signed',  1, 2),
  ('LA', 'Ashton Lansdell',     '3B',  'R', 'R', 25,   'Marietta, Georgia, USA',              'Signed',  1, 7),
  ('LA', 'Mo''ne Davis',        'CF',  'R', 'R', 25,   'Philadelphia, Pennsylvania, USA',     'Signed',  1, 10),
  ('LA', 'Meggie Meidlinger',   'RHP', 'R', 'R', 38,   'Sterling, Virginia, USA',             'Signed',  1, 15),
  ('LA', 'Thaima Maximiliana',  'SS',  'S', 'R', 19,   'Curacao',                             'Signed',  1, 18),
  ('LA', 'Jamie Mackay',        'C',   'R', 'R', 23,   'Laguna Beach, California, USA',        'Signed',  2, 3),
  ('LA', 'Emi Saiki',           'SS',  'L', 'R', 24,   'Kagawa, Japan',                       'Signed',  2, 6),
  ('LA', 'Samaria Benítez',     'SS',  'R', 'R', 23,   'Nayarit, Mexico',                     'Signed',  2, 11),
  ('LA', 'Maggie Foxx',         'C',   'R', 'R', 20,   'Bedford, New Hampshire, USA',         'Signed',  2, 14),
  ('LA', 'Michelle Roche',      'RHP', 'R', 'R', 20,   'Burnaby, British Columbia, Canada',   'Signed',  2, 19),
  ('LA', 'Suzu Narasaki',       'CF',  'R', 'R', 27,   'Setouchi City, Japan',                'Signed',  3, 2),
  ('LA', 'Caitlin Eynon',       'SS',  'L', 'R', 23,   'Perth, Australia',                    'Signed',  3, 7),
  ('LA', 'Sarah Edwards',       '1B',  'S', 'L', 30,   'Bay Shore, New York, USA',            'Signed',  3, 10),
  ('LA', 'Brittany Apgar',      'CF',  'R', 'L', 22,   'Greensboro, North Carolina, USA',     'Signed',  3, 15),
  ('LA', 'Leah Cornish',        'C',   'R', 'R', 19,   'Perth, Australia',                    'Drafted', 4, 3),
  ('LA', 'Juliette Kladko',     'LHP', 'L', 'L', 22,   'Vancouver, British Columbia, Canada', 'Drafted', 4, 6),
  ('LA', 'Amira Hondras',       '2B',  'L', 'R', 18,   'Chicago, Illinois, USA',              'Drafted', 4, 11),
  ('LA', 'Sydney Barry',        'RHP', 'L', 'R', 19,   'Fort Mcmurray, Alberta, Canada',      'Drafted', 4, 14),
  ('LA', 'Rio Obitsu',          '2B',  'R', 'R', 24,   'Saitama City, Japan',                 'Drafted', 4, 19),
  ('LA', 'Isabella Villarreal', '2B',  'R', 'R', 20,   'Newport, Michigan, USA',              'Drafted', 5, 2),
  ('LA', 'Elodie O''Sullivan',  'OF',  'R', 'R', 33,   'Perth, Australia',                    'Drafted', 5, 7),
  ('LA', 'Genevieve Hastings',  'SS',  'R', 'R', 20,   'Billings, Montana, USA',              'Drafted', 5, 10),
  ('LA', 'Ayuri Shimano',       'RHP', 'L', 'R', 22,   'Osaka, Japan',                        'Signed',  5, 15),
  ('LA', 'Luisa Hernandez',     '1B',  'R', 'R', 35,   'Lagos de Moreno, Jalisco, Mexico',    'Drafted', 5, 18),
  ('LA', 'Adelaide Frank',      '1B',  'L', 'L', 18,   'Oakville, Missouri, USA',             'Drafted', 6, 3),
  ('LA', 'Brittany Womack',     'RF',  'L', 'R', 38,   'San Diego, California, USA',          'Drafted', 6, 6),
  ('LA', 'Celicia Wilken',      '1B',  'L', 'L', 34,   'Austin, Texas, USA',                  'Drafted', 6, 11),
  ('LA', 'Trinity Curtis',      'RHP', 'R', 'R', 25,   'Oakhurst, California, USA',           'Drafted', 6, 14),
  ('LA', 'Addisyn Baird',       'SS',  'S', 'R', 18,   'Granger, Indiana, USA',               'Drafted', 6, 19)
on conflict (team_id, name) do nothing;

-- ─── San Francisco Firebells ──────────────────────────────────────────────────
insert into wpbl_players (team_id, name, position, bats, throws, age, hometown, status, draft_round, draft_pick) values
  ('SF', 'Kelsie Whitmore',            'RHP',      'R', 'R', 28, 'San Diego, California, USA',           'Signed',  1, 1),
  ('SF', 'Amanda Gianelloni',          '2B',       'R', 'R', 29, 'New Orleans, Louisiana, USA',          'Signed',  1, 8),
  ('SF', 'Joely Leguizamon',           'SS',       'R', 'R', 27, 'Jacksonville, Florida, USA',           'Signed',  1, 9),
  ('SF', 'Jill Albayati',              'RHP, UTL', 'R', 'R', 22, 'Anaheim, California, USA',             'Signed',  1, 16),
  ('SF', 'Samantha Gutierrez',         'C',        'R', 'R', 23, 'San Diego, California, USA',           'Signed',  1, 17),
  ('SF', 'Ayaka Yamamoto',             '3B',       'R', 'R', 22, 'Fukuyama, Japan',                     'Signed',  2, 4),
  ('SF', 'Niki Eckert',                'LHP',      'L', 'L', 23, 'Englewood, New Jersey, USA',           'Signed',  2, 5),
  ('SF', 'Andréanne Leblanc',          '1B',       'S', 'R', 24, 'Mont-Saint-Hilaire, Quebec, Canada',  'Signed',  2, 12),
  ('SF', 'Jua Park',                   'SS',       'R', 'R', 21, 'Hadong, South Korea',                 'Signed',  2, 13),
  ('SF', 'Alexia Jorge',               'C',        'R', 'R', 22, 'Lyndhurst, New Jersey, USA',           'Signed',  2, 20),
  ('SF', 'Ela Day-Bédard',             'IF',       'R', 'R', 21, 'Gatineau, Quebec, Canada',            'Signed',  3, 1),
  ('SF', 'Rosi del Castillo',          'CF',       'R', 'R', 28, 'Puebla, Mexico',                      'Signed',  3, 8),
  ('SF', 'Liz Gilder',                 'LHP',      'L', 'L', 25, 'Port Moody, British Columbia, Canada','Signed',  3, 9),
  ('SF', 'Skylar Kaplan',              'LF',       'L', 'R', 24, 'Glen Burnie, Maryland, USA',           'Signed',  3, 16),
  ('SF', 'Hinano Beppu',               '2B',       'R', 'R', 30, 'Nakagawa City, Japan',                'Signed',  3, 17),
  ('SF', 'Jordan Eyster',              'CF',       'L', 'L', 22, 'Royal Oak, Michigan, USA',             'Drafted', 4, 4),
  ('SF', 'Katie Reynolds',             'RHP',      'L', 'R', 24, 'Watertown, Massachusetts, USA',        'Drafted', 4, 5),
  ('SF', 'Peyton Coria',               'RHP',      'R', 'R', 19, 'Perris, California, USA',              'Drafted', 4, 12),
  ('SF', 'Kaija Bazzano',              'SS',       'R', 'R', 24, 'Sebastopol, California, USA',          'Drafted', 4, 20),
  ('SF', 'Kaelei Kajitani',            '1B',       'L', 'L', 22, 'Madera, California, USA',              'Drafted', 5, 1),
  ('SF', 'Kiley Ingram',               'RHP',      'R', 'R', 19, 'Ontario, California, USA',             'Drafted', 5, 8),
  ('SF', 'Scrappy Hopkins',            'C',        'R', 'R', 27, 'Fort Walton Beach, Florida, USA',      'Drafted', 5, 9),
  ('SF', 'Flor Elena Valerio Montoya', 'RHP',      'R', 'R', 24, 'Tijuana, Mexico',                     'Drafted', 5, 16),
  ('SF', 'Estheoa Segovia',            'C',        'R', 'R', 32, 'Tijuana, Mexico',                     'Drafted', 5, 17),
  ('SF', 'Bella Espinoza-Molina',      'RF',       'S', 'R', 23, 'Ladera Ranch, California, USA',        'Drafted', 6, 4),
  ('SF', 'Arwen McCullough',           'RHP',      'R', 'R', 22, 'Livermore, California, USA',           'Drafted', 6, 5),
  ('SF', 'Allie Lacey',                '2B',       'R', 'R', 32, 'La Crescenta, California, USA',        'Drafted', 6, 12),
  ('SF', 'Micaela Minner',             '1B',       'L', 'L', 40, 'Akron, Ohio, USA',                    'Drafted', 6, 13),
  ('SF', 'Kailyn Bearpaw',             '1B',       'R', 'R', 23, 'Sapulpa, Oklahoma, USA',              'Drafted', 6, 20)
on conflict (team_id, name) do nothing;

-- ─── New York Heights ─────────────────────────────────────────────────────────
insert into wpbl_players (team_id, name, position, bats, throws, age, hometown, status, draft_round, draft_pick) values
  ('NY', 'Kylee Lahners',       '3B',  'R',  'R',  33,   'Pinehurst, North Carolina, USA',      'Signed',  1, 3),
  ('NY', 'Denae Benites',       'C',   'R',  'R',  24,   'Las Vegas, Nevada, USA',              'Signed',  1, 6),
  ('NY', 'Rakyung Kim',         'RHP', 'R',  'R',  26,   'Seoul, South Korea',                  'Signed',  1, 11),
  ('NY', 'Valerie Perez',       'SS',  'R',  'R',  34,   'Corpus Christi, Texas, USA',          'Signed',  null, null),
  ('NY', 'Jaida Lee',           'RHP', 'R',  'R',  20,   'St. John''s, Newfoundland, Canada',   'Signed',  1, 14),
  ('NY', 'London Studer',       '1B',  'L',  'L',  20,   'Gahanna, Ohio, USA',                  'Signed',  1, 19),
  ('NY', 'Keira Izumi',         'SS',  'R',  'R',  19,   'San Diego, California, USA',           'Signed',  2, 2),
  ('NY', 'Natsuki Yonetani',    'LF',  'R',  'R',  24,   'Saitama, Japan',                      'Signed',  2, 7),
  ('NY', 'Alyssa Zettlemoyer',  'C',   'R',  'R',  19,   'Murrieta, California, USA',            'Signed',  2, 10),
  ('NY', 'Madison Willan',      'IF',  'R',  'R',  25,   'Edmonton, Alberta, Canada',           'Signed',  2, 15),
  ('NY', 'Claire Eccles',       'CF',  'L',  'L',  28,   'Vancouver, British Columbia, Canada', 'Signed',  2, 18),
  ('NY', 'Elodie Ciamarro',     'C',   'R',  'R',  19,   'Mont-Saint-Hilaire, Quebec, Canada',  'Signed',  3, 3),
  ('NY', 'Jacqui Reynolds',     'RHP', 'R',  'R',  31,   'Woburn, Massachusetts, USA',          'Signed',  3, 6),
  ('NY', 'Diana Ibarra',        'CF',  'R',  'R',  26,   'Tepatitlan, Mexico',                  'Signed',  3, 11),
  ('NY', 'Claire O''Sullivan',  'RHP', 'R',  'R',  31,   'Maroubra, Australia',                 'Signed',  3, 14),
  ('NY', 'McKenna Huff',        'SS',  'R',  'R',  20,   'Fairfax, Virginia, USA',              'Drafted', 3, 19),
  ('NY', 'Maddison Erwin',      'RHP', 'R',  'R',  24,   'Canberra, Australia',                 'Drafted', 4, 2),
  ('NY', 'Angelis Rivera',      'RHP', 'S',  'R',  26,   'Juncos, Puerto Rico',                 'Drafted', 4, 7),
  ('NY', 'Rocio Barajas',       'RHP', 'R',  'R',  28,   'Puerto Vallarta, Mexico',             'Drafted', 4, 10),
  ('NY', 'Nicole Rivera-Moats', '2B',  'L',  'R',  37,   'USA',                                 'Drafted', 4, 15),
  ('NY', 'Katherine Murphy',    'LF',  'R',  'R',  19,   'Belmont, Massachusetts, USA',         'Drafted', 4, 18),
  ('NY', 'Zoe Falardeau',       'RHP', 'L',  'R',  18,   'Welland, Ontario, Canada',            'Drafted', 5, 3),
  ('NY', 'Adelaide Ziebart',    'RF',  'L',  'R',  22,   'Saskatoon, Saskatchewan, Canada',     'Drafted', 5, 6),
  ('NY', 'Angela Valenzuela',   'RHP', 'R',  'R',  19,   'Phoenix, Arizona, USA',               'Drafted', 5, 14),
  ('NY', 'Melissa Mayeux',      'SS',  'R',  'R',  27,   'Louviers, France',                    'Drafted', 5, 19),
  ('NY', 'Chloe Atkinson',      null,  'R',  'R',  19,   'Perth, Australia',                    'Drafted', 6, 2),
  ('NY', 'Milanyela Cortez',    'RHP', 'R',  'R',  28,   'Barquisimeto, Venezuela',             'Drafted', 6, 7),
  ('NY', 'Abigail Moore',       'C',   'R',  'R',  18,   'Arlington, Texas, USA',               'Drafted', 6, 10),
  ('NY', 'Minseo Park',         null,  null, null, null, 'Seoul, South Korea',                  'Drafted', 6, 15),
  ('NY', 'Sarah Beaulieu',      'RHP', 'L',  'R',  22,   'Rivière-Du-Loup, Québec, Canada',     'Drafted', 6, 18)
on conflict (team_id, name) do nothing;
