// The site changelog, newest first. Split out of ./version.ts so it stays out of the entry
// chunk. See the note there. Loaded on demand when the "What's New" dialog opens.
// Only the newest releases live here; older ones are archived under ./changelog/ by minor-version
// range and appended below, so a new entry is a small edit at the top of a small file. When this
// list passes 1.249.x, move 1.200 to 1.249 into its own archive file the same way.
//
// ONLY THE NEWEST ARCHIVE COMES WITH THE DIALOG. The dialog opens on five days, and this file
// alone cannot fill them, so 1.150 to 1.199 rides along; the older archives (about 230 KB and up
// of prose, most of the dialog's chunk) load when a reader asks for earlier updates. Until
// Oct 15, 2026 every archive was a static import here, and the dialog's chunk was 80 KB gzipped.
import type { ChangelogEntry } from './version'
import { ENTRIES as v1_150 } from './changelog/v1.150-1.199'

/** Every release older than CHANGELOG holds, newest first. */
export async function loadOlderChangelog(): Promise<ChangelogEntry[]> {
  const [v1_100, v1_050, v1_000] = await Promise.all([
    import('./changelog/v1.100-1.149'),
    import('./changelog/v1.050-1.099'),
    import('./changelog/v1.000-1.049'),
  ])
  return [...v1_100.ENTRIES, ...v1_050.ENTRIES, ...v1_000.ENTRIES]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.232.1',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Find: Hitting, Pitching and Fielding in the question',
        full:  'Find’s Hitting, Pitching and Fielding switch is in the Question card, beside Games to Seasons, instead of the Stats bar, and no longer shows an Overall it cannot search.',
      },
      {
        short: 'Find: long column heads wrap',
        full:  'A long column head on Find, such as "HR ROW" on plate appearances, wraps onto two lines instead of running into the column beside it.',
      },
      {
        short: 'Find: ignored words stay on screen',
        full:  'Words Find did not understand stay listed under the box after you ask, as you typed them, so a dropped club or name is not lost when the question becomes chips.',
      },
      {
        short: 'Small phones: the top bar and Find fit',
        full:  'On a 320px phone the search button no longer sits on the MLB | WPBL switch, and Find’s Games to Seasons switch fits the card.',
      },
      {
        short: 'Find: the question card',
        full:  'The card that holds a Find question is titled Question, so it is no longer a second thing called Search beside the toolbar’s. Once a question is set, the box offers to add to it instead of showing an example, and Add is a solid button.',
      },
      {
        short: 'Search: answers stand out',
        full:  'An answer in a search row, such as "11 HR · 2026", is in blue so it no longer reads as a second name, the page behind the search box is dimmed further, and the examples are in sentence case.',
      },
    ],
  },
  {
    version: '1.232.0',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Plays that ended 0-0 are counted',
        full:  'The league leaves the pitches off a plate appearance that ended without one recorded: every intentional walk, and some first-pitch hits, hit batters and sacrifices. Find, firsts and the inning and plate-appearance boards skipped those 52 trips of 2026 and now count them, matching the box scores.',
      },
      {
        short: 'Search: firsts for balks, steals, pickoffs and more',
        full:  'Search answers "first balk", "first stolen base", "first caught stealing", "first pickoff", "first wild pitch", "first passed ball", "first double play" and "first triple play", each opened at the play. Also: first single, sacrifice fly, sacrifice bunt, bunt hit, infield hit, pinch hit, pinch-hit home run, leadoff home run and steal of home.',
      },
    ],
  },
  {
    version: '1.231.0',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Find: the closest questions when nothing matches',
        full:  'A Find question with no matches offers the nearest ones that have some, each with its count: the same question on Pitching or Hitting, a number one step easier ("Strikeouts ≥ 7"), a condition dropped, or any opponent, club or month. Tap one to ask it.',
      },
    ],
  },
  {
    version: '1.230.0',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Find: the question as chips',
        full:  'Each piece of a Find question is a chip. Tap one to change it: the stat, at least, exactly or at most, and the number with − and + beside it. "+ Add" offers every stat with a search, and the club, opponent, home or away, month, last games and player. It opens beside the chip on a computer and as a sheet on a phone, and the count updates as you change it.',
      },
      {
        short: 'Find: no form to scroll past',
        full:  'The stack of dropdowns under the question is gone, so the matches start right under it.',
      },
    ],
  },
  {
    version: '1.229.0',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Find on a phone: a card per match',
        full:  'Each match on a phone is a card with its stats in labeled cells, the ones you asked about first and in color, in place of one line of text beside a big number. That number was sometimes a stat nobody asked for: "Strikeouts at least 6" showed every row as innings pitched.',
      },
      {
        short: 'Find: the answer first',
        full:  'The line over the matches says how many and when, and "3 pitchers, once each" moved into it from a card of its own. The table puts the stats you asked about first, and an exact one like a 0-2 count last, since it reads the same on every row.',
      },
    ],
  },
  {
    version: '1.228.0',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Search reads the verbs',
        full:  'Search reads "hit 2 home runs", "drove in 5", "gave up 3 home runs", "struck out 10 batters", "walked 5 batters", "stole 2 bases" and "caught stealing twice" as the stat they mean. "Hit 2 home runs" was two hits, and "drove in 5 runs" five runs scored.',
      },
      {
        short: 'Search: home runs by who was on, and one-run games',
        full:  'Search finds solo, two-run and three-run home runs, first-pitch home runs, two-out RBI and walk-off wins. "One-run games", "one-run wins" and "one-run losses" are a club’s games by the margin; before, "one run games" asked for a run scored.',
      },
      {
        short: 'Search: more ways to ask',
        full:  '"hr and a triple" asks for both. Golden sombreros, Madduxes and relievers with a stat line ("relievers with 3 ks") are each a question of their own, "most k’s" ranks strikeouts, and a rate at home or on the road ("road avg", "home era") ranks the leaders there.',
      },
      {
        short: 'Find: against one pitcher, and in one situation',
        full:  'Search answers "hr off Whitmore", "3 hits off Whitmore" and "avg against Schroder" with every batter’s season against that pitcher, and "avg with RISP", "ops with 2 outs", "avg with the bases loaded" and "avg on 0-2" with the leaders in that spot. Find’s season totals can be cut by the pitcher and by the situation too.',
      },
    ],
  },
  {
    version: '1.227.0',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Every sacrifice bunt counted',
        full:  'Three of the season’s ten sacrifice bunts are written "SAC" with no "bunt" in the play-by-play, and were missing from bunt counts. They are counted now, so the bunt totals match the box scores.',
      },
      {
        short: 'Sacrifices fixed in Find, batter vs pitcher and wOBA',
        full:  'A club’s half-inning in Find no longer counts a sacrifice fly as a bunt or a sacrifice bunt as an at-bat. Batter vs pitcher no longer counts a sacrifice bunt as an at-bat. And a sacrifice bunt no longer counts as an ordinary out in the wOBA baseline, which moves wOBA and run values very slightly.',
      },
    ],
  },
  {
    version: '1.226.0',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Find: pick a month or the last games',
        full:  'Find has a When row: a month of the season, or a club’s or a player’s last 1, 5, 10, 15 or 20 games. Before, only the search box could set these.',
      },
      {
        short: 'Search: a range of dates and a month on its own',
        full:  'Search reads "hr aug 1 to aug 15", "avg between aug 1 and 15", "3 hits aug 1-15", "from august to september" and a month typed beside a stat, like "august hr".',
      },
      {
        short: 'Most bunts, bunt hits, infield hits and pinch hits',
        full:  '"Most bunts" ranks hitters by their bunts over the season, from the play-by-play. Bunt hits, infield hits and pinch hits work the same way, and "2 bunts in a game" finds those games.',
      },
      {
        short: 'Search: more pages by name',
        full:  'Data sources, Open data, Fan awards and the Charts board now come up in search, and pages answer to more of the words people use for them, like "download", "vote" and "graph".',
      },
    ],
  },
  {
    version: '1.225.0',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Search: the answer on its own line',
        full:  'Who leads, how often it happened and a player’s stat now sit on their own line under each result, in dark text, instead of in the gray line below it.',
      },
      {
        short: 'Search: a record or a one-time feat opens the game',
        full:  '"Most home runs in a game", or anything that has happened once, opens that game’s box score on the club it was for. One inning or one at-bat opens the play-by-play at that play.',
      },
      {
        short: 'Games from Bests and Find open on the box score',
        full:  'A game opened from a Bests card or a Find row now opens on the box score, on the club whose line it was, rather than on the recap.',
      },
      {
        short: 'Search: no lost letters, and faster answers',
        full:  'Letters typed right after pressing / or Ctrl+K are no longer lost while the search opens, and the counts beside Find results come back faster.',
      },
    ],
  },
  {
    version: '1.224.0',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Find: named games, streaks and the plays the log names',
        full:  'Search and Find now know cycles, complete games, quality starts, perfect games, hitting and on-base streaks, hits in a row, leadoff home runs, pinch hits, bunt hits and infield hits. "Longest hitting streak" answers with the record and who holds it.',
      },
      {
        short: 'Find: splits by month, by the last few games and by the arm',
        full:  'Ask "hr since August", "avg in September", "Whitmore last game", "Queens last 10", "Hunters home record" or "avg vs lefties". A club’s games come back as its record, and a hitter’s line against left- or right-handed pitching is added up from every plate appearance. Each split shows as a chip on the board you can remove.',
      },
      {
        short: 'Search: lefties, switch hitters, youngest and oldest',
        full:  '"Lefties", "switch hitters", "left-handed hitters", "youngest player" and "oldest player" list the players, each row showing the hand or the age.',
      },
      {
        short: 'Search: fewer wrong answers',
        full:  '"Most double plays in a game" means the ones turned in the field, with grounding into one beside it. "Sato ERA vs Hunters" opens Sato’s season against them rather than reading ERA as an earned run, "playoffs" finds the season recap, and stat words like "bunt" and "late" no longer turn up a player with a similar name.',
      },
    ],
  },
  {
    version: '1.223.0',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Search: answers sooner',
        full:  'The counts, leaders and stat answers in search rows arrive about a tenth of a second after you stop typing, down from over half a second, and stay put as you type on or back. The highlighted row no longer jumps when a row lands above it, and typing partway through a word no longer flashes the list of examples.',
      },
      {
        short: 'Search: clearer rows',
        full:  'A question with a name is shown by its name: "Grand slams", "Shutouts", "No-hitters", "Immaculate innings". Two rows never share a title: "Most strikeouts by a pitcher" and "by a batter", "Ayami Sato vs Hunters (pitching games)". A plate-appearance question like "grand slams" offers one row rather than the same plays twice, and rows that never happened go after the ones that did.',
      },
    ],
  },
  {
    version: '1.222.0',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Find: club games',
        full:  'Find asks about a club’s whole game, beside single games: runs, hits and steals at the plate, strikeouts and hits allowed on the mound, errors in the field, and whether it won and by how much. Search reads "most runs in a game by a team", "teams with 15 hits", "shutouts", "no-hitters", "won by 10" and "errorless games". On MLB too.',
      },
      {
        short: 'Find: fielding by the inning',
        full:  'Putouts, assists, errors, double plays, passed balls and steals allowed can be asked by the inning, for each fielder with the position played, or for the club in the field: "most errors in an inning", "errors at shortstop", "2 errors in an inning by a team". The play-by-play names only the position ("error by ss"), so each is placed on whoever was playing there at the time.',
      },
      {
        short: 'Find: pickoffs and pitches seen',
        full:  'A pitcher’s pickoffs, a batter’s pitches seen, and a runner’s times picked off and steals of home can be asked over a game or a season: "most pickoffs", "most pitches seen in a game", "most times picked off", "steals of home".',
      },
    ],
  },
  {
    version: '1.221.0',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Search: how often, and when last',
        full:  'A search row that opens Find now says how often it happened and when it last did, before you open it: "3 strikeouts in an inning" reads "5 times · last Sep 3", and "immaculate inning" reads "Never". When one player did it most, the row names them. A record says the record: "most stolen bases in an inning" reads "Record 4 · Heights, Sep 4".',
      },
      {
        short: 'Search and Find: more stats',
        full:  'Stolen bases, caught stealing, pickoffs, wild pitches, passed balls and balks can be asked by the inning ("most stolen bases in an inning", "2 wild pitches in an inning"). Singles, extra-base hits, sacrifice flies and sacrifice bunts are new on Find at every grain. Fielding records ("most errors in a game") and season totals the stats tables have no column for ("most singles", "most errors", "most baserunners allowed") now have a search row.',
      },
      {
        short: 'Find: the dates of the matches',
        full:  'The line over Find’s results gives the first and the latest date it happened: "5 innings where Strikeouts at least 3 · Aug 2 to Sep 3".',
      },
    ],
  },
  {
    version: '1.220.0',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Search: fewer words needed',
        full:  'Search reads a question without its small words: "most walks game", "strikeouts inning", "most pitches at bat", "hr at bat". A stat against a club or at a place is a ranking too: "hr vs Boston" lists who has hit the most home runs off Boston, beside Boston’s own totals, and "hr at home" who has hit the most at home.',
      },
      {
        short: 'Find: switching to plate appearances',
        full:  'Switching Find to plate appearances drops a condition one plate appearance cannot meet, such as "5+ strikeouts", instead of showing 0.',
      },
    ],
  },
  {
    version: '1.219.0',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Search: a record for every stat',
        full:  'Search answers "most" for any stat in a game or an inning, not only the records Bests keeps: "most walks in a game", "most stolen bases in a game vs Boston", "most strikeouts in an inning 2026". The answer opens Find, ranked, with the record first. Add a player for their own: "most hr in a game by Whitmore".',
      },
      {
        short: 'Search: players in a question',
        full:  'Search reads a player’s name inside a question. "Sato vs Hunters" opens Sato’s games against Boston, and season totals against them. "Whitmore vs Schroder" opens every plate appearance between a batter and a pitcher, ahead of the side-by-side compare. "Whitmore 2-hit games" and "Schroder 3 strikeouts in an inning" ask the question of that player.',
      },
    ],
  },
  {
    version: '1.218.0',
    date:    '2026-11-10',
    changes: [
      {
        short: 'Find: batter vs pitcher',
        full:  'Find’s plate appearances take a batter, a pitcher or both, on Hitting or Pitching. Pick a pitcher to see who hit the home runs off them, a batter to see who struck them out, or both for every trip to the plate between the two, in order.',
      },
      {
        short: 'Find: one player',
        full:  'Find asks about one player too: their 3-hit games, their innings with 3 strikeouts, their season against one club. A player with nothing else asked is their game log. The player stays picked when you switch between games, plate appearances and seasons.',
      },
    ],
  },
  {
    version: '1.217.0',
    date:    '2026-11-09',
    changes: [
      {
        short: 'Leverage index',
        full:  'Leverage index (LI), built from the league’s own plays: 1.00 is an average plate appearance, 2.00 twice the stakes. The win probability chart shows it for every play. Player pages and the Stats table’s Overall side add pLI, the average leverage of a player’s plate appearances, and gmLI for relievers, the leverage when they entered.',
      },
    ],
  },
  {
    version: '1.216.0',
    date:    '2026-11-09',
    changes: [
      {
        short: 'Search: WPBL firsts',
        full:  'Search answers the league’s firsts: "first home run", "first grand slam of 2026", or "firsts" for all of them. Each row names the player and the day, and opens the game at that play. Hits, doubles, triples, home runs, grand slams, walks, strikeouts, hit by pitch and walk-offs.',
      },
      {
        short: 'Search: plate-appearance records',
        full:  'Search answers records set in one plate appearance and opens the game at that play: "longest at-bat", "most fouls", "longest strikeout", "most pitches thrown to one batter", "most runs on one play", "most strikeouts in a row", "most batters retired in a row". Add a situation, a club or a year ("longest walk with the bases loaded", "longest at-bat by the Firebells", "in the playoffs"). A shared record lists up to three plays, then the rest in Find.',
      },
      {
        short: 'Find: examples fit the season',
        full:  'Find’s examples name the best the season holds instead of a fixed bar that often found nothing: "6+ strikeouts", "7+ runs" in an inning, "3+ wins". They follow the club, year and playoffs on screen. Immaculate innings stay, at zero.',
      },
      {
        short: 'Game rows in search open the game',
        full:  'Picking a WPBL game in search ("Firebells last game") now opens it beside the page you were on. Before, the address changed and nothing opened.',
      },
    ],
  },
  {
    version: '1.215.0',
    date:    '2026-11-09',
    changes: [
      {
        short: 'Find: one layout on every side',
        full:  'Find draws the same way on Hitting, Pitching and Fielding: the question over the answers, with the same Games and Seasons switch. The search box has a search mark and an Ask button, and the results card defines every column behind its info dot. A leader card shortens all its names together.',
      },
    ],
  },
  {
    version: '1.214.0',
    date:    '2026-11-09',
    changes: [
      {
        short: 'Find: examples, chips, and logs',
        full:  'Find opens on its examples, grouped by games, innings, plate appearances and seasons, each with how often it happened. An asked question shows as chips, one per condition or club, each with its own ✕. A question every match answers alike, such as home runs on 0-2, lists in date order and leads each row with what differs. Names no longer cut off beside the tally, and clubs read by their nickname.',
      },
    ],
  },
  {
    version: '1.213.0',
    date:    '2026-11-09',
    changes: [
      {
        short: 'Find: plays in a row',
        full:  'WPBL Find searches runs of plays: back-to-back home runs, strikeouts in a row, batters retired in a row. Each run is one row, longest first. The search box reads "back-to-back homers", "5 straight strikeouts", "retired 9 in a row", "most runs in an inning", "comebacks" and "hits with runners on".',
      },
    ],
  },
  {
    version: '1.212.0',
    date:    '2026-11-09',
    changes: [
      {
        short: '2027 Rosters on Home',
        full:  'WPBL Home leads with 2027 Rosters: each club\'s re-signings out of 10, its newest re-signing, and the re-signing window. Each club opens /wpbl/rosters.',
      },
    ],
  },
  {
    version: '1.211.2',
    date:    '2026-11-09',
    changes: [
      {
        short: 'Find: club innings',
        full:  'WPBL Find\'s Hitting side searches a club\'s half-innings: 5-run innings, two-out rallies, comebacks, go-ahead innings. Each row is the club, with its runs, hits, two-out runs and the score it came from.',
      },
    ],
  },
  {
    version: '1.211.1',
    date:    '2026-11-09',
    changes: [
      {
        short: 'Find: RISP and which inning',
        full:  'WPBL Find asks about runners in scoring position and which inning a play came in: hits with RISP, home runs with the bases empty, 3 strikeouts in the 7th, walks in extra innings, strikeouts after the 5th.',
      },
    ],
  },
  {
    version: '1.211.0',
    date:    '2026-11-09',
    changes: [
      {
        short: 'Find by the inning and the at-bat',
        full:  'WPBL Find searches single innings (pitching) and single plate appearances (hitting and pitching): 3 strikeouts in an inning, immaculate and 1-2-3 innings, home runs on 0-2, bases-loaded walks, 10-pitch at-bats, walk-offs. Each row opens Game Center at that play, and search takes the question in words.',
      },
    ],
  },
  {
    version: '1.210.2',
    date:    '2026-11-09',
    changes: [
      {
        short: 'Stats filters on one row',
        full:  'The WPBL Stats filter row stays on one line on a desktop. When it runs short of room, the club chips become a club select first, then the season chips become a select, then the side switch tightens.',
      },
    ],
  },
  {
    version: '1.210.1',
    date:    '2026-11-09',
    changes: [
      {
        short: 'Wide tables on a phone',
        full:  'On a WPBL player card, a season table or game log wider than the screen fades at its right edge until you scroll to its last column.',
      },
      {
        short: 'Fielding in All stats',
        full:  'A WPBL player’s fielding line is a season table under All stats, after Plate discipline.',
      },
      {
        short: 'Player card on a phone',
        full:  'The line under a WPBL player’s name breaks only between facts, never inside "Age 24". Close, Copy link and the hit chart’s All, Hits and Outs are easier to tap.',
      },
    ],
  },
  {
    version: '1.210.0',
    date:    '2026-11-09',
    changes: [
      {
        short: 'WPBL 2027 rosters',
        full:  '2027 rosters, at /wpbl/rosters and in the More menu: each club\'s re-signings out of the 10 it may keep from its 2026 roster, each linked to its announcement, and the rest of the roster by 2026 WAR. The re-signing window runs Nov 9 to Nov 20. A 2026 player\'s card now has a 2027 line: Re-signed, Not yet re-signed, or Draft eligible once the window closes.',
      },
    ],
  },
  {
    version: '1.209.0',
    date:    '2026-11-08',
    changes: [
      {
        short: 'Stats to a spreadsheet',
        full:  'The Players and Teams boards on WPBL and the MLB Stats table end in CSV and Copy. CSV saves every row of the board as a file that opens in Excel, Google Sheets or Numbers; Copy puts the same table on the clipboard to paste into a sheet.',
      },
      {
        short: 'WPBL open data',
        full:  'Open data, at /wpbl/data and in the footer: every 2026 WPBL table (games, batting, pitching and fielding lines, plays, pitch tracking) and the clubs and players, each as a CSV for a spreadsheet or JSON for code.',
      },
    ],
  },
  {
    version: '1.208.3',
    date:    '2026-11-08',
    changes: [
      {
        short: 'Ties on every Stats board',
        full:  'WPBL Bests and Find mark a shared place "T-3", as Leaders and Players do. On MLB, Bests and Find do too.',
      },
      {
        short: 'Names in step',
        full:  'A card or table on Bests and Find shortens every name in it to "F. Last" together, so one column reads in one style.',
      },
      {
        short: 'Unavailable sides',
        full:  'On a WPBL Stats board, a side the board does not cover has a dotted outline and says which boards have it on hover, focus or tap.',
      },
      {
        short: 'Labels',
        full:  'WPBL Bests counts league games. The RBI board on Bests is "RBIs" on both leagues, matching Leaders. The WPBL chart size key has one dot.',
      },
    ],
  },
  {
    version: '1.208.2',
    date:    '2026-11-08',
    changes: [
      {
        short: 'Stats at Home’s width',
        full:  'Both Stats tabs are as wide as Home, and on both sections the page lines up with the logo at every width, with or without a scrollbar.',
      },
      {
        short: 'Tables fit their columns',
        full:  'The WPBL Players and Teams tables are as wide as their columns, so each number sits next to its name.',
      },
      {
        short: 'Club records on Teams',
        full:  'The WPBL Teams board leads with each club’s W-L, runs scored, runs allowed and run differential, and the footer follows its four rows.',
      },
      {
        short: 'Nine leader cards',
        full:  'Each WPBL Leaders side has nine cards: Overall adds Wins Added and Positional Adjustment in place of Position Player WAR, Hitting adds Walks, Pitching adds K/BB. Fielding has six, with Range Runs and Caught Stealing %.',
      },
      {
        short: 'Pos adj',
        full:  'The positional adjustment column on Overall is "Pos adj", with a glossary entry.',
      },
    ],
  },
  {
    version: '1.208.1',
    date:    '2026-11-08',
    changes: [
      {
        short: 'Shorter Leaders on phones',
        full:  'On a phone, each WPBL leader card shows its top three, with See all for the rest.',
      },
      {
        short: 'Whole game lines',
        full:  'On Bests and Find, a game line too long for a phone continues on a second line instead of being cut off. On both leagues.',
      },
      {
        short: 'One line per board',
        full:  'On a phone, the line under each name on WPBL Players → Overall shows the same two figures on every row: Pos WAR and Pit WAR when ranked by WAR, and the two parts of WAR that vary most otherwise.',
      },
      {
        short: 'Charts on phones',
        full:  'The WPBL Charts filters fit one row on a phone, with the clubs in one select. Player names on every scatter chart stay clear of the other dots, and a name with no clear spot is left off.',
      },
    ],
  },
  {
    version: '1.207.6',
    date:    '2026-11-08',
    changes: [
      {
        short: 'Stats keeps your side',
        full:  'On WPBL Stats, a board that has to show Hitting in place of Overall or Fielding goes back to your side on the next board that has it.',
      },
      {
        short: 'Season chips stay put',
        full:  'Regular season, Playoffs and Both are on every WPBL Stats board, shown as unavailable where the board does not split by them, so the bar holds its shape.',
      },
      {
        short: 'Run value: Overall',
        full:  "Run value's Overall side adds each player's batting and pitching, in runs and in wins. It replaces the Both ways switch in the wins card.",
      },
    ],
  },
  {
    version: '1.207.4',
    date:    '2026-11-07',
    changes: [
      {
        short: 'Search finds more pages',
        full:  "Search finds a page from the other section by name (Scorigami from MLB) and WPBL's fielding leaders. A search that finds nothing shows what the box understands.",
      },
    ],
  },
  {
    version: '1.207.3',
    date:    '2026-11-06',
    changes: [
      {
        short: 'More filters in links',
        full:  "Standard or Advanced on the Players and Teams boards, and the WPBL Charts board's Qualified and club, now hold through a reload, a shared link or Back.",
      },
    ],
  },
  {
    version: '1.207.2',
    date:    '2026-11-06',
    changes: [
      {
        short: 'Stats filters in links',
        full:  'A WPBL Stats board keeps its club, Playoffs or Both, and Everyone through a reload or a shared link. On both leagues, Everyone on the Players and Fielding boards does too.',
      },
      {
        short: 'Sheets and screen readers',
        full:  'Every sheet and dialog is announced as a dialog with its name, takes focus as it opens, keeps Tab inside it, and gives focus back when it closes. A player card is named for the player.',
      },
    ],
  },
  {
    version: '1.207.1',
    date:    '2026-11-06',
    changes: [
      {
        short: 'WPBL Stats sides',
        full:  'Overall and Fielding are grayed out on the WPBL Stats boards that have no such table, and pressing them no longer opens Leaders.',
      },
      {
        short: 'WPBL Stats on phones',
        full:  'The Hitting, Pitching, Fielding and Overall switch and the Sort button share one row on a phone again.',
      },
      {
        short: 'WPBL Overall table',
        full:  'The Overall table has no empty League avg row. On a phone, a player who only bats or only pitches shows Bat or Pit runs under the name in place of Pos WAR or Pit WAR, which repeated the WAR beside it.',
      },
    ],
  },
  {
    version: '1.207.0',
    date:    '2026-11-02',
    changes: [
      {
        short: 'Search ranking',
        full:  'WPBL search lists the closest names first, finds a name typed surname first or with an initial ("k whitmore"), and ignores accents, so "andreanne" finds Andréanne Leblanc.',
      },
      {
        short: 'Faster search',
        full:  'Search keeps the roster between visits, so it answers the first letter typed. MLB search finds this season’s players without waiting on MLB’s server.',
      },
      {
        short: 'WAR leaders',
        full:  'An empty WPBL search box shows the season’s WAR leaders until there are recent searches to show.',
      },
    ],
  },
  {
    version: '1.206.2',
    date:    '2026-11-02',
    changes: [
      {
        short: 'WPBL games played',
        full:  'WPBL player pages count games as a defensive sub or pinch runner, and the runs scored in them, so G and R match Home and the Stats table.',
      },
      {
        short: 'Player pages',
        full:  'All stats no longer repeats the summary table above the full tables. Batting, Pitching and Fielding headings are larger, and a two-way WPBL player shows Total WAR.',
      },
      {
        short: 'WPBL hit locations',
        full:  'The hit locations chart on a player page is smaller, with Pull, Center and Oppo beside it.',
      },
    ],
  },
  {
    version: '1.206.1',
    date:    '2026-11-01',
    changes: [
      {
        short: 'WPBL baserunning runs',
        full:  'WPBL baserunning runs now charge a runner for holding where most runners take the base. BsR and WAR move with them: the league’s BsR sums to zero, and Ashton Lansdell leads it.',
      },
      {
        short: 'WPBL catchers',
        full:  'WPBL catcher arm runs leave out throws that started at the pitcher. The awards card counts everyone who ran, so Denae Benites threw out 5 of 17. CS and CS% join the Fielding board, and SBA there counts catchers only.',
      },
      {
        short: 'WPBL team fielding',
        full:  'Team double plays and steals allowed on the WPBL Fielding board were counted more than once. Each double play and steal now counts once.',
      },
      {
        short: 'WPBL glossary',
        full:  'The WPBL glossary adds OPS+, ERA+, LOB, STR%, CS%, TC and the WAR parts, and its benchmarks use this league’s averages.',
      },
      {
        short: 'ERA rounding',
        full:  'A WPBL ERA that lands on a half now rounds up, matching the league.',
      },
      {
        short: 'MLB ERA+',
        full:  'A 0.00 ERA reads ∞ on the MLB ERA+ column and leads the board.',
      },
    ],
  },
  {
    version: '1.206.0',
    date:    '2026-11-01',
    changes: [
      {
        short: 'WPBL Home leaders',
        full:  'WPBL Home: 2026 Leaders now has WAR, names both players on a tie, and puts a player who leads two stats on one row. Each figure opens its stat on the Players board.',
      },
      {
        short: 'WPBL Home fan award winners',
        full:  'WPBL Home: 2026 Fan Award Winners now has Manager of the Year and the vote share of each winner, which opens the results for that award.',
      },
    ],
  },
  {
    version: '1.205.1',
    date:    '2026-11-01',
    changes: [
      {
        short: 'WPBL batter vs pitcher lines',
        full:  'WPBL batter vs pitcher lines now count infield flies as at-bats and no longer charge a batter for a runner picked off during the plate appearance.',
      },
    ],
  },
  {
    version: '1.205.0',
    date:    '2026-10-31',
    changes: [
      {
        short: 'MLB team card',
        full:  'The MLB team card is redrawn. The club name opens the club, and in the offseason the card counts its moves and opens them.',
      },
      {
        short: 'MLB division winners',
        full:  'MLB Home lists the division winners through the offseason.',
      },
      {
        short: 'Offseason report boards',
        full:  'Most Improved, Biggest Drops, Cheapest Wins and Priciest Wins join the MLB report boards once the regular season is over.',
      },
      {
        short: 'Hot Stove order',
        full:  "The Hot Stove card leads with the week's signings and trades, and Milestone Watch leads with the next marks.",
      },
    ],
  },
  {
    version: '1.204.0',
    date:    '2026-10-31',
    changes: [
      {
        short: 'MLB Scores on a phone',
        full:  'On a phone each MLB game on Scores is one row: status, clubs, runs, and the decisions or probable starters. A full day takes about a third of the scrolling. Line scores are in the game.',
      },
      {
        short: 'MLB schedule by month',
        full:  'Full schedule on the MLB team card is a calendar, one month at a time, with the record for the month.',
      },
    ],
  },
  {
    version: '1.203.0',
    date:    '2026-10-31',
    changes: [
      {
        short: 'MLB Home for the offseason',
        full:  'With no games left, MLB Home leads with the champion, your club and the Hot Stove. The bracket moves to the recap, and Predictions and Streak Survivor share one card with your record, the leaderboards and the date of Opening Day.',
      },
      {
        short: 'Full schedule, all season',
        full:  'Schedule on the MLB team card opens the whole season. It did nothing for a club with no game in the last two weeks.',
      },
    ],
  },
  {
    version: '1.202.2',
    date:    '2026-10-31',
    changes: [
      {
        short: 'Opening after an update',
        full:  "If the app's files fail to load after an update, it reloads once by itself and then shows a Reload button, instead of staying on the loading screen.",
      },
    ],
  },
  {
    version: '1.202.1',
    date:    '2026-10-30',
    changes: [
      {
        short: 'Pages open at the top',
        full:  "A page opened from a link, such as Watch or the season recap, starts at its top instead of at the depth of the page before it.",
      },
    ],
  },
  {
    version: '1.202.0',
    date:    '2026-10-30',
    changes: [
      {
        short: 'WPBL Watch: Hide scores',
        full:  "Hide scores on the Games shelf keeps results off the game cards and video pages, and is remembered on this browser.",
      },
      {
        short: 'WPBL: Watch this game and All clips',
        full:  "Game Center has Watch this game: the game's videos, then its clips in the order of the plays. Player pages link to All clips, and a video playing over a page links to its Video page.",
      },
      {
        short: 'WPBL: video links show the poster',
        full:  "A shared link to a WPBL video shows its title and poster.",
      },
    ],
  },
  {
    version: '1.201.0',
    date:    '2026-10-30',
    changes: [
      {
        short: 'WPBL Watch: Best games',
        full:  "Best games ranks every game by its swings in win probability and opens the condensed game. Lead changes, ties and extra innings are listed. Scores stay off the row.",
      },
      {
        short: 'WPBL Watch: Biggest plays and Home runs',
        full:  "Biggest plays ranks clips by how far the play moved win probability. Home runs has its own row, and Plays filters by kind of play and by player.",
      },
      {
        short: 'WPBL Watch: Players',
        full:  "A Players shelf lists everyone in a clip. Each player has their own view of their clips, with an address to share.",
      },
    ],
  },
  {
    version: '1.200.0',
    date:    '2026-10-30',
    changes: [
      {
        short: 'WPBL Watch: a front page',
        full:  "Watch opens on a featured video, then rows for Continue watching, Latest, Games, Plays, Season compilations and Podcast, each with a link to the whole shelf.",
      },
      {
        short: 'WPBL Watch: new shelves',
        full:  "Watch has Featured, Games, Plays, Clips, Features and Podcast. Plays are the clips from a game. One Club menu narrows Games, Plays and Clips.",
      },
    ],
  },
  ...v1_150,
]
