// Single source of truth for the site version + changelog. The version badge in
// the toolbar reads APP_VERSION; clicking it opens a dialog that renders CHANGELOG.
//
// When shipping a notable change, bump APP_VERSION and add a new entry at the TOP
// of CHANGELOG (newest first). Each change has a `short` one-line summary (only
// the first 4 per version show in the main dialog) and a `full` sentence (shown
// for every change when the reader clicks "View all changes"). Write plainly,
// no em dashes and no marketing voice, just say what changed.

export const APP_VERSION = '1.28.0'

export interface ChangelogChange {
  short: string
  full:  string
}

export interface ChangelogEntry {
  version: string
  date:    string        // ISO date (YYYY-MM-DD)
  title?:  string
  changes: ChangelogChange[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.28.0',
    date:    '2026-08-05',
    title:   'WPBL search and updated player photos',
    changes: [
      {
        short: 'Search WPBL players and teams',
        full:  'You can now search the Women\'s Pro Baseball League from the toolbar search box, just like the MLB side. Type a player or team name while in the WPBL section and pick a result to jump straight to their page.',
      },
      {
        short: 'Updated WPBL player photos',
        full:  'WPBL player headshots have been refreshed with the league\'s latest photos, many now in team uniforms, and the crop sits tighter on each player\'s face.',
      },
      {
        short: 'Hall of Firsts name fixes',
        full:  'The WPBL Hall of Firsts now links players to their profiles even when the play by play feed spells a name differently than the roster does, so the right player is always credited.',
      },
    ],
  },
  {
    version: '1.27.0',
    date:    '2026-08-04',
    title:   'WPBL Hall of Firsts and live updates',
    changes: [
      {
        short: 'WPBL Hall of Firsts',
        full:  'The Women\'s Pro Baseball League home page now has a Hall of Firsts showcasing the players behind each league milestone, like the first home run, first win, first strikeout, and first stolen base, with a View all list of every first.',
      },
      {
        short: 'WPBL scores update live',
        full:  'The WPBL schedule, scoreboard, standings, and leaders now refresh on their own as games are played, updating faster while a game is in progress and whenever you return to the tab, so you no longer need to reload the page.',
      },
    ],
  },
  {
    version: '1.26.0',
    date:    '2026-08-04',
    title:   'A full WPBL stats section',
    changes: [
      {
        short: 'New WPBL Stats tab',
        full:  'The Women\'s Pro Baseball League section has a new Stats tab with a complete, sortable table of every hitting and pitching stat. Filter by team, tap any column to sort, and toggle a qualified-players filter.',
      },
      {
        short: 'Cleaner WPBL player pages',
        full:  'A WPBL player\'s page now groups batting, pitching, and fielding into separate cards with the key rate stats up top and a tidy stat line below, and splits the game log by type. Hover or tap any stat to see what it stands for.',
      },
      {
        short: 'Home leaders show teams and link to the full table',
        full:  'The batting and pitching leaders on the WPBL home page now show each player\'s team, and a View all link opens the full stats table. Batting average was replaced with OPS and pitching wins were dropped from the cards.',
      },
      {
        short: 'Next game card with a countdown',
        full:  'The WPBL home page now has a Next game card that counts down to first pitch of the upcoming game.',
      },
      {
        short: 'Smarter stat qualifiers',
        full:  'Rate-stat leaders (like batting average and ERA) only require a minimum of at-bats or innings once every team has played at least two games, so the boards are not empty in the opening days. Ties break toward the player with more innings or at-bats.',
      },
    ],
  },
  {
    version: '1.25.0',
    date:    '2026-08-03',
    title:   'A clearer WPBL game window',
    changes: [
      {
        short: 'Box score shows one team at a time',
        full:  'A WPBL game now shows the box score for one team at a time with a team toggle, and only hitting and pitching (the fielding table is gone). The stat columns line up and fill the width so it is easier to read.',
      },
      {
        short: 'Game window keeps a steady height',
        full:  'Switching between Box Score, Play-by-Play, and Pitch Data no longer resizes the game window. The header stays put and only the section below it scrolls.',
      },
      {
        short: 'Collapse half-innings in the play log',
        full:  'Each half-inning in the play-by-play can be collapsed or expanded, and a scoring half-inning shows how many runs it produced.',
      },
      {
        short: 'Pitch data now names the pitcher',
        full:  'The pitch data tab lists each pitcher from the box score with their innings, pitch count, and TrackMan velocity and spin, instead of an unlabeled group.',
      },
      {
        short: 'Fixed a duplicate game on the schedule',
        full:  'When the league feed listed a game twice for the same day and matchup, the schedule and scoreboard were showing both. The already-played game now shows once.',
      },
    ],
  },
  {
    version: '1.24.1',
    date:    '2026-07-30',
    title:   'Cleaner scoreboard on the home page',
    changes: [
      {
        short: 'Scoreboard no longer sits in a box',
        full:  'The scores strip at the top of the home page no longer sits inside its own bordered box. The games now sit open on the page.',
      },
    ],
  },
  {
    version: '1.24.0',
    date:    '2026-07-30',
    title:   'A fuller home page for the WPBL',
    changes: [
      {
        short: 'WPBL home page redesign',
        full:  'The Women\'s Pro Baseball League home page now leads with a scoreboard of recent and upcoming games, then a standings card, the four teams, and batting and pitching league leaders, laid out like the MLB home page. The leaders fill in as games are entered.',
      },
    ],
  },
  {
    version: '1.23.0',
    date:    '2026-07-30',
    title:   'The Women\'s Pro Baseball League joins the site',
    changes: [
      {
        short: 'New Women\'s Pro Baseball League section',
        full:  'There is a new section for the Women\'s Pro Baseball League, reached from the MLB and WPBL switch in the top bar. It covers the league\'s first 2026 season with the schedule, scores, standings, teams, rosters, and player pages. The first games are August 1.',
      },
    ],
  },
  {
    version: '1.22.0',
    date:    '2026-07-28',
    title:   'Milestone Watch: reached list and smarter order',
    changes: [
      {
        short: 'See every milestone reached this season',
        full:  'Milestone Watch used to drop a reached milestone after about a week. Open View all and there is now a Reached tab with every milestone hit this season, newest first, next to the Chasing tab of players still closing in.',
      },
      {
        short: 'Players closest to a milestone rank at the top',
        full:  'The card now orders by how soon a milestone is likely to fall, not just how big it is. Someone one hit from 1,000 sits above a player still a dozen away from a bigger mark, and the bigger chase climbs back up as they get close.',
      },
      {
        short: 'Milestone Watch card redesign',
        full:  'The card leads with three larger rows instead of a long list of small ones, each with a bar showing how close the player is, and a live tag when their team is playing right now.',
      },
    ],
  },
  {
    version: '1.21.0',
    date:    '2026-07-27',
    title:   'A fresh coat of paint for dark mode',
    changes: [
      {
        short: 'Redesigned dark mode',
        full:  'Dark mode has a new color scheme. The background is a softer tinted charcoal instead of flat black, cards sit on a slightly lighter surface so they stand out more, and the top bar now blends into the page instead of being a separate gray strip.',
      },
    ],
  },
  {
    version: '1.20.0',
    date:    '2026-07-27',
    title:   'Weekly and monthly prediction boards',
    changes: [
      {
        short: 'Predictions leaderboard has weekly and monthly views',
        full:  'The predictions leaderboard now has All-time, 30 days, and 7 days views, so a hot week or month can put you near the top even if your all-time record is still catching up. The windowed boards are ranked the same way (accuracy adjusted for how many picks you have made) and refresh overnight.',
      },
    ],
  },
  {
    version: '1.19.0',
    date:    '2026-07-27',
    title:   'Prediction heaters and a smarter bot',
    changes: [
      {
        short: 'See who is on a hot pick streak',
        full:  'The predictions leaderboard now shows a fire badge next to anyone on a run of correct picks, and when you are on one yourself you get a heater banner on the predictions card and in My Stats. A streak is your correct picks in a row and resets the first time you miss.',
      },
      {
        short: 'A tougher new rival: the Sabermetric Bot',
        full:  'There is a new bot to beat. The Sabermetric Bot rates each team by its runs scored and allowed rather than its raw record, so it sees through lucky and unlucky win-loss records, then factors in home-field. It is meant to be the hardest of the bots to out-pick.',
      },
    ],
  },
  {
    version: '1.18.1',
    date:    '2026-07-27',
    title:   'Standouts have to actually stand out',
    changes: [
      {
        short: 'Single-Game Standout only shows a real standout',
        full:  'Early in the day, when only a game or two had finished, the Single-Game Standout card could feature a merely decent line just because it was the best of a tiny sample. It now requires a genuinely standout game (a multi-hit or multi-homer day, four-plus RBI, a dominant start, and the like), and falls back to the most recent day that had one when today does not yet.',
      },
    ],
  },
  {
    version: '1.18.0',
    date:    '2026-07-27',
    title:   'Milestones you just hit, team schedules, and mobile fixes',
    changes: [
      {
        short: 'Milestone Watch now shows milestones just reached',
        full:  'Milestone Watch used to only show players closing in on a milestone. Now it also leads with the ones just reached, marked with a green check, so you catch a 3,000th strikeout or a 40-homer season the morning after it happens. In View all you can filter the board by hitting or pitching on top of the existing career, season, and record groups.',
      },
      {
        short: 'Trades show both players involved',
        full:  'A trade on the Roster Moves card used to show only one of the players. It now shows both sides of a swap in a single trade block, with each player and the club that acquired them, and it handles bigger multi-player and multi-team deals too.',
      },
      {
        short: 'Team pages now show the schedule',
        full:  'Open a team and you now see its schedule right on the page, with today\'s game highlighted and a Full schedule button for the rest. It is the same live and upcoming game cards you get for your followed team on the home page.',
      },
      {
        short: 'Mobile fixes on predictions, report cards, and player pages',
        full:  'A few mobile annoyances are fixed: the Predictions card header no longer overlaps itself on narrow screens, the info buttons on report cards and charts now respond to a tap instead of needing a long press, and the player page reorders to card, then recent games, then the graph, then contract so the useful stuff comes first.',
      },
    ],
  },
  {
    version: '1.17.1',
    date:    '2026-07-26',
    title:   'Home page tidy-up',
    changes: [
      {
        short: 'Milestone Watch no longer shows an empty card',
        full:  'The Milestone Watch card on the home page could briefly show as an empty box before its data was ready, or when there was nothing to show. It now stays out of the feed until it has something to display.',
      },
    ],
  },
  {
    version: '1.17.0',
    date:    '2026-07-26',
    title:   'Milestone Watch',
    changes: [
      {
        short: 'New Milestone Watch card tracks players chasing history',
        full:  'The home page has a new Milestone Watch card under Around the League showing active players closing in on big milestones, closest first. It covers career round numbers like 500 home runs and 3,000 strikeouts, single-season marks like a 40-homer or 20-win season, and the occasional all-time record chase. Tap a player to open their card, or View all to see everyone grouped by career, season, and records.',
      },
      {
        short: 'A heads-up when a followed player nears a milestone',
        full:  'When one of your followed players is within a few of a milestone, the notification bell now gives you a heads-up so you know to tune in. It updates as they close in and clears itself once they pass it.',
      },
    ],
  },
  {
    version: '1.16.2',
    date:    '2026-07-26',
    title:   'Make tomorrow\'s picks once today is done',
    changes: [
      {
        short: 'Predict tomorrow once today\'s games are underway',
        full:  'Predictions and Streak Survivor now roll forward to tomorrow\'s games as soon as today\'s are all started or finished, so you can make tomorrow\'s picks the same night instead of waiting for the date to change. A Tomorrow tag shows when you are picking ahead.',
      },
    ],
  },
  {
    version: '1.16.1',
    date:    '2026-07-26',
    title:   'Streak Survivor gets bot opponents',
    changes: [
      {
        short: 'Bots now play Streak Survivor',
        full:  'Streak Survivor now has three bot players that make a pick every day, so there are opponents on the leaderboard from the start. One goes for the hitter on the longest hitting streak, one takes the best batting average, and one picks at random.',
      },
    ],
  },
  {
    version: '1.16.0',
    date:    '2026-07-26',
    title:   'Streak Survivor and playoff odds',
    changes: [
      {
        short: 'New Streak Survivor game: pick a hitter each day',
        full:  'There is a new daily game called Streak Survivor on the home page. Pick one hitter each day, and if they get a hit your streak grows by one. A hitless day resets your streak to zero, and a day your player does not bat is skipped so the streak carries on. There is a leaderboard for the longest streaks, and you need to sign in to play.',
      },
      {
        short: 'New Odds tab in the standings',
        full:  'The standings page has a new Odds tab showing each team\'s chance of reaching the playoffs and of winning their division. The numbers come from a simulation of every remaining game that runs fresh each night.',
      },
      {
        short: 'Your team\'s playoff odds on the home standings card',
        full:  'The standings card on the home page now shows your followed team\'s chance of making the playoffs, just above the standings rows.',
      },
    ],
  },
  {
    version: '1.15.0',
    date:    '2026-07-23',
    title:   'Iron man streaks, today\'s stats, and a shorter players list',
    changes: [
      {
        short: 'New Iron Men board for games-played streaks',
        full:  'The Report Card in Visualize has a new Iron Men board for the longest active games-played streaks, meaning players who have not sat a single game out. It counts across seasons, so a streak that runs from one year into the next keeps going, and a trade does not break it. A plus sign means the run started even earlier than the years we look back through.',
      },
      {
        short: 'New boards for who works the count and who does not',
        full:  'Two more Report Card boards: Grinders for the qualified hitters who see the most pitches per trip to the plate, and Free Swingers for those who see the fewest. These work for past seasons too, not just the current one.',
      },
      {
        short: 'Your players show today\'s numbers when they play',
        full:  'A followed player who is in a game today now shows that day\'s line, such as hits and at bats or a pitcher\'s innings and strikeouts, in place of their season totals. A small Today or Live tag marks it, and the line keeps updating while the game is going.',
      },
      {
        short: 'Your players list stays short with a View all button',
        full:  'The players list on the home page now shows the first few and hides the rest behind a View all button, so a long list does not take over the page. It shows 3 on a phone and 5 on a wider screen. You can follow up to 20 players.',
      },
      {
        short: 'Plainer wording across the site',
        full:  'Went through the tooltips, hints, and messages around the site and rewrote them to read more plainly.',
      },
    ],
  },
  {
    version: '1.14.0',
    date:    '2026-07-23',
    title:   'Contracts, doubleheaders, and better ordering',
    changes: [
      {
        short: 'See contract and team control on player pages',
        full:  'Player pages now have a Contract section with the deal, its average annual value, and a season by season timeline. The timeline runs past the guaranteed money, so even a player on the minimum salary shows their arbitration years and the season they can reach free agency.',
      },
      {
        short: 'Scores are back in time order',
        full:  'The scoreboard used to sort by division and league, which scattered the day around. Games now run in start time order, with live games first, then finals, then upcoming, and your team always first.',
      },
      {
        short: 'Doubleheaders show both games',
        full:  'The team card only ever showed one game per day, so the second game of a doubleheader vanished. Both games now sit stacked under a single date with game numbers. A live second game also used to be hidden behind a finished first game, and that is fixed.',
      },
      {
        short: 'Predictions move up when you have picks left',
        full:  'The predictions card now sits right under your team card while you still have games to call, and drops to the bottom of the feed once every pick is made. It stays put for the rest of your visit so it never moves while you are using it.',
      },
      {
        short: 'Notifications take you where they mean',
        full:  'Clicking a notification used to leave you on the home page to find the thing yourself. A prediction reminder now opens the full predictions board, and a game start reminder opens that game.',
      },
      {
        short: 'All time stat sorting no longer returns nonsense',
        full:  'The all time table would let you sort by lowest home runs or lowest batting average, which returned meaningless results because only the career leaders are loaded. Rate stats like average and ERA can now be sorted both directions against qualified career players, showing a real worst list. Counting stats no longer offer a reverse order at all.',
      },
      {
        short: 'Career cards show the years played',
        full:  'A player card in career mode now shows the seasons they played beneath the Career heading, such as 1954 to 1976, or 2011 to present for an active player.',
      },
    ],
  },
  {
    version: '1.13.0',
    date:    '2026-07-22',
    title:   'Notifications bell and game start reminders',
    changes: [
      {
        short: 'A bell at the top collects your notifications',
        full:  'There is now a bell in the toolbar that gathers your reminders in one place. Unread ones show a count, and opening the bell marks them as read. Reminders that no longer apply, like picks you have since made, clear themselves.',
      },
      {
        short: 'Get a reminder before your team plays',
        full:  'You can turn on game start reminders in Settings to get a heads up before your followed team\'s next game. They arrive 5 minutes before first pitch by default, and you can change that to 10, 15, or 30 minutes.',
      },
      {
        short: 'Streak boards no longer miss players',
        full:  'The hitting, hitless, and scoreless streak boards only looked at the players with the most games and innings. That hid streaks from catchers, part time players, and anyone back from an injury, and left relief pitchers off the scoreless board entirely. Everyone with regular playing time is now included.',
      },
      {
        short: 'Streak boards keep up through the day',
        full:  'The streak boards refreshed once each morning, so a streak from the night before could take a day to show up. They now update again in the evening and overnight as games finish.',
      },
    ],
  },
  {
    version: '1.12.0',
    date:    '2026-07-18',
    title:   'Roster move badges on your players',
    changes: [
      {
        short: 'Your players get a badge when they move',
        full:  'When one of your followed players is traded, claimed, designated for assignment, signed, released, or suspended in the last two weeks, a small colored badge now appears next to their position in your players list. On desktop, hover the badge to read the full move.',
      },
    ],
  },
  {
    version: '1.11.1',
    date:    '2026-07-18',
    title:   'Faster streak report cards',
    changes: [
      {
        short: 'Streak boards load from a nightly snapshot',
        full:  'The player streak report cards in Visualize now load from a snapshot computed once a night instead of fetching a hundred game logs in your browser, so they open much faster. If the snapshot is missing or out of date, the boards still compute live like before.',
      },
    ],
  },
  {
    version: '1.11.0',
    date:    '2026-07-18',
    title:   'Roster moves and trade deadline countdown',
    changes: [
      {
        short: 'New roster moves card on the home page',
        full:  'The home page now has a Roster Moves card under Around the League showing the latest trades, DFAs, waiver claims, signings, and suspensions from the last two weeks. Tap a player to open their card, or a team logo to open that team.',
      },
      {
        short: 'Trade deadline countdown',
        full:  'Through July the Roster Moves card shows a countdown to the July 31 trade deadline, turning red in the final days.',
      },
      {
        short: 'View all moves grouped by day',
        full:  'View All on the Roster Moves card opens the full list grouped by day, with a short description of each move. The back button returns you to the open list after you visit a player or team from it.',
      },
      {
        short: 'Filter moves by team and collapse days',
        full:  'In the full roster moves list, tap a team logo at the top to see only that team\'s moves, and tap it again or tap All to clear. Each day header can be tapped to collapse or expand that day, and shows how many moves it holds.',
      },
    ],
  },
  {
    version: '1.10.0',
    date:    '2026-07-18',
    title:   'Player streak boards',
    changes: [
      {
        short: 'New report cards for player streaks',
        full:  'The report cards in Visualize now include three player boards: active hitting streaks, scoreless inning streaks for pitchers, and hitless slumps. Each row shows the player photo and team, and tapping a player opens their card.',
      },
      {
        short: 'Schedule game previews match the scoreboard',
        full:  'Opening an upcoming game from the team schedule now shows the same preview card you get from the scoreboard, with the probable starters for both sides.',
      },
      {
        short: 'Back button restores screens more exactly',
        full:  'Going back now returns you to the exact leaderboard or stats view you had, including the group and all time toggle, and to the same season or career view on a player page.',
      },
      {
        short: 'Recent searches only record real selections',
        full:  'Players and teams you reach with the back button or by browsing no longer get added to your recent searches. Only picks you make from the search bar are recorded.',
      },
      {
        short: 'Fixed misplaced season arrows on desktop',
        full:  'The previous and next season arrows beside the year on a player card no longer drift out of position on desktop.',
      },
    ],
  },
  {
    version: '1.9.0',
    date:    '2026-07-17',
    title:   'Predictions record, team card and card polish',
    changes: [
      {
        short: 'Your predictions show a running record',
        full:  'Once the games you predicted start finishing, the predictions card shows how many you got right so far and how many are still to go, instead of only after every game is final. You can still make or change picks.',
      },
      {
        short: 'Pitcher matchups sit beside the score on phones',
        full:  'On the team card on mobile, the starting pitchers for the recent and upcoming game now sit to the right of the score and time instead of below them, and the two matchups line up with each other.',
      },
      {
        short: 'Followed players card cleanups',
        full:  'On the followed players card you can hover or tap the small form graph to see what it shows, the stats line up on the right, a long name shortens to a first initial when space is tight, and the hover X is gone (you still remove players from Edit).',
      },
      {
        short: 'Full box score fits the window',
        full:  'Opening the full box score no longer widens the whole Game Center window. It shows one team at a time with a toggle, and pitchers no longer appear in the batting order.',
      },
      {
        short: 'Standouts show a single game, not a doubleheader total',
        full:  'Single game standouts no longer combine both games of a doubleheader into one line.',
      },
      {
        short: 'Report cards come first in Visualize',
        full:  'In the Visualize tab the report cards now come before the graphs, and opening one from the home page jumps to the top of that screen.',
      },
      {
        short: 'Past seasons no longer show current payrolls',
        full:  'The payroll report cards only show for the current season, since past seasons would otherwise show today\'s payroll numbers, which we don\'t have history for.',
      },
      {
        short: 'Standout and hot/cold cards use the real team logos',
        full:  'The team icons on the single game standout, On Fire, and Ice Cold cards now match the ones used on the scoreboard and team card, including the light and dark mode versions.',
      },
      {
        short: 'Cleaner section spacing on mobile home',
        full:  'Removed the divider line between the sections on the mobile home page.',
      },
    ],
  },
  {
    version: '1.8.0',
    date:    '2026-07-17',
    title:   'Game Center detail and home polish',
    changes: [
      {
        short: 'Hover the win probability graph to replay the game',
        full:  'You can now hover over the win probability graph in the Game Center to scrub through the game. A floating window shows the inning, the score at that moment, the pitcher, the hitter, and what happened on that play. The graph also spans a full nine innings and draws a projected line for the rest of a game still in progress.',
      },
      {
        short: 'Cleaner view between innings',
        full:  'Between innings, the live game on your team card and in the Game Center no longer show a stale count and empty bases. They now say which break it is, like End of the 4th, and show who is due up next with the right stats.',
      },
      {
        short: 'Live situation sits between the teams in Game Center',
        full:  'In the Game Center, the bases, the balls and strikes count, and the outs now sit between the two teams and their scores at the top of the card, with a larger bases diamond.',
      },
      {
        short: 'Box score always shows all nine innings',
        full:  'The line score now always shows a full nine innings, leaving later innings blank until the game reaches them, and the numbers are easier to read.',
      },
      {
        short: 'Player form now compares to the league',
        full:  'The recent form line on each followed player now compares against the league average instead of the player\'s own average, so you can see how they stack up against the rest of the league.',
      },
      {
        short: 'Due-up players show the most useful stats',
        full:  'When a batter or pitcher is shown as due up next inning, their season stats appear if they have not played yet, and their stats from the current game appear once they have.',
      },
      {
        short: 'Search tab opens with a prompt',
        full:  'Opening the Search tab no longer loads a random player. It now shows a prompt to search for a player or team.',
      },
      {
        short: 'Final label moved next to the score',
        full:  'On your team card, a finished game now shows the date first with the word Final next to the score, instead of above the date.',
      },
    ],
  },
  {
    version: '1.7.0',
    date:    '2026-07-17',
    title:   'Home dashboard additions and standout polish',
    changes: [
      {
        short: 'See if your players are heating up or cooling off',
        full:  'Each followed player now shows a small line of their recent form next to their stats, colored green when trending up and red when trending down, with a faint dashed line marking their season average so you can tell whether they are above or below their usual level.',
      },
      {
        short: 'Standings snapshot below the predictor',
        full:  'The home page now shows a small standings block below the game predictions. It shows your team\'s division race when they are in the hunt, or the wild card race with your team highlighted and the teams they are chasing when they are further back.',
      },
      {
        short: 'Two report cards on the home page, changing daily',
        full:  'The home page now shows two report cards instead of one, and the pair changes every day, so over time you see different ones like Top Frauds, Most Cursed, and the highest and lowest payroll boards.',
      },
      {
        short: 'Smoother single-game standout card',
        full:  'The single-game standout card now slides in both directions as you move between players, and its color fades gradually from one team to the next instead of snapping.',
      },
    ],
  },
  {
    version: '1.6.0',
    date:    '2026-07-15',
    title:   'Predictor vote bars and leaderboard ranking',
    changes: [
      {
        short: 'See the crowd\'s picks on the home predictor',
        full:  'The predict today\'s games card on the home page now shows each matchup with full team names and a color bar for how everyone has voted, with the percentage on each side. The side you pick fills in with its team color.',
      },
      {
        short: 'Predictions leaderboard rewards a proven record',
        full:  'The predictions leaderboard now ranks by a confidence-adjusted accuracy, so a few lucky correct picks no longer jump ahead of someone with a long, strong record. Your accuracy percentage is unchanged, and you always see your own row with your true rank even when you are outside the top 25.',
      },
      {
        short: 'On Fire card stands out in dark mode',
        full:  'The On Fire player card now has an orange outline in dark mode to match its label, so it stands apart from the other cards.',
      },
    ],
  },
  {
    version: '1.5.0',
    date:    '2026-07-15',
    title:   'Notifications and installable app',
    changes: [
      {
        short: 'Get a daily reminder to make your picks',
        full:  'You can now turn on notifications from Settings. Once a day, before games lock, you get a reminder if you still have picks to make. Turn it off any time from the same place.',
      },
      {
        short: 'Install the app to your home screen',
        full:  'The site is now an installable app. On your phone or computer you can add it to your home screen and open it like any other app, with its own icon. On iPhone, add it to your home screen to receive notifications.',
      },
    ],
  },
  {
    version: '1.4.1',
    date:    '2026-07-14',
    title:   'Back button returns you to the exact spot',
    changes: [
      {
        short: 'Back button reopens the window you came from',
        full:  'When you tap a player or team from inside a window on the home page, like a game recap, box score, the report card, or the full schedule, the browser back button now returns you to the home page with that same window reopened, instead of just the bare home page.',
      },
    ],
  },
  {
    version: '1.4.0',
    date:    '2026-07-14',
    title:   'Home feed redesign & scoreboard navigation',
    changes: [
      {
        short: 'Home is now a single scrolling feed',
        full:  'The home page combines your team and around-the-league content into one page instead of two tabs. Your team, players, and predictor sit up top, with standout performances and league features below.',
      },
      {
        short: 'Standout performances redesigned',
        full:  'Standout performances now match the look of the On Fire and Ice Cold cards, slide side to side as you move between players, and have a Box Score button that opens the recap from that game.',
      },
      {
        short: 'Scoreboard skips days with no games',
        full:  'The scoreboard date arrows jump straight to the next or previous day that actually has games and stay within the season. There is a Today button to jump back, and if today has no games it shows the next day that does.',
      },
      {
        short: 'Clearer game dates on your team card',
        full:  'The last game and next game on your team card now show larger, clearer dates, saying Yesterday or Tomorrow when close by and the date otherwise.',
      },
      {
        short: 'Shorter site header',
        full:  'The bar at the top of the site with the site name and search is now shorter, leaving more room for content.',
      },
    ],
  },
  {
    version: '1.3.0',
    date:    '2026-07-13',
    title:   'Team icon colors & fewer standout performances',
    changes: [
      {
        short: 'Team icons redesigned for light and dark mode',
        full:  'Every team logo across the scores, standings, schedule, and visualize now uses colors and logo art tuned for light and dark mode, so low-contrast teams like the Tigers, White Sox, and Giants are easy to spot against the background.',
      },
      {
        short: 'Fixed off-center team logos',
        full:  'Several team logos that sat off-center or too small inside their circle are now properly centered and sized.',
      },
      {
        short: 'Fewer, more recent standout performances',
        full:  'Around the League now shows up to 8 standout performances instead of 20, ordered from the most recent games to the oldest.',
      },
      {
        short: 'Standings show full team names',
        full:  'Standings list each team by name, like "Yankees", instead of the three-letter abbreviation.',
      },
    ],
  },
  {
    version: '1.2.0',
    date:    '2026-07-12',
    title:   'Team rosters, live card redesign & polish',
    changes: [
      {
        short: 'Team pages now show the full roster',
        full:  'Team pages have a new roster section listing every active player with their position, jersey number, and how they bat and throw. Tap any player to open their card.',
      },
      {
        short: 'Redesigned live games in your team card',
        full:  'The live game in your team card now shows a bigger bases diamond, the pitcher and batter with their live stat lines, and a larger score. The Game Center button doubles as the live indicator.',
      },
      {
        short: 'Scores strip scrolls with arrow buttons',
        full:  'The scores strip has arrow buttons on each side. On desktop, hover an arrow to glide through the games. On mobile, tap it to jump ahead a few games.',
      },
      {
        short: 'Standings logos redesigned for light and dark',
        full:  'Team logos in the standings now sit on a team-color ring that reads clearly in both light and dark mode, so every team is easy to pick out.',
      },
      {
        short: 'Cleaner recent searches',
        full:  'Recent searches now match the look of the rest of the search dropdown, show your five most recent, and never repeat a player already listed under Your Team or Trending.',
      },
      {
        short: 'Live scores refresh faster',
        full:  'The live game in your team card now refreshes every ten seconds so the score and situation stay current.',
      },
      {
        short: 'Tidier game info in the team card',
        full:  'The team card drops the repeated date and opponent line above the score, and shows Today, Yesterday, or the date instead.',
      },
      {
        short: 'Fixed a stray player loading on the home page',
        full:  'Fixed a bug where opening the home page could quietly load a random player in the background and add it to your recent searches.',
      },
    ],
  },
  {
    version: '1.1.0',
    date:    '2026-07-10',
    title:   'All-time leaders, standings & card polish',
    changes: [
      {
        short: 'New All-Time leaderboards for career stats',
        full:  'The Stats tab now has a career view showing true all-time leaders in every stat. Tap a stat on a player\'s Career card to jump straight to their all-time rank.',
      },
      {
        short: 'Standings highlight your followed team',
        full:  'Standings now highlight your followed team in both the division and wild card views.',
      },
      {
        short: 'Redesigned wild card race view',
        full:  'The wild card race got a redesign. A filled games-back column shows how far each team sits from the cutoff line, with a clearer divider marking the playoff line.',
      },
      {
        short: 'Pitch counts added to recent games',
        full:  'Pitchers\' recent games now show pitch counts, and the Recent Games table is easier to read.',
      },
      {
        short: 'Retired players show years played in search',
        full:  'Retired players now show the seasons they played (like 2001-2019) in search instead of just "Retired".',
      },
      {
        short: 'Player card season picker polish',
        full:  'The player card season picker got a cleanup: a dedicated Career toggle, prev/next arrows beside the year, a steadier portrait, and a centered name and team header.',
      },
      {
        short: 'Quicker recap/preview buttons on My Team schedule',
        full:  'My Team schedule now has quick Recap and Preview buttons plus a tidier scoreboard-style score row.',
      },
      {
        short: 'Improved trend chart tooltips',
        full:  'Trend chart tooltips now sit above the point with more touch-friendly spacing.',
      },
    ],
  },
  {
    version: '1.0.0',
    date:    '2026-07-09',
    title:   'Initial release',
    changes: [
      {
        short: 'Live scoreboard & Game Center',
        full:  'Live scoreboard with a Game Center for every game, including play-by-play, win probability, live situation, and full box scores.',
      },
      {
        short: 'Player pages with stat cards & trend charts',
        full:  'Player pages with season and career stat cards, trend charts, and league-average context.',
      },
      {
        short: 'Leaderboards, team rankings & standings',
        full:  'Leaderboards, team stat rankings, and standings with a wild card race view.',
      },
      {
        short: 'Follow teams/players & personalized home dashboard',
        full:  'Follow your team and players, get daily prediction bots, and see a personalized home dashboard.',
      },
    ],
  },
]
