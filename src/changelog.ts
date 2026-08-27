// The site changelog, newest first. Split out of ./version.ts so it stays out of the entry
// chunk. See the note there. Loaded on demand when the "What's New" dialog opens.
import type { ChangelogEntry } from './version'

export const CHANGELOG: ChangelogEntry[] = [
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
        full:  'Tapping a player name has always opened her page, but it was not a link: there was no address behind it, so you could not open one in a new tab, copy its link, or reach it with a keyboard, and a search engine could not follow it at all. Every player name on the section is now a proper link to her page. Same tap, same page, but middle-click and cmd-click work, Tab reaches them, and the pages can finally be found.',
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
        short: 'Less chrome above the stats boards',
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
  {
    version: '1.49.0',
    date:    '2026-08-26',
    title:   'The player page, and everywhere a club name should have been a link',
    changes: [
      {
        short: 'A player page uses the whole screen on a desktop',
        full:  'The player page was built for a phone and a desktop got that same narrow column: about a third of it visible at a time in a 640px panel, with most of a screen empty either side. On a wide screen it now opens wider and reads as two columns, her season on the left and the games it came out of on the right, with the headline pair moved onto the band that carries her name and club colours. Same numbers, roughly half the scrolling, and nothing about the phone layout changed.',
      },
      {
        short: 'Any game in a player\u2019s log opens from the log',
        full:  'The game log lists every game she has played and, until now, was the one place on the site that named a game you could not open. Tap a row and that game opens on its Game Center, and going back returns you to her page. The log also leads with the most recent game rather than the oldest, which matters more the longer the season gets, and on a wide screen it keeps to a fixed height and scrolls itself with the column headings pinned.',
      },
      {
        short: 'The game log says where she played, and marks her best game in each column',
        full:  'A new POS column gives the position she actually played that day, taken from that game\u2019s box score rather than from her roster listing. Kylee Lahners is filed at third base and the column is what shows she has DH\u2019d six times, played first twice, and moved from one to the other in the opener. The best value in each column is picked out in her club\u2019s colour, for the columns where more is genuinely better: runs, hits, doubles, triples, home runs, RBI, steals and total bases, or innings and strikeouts for a pitcher. Strikeouts at the plate and the hits a pitcher gave up are never marked, and neither is a column where nothing stands out.',
      },
      {
        short: 'Team names open the club, everywhere a game is shown',
        full:  'The club names in Game Center are links now: the two names at the top of a game that has not been played, the team rows in a finished or live box score, and the two badges on the season comparison card. Going back from a club page returns you to the game. The score itself is deliberately not part of the link, since that is where a thumb rests while reading a live game.',
      },
      {
        short: 'Clearer credit for the writing in the Reading rail',
        full:  'The articles on Home are written by mary mustard for her own Substack, towards a more perfect game, and this site only links to them. That was not saying itself clearly enough: the card carried her masthead as though it were ours and printed her own bio in the first person with nothing in front of it, and readers were coming away thinking she writes this site. The credit now says "Written by" before her name, keeps her description in quotation marks as the words of hers that they are, and names her Substack as hers. She keeps the full credit; it just says whose it is.',
      },
      {
        short: 'Club colours carry further across a player\u2019s name band',
        full:  'The colour band behind a player\u2019s name held its club\u2019s near-black primary for most of its width and reached only a hint of the club\u2019s actual hue at one corner, which on Los Angeles and New York left it reading as black. Each club now carries as much of its own colour as its text can stand: Boston\u2019s orange and San Francisco\u2019s red much further across, Los Angeles gold rather than black. The smallest lines on the band were lifted to match, so every one of them still reads on every club.',
      },
    ],
  },
  {
    version: '1.48.1',
    date:    '2026-08-23',
    title:   'Win probability, in every recap',
    changes: [
      {
        short: 'Every finished game now opens with the shape of the game',
        full:  'The Recap tab of a finished game starts with a win probability graph: one line across the whole game, each club holding the share of it their chances were worth at the time. It is worked out from this league’s own play-by-play rather than borrowed from somewhere else, so it prices a WPBL situation by how the WPBL actually scores. It reads the situation only, which the ⓘ beside it says out loud: who is pitching, who is at the plate, and how the two clubs have played all season are invisible to it.',
      },
      {
        short: 'The highlight reel moved to the end of the recap',
        full:  'Game Center opened with the line score, the highlight reel and the tab row all pinned above the tabs, which on a phone was more than half the screen before a single tab had drawn anything. The reel is at the foot of the Recap tab now, which is a good place to find it once you have read what happened, and the tabs themselves are about 90px taller everywhere as a result. A finished game the league has not posted a box score for still shows its video, since that game has no recap to put it at the end of.',
      },
      {
        short: 'The win probability card always names the play',
        full:  'The line above the graph used to go blank of plays in a one-sided game: where nothing had swung it, it said so and left it there, which is a non-answer in the most useful part of the card. It now always names a moment, and the label says what that moment is worth: the swing of the game where one play really did turn it, the biggest moment where the game was never in doubt. It reads the same three lines whether you are holding the graph or not, so a finger landing on it moves a readout that is already there: the inning, the two clubs’ chances, the play, and the score it left.',
      },
      {
        short: 'Hold the win probability graph to read any moment of the game',
        full:  'The graph in a game’s recap shows how the game swung, and now it will tell you what did the swinging. Press and hold anywhere on it and the line above it changes to that moment: which half of which inning, how many were out, what the two clubs’ chances were before and after, and the play itself. Slide your finger along the graph to walk through the game, and lift it to go back to the summary. The reading sits above the graph rather than below it, so it is on screen without scrolling and your finger is not on top of it. It works the same way with a mouse by hovering, and with the arrow keys once the graph is selected.',
      },
    ],
  },
  {
    version: '1.48.0',
    date:    '2026-08-23',
    title:   'The Stats tab, rebuilt for a phone',
    changes: [
      {
        short: 'Stats is a ranked list on a phone, not a sixteen-column table',
        full:  'The stats table is sixteen columns wide, and on a phone four of them fit at a time, so the one thing anyone comes to a stats page to do, rank the league by a stat, meant scrolling sideways to find the column and tapping its header. On a phone it is now a list: one row per player, with the stat it is ranked by large on the right and three more under her name. A Sort control at the top says which stat that is and offers every one of them, each with its name written out, so you no longer have to know what SLG stands for to use it. The team filter and the qualified toggle moved into a Filters sheet beside it, which also explains what qualified means, since the bar moves as the season goes on. The list stops at ten with a tap for the rest, and the full table is one tap below that. Nothing changed on a desktop, where the table fits and comparing across columns is what a table is for.',
      },
      {
        short: 'The Stats boards are one row of tabs',
        full:  'Players, Teams, Pitch by pitch and Draft are a single row of tabs across the top of the tab, in the place the thing you are looking at should be named. They used to be pills mixed in with the filters, so a control that replaced the whole screen and a control that trimmed a list were drawn identically, and the side of the ball, which applies to all of them, sat above and looked more important. Draft value in particular was a card pinned under the bottom of two different boards; it is a destination like the others now.',
      },
      {
        short: 'Plate appearances, on the table and under each name',
        full:  'How much a hitter has played is a column of its own now, rather than something to work out from at-bats, which drop every walk, or from games, which count a pinch-hitter\'s single swing as a full day. It is also what the phone list puts under a name whenever the board is ranked by a rate, because .500 off nine trips to the plate and .500 off ninety are not the same claim.',
      },
      {
        short: 'A Run value board, if you turn experimental features on',
        full:  'Some moments in a game are worth more than others, and the league\u2019s play-by-play records enough to say how much. With the bases loaded and nobody out, a WPBL team goes on to score 3.2 more runs that inning on average; with two out and nobody on, 0.3. So every play can be priced by how far it moved between one situation and the next, and those add up: the board ranks who has created and saved the most runs across every trip to the plate. Beside the ranking, one play is worked through line by line, which is where the surprise lives: Kelsie Whitmore\u2019s grand slam on Aug 14 was worth 3.5 runs rather than four, because the bases were already loaded and the inning was already worth most of a run before the pitch. Every number is worked out from this league\u2019s own games, so it prices a WPBL play by how the WPBL actually scores: about fifteen runs a game across seven innings. It is behind the experimental features switch in Settings while it settles.',
      },
    ],
  },
  {
    version: '1.47.2',
    date:    '2026-08-22',
    title:   'One player, even after a trade',
    changes: [
      {
        short: 'A traded player keeps one page, one season and one set of numbers',
        full:  'The league’s stats feed gives a player a brand new id when she changes club, and says nothing that connects it to the old one. When Diana Ibarra moved from New York to Los Angeles she arrived here as a second, separate player: eight games under one name and one game under the other, neither of them her real season, and her own page answering “not found” because two people appeared to be claiming it. She is one player again, with all nine games, and the site now recognises a trade for what it is instead of meeting a stranger.',
      },
      {
        short: 'Her old club keeps the games she played there',
        full:  'A player who leaves does not take her first half of the season with her. Her game log names the right opponent for the games she played before the trade, her old club’s page still counts what she did for it, and the Hall of Firsts credits each milestone to the club she was actually playing for on the day. The only thing that changes when someone is traded is where she plays next.',
      },
    ],
  },
  {
    version: '1.47.1',
    date:    '2026-08-22',
    title:   'A real page when you lose signal',
    changes: [
      {
        short: 'Losing your connection now shows the site instead of a browser error',
        full:  'Opening a page with no connection used to hand you whatever your browser shows when it cannot reach a site, which on a phone is usually a dinosaur. There is a proper page for it now, in the site’s own colours and following your dark or light setting, which says you are offline and reloads itself the moment a connection comes back. It keeps the address you were opening, so trying again takes you to that page rather than dropping you at the home screen. Nothing about the site itself is stored on your device to make this work: pages are still fetched fresh every time, so you will never be handed yesterday’s scores as though they were today’s.',
      },
    ],
  },
  {
    version: '1.47.0',
    date:    '2026-08-21',
    title:   'Every pitch of every game, counted',
    changes: [
      {
        short: 'A new Pitch by pitch board on the Stats tab',
        full:  'The league’s feed records what every single pitch did, one letter at a time, and nothing here had ever read it. A new board on the Stats tab does. On the pitching side: how often a pitcher draws a swing and a miss, how often she throws a strike, and how often she finishes a hitter off once she has two strikes on her. On the hitting side: who makes the most contact, who makes a pitcher work the longest, and who survives with two strikes against her. Every board says what the league as a whole does too, so a number has something to be read against. It covers every pitch of every game played, which is the whole point of it: the Tracked board has radar for two games, this has all of them. At the top there is a breakdown of what those pitches actually did, from balls and called strikes through fouls and swings and misses to balls put in play, split by whether the batter offered at all.',
      },
      {
        short: 'The Tracked board is resting until the league posts more of it',
        full:  'The league published its TrackMan pitch tracking for the first two games of the season and then stopped. Two games of it sitting beside leaderboards built from every game invited a comparison that was not really there: the hardest hit ball of the season, on that board, was only ever the hardest of the two games anybody measured. So the Tracked button waits until there is enough tracking to be worth reading, and it comes back on its own the day the league starts posting again. Nothing has been deleted, and a link straight to it still opens it.',
      },
      {
        short: 'Leaderboard rows stop sticking as you scroll on a phone',
        full:  'Scrolling a leaderboard with a finger left whichever row you happened to start on highlighted for the rest of the scroll, as though you had selected it. That was a hover effect meant for a mouse pointer, on a screen that has no pointer to move away. It only happens on a device that can actually hover now.',
      },
    ],
  },
  {
    version: '1.46.3',
    date:    '2026-08-20',
    title:   'The live game says when it is between innings',
    changes: [
      {
        short: 'A break between innings now looks like a break',
        full:  'While a WPBL game is on, the live card on the home page and the banner at the top of the Game Center show the inning, the bases, the outs and the count. Between innings none of that is happening. The league’s feed does not have a way of saying so: the moment a side is retired it puts the next half-inning on the board and leaves it empty until the first pitch, which on Wednesday night was a wait of two minutes and forty-two seconds. Drawn literally that read as a game in play, with a batter standing in and a count on her, for the whole of every pitching change. The card now recognises an empty half-inning for what it is and says which break it is instead, like “End of the 4th”, putting the diamond, the outs, the count and the at-bat away until somebody is actually batting. The pulsing dot that marks the side at bat goes out with them, because between innings neither side is.',
      },
      {
        short: 'A playoff bracket on the home page, if you turn experimental features on',
        full:  'All four clubs go to the postseason, so what the last games decide is not who gets in but where everyone lands: the standings order sets the semifinals, first against fourth and second against third, and the winners meet for the title. A new card on the home page draws that, so who plays whom is something you can see rather than something you work out from a table. Until Sep 6 it is a projection and moves with the standings; from Sep 9 the same three boxes carry the real series, so you can watch a provisional bracket harden into the actual one. Every club on it opens that club’s page. It is behind the experimental features switch in Settings while it settles.',
      },
      {
        short: 'Games back is on the home page standings',
        full:  'The standings card on the home page showed wins, losses and run differential, which tells you the order but not how close it is. It now has a games back column, the same one the full Standings tab has had: a dash for whoever is top, and how far behind everyone else is. Half games show up as you would expect when two clubs have played a different number of games, which at the moment is the Queens sitting half a game behind the Firebells on one game in hand.',
      },
    ],
  },
  {
    version: '1.46.2',
    date:    '2026-08-20',
    title:   'Season stats stay season stats, and a way back into your account',
    changes: [
      {
        short: 'Playoff games will not be added to anyone’s season numbers',
        full:  'Last week the standings were fixed so the postseason could not change a club’s record. This is the other half of it: the stat pages. A batting average, an ERA, a home run count and every leaderboard on the site are the regular season only, and the seven to eleven playoff games that start on September 9 will be kept apart from them. Left alone it would have been unfair as well as wrong, because a club that reaches the final plays up to eight extra games while a club knocked out in the first round plays two, so the leaderboards would have quietly reordered themselves by how far a team went rather than by how anyone played. Game pages still show every game, including playoff games, and a player’s game log still lists all of them.',
      },
      {
        short: 'You can reset your password if you have forgotten it',
        full:  'There was no way back into an account with a forgotten password, short of asking. There is now a "Forgot password?" link on the sign in box: it emails you a link, and opening that link lets you choose a new password on the spot. It works for accounts made with Google too, which is how you would add a password to one. For your own safety the confirmation is worded the same whether or not that email address has an account here, so the form cannot be used by anyone else to find out who has signed up.',
      },
      {
        short: 'Confirming your email now tells you it worked',
        full:  'Clicking the confirmation link in a new account’s email did the right thing and then said nothing at all: the account was activated, you were signed in, and the page looked exactly like any other visit. It now says so. The same fix means a link that has expired or has already been used explains itself instead of leaving you on a page where apparently nothing happened.',
      },
      {
        short: 'A seeding race card, if you turn experimental features on',
        full:  'All four clubs go to the postseason, so the standings table has been showing a race for a place nobody can miss. What the last games actually decide is the order, because that sets the semifinals: first plays fourth and second plays third. A new card under the standings says so, with how far each club is clear of the one below, how many results it needs to lock its place, and who it would draw. It is behind the experimental features switch in Settings for now, since it is the first thing here that predicts rather than reports.',
      },
    ],
  },
  {
    version: '1.46.1',
    date:    '2026-08-19',
    title:   'Ready for the postseason',
    changes: [
      {
        short: 'Playoff games will not count in the standings',
        full:  'The postseason runs Sep 9 to Sep 22, and a playoff game is a real game with a real score. Until now every one of them would have been added to the regular season records, so a club that finished 3-4 could have been shown as 6-5, with run differential and streaks wrong to match. The standings, the head to head grid and the season series line on the home page now count the regular season only. The postseason will be kept separately.',
      },
      {
        short: 'Live scores use less of your data',
        full:  'While a game is in progress the site keeps it up to date two ways: a live connection that pushes each change as it happens, and a slower check behind it in case that connection drops. The slower check was running three times more often than it needed to and asking for the whole game record each time, neither of which made anything arrive sooner. Over a full game that is a few megabytes it no longer has to spend, which matters most on a phone.',
      },
    ],
  },
  {
    version: '1.46.0',
    date:    '2026-08-19',
    title:   'An archive of women’s baseball, and a home screen that fits together',
    changes: [
      {
        short: 'From the archive: freely licensed women’s baseball photography',
        full:  'A new archive of photographs of women’s baseball, drawn from Wikimedia Commons and refreshed weekly. It reaches back well before this league: the All-American Girls Professional Baseball League, the World Cup, and the players who came first. Every photograph names its creator and its licence and links back to the source, because a good share of them are licensed on the condition that you do. Each one has been looked at by a person before it appears here, since the categories they come from are maintained by the public and return whatever somebody happened to file.',
      },
      {
        short: 'Reading, highlights and the archive are one card now',
        full:  'The three were separate rails stacked down the left of the home screen, all doing the same job, and between them they ran the best part of three screens on a desktop while the other side of the page sat empty. They are now one card the full width of the page, and you pick which one you are looking at. A sideways strip is the one thing on that page that turns width into content, so the same height now shows five or six cards instead of three.',
      },
      {
        short: 'The next game card shows records and the season series',
        full:  'It used to be two team names and a time, which was less than anything else on the page. Each club now carries its record, and a line underneath says where the season series between the two stands. The countdown has moved out of the small chip in the corner and into the card proper, since the time to first pitch is the one thing that card knows and nothing else on the page does. The records come from the same place the standings table does, so the two can never disagree.',
      },
      {
        short: 'Leaders list five names, and batting and pitching share one card',
        full:  'The leader boards showed three names and now show five. Batting and pitching used to be two separate cards offering the same thing twice, and are now one card with a switch. Switching between them resets which statistic you are looking at, because home runs have no counterpart on the pitching side.',
      },
      {
        short: 'The cards on the home screen line up with each other',
        full:  'The two columns of cards each ended wherever their contents happened to run out, which left a ragged edge down the middle of the page and a notch above the card underneath. Cards side by side now share the same top and bottom, and whichever of the pair has room to spare gives it to its own contents rather than leaving a gap: the standings rows get taller, the leader rows spread out a little.',
      },
      {
        short: 'The Discord invite moved to the footer',
        full:  'The card inviting you to the fan server has been on the home screen for several weeks, which is long enough for anyone who wanted to join to have joined. The link is still there, in the WPBL footer next to the developer API link. Nothing was removed, it just stopped taking up room on the page.',
      },
    ],
  },
  {
    version: '1.45.2',
    date:    '2026-08-17',
    title:   'Head to head, on the Standings tab',
    changes: [
      {
        short: 'The head to head grid is on Standings too',
        full:  'The table tells you who is ahead. The grid underneath it now tells you of whom. It is the same four clubs in the same order, so you can carry a row straight down from one to the other, and in a four team league that is usually the thing worth knowing: a club can be unbeaten against two opponents and swept by the third, and a bare 4-3 hides all of it. On a wide screen each row spells the club out to match the table above; on a phone it stays initials so all four columns fit without scrolling sideways.',
      },
    ],
  },
  {
    version: '1.45.1',
    date:    '2026-08-17',
    title:   'A quiet dot on the Teams tab',
    changes: [
      {
        short: 'A small dot points at the rebuilt Teams tab',
        full:  'The Teams tab changed a lot in the last release, and there was nothing to tell anyone who had already learned to skip it. A small dot now sits on the tab until you open it, then goes for good. It disappears on its own at the end of August whether or not you ever tapped it, so it cannot outlive the thing it is pointing at.',
      },
    ],
  },
  {
    version: '1.45.0',
    date:    '2026-08-17',
    title:   'A Teams tab worth opening, and settings that know which league you follow',
    changes: [
      {
        short: 'The Teams tab shows records, form and the next game',
        full:  'The Teams tab used to be four cards carrying a badge and a name, which told you nothing you could not get from the home page. Each club now shows its record and win percentage, a five dot strip of its last five results, its run differential, and who it plays next and when. The four are listed in standings order. A win is a solid dot and a loss is a hollow ring, so the strip reads the same way whether or not you can tell the two colours apart.',
      },
      {
        short: 'A head to head grid on the Teams tab',
        full:  'Underneath the four cards is a grid of every club against every other. Read a row across and you get how that team has fared against each of the other three. In a four team league a bare 4-3 hides the shape of a record completely, since a club can be unbeaten against two opponents and swept by the third, and that is usually the thing worth knowing before the next meeting.',
      },
      {
        short: 'Team pages have a pinned header you can switch clubs from',
        full:  'A team page is thousands of pixels tall on a phone, and once you were into the roster nothing on screen said whose roster it was. The back link and the team name are now a small bar that stays at the top as you scroll, showing the club and its record, with the other three clubs beside it. Tapping one takes you straight to that team rather than sending you back out to the list first.',
      },
      {
        short: 'Settings are split by league',
        full:  'Settings showed a preferred team picker of thirty MLB clubs and two reminder switches for a prediction game, none of which mean anything if you only follow the WPBL. There is now a WPBL and MLB switch at the top, opening on whichever section you came from. The standing reminder for WPBL games, which until now lived only on a card on the WPBL home tab, is in Settings as well.',
      },
      {
        short: 'Text size and swipe settings, and less motion when you ask for it',
        full:  'A new accessibility section can make the type larger without reflowing the layout the way browser zoom does, and can turn off swiping between tabs, which is worth having if a stray drag keeps moving you off the page you were reading. Separately, the whole site now respects the reduce motion setting in your operating system, so animations and smooth scrolling stop without your having to find a switch here.',
      },
      {
        short: 'Colours that were too faint to read have been fixed',
        full:  'Several colours were measured against the background they actually sit on and failed the contrast standard, almost all of them in light mode. Muted text used for table headings, position codes and captions was the worst of them, along with the blue used for links and the active tab, the medal colours on the leaderboards, the green and red on run differentials, and three of the four team colours where they appear as small text. All have been darkened enough to pass while keeping the same hue.',
      },
    ],
  },
  {
    version: '1.44.1',
    date:    '2026-08-17',
    title:   'Left on base, on the team stats table',
    changes: [
      {
        short: 'Team stats show runners left on base',
        full:  'The team hitting table has a Left On Base column. It uses the league\u2019s own per-game totals rather than adding up the individual batting lines, because a batter\u2019s left-on-base counts every runner who happened to be aboard when she came up, and adding those together counts the same stranded runner several times over. Worth reading alongside the rest of the row rather than on its own: a club that puts fewer runners on base has fewer runners to leave there, so a low number is not automatically a good one.',
      },
    ],
  },
  {
    version: '1.44.0',
    date:    '2026-08-16',
    title:   'Swipe through a game, and cards that use the whole screen',
    changes: [
      {
        short: 'Swipe between the tabs of a WPBL game',
        full:  'Opening a WPBL game and moving between its Recap, Box Score, Play-by-Play and Pitch Data used to mean tapping the tab you wanted. On a phone you can now swipe left and right between them, the same way you already move between the tabs of the section itself. Each tab keeps its own scroll position, so going back to the play log returns you to the inning you were reading rather than the top.',
      },
      {
        short: 'The lineup and pitching history cards fill the screen on a desktop',
        full:  'Both cards on a team page were laid out for a phone and kept that narrow shape on a big screen, leaving half the card empty. They now spread across the whole width, and show up to twelve games instead of six as the season gives them more to show.',
      },
      {
        short: 'Long names in those cards are shortened, not cut off',
        full:  'A name too long for the column was being cut mid-word, so "Suzuka Yamamoto" read as "Suzuka Yam". Names now shorten to a first initial and surname, and only when the column really cannot hold the whole thing.',
      },
      {
        short: 'The scoreboard says when a finished game was played',
        full:  'A finished game on the home scoreboard said only "Final", so a strip covering the whole season gave no clue which day you were looking at. It now reads Final followed by the day, as Today, Yesterday, or the date.',
      },
      {
        short: 'Stars of the game keep their full stat line',
        full:  'In a game recap, the stat line under each of the three standout players could be cut short even when there was unused space beside it. The three now share the full width of the card between them, and a line that still will not fit runs onto a second line rather than being cut.',
      },
    ],
  },
  {
    version: '1.43.0',
    date:    '2026-08-16',
    title:   'A play-by-play you can actually skim',
    changes: [
      {
        short: 'Play-by-play is shorter and reads the same way every time',
        full:  'Each play used to be printed as the feed sends it: one long sentence with the batter, the count and every runner\u2019s movement run together, so the thing you wanted was buried in the middle of it. The batter and what they did are now the line, with the runners on a quieter second line beneath and the count moved over beside the pitches where it lines up. Fielding detail that the box score already carries has been dropped, so a play takes about a quarter less reading.',
      },
      {
        short: 'Substitutions no longer look like plays',
        full:  'A player coming into the game is a roster change, not something that happened at the plate, and now reads as its own quiet line rather than sitting in the list with the same weight as a hit.',
      },
    ],
  },
  {
    version: '1.42.0',
    date:    '2026-08-16',
    title:   'Lineup and pitching history for every WPBL team, and a fix to who gets notified',
    changes: [
      {
        short: 'See how a manager has been filling out the lineup card',
        full:  'A WPBL team page now shows the last six lineups as a grid: one row per player, one column per game, each cell giving their position and where they hit. Every column is headed by the pitcher who started for the other side and whether they throw left or right, which is usually the reason a lineup changed shape. Substitutes are shown in italics so a regular starter is easy to pick out. On a phone the pitching grid shows five games before you have to scroll sideways and the lineup grid four, up from under three each.',
      },
      {
        short: 'See who has been pitching, and who should be rested',
        full:  'Alongside the lineup grid, a pitching usage grid shows every appearance over the last six games with the pitch count and innings for each, and the total each pitcher has thrown across the window. Anyone who came back on one day of rest or less is flagged, because that is the thing a season ERA cannot tell you.',
      },
      {
        short: 'One switch for reminders before every WPBL game',
        full:  'The reminder switch on the next game card used to cover only that one game, so getting a heads-up before the next one meant coming back and turning it on again. It is now a standing setting: turn it on once and you get a push 30 minutes before every WPBL game. Reminders anyone had already set for a specific game still arrive.',
      },
      {
        short: 'Pick reminders now only go to people who asked for them',
        full:  'The daily reminder to make your MLB picks was going to everyone who had ever turned on notifications, including WPBL fans who only wanted a heads up before a game. It is now a separate setting that is off unless you turn it on, and switching it off no longer cancels your other reminders.',
      },
      {
        short: 'Wording no longer assumes a player\u2019s pronouns',
        full:  'Text across the site referred to players as she or her. It now says they or their throughout.',
      },
      {
        short: 'The notifications panel fits the screen on a phone',
        full:  'Opening the bell on a phone put the panel partly off the left of the screen, so its heading read "FICATIONS" and the text ran off the edge. It is now a panel that fits the width of the screen with an even margin each side. The dismiss cross is a proper size to tap, and dismissing one no longer opens it by mistake.',
      },
      {
        short: 'A team page tells you more, in less space',
        full:  'The results card shows the last few games and the next couple rather than the whole season, with the full schedule one tap away in a popup. Under the record there is now each opponent and your record against them. Team stats gained innings pitched, strikeouts per seven innings and a strikeout to walk ratio in place of the win and loss counts, which only repeated the record above.',
      },
      {
        short: 'Jump from a team straight to the stat tables',
        full:  'A team page can now open the stats tab on the four team comparison, or on the full player table already narrowed to that team.',
      },
      {
        short: 'Getting back to all four teams actually works',
        full:  'Opening a team from the stats table used to leave no way back to the list of all four teams. There is now an All teams link on every team page, and tapping the Teams tab when you are already on it returns to the list.',
      },
      {
        short: 'The team stats table fits a phone',
        full:  'Comparing the four teams on a phone used to cut their names off after a few letters. It now shows each nickname in full and two more stat columns at once.',
      },
      {
        short: 'The site can be used without a mouse',
        full:  'Rows, filters and links across the WPBL section can now be reached with the tab key and activated with enter or space, and show a focus outline while you move through them.',
      },
    ],
  },
  {
    version: '1.41.0',
    date:    '2026-08-15',
    title:   'Look up a player from Discord, and a box score that fits a phone',
    changes: [
      {
        short: 'Ask the WPBL fan Discord for any player\'s stats',
        full:  'Typing /player in the fan Discord, followed by a name, replies with that player\'s season. It suggests names as you type, and it is forgiving about how you type them: part of a name, either name on its own, an initial and a surname, or a misspelling all find the right player, and accents can be left off.',
      },
      {
        short: 'The whole box score fits on a phone',
        full:  'A WPBL box score on a phone used to hide doubles and stolen bases from the batting line, and the pitching line could only be read by scrolling sideways. Both now show every column on the screen at once. Names are shortened to fit rather than being cut off mid-word.',
      },
    ],
  },
  {
    version: '1.40.0',
    date:    '2026-08-14',
    title:   'A WPBL draft tab, shareable player cards, and a fuller scoreboard',
    changes: [
      {
        short: 'See whether early draft picks are actually doing better',
        full:  'A new Draft tab under WPBL stats plots every drafted player\'s season against where they were taken, with each round\'s average drawn over the top. So far there is no real pattern either way. Each round average is labelled with how many players it covers, because the later rounds rest on one or two players and move a long way on a single good night.',
      },
      {
        short: 'Copy a link to a WPBL player',
        full:  'A player page now has a copy link button in its header, so a player card can be shared without fishing the address out of the address bar. The link previews as that player when it is pasted into a chat app.',
      },
      {
        short: 'Game highlights post to the WPBL fan Discord',
        full:  'When the league puts a game\'s highlight reel on YouTube, it is posted to the highlights channel in the fan Discord as a playable video. Each reel is posted once.',
      },
      {
        short: 'The scoreboard carries the whole season',
        full:  'The scoreboard strip on the WPBL home page used to stop seven games ahead. It now runs to the end of the season, and still opens on the boundary between the last game played and the next one up, without the jump it used to make while the page was loading.',
      },
      {
        short: 'A player\'s game log is in date order',
        full:  'The per-game log on a WPBL player page was listing games in whatever order they came back from the league feed. It now reads oldest game first.',
      },
      {
        short: 'Watch party links in Discord work again',
        full:  'The links from the WPBL watch party board in the fan Discord had stopped working, because the invite they were built on expired. They have been rebuilt on an invite that does not expire.',
      },
    ],
  },
  {
    version: '1.39.0',
    date:    '2026-08-13',
    title:   'Shareable WPBL links and Discord box scores',
    changes: [
      {
        short: 'Sharing a WPBL player link now shows who it is',
        full:  'Pasting a link to a WPBL player into a chat app now previews their name, position, club, season line, and headshot, instead of a card for the site in general. The preview is built when the link is opened, so it stays current as the season goes on.',
      },
      {
        short: 'Box scores post to the WPBL fan Discord',
        full:  'When a WPBL game goes final, its box score is posted to the fan Discord on its own: the headline, a short account of the game, the line score, the winning and losing pitchers, and the three standout players. If the league corrects the stats afterwards, the post is updated in place.',
      },
      {
        short: 'Every WPBL game has its own link',
        full:  'Opening a WPBL game now puts that game in the address bar, so the link can be copied and sent to someone. A finished game opens straight on its recap.',
      },
      {
        short: 'Longer names fit in a game recap',
        full:  'The three stars of the game in a WPBL recap no longer have their names cut off. A name that will not fit is shortened to a first initial and surname, and each name gets as much of the room as the other two leave it.',
      },
    ],
  },
  {
    version: '1.38.0',
    date:    '2026-08-12',
    title:   'WPBL game recaps',
    changes: [
      {
        short: 'Every finished WPBL game now has a recap',
        full:  'Opening a finished WPBL game now leads with a Recap tab: a headline, a short account of how the game unfolded, the standout hitters and pitchers, the winning, losing, and save decisions, and the runs-hits-errors line, all built from the box score and play log.',
      },
      {
        short: 'Recap wording fits how the WPBL is scoring',
        full:  'The words a recap uses, like a rout, a tight game, or a slugfest, are set from how the WPBL itself has been scoring rather than fixed major-league thresholds, so they stay accurate for the league as the short season fills in.',
      },
      {
        short: 'Last Game card on the WPBL home page',
        full:  'The WPBL home page now has a Last Game card with the final score, the recap headline and summary, and the game\'s top player, with a link to the full recap.',
      },
      {
        short: 'Play-by-play innings start collapsed',
        full:  'A WPBL game\'s Play-by-Play tab now opens with every half-inning collapsed, so you can scan the innings and open just the ones you want. The game window also sizes down to fit a shorter tab instead of always filling the height of the screen.',
      },
    ],
  },
  {
    version: '1.37.1',
    date:    '2026-08-10',
    title:   'WPBL schedule polish',
    changes: [
      {
        short: 'The WPBL schedule marks the winner',
        full:  'A finished game on the WPBL Schedule tab now marks the winning team with an arrow in the team color, keeps the winner\'s name and score bold, and softens the loser\'s, so you can read the result at a glance.',
      },
      {
        short: 'Home and away shown on the WPBL schedule',
        full:  'Each game on the WPBL Schedule tab now marks the home team with an "@" in front of its name, so it is clear which side is home and which is away.',
      },
      {
        short: 'Records on upcoming WPBL games',
        full:  'An upcoming game on the WPBL Schedule tab now shows each team\'s season record next to its name, in place of the score that a finished game would show.',
      },
      {
        short: 'Today and Tomorrow on the WPBL schedule',
        full:  'The date headings on the WPBL Schedule tab now read Today, Tomorrow, or Yesterday for the nearby days, with the date kept alongside, and finished games sit on a slightly muted card so past and upcoming read apart.',
      },
      {
        short: 'Full team names in the WPBL standings on a phone',
        full:  'The team names in the WPBL Standings tab no longer get cut off on a phone. The full name shows where there is room, and the shorter nickname shows when the stat columns need the space.',
      },
      {
        short: 'Steadier tab bar when swiping WPBL tabs',
        full:  'The tab bar at the top of the WPBL section no longer jumps up and down when you swipe between tabs that are scrolled to different spots. It now holds still while each tab keeps its own place.',
      },
    ],
  },
  {
    version: '1.37.0',
    date:    '2026-08-10',
    title:   'A corrected ERA and a WPBL home refresh',
    changes: [
      {
        short: 'WPBL ERA is now figured over seven innings',
        full:  'A WPBL pitcher\'s ERA is now calculated over seven innings, to match the league\'s seven-inning games, instead of the nine used in the major leagues. This lowers the ERA figures shown across the WPBL stats, leaders, and player pages.',
      },
      {
        short: 'Clearer scoreboard on the WPBL home page',
        full:  'The scoreboard strip on the WPBL home page now shows bigger, bolder scores with the winning team marked, opens with the most recent final in full view, and softly fades its edges to show there are more games to swipe through.',
      },
      {
        short: 'Ballpark tracking hides when its data falls behind',
        full:  'The Ballpark tracking card on the WPBL home page now hides itself when the league has not posted radar data for the more recent games, instead of showing stale season bests. It returns on its own once fresh tracking data lands.',
      },
      {
        short: 'Tidier WPBL home page layout',
        full:  'The WPBL home page got a light tidy-up: the section headings now share one style, the cards sit a little closer together, and the league name and team badges lay out more cleanly on a phone.',
      },
      {
        short: 'Account menu opens in front on mobile',
        full:  'On a phone, the account menu in the top right now opens in front of the page instead of slipping behind the content below it.',
      },
      {
        short: 'Matching toolbar icons',
        full:  'The icons in the top bar, like the notification bell and the light and dark mode toggle, now match each other in size and weight instead of looking slightly mismatched.',
      },
    ],
  },
  {
    version: '1.36.0',
    date:    '2026-08-10',
    title:   'Swipe between WPBL tabs, and box-score cleanups',
    changes: [
      {
        short: 'Swipe left and right between WPBL tabs on a phone',
        full:  'On a phone you can now swipe left and right to move between the WPBL tabs (Home, Schedule, Standings, and so on). The view follows your finger as you drag, and settles onto the next or previous tab when you let go.',
      },
      {
        short: 'Box scores drop pitchers who did not bat',
        full:  'A WPBL box score no longer lists pitchers who never came to bat as empty all-zero rows. Pitchers who did bat, and two-way players, still appear.',
      },
      {
        short: 'Substitutes are marked in the box score',
        full:  'Pinch hitters, pinch runners, and other substitutes in a WPBL box score are now indented under the starter they replaced and marked, so it is clear who came off the bench.',
      },
      {
        short: 'Run differential in the standings',
        full:  'The WPBL standings now include a run differential (DIFF) column, the runs a team has scored minus the runs it has allowed.',
      },
      {
        short: 'Schedule opens at the next game',
        full:  'Opening the WPBL Schedule tab now jumps to the next upcoming game, with the just-played games right above it, instead of starting at the season opener.',
      },
      {
        short: 'Smaller next-game countdown',
        full:  'The countdown to the next WPBL game now sits compactly in the top corner of the Next game card instead of a tall block of digits, so the card takes less space.',
      },
    ],
  },
  {
    version: '1.35.0',
    date:    '2026-08-10',
    title:   'Smoother loading, and no dark-mode flash',
    changes: [
      {
        short: 'Dark mode no longer flashes light when the page loads',
        full:  'If you use dark mode, the page now opens straight into dark instead of showing a flash of the light theme for a moment while the app starts up.',
      },
      {
        short: 'Placeholders while the WPBL home page loads',
        full:  'The WPBL section now shows placeholder blocks shaped like the real content while the scores, standings, leaders, and tracking data load, so the page no longer jumps around as each piece fills in.',
      },
    ],
  },
  {
    version: '1.34.0',
    date:    '2026-08-09',
    title:   'WPBL fan Discord, and cleaner box scores on mobile',
    changes: [
      {
        short: 'Join the WPBL fan Discord from the home page',
        full:  'The WPBL home page now has an invite to the WPBL fan Discord for live game chats and more. It sits above the next-game card, and you can dismiss it with the X if you are not interested, in which case it stays hidden.',
      },
      {
        short: 'WPBL box scores fit the screen on a phone',
        full:  'A WPBL game\'s box score no longer runs off the side of a phone screen. The batting table now shows the key columns (at bats, runs, hits, RBI, walks, strikeouts, home runs) without a sideways scroll, and the full set including doubles and steals still shows on a wider screen.',
      },
      {
        short: 'Team switcher no longer wraps in a box score',
        full:  'In a WPBL box score, the button to switch between the two teams now shows the team nickname on a phone so the two teams sit on one line instead of wrapping, with the full city and name kept on desktop.',
      },
    ],
  },
  {
    version: '1.33.0',
    date:    '2026-08-09',
    title:   'WPBL by default, plus stats and box-score fixes',
    changes: [
      {
        short: 'The site now opens on the WPBL section',
        full:  'Loading sportydolphin.fun without a specific section now takes you to the Women\'s Pro Baseball League instead of MLB. MLB is still one tap away with the MLB | WPBL toggle at the top.',
      },
      {
        short: 'Add to your home screen as "sportydolphin"',
        full:  'When you save the site to your phone\'s home screen, the app is now named "sportydolphin" instead of "MLB Picks".',
      },
      {
        short: 'Innings pitched added to WPBL pitching leaders',
        full:  'The Pitching Leaders card on the WPBL home page now includes an Innings leader, alongside ERA and strikeouts, ranked by most innings pitched.',
      },
      {
        short: 'The page no longer scrolls behind a WPBL box score',
        full:  'While a WPBL box score, game center, or player page is open, the page behind it now stays put instead of scrolling, so scrolling moves the open card and not the background.',
      },
      {
        short: 'Highlighted stat no longer overlaps the player name',
        full:  'On the MLB stats table, when a player and stat are highlighted, the highlight ring now stays behind the sticky player-name column instead of showing over the name when the table is scrolled sideways.',
      },
    ],
  },
  {
    version: '1.32.0',
    date:    '2026-08-09',
    title:   'Pitch location maps, and a smarter home page',
    changes: [
      {
        short: 'See where a WPBL pitcher put every pitch',
        full:  'A WPBL pitcher\'s page now maps where their tracked pitches crossed the plate, on a strike zone colored by pitch type, plus a separate mini map for each pitch, fastball, slider, curveball, and so on, with how many they threw and its average velocity.',
      },
      {
        short: 'The home page flags new pitch-tracking data',
        full:  'When the league posts a fresh batch of pitch tracking, the WPBL home page now shows a banner pointing you to the tracking section, so you know the moment new velocity, spin, and exit-velocity data has landed.',
      },
      {
        short: 'The home scoreboard opens at the latest games',
        full:  'The scoreboard strip on the WPBL home page now opens scrolled to the most recent and upcoming games, instead of starting at the oldest final, so the games that matter now are front and center.',
      },
      {
        short: 'Clearer note on what pitch tracking is missing',
        full:  'The WPBL tracking section now explains up front that the in-park radar cannot fully track balls hit out of the field, so home runs, often the hardest and longest hits, are usually missing from the leaderboards rather than being an error.',
      },
    ],
  },
  {
    version: '1.31.0',
    date:    '2026-08-06',
    title:   'Clearer WPBL box scores, pitch data, and rosters',
    changes: [
      {
        short: 'WPBL box scores are easier to read on a phone',
        full:  'In a WPBL game\'s box score, the batting columns now lead with the most useful stats, so you see at bats, runs, hits, RBI, walks, and strikeouts before the extras. The player names also stay in place when you scroll the stats sideways, so you can always tell whose line you are reading.',
      },
      {
        short: 'Pitch Data leads with the game\'s highlights',
        full:  'A WPBL game\'s Pitch Data tab now starts with the standout tracking moments of that game, the hardest pitch, the hardest hit, and the first hit, each with the player, above the full pitch by pitch detail.',
      },
      {
        short: 'WPBL rosters show the active roster',
        full:  'A WPBL team\'s roster now lists the players signed to the club plus anyone who has played, instead of the whole draft board, so drafted players who did not make the team no longer clutter the list.',
      },
      {
        short: 'Pitch Data says when tracking is unavailable',
        full:  'When the league feed has not posted pitch tracking for a finished WPBL game, the Pitch Data tab now shows with a short note instead of disappearing, so it is clear the data is missing rather than the game simply having none.',
      },
      {
        short: 'First grand slam joins the WPBL Hall of Firsts',
        full:  'The WPBL Hall of Firsts now tracks the league\'s first grand slam, featured on the home page next to the first home run, win, and strikeout.',
      },
    ],
  },
  {
    version: '1.30.0',
    date:    '2026-08-05',
    title:   'Metric or imperial units, and Settings for everyone',
    changes: [
      {
        short: 'Choose metric or imperial units',
        full:  'Settings has a new units toggle that switches the site between imperial (mph, feet) and metric (km/h, meters). Your choice is saved on your device, with no account needed.',
      },
      {
        short: 'WPBL tracking numbers convert live',
        full:  'The WPBL tracking page, the home tracking highlights, and a game\'s pitch data now show velocities and distances in whichever unit system you pick, and they update the moment you switch it in Settings.',
      },
      {
        short: 'Open Settings without signing in',
        full:  'The profile menu at the top right is now a dropdown. When signed out it offers Sign in, Create an account, and Settings, so anyone can reach Settings and set their units without an account.',
      },
    ],
  },
  {
    version: '1.29.0',
    date:    '2026-08-05',
    title:   'WPBL tracking highlights and site policies',
    changes: [
      {
        short: 'Tracking highlights on WPBL home',
        full:  'The WPBL home page now has a Ballpark tracking card showing the season\'s fastest pitch, hardest hit, and longest tracked hit, each with the player. A New tag appears when a record was just set on the latest game day, and you can tap through to the full Tracking page.',
      },
      {
        short: 'Privacy Policy and Terms pages',
        full:  'Added Privacy Policy and Terms of Service pages, linked from the footer, explaining what information the site collects and the terms for using it.',
      },
      {
        short: 'Easier to read labels on WPBL home',
        full:  'The small labels on the WPBL home cards, like the stat names, Hall of Firsts entries, and tracking highlights, now have more contrast so they are easier to read.',
      },
      {
        short: 'Correct city on followed team card',
        full:  'Your followed team card now shows the team\'s common name, for example Colorado Rockies, instead of the raw city from the data feed, which showed Denver.',
      },
      {
        short: 'Clearer WPBL longest-hit leaderboard',
        full:  'The WPBL longest-hit leaderboard is now labeled as radar-measured distance, making it clear that batted balls the radar did not read may not appear.',
      },
    ],
  },
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
