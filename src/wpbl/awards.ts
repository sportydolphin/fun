/**
 * The fan awards ballot: what is on it, when it is open, and how a vote is keyed.
 *
 * WHY THIS IS A CATALOG IN CODE rather than rows in a table. The shortlists are computed from
 * the season (see derive/awards.ts), so a category is a rule plus some copy, and both belong
 * with the code that renders them: versioned, diffable, and testable without a database. The
 * database stores votes and nothing else.
 *
 * AN `id` IS PERMANENT. It is what lands in `wpbl_award_votes.category`, so renaming one
 * orphans every vote already cast under the old spelling. Retire an id, never rename it.
 *
 * WHY THE BALLOT IS HALF SERIOUS AND HALF NOT. The serious half is answerable from the
 * numbers, which means the site can already answer it and the vote only adds the argument.
 * The other half is the part no leaderboard can settle: who is worth building a second season
 * around, who you would not want to face with two out. Those are the ones a fan can answer
 * better than the data can, and they are why anyone votes twice.
 *
 * PURE: no supabase, no React, and no clock unless a caller passes one in.
 */

/** What a ballot line picks, which decides both the shortlist and the shape of `choice`. */
export type AwardPick = 'player' | 'game' | 'play' | 'manager'

/** Which shortlist rule fills the category. One per builder in derive/awards.ts. */
export type AwardSlate =
  | 'mvp' | 'arm' | 'glove' | 'play' | 'game'
  | 'wheels' | 'toughestOut' | 'workhorse' | 'utility'
  | 'cannon' | 'contact'
  | 'manager' | 'aura'
  | 'everyone'

export interface WpblAward {
  /** Stored in the database. Permanent, see the header. */
  id: string
  title: string
  /** The Discord post's heading mark, and nothing else: it is what separates five questions
   *  posted into a channel, where the surrounding register is chat. The site prints the title
   *  on its own, because an icon over every heading on one sheet reads as decoration applied
   *  by the yard rather than as this section, which marks no other heading. */
  emoji: string
  /** The one line under the title: what the award is actually asking. */
  blurb: string
  pick: AwardPick
  slate: AwardSlate
  /** True for the five a leaderboard could argue about. Groups the ballot, nothing else. */
  serious: boolean
  /** No shortlist: the whole roster, searched. The point of these is that the data has no
   *  opinion, so offering six names would be inventing one. */
  openField?: boolean
  /** Only offered while the league is publishing radar. See TRACKED_MIN_* in tracking.ts:
   *  tracking has gone quiet before and the ballot has to survive it going quiet again. */
  needsTracking?: boolean
  /** ISO instant after which the category stops accepting votes. */
  closesAt: string
}

/**
 * The ballot closes at FIRST PITCH OF THE FINAL.
 *
 * It used to run to the day after the last postseason game, on the reasoning that the audience
 * is here for the playoffs and a ballot shut on Sep 6 would be closed for the fortnight the
 * section is busiest. That is still true of the opening date, which is why the ballot opens the
 * day after the regular season ends. What was wrong was the other end: a poll with no visible
 * deadline is a poll people mean to come back to, and "closes eventually" gave nobody a reason
 * to answer today. The final is the one moment in the postseason every reader already knows the
 * date of, so it is a deadline that explains itself.
 *
 * SIX PM EASTERN ON THE DAY, WHICH IS AT OR BEFORE FIRST PITCH WHEREVER THE GAME IS PLAYED. The
 * published time is 6:00 PM with no zone, and the final's host is not known until the semifinals
 * end, so the club could be in any of four zones. Reading it as Eastern closes the ballot exactly
 * at first pitch for an east-coast host and up to three hours early for a west-coast one. That
 * asymmetry is the right way round: a regular-season award taking votes after the final has
 * started is worse than one that shut a little early.
 *
 * THE DATE IS `POSTSEASON_SCHEDULE.championship[0]` IN derive/bracket.ts, copied rather than
 * imported: this module is a dependency-free leaf (the same rule routes.ts follows) and pulling
 * the bracket in would drag seeding, series and season behind it. `awards.test.ts` pins the two
 * together so the copy cannot drift from the schedule.
 */
export const AWARDS_CLOSE_DATE = '2026-09-16'
export const AWARDS_CLOSE_AT = `${AWARDS_CLOSE_DATE}T22:00:00Z`

