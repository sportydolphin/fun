// The site changelog, newest first. Split out of ./version.ts so it stays out of the entry
// chunk. See the note there. Loaded on demand when the "What's New" dialog opens.
// Only the newest releases live here; older ones are archived under ./changelog/ by minor-version
// range and appended below, so a new entry is a small edit at the top of a small file. When this
// list passes 1.199.x, move 1.150 to 1.199 into its own archive file the same way.
//
// ONLY THE NEWEST ARCHIVE COMES WITH THE DIALOG. The dialog opens on five days, and this file
// alone holds four, so 1.100 to 1.149 rides along to fill it; the two older archives (about 230 KB
// of prose, most of the dialog's chunk) load when a reader asks for earlier updates. Until
// Oct 15, 2026 every archive was a static import here, and the dialog's chunk was 80 KB gzipped.
import type { ChangelogEntry } from './version'
import { ENTRIES as v1_100 } from './changelog/v1.100-1.149'

/** Every release older than CHANGELOG holds, newest first. */
export async function loadOlderChangelog(): Promise<ChangelogEntry[]> {
  const [v1_050, v1_000] = await Promise.all([
    import('./changelog/v1.050-1.099'),
    import('./changelog/v1.000-1.049'),
  ])
  return [...v1_050.ENTRIES, ...v1_000.ENTRIES]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.178.0',
    date:    '2026-10-21',
    changes: [
      {
        short: 'No emoji, one date format',
        full:  "The emoji beside MLB's report cards, Milestone Watch, Roster moves, Predictions and Streak Survivor are gone, as are the fire and poop badges on a player's stat ranks, the medals on leaderboards and recaps, and the trophies on the champion cards. Every game date reads Aug 12, including Bests, Find and the season recap, which showed 8/12 and 2026-08-30. Scores, records and series lines use an en dash (3–2), and negative numbers a true minus. Player of the day only features a player who has played.",
      },
    ],
  },
  {
    version: '1.177.0',
    date:    '2026-10-21',
    changes: [
      {
        short: 'Display fixes',
        full:  "Zeros in game logs, unplayed playoff games, the fan-awards deadline and the unpicked side in Predictions are easier to read. Long names on the star sign card and club rosters now fit on a phone, and the Overall stats list shows two stats under each name so the line is no longer cut off. A switch hitter's spray chart shows Pull as a dash, with the reason behind the i.",
      },
    ],
  },
  {
    version: '1.176.0',
    date:    '2026-10-21',
    changes: [
      {
        short: 'Tab bar on every page',
        full:  "On a phone, the tab bar now stays at the bottom of every page in both sections, including the photo gallery, Reading, Watch, the glossary and Compare, with More lit. On the stats list, a player with no number for the stat being ranked is left off the list; the full table still shows everyone.",
      },
    ],
  },
  {
    version: '1.175.0',
    date:    '2026-10-21',
    changes: [
      {
        short: 'Glass tab bar on phones',
        full:  "The tab bar at the bottom of the screen on a phone is now frosted glass: the page shows through it, blurred, as it scrolls underneath, and the selected tab sits in a lit bubble. If your phone is set to reduce transparency, the bar stays solid.",
      },
    ],
  },
  {
    version: '1.174.0',
    date:    '2026-10-21',
    changes: [
      {
        short: 'WPBL Charts board',
        full:  "New board: WPBL Stats > Analysis > Charts. Hitting: OBP vs SLG, Swing% vs Contact%. Pitching: ERA vs FIP, F-Strike% vs BB%. Overall: Pos WAR vs Pit WAR. Regular season. Qualified players by default.",
      },
    ],
  },
  {
    version: '1.173.0',
    date:    '2026-10-21',
    changes: [
      {
        short: 'Report cards look back on the season',
        full:  "Once the regular season ends, MLB's schedule boards rank every game each club played, against its opponents' final records (each leaving out its games against that club), instead of going blank with no games left. Oldest and Youngest Rosters count the players who played for each club that season, at their age for it and weighted by playing time, so winter moves do not change them. Every report card row now draws its bar the full width under the name, and on the Report cards page the season picker sits beside the title instead of pinned in a band of its own.",
      },
    ],
  },
  {
    version: '1.172.0',
    date:    '2026-10-21',
    changes: [
      {
        short: 'Labels, not explanations',
        full:  "Boards, charts and empty states on both sections now name what they show. The intro lines and subtitles on Run value, Pitch by pitch, Tracked, Bests, Draft, the season recap and the standalone pages are gone; what a number means is behind the i beside its title. Draft's filters are All and 20+ PA, and its headline is the correlation, r. MLB's report cards are named by their stat (Wins Above Expected, Most Pitches per PA, Highest Salaries) without the tag beside each row, and the chart corners read LOW ERA · HIGH OPS and HIGH PAYROLL · .500+. An empty board says No data, No plays or No games.",
      },
    ],
  },
  {
    version: '1.171.0',
    date:    '2026-10-16',
    changes: [
      {
        short: 'Plate discipline on player pages',
        full:  "All stats on every player page now ends with a Plate discipline table, with the league average under it: pitches per plate appearance, swing, contact, whiff and swinging-strike rates for a hitter, and strike, swing, whiff and swinging-strike rates for a pitcher. WPBL pages, read from every pitch in the play log, also show called strikes for a hitter and first-pitch strikes and two-strike putaways for a pitcher. WPBL's pitch profile is now just the pitch mix, and every new term is in both glossaries.",
      },
    ],
  },
  {
    version: '1.170.0',
    date:    '2026-10-16',
    changes: [
      {
        short: 'Player pages lead with a stat table',
        full:  "Every player page, WPBL and MLB, now opens each role on one stat table, the line other stat sites print: G, PA, HR, AVG, OBP, SLG, OPS, wOBA, wRC+ and WAR for a hitter, and G, GS, IP, W-L, ERA, WHIP, SO, BB, FIP and WAR for a pitcher, with the league average underneath. All stats opens the full standard line and the advanced figures (OPS+, ISO, BABIP, K%, BB%, wins added, baserunning and more) as tables in the same style, and the page remembers whether you left it open. On a phone the table scrolls sideways with the season pinned. A two-way player's WAR is split by role. Spacing between sections is the same everywhere on the page.",
      },
    ],
  },
  {
    version: '1.169.0',
    date:    '2026-10-16',
    changes: [
      {
        short: 'WPBL player pages, reorganized',
        full:  "On a computer, a WPBL player page now opens on a summary: the season and its Regular / Playoffs / Both switch, then the four headline numbers for each role in their own card, side by side for a two-way player, with the player's clips right under them. Batting, Pitching and Fielding follow as titled sections holding the full line, the game log and the splits. A player filed as a pitcher who has mostly played the field, like Kelsie Whitmore, now leads with batting everywhere: the page, shared links, Home and the Discord card.",
      },
    ],
  },
  {
    version: '1.168.0',
    date:    '2026-10-16',
    changes: [
      {
        short: 'Calmer WPBL player pages',
        full:  "A player page no longer prints the same figures twice: the four big numbers at the top are left out of the stat line under them, at every width. A league rank now shows only for a top-three place, written as \"2nd\" with the size of the field on hover, and the pitch profile shows each rate against the league without a rank. Blue means a league rank and nothing else; a player's own best game in the log is bold with a dot under it. The header says the facts in words (\"Center field / Pitcher · Bats R, throws R · Age 28\") with the hometown and draft slot labeled, and the strip of the last five games, which repeated the top of the game log, is gone. Fielding is a small table, wins added and baserunning are named in words, and the spray chart drops the list that repeated its percentages.",
      },
    ],
  },
  {
    version: '1.167.3',
    date:    '2026-10-15',
    changes: [
      {
        short: 'Steadier text sizes across WPBL',
        full:  "The season recap, team pages, Scores, Standings, Game Center's play by play and pitch data, Reading, Run value, the pitch boards, Scorigami, the players list and the API docs now use the site's one set of text sizes. A season series' score is drawn the same size on WPBL's series page and MLB's series sheet.",
      },
    ],
  },
  {
    version: '1.167.2',
    date:    '2026-10-15',
    changes: [
      {
        short: 'Steadier text sizes in menus and dialogs',
        full:  "The account menu, search box, sign-in and settings dialogs, notifications, What's new, the Privacy and Terms pages and the not-found page now use the site's one set of text sizes. Privacy and Terms take the same page title as the site's other standalone pages, and their links are underlined so they read as links in dark mode.",
      },
    ],
  },
  {
    version: '1.167.1',
    date:    '2026-10-15',
    changes: [
      {
        short: 'Full names in the MLB Stats table on a phone',
        full:  "The MLB Players, Teams and Fielding tables now show a player's full name whenever it fits, and shorten to an initial only when it does not. A name ending in Jr. or II keeps its surname (\"V. Guerrero Jr.\"), and a name a hair too wide now shortens instead of being cut off, in both leagues.",
      },
      {
        short: 'Steadier text sizes across the site',
        full:  "The toolbar, footer, sign-in dialogs and about thirty smaller WPBL pieces (photos, the line score, head-to-head, lineups, pitching usage, Watch, Reading and Sources) now use the site's one set of text sizes.",
      },
    ],
  },
  {
    version: '1.167.0',
    date:    '2026-10-15',
    changes: [
      {
        short: 'MLB game preview, in the WPBL style',
        full:  "An upcoming MLB game's preview now looks like WPBL's: the two club logos in the matchup line and in the season comparison's key, and a tap on either opens the club. Its type now follows the site's sizes, with the probable starters, venue and weather where they were.",
      },
    ],
  },
  {
    version: '1.166.2',
    date:    '2026-10-15',
    changes: [
      {
        short: 'One set of text sizes in shared parts',
        full:  "The parts both leagues draw (player cards, Compare, box scores, play by play, tabs, filter chips and page headers) now use the site's one set of text sizes. Box score numbers and play text are a touch smaller and match the Stats tables, and the icons in a page's header bar match each other.",
      },
    ],
  },
  {
    version: '1.166.1',
    date:    '2026-10-15',
    changes: [
      {
        short: 'Steadier text sizes on MLB',
        full:  "MLB's Stats tab, search, Teams, Compare, rosters and box scores now use the same set of text sizes as the rest of the site, so labels and numbers no longer differ by a hair from page to page. The sorted column in both Stats tables keeps its width when you change the sort.",
      },
    ],
  },
  {
    version: '1.166.0',
    date:    '2026-10-15',
    changes: [
      {
        short: 'Ties read as ties',
        full:  "The 2026 season page now shows a shared place as \"T-1\" and lists everyone tied for the last spot: the home run title was a tie at 11, and wins a five-way tie at 3. The Run value, Pitch by pitch, Tracking and series boards mark ties the same way.",
      },
      {
        short: 'Run value: clearer names',
        full:  "Run value's first board is now \"Best run value\", and its note says how it differs from Bat and Pit on the Stats tab. A two-way player's card labels wins added \"Bat WPA\" and \"Pit WPA\", since the Stats table's WPA adds both sides.",
      },
    ],
  },
  {
    version: '1.165.0',
    date:    '2026-10-15',
    changes: [
      {
        short: 'Wins added and baserunning on players and Compare',
        full:  "A WPBL player's card now shows their wins added (WPA) under the season line, and a hitter's runs on the bases (BsR), each with its place in the league: the same numbers and order as the Run value board. Compare has both as rows too.",
      },
      {
        short: 'One baserunning number',
        full:  "Run value's \"Best on the bases\" now ranks BsR, the same number as the Stats tab's BsR column and the baserunning part of WAR: steals measured against the league's average runner for every time a player reached first, extra bases, and double plays hit into. The steal card's list of who runs most is gone.",
      },
    ],
  },
  {
    version: '1.164.0',
    date:    '2026-10-15',
    changes: [
      {
        short: 'Home: the champion card, filled in',
        full:  'The 2026 Season card on Home now shows the champion with its 3–2 series win, its standing and semifinal, each game of the final as a small box score, and a Star of the final with a link to their player page.',
      },
    ],
  },
  {
    version: '1.163.0',
    date:    '2026-10-14',
    changes: [
      {
        short: 'Find: fielding',
        full:  "WPBL's Find board now has a Fielding side: putouts, assists, errors, double plays, a catcher's passed balls and stolen bases allowed, one game at a time or over a season with fielding percentage. Ask it in words too: \"2 errors\", \"10 putouts 0 errors vs SF\".",
      },
    ],
  },
  {
    version: '1.162.1',
    date:    '2026-10-14',
    changes: [
      {
        short: 'Find: a tidier question',
        full:  "On the Find board each condition now sits on one line with its stat, a comparison symbol and a number, joined by \"and\". The stat list is grouped, adding a condition picks a stat you have not used yet, and the example questions show as links under an empty form.",
      },
    ],
  },
  {
    version: '1.162.0',
    date:    '2026-10-14',
    changes: [
      {
        short: 'Search: on every page',
        full:  "The search box and Ctrl+K now work on every page, including About the league, a season series, Batter vs pitcher, Compare and the glossaries.",
      },
      {
        short: 'Search: what it can do',
        full:  "Open the search with nothing typed, or type \"?\", to see one example of everything it understands. Tab fills in the highlighted name so you can keep typing.",
      },
      {
        short: 'Search: more questions',
        full:  "Try \"SF team ERA\", \"most hr in a game\", \"best catcher\", \"top relievers\", \"300 hitters\" or \"era between 2 and 3\". A club playing right now shows its live game first, and an MLB name on WPBL (or the reverse) offers a link across.",
      },
      {
        short: 'Stats: filter by position',
        full:  "The Players tables in both sections can be narrowed to one position, or to starters or relievers, from the search. A chip above the table shows the filter and removes it.",
      },
    ],
  },
  {
    version: '1.161.0',
    date:    '2026-10-14',
    changes: [
      {
        short: 'WPBL Stats: faster boards',
        full:  "The WPBL Stats tab's leaders, player tables and WAR, and the search box's WPBL answers, now come from season totals worked out once on the server, so they open without downloading every box score and play. The numbers are the same.",
      },
    ],
  },
  {
    version: '1.160.0',
    date:    '2026-10-14',
    changes: [
      {
        short: 'Search: the answer in the row',
        full:  "Type a name and a stat, like \"Whitmore avg\" or \"Ohtani hr 2024\", and the player's row shows the number before you click.",
      },
      {
        short: 'Search: who leads',
        full:  "A ranking like \"most home runs\" or \"lowest ERA\" now says who leads it and with what, the same player the stats table puts first.",
      },
      {
        short: 'Search: advanced stats',
        full:  "Rankings and player answers now take OPS+, wRC+, wOBA, ISO, BABIP, K%, BB%, ERA+, FIP and K/BB in both sections, and WAR and WPA on WPBL: try \"highest wRC+\" or \"Whitmore WAR\".",
      },
    ],
  },
  {
    version: '1.159.0',
    date:    '2026-10-14',
    changes: [
      {
        short: 'Search: career and all time',
        full:  "Ask for \"most home runs all time\" or \"career ERA leaders\" to open MLB's all-time board, and type \"Ohtani career\" to open a player on their whole career.",
      },
      {
        short: 'Search: what a stat means',
        full:  "Type \"what is OPS+\", \"wRC+ meaning\" or just \"FIP\" to open the rules & glossary page at that stat.",
      },
      {
        short: 'Search: straight to part of a player page',
        full:  "\"Ohtani splits\", \"Whitmore game log\" or \"Skenes pitch mix\" opens the player already scrolled to that part of the page.",
      },
      {
        short: 'Search: your questions come back',
        full:  "Rankings, stat questions and glossary lookups you run now show up under Recent beside the players and clubs, so you can ask them again in one tap.",
      },
    ],
  },
  {
    version: '1.158.0',
    date:    '2026-10-14',
    changes: [
      {
        short: 'Search: ask for the leaders',
        full:  "Type a ranking, like \"most home runs\", \"ERA leaders\" or \"fewest walks allowed 2025\", and search links straight to the stats table sorted on that stat, for that year if you give one.",
      },
      {
        short: 'Search: find a game',
        full:  "Type one or two clubs and a day, like \"SF vs NY sep 9\", \"Dodgers last night\" or \"Cubs next game\", to open that game. Two WPBL clubs on their own also link the page for their season series.",
      },
      {
        short: 'Search: compare two players, or jump to a club page',
        full:  "\"Whitmore vs Ibarra\" opens the two players side by side, and \"Ohtani 2023\" opens a player on that season. \"Dodgers roster\" or \"SF schedule\" opens the club's page at that part of it.",
      },
      {
        short: 'Search: forgives typos',
        full:  "A misspelled player, club or stat still finds what you meant (\"Whitmor\", \"Ohatni\", \"5 strikeuots\"), and MLB clubs answer to their nicknames, like Cards, Jays and Nats.",
      },
      {
        short: 'Search: fewer recents, more room',
        full:  "Before you type, search shows your three most recent picks and the example questions, without the long lists of players that pushed the examples out of view.",
      },
    ],
  },
  {
    version: '1.157.0',
    date:    '2026-10-11',
    changes: [
      {
        short: 'Dark mode: one calmer surface everywhere',
        full:  "In dark mode every card now sits flush on the page with an outline, on WPBL and MLB alike, instead of some pages using grey panels. The lighter grey is kept for things that float over the page: player and game sheets, menus and the bottom bar.",
      },
    ],
  },
  {
    version: '1.156.0',
    date:    '2026-10-11',
    changes: [
      {
        short: 'WPBL: a page for every season series',
        full:  "Each pair of WPBL clubs has its own page: the season series record, every game they played with a link to it, how the playoffs went if they met there, the best hitters and pitchers in those games, and the batters who had the better of a pitcher (or the other way round). Tap any record in the standings head-to-head grid, or on a team page, to open it.",
      },
    ],
  },
  {
    version: '1.155.0',
    date:    '2026-10-11',
    changes: [
      {
        short: 'WPBL: who added the most wins',
        full:  "Run value has a new board, Most wins added: how much each player's trips to the plate moved their team's chance of winning, added up over the season, for hitters and for pitchers. It counts the score as well as the situation, so a hit in a tie game is worth more than the same hit in a rout.",
      },
      {
        short: 'WPBL: the best baserunners',
        full:  "Run value also has Best on the bases: the runs each player gained or cost with steals, caught stealing and pickoffs, and by taking the extra base on a hit or tagging up on a fly ball, measured against the league's average runner in the same spot. Steals now count toward the runner in wins added too, where before they counted toward nobody.",
      },
      {
        short: 'WPBL: two new glossary terms',
        full:  'The glossary explains WPA (win probability added) and BsR (baserunning runs), in the same words the Run value board uses.',
      },
    ],
  },
  {
    version: '1.154.0',
    date:    '2026-10-10',
    changes: [
      {
        short: 'WPBL: the wildest games of 2026',
        full:  "The season recap has a new section: the six games whose win probability swung the most, each with its score, lead changes, ties and extra innings, and a link into Game Center.",
      },
      {
        short: 'WPBL: shared Compare links show the pair',
        full:  "A shared link to a WPBL comparison now previews as the two players, with each one's club and season line and a card in the two clubs' colors, instead of the site's general card.",
      },
      {
        short: 'MLB: the Hot Stove for the winter',
        full:  "From the end of the World Series to opening day, Roster Moves on MLB Home becomes the Hot Stove: it covers 30 days instead of 14, adds free-agent declarations and Rule 5 picks, and leaves out minor-league signings.",
      },
    ],
  },
  {
    version: '1.153.0',
    date:    '2026-10-10',
    changes: [
      {
        short: 'MLB: the whole bracket on a desktop',
        full:  'On a wide screen the MLB postseason bracket now shows every round at once, AL above NL, with lines joining each series to the next, so you can see who a winner plays next. Phones keep one round at a time.',
      },
      {
        short: 'MLB: Bests and Find back to 2000',
        full:  'The MLB Bests and Find boards now cover every season from 2000, not only this one.',
      },
    ],
  },
  {
    version: '1.152.0',
    date:    '2026-10-10',
    changes: [
      {
        short: 'MLB: Bests and Find',
        full:  "MLB Stats gets WPBL's Bests and Find boards: the season's best single-game lines, and a search across every box score by club, opponent and park, for the regular season, the playoffs or both.",
      },
    ],
  },
  {
    version: '1.150.0',
    date:    '2026-10-10',
    changes: [
      {
        short: 'MLB: Teams and Fielding boards',
        full:  'MLB Stats has two new boards, Teams and Fielding, laid out like WPBL’s. A club page links to its own team batting, team pitching and fielders, and each position on a player page links to that position’s board.',
      },
    ],
  },
  ...v1_100,
]
