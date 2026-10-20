# WAR for the WPBL

Nobody publishes a wins-above-replacement figure for the Women's Pro Baseball League, so the site
builds its own. It follows FanGraphs' recipe step for step, from nothing but the league's own box
scores and play-by-play. The code is [`src/wpbl/derive/war.ts`](../src/wpbl/derive/war.ts); this
page is the why. It shows on the Stats tab's **Overall** side, Leaders and Players.

## The shape of it

A player's WAR is runs, then wins:

```
position player  = (Batting + Baserunning + Fielding + Positional + League + Replacement) / RPW
pitcher          = (Pitching + Fielding at P + Replacement) / RPW
WAR              = position player + pitcher
```

Every component is in runs against an average player except Replacement, which is what turns
"above average" into "above replacement". A two-way player simply has both halves. A pitcher's
fielding at the position counts toward pitching WAR, so a pure pitcher has no position-player WAR.

## The 2026 constants

| | 2026 | MLB, for scale |
|---|---|---|
| Regular-season games | 30 (60 team-games) | 2,430 |
| Runs per team per game | 7.92 | about 4.5 |
| Runs per win (RPW) | 14.3 | about 10 |
| WAR in the whole league | 12.3 | 1,000 |
| Position players / pitchers | 57% / 43% | 57% / 43% |

**Runs per win** is Pythagenpat's slope at .500: with `r` runs per team-game and exponent
`x = (2r)^0.287`, a win costs `4r / x` runs. It reproduces MLB's ten. A run is worth less where
runs are plentiful, and this league scores almost twice MLB's rate.

**Replacement level** is the one FanGraphs and Baseball-Reference agreed on in 2013: a team of
freely available players wins 29.4% of its games, which puts 1,000 WAR across an MLB season, or
0.206 per team-game. Here that is 12.3 for the league, 57% shared among hitters by plate
appearances and 43% among pitchers by innings. So 1 WAR is a very good WPBL season and 2 is an MVP
case: the scale is the league's length, not its quality.

## Batting

wRAA, FanGraphs' batting runs: `(wOBA - league wOBA) / wOBA scale * PA`. The weights are this
league's own, each event priced on our run-expectancy table
([`linearWeights.ts`](../src/wpbl/derive/linearWeights.ts)); the same weights drive wOBA and
wRC+ on the Hitting side, so the three cannot disagree.

## Baserunning