const CLOSE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sep 16", for the one line of copy that states the deadline. Built by string surgery and not
 *  by `new Date`, for the reason seriesDateLine gives: a bare date parsed as a Date is midnight
 *  UTC printed in local time, which is the previous evening in every American zone. */
export const AWARDS_CLOSE_LABEL =
  `${CLOSE_MONTHS[Number(AWARDS_CLOSE_DATE.slice(5, 7)) - 1]} ${Number(AWARDS_CLOSE_DATE.slice(8, 10))}`

/**
 * One category outlives the rest: next season's is a question about a season nobody has
 * played, so it has no reason to close with the others and every reason to keep a section
 * with no feed warm through the winter. Spring is when it stops being a guess.
 */
export const NEXT_SEASON_CLOSE_AT = '2027-03-01T05:00:00Z'

/** Fallback opening date: the day after the last scheduled regular-season game. Only reached
 *  when the schedule is empty, since `awardsOpenDate` reads the real one. */
export const AWARDS_OPEN_FALLBACK = '2026-09-07'

/**
 * WHO MANAGES EACH CLUB, because the league's own FEED does not say.
 *
 * Not on a team, not on a game, not in a box score: the mirror has no column for it and never
 * will, so these four are typed in here from the league's published announcements. They are the
 * only facts in this section that do not come from the feed, which is exactly why they are in one
 * named constant with its sources on it rather than scattered through a slate builder.
 *
 * Sources, both the league's own site:
 *   · Founding four and their staffs, Jul 29 2026
 *     womensprobaseballleague.com/2026/07/29/introducing-the-managers-coaching-staff-of-the-founding-four-wpbl-teams/
 *   · Boston's change, Aug 9 2026
 *     womensprobaseballleague.com/2026/08/09/boston-hunters-name-jemile-weeks-manager/
 *
 * THOSE TWO POSTS ARE ALSO WHERE THE FACES COME FROM. The league publishes a cut-out headshot of
 * every player and none of any manager, so the four in `src/wpbl/managers/` are crops of the
 * announcement art itself: three off the "Introducing the Managers" graphic and Weeks off his own.
 * Which is why Foulke has no portrait and needs none, and why a fifth manager will arrive the same
 * way, by hand, out of whatever the league puts on the post.
 *
 * BOSTON HAS HAD TWO IN A FIFTEEN-GAME SEASON, and that is the case this shape exists for. Keith
 * Foulke opened the season and was dismissed three games into it; Jemile Weeks has had the other
 * twelve. The ballot offers Weeks, because a Manager of the Year award over a season is about the
 * person who managed it, and three games is not a season. Foulke is recorded here rather than
 * deleted: the day somebody asks why Boston's entry does not match the launch announcement, this
 * is the answer, and the next change will want the same treatment.
 *
 * KEYED ON THE PERSON, NOT ON THE CLUB, and Boston is the reason. A vote stored against `BOS`
 * would read as a vote for whoever holds that chair whenever it is next rendered, so a 2026 ballot
 * would silently re-credit a 2027 manager. `mgr:<slug>` names the human being who was voted for
 * and keeps naming them.
 */
export interface WpblManager {
  /** The stored choice. Permanent, like every other id on this ballot. */
  key: string
  /** What the card prints. Short enough for a third-width tile. */
  name: string
  /** The formal version where it differs, for anywhere with room for it. */
  fullName?: string
  teamId: string
}

export const WPBL_MANAGERS: WpblManager[] = [
  { key: 'mgr:matt-williams', name: 'Matt Williams', teamId: 'SF' },
  // The league writes her as Rachelle "Rocky" Henley. A ballot card is a third of a sheet wide
  // and the quoted form came out as `Rachelle "Ro...`, so the card gets the name she is called
  // by and the full one stays here.
  { key: 'mgr:rocky-henley', name: 'Rocky Henley', teamId: 'NY', fullName: 'Rachelle "Rocky" Henley' },
  { key: 'mgr:eric-young-sr', name: 'Eric Young Sr.', teamId: 'LA' },
  { key: 'mgr:jemile-weeks', name: 'Jemile Weeks', teamId: 'BOS' },
]

export const managerOf = (teamId: string): WpblManager | undefined =>
  WPBL_MANAGERS.find(m => m.teamId === teamId)

