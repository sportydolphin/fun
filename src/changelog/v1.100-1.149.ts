// Changelog entries 1.100.0 to 1.149.x, newest first. Archived out of ../changelog.ts so that adding
// an entry never means opening every release ever written. Frozen: new entries go at the top of
// CHANGELOG in ../changelog.ts, which appends these.
import type { ChangelogEntry } from '../version'

export const ENTRIES: ChangelogEntry[] = [
  {
    version: '1.149.0',
    date:    '2026-10-10',
    changes: [
      {
        short: 'Scores: dates you can find',
        full:  'On Scores the date is now the easiest thing to spot on each card. The winning, losing and saving pitchers always fit on one line: when the names are long, all three shorten to an initial and a surname together.',
      },
    ],
  },
  {
    version: '1.148.0',
    date:    '2026-10-10',
    changes: [
      {
        short: 'WPBL Scores, newest first',
        full:  'WPBL Scores lists game days only, newest first, so the offseason page opens on the final instead of a run of empty days. Every final names its star and its pitchers of record, and on a wider screen the games sit in a grid.',
      },
    ],
  },
  {
    version: '1.147.0',
    date:    '2026-10-10',
    changes: [
      {
        short: 'A lighter first load',
        full:  'The site downloads less before it can draw its first page, which is most noticeable on a phone on a slow connection.',
      },
    ],
  },
  {
    version: '1.146.0',
    date:    '2026-10-10',
    changes: [
      {
        short: 'One Game Center for both leagues',
        full:  "MLB's Game Center now draws its box score and play-by-play the way WPBL's does: centered columns, totals under the club's color, and each play ending in the bases and outs it left.",
      },
      {
        short: 'MLB: OPS+ and ERA+ adjust for the park',
        full:  "OPS+ and ERA+ on MLB's Players table now allow for the park a player calls home, from three seasons of home and road scoring, so a hitter at Coors Field and one in Seattle are measured on the same footing.",
      },
    ],
  },
  {
    version: '1.145.0',
    date:    '2026-10-10',
    changes: [
      {
        short: 'Faster pages',
        full:  'Most of the data behind the site now comes from a cache close to you, so pages fill in sooner, especially Stats.',
      },
    ],
  },
  {
    version: '1.144.0',
    date:    '2026-10-10',
    changes: [
      {
        short: 'One stats table for both leagues',
        full:  "MLB and WPBL Stats now share one table: the same columns in the same order, a league-average row under the headings, and an Advanced view on both. On a phone the table fits between the controls and the bottom bar and scrolls cleanly in either direction.",
      },
    ],
  },
  {
    version: '1.143.0',
    date:    '2026-10-09',
    changes: [
      {
        short: 'Both Stats tabs line up',
        full:  'The MLB and WPBL Stats tabs now share the same widths and spacing at every screen size, so switching leagues no longer moves the page.',
      },
    ],
  },
  {
    version: '1.142.0',
    date:    '2026-10-09',
    changes: [
      {
        short: 'One leader card for both leagues',
        full:  'Leaders cards look the same in MLB and WPBL: five names each, plain ranks with ties shown as "T-2", and the player you hover lit up on every card at once.',
      },
    ],
  },
  {
    version: '1.141.0',
    date:    '2026-10-09',
    changes: [
      {
        short: 'WPBL Stats opens on Leaders',
        full:  "WPBL Stats now opens on Leaders, the top five in each stat, with the full Players table beside it. MLB's Table is called Players to match.",
      },
    ],
  },
  {
    version: '1.140.0',
    date:    '2026-10-09',
    changes: [
      {
        short: 'The league switch keeps your page',
        full:  'Switching between MLB and WPBL from the toolbar now lands on the same page in the other league, Standings to Standings and Stats to Stats, instead of going back to Home.',
      },
    ],
  },
  {
    version: '1.139.0',
    date:    '2026-10-09',
    changes: [
      {
        short: 'MLB: tabs and filters like WPBL',
        full:  "MLB's Stats boards and Standings views now use WPBL's pattern: tabs along the top for pages, a switch for a choice on the page, and chips for filters.",
      },
    ],
  },
  {
    version: '1.138.0',
    date:    '2026-10-09',
    changes: [
      {
        short: 'MLB: a title on every tab',
        full:  'Every MLB tab now opens with its name, "MLB Standings", "MLB Scores" and so on, in the same style as WPBL.',
      },
    ],
  },
  {
    version: '1.137.0',
    date:    '2026-10-09',
    changes: [
      {
        short: 'Instant switching between MLB and WPBL',
        full:  "Once you have opened MLB or WPBL, it stays loaded while you are in the other one, so switching back with the toolbar shows its Home straight away instead of loading it again.",
      },
      {
        short: 'MLB: playoff series sit like the scores',
        full:  "On MLB Home, the playoff series now sit as close under their label as the scores do under theirs, at every screen size and text size.",
      },
    ],
  },
  {
    version: '1.136.0',
    date:    '2026-10-09',
    changes: [
      {
        short: 'MLB and WPBL Home, one width',
        full:  "MLB Home and WPBL Home are now the same width on every screen, so switching leagues from the toolbar no longer moves the cards. On a tablet, MLB's pages use the same column as WPBL's.",
      },
    ],
  },
  {
    version: '1.135.0',
    date:    '2026-10-09',
    changes: [
      {
        short: 'MLB: a tidier Home',
        full:  "Text on MLB Home now follows one set of sizes and weights, the same set WPBL uses: names, numbers, labels and dates look the same from card to card. Labels and dates that were greyed out like switched-off buttons are easier to read, a few colors that were hard to read in light mode are fixed, the scoreboard no longer wraps a game's time onto two lines at Large text, and the page opens with a \"Major League Baseball\" title the way WPBL's opens with its league's name.",
      },
    ],
  },
  {
    version: '1.134.0',
    date:    '2026-10-09',
    changes: [
      {
        short: 'MLB: Home cards in the WPBL style',
        full:  "MLB Home's cards now match WPBL's: Predictions, Streak Survivor, your players, the standings, Roster Moves, Milestone Watch and the daily report cards share one title style and outline, with a plain link in the corner (\"All boards\", \"All moves\") in place of the old buttons. The report cards and Roster Moves hold their shape while they load, so the page no longer jumps when the rows arrive.",
      },
    ],
  },
  {
    version: '1.133.0',
    date:    '2026-10-09',
    changes: [
      {
        short: 'MLB: compare any season',
        full:  "MLB's Compare is no longer this season only. Pick a year on a player page, tap Compare, and the comparison, the players on offer and the head-to-head are all from that season, with each player shown on the club they played for that year.",
      },
    ],
  },
  {
    version: '1.132.0',
    date:    '2026-10-09',
    changes: [
      {
        short: 'MLB: compare two players',
        full:  "Put any two MLB players side by side, the way WPBL's Compare works: playing time, the counting line, the rates, and WAR, wRC+ and FIP, with the leader of each row marked. When a hitter and a pitcher are compared, the page shows every time they have faced each other, this season, over their careers and in the postseason. Open it from Compare on any player page or from the More menu.",
      },
    ],
  },
  {
    version: '1.131.0',
    date:    '2026-10-09',
    changes: [
      {
        short: 'WPBL: recent searches follow you between devices',
        full:  'When you are signed in, the players and teams you open from the WPBL search now show up in the search box on your other devices too, the way MLB recents already did.',
      },
      {
        short: 'MLB: a rules & stats glossary',
        full:  "MLB has its own glossary page, like WPBL's: how a pitcher earns a win or a save, who qualifies for a batting title, extra innings, the postseason format, and what every stat means, from AVG to xwOBA. Find it under More, in the footer, or from any stat's tooltip on a player page.",
      },
    ],
  },
  {
    version: '1.130.0',
    date:    '2026-10-09',
    changes: [
      {
        short: 'WPBL: a Fielding board in Stats',
        full:  'Stats has a Fielding tab beside Players and Teams: fielding percentage, total chances, putouts, assists, errors, double plays, passed balls and stolen bases allowed for every player, sortable like the other boards. A fielder qualifies after playing two thirds of their club\'s games.',
      },
    ],
  },
  {
    version: '1.129.0',
    date:    '2026-10-07',
    changes: [
      {
        short: 'WPBL: "New" on stories and videos you have not seen',
        full:  'Reading and Watch now tag anything posted since your last visit as New, on the page and on the Home cards, and the Watch shelves show a dot when something new is behind them. Opening a story or playing a video clears its tag.',
      },
    ],
  },
  {
    version: '1.128.0',
    date:    '2026-10-07',
    changes: [
      {
        short: 'MLB: players open beside the page on desktop',
        full:  'On a computer, a player clicked in a leaderboard, a roster or a box score opens in a panel beside the list instead of replacing it. Click another row to switch players, or Expand for the full page. A player picked from inside Game Center opens over the game with a way back to it.',
      },
      {
        short: 'MLB: a full-page Game Center on desktop',
        full:  'A shared game link, or Expand on the game panel, opens Game Center as a full page: the summary and every play on the left, both box scores on the right, and a bar that keeps the score in view. It shows its layout straight away and fills in as the game loads.',
      },
      {
        short: 'MLB: smaller fixes around games and players',
        full:  'Back from a stat ranking opened from a player panel returns to the panel, on the season it was showing. Game Center no longer jumps while it loads on a tablet, and a playoff game\'s series line no longer pushes the page down when it arrives.',
      },
    ],
  },
  {
    version: '1.127.0',
    date:    '2026-10-07',
    changes: [
      {
        short: 'WPBL: a rank on a player card opens the league table',
        full:  'Tap a rank on a WPBL player card, like 2nd in HR, and Stats opens sorted by that stat with the player\'s row picked out and scrolled into view. Back returns to the card.',
      },
      {
        short: 'MLB Home loads a little less',
        full:  'The game preview now loads when you open one rather than with every MLB page, and Home no longer downloads the Standings page to draw team logos.',
      },
    ],
  },
  {
    version: '1.126.0',
    date:    '2026-10-07',
    changes: [
      {
        short: 'Player pages scroll like the rest of the site',
        full:  'On a phone, a player page now scrolls under your finger with no lag, and a swipe starting on the player\'s name scrolls with momentum like any other. Swipe down from the top, or pull the bar at the very top, to close it; push back up mid-pull and the page scrolls instead.',
      },
      {
        short: 'Smoother opening',
        full:  'Player pages slide up without stutter: the background fades in smoothly, the stats are ready from the first frame when you open a player from a leaderboard or Home, and the photo loads once instead of twice.',
      },
      {
        short: 'More stats above the fold',
        full:  'On a phone, the season line under the four headline numbers no longer repeats them, and runs edge to edge like the game log: one row for most pitchers and two for hitters, where it used to take three or four.',
      },
      {
        short: 'Loading looks like the page',
        full:  'While a player\'s stats load, the page shows its finished layout with placeholders, so nothing jumps when the numbers arrive.',
      },
    ],
  },
  {
    version: '1.125.0',
    date:    '2026-10-07',
    changes: [
      {
        short: 'New MLB player pages',
        full:  'MLB player pages are rebuilt on the same card as WPBL players: the club header with awards, the full season line with league ranks, a game log you can open games from, advanced stats, splits, the pitch mix, a career table, the trend chart, fielding and the contract. Two-way players get a tab for each role on a phone.',
      },
      {
        short: 'Pick any season, or the whole career',
        full:  'The season name on a player page is now a menu: pick any year the player played, or Career for career totals and a year-by-year chart. Back takes you to the season you were looking at. WPBL player pages have the same menu, ready for when the league has a second season.',
      },
      {
        short: 'Stats in the order you know',
        full:  'Player pages now lead with the four numbers other stat sites lead with (AVG, HR, RBI and OPS for hitters; W-L or saves or holds, ERA, strikeouts and WHIP for pitchers), followed by the standard line in MLB.com order with the averages at the end. On a phone the line folds into neat rows instead of running off the screen.',
      },
      {
        short: 'Charts scroll with your thumb',
        full:  'On a phone, dragging up or down on a player trend chart now scrolls the page, and dragging sideways reads the chart, with no wait before the numbers show. Sliding along the career chart no longer jumps to a year when you let go; tap a year to open it. On a computer the chart is no longer drawn oversized.',
      },
      {
        short: 'Tidier player headers',
        full:  'Back, the team name, Follow, Compare and Copy link now share one style across player and game pages, awards sit on a single row with a +N for the rest, and several clubs use their right colors in the header, including the Dodgers in blue and white.',
      },
      {
        short: 'Players and games open beside the page',
        full:  'On a computer, a WPBL player or game and MLB Game Center now open in a panel beside the page instead of covering it, so you can click down a scoreboard or a leaderboard without closing anything. Expand turns the panel into a full page.',
      },
    ],
  },
  {
    version: '1.124.2',
    date:    '2026-10-06',
    changes: [
      {
        short: 'Fan awards results stay one link away',
        full:  'The WPBL fan awards link opens the results again now that the ballot card has left the home page, and the results sheet opens straight away, filling in as it loads instead of keeping you waiting on a blank page.',
      },
    ],
  },
  {
    version: '1.124.1',
    date:    '2026-10-06',
    changes: [
      {
        short: 'Tidier top bar',
        full:  'The top bar now has even spacing throughout: the MLB and WPBL switch has room from the site name, the tabs, search and icons sit evenly apart, both ends of the bar are the same distance from the edge, and the line under the current tab is exactly as wide as its name.',
      },
      {
        short: 'No more Back to WPBL button on desktop',
        full:  'Pages like Reading, Watch and the season recap no longer show a Back to WPBL button on a computer or tablet, since the WPBL tabs are right there in the top bar. Phones keep it.',
      },
    ],
  },
  {
    version: '1.124.0',
    date:    '2026-10-06',
    changes: [
      {
        short: 'Section tabs in the top bar on desktop',
        full:  'On a computer or tablet the section tabs now sit in the top bar beside the MLB and WPBL switch, instead of in a row of their own under it. They stay on screen as you scroll, and they are there on every WPBL page, Reading, Watch and Photos included. Search folds to an icon when the bar is narrow, and the / key opens it. Phones keep the bottom bar.',
      },
      {
        short: 'WPBL Schedule is now Scores',
        full:  'The WPBL tab that lists every game and its result is now called Scores, as it is on MLB, with the same scoreboard icon.',
      },
      {
        short: 'Switching tabs no longer reloads them',
        full:  'Going back to a WPBL tab you have already opened now shows it exactly as you left it instead of loading it again, and switching between MLB and WPBL reuses what was already loaded, refreshing only live scores.',
      },
      {
        short: 'Pages hold still while they load',
        full:  'Each WPBL tab now shows its own title and a placeholder the size of what is coming while it loads, and the top bar is drawn at its final size from the first moment, so nothing jumps when the content arrives. All five tab titles are now the same size.',
      },
      {
        short: 'Standings chart drawn at once',
        full:  'The Standings by date chart on WPBL Standings is now drawn in full as soon as the tab opens. It only animates when you press Play.',
      },
    ],
  },
  {
    version: '1.123.2',
    date:    '2026-10-06',
    changes: [
      {
        short: 'A steadier page while it loads',
        full:  'The top bar no longer changes size when a page first opens, the search button is there from the start instead of nudging the other icons aside, and the Reading and Watch cards on WPBL Home hold their place while they load so nothing jumps down the page.',
      },
    ],
  },
  {
    version: '1.123.1',
    date:    '2026-10-06',
    changes: [
      {
        short: 'Faster first load',
        full:  'WPBL and MLB pages download less when they open: the MLB section no longer loads the WPBL app alongside it, the full season of WPBL box scores waits until you search, and nothing is fetched ahead of time when your browser is set to save data.',
      },
    ],
  },
  {
    version: '1.123.0',
    date:    '2026-10-06',
    changes: [
      {
        short: 'Reading on WPBL Home',
        full:  'With the season over, WPBL Home shows the newest posts from mary mustard and D.A. Espinoza above the videos, with a link to every post.',
      },
    ],
  },
  {
    version: '1.122.0',
    date:    '2026-10-05',
    changes: [
      {
        short: 'A roomier MLB game page',
        full:  'MLB games open wider on a computer, with the line score as the header and three tabs: Summary, Box Score (both teams side by side) and Plays.',
      },
      {
        short: 'More on the game summary',
        full:  'The summary now shows where a playoff game sits in its series with a link to the series, the top performers, the biggest swings marked on the win probability chart, and the venue, attendance, weather and game length.',
      },
      {
        short: 'Win probability in team colors',
        full:  'The MLB win probability chart now matches the WPBL one: each team\'s share is shaded in its own color, and you can hover or hold the chart to read any play.',
      },
      {
        short: 'Fold plays by half-inning',
        full:  'On the Plays tab, All groups plays by half-inning with the runs and score for each, and Expand all or Collapse all opens or closes them at once.',
      },
    ],
  },
  {
    version: '1.121.0',
    date:    '2026-10-05',
    changes: [
      {
        short: 'Every MLB playoff series has its own page',
        full:  'Tap a series in the bracket for every game with its winning and losing pitchers, the next game\'s starters and TV, the series leaders, how the two clubs met over the summer, and who the winner plays next. Each series has a link of its own you can share.',
      },
      {
        short: 'Copy a short link to MLB games and players',
        full:  'MLB series, games (upcoming and finished) and player pages have a Copy link button, and the link it copies is short enough for a post.',
      },
    ],
  },
  {
    version: '1.120.1',
    date:    '2026-10-05',
    changes: [
      {
        short: 'Plainer wording on MLB',
        full:  'A few MLB labels and explanations were reworded to say what they mean more plainly, including the Milestone Watch subtitle and the notes on the pitches-per-plate-appearance boards.',
      },
    ],
  },
  {
    version: '1.120.0',
    date:    '2026-10-03',
    changes: [
      {
        short: 'Swipe between MLB tabs',
        full:  'On a phone, swipe left or right to move between the MLB tabs, the same as on WPBL. Each tab keeps your place when you come back to it.',
      },
      {
        short: 'MLB tabs open instantly',
        full:  'MLB tabs you have already visited no longer reload when you come back to them, and going Back from a player or team page returns to the page exactly as you left it.',
      },
    ],
  },
  {
    version: '1.119.2',
    date:    '2026-10-03',
    changes: [
      {
        short: 'Back keeps the MLB stats season',
        full:  'Going Back to an MLB stats board now shows the season it was on. Before, a board for an earlier season could come back showing this season and change its own address to match.',
      },
    ],
  },
  {
    version: '1.119.1',
    date:    '2026-10-03',
    changes: [
      {
        short: 'Playoff series in one row',
        full:  'On a computer, the MLB playoff series now sit side by side, four to a row, so the bracket on Home takes half the space it did and the rest of the page moves up.',
      },
    ],
  },
  {
    version: '1.119.0',
    date:    '2026-10-02',
    changes: [
      {
        short: 'MLB Home loads faster',
        full:  'The MLB home page now downloads about a tenth less before it appears. Game Center, the full predictions board and your prediction stats load when you open them instead of with the page, and are fetched in the background shortly after, so they still open straight away.',
      },
      {
        short: 'WPBL tab bar easier to read',
        full:  'On a phone in light mode, the selected tab in the WPBL bar at the bottom of the screen is now a darker blue that is easy to read.',
      },
    ],
  },
  {
    version: '1.118.0',
    date:    '2026-10-02',
    changes: [
      {
        short: 'MLB easier to read in light mode',
        full:  'Blue, green, red, orange and team-colored text across MLB was hard to read on a light background. Every label, number and badge now meets the standard contrast for readability in both light and dark mode, including the team-colored player and team cards.',
      },
      {
        short: 'From Leaders to the full ranking',
        full:  'Each card on MLB Leaders now ends in a link to the full ranking for that stat in the Table, with its own address you can share. On a phone, Leaders uses the same Stats and Filters controls as the Table, and players tied on a stat now share a place instead of getting different medals.',
      },
    ],
  },
  {
    version: '1.117.0',
    date:    '2026-10-02',
    changes: [
      {
        short: 'Open MLB players, teams and games in a new tab',
        full:  'Every MLB player, team and game you can tap is now a real link, on the leaderboards, the stats table, standings, the bracket, rosters, box scores and the scoreboard, so you can open one in a new tab or copy its address. It also lets search engines find every MLB page.',
      },
    ],
  },
  {
    version: '1.116.0',
    date:    '2026-10-02',
    changes: [
      {
        short: 'MLB stats as a ranked list on phones',
        full:  'On a phone, the MLB stats table is now a ranked list showing the stat it is sorted by, with three supporting numbers on each row. Sort picks the stat and whether the best or worst come first; Filters holds the season, regular season or playoffs, and qualified players. Full table brings the spreadsheet back, and remembers that you prefer it.',
      },
    ],
  },
  {
    version: '1.115.1',
    date:    '2026-10-02',
    changes: [
      {
        short: 'MLB pages load faster',
        full:  'Each MLB page now downloads only what it needs to show, instead of the whole MLB section at once, so Scores, Standings, Stats and the team and player pages open noticeably sooner.',
      },
    ],
  },
  {
    version: '1.115.0',
    date:    '2026-10-02',
    changes: [
      {
        short: 'MLB sized like WPBL on desktop',
        full:  'On a computer, MLB pages now use the same text size and spacing as WPBL, so more of each page fits on screen and switching between the two leagues no longer changes the size of the bar at the top. Game Center and the other pop-up panels are larger and easier to read, and the Large text setting works properly on every MLB page.',
      },
      {
        short: 'MLB tabs match WPBL',
        full:  'The MLB tab bar and its More menu sit and look the same as WPBL\'s, the selected tab is easier to read, and switches like Hitting and Pitching now look different from the tabs that take you to another page. Every tab and switch can be reached with the keyboard.',
      },
    ],
  },
  {
    version: '1.114.0',
    date:    '2026-10-02',
    changes: [
      {
        short: 'A link for every MLB game',
        full:  'Every MLB game now has an address of its own, like /mlb/games/849844, so you can share a box score or a preview and it opens that game. The game-start alert opens it the same way, for any game rather than only your team\'s.',
      },
    ],
  },
  {
    version: '1.113.0',
    date:    '2026-10-02',
    changes: [
      {
        short: 'Playoff stats on MLB',
        full:  'The MLB Leaders and Table boards switch between the regular season, the playoffs, or both together, for any season, and the all-time table has career playoff leaders too.',
      },
    ],
  },
  {
    version: '1.112.0',
    date:    '2026-10-02',
    changes: [
      {
        short: 'Real links for every MLB page',
        full:  'Every MLB tab, club and player now has an address of its own, like /mlb/standings, /mlb/teams/cubs or a player\'s name, so a link you copy opens exactly that page and the tabs open in a new tab. Old links still work.',
      },
    ],
  },
  {
    version: '1.111.2',
    date:    '2026-10-02',
    changes: [
      {
        short: 'Faster taps on MLB',
        full:  'Opening a team or player from MLB Home, and typing in the search box while on it, respond several times faster on a phone. Home no longer redraws itself in full behind every tap and keystroke.',
      },
    ],
  },
  {
    version: '1.111.1',
    date:    '2026-10-01',
    changes: [
      {
        short: 'MLB pages stay put while they load',
        full:  'MLB Home, Standings and the stats boards no longer jump around as they finish loading. The playoff bracket appears straight away on a return visit, the scores, bracket and predictions hold their space while they load, and the standout card slides without moving the page.',
      },
    ],
  },
  {
    version: '1.111.0',
    date:    '2026-10-01',
    title:   'MLB is ready for the winter',
    changes: [
      {
        short: 'Predictions skip off days',
        full:  'On a day off between postseason games, MLB predictions open the next day with games instead of saying there are no upcoming games. When the next matchups are not set yet it says so, and once the season is over it says when Opening Day is.',
      },
      {
        short: 'The 2026 season stays up all winter',
        full:  'MLB stats, leaderboards and Home keep showing the 2026 season until the 2027 season opens, instead of switching to an empty season on January 1.',
      },
      {
        short: 'A winter MLB Home',
        full:  'Once the World Series is over, MLB Home drops the scoreboard, the bracket is titled with its season, and the Scores page opens on the last day with games.',
      },
    ],
  },
  {
    version: '1.110.0',
    date:    '2026-10-01',
    title:   'Postseason stakes on MLB Home',
    changes: [
      {
        short: 'Deciding games say so',
        full:  'A postseason game on the MLB scoreboard shows which series and game it is, and a game that will decide its series is marked Decider. The bracket card says the same thing, and on Home the series still being played come first.',
      },
      {
        short: 'Yesterday\'s finals on a quiet day',
        full:  'When today has only a game or two, the MLB scores strip on Home follows them with the previous day\'s results, labeled with their date.',
      },
      {
        short: 'Names fit on the leaderboard cards',
        full:  'On a phone, the streak and team boards on MLB Home give names the room they need, and teams show their nickname beside the logo.',
      },
      {
        short: 'The Athletics are ATH',
        full:  'The Athletics show as ATH everywhere on the MLB side, matching the league.',
      },
      {
        short: 'Clearer followed players',
        full:  'A followed player who has not played this season says so, instead of showing a row of dashes.',
      },
    ],
  },
  {
    version: '1.109.0',
    date:    '2026-10-01',
    title:   'MLB Home knows the regular season is over',
    changes: [
      {
        short: 'Predictions lead MLB Home in October',
        full:  'Once the regular season is over, a team that missed the postseason or has been knocked out shrinks to one line under the day\'s picks, saying how its season ended. A team still playing keeps its full card, with where it stands in its series.',
      },
      {
        short: 'Postseason standouts',
        full:  'The standout card now shows the best single-game performances of the postseason, each with the game it came from, instead of the last days of the regular season.',
      },
      {
        short: 'No more frozen regular-season cards',
        full:  'The wild card race, On Fire and Ice Cold, and the remaining-schedule boards step aside once the regular season ends. Streak boards say the streaks were still alive when the season ended, and Milestone Watch leads with what was reached this season.',
      },
      {
        short: 'Choosing a team takes one line',
        full:  'With no team followed, MLB Home shows a short invitation instead of all 30 logos. Choose a team opens a sheet grouped by division, with the clubs still in the postseason marked.',
      },
      {
        short: 'Milestones are dated the day they happened',
        full:  'Milestones reached from now on carry the date of the game, not the day after.',
      },
    ],
  },
  {
    version: '1.108.1',
    date:    '2026-10-01',
    changes: [
      {
        short: 'Videos right under the photos on WPBL Home',
        full:  'With the season over, the Watch card now sits directly below the gallery at the top of WPBL Home, instead of at the bottom of the page.',
      },
    ],
  },
  {
    version: '1.108.0',
    date:    '2026-09-30',
    title:   'Every MLB pop-up is a sheet, and Back closes it',
    changes: [
      {
        short: 'MLB pop-ups slide up from the bottom on a phone',
        full:  'All scores, the predictions board and its stats, Milestones, Roster moves, Survivor, a team\'s schedule and the full-size leaderboards now open as sheets that slide up from the bottom on a phone and can be dragged down to close, the way Game Center already did.',
      },
      {
        short: 'Back closes what is open',
        full:  'With any of them open, the Back button closes it instead of leaving the MLB section. The same goes for the full-screen trends chart and the full-screen player card.',
      },
      {
        short: 'Escape closes one thing at a time',
        full:  'With a game open on top of the scores, Escape closes the game and leaves the scores where they were.',
      },
    ],
  },
  {
    version: '1.107.0',
    date:    '2026-09-30',
    title:   'Scorigami: play the season, in club colors',
    changes: [
      {
        short: 'Watch the grid fill in',
        full:  'Press Play on the Scorigami page and the grid fills in one final at a time, in the order the games were played, with the date ticking along above it. Pause and Play pick up where you left off.',
      },
      {
        short: 'Club colors on every score',
        full:  'Each square is split between the two clubs in the first game that ended on that score, the winner lower left. A switch above the grid turns it back to the single-color version, and the page remembers which you chose.',
      },
      {
        short: 'A simpler Scorigami page',
        full:  'A shorter introduction, both controls together above the grid, and the key in a single line underneath.',
      },
      {
        short: 'Season replays resume cleanly',
        full:  'The batting leaders race and the season shape chart no longer jump back a step when you press Play after pausing.',
      },
    ],
  },
  {
    version: '1.106.0',
    date:    '2026-09-29',
    title:   'Clips on their games and players',
    changes: [
      {
        short: 'Clips in Game Center',
        full:  'The league\'s short clips now show up on the game they are from, in the order the plays happened, under "Clips from this game".',
      },
      {
        short: 'Watch a play from the play-by-play',
        full:  'Where the league posted a clip of a play, that play has a Clip button in the play-by-play that plays it right there.',
      },
      {
        short: 'Clips on player pages',
        full:  'A player\'s page shows the clips they are in, each labeled with the game and inning where we could tell.',
      },
      {
        short: 'Filter clips by club',
        full:  'The Clips shelf on Watch can be narrowed to one club, each clip carries its club\'s badge, and a clip from a game says which one, with a link to the box score.',
      },
      {
        short: 'Watch is quicker on a phone',
        full:  'On a phone, each game on Watch is a compact row that fits four to a screen, the Games, Clips and More buttons stay at the top as you scroll, and the pictures are sized for the screen, so a page of clips loads a fraction of what it did.',
      },
      {
        short: 'The podcast has its own shelf',
        full:  'The league\'s weekly podcast episodes are grouped as Podcast under More, instead of being mixed in with everything else.',
      },
    ],
  },
  {
    version: '1.105.1',
    date:    '2026-09-29',
    title:   'Only videos you can play',
    changes: [
      {
        short: 'Videos blocked in your country are hidden',
        full:  'Some league videos, including the full-game broadcasts, are blocked in certain countries. Watch and Game Center now leave out any video that would not play where you are, instead of showing a player that says it is unavailable.',
      },
    ],
  },
  {
    version: '1.105.0',
    date:    '2026-09-29',
    title:   'Watch: every WPBL video in one place',
    changes: [
      {
        short: 'A Watch page for WPBL video',
        full:  'A new page gathers every video of the league: each game with its highlights, condensed game and full broadcast, every clip the league has posted, and the features, press conferences and podcast. It is in the More menu.',
      },
      {
        short: 'Clips play vertically, one after another',
        full:  'The league\'s short clips play upright, the way they were filmed, and the arrows (or your arrow keys) step to the next one without closing the player.',
      },
      {
        short: 'Full broadcasts on each game',
        full:  'Where the league streamed a game, Game Center now has the full broadcast beside the highlights and the condensed game.',
      },
      {
        short: 'The newest clips on Home',
        full:  'Home and the season recap show the six newest clips, which play right there, with a link to everything else.',
      },
    ],
  },
  {
    version: '1.104.2',
    date:    '2026-09-29',
    title:   'Playoff series that read as series',
    changes: [
      {
        short: 'Series wins show as dots, not a score',
        full:  'The playoff cards on MLB Home showed each club\'s series wins as a number, laid out exactly like the scoreboard above them, so a series at 0-0 with game 1 on looked like a scoreless game. Wins are now dots, one per win the series needs, and every card says how many games it is.',
      },
      {
        short: 'A live playoff game shows its score and inning',
        full:  'While a series game is on, its card says the game, the score and the inning, the same as the scoreboard, instead of just "In Progress".',
      },
    ],
  },
  {
    version: '1.104.1',
    date:    '2026-09-28',
    title:   'A roomier matchups board on desktop',
    changes: [
      {
        short: 'Batter vs pitcher fits twice as many rows on desktop',
        full:  'On a wider screen each matchup is now one line, with the batter and the pitcher in columns of their own, a rank number, and the figures sitting right beside the names.',
      },
    ],
  },
  {
    version: '1.104.0',
    date:    '2026-09-28',
    title:   'Every WPBL batter vs pitcher matchup',
    changes: [
      {
        short: 'Batter vs pitcher, league-wide',
        full:  'A new page lists every WPBL batter\'s record against each pitcher faced at least three times, as three boards: batter edge, pitcher edge and most faced. Filter by club, or by regular season and playoffs, and tap any row for the full head-to-head. It is in the More menu.',
      },
      {
        short: 'The season recap shows its most lopsided matchups',
        full:  'The 2026 season page has a new section with the most lopsided matchup each way. Tap either one for the full head-to-head, or follow the link to the whole board.',
      },
      {
        short: 'Back returns you to the same board',
        full:  'The board, club and season you picked are kept in the address, so coming back from a matchup, or opening a shared link, lands on the same list at the same place.',
      },
      {
        short: 'Pages outside the tabs use the full width on phones',
        full:  'The season recap, scorigami, the league page, compare and the other standalone WPBL pages had a wider margin on phones than the tabs did. They now use the same width.',
      },
    ],
  },
  {
    version: '1.103.0',
    date:    '2026-09-28',
    title:   'Batter vs pitcher, and a calmer player page',
    changes: [
      {
        short: 'See who every WPBL player has faced',
        full:  'Player pages now list a batter\'s line against every pitcher faced, and a pitcher\'s against every batter, most-faced first. Tap a name for the full head-to-head. It follows the Regular, Playoffs and Both switch.',
      },
      {
        short: 'Comparisons lead with the head-to-head',
        full:  'When two players have faced each other, the comparison page now opens on that matchup, with the regular season and the playoffs as separate lines.',
      },
      {
        short: 'Player pages are easier to read',
        full:  'Good numbers are always blue, every rank says how many players it is out of, the game log comes right after the season line, and the pitch mix is one tap away instead of filling the screen. Fielding is one short line at the end.',
      },
      {
        short: 'Long tables fold back up, and use the full width on phones',
        full:  'The game log and the matchup tables can be collapsed again after you expand them, and on a phone the tables now run edge to edge.',
      },
      {
        short: 'Team records against each club no longer count playoff games',
        full:  'The head-to-head records on a WPBL team page were counting playoff games as regular season meetings. They now match the standings.',
      },
      {
        short: 'Player pages load much less data',
        full:  'A player page used to download the whole league\'s play log, about 280 KB, for one table. It now downloads that player\'s plays, about 15 KB.',
      },
    ],
  },
  {
    version: '1.102.0',
    date:    '2026-09-28',
    title:   'An MLB postseason bracket',
    changes: [
      {
        short: 'Follow the MLB postseason round by round',
        full:  'MLB Home and Standings now show the postseason bracket: every series with its seeds and wins, the next game and when it starts, live games as they happen, and a tap on any series to see it game by game. Clubs still to be decided show as the two that could get there, like HOU/CWS.',
      },
    ],
  },
  {
    version: '1.101.0',
    date:    '2026-09-28',
    title:   'MLB gets the WPBL layout on phones',
    changes: [
      {
        short: 'MLB has a bottom tab bar on phones',
        full:  'MLB now has the same floating tab bar as WPBL on a phone: Home, Scores, Standings, Stats and Teams, with Predictions, Streak Survivor, Milestone Watch, Roster moves, Playoff odds and the charts one tap away under More.',
      },
      {
        short: 'New Scores and Teams tabs for MLB',
        full:  'Scores shows every game on a date and keeps live scores updating while you watch. Teams lists all thirty clubs by division. Leaderboards, the stats table and the charts are now three views inside one Stats tab.',
      },
      {
        short: 'Back closes an MLB game instead of leaving the page',
        full:  'Game Center and game previews now open as a sheet you can drag down to close on a phone, and the Back button or gesture closes them rather than taking you out of MLB.',
      },
      {
        short: 'MLB team pages load faster',
        full:  'Opening a team used to make sixty separate requests for league-wide team stats. It now makes two.',
      },
    ],
  },
  {
    version: '1.100.0',
    date:    '2026-09-28',
    title:   'MLB is ready for the postseason',
    changes: [
      {
        short: 'MLB predictions, reminders and schedules cover the postseason',
        full:  'Predictions, game-start reminders, the daily pick reminder, your team\'s schedule and Streak Survivor only knew about regular-season games, so they would have gone quiet from the first Wild Card game on. They now follow every postseason round, and season stats still count the regular season only.',
      },
      {
        short: 'Postseason games the league has not settled yet say so',
        full:  'A game whose matchup is not decided yet shows both possible teams and cannot be picked until it is. A start time the league has not set shows as TBD instead of a made-up time, and a game the series may never reach is marked if necessary.',
      },
      {
        short: 'A canceled MLB game no longer shows as a 0-0 final',
        full:  'A game called off for good, like a rainout that is never made up, now reads Cancelled on the scoreboard and your team card instead of Final 0-0.',
      },
      {
        short: 'The predictions board shows the right date',
        full:  'Once the day\'s games have started the board moves on to tomorrow\'s, but its title kept naming today. It now names the day you are picking.',
      },
    ],
  },
]
