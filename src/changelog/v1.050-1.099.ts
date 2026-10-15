// Changelog entries 1.50.0 to 1.99.x, newest first. Archived out of ../changelog.ts so that adding
// an entry never means opening every release ever written. Frozen: new entries go at the top of
// CHANGELOG in ../changelog.ts, which appends these.
import type { ChangelogEntry } from '../version'

export const ENTRIES: ChangelogEntry[] = [
  {
    version: '1.99.6',
    date:    '2026-09-27',
    title:   'The site appears sooner',
    changes: [
      {
        short: 'The site appears sooner',
        full:  'The toolbar and name now show the moment the page arrives, before the rest has loaded, and the home page photo rail waits a few seconds before it starts drifting so it does not slow the first load on a phone.',
      },
    ],
  },
  {
    version: '1.99.5',
    date:    '2026-09-27',
    title:   'A faster first load on phones',
    changes: [
      {
        short: 'A faster first load on phones',
        full:  'On a phone the site now draws its toolbar the instant the page arrives, loads the photos you can see first, and waits until you start reading before preparing the other tabs and the fan-awards data. The first load moves about a third less data and does far less work before the page responds.',
      },
    ],
  },
  {
    version: '1.99.4',
    date:    '2026-09-27',
    title:   'A lighter first load',
    changes: [
      {
        short: 'A lighter first load',
        full:  'The sign-in forms now load the first time you open one rather than with every page, and a piece of the admin dashboard that was reaching every visitor no longer does. The first download is about a tenth smaller.',
      },
    ],
  },
  {
    version: '1.99.3',
    date:    '2026-09-26',
    title:   'Updates arrive on your next tap',
    changes: [
      {
        short: 'Updates arrive on your next tap',
        full:  'When the site has been updated since you opened it, it now notices when you come back to the tab and picks up the new version on your next tap, instead of waiting for something to go wrong first.',
      },
    ],
  },
  {
    version: '1.99.2',
    date:    '2026-09-26',
    title:   'Lighter on the battery, and one crash stays in its box',
    changes: [
      {
        short: 'MLB live scores stop refreshing in a hidden tab',
        full:  'Live scores, Game Center, followed players, the predictions slate and the notification bell used to keep refreshing while the tab was in the background or the phone was locked. They now pause until you come back, and refresh the moment you do.',
      },
      {
        short: 'A problem in one tab no longer blanks the whole site',
        full:  'If one board or page hits an error, the message now appears in that spot only. The toolbar, the navigation and every other tab keep working.',
      },
    ],
  },
  {
    version: '1.99.1',
    date:    '2026-09-26',
    title:   'No more blank screen after an update',
    changes: [
      {
        short: 'No more blank screen after an update',
        full:  'A page left open while the site updated could go blank on the next tap until it was reloaded by hand. It now reloads itself onto the new version, keeping your place, and if anything else goes wrong it says so and offers a Reload button instead of showing nothing.',
      },
      {
        short: 'Reduce motion stops the photo rail straight away',
        full:  'Turning on Reduce motion in Settings now stops the drifting photo rail on the home page immediately, rather than after the next reload. The team chart morph and the fan-award confetti follow the setting too, not only the device setting.',
      },
    ],
  },
  {
    version: '1.99.0',
    date:    '2026-09-26',
    title:   'A stats table that fits a phone',
    changes: [
      {
        short: 'Almost three times as many players on a phone',
        full:  'The full stats table on a phone shows about fourteen players at once instead of five. Rows are shorter, the league averages sit under each column heading, the player count moved into the first heading, and the site footer steps aside while the table is open. Scrolling the table now scrolls the page first, so its last rows no longer hide behind the navigation bar.',
      },
      {
        short: 'A league average line on every stats board',
        full:  'The hitting and pitching boards show the league average for every rate stat, so a .400 on-base percentage has something to be read against, and OPS+, wRC+ and ERA+ show what 100 means.',
      },
      {
        short: 'Ties are marked, and short samples are faded',
        full:  'Players who share a place are ranked T-3, T-3 instead of 3 and 4. With Everyone showing, players under the qualifying bar are faded, and the Filters menu says what the bar is.',
      },
      {
        short: 'The hitting board opens on OPS',
        full:  'The hitting board opened sorted by batting average but came back from the pitching side sorted by OPS. It now opens on OPS every time.',
      },
      {
        short: 'Sortable headings from the keyboard',
        full:  'Column headings can be reached with Tab and sorted with Enter or Space, announce their sort order to screen readers, and show what each abbreviation stands for on hover. wOBA and wRC+ keep their lowercase w.',
      },
    ],
  },
  {
    version: '1.98.0',
    date:    '2026-09-26',
    title:   'Standard and Advanced stat views',
    changes: [
      {
        short: 'ERA vs FIP on the season recap',
        full:  'The 2026 season page lists the qualified pitchers whose ERA sits furthest from their FIP, three on each side, with the box-score fact behind each gap: how many of the runs were unearned, how often balls in play fell for hits, or the strikeout and walk rates.',
      },
      {
        short: 'A shorter season recap on a phone',
        full:  'On a phone the season page shows one leaderboard at a time with a chip for each stat instead of stacking every board, lists three of the plays that turned a game with a button for the rest, and opens with links to jump to the bracket, standings, batting, pitching and plays. It is about a quarter shorter.',
      },
      {
        short: 'The stats board splits into Standard and Advanced',
        full:  'The hitting and pitching boards each have a Standard view, the box-score numbers, and an Advanced view with the rate stats, wOBA, wRC+ and FIP, so each fits on a desktop screen instead of scrolling sideways. Sorting by a stat from the Rank by menu or a shared link opens the view that has it.',
      },
      {
        short: 'Links to OPS+, wRC+ and FIP keep their sort',
        full:  'A link to the stats board sorted by OPS+, ERA+, the strikeout rate or any of the new advanced stats used to open sorted by batting average instead. It now opens on the stat it names.',
      },
      {
        short: 'Column headings stay put on a phone',
        full:  'On a phone, the full stats table was sized as if the bottom navigation bar were not there, so scrolling to the foot of the page carried the column headings up out of sight. The table now fits the screen, the headings stay visible with Large text too, and the Standard and Advanced switch sits above the navigation bar instead of behind it.',
      },
    ],
  },
  {
    version: '1.97.0',
    date:    '2026-09-26',
    title:   'Advanced stats on the leaderboards',
    changes: [
      {
        short: 'wOBA and wRC+ for hitters, weighted by this league',
        full:  'The hitting board now has wOBA and wRC+. Each way of reaching base is weighted by what it is worth in the WPBL, measured from the season’s own play-by-play rather than borrowed from the majors, where runs are scarcer. wOBA reads like on-base percentage; wRC+ puts 100 at league average.',
      },
      {
        short: 'FIP for pitchers, on the same league weights',
        full:  'The pitching board now has FIP, an ERA built from strikeouts, walks, hit batters and home runs, the outcomes no fielder touches. Its weights also come from this league: a strikeout is worth about twice as much here as in the majors, so FIP on the usual weights would have undersold the league’s strikeout pitchers.',
      },
      {
        short: 'Strikeout and walk rates, BABIP, ISO and more',
        full:  'Hitters gain ISO, BABIP, walk and strikeout rates, stolen base success rate, extra-base hits and intentional walks. Pitchers gain strikeout, walk and K-BB rates per batter faced, home runs per game and BABIP allowed. Every new stat is explained in the glossary and in the Rank by menu.',
      },
      {
        short: 'The Rank by menu fits on a phone',
        full:  'Long stat descriptions no longer push the Rank by menu wider than the screen; they wrap onto a second line instead.',
      },
    ],
  },
  {
    version: '1.96.0',
    date:    '2026-09-25',
    title:   'How every player pitched and hit, pitch by pitch',
    changes: [
      {
        short: 'Player pages show a pitch profile and plate discipline',
        full:  'Every pitcher now has a pitch profile and every hitter a plate discipline card, from every pitch of the season: strikeout and walk rates ranked against the league, first-pitch strikes and swinging strikes for pitchers, swing and contact rates for hitters, and each outcome (balls, called strikes, whiffs, fouls, balls in play) set against the league average, blue where it is better and amber where it is worse.',
      },
      {
        short: 'More room for the numbers on a phone',
        full:  'On a phone a player page now opens taller, and the header with the photo scrolls away with the stats instead of staying pinned, so there is about half again as much room to read. The player’s name moves into the top bar once the header is out of sight. Game Center opens taller too.',
      },
      {
        short: 'Fan award winners are marked on their pages',
        full:  'A player who won a fan award now carries it under their name, such as “Fan vote · Most Valuable Player”, linking to the full results.',
      },
      {
        short: 'A tidier player page',
        full:  'Articles about a player are now a short list rather than a grid of boxes, a pitcher’s fielding is a single line, the regular season and playoffs switch sits beside the season line on a desktop, the zone bars under a spray chart no longer repeat the chart on a phone, and the pitch location plot only appears when tracking covered most of that pitcher’s games.',
      },
      {
        short: 'Reading lays out for your screen',
        full:  'The Reading page now leads with the newest post drawn large, then groups the rest by month: a grid of cards on a desktop and compact rows on a phone. Picking a club no longer leaves an empty list when you switch writers.',
      },
      {
        short: 'The Home gallery lines up on a phone',
        full:  'Photos in the Home gallery no longer sit flush against the edge of the card on a phone, and the strip no longer jumps to a photo when you let go of it.',
      },
    ],
  },
  {
    version: '1.95.0',
    date:    '2026-09-25',
    title:   'A second writer on the league',
    changes: [
      {
        short: 'The Rising Fastball joins Reading',
        full:  'D.A. Espinoza’s The Rising Fastball now sits beside mary mustard’s towards a more perfect game on the Reading page, with the writer’s permission: game recaps, weekly check-ins, the playoff preview and the profiles of the league’s players. Filter by writer or by club, and every post opens on the writer’s own Substack.',
      },
      {
        short: 'Player pages lead with the profiles',
        full:  'A player’s “Written about” list now puts the posts about that player first, ahead of the round-ups that only mention them, so Rakyung Kim’s page opens on a three-part profile series rather than on league round-ups.',
      },
      {
        short: 'A game shows every story written about it',
        full:  'Opening day at New York was written up by both writers, and the game page now shows both, each with its byline.',
      },
      {
        short: 'Lighter thumbnails on Reading',
        full:  'Post covers load at the size they are drawn instead of full size, about a thirtieth of the download for each one.',
      },
    ],
  },
  {
    version: '1.94.0',
    date:    '2026-09-24',
    title:   'A faster Home',
    changes: [
      {
        short: 'Home downloads about a third less before it can draw',
        full:  'Every player’s thumbnail used to be packed into the site’s first download, so every visit paid for 118 faces whether or not any were on screen. Faces now load one at a time, only when shown, and are cached for good. The image-sharing code also waits until someone actually presses Share.',
      },
      {
        short: 'Home’s data arrives sooner',
        full:  'The gallery and the rest of Home now start loading at the same moment as the schedule instead of after it, the play-by-play log is fetched in one round rather than four in a row, and a couple of reads Home was making twice are made once.',
      },
      {
        short: 'The page no longer jumps while it loads',
        full:  'The loading placeholder now has the shape of the offseason page, the gallery holds its space until its photos arrive, and the footer no longer flashes halfway up the screen on the first frame.',
      },
    ],
  },
  {
    version: '1.93.0',
    date:    '2026-09-24',
    title:   'The offseason: a reading page, a clearer league page, and fan photos for everyone',
    changes: [
      {
        short: 'Fan photos are open to everyone',
        full:  'The gallery at /wpbl/photos is public now, along with the photos on Home and on player pages. It opens straight onto the photos, and on a phone the player-name filters are one row you swipe along instead of a wall of chips in front of the first picture.',
      },
      {
        short: 'Reading: every post from the writer the site links, on one page',
        full:  'The league coverage we link to has its own page at /wpbl/reading, with every post and a filter by club. It used to be one section of a card on the league page, with an archive that had no address of its own, so it could not be shared or found by search. Home carries just the latest headline and a link to the rest.',
      },
      {
        short: 'About the league: a shorter page that says what the WPBL is',
        full:  'The league page now answers one question, what is this league, for someone arriving cold: how it works, the four clubs, and where the players come from, picked one country at a time. The things it used to hold have moved to where they fit: the writing to Reading, the history photos into the gallery, highlights onto the season recap and each game, and the draft chart onto Stats.',
      },
      {
        short: 'Postseason games are easier to open from Home and the recap',
        full:  'With the scoreboard gone for the offseason, the series overview draws each game as a small scoreboard tile with a Box score link, and a game the series did not need says so. The season card’s games are links of their own.',
      },
      {
        short: 'Flatter cards in dark mode',
        full:  'Home, the season recap, the Teams tab and every team page draw their cards as outlines with no grey fill in dark mode, so a page reads as one document rather than a stack of panels. Light mode is unchanged.',
      },
      {
        short: 'The season recap tells the postseason',
        full:  'Under the champion: the final’s five games as cards, the bracket as it finished, and the best single playoff performances at the plate and on the mound. Each row opens that game’s box score on the player’s own club. Home drops the title odds and the series details that only mattered while there was still something to decide.',
      },
    ],
  },
  {
    version: '1.92.0',
    date:    '2026-09-22',
    title:   'Playoff numbers on every player page',
    changes: [
      {
        short: 'Regular season, playoffs or both on a player page',
        full:  'A player who reached the postseason gets a toggle on their page to show the regular season, the playoffs, or both together. Every total, the game log, fielding and the pitch plot follow it. Ranks and OPS+ only show for the regular season, where there is a league to rank against.',
      },
      {
        short: 'Player faces on the season recap leaders',
        full:  'The leaders on the season recap carry each player’s photo beside their name.',
      },
      {
        short: 'A trophy-gold banner for the champion',
        full:  'The champion banner is drawn in a gold that stays readable in both light and dark mode.',
      },
    ],
  },
  {
    version: '1.91.0',
    date:    '2026-09-21',
    title:   'Players open over the page you are on',
    changes: [
      {
        short: 'A player opens as a card over the page you are on',
        full:  'Opening a player from Compare, the players page, the league page or the season recap used to leave that page and drop you on Home behind the player card. Players now open as an overlay the way games already did, and Back walks you out one card at a time to where you started.',
      },
      {
        short: 'The season card crowns the champion',
        full:  'Once the final was decided, Home’s season card turned into a champion card: the winning club in gold, the runner-up, the series score, and the box scores under it.',
      },
      {
        short: 'The scoreboard row fills out when only a few games are left',
        full:  'With only one or two games ahead, the scoreboard at the top of Home spreads them across the row instead of leaving most of it empty.',
      },
      {
        short: 'A tidier footer',
        full:  'The WPBL page links in the footer fold behind a More pages line, so the footer opens with the things a reader actually came for.',
      },
    ],
  },
  {
    version: '1.90.0',
    date:    '2026-09-20',
    title:   'A players page worth browsing',
    changes: [
      {
        short: 'The players page shows faces, numbers and positions, with search and sort',
        full:  'Every player has a headshot, jersey number and position, with a search box that takes a name, a position or a number, and a sort by club, name or number. It lists the 69 players who got into a game, rather than the whole 118-name roster.',
      },
      {
        short: 'The More menu is grouped, and Compare has a place in it',
        full:  'The More menu is sorted into groups, and the Compare tool, which used to be reachable only from a player card or Home, is listed there.',
      },
      {
        short: 'The standalone pages share one look',
        full:  'The league page, the season recap, Scorigami, Data sources, Compare and the glossary use one header, one width and one Back button, where each had drifted its own way.',
      },
    ],
  },
  {
    version: '1.89.0',
    date:    '2026-09-19',
    title:   'The final standings, and how the race was run',
    changes: [
      {
        short: 'Final standings and the standings race on the season recap',
        full:  'The season recap has the final regular-season table, and a chart under it you can drag back to any date to see the table as it stood that day. A leaderboard race sits beside it, with one row of controls that works on a phone.',
      },
      {
        short: 'Game modals open over the season recap and Scorigami',
        full:  'A game opened from the season recap or Scorigami appears over that page instead of sending you back to Home.',
      },
      {
        short: 'The phone sheet backdrop fades in',
        full:  'On a phone the dark backdrop behind a sheet fades in with the slide rather than snapping on.',
      },
    ],
  },
  {
    version: '1.88.0',
    date:    '2026-09-17',
    title:   'Short links, and a cleaner Home',
    changes: [
      {
        short: 'Short share links for players and games',
        full:  'Copying a player or game link gives you a short /p/ or /g/ address that fits in a message or a post. Every post the site makes to Bluesky carries #wpbl.',
      },
      {
        short: 'One type system across Home',
        full:  'Home’s cards use one set of sizes, weights and one accent blue, where they had drifted into a dozen near-matches.',
      },
      {
        short: 'The Discord /player card shows postseason stats',
        full:  'The /player command in the fan Discord shows a player’s postseason numbers too, not only the regular season.',
      },
      {
        short: 'The live view names the pitcher when the feed forgets to',
        full:  'When the league feed drops the current pitcher from a live game, Game Center takes the name from the box score instead of showing a blank.',
      },
    ],
  },
  {
    version: '1.87.0',
    date:    '2026-09-16',
    title:   'Fan award winners',
    changes: [
      {
        short: 'Fan award results, with a card to share',
        full:  'When the ballot closed at the final’s first pitch it turned into a results view: each winner, the honest number of people who voted, and a card you can share. On a phone, Share goes straight to the phone’s own share sheet. The winners also show on Home.',
      },
      {
        short: 'Game previews: matchups, leaders and rosters',
        full:  'A game preview has a Matchup, Leaders and Rosters toggle. Leaders shows each club’s best hitters and pitchers with their photos, Rosters lists who is active, and every row opens that player. It is wider on a desktop.',
      },
      {
        short: 'Settings: pick light, dark or system theme, and your default section',
        full:  'The settings dialog has a Theme choice and a default section to open on, and lays out in two columns on a desktop instead of one long scroll.',
      },
      {
        short: 'Game Center keeps the live view up between plays',
        full:  'The live tab no longer blinks back to an empty state in the gap between one play and the next, and the recap and live tabs are tidier on a phone.',
      },
      {
        short: 'A Bluesky reminder before first pitch',
        full:  'The site’s Bluesky account posts a short reminder shortly before each game starts, alongside the recap it already posted after.',
      },
    ],
  },
  {
    version: '1.86.0',
    date:    '2026-09-14',
    title:   'When in a game the runs come',
    changes: [
      {
        short: 'Runs by inning: a heatmap of when each club scores, on the season page',
        full:  'One row for every club and one for the league, one column for every inning, and each square is the runs that club put up in that inning, per time it batted in it. Red squares are more runs than the league’s average inning, blue fewer and grey about average, and the number is printed in every square too. Flip it to Allowed to see when a club gives them up instead, and to Postseason to see the bracket on its own, kept apart from the regular season. A bottom of the 7th the home side never needed to bat is left out rather than counted as a scoreless inning, which is how the league’s own line score records it and would otherwise make every club look quiet late.',
      },
    ],
  },
  {
    version: '1.85.0',
    date:    '2026-09-14',
    title:   'Every score the league has produced, in one grid',
    changes: [
      {
        short: 'WPBL Scorigami: every final score the league has produced, as a grid',
        full:  'One square for every final: the winning runs read down the side, the losing runs across the top, so a square’s position is the score and the grid prints no number inside it. A lit square is a final that has happened, and it opens the first game that ended on it; a brighter square with a number is a score that has come up more than once. 28 different finals across the season’s 34 games so far. It counts the postseason too, because a score is a score wherever it happened. Linked from the players page and the footer, with its own address to share.',
      },
      {
        short: 'Collapse a club on the players page',
        full:  'The full-roster page runs long, so each club’s list now folds away: tap a club’s name to collapse it, tap again to open it. Every player is still a real link underneath, so nothing changes about finding anyone, there is just less to scroll past.',
      },
      {
        short: 'Flick the More menu down to close it on a phone',
        full:  'The More sheet at the foot of the screen can be swiped down to dismiss now, the way a sheet on a phone should, rather than only closing on a tap outside it.',
      },
    ],
  },
  {
    version: '1.84.0',
    date:    '2026-09-13',
    title:   'Two new ways into the stats',
    changes: [
      {
        short: 'Bests: the best single game anyone has had, by each measure',
        full:  'A record book of single games rather than whole seasons. The most total bases in a game, the most strikeouts thrown, the longest scoreless outing, and a handful more, each row a real night with a link straight into that box score. Tied numbers share a rank, because in a four-club league a single-game record is usually held jointly.',
      },
      {
        short: 'Find: search every box-score line for the games that match',
        full:  'Ask the questions no leaderboard was built for: how often has anyone struck out five in a game, who has gone four for four more than once, has a pitcher walked nobody through five. Stack up conditions, narrow by club, opponent and home or away, and get two answers at once, the games that match and who has done it most. The whole question lives in the address, so you can send somebody the search rather than describing it.',
      },
    ],
  },
  {
    version: '1.83.0',
    date:    '2026-09-12',
    title:   'Put any two players side by side',
    changes: [
      {
        short: 'Compare any two WPBL players on one page',
        full:  'Pick two players and see their seasons next to each other: batting, pitching, how much each of them has actually played, and whoever is ahead on each line. Every player’s card has a Compare button, and there is a list to pick from at the top of the players page. Each comparison has its own address, so you can send somebody the argument rather than describing it.',
      },
      {
        short: 'It says what happened the times the two of them faced each other',
        full:  'Four clubs means a hitter sees the same pitcher ten or fifteen times in a season, which is a real record rather than the four at-bats the same thing gives you in the majors. A hitter and a pitcher compared here get their own line: how many times the hitter has come up against that pitcher, and what happened. Kelsie Whitmore is 2-for-5 against Ayami Sato with two home runs.',
      },
      {
        short: 'A possible game 3 shows on the scoreboard',
        full:  'The strip at the top of the home page skipped any postseason game that might not be played, so on the day a semifinal was level it ran tonight’s game and then jumped a week to the championship, with the game that tonight would decide the existence of nowhere on the page. It is there now, with an asterisk, and it disappears the moment a series is won and it is not going to happen. The strip also opens on the next game properly now: on a phone it starts level with the left edge of the cards under it, instead of a little way in behind a soft fade. The fades at both ends are gone with it, so a game running off the edge is cut at the same line every card on the page ends at.',
      },
      {
        short: 'It will not tell you who won',
        full:  'There is no overall score and no verdict. Each line says who is ahead on that one number, how much each of them has played is the first thing on every card rather than buried under the rates, and where somebody has not played enough for a rate to mean much the page says so instead of quietly leaving that player out.',
      },
    ],
  },
  {
    version: '1.82.0',
    date:    '2026-09-12',
    title:   'Somebody else’s account of the same game',
    changes: [
      {
        short: 'A page saying where every part of this site came from',
        full:  'Almost nothing here is original reporting: the numbers are the league’s, and the writing about the games belongs to the people who wrote it. Until now the only place that said so in one go was the Terms page, which nobody reads and which framed it as a legal disclaimer rather than as thanks. There is a page for it now, linked from the footer: every source, what was used from it, where it shows up, and on what basis, including the three whose work is used by their permission alone. It is a credits page, not a directory: everything on it is something the site genuinely uses.',
      },
      {
        short: 'Every finished game links to This is Women’s Baseball’s recap of it',
        full:  'This is Women’s Baseball is an independently run site that writes one recap of every WPBL game, and they have given permission for us to link to them. A finished game now carries their headline, their own title picture and their name, going straight to their page in a new tab. It is a link and only a link: none of their writing is stored or shown here, and the picture is served from their site rather than copied to ours. All 33 games of the season so far have one.',
      },
    ],
  },
  {
    version: '1.81.0',
    date:    '2026-09-11',
    title:   'The situation after every play, and who was throwing',
    changes: [
      {
        short: 'A diamond and the outs down the play-by-play, showing what each play left behind',
        full:  'The league writes every runner’s movement out in full and in its own sentence, so working out who was standing where with two down in the fifth meant reading and adding up. Each play now ends with the same base diamond the live scoreboard draws, filled in with the runners that play left behind, and the outs beside it. It is the league’s own account of the next moment rather than our reading of the sentence, so nothing here can invent a runner. The play that ends a half-inning carries neither: three outs with the bases loaded strands the side rather than clearing it, and an empty diamond there would say the opposite of what happened.',
      },
      {
        short: 'Every half-inning says who was pitching, and every change names both pitchers',
        full:  'The play-by-play named a pitcher in exactly one place: inside the league’s own substitution sentences. Open the 5th and you were told everything about the at-bat except who was throwing. Each half-inning now says, and every pitching change in the list is worked out from the pitcher recorded on the plays themselves rather than from that sentence. The league is reliable about who comes in and much less so about who goes out: of the season’s 125 mid-inning changes, 39 are announced without naming the pitcher being relieved at all, and 10 more name one who had already left. All 49 read correctly now, and nine of the ten had been wrong on the site all season with no way for anybody to notice.',
      },
      {
        short: 'The play that won it is marked in the play-by-play, not just on the chart',
        full:  'The win probability chart has named the swing of the game since it shipped, and that sentence was a dead end: it told you Beth Greenwood grounded into a double play in the 7th and gave you no way to read the inning around it. The same play now carries the same words in the log itself. It is honest about what it is claiming: in a game nothing decided, and in one still being played, it says biggest moment rather than swing of the game.',
      },
      {
        short: 'Every at-bat has its own link',
        full:  'A game had one address, so pointing somebody at one play meant sending the whole game and describing which. Hovering a play now shows a # you can copy, and following one opens the game on the play log, with that half-inning open, scrolled to the at-bat and marked for a moment so you can see which of the eighty rows you were sent to.',
      },
      {
        short: 'A live game opens on the half-inning being played',
        full:  'The log landed fully collapsed, which is right for a game that finished hours ago and wrong for the one moment this list is worth the most: a reader opening a game in progress got fourteen shut headings and had to work out that the bottom one was the live one. It opens the half-inning under way, and each new one as it starts, and stops doing it for any half you close yourself.',
      },
      {
        short: 'Scoring only: the play-by-play as the list of runs',
        full:  'A toggle above the log keeps the plays that scored and the half-innings that had one, opens them, and drops the rest. Catching up on a game you missed is the commonest reason to open a play log and it was the one thing it could not do: eighty rows, twelve of them the ones you wanted. The half-inning headings keep their running score, so the game still reads in order, and whatever you had open yourself comes back when you turn it off. It is a view of this game rather than a setting, so the next game you open is the whole log again. On a game where nobody has scored yet it says so rather than going blank.',
      },
      {
        short: 'The two controls above the play log are big enough to hit on a phone',
        full:  'They were twenty pixels tall and ten pixels apart, which was awkward enough with one control and worse with two beside each other. They are half again as tall now, without the labels growing: the words were never the problem.',
      },
      {
        short: 'The Sep 11 semifinal had Jill Albayati leaving a game they had left three innings earlier',
        full:  'The league wrote San Francisco’s sixth-inning pitching change as “Liz Gilder to p for Jill Albayati”, but Albayati had been relieved in the third and the two innings in between were Niki Eckert’s, which is also what the box score beside it says and who it credits with the win. Reported by a reader watching the game. The line now names Eckert and carries the mark every corrected play does. Looking for others turned up nine more of exactly this, going back to Aug 2, which is what the change above fixes for good.',
      },
    ],
  },
  {
    version: '1.80.0',
    date:    '2026-09-10',
    title:   'One board for what a play is worth',
    changes: [
      {
        short: 'Standings by date: the whole season as a chart, under the table',
        full:  'The standings table says San Francisco finished 10-5 and nothing about whether they led all year. The chart under it now plots all four clubs against the calendar, in games above .500, so every club starts at zero and one game is always one step. Point at any day of it and the table itself goes back to that day: hover on a desktop, press and hold on a phone. Press play and it walks the whole season. The table says which date it is showing, and the chart reads the same games the table does, so the two cannot disagree, tiebreaks included. Under it, the things one table cannot tell you on its own: how many days each club spent in first, how often the lead changed hands, and the season’s biggest climb.',
      },
      {
        short: 'Clubs slide past each other when the standings reorder',
        full:  'Scrubbing the chart or pressing play reorders the table above it, and a table that reorders in one frame is a flicker: you see that something changed without seeing what. The rows travel to their new places instead, so you watch New York pass Los Angeles rather than finding them already swapped. The records themselves keep up with your cursor exactly; it is only the ORDER that waits for you to hold still for a moment, because digits ticking in place are easy to read and four rows changing places a dozen times during one sweep is not. A row on the move gets an opaque backing while it moves, since two clubs crossing would otherwise print through each other. The light grey lines between the clubs stay where they are throughout, so a club slides under its divider instead of taking it along. Under play the moves are cut to the speed the season is running at, so every club lands as the next day arrives. Off entirely if you have asked for reduced motion.',
      },
      {
        short: 'Findings has folded into Run value, so the prices and the players are on one board',
        full:  'Findings held one card for most readers, “What every kind of play is worth”, and that card is the table the Run value board next to it is entirely priced off. Split across two tabs it was reaching the wrong people: 41% of the readers who opened Run value never saw the prices behind it, and almost nobody was choosing Findings by name, they were walking the row of boards left to right and stopping when they ran out. Everything that was on it is now on Run value, in the order the idea is built: who created the most runs, what each kind of play is worth, what each count is worth, taking against swinging, and the full explanation in a card you can open. “How this is worked out” now opens that explanation and scrolls you to it instead of sending you to another tab.',
      },
      {
        short: 'The play-by-play says when a play did not come from the league',
        full:  'A reader counted two Katherine Murphy singles in the Aug 20 play-by-play against a box score crediting one, and the page gave them no way to tell why. The league published the whole of New York’s sixth and seventh that night as rows carrying a pitcher and a pitch sequence and nothing else, so those at-bats were filled in from RetroWPBL, an independent transcription of the same game. Those plays now carry a small mark, and a line at the foot of the play-by-play says how many there are and where they came from. Both readings disagree about that one at-bat and neither can settle it; what was wrong was showing them as one account that did not add up. Two games in the season have any of these.',
      },
      {
        short: 'Claire O’Sullivan’s postseason opener is back under the right name',
        full:  'The league published New York’s Sep 10 box score with the first name as Catherine, under a player id it had never used for O’Sullivan before, so the game was filed under a second player nobody recognises and O’Sullivan’s own page was missing it. Both are one person again, and the three at-bats, the walk and the RBI are theirs. Reported by a reader. A check now runs twice a day for the same shape of mistake anywhere on the roster, since the only thing that caught this one was somebody noticing.',
      },
      {
        short: 'The run expectancy table draws each situation instead of spelling it',
        full:  'Every row of it now carries the same base diamond the live scoreboard draws at the top of a game page, so “runners on 1st and 3rd” is a shape you recognise rather than a label you read. On a phone the written labels step aside and the diamond stands alone, which is what finally lets all 24 numbers fit on the screen at once: the words were the widest thing in that column and the table used to scroll sideways away from them. The diamond carries the full phrase for a screen reader either way.',
      },
      {
        short: 'The Stats boards fit a phone screen without scrolling sideways',
        full:  'Five instead of six: Players, Teams, Pitch by pitch, Run value, Draft. The row measured 351px on a 375px screen, which is the whole of it, so the last board is no longer the one hanging off the edge.',
      },
    ],
  },
  {
    version: '1.79.2',
    date:    '2026-09-10',
    title:   'Seven players the feed spells its own way',
    changes: [
      {
        short: 'Emi Saiki, Valerie Perez and five others get their face and their page back in a live game',
        full:  'The league writes the play log and the live situation as prose, with names and no ids, and it does not spell seven of them the way its own roster does: Emi Saki for Emi Saiki, Val Perez for Valerie Perez, and the same for Isabella Villarreal, Maggie Foxx, Alexia Jorge, Gabrielle Haas and Suzu Narasaki. Everything hanging off a live name is keyed on it, so all seven lost their headshot, their line in the game and the link to their page at once, and showed as initials on a coloured circle, which reads as somebody the site has never heard of. Reported by a reader watching the postseason opener, where the pitcher of record was “Emi Saki” on the card and Emi Saiki in the box score one tab across. Names now match on a rule rather than letter for letter, and the play-by-play prints the roster’s spelling too. It still refuses to choose when two players fit, because a wrong match would put somebody else’s season under this batter’s face.',
      },
    ],
  },
  {
    version: '1.79.1',
    date:    '2026-09-08',
    title:   'One character off the next game',
    changes: [
      {
        short: 'The next game card drops the “@” before the home club',
        full:  'Away over home is how a fixture is written and the two rows are already stacked that way, so the marker was doing work the order had already done. The card that shows a regular-season game dropped it a while ago; the postseason one had not, which meant the same slot on the same page printed it on some days and not others. The scoreboard strip above still carries one, on purpose: there the clubs are three-letter abbreviations in a narrow box, where order alone is harder to read and a character is cheap.',
      },
    ],
  },
  {
    version: '1.79.0',
    date:    '2026-09-08',
    title:   'Picks belong to you now',
    changes: [
      {
        short: 'Postseason picks need an account, so they can be scored and compared',
        full:  'They were kept on the device you made them on, which was the right call for a poll with nothing at stake and the wrong one for picks that are going to be scored against how the series actually go. A browser does not survive a cleared cache and does not follow you to your phone, so a table of who called what would have credited the wrong people. Picks are counted per account now. You can still open the sheet and read every question signed out; what you cannot do is answer.',
      },
      {
        short: 'The regular-season meetings are bigger, and the team leaders line up under their heading',
        full:  'On a desktop the five past meetings sat in a column with room to spare, reading as a footnote beside the comparison bars next to them: bigger scores and badges there now, unchanged on a phone where there is no such room. And the Team leaders heading was the last thing in that block still flush left, pointing at a margin rather than at the table it labels.',
      },
      {
        short: 'The next postseason card drops a line it did not need',
        full:  '“Scheduled by the league. The game page opens once it publishes the fixture.” The card is headed by a date and a countdown and is visibly not a link, which says the same thing without spending two lines on it.',
      },
    ],
  },
  {
    version: '1.78.0',
    date:    '2026-09-07',
    title:   'Open a series',
    changes: [
      {
        short: 'Tap any matchup in the bracket for a full series overview',
        full:  'Who is playing and how likely each of them is, every game of the series with its date and time and who bats last, what happened when the two clubs met in the season, the tale of the tape, and the players to watch on each side. Most of that existed in pieces scattered around the section and none of it was in one place. On a wide screen it opens as two columns so the whole thing is on one screen; on a phone it stacks.',
      },
      {
        short: 'Every regular-season meeting, as it was played, and each one opens',
        full:  'The five games the two clubs played each other, each as away at home with both scores and the winner in their own colour, and each a tap through to that game’s box score. It used to print the date on the left and “SF 13-7” on the right with a hand’s width of nothing between, which never said where the game was and, in a series one club swept, printed that club’s name five times.',
      },
      {
        short: 'Away club first, everywhere in the overview',
        full:  'The schedule reads "BOS @ SF", the team comparison reads "BOS vs SF" and team leaders puts Boston on the left, but the two club panels at the top led with the higher seed: four blocks, one of them the other way round. Away first throughout now, which is also how a baseball line reads.',
      },
      {
        short: 'Team leaders, the two clubs side by side with the stat between them',
        full:  'Batting average, OPS, home runs and RBI, then ERA, strikeouts and innings, laid out the same way as the team comparison above it: one club on the left, one on the right, the stat down the middle. Two separate lists is not a comparison, since reading who has the better ERA meant finding ERA twice. Rate stats use the same qualifier the leaderboards do, so a club’s batting average is not a pinch-hitter who went 2-for-2 in August, and leaders are worked out from the box-score lines played FOR that club rather than from who is on its roster today.',
      },
      {
        short: 'The whole matchup box is the tap target now',
        full:  'Each club row used to be its own link to that club’s page, which made a box two controls with a strip of nothing between them and left the box itself, the thing you point at, doing nothing. The club links moved into the overview, where there is room to label them properly.',
      },
      {
        short: 'Fixed: a pop-up opened from a tab could run off the bottom of the screen',
        full:  'Anything that opens over the page, a game, a player card, the series overview, is pinned to the screen rather than to the page behind it. That only works while nothing above it has been moved, and the tab strip slides sideways to change tabs, which was enough to pin those pop-ups to the tab instead. A short one looked fine; a tall one ran off the bottom with no way to scroll to the rest. The series overview was the first one tall enough to show it.',
      },
      {
        short: 'Fixed: the next postseason game was showing the wrong time outside Central',
        full:  'The card that names the next game printed the league’s Central clock as-is for postseason fixtures, while every other clock on the site converts to where you are. A reader on the west coast was told the first playoff game in league history starts at 6:00 PM when it starts at 4:00 PM their time. It converts now, and agrees with the schedule strip and the new series overview.',
      },
    ],
  },
  {
    version: '1.77.0',
    date:    '2026-09-07',
    title:   'A bracket you can read across the room',
    changes: [
      {
        short: 'Each club’s chance to win its series is now the row it is written on',
        full:  'The odds used to be a six-pixel bar under both clubs with a percentage at each end, which meant a bar running red at one end and green at the other: that reads as good-against-bad rather than as San Francisco against Boston. Each club’s chance is now drawn as a field behind its own name, in its own colour, with its own number at the end of its own row. Same information, no legend, and the colour finally says whose it is.',
      },
      {
        short: 'Clubs go by their full names where the column can hold one',
        full:  'San Francisco Firebells rather than Firebells, on a wide enough screen. The cut-off is measured rather than picked: below about a thousand pixels each series box is narrow enough that the longest name would ellipsise to “San Francisco Fireb…”, which is worse than the nickname, and the cut-off allows for the Large text setting too, since that grows the name and narrows its column at the same time. The Chance to win it all list keeps nicknames on purpose: the bars are the point of that list, and a city takes a third of the length out of every one of them.',
      },
      {
        short: 'Club names are half again bigger, and the card is a quarter shorter',
        full:  'The biggest thing in a series box was a 16px club name, which is smaller than the club names on the card directly underneath it, so nothing in the bracket had any weight. Names are 21px now, the percentages 19px, and the seed, the dates and the season series have dropped back to one quiet size. The published dates and the season series share one line where there used to be three.',
      },
      {
        short: 'The championship is a full-height card with the title odds inside it',
        full:  'The bracket had a 598 by 165 hole in its top right and a matching 114px gap between the two semifinals: about a quarter of the card was blank. Two boxes on the left against one on the right will always leave the right side short unless that one box is allowed to be tall, so it is. Chance to win it all now lives inside the championship box, which is the box that asks that question, instead of in a strip underneath it. The whole thing is 358px where it was 506.',
      },
    ],
  },
  {
    version: '1.76.0',
    date:    '2026-09-07',
    title:   'Call the postseason',
    changes: [
      {
        short: 'One button at the top of the bracket: make your picks for all three series',
        full:  'Who wins each series, and in how many games. The bracket card carries a single button at the top of it rather than a row of controls under every series: the card is there to draw a bracket, and most readers will never want to predict anything. Pressing it opens the picking on its own, with room to do it properly. On a phone, where the bracket arrives folded up, the button rides in the card’s header and takes you straight there without unfolding anything.',
      },
      {
        short: 'Two taps per series: the club, then how long',
        full:  'Pick a club and the lengths appear underneath it in that club’s colour: in 2 or in 3 for a semifinal, in 3, 4 or 5 for the final. Asking both halves at once meant four options of equal weight with nothing saying which half you were answering. This says it in the order people say it, and the second question only ever has two or three answers.',
      },
      {
        short: 'Your semifinal calls decide the final you are asked about',
        full:  'Send the Firebells and the Heights through and the championship asks you about the Firebells against the Heights, before either semifinal has been played. It is a bracket, so it flows like one. Once a semifinal is actually decided the real winner takes over, whoever you picked, and if the club you had in the final is not in it any more you are told and asked again.',
      },
      {
        short: 'Your call shows on each series box, and how many agreed',
        full:  'Once you have picked, the box carries it: “Your call, Firebells in 3”, with the share of fans who said the same. That share is hidden until you have answered, or until the series starts. A poll that shows its results first stops measuring what people think and starts measuring what the first fifty people thought. Picks change as often as you like until first pitch, then lock and get marked against the result.',
      },
      {
        short: 'The bracket leads the page until the postseason has a game in it',
        full:  'Road to the title normally sits below the season’s numbers, so it does not push the next game and its countdown down the page. Between the last regular-season game and the first postseason one that is the wrong way round: last game is a September 6 result nobody is waiting on, and the bracket is the only thing on the page about what happens next. It leads for now and puts itself back the moment a postseason game is final, because at that point last game IS that game.',
      },
      {
        short: 'And you can take your picks back',
        full:  'A pick can be changed by making another one, and now it can also just be withdrawn: "Clear my picks" at the foot of the sheet, which asks once before it does it. It only touches series that have not started, because what you called before first pitch is the point of having called it.',
      },
      {
        short: 'No account needed',
        full:  'Picks are kept on the device you make them on, the same way the fan awards ballot works. Nothing here scores a pick yet, so an account would buy you nothing today and cost the poll a lot of answers.',
      },
      {
        short: 'Fixed: the fan vote could never have been recorded',
        full:  'The ballot behind this went in last week with nothing on the site using it yet, and the way it saved a vote could not work: the table is deliberately unreadable, and the kind of save it was using needs to read the row it is replacing. Every vote would have appeared to land and gone nowhere. Nothing was lost, because nothing had been cast yet, and it is fixed for this and for the fan awards ballot to come.',
      },
    ],
  },
  {
    version: '1.75.1',
    date:    '2026-09-07',
    title:   'The strikeout rate says what it is',
    changes: [
      {
        short: 'K/7 now explains itself in the pitching sort picker',
        full:  'Every stat in the sheet that ranks pitchers carries its full name under the abbreviation, so a reader who knows what a strikeout is can find their way around it. K/7 was the one that did not, because its heading is built when the page renders (it follows whether you have chosen per 7 or per 9) and the list of names is fixed. It now reads "Strikeouts per 7 innings", or per 9 if that is your setting. Plain SO, the strikeout count, was already there and is unchanged.',
      },
    ],
  },
  {
    version: '1.75.0',
    date:    '2026-09-07',
    title:   'What the league changed, and to whom',
    changes: [
      {
        short: 'A finished game can now show the scoring changes the league made to it afterwards',
        full:  'The date of the last revision has been on the game page since last week, and the thing it could not say was what actually changed. A game that has been re-scored now carries a "Scoring changes" list at the foot of its recap: which player’s hit, RBI or earned run moved, which pitcher gained or lost the decision, which play was rewritten, and what the score, hits and errors were before. It is folded away by default, since most revisions are one number.',
      },
      {
        short: 'Every change names the player it is about',
        full:  'Corrections are matched to a player through every id the league has ever issued them, so somebody who changed clubs mid-season is still one person here rather than a line vanishing from one page and appearing on another. An entry the league published without an id is reported as exactly that and is never guessed at by name.',
      },
      {
        short: 'The list only ever fills going forward',
        full:  'The old scoring exists for about a second: our nightly check finds a game that has moved, writes down what changed, and then re-reads the game from the league, which overwrites it. So this starts from today. Games revised before now show the date they were revised, as they already did, and no detail.',
      },
    ],
  },
  {
    version: '1.74.2',
    date:    '2026-09-07',
    title:   'The backwards K means what it means',
    changes: [
      {
        short: 'Only a called third strike gets the scorekeeper’s backwards K',
        full:  'A mirrored K in a scorebook is a strikeout looking. The pitch strip was mirroring every called strike, which is 1,480 pitches this season against the 96 that are actually called third strikes, so a single on 0-2 drew a backwards K and told anyone who reads the notation that the batter had struck out. Only the last pitch of a strikeout looking carries it now, and hovering that pitch says "called third strike" rather than "called strike".',
      },
      {
        short: 'The count in the pitch strip can no longer show a fourth ball',
        full:  'The league publishes the count with the last pitch counted, so a walk arrives as 4-0 and a strikeout as 0-3, and between batters it briefly publishes the previous batter’s finished count. The play-by-play always read the count from the play’s own description and was right; the small live strip beside the bases did not clamp, and could show a fourth ball or a third strike. It clamps now, in the one place every surface reads.',
      },
      {
        short: 'The count and the pitches sit on one baseline',
        full:  'They were held level by a two-pixel nudge on one and a fitted line height on the other, a fixed offset between two things that both grow with your text size setting.',
      },
    ],
  },
  {
    version: '1.74.1',
    date:    '2026-09-06',
    title:   'The play-by-play keeps the score',
    changes: [
      {
        short: 'Each half-inning shows the score after it, not just how many runs it produced',
        full:  'A closed play-by-play was fourteen rows saying two runs scored here and three there, which is the change and never the state: scrolling to the 6th told you what happened in the 6th and not what the score was. Every half-inning now carries the score after it, away team first, the same order as the line score at the top of the sheet. The runs that half produced are still there, as "+2" beside it.',
      },
    ],
  },
  {
    version: '1.74.0',
    date:    '2026-09-06',
    title:   'A game opens on the game',
    changes: [
      {
        short: 'The first thing on a phone is the result, not the paperwork',
        full:  'Opening a finished game gave you, before anything else: a ten-column grid, how long the game took, the weather, the umpires’ names, a transcription credit and a revision date. That was 268 pixels of a phone screen, about 43% of the sheet, and none of it is why anyone opens a game. The score is now the biggest thing on the sheet and the story is above the fold.',
      },
      {
        short: 'The winning club’s row is tinted in its own colour',
        full:  'A line score is twelve numbers and nothing in it said who won except a thin stripe and the colour of one figure. The winner’s row now carries a wash of the club’s colour, the same one the scoreboard on the home page uses, so the result reads at a glance without any number having to grow. Runs, hits and errors all stay, at the size they were.',
      },
      {
        short: 'Length, weather, umpires and the rest are one list at the foot of the recap',
        full:  'They were four different type treatments in the header. They are one label-and-value list now, last on the Recap tab, where reference material belongs. The RetroWPBL credit stays attached to the RetroWPBL data: a game they have not transcribed yet shows the errors and the revision date with no credit, rather than crediting them for our numbers.',
      },
    ],
  },
  {
    version: '1.73.0',
    date:    '2026-09-06',
    title:   'When the league last changed a box score',
    changes: [
      {
        short: 'A game now says when its box score was last revised',
        full:  'The league keeps changing box scores after the game: 23 of the season’s 30 have been revised at least two days later, one of them nineteen days later. Until now there was no way to tell, so a stat that moved in a season total came from nowhere. A finished game whose box score changed after the day it was played says so under the scoreboard, with the date the league changed it.',
      },
      {
        short: 'The schedule marks the ones changed in the last week',
        full:  'Nearly every game has been revised at some point, so marking all of them would say nothing. The schedule marks the ones the league touched in the last seven days, which is the "what has changed since I last looked" the game pages cannot answer on their own. Eight of the thirty carried the mark on the day it shipped.',
      },
      {
        short: 'The date shown is the league’s day, not yours',
        full:  'These revisions land late in the evening in Springfield, which is already the next day in UTC and still the afternoon on the west coast. The date is the one the league’s own clock was on, so two readers in different places see the same answer.',
      },
    ],
  },
  {
    version: '1.72.0',
    date:    '2026-09-06',
    title:   'Open the whole play-by-play at once',
    changes: [
      {
        short: 'One control opens every half-inning, and it is remembered',
        full:  'The play-by-play opens with its half-innings shut, which is right for looking up one at-bat and fourteen clicks for reading the game. There is an Expand all above the log now, and it remembers what you chose: if you read the whole thing on one game, the next game opens the same way. Collapse all puts it back. Opening and closing a single half-inning still works as it did and does not change the setting.',
      },
      {
        short: 'The half-inning headings can be reached from the keyboard',
        full:  'They were clickable and nothing else, so a reader working by keyboard could not open one at all. They take focus now, Enter and Space open them, and each says whether it is open to a screen reader.',
      },
    ],
  },
  {
    version: '1.71.0',
    date:    '2026-09-06',
    title:   'The play-by-play says who did what',
    changes: [
      {
        short: 'A pickoff attempt no longer reads as if the runner failed at something',
        full:  'The league writes these as "Lexi Hastings Failed pickoff attempt", and Hastings is the runner: the pitcher threw over and did not get them. On the page it read as though Hastings had failed at something. All 139 of them now read "Failed pickoff attempt at Lexi Hastings", which is the same fact the right way round.',
      },
      {
        short: 'Substitutions stopped being printed as if they were plays',
        full:  'A line reading "Jamie Mackay to lf" between two at-bats looks like something the batter did at the plate. It is a defensive change, and 109 of them were being given a play’s weight because the league writes them without the "for So-and-so" the old rule looked for. Another 29 arrived as a bare slash where the incoming player’s name should be, and printed as "/ for Ayami Sato", which looks like the page is broken. Both now sit in the quiet substitution style, the second named as what it is.',
      },
      {
        short: 'Who made the play is named on a runner being thrown out, not just on the batter',
        full:  'A runner retired at second read "out at 2nd" with the fielders removed, on the reasoning that "out at second" has already said what happened. It has said what, and never by whom. It now reads "out at 2nd, ss to 2b", the same way a double play does.',
      },
      {
        short: 'Three more lines where the name shown was not the one who did it',
        full:  'From the 8th inning on, the league writes the batter due up and the runner placed on second as two names in a row, so the line read as the batter having placed the runner there; it now names the runner and says what it is. A dropped foul ball was printed under the batter’s name with the league’s scoring shorthand, "Dropped foul ball, E3", when it is the first baseman who dropped it; it now says so in the same words the rest of the list uses for a fielder. And a pinch hitter being announced is a roster move, not a plate appearance, so it sits with the other substitutions rather than in a play’s weight.',
      },
      {
        short: 'A fielder is named one way, and "singled to 3rd base" is gone',
        full:  'The league names a fielder two ways in the same game: "grounded out to 2b" and "singled to second base". The second collided with the shortening that turns a runner’s destination into "2nd", so 46 plays printed things like "singled to 3rd base", which is not English and was ours rather than the league’s. Fielders are now written one way throughout. Sixteen plays that the league sent with no description at all used to draw an empty row in the middle of an inning; they draw nothing now.',
      },
    ],
  },
  {
    version: '1.70.1',
    date:    '2026-09-06',
    title:   'The pitching line adds itself up',
    changes: [
      {
        short: 'A box score now totals its pitching, the way it has always totalled its batting',
        full:  'The batting half of a box score ends in a Totals row and the pitching half stopped at the last reliever, so the club’s own line, the hits and runs it gave up and how many pitches it took, was left to be added up by eye. There is a Totals row under the pitchers now, in the same place and the same weight as the batting one. Innings are added as outs rather than as the decimals they print in, so three and a third plus two thirds comes out as the four innings it is instead of 3.3. A column the league has left a gap in shows a dash rather than a total that quietly leaves somebody out.',
      },
    ],
  },
  {
    version: '1.70.0',
    date:    '2026-09-06',
    title:   'The playoff schedule comes from the league',
    changes: [
      {
        short: 'Who bats last now comes from the league’s own calendar, not from a list typed in here',
        full:  'The postseason dates on this site were copied from the league’s August announcement into a constant, and nothing had checked them since. The league’s website publishes the same calendar as data, with things the stats feed does not have: the home club for each semifinal game, the first-pitch times, its own page for each game, and the ticket link. That calendar is now mirrored every three hours and the schedule reads it, so a game the league moves moves here too, and the five championship games get their home clubs the moment the finalists are known instead of waiting for a code change.',
      },
      {
        short: 'The old list is still there as a floor, and is now checked rather than trusted',
        full:  'The constant stays as the fallback, because it says "the higher seed bats last in games 1 and 3" rather than naming clubs, so it is still true on a morning when the mirror has not been read. A nightly job now compares the two and goes red if they ever disagree, which is how a moved game reaches a person instead of sitting wrong on the schedule.',
      },
    ],
  },
  {
    version: '1.69.2',
    date:    '2026-09-06',
    title:   'The play-by-play names the fielders again',
    changes: [
      {
        short: 'A double play says who turned it',
        full:  'The league writes one as "grounded into double play ss to 2b to 1b", and the play-by-play was cutting the fielders off the end, leaving "grounded into double play" with no sign of who was involved. Every other out already named its fielder, because "grounded out to 2b" says it in words and a double play says it only in that sequence. All forty of the season’s now read like the rest of the list.',
      },
      {
        short: 'An error says which position made it',
        full:  'An error read as "reached first on an error", with the position dropped on the grounds that the box score carries it. The box score carries a count, six errors against a club, and never which of them let a run in. The position is back, in all three of the ways the league spells it, so a throwing error by first and a fielding error by short are told apart. It stays a position rather than a name: the league gives a position, and deciding who was standing there is a guess as soon as somebody changes position mid-game.',
      },
    ],
  },
  {
    version: '1.69.1',
    date:    '2026-09-06',
    title:   'Playoff games say who bats last',
    changes: [
      {
        short: 'The semifinals now show a home club, matching the league’s own schedule',
        full:  'The postseason rows on the home page and the schedule listed their two clubs in seed order with no "@" between them, on the grounds that the league had published dates and times and no home team. Its schedule page does carry one, for all six semifinal games: the higher seed bats last in games 1 and 3, the lower seed in game 2. Sep 9 now reads Boston @ San Francisco and Sep 11 reads San Francisco @ Boston, the same as the league lists them, and the scoreboard strip, the schedule and the Next game card all say it the same way.',
      },
      {
        short: 'The championship still does not, because the league has not said yet',
        full:  'Those five are listed as "WPBL Championship Game #1" with no clubs on them, so there is no home team to show. They keep printing the two seats in bracket order with no "@" rather than guessing the pattern from the semifinals, and a matchup whose clubs are known while their seed order is not is treated the same way.',
      },
    ],
  },
  {
    version: '1.69.0',
    date:    '2026-09-06',
    title:   'Next game points at the playoffs',
    changes: [
      {
        short: 'The Next game card no longer empties out when the regular season ends',
        full:  'The card reads the league’s published games, and those stop on Sep 6 until the bracket is posted, so from Sep 7 it had nothing to show and disappeared, leaving a gap in the middle of the home page for the six weeks people check it most. It now falls back to the postseason dates the league has already published, the same ones the scoreboard strip and the schedule have carried since Sep 3: who is playing, which game of which series, when, and the countdown to first pitch.',
      },
      {
        short: 'It says what it does not know, rather than guessing',
        full:  'A club is named only once it can no longer change seeds; until then the card shows the seat, "2 seed", the way the schedule does. There is nothing to tap, because the league has published a date and not a fixture, and the card says so instead of looking like a broken link. A game that might never be played, like a deciding game 3, is never the one it heads itself with.',
      },
    ],
  },
  {
    version: '1.68.2',
    date:    '2026-09-06',
    title:   'Emi Saiki plays for New York',
    changes: [
      {
        short: 'A pitcher who has never played for Los Angeles was listed on their roster',
        full:  'Emi Saiki was showing as a Queen, a club they have never played a game for: all six batting lines and both pitching lines are New York, and on Sep 4 Saiki threw six innings and won the Heights’ 14-2 over San Francisco. It was not a trade, it was flapping between the two clubs, once each way per game, eleven times. The league lists a second, unidentified "Emi Saiki" in Los Angeles box scores, and the part of the ingest that recognises a trade took the matching name as one. It now wants the league’s own player id before it will move anybody between clubs, which a real trade always carries, and the roster row is back on New York.',
      },
      {
        short: 'Suzu Narasaki was on the wrong club too, from the same night',
        full:  'Checking every player’s club against the club they last actually played for turned up one more. Suzu Narasaki really was traded, from Los Angeles to New York on Aug 27, and has played for the Heights ever since. The same Sep 5 Los Angeles box score that moved Saiki moved Narasaki back, within the same minute. Both are corrected, and the check now comes back clean for all 118 players.',
      },
    ],
  },
  {
    version: '1.68.1',
    date:    '2026-09-06',
    title:   'Every player in a box score gets their name back',
    changes: [
      {
        short: 'A player who has changed clubs is named in the games they played before the move',
        full:  'A box score identifies its players by an id and nothing else, and the game page was looking those ids up against the two clubs’ rosters as they stand today. Anybody whose roster row had moved on was simply missing, and the name came out as a dash. On the Sep 4 game, New York 14 San Francisco 2, that was the winning pitcher: a dash on the decision line, a dash under a blank portrait as a Star of the Game, and a dash in the pitching table, on a night they threw six innings and struck out four. The page now looks names up against the whole league, which is the only list that can answer a question about who played in a game last month.',
      },
    ],
  },
  {
    version: '1.68.0',
    date:    '2026-09-06',
    title:   'A Live tab, for while the game is on',
    changes: [
      {
        short: 'A game in progress now opens on what is happening right now',
        full:  'Opening a live game used to land you on the box score, which is a half-finished table. There is a Live tab now, and it is where a live game opens: the count as a scoreboard band, the bases with the runners named, the batter and the pitcher with what each has done in this game, the last play, and the win-probability line underneath. Once the game goes final the tab becomes the Recap in the same place, so if a game ends while you are watching, nothing moves out from under you.',
      },
      {
        short: 'You can see who is on base, not just that somebody is',
        full:  'The little diamond in the header has always shown occupied bases as filled squares. The league actually tells us who is standing on each one, and that was being thrown away. The Live tab names them, third down to first, and only lists the bases that have somebody on them.',
      },
      {
        short: 'Balls, strikes and outs read like a scoreboard',
        full:  'They sit across the top of the card in the order every ballpark stacks them, in the colours every ballpark uses: green for balls, yellow for strikes, red for outs. Big enough to read at a glance rather than counted. An unlit bulb keeps its own colour faintly rather than going grey, so at 0-0 you can still tell the three groups apart.',
      },
      {
        short: 'The last play is broken into its parts instead of printed as one sentence',
        full:  'The league writes one long sentence with everything in it: the batter, what they did, the ball-strike count with the raw pitch letters in brackets, and every runner’s movement chained on with semicolons. The Live tab splits it the same way the Play-by-Play tab already does. The batter is bold and opens their page, the runners go on a quieter second line, and the count moves to its own column on the right so it is in the same place every time instead of floating mid-sentence.',
      },
      {
        short: 'One thing the Live tab cannot do, and will not pretend to',
        full:  'A batter’s line under their name is their line in that game so far. The pitch-by-pitch tracking is a different matter: the league publishes it days after a game rather than during one, so there is no pitch plot on this tab and there cannot be. Between half-innings the tab says which break it is and shows nothing else, because everything the feed is holding at that moment belongs to the at-bat that just finished.',
      },
    ],
  },
  {
    version: '1.67.0',
    date:    '2026-09-05',
    title:   'The postseason is on the scoreboard',
    changes: [
      {
        short: 'The scoreboard now runs past the last day of the regular season',
        full:  'The strip at the top of the home page has always been the feed’s games, and the feed’s games stop on Sep 6. From Sep 7 it would have been six weeks of finished scores with nothing ahead of it, in the one week of the season you are most likely to open it for. It now carries the postseason dates the league published, in the same shape: Semifinal game 1 on Sep 9, the other on Sep 10, and so on into the championship. They are drawn with a dashed outline, because they are dates rather than fixtures the league has published a page for, and there is nothing to tap yet.',
      },
      {
        short: 'And it names the clubs, because the matchups are already settled',
        full:  'San Francisco have the 1 seed and Boston the 4, so Semifinal A is San Francisco against Boston. New York and Los Angeles are still arguing over 2 and 3, which sounds like it leaves the other semifinal open and does not: 2 plays 3, so whoever wins that argument, those two are playing each other. The schedule and the scoreboard now say so, and mark the pairing as one whose seeding is still to come rather than pretending to know which club is the higher seed.',
      },
      {
        short: 'A deciding game stops being marked “if necessary” once it is necessary',
        full:  'Games 3, 4 and 5 of a series are only played if the series is still alive, so they carry an if-necessary mark and disappear entirely once someone has won. The other half was missing: a semifinal tied one game each has to play its game 3, and the schedule still hedged about it. It now drops the mark the moment the result before it makes the game certain, which is also what lets the scoreboard spend its four upcoming slots on games that will definitely be played.',
      },
    ],
  },
  {
    version: '1.66.0',
    date:    '2026-09-04',
    title:   'It only loads once now, and the club chart moves',
    changes: [
      {
        short: 'Tapping between clubs is instant after the first visit',
        full:  'The four club buttons at the top of a team page exist to be tapped back and forth, and every tap fetched that club’s roster, lineup history and pitching usage again, so going back to a club you had just looked at spun exactly as long as the first time, on numbers that had not changed. Each club is kept for the rest of your visit and the page repaints from that immediately, then quietly checks for anything new behind what you are already reading. The first visit to a club still loads, once.',
      },
      {
        short: 'Player cards reopen instantly too',
        full:  'A player card is opened from a leaderboard, which is a list of twenty of them: open one, read it, close it, open the next, come back to the first. Every one of those was three fresh database reads behind a spinner. The same treatment applies, and it needed one extra piece: closing the card throws it away entirely, so reopening is a fresh start rather than a change of player, and the card has to reach for what it already knows before it draws anything at all.',
      },
      {
        short: 'The club profile chart now moves from one club to the next',
        full:  'The six-sided shape on a team page used to cut straight from one club to another. It now slides between them over about a third of a second. This is not decoration: the whole claim of that chart is that a club has a recognisable silhouette, and cutting between two of them gives you two pictures to remember and compare, where sliding shows you the difference itself. Watching the Speed spoke collapse as you go from New York to San Francisco says more than either shape does standing still. Turned off automatically if your device asks for reduced motion.',
      },
      {
        short: 'The live scoreboard is deliberately left out of all this',
        full:  'Anything a game page refreshes on a timer is excluded from the remembering, and that is on purpose. A live box score re-reads itself every fifteen seconds, and it also updates the moment the league records a play. Keeping those answers for twenty seconds to save a request would mean a run scores, the update arrives, and the box score does not move. Speed is worth a lot on a page that is not changing and nothing at all on one that is.',
      },
    ],
  },
  {
    version: '1.65.0',
    date:    '2026-09-04',
    title:   'The Contact axis now measures contact',
    changes: [
      {
        short: 'Contact on the club profile chart is swing-and-miss rate, not strikeout rate',
        full:  'The six-sided chart on a team page has an axis called Contact, and until today it was drawn from how often a club struck out. That is not the same thing, and the number that settles it is this: 38 per cent of strikeouts in this league are called, with no swing taken at all. So an axis named Contact was, two times in five, counting an at-bat where nobody tried to make any. It now uses whiff rate, swings and misses as a share of swings, where every term in the fraction is a swing and taking a pitch cannot enter it. San Francisco read 11.1 per cent before and 12.8 per cent now, and moved from second in the league to first.',
      },
      {
        short: 'It also separates the clubs better than the old number did',
        full:  'The reason the axis was a strikeout rate in the first place was spread: a chart where all four clubs sit on the middle ring says nothing, and stating this as a contact percentage does exactly that, putting the league between 79 and 87 per cent. Whiff rate turns out to spread the four clubs wider than strikeout rate did, 50 per cent against 41. So the change costs nothing on the thing the old choice was protecting. It also stops Contact and Eye quietly measuring the same trait: a club that takes a lot of pitches draws more walks AND takes more called strikeouts, so two of the six spokes were partly the same fact.',
      },
      {
        short: 'The chart refuses to draw rather than invent a club that never swung',
        full:  'The pitch data arrives from a different read than the box scores, so it can fail on its own. A club with no swings would score a whiff rate of zero, and on an axis where lower is better, zero is the furthest-out spoke there is. The failure would not have looked like missing data, it would have looked like a club that was untouchable at the one thing that could not be measured. If any club has no swings on file, the chart shows its placeholder instead.',
      },
      {
        short: 'Further out is better, on every axis, and now there is a test saying so',
        full:  'Two of the six axes are the kind where a smaller number is a better club, and the chart has always handled that when working out how long to draw a spoke. Nothing checked it, though, and a mistake there does not look like a bug: it draws a club’s worst trait as its best and looks entirely normal doing it. Every axis is now covered by a test that makes one club genuinely better at one thing and insists the spoke grows, the rank goes to first, and the underlying number moved the way the axis claims it should.',
      },
    ],
  },
  {
    version: '1.64.0',
    date:    '2026-09-04',
    title:   'A page that explains the rules, and a home page a phone can read',
    changes: [
      {
        short: 'A rules and glossary page, linked from the footer of every page',
        full:  'How a WPBL game works, and what every abbreviation on a box score means, on one page. Seven innings, the roster rules, how a pitcher earns a win. The league does not publish most of this anywhere, so if you have watched a game and wondered why an inning ended the way it did, this is the page. It is linked from the footer of every page rather than given a tab of its own: the five tabs are what you use every day, and this is the one you read once.',
      },
      {
        short: 'Every stat abbreviation now explains itself the same way everywhere',
        full:  'Tapping a column heading on a player page used to expand the letters and stop there, and it was the only place in the section that could do even that: the same abbreviations appear on the home page, the stats boards and in Game Center, and none of those could say what one meant. The definitions now live in one place, shared by every surface, and each one answers two questions instead of one. OBP still expands to on-base percentage, and now also says what the number is actually for.',
      },
      {
        short: 'The next game card says when in plain words, at the top',
        full:  'The countdown read 05h 52m 44s in a block under the two clubs, which is a launch console rather than a fixture card: the only part moving was the least useful digit on it. It now reads "in 5h 52m" beside the start time on the card’s own title line, so "Next game, Today, 4:30 PM, in 5h 52m" is one sentence rather than three parts scattered down a card. The seconds are gone and nothing is lost, because nobody was reading them.',
      },
      {
        short: 'The last game card shows the score while it is closed',
        full:  'On a phone that card is folded by default and showed only the headline, on the reasoning that the score is one tile up in the scoreboard strip. It is, but that strip is a sideways scroller of six tiles, so a card titled "Last game" that could not say the score was asking you to go and match a date against it. The final now sits in the card’s header, closed or open.',
      },
      {
        short: 'Both game cards are drawn as one thing now',
        full:  'They sit one above the other and were drawing the same two parts three different ways between them: club rows as a colour band on one card and as small tinted pills on the other, and a last row as a shaded footer on one and a hairline plus a link on the other. Both now use one shape. What stays different is the half that means something: the next game tints both clubs because a fixture has two equals in it, and the last game tints only the winner.',
      },
      {
        short: 'On a phone, every page opens on the page instead of three headings saying the same thing',
        full:  'Every tab opened with a heading reading WPBL Standings, WPBL Stats, WPBL Teams or the league’s full name, directly under a nav reading Home, Schedule, Standings, Stats, Teams with that same word lit, under a toolbar with WPBL lit. On a phone that is the third time you are told the same thing, and on the home page it pushed the first card 344 pixels down a 812 pixel screen. Those headings are still there for screen readers and for search, they are simply not drawn on a phone any more. The home page now opens on the scoreboard. Laptops and desktops are unchanged.',
      },
      {
        short: 'A missing separator in the footer',
        full:  'The new glossary link ran straight into the one before it, so the footer read "The leagueRules & glossary" on every page. Caught before release.',
      },
    ],
  },
  {
    version: '1.63.0',
    date:    '2026-09-03',
    title:   'ERA is per seven innings now, because the league changed its mind',
    changes: [
      {
        short: 'Every ERA and strikeout rate on the site just got lower',
        full:  'A WPBL game is seven innings, but ERA has always been quoted per nine, which is the convention baseball uses everywhere else. This site followed the league rather than the arithmetic: showing 5.25 where the official site showed 6.75 for the same pitcher would have looked broken rather than better, whatever the maths said. In the first days of September the league switched its own stat page to per seven, and this now follows it there. Every earned run average and strikeout rate you see is about 22 per cent lower than it was yesterday, and matches what the league prints for the same pitcher. San Francisco’s staff reads 5.49 rather than 7.06, and Kelsie Whitmore 5.25 rather than 6.75. No pitcher moved up or down any leaderboard: dividing every number by the same figure cannot reorder them.',
      },
      {
        short: 'The ERA setting still has both, with the two options swapped round',
        full:  'Settings still lets you choose, and the choice now means the opposite of what it did. Per 7 is the default and matches the official WPBL site. Per 9 is there for anyone who wants to compare a WPBL pitcher against a major league one on the same footing, and is now the setting that disagrees with the league. If you had previously chosen per 7 because you preferred it, you were early, and nothing changes for you. One bug came with the swap and was caught before release: choosing per 9 would not have stuck across a reload, because the code that remembered the choice had only ever been taught to recognise the non-default answer.',
      },
      {
        short: 'Where this could go wrong again',
        full:  'Nothing on this site can detect a change like this. The nightly check that compares our copy of a game against the league’s reads plays, and the league’s data feed sends WHIP but no ERA at all, so a change of denominator on their side is invisible to every check here. This one was noticed because a reader mentioned it. If a pitching number ever looks wrong, the thing to compare against is the league’s own stat page, using a pitcher with plenty of innings, where the two ways of dividing are far apart.',
      },
    ],
  },
  {
    version: '1.62.0',
    date:    '2026-09-03',
    title:   'Every club gets a shape, and the schedule runs to the final',
    changes: [
      {
        short: 'Every club drawn as a shape, on its own page and all four together on Teams',
        full:  'The standings say who is winning and the team stats card says how much of each thing a club did. Neither tells you what KIND of team it is: that New York run on a fifth of their times on first while San Francisco almost never do. Six traits, drawn as the radial chart a video game would use for a character. Power is extra bases, Contact is how rarely they strike out, Eye is walks, Speed is steals, Arms is how often the pitchers miss bats, and Glove is unearned runs allowed. The middle ring is the league average, so the shape is read against the rest of the league rather than in a vacuum. A club’s own page draws that club; the Teams tab overlays all four, because there the comparison is the point. Two axes that seem obvious are missing on purpose: every club’s ERA is within nine per cent of every other, and every fielding percentage within two, so both would have drawn four spokes of the same length and said nothing.',
      },
      {
        short: 'The schedule runs to the championship instead of stopping on Sep 6',
        full:  'A postseason game needs two clubs, and nobody knows who plays whom until the last regular-season game sets the seeds, so the league’s feed carries no rows for it and the schedule tab simply ended at the last regular-season day. It now runs through the championship’s game 5 on Sep 22, from the calendar the league published on Aug 24. A row names a seed rather than a club until that seed can no longer move, so it says “1 seed” until the club holding it is actually locked in. Games that are only played if a series is still alive are marked, and disappear once the series is won. When the league draws the real bracket, its own games take these places automatically.',
      },
      {
        short: 'Search a player by their number',
        full:  'Type 7 in the search box and you get every player in the league wearing it, one per club, grouped by club. The hash is optional, so “7” and “#7” both work. A single digit is enough, which it is not for a name, because no name contains a number and so there is nothing else it could mean. Every search row now shows the player’s number beside their position and club. Players who have not been issued a number cannot be found this way, which is 49 of the 119 on the league’s books.',
      },
      {
        short: 'A team’s leaders in OPS and ERA now need enough playing time',
        full:  'The rate leaders on a team page had no minimum at all, so one at-bat and one hit was the best OPS on the club and a single out without conceding was the best ERA. Two of the four teams were being led in ERA by somebody who had thrown exactly one inning, and one team’s best hitter had nineteen trips to the plate. Both lists now use the same qualifying bar as the league leaderboards, which scales with how far the season has gone, and the bar is printed beside the heading so it is clear why a hot week does not put somebody on the list. Home runs, RBI, strikeouts and innings are unchanged: nobody hits four home runs in a cameo.',
      },
      {
        short: 'A team page a phone can reach the bottom of',
        full:  'It was more than five screens of scrolling. The lineup history and pitching usage grids, which slide sideways and were most of the middle of the page, are now closed by default on a phone and open with a tap; both stay open on a laptop. The roster shows ten and expands to the rest in place. Together that is about a third off the length of the page, and nothing was removed.',
      },
      {
        short: 'Game recaps reach Bluesky in an hour instead of overnight',
        full:  'Recaps of a finished game were arriving five to twelve hours late. Two reasons, and neither was the writing. The scheduled job that posts them was being run by GitHub hours after it asked to be, and the wait that lets a scoring correction land before a permanent public post was being measured from when that job happened to look at the game rather than from when the league finalised it. The wait now runs from the league’s own clock, and the site’s own database asks for the job as soon as a game has settled, instead of waiting to be noticed.',
      },
    ],
  },
  {
    version: '1.61.1',
    date:    '2026-09-02',
    title:   'The stats boards line up with their own controls',
    changes: [
      {
        short: 'The Hitting/Pitching switch sits over the board it switches',
        full:  'The row of controls under the board tabs is laid out for the widest thing on the page, which is the season stats table, so on Players and Teams the switch starts exactly level with the table\u2019s first column. On the boards whose content is a normal page-width column it was 255 pixels to the left of everything it applies to, hanging off the edge of the page while the board began a quarter of the way across. Pitch by pitch had read that way since it shipped. The switch now sits over whichever board it is switching, and the board tabs above it stay put, since those are what you press to change boards and should not move out from under the press.',
      },
      {
        short: 'Its leaderboard is a list again, not two columns with a gap',
        full:  'That board sits in a wide frame because the board beside it in the tabs is a stats table that needs every pixel. Its own content is one leaderboard, and it was being stretched to fill all of it: a player’s name sat at one end and their number at the other, about 1,200 pixels apart, which reads as two columns that happen to share a border rather than as a row. The list now keeps a sensible column width, the same one the schedule and standings pages use, and the board is centred on the page instead of pinned to its left edge with a third of the width empty beside it. Nothing changes on a phone, which was never wide enough for this to happen.',
      },
    ],
  },
  {
    version: '1.61.0',
    date:    '2026-09-02',
    title:   'The game card uses the screen it is on, and shows both teams at once',
    changes: [
      {
        short: 'The play you scrub to on the win probability chart is readable again',
        full:  'Dragging along the chart names the play at that moment, and that line had been getting squashed. The caption box holding it was a fixed height set in pixels while the text inside it is sized to the reader, so on a desktop, or with Large text on, the box stayed put while the three lines in it needed more room. It did not overflow or cut off at the edge, which is why it went unnoticed: the top and bottom lines are pinned, so the line between them, which is the play itself, got squeezed to a third of its height on a desktop and to almost nothing with Large text. The box is measured against its own text now.',
      },
      {
        short: 'Both teams’ box scores side by side on a wide screen',
        full:  'A box score is two teams, and this one showed you one of them with a switch to see the other. That was a decision about width rather than about baseball: the card was a narrow column, and the second club could only live behind a control. On a wide screen both now sit next to each other and the switch is gone, so comparing the two starting pitchers is a glance instead of two taps and a memory. Phones and smaller windows keep the switch, which is right for them.',
      },
      {
        short: 'Player names in the box score stopped being cut off',
        full:  'The name column had a fixed size set when the section was drawn smaller, and it never grew when the type did, so it went on holding what it used to hold while the names inside it got bigger. In one Aug 30 box score that clipped three of them, including “Natsuki Yon…” and “Claire O’Sulliv…”. The column is measured against the type now and was sized against the whole roster: 116 of the league’s 119 names fit it outright. The table did not have to get any wider for that, the column had simply been starved by stat columns with no use for the room.',
      },
      {
        short: 'The card is no longer a narrow strip on a big screen',
        full:  'It was pinned to a width chosen for a phone column, so on a laptop it was using about a third of the window while running taller than the window itself: it scrolled vertically with room to spare on both sides. It now takes the width it needs, which is also what makes room for both teams.',
      },
      {
        short: 'Play-by-play keeps a comfortable column',
        full:  'The one part of the card that gains nothing from extra width is the play log, because it is a list. Left to stretch it would put “TOP 1ST · NY BATTING” at one end of the card and “1 run” at the other. It keeps a column sized against its own text, the same way Schedule, Standings and Teams do, while the box score and the recap take the full width because a table and a chart can use it.',
      },
      {
        short: 'Stars of the game show their full names',
        full:  'The three players named under the win probability chart were squeezed into a third of a narrow card each, so they read “A. Le…”, “D. Be…” and “L. G…”. They have room now.',
      },
    ],
  },
  {
    version: '1.60.0',
    date:    '2026-09-02',
    title:   'Player cards say more, and every one of them is the same shape',
    changes: [
      {
        short: 'The line above the stats says something the stats cannot',
        full:  'That one line of English is there to give you the RELATIONSHIPS between the numbers, which is the thing a grid of boxes cannot show. Two of its endings had drifted into restating a single box: Maïka Dumais’s card read “5 stolen bases” directly above a box reading SB 5. It now says the things that take two numbers to see, like five steals without being caught once, or seven runs scored from ten times on base. It can also say two of them now instead of one, so a player outside the league rankings gets a fuller sentence rather than a shorter one.',
      },
      {
        short: 'Players who have not qualified yet get a league ranking',
        full:  'Rate stats like batting average need a minimum number of plate appearances before they mean anything, which is why a player short of that bar got no rankings at all: the part of their card that places them against the league simply vanished, for exactly the player you are least able to place yourself. Counting stats have no such problem. Five stolen bases is five stolen bases whether they came in nine games or forty. Cards now rank those, so Dumais’s page can say Dumais is 3rd in the WPBL in steals, which it had no way to tell you before.',
      },
      {
        short: 'The stat boxes are the same size on every player’s card',
        full:  'The grid used to choose its column count by looking for a number that divided evenly into however many boxes it had, and the number of boxes changes from player to player, because a stat that has never happened is left off. So the boxes changed size depending on whether someone had been hit by a pitch. Kelsie Whitmore’s two tabs showed the same grid at two noticeably different sizes, one tap apart. Every card is now two rows of six, and a short last row is allowed.',
      },
      {
        short: 'A pitcher’s card is not padded out around a short game log',
        full:  'On a wide screen the card puts season stats on the left and the game log on the right, and the right-hand column had been sized for a batting log. Pitchers appear in far fewer games and their log has fewer columns, so every pitching card was stretching an eleven-column table across space it did not want while the column beside it ran much longer. The game log now takes the width it actually needs. Whitmore’s card lost 40% of its scrolling.',
      },
      {
        short: 'Fielding stats say which positions they cover',
        full:  'A fielding line covers every position a player has taken, and there is no way to split it: the league’s data does not record which position each play came at. On a two-way player that made the pitching tab misleading, since Whitmore’s 21 putouts are catches in centre field and a pitcher does not make 21 putouts in five relief appearances. The line now ends with the positions those numbers came from.',
      },
      {
        short: 'How close a player is to qualifying, rather than the bar itself',
        full:  'Under the headline number a card said “29 PA to qualify” while a meter further down said “1 more PA”. Both were true and they were different numbers for one fact, and the bigger of the two sat under the biggest type on the card, where it reads as something still owed. It now names the gap, so a player one plate appearance from the leaderboards is told so.',
      },
      {
        short: 'One ranking list instead of two, and no stat ranked twice',
        full:  'League rankings were briefly split across two blocks with two headings that meant the same thing in English and differed only by which players they compared against. They are one list again. The summary line has also stopped naming a ranking that the list underneath was already showing with its value and its bar.',
      },
      {
        short: 'Pitch locations sit under the game log now',
        full:  'The pitch plot was the first thing in the right-hand column, which put the least complete thing on the card at the top of it. League pitch tracking only ever reached a handful of games, so that card usually reads something like “44 pitches, 1 of 5 games”. The full record of every appearance comes first, and the plot sits underneath it.',
      },
    ],
  },
  {
    version: '1.59.0',
    date:    '2026-09-01',
    title:   'The seeding race is on the standings page for everyone',
    changes: [
      {
        short: 'What the last five games actually decide, under the standings table',
        full:  'All four clubs are already in the postseason, so the table has been showing a race for a place nobody can miss. What the remaining games decide is the ORDER, which sets the semifinals: first plays fourth and second plays third. There is now a card under the table giving each club its seed, how many wins or rivals\u2019 losses it still needs to lock that seed, and the club it would draw in the semifinals. It had been available only to readers who had turned experimental features on, which with five games left was nobody who needed it.',
      },
      {
        short: 'It names the one game left that can still move the order',
        full:  'A magic number says what a club needs and never says when it gets settled. The card now names the remaining games between two clubs who are next to each other in the table and whose order is still genuinely open, which as of today is exactly one: Heights at Queens on Sep 3. A game between clubs already separated is left off, however good the fixture, because it cannot change anybody\u2019s seed.',
      },
      {
        short: 'The bottom club gets a number instead of a sentence',
        full:  'It used to read \u201cCan still reach 3rd\u201d, which answered a different question from the rest of the column and was the longest line on the card. It now reads \u201c5 to reach 3rd\u201d, counted the same way as every other row: the Hunters need their own wins plus the Heights\u2019 losses to add up to five, which is every game both clubs have left.',
      },
      {
        short: 'The card fits the phone it is on again',
        full:  'It was built before the section was redrawn at desktop scale and had kept fixed pixel widths around text that is now a quarter larger, so a column overflowed, a row wrapped onto two lines and \u201cvs BOS\u201d was cut to \u201cvs B\u201d. On a 320-pixel phone the club names had been squeezed out altogether. Every column now scales with the text, including at the Large text setting, and the record column steps aside on a phone since the table directly above it carries the same four records.',
      },
    ],
  },
  {
    version: '1.58.0',
    date:    '2026-08-31',
    title:   'The WPBL section is drawn at its real size on a desktop',
    changes: [
      {
        short: 'More fits on a desktop screen, at a normal text size',
        full:  'The section used to be drawn by magnifying the phone layout 40%, which made everything bigger including the margins. It is now laid out for the screen it is on: body text sits at 16px, the size most of the web reads at, and the space that frees up goes into content rather than padding. The scoreboard shows seven games where it showed six, and two more cards clear the fold on the home page.',
      },
      {
        short: 'The toolbar no longer changes size when you switch leagues',
        full:  'The bar at the top was a different size on MLB than on WPBL, so flipping between them moved everything under it. It is now identical on both, and the row of tabs beneath it starts at the same place either way, so switching leagues moves nothing above the content.',
      },
      {
        short: 'Schedule, Standings and Teams are no longer stretched',
        full:  'Those three pages are lists, and their column had grown wider than the words in it: a club name on the left of a card with its record marooned at the far right, a schedule row with a gulf between the matchup and the time. The column is now sized against the type again. Home and the stats table keep their full width, because unlike a list they have somewhere to put it: another scoreboard game, more stat columns.',
      },
      {
        short: 'Large text can go further before anything clips',
        full:  'The Large text setting in Accessibility was capped at a modest step because the fixed-width numeric columns did not grow with the type and started cutting off two-digit ranks. Those columns now follow the text, so the setting has room to go further, and it still scales the type rather than reflowing the whole layout the way browser zoom does.',
      },
      {
        short: 'Switching leagues no longer blanks the page for a moment',
        full:  'Each league section is loaded on demand, so the first switch left a gap where the tabs had been. The other section is now fetched quietly in the background before you ask for it.',
      },
    ],
  },
  {
    version: '1.57.0',
    date:    '2026-08-31',
    title:   'The next game says a lot more, and home uses the screen it is on',
    changes: [
      {
        short: 'The next-game card now shows form and a season comparison',
        full:  'It had two clubs, two records and a countdown, and about a third of it was blank. It now carries each club\u2019s season as a run of dots, oldest on the left, green for a win and a red ring for a loss, with the current streak beside it once it reaches three. Under that are three bars comparing the two on runs per game, OPS and ERA, which is the same comparison Game Center draws for a game that has not been played, cut down to the three that matter. Between them they answer the two things anyone asks before a first pitch: how good are these clubs, and how are they going right now.',
      },
      {
        short: 'The bracket folds away on a phone, with its answer left showing',
        full:  'Road to the title was 709 pixels on a 375-pixel phone, 30% of the page, arriving more than halfway down. It now starts folded there, and the line under the title carries the headline the card exists to deliver, currently \u201cFirebells 75% to win it all\u201d, so a reader who never opens it still gets the answer. Opening it is remembered. On a wider screen it is unchanged and open, as before.',
      },
      {
        short: 'Home is a quarter shorter on a phone and uses the full width on a desktop',
        full:  'The phone page went from about 2,380 pixels to 1,870, a fifth shorter than it was even after adding the form strip and the season comparison. On a desktop the page had been capped at 1,008 pixels wide on every monitor, which left 216 pixels of empty margin on each side at 1440 and 456 at 1920; it now grows to 1,260, so the cards are wider, the leader names have room and the bracket is drawn at a size worth drawing.',
      },
      {
        short: 'The MVP race moves above the fold, and the four cards line up exactly',
        full:  'The cards were paired by how tall they happened to be rather than by what they are, which put the MVP race in the second row, starting 734 pixels down a 900-pixel screen. It is the one card here you cannot get from another tab, so it now leads the right-hand column beside the next game, with the leaders board below it. Both rows match to the pixel, with no card stretched to fill a gap.',
      },
      {
        short: 'The leaders board shows five names on a wide screen, three on a phone',
        full:  'Three names left the board 50 pixels short of the card beside it, and the difference was being spent as extra space between the names. Five fills the row on a desktop; a phone keeps three, because that page is the one that needs to get shorter rather than taller.',
      },
      {
        short: 'The scoreboard no longer opens on two bare numerals in the corner',
        full:  'The strip starts at the most recent result, and the game before that one was cut off at the left edge showing only its score column: a \u201c6\u201d over a \u201c10\u201d with no badge or club beside them, which read as something broken rather than as a hint that there is more to scroll. The soft edge over it is now measured against the card it has to cover instead of being a fixed 24 pixels, and it reaches the bottom of the strip, where a bright corner of that card used to sit below it.',
      },
      {
        short: 'The postseason odds moved into the empty half of the bracket',
        full:  'The two semifinal boxes stack to about twice the height of the single championship box, so the right-hand half of that card was blank above and below it while the title odds sat in a band of their own underneath the whole thing. They now sit beside the championship, which fills the gap and takes about 120 pixels off the card. The championship box stays exactly on centre, so the line joining it to the semifinals still points where it should.',
      },
    ],
  },
  {
    version: '1.55.1',
    date:    '2026-08-31',
    title:   'Player of the game now comes from the team that won',
    changes: [
      {
        short: 'The gold medal on a recap was sometimes going to the losing side',
        full:  'The star on a game recap was picked purely on the box-score line, with no regard for who won, so a big game in a defeat could outrank every player on the winning team. It read badly wherever it happened: \u201cFirebells walk off Heights\u201d followed by a Heights player credited as the one who led the way. It had happened in 5 of the season\u2019s first 25 decided games. The medal now goes to the best performance on the winning side, and the other standouts still appear beneath it, including a big line in a loss. Aug 30 is the case that prompted it: Andr\u00e9anne Leblanc hit a two-out walk-off grand slam to win it 11-9 and the card was crediting somebody else.',
      },
    ],
  },
  {
    version: '1.55.0',
    date:    '2026-08-30',
    title:   'When a game stalls, the page says whose silence it is',
    changes: [
      {
        short: 'A note when the league\u2019s feed stops publishing mid-game',
        full:  'On Aug 30 a game passed its first pitch and nothing moved. Our own mirror was polling every two minutes with no errors; the league\u2019s record had been frozen since thirty-five minutes before the game was due to start. Nothing on the page said so, so anyone who opened it was told by omission that this site was broken. There is now a note on the next-game card and in Game Center naming the source and the time of its last update, so you can see where the silence is rather than guess. It appears only once first pitch has passed, and it checks our own sync first: if we are the ones who have stopped, it says that instead, in the same place and the same words.',
      },
    ],
  },
  {
    version: '1.56.0',
    date:    '2026-08-30',
    title:   'A shorter home page, and the MVP race gets a proper slot',
    changes: [
      {
        short: 'The standings table is off the home page, where it was a second copy',
        full:  'Standings is a tab of its own, in the row that is on screen the whole time you are here, and the home page was redrawing it underneath in miniature. On a phone that was 224 pixels spent on the one card everybody already knows how to find, on a page that ran to three full screens. It is gone from home and unchanged where it lives.',
      },
      {
        short: 'The MVP race takes that place, and gets room to draw the race',
        full:  'On a wide screen it now sits beside the next game rather than below everything, in the column with the leaders, which is the other card making a claim about the season. On a phone it moves up above the leaders, out of the part of the page most readers never reached. It also lost about sixty pixels on the way: a shorter line under the title, tighter rows, and a one-line summary at the foot, because in that layout its height is paid for twice, once by itself and once by the card stretched to match it.',
      },
      {
        short: 'Leaders is back to a top three, and the cards line up',
        full:  'The four cards on a wide screen sit in two rows that share their heights, so the taller card in a row stretches the one beside it. The MVP race was paired with the next game, which is the shortest card there, and left a visible band of empty space in the middle of it. The leaders board moves up into that spot instead and drops back to three names, which is what it was before it was padded out to five to fill a gap in a pairing that no longer exists. Both rows now match to within a few pixels, and nothing had to be squeezed to get there.',
      },
      {
        short: 'The home page is a fifth shorter on a phone',
        full:  'Between the standings coming off, the countdown moving into the next-game header and the reminder row losing a line it did not need, the page went from about three screens to two and a half on a 375-pixel phone. Nothing was hidden behind a tap to get there.',
      },
    ],
  },
  {
    version: '1.54.0',
    date:    '2026-08-30',
    title:   'The MVP race, on one number a hitter and a pitcher can share',
    changes: [
      {
        short: 'An MVP race on the home page, with the season it took to get there',
        full:  'Nothing on the section said who is having the best season, because there was no single number a hitter and a pitcher could both be measured on. There is now: runs created at the plate plus runs saved on the mound, both priced against the league’s own run expectancy, which is the same table behind the Run value board. The card draws the top two and the whole season between them, so you can see the lead as it moves rather than only where it ended up. Both names open that player’s page.',
      },
      {
        short: 'Kelsie Whitmore leads it by counting both halves of what they do',
        full:  'Whitmore is second in the league in runs created at the plate and has saved four and a half more on the mound, and adding the two moves ahead of a hitter who leads on the batting board. That is the whole argument for the metric: a two-way player is undercounted by any leaderboard that only reads one side of the ball, and this is the first surface here that reads both. The card marks the player as two-way and shows the split, so the total is never a number you have to take on trust.',
      },
      {
        short: 'Run value now explains itself in one place, in three steps',
        full:  'Where these numbers come from was explained in two halves on two different boards, and neither half was whole: Run value showed the table of what every situation is worth, Findings showed one play worked through and the formula, and nothing on either said the other existed. It is one idea, so it is now one card on the Run value board, built in the order the idea is: every situation is already worth something before a pitch is thrown, a play is worth what it changed about that, and here is one real play from this season with the arithmetic line by line. The Findings card keeps its sixteen measurements and links across. It is still folded shut by default, because the players are what the board is for.',
      },
      {
        short: 'The next-game card gives a phone two lines back',
        full:  'The countdown to first pitch was a row of its own under the team names; it now sits beside the start time in the card’s own header line, where it reads as one fact in three parts instead of two. The reminder row underneath had a title and a line of explanation in every state, and in the ordinary ones that second line was telling you what the switch beside it already showed. It is one line now, and the explanation appears only when there is something the switch cannot say: notifications blocked, push unavailable, or a reader who needs to sign in first.',
      },
      {
        short: 'The worked example now adds up on screen',
        full:  'The three numbers in the example are rounded to a hundredth of a run and the total was rounded separately, so a reader who did the addition could land a hundredth away from the answer printed underneath it. On the one card whose whole job is being checkable, that is the worst place for it. The total is now the sum of the three numbers shown.',
      },
      {
        short: 'The lead changed hands on Aug 28, and the chart says so',
        full:  'Denae Benites led the race from the first game of the season through Aug 27. The card shades the margin between the two lines, so the day it pinched to nothing and crossed is the one thing you cannot miss on it, and the date is written under the chart rather than left to be read off an axis.',
      },
    ],
  },
  {
    version: '1.53.0',
    date:    '2026-08-29',
    title:   'A page for the league itself, and the working behind the numbers',
    changes: [
      {
        short: 'A page for the league itself, starting with where its players are from',
        full:  'Everything on this section is a game, a club or a player, so anything about the league as a whole had nowhere to live. /wpbl/league is that page, and it opens with the one fact about the WPBL that needs no season to be true: all 118 players and the towns they come from, by country. Sixty-four from the United States, eighteen from Canada, nine each from Mexico, Australia and Japan, four from South Korea, and one each from Venezuela, the United Kingdom, France, Puerto Rico and Curacao. The youngest player in the league is 18 and the oldest is 40. It is in the footer, and every name on it opens that player\u2019s page. Each country folds, and one press closes the lot if you would rather read the eleven totals on their own.',
      },
      {
        short: 'Reading, highlights and the archive moved off the home page',
        full:  'The home page carried three screens of reading, video and photography under everything else, and almost nobody got there: it was seen by 575 visitors and opened by 39. All three are about the league rather than about today\u2019s games, so they now live on the league page with the roster, and the home page carries one line pointing at them. The home page is shorter for it, which is the point.',
      },
      {
        short: 'The play-value card now shows its working, on a real play',
        full:  'The Findings board prices sixteen kinds of play in runs, and said nothing about where any of those numbers came from. Open \u201cHow this is worked out\u2019 under it and there is a real play from this season taken through the arithmetic: the inning it happened in, what the batter came up to, what was left behind, and the runs it put on the board, adding up to what that play was worth. The example is picked rather than written: it is always the play closest to the average for its kind, so the sum lands on the number in the row above it. Every figure on the card is measured from this league\u2019s own games.',
      },
      {
        short: 'The watch parties for all eleven postseason games are up on Discord',
        full:  'Every game of the bracket has a Discord event already, named for its slot (\u201cSemifinal A Game 1\u2019) rather than for clubs nobody knows yet, because an event is only worth having if you can RSVP to it in advance. Each one renames itself as the bracket fills in, follows a first pitch that moves, and disappears if a series is clinched before it is needed.',
      },
      {
        short: 'The per-7 ERA notice says how to switch back',
        full:  'Switching the pitching boards to a seven-inning ERA is a change you can undo, and the note that offers the switch now says where: Settings, any time. That note can be dismissed and eventually retires on its own, so a reader who had switched could otherwise be left on numbers that disagree with the official WPBL site with nothing on screen explaining why.',
      },
    ],
  },
  {
    version: '1.52.3',
    date:    '2026-08-27',
    title:   'Every stat the league sends is now on the boards',
    changes: [
      {
        short: 'Sixteen stats the feed reports and nothing here showed',
        full:  'The league publishes more on a box-score line than the stat boards were adding up, and the rest was quietly discarded on the way in: it looked exactly like a stat the league does not report. Hitting gains caught stealing (a steal total on its own cannot say whether the running worked, in a league that runs this much), total bases, hit by pitch, grounded into a double play, and both sacrifices. Pitching gains batters faced, pitches, games started, hit batters, wild pitches, balks, strikeouts per walk, and the share of pitches thrown for strikes, plus strikeouts per nine innings, which the site had been working out all season and showing nowhere. Player pages carry the same additions, and the ones that would be a column of zeroes for most players appear only once they have happened.',
      },
    ],
  },
  {
    version: '1.52.2',
    date:    '2026-08-27',
    title:   'Leaderboards count trips to the plate, not at-bats',
    changes: [
      {
        short: 'A walk now counts toward qualifying for a rate title',
        full:  'To appear on a leaderboard for a rate stat like OPS you have to have played enough, and the bar for that was counting at-bats. An at-bat is not a trip to the plate: it leaves out every walk. So a hitter who had been to the plate 24 times and walked in 5 of them counted as less of a regular than one who had been up 20 times and never walked, which is backwards, and it is exactly the wrong way round for OPS, half of which is on-base percentage. The bar is plate appearances now, set at the same share of a full-time job that Major League Baseball uses, adjusted for a seven-inning game. Three players join the OPS board and one drops off it: the one who dropped had not walked once all season.',
      },
    ],
  },
  {
    version: '1.52.1',
    date:    '2026-08-27',
    title:   'One question, one answer: the Findings board',
    changes: [
      {
        short: 'A new Findings board on the Stats tab',
        full:  'The boards on the Stats tab are all ways of cutting the same numbers: by player, by team, by pitch. Findings is a different thing, one question and one answer per card, written to be read once rather than sorted. It opens with what every kind of play is worth in runs, and more will land there rather than as more tabs across the top.',
      },
      {
        short: 'All that stealing is not quite paying for itself, if you turn experimental features on',
        full:  'The WPBL runs constantly, about four attempts a game, and it works 82% of the time, which sounds like a lot. Whether it is worth doing is a different question, and it depends on what a base is worth against what an out costs. A stolen base moves a team about 0.12 of a run closer to scoring here; getting thrown out costs 0.76, because outs are the thing a team runs out of. In a league scoring fifteen a game, that trade has to come off 86 times in 100 just to break even, against roughly 72 in the majors, where runs are harder to come by. So the season\u2019s steals have earned 7.4 runs, the times caught have cost 9.9, and the running game has been worth about 2 runs less than nothing. The new card shows the two rates against each other, and names who is actually doing the running: Denae Benites is 11 for 11. It is behind the experimental features switch in Settings while it settles, since it is a verdict rather than a measurement and it rests on 13 caught stealings.',
      },
    ],
  },
  {
    version: '1.52.0',
    date:    '2026-08-27',
    title:   'Run value is on the Stats tab for everyone',
    changes: [
      {
        short: 'Run value now counts the innings that ended games',
        full:  'The table every run value is priced off was built from every half-inning except the one each game ended on, since an inning cut short by a walk-off cannot say what it would have gone on to be worth. That threw out the honest ones with the walk-offs, and it was not a fair sample of what it kept: a 7th inning ends a game only when the side batting failed to catch up, so the innings that scored stayed in and the innings that did not were dropped. The league has not had a walk-off yet, and the innings that really are cut short can be told from the rest by checking the play log against the published score. That same check turned up a game missing a run, and the league\u2019s own line score says which inning it is missing it from, so that one half-inning sits out and the rest of the game still counts. The bases-loaded-nobody-out cell reads 3.0 runs rather than 3.2, and every player total moved a little with it.',
      },
      {
        short: 'The Run value board no longer needs experimental features turned on',
        full:  'Every play leaves a team better or worse off than it was, and the Run value board prices that difference in runs: who has created and saved the most across the season, worked out from this league’s own games rather than from anyone else’s. It shipped behind the experimental features switch while the numbers settled, which meant the board most likely to be misread was being shown only to the readers least likely to misread it. It is the fifth board on the Stats tab now, next to Pitch by pitch, for anyone who opens it. The line above the table is the part that matters on arrival: every figure there is “runs” in a sense nobody uses at the ballpark, so +19.0 is not runs scored.',
      },
    ],
  },
  {
    version: '1.51.1',
    date:    '2026-08-26',
    title:   'Every page now says what it is',
    changes: [
      {
        short: 'A player page is headed by the player, not by the league',
        full:  'Player pages, team pages and game pages are drawn over whichever tab you opened them from, and the heading of that tab was still the heading of the page: every player page announced itself as “Women’s Pro Baseball League”, and the player’s own name was not a heading at all. That is what a screen reader reads out on arrival and what a search engine reads first. Each of those pages now carries its own name, and Game Center has one for the first time, matching the score line in its title.',
      },
      {
        short: 'Shared game recaps link straight to the game',
        full:  'The Bluesky and Discord posts for a finished game pointed at the old address, which now only reaches the game through a redirect. They point at the game’s own page, so the link says the final score and the date before anyone opens it.',
      },
    ],
  },
  {
    version: '1.51.0',
    date:    '2026-08-26',
    title:   'Every player and every game now has a link you can actually use',
    changes: [
      {
        short: 'Player names are real links',
        full:  'Tapping a player name has always opened that player’s page, but it was not a link: there was no address behind it, so you could not open one in a new tab, copy its link, or reach it with a keyboard, and a search engine could not follow it at all. Every player name on the section is now a proper link to that player’s page. Same tap, same page, but middle-click and cmd-click work, Tab reaches them, and the pages can finally be found.',
      },
      {
        short: 'Games have their own page',
        full:  'A game now lives at its own address, /wpbl/games/2026-08-23-queens-at-hunters, so you can paste a link to a recap and it says what it is before anyone opens it. Every card on the schedule is a link to one. Sharing a game unfurls with the final score and the date instead of the site’s generic card, and old links carrying ?game= still work, they just move to the new address.',
      },
      {
        short: 'A link to the full player list, in the footer',
        full:  'The page listing every player in the league was reachable only if you already knew its address. It is in the footer now, on every WPBL page, as “WPBL players”.',
      },
      {
        short: 'Bluesky mention alerts got quieter',
        full:  'The private Discord digest of who is talking about the site used to unfurl every Bluesky post it linked, so five mentions arrived as five copies of those posts with the actual list pushed off the top. The links no longer expand, and the headings are no longer shouted in bold.',
      },
    ],
  },
  {
    version: '1.50.0',
    date:    '2026-08-26',
    title:   'WPBL ERA now matches the league, with a setting to change it back',
    changes: [
      {
        short: 'ERA is per nine innings, the same as the official WPBL site',
        full:  'A WPBL game is seven innings, so this site divided ERA by seven, which is what NCAA softball, high school baseball and every other seven-inning competition does. The league itself divides by nine, and so does everyone who reprints its numbers, which meant a pitcher could read 2.58 here and 3.32 on the league site with nothing to explain the gap. ERA and the strikeout rate now match the league. Nothing about who leads the league has changed: every pitcher moved by the same proportion, so the order of every leaderboard is exactly what it was.',
      },
      {
        short: 'You can switch back to per seven innings',
        full:  'Settings, under App, has a WPBL ERA basis choice. Per 9 matches the league and is the default; per 7 is the honest per-game rate, since a WPBL pitcher is never throwing those last two innings. The choice follows you across the Stats board, team pages, player pages and the game comparison card, and the strikeout column renames itself K/7 or K/9 to match. Shared links and the Discord bot always use the league\u2019s per 9, since whoever is reading those never chose anything.',
      },
      {
        short: 'The stats boards stop repeating their own name back at you',
        full:  'The Run value and Pitch by pitch boards each carried a heading naming the board a second time, in different words, directly under the tab that already named it. Both are gone; the sentence explaining what the numbers mean stays. The rule under the Hitting/Pitching switch has gone with them: it was meant to appear only once the bar was pinned and something was scrolling under it, and had been showing permanently since the page gained its own title.',
      },
      {
        short: 'The stats page lines up on a desktop, and stops leaking as you scroll',
        full:  'Two things on /wpbl/stats. Its heading sat in the narrower column every other page uses while everything under it ran wider, so on a desktop it started about 120 pixels right of the board it was the title of; it lines up with the board now. And on a desktop the control bar was pinning 27 pixels below the toolbar rather than against it, so scrolling showed a band of the page sliding through the gap between them. The two edges meet.',
      },
      {
        short: 'A note on the pitching board says what changed',
        full:  'The first time you open the pitching stats after this, one line above the board explains the change and offers the switch, so a number that moved overnight is not left to be discovered. Dismiss it and it stays dismissed. If you do pick per 7, the foot of the board says so from then on, since your ERA no longer matches the one the league publishes.',
      },
    ],
  },
]