/**
 * Defensive Wizard is CHOSEN, not sorted, and it is the only award on this ballot that is.
 *
 * WHY THE NUMBERS CANNOT DO IT. A fielding line in this feed is `po, a, e, dp, pb, sba` and
 * NOTHING ELSE: no position, no innings, no zone (see positions.ts, which has to reconstruct a
 * player's position from the box score's batting rows because the fielding rows do not carry
 * one). So any ranking has to be built out of assists and double plays, and that is an
 * infielder's stat line. Ordered on it, the shortlist came out as four infielders, every time,
 * and it always will: Denae Benites has taken 106 chances, more than anyone in the league, and
 * ranks 16th on it because 90 of them are putouts behind the plate. Natsuki Yonetani ranks 36th
 * for having 3 assists in right field, where an assist means a runner was foolish enough to test
 * her. A shortlist that structurally cannot contain a catcher or an outfielder is not a shortlist
 * of defenders, and no weighting fixes that without a position to weight by.
 *
 * SO THE FOUR ARE NAMED HERE and the card still carries their real figures, which is the honest
 * version of what the sort was pretending to do. Ordered as written, not by any column, because
 * the whole point is that no single column ranks them.
 *
 * NAME AND CLUB, RESOLVED AGAINST THE ROSTER, for the same reason WPBL_MANAGERS holds a key
 * rather than a club: a uuid in this file could not be read or checked by anybody, and a name on
 * its own is ambiguous the moment two clubs share one (routes.ts already treats that case as
 * ambiguous on purpose). The pair is what a person can verify at a glance.
 *
 * A VOTE IS KEYED ON THE PLAYER, so editing this list changes what can be answered but never
 * rewrites an answer already given: a stored choice this list no longer offers reads as a busted
 * pick, the same way the pick'em treats a club that got knocked out.
 */
export interface WpblNominee {
  /** EXACTLY as the roster spells it, accents and all: Andréanne Leblanc is `Andréanne`, though
   *  the league's own play log writes her without the accent. The resolver takes an exact match
   *  on the pair and nothing else, so a name typed the way you say it will simply not appear. */
  name: string
  teamId: string
}

export const WPBL_GLOVE_SHORTLIST: readonly WpblNominee[] = [
  { name: 'Ashton Lansdell', teamId: 'LA' },
  { name: 'Denver Bryant', teamId: 'BOS' },
  { name: 'Denae Benites', teamId: 'NY' },
  { name: 'Natsuki Yonetani', teamId: 'NY' },
]