- **Steals, caught stealing and pickoffs** (FanGraphs' wSB), priced on the base-out state they
  changed ([`baserunning.ts`](../src/wpbl/derive/baserunning.ts)), less the league's steal runs per
  time on first (singles, walks and hit batters, less intentional walks) times the player's own.
- **Extra bases on hits and tag-ups**, each chance measured against the league's runners in the
  same spot.
- **Double plays hit into** (FanGraphs' wGDP): a chance is a plate appearance with a runner on
  first and fewer than two out; each double play hit into, against the league's rate in those
  chances, costs the average second out.

This league ran below its own break-even, so the league's rate is negative and a runner who reached
first and stayed there earns back what an average runner there lost. Until Oct 2026 the steal runs
were left uncentered and the league adjustment spread them over every plate appearance instead,
which credited a player for trips that ended in an out. A pinch runner has no times on first and
keeps the raw figure, as in FanGraphs. Pickoffs stay in, where FanGraphs' wSB has only steals and
caught stealing: a pickoff here is a runner's decision priced on the same table, and this league
has too few of them to give them a line of their own.

## Fielding

A play row names a position ("error by ss") and never a player, so the first job is knowing who
stood where. [`defenseIndex`](../src/wpbl/derive/fielding.ts) tracks every position through every
game from the box score's starting positions and the play log's substitution rows ("Keira Izumi to
3b for Alyssa Zettlemoyer"); the pitcher is on the play itself, and the catcher comes from
[`catcherIndex`](../src/wpbl/derive/catching.ts), which follows the "to c" rows. Every out the
defense records is credited to the nine players standing there, so **playing time is outs
actually played at each position**, and every rate below is per out at the position.

| Part | What it measures | Measured against |
|---|---|---|
| Range | Outs made on balls hit to the fielder's zone, priced at the zone's gap between a hit and an out | The league's out rate in that zone |
| Errors | What each error cost against the play made cleanly | The average at the position, per out |
| Double plays | What the second out was worth against a single out | The average at the position, per out |
| Outfield arm | Extra bases runners took on balls hit to the outfielder | The average at the position, per runner chance |
| Catcher arm | Steal attempts, priced like the runner's, sign flipped | The league's average attempt |
| Catcher blocking | Wild pitches and passed balls, priced on the state they changed | The league's rate per pitch caught |

**Range is a zone rating, not a tracking one.** The zone comes from the scorer's words
([`sprayZone`](../src/wpbl/derive/spray.ts)); a ball into a gap is shared between the two
outfielders. The play log never says how hard a ball was hit, so a scorched grounder and a
dribbler to the same spot count alike. Over a season that mostly evens out; over 15 games it is the
noisiest part of the model.

**A reach on an error is in Errors, not Range**, or the fielder would pay for it twice. A play the
error made no worse for the defense costs nothing: nobody is paid for erring.

**Wild pitches and passed balls are both the catcher's.** FIP charges the pitcher with neither, so
nothing is counted twice; MLB's catcher blocking models do the same.

## Positional adjustment

FanGraphs' scale, in runs per 162 games at the position: C +12.5, SS +7.5, 2B/3B/CF +2.5, LF/RF
-7.5, 1B -12.5, DH -17.5. It is spent per out played there, resized by this league's runs per out
against MLB's (about 2.3 times). The DH's is per plate appearance as a DH. A pitcher's fielding
carries none, as in FanGraphs.

**Why MLB's scale, in a different league.** Tango built it from players who switched positions:
the same player's fielding runs at shortstop and at second, say, compared against the average at
each, chained into a ladder of how much harder one position is than another. That ladder is mostly
the geometry of the field (the throw from the hole, a catcher's workload), which the WPBL shares.
What may not transfer is the size of each step, which also reflects how a league spreads its
athletes, and the 2.3x resize, which assumes the steps grow with the run environment.

The league's own data cannot answer it yet. By starting position, 2026's hitters ran from 8.4 runs
per 100 PA below average (shortstops) to 10.3 above (catchers), but every row is one or two
players' seasons over about 240 PA, with an error of about six runs either way: the catchers top it
because Denae Benites had the league's best bat, not because catching is easy. A 15-game season has
too few position switchers for Tango's method either. And dropping the adjustment is the one answer
known to be wrong, since fielding is centered on each position's own average: without it an average
first baseman and an average shortstop are worth the same. Its effect is small (at most about 0.15
WAR, Benites's) and does not reorder the top of the 2026 board.

**Revisit after 2027.** Two seasons give enough switchers to run Tango's method on this league's own
fielding runs, blended with MLB's scale by sample size until the league's own numbers can stand.

WAR prints to two places, where FanGraphs prints one: a league worth about 12 WAR a season would
tie half its board at one.

## League adjustment

Whatever makes batting, baserunning, fielding and positional runs sum to zero across the league,
spread by plate appearances. It absorbs the part that is not centered on its own, the positional
scale, and the hundredths the other parts miss by, so that an average position player is exactly
average.

## Pitching

ifFIP, FanGraphs' WAR version of FIP, on this league's own weights, against the league ERA it is
centered on: `(league ERA - ifFIP) * IP / 7`, plus pitching's share of replacement. ifFIP counts an
infield fly as a strikeout, since it is an out nearly every time and moves nobody. The feed has no
batted-ball type, so an infield fly is a pop-up, fly out or foul out to an infielder by the
scorer's words (about 170 in 2026); the strikeout weight is measured on the two pooled. The FIP
column on the Pitching side stays plain FIP, as FanGraphs' does. FIP leaves balls in play to
the fielders, whose half of WAR already prices them, so the defense is never in both. Per seven
innings, the league's own basis; see `ERA_BASIS_CANONICAL`.

## WAR and wins added

Wins added (WPA) prices every play by the scoreboard: a two-run double in a tie game in the 6th is
worth many times the same double in a rout. WAR deliberately ignores the score. So WAR is who
played best, and wins added is who swung close games; where they disagree is where clutch is
argued about. WAR is the Overall side's headline. Wins added is the last column on Players, and
has its own boards on Run value, by side or both ways together, beside the win-probability model
that explains it. It is kept off the Overall leader cards, where beside WAR it read as a rival
total rather than a different question.

## What it does not do, and why

- **No park factors.** One season of four clubs cannot separate a park from the teams that play in
  it; OPS+ and ERA+ on the site make the same call.
- **One replacement level for every pitcher.** FanGraphs sets relievers' a little higher than
  starters'. With most outings here two or three innings, the line between the two roles is not
  one the data draws.
- **No framing.** TrackMan publishes the pitch's height at the plate but not its side, so a called
  strike's location cannot be known.
- **Plays the log cannot place are left out**, not guessed: a ball with no direction in its words
  (8 of 1,378 in 2026), and a position nobody can be shown to have held (about 1% of outs).
- **Regular season only**, like every season total on the section.

## Checking it

- The league's WAR must sum to `0.206 * team-games`, split 57/43. In 2026: 12.32, 7.00 and 5.26.
- Errors credited per player should match the box score's E: 114 against 117 in 2026. Double plays
  should match DP: 110 against 114.
- Batting, centered fielding and pitching runs each sum to about zero. A part that drifts far from
  zero across the league is a part that is not centered.

`src/wpbl/__tests__/war.test.ts` pins the constants, and `fielding.test.ts` the pricing.