export const WPBL_AWARDS: readonly WpblAward[] = [
  // ── The five the numbers can argue about ──────────────────────────────────────
  {
    id: 'mvp',
    title: 'Most Valuable Player',
    emoji: '⚾',
    blurb: 'The best season anyone had, however you want to define best.',
    // NO PROSE UNDER THE TILES. Every category used to carry a sentence naming the sort it was
    // seeded on, and read end to end the ballot was more explaining than asking. The blurb poses
    // the question and the tiles carry the figures; a reader who wants the ranking has the whole
    // section for it. Removed Sep 9, 2026.
    pick: 'player', slate: 'mvp', serious: true, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'pitcher',
    title: 'Pitcher of the Year',
    emoji: '🔥',
    blurb: 'Who you hand the ball to in a game you have to win.',
    pick: 'player', slate: 'arm', serious: true, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'glove',
    // RENAMED, NOT RE-IDENTIFIED. `id` is what lands in wpbl_award_votes.category and is
    // permanent; the title is copy and can say whatever the award is actually called.
    title: 'Defensive Wizard',
    emoji: '🧤',
    blurb: 'The defender you were glad was out there.',
    pick: 'player', slate: 'glove', serious: true, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'play',
    title: 'Play of the Year',
    emoji: '🎬',
    blurb: 'One swing, one throw, one moment that decided a night.',
    pick: 'play', slate: 'play', serious: true, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'game',
    title: 'Game of the Year',
    emoji: '📺',
    blurb: 'The one you would make somebody watch to explain this league.',
    pick: 'game', slate: 'game', serious: true, closesAt: AWARDS_CLOSE_AT,
  },

  {
    id: 'manager',
    title: 'Manager of the Year',
    emoji: '📋',
    blurb: 'Which bench got the most out of what it had.',
    pick: 'manager', slate: 'manager', serious: true, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'aura',
    title: 'Most Aura',
    emoji: '😎',
    blurb: 'You know it when you see it. Presence, swagger, the one you look for on the lineup card.',
    pick: 'player', slate: 'aura', serious: false, closesAt: AWARDS_CLOSE_AT,
  },

  // ── The eight only a fan can settle ───────────────────────────────────────────
  {
    id: 'rookie',
    title: 'Rookie of the Year',
    emoji: '🐣',
    // The joke is true, and it is available exactly once. Every player in this league debuted
    // this season, so the category is either meaningless or it is the whole ballot, and it is
    // better as the second one.
    blurb: 'Every player in this league is a rookie, so this is either the easiest award to qualify for or the hardest to win.',
    pick: 'player', slate: 'everyone', serious: false, openField: true, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'wheels',
    title: 'The Wheels',
    emoji: '👟',
    // Not a novelty: the MVP number is run expectancy across a plate appearance, a steal
    // belongs to no plate appearance, and the section therefore credits baserunning to
    // nobody. This is the only place on the site where it counts for anything.
    blurb: 'Best baserunner. The MVP number cannot see a stolen base, so this is the only award that can.',
    pick: 'player', slate: 'wheels', serious: false, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'toughest-out',
    title: 'Toughest Out',
    emoji: '🧱',
    blurb: 'The at-bat a pitcher does not want with two on and two gone.',
    pick: 'player', slate: 'toughestOut', serious: false, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'workhorse',
    title: 'The Workhorse',
    emoji: '🐴',
    blurb: 'Whoever kept answering the phone.',
    pick: 'player', slate: 'workhorse', serious: false, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'utility',
    title: 'Swiss Army Glove',
    emoji: '🔧',
    blurb: 'Most places on the field in one season. Somebody has to catch, and then play short.',
    pick: 'player', slate: 'utility', serious: false, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'cannon',
    title: 'The Cannon',
    emoji: '🚀',
    blurb: 'The arm that made the radar gun sit up.',
    pick: 'player', slate: 'cannon', serious: false, needsTracking: true, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'contact',
    title: 'Loudest Contact',
    emoji: '💥',
    blurb: 'The one you heard from the back row.',
    pick: 'player', slate: 'contact', serious: false, needsTracking: true, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'franchise-2027',
    title: 'Build Around Her',
    emoji: '🔮',
    blurb: 'One player to start the second season with. No stat can answer this, which is the point.',
    pick: 'player', slate: 'everyone', serious: false, openField: true, closesAt: NEXT_SEASON_CLOSE_AT,
  },
]

/**
 * THE FIVE THE FAN VOTE CARD RUNS, in the order it draws them.
 *
 * `WPBL_AWARDS` is thirteen categories and every one of them was written to be asked. Thirteen
 * is not a ballot, it is a survey: the card that carries this sits on Home between a scoreboard
 * and a bracket, and a reader who is asked thirteen questions answers none. Five is what fits on
 * a card, and these five are the ones worth a season's argument.
 *
 * NOTHING IS RETIRED. The other eight keep their ids, their shortlists and their tests, and any
 * of them joins the ballot by being named here. That is deliberate: an id that has taken a vote
 * can never be reused (see the header), so the cheap move is to leave them defined and unasked
 * rather than to delete them and lose the option.
 */
export const FAN_VOTE_IDS = ['mvp', 'pitcher', 'manager', 'glove', 'aura'] as const

/** The ballot as the card runs it, in order, skipping any id that has been retired. */
export const fanVoteAwards = (): WpblAward[] =>
  FAN_VOTE_IDS.map(id => WPBL_AWARDS.find(a => a.id === id)).filter((a): a is WpblAward => !!a)

export const awardById = (id: string): WpblAward | undefined => WPBL_AWARDS.find(a => a.id === id)

// ── How a vote is keyed ──────────────────────────────────────────────────────────

/** The ballot key for a play, everywhere. Never the play's uuid: `wpbl_game_plays` is a
 *  mirror that is deleted and reinserted on every ingest pass, so the uuid is regenerated and
 *  a vote stored against it would point at nothing by the next pass. See CLAUDE.md. */
export const playChoiceKey = (gameId: string, sequence: number): string => `${gameId}:${sequence}`

/** The inverse. Null when the string is not a play key. */
export function parsePlayChoice(choice: string): { gameId: string; sequence: number } | null {
  const at = choice.lastIndexOf(':')
  if (at <= 0 || at === choice.length - 1) return null
  const sequence = Number(choice.slice(at + 1))
  if (!Number.isFinite(sequence)) return null
  return { gameId: choice.slice(0, at), sequence }
}

// ── When the ballot is open ──────────────────────────────────────────────────────

/** Local YYYY-MM-DD, the spelling `game_date` uses and is compared in throughout. */
export function localDateKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

interface ScheduleDate { game_date: string | null; counts_in_standings?: boolean | null }

/**
 * The day voting opens: the day after the last regular-season game on the schedule.
 *
 * Read from the schedule rather than hardcoded, so a postponement that moves the end of the
 * season moves the ballot with it. An empty schedule falls back to the published date, which
 * fails toward opening: a ballot that appears a day early is a smaller failure than one that
 * never appears because a fetch came back empty.
 *
 * Excluding only on positive evidence (`counts_in_standings === false`) is the same rule
 * `countsInStandings` uses, and for the same reason: the day the feed renames its game types,
 * the alternative reads the whole season as postseason and never opens the ballot at all.
 */
export function awardsOpenDate(games: readonly ScheduleDate[]): string {
  let last = ''
  for (const g of games) {
    const d = g.game_date ?? ''
    if (!d || g.counts_in_standings === false) continue
    if (d > last) last = d
  }
  if (!last) return AWARDS_OPEN_FALLBACK
  // Midday, so a DST shift cannot roll the date back over midnight.
  const next = new Date(`${last}T12:00:00`)
  next.setDate(next.getDate() + 1)
  return localDateKey(next)
}

export type AwardBallotState = 'early' | 'open' | 'closed'

/** Where one category stands now. They close separately: see NEXT_SEASON_CLOSE_AT. */
export function awardState(award: WpblAward, games: readonly ScheduleDate[], now: Date = new Date()): AwardBallotState {
  if (localDateKey(now) < awardsOpenDate(games)) return 'early'
  return now.getTime() >= Date.parse(award.closesAt) ? 'closed' : 'open'
}

/** True while anything on the ballot still takes votes. */
export function anyAwardOpen(games: readonly ScheduleDate[], now: Date = new Date()): boolean {
  return WPBL_AWARDS.some(a => awardState(a, games, now) === 'open')
}

/**
 * Most Aura is chosen too, and it is the one award where that needs no defending.
 *
 * The section's own heading calls these five questions the numbers cannot settle, and this is the
 * one where that is not a figure of speech. It was seeded off the top two home-run hitters and
 * the top two strikeout pitchers, which is a fine way to find four good players and no way at all
 * to find the one people look for on the lineup card. Worse, it made the tiles argue: four faces
 * carded on HR and AVG is a second MVP ballot, and a reader comparing .552 against .219 is
 * answering a question nobody asked.
 *
 * SO THESE CARRY NO FIGURES, not on the seeded four and not on a write-in. See auraSlate.
 */
export const WPBL_AURA_SHORTLIST: readonly WpblNominee[] = [
  { name: 'Meggie Meidlinger', teamId: 'LA' },
  { name: 'Denver Bryant', teamId: 'BOS' },
  { name: 'Andréanne Leblanc', teamId: 'SF' },
  { name: 'Claire Eccles', teamId: 'NY' },
]

/**
 * Who this ballot came from, and the only off-site link in the section.
 *
 * The fan awards exist because Ghost Baseboo suggested them, and the categories were picked with
 * him. That is a fact about where the feature came from rather than a promotion, and it stays
 * true however the traffic runs between a site and a channel that cover the same four clubs.
 *
 * HERE RATHER THAN INLINE IN THE SHEET, beside the managers and the two shortlists, because it
 * is the same kind of thing as those: a fact a person maintains that no feed will ever supply.
 * A dead credit link is worse than none, so it is somewhere a test can see it and somewhere you
 * would think to look when a channel moves.
 */
export const WPBL_AWARDS_CREDIT = {
  /** The words before the name, which carry the sheet's voice. */
  prefix: 'In collaboration with',
  /** Set apart from the prefix on the sheet, because the name IS the link and a line of even
   *  grey read as a footnote nobody would think to press. */
  name: 'Ghost Baseboo',
  url: 'https://www.youtube.com/@Ghostbaseboo',
} as const

/** The credit as one string, for anywhere that cannot set two. */
export const awardsCreditLine = (): string =>
  `${WPBL_AWARDS_CREDIT.prefix} ${WPBL_AWARDS_CREDIT.name}`
