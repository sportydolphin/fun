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
export type AwardPick = 'player' | 'game' | 'play'

/** Which shortlist rule fills the category. One per builder in derive/awards.ts. */
export type AwardSlate =
  | 'mvp' | 'arm' | 'glove' | 'play' | 'game'
  | 'wheels' | 'toughestOut' | 'workhorse' | 'utility'
  | 'cannon' | 'contact'
  | 'everyone'

export interface WpblAward {
  /** Stored in the database. Permanent, see the header. */
  id: string
  title: string
  emoji: string
  /** The one line under the title: what the award is actually asking. */
  blurb: string
  /** Where the shortlist came from, said out loud, so nobody has to guess whether a name on
   *  it is an endorsement. Every seeded category shows this; the open-field ones have none. */
  seededBy?: string
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
 * The ballot closes the day after the last postseason game, not the day the regular season
 * ends. The awards are for the regular season, but the audience is here for the playoffs, and
 * a ballot that shut on Sep 6 would be closed for the fortnight the section is busiest.
 */
export const AWARDS_CLOSE_AT = '2026-09-23T04:00:00Z'

/**
 * One category outlives the rest: next season's is a question about a season nobody has
 * played, so it has no reason to close with the others and every reason to keep a section
 * with no feed warm through the winter. Spring is when it stops being a guess.
 */
export const NEXT_SEASON_CLOSE_AT = '2027-03-01T05:00:00Z'

/** Fallback opening date: the day after the last scheduled regular-season game. Only reached
 *  when the schedule is empty, since `awardsOpenDate` reads the real one. */
export const AWARDS_OPEN_FALLBACK = '2026-09-07'

export const WPBL_AWARDS: readonly WpblAward[] = [
  // ── The five the numbers can argue about ──────────────────────────────────────
  {
    id: 'mvp',
    title: 'Most Valuable Player',
    emoji: '⚾',
    blurb: 'The best season anyone had, however you want to define best.',
    seededBy: 'Runs added at the plate plus runs saved on the mound, from the MVP race.',
    pick: 'player', slate: 'mvp', serious: true, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'pitcher',
    title: 'Pitcher of the Year',
    emoji: '🔥',
    blurb: 'Who you hand the ball to in a game you have to win.',
    seededBy: 'Runs saved, priced against the league run-expectancy table.',
    pick: 'player', slate: 'arm', serious: true, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'glove',
    title: 'Glove of the Year',
    emoji: '🧤',
    blurb: 'The defender you were glad was out there.',
    // Said plainly because this shortlist is weaker than the others, and pretending otherwise
    // is the dishonest part: there is no defensive metric in this section worth the name, and
    // chances handled is a workload count rather than a ranking.
    seededBy: 'Assists and double plays, since a catcher is credited a putout on every strikeout. There is no defensive metric in this section, so this one really is yours.',
    pick: 'player', slate: 'glove', serious: true, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'play',
    title: 'Play of the Year',
    emoji: '🎬',
    blurb: 'One swing, one throw, one moment that decided a night.',
    seededBy: 'The play that moved its game furthest toward the team that won it.',
    pick: 'play', slate: 'play', serious: true, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'game',
    title: 'Game of the Year',
    emoji: '📺',
    blurb: 'The one you would make somebody watch to explain this league.',
    seededBy: 'Total win-probability movement: how much the game actually swung.',
    pick: 'game', slate: 'game', serious: true, closesAt: AWARDS_CLOSE_AT,
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
    seededBy: 'Stolen bases, net of times caught.',
    pick: 'player', slate: 'wheels', serious: false, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'toughest-out',
    title: 'Toughest Out',
    emoji: '🧱',
    blurb: 'The at-bat a pitcher does not want with two on and two gone.',
    seededBy: 'Lowest strikeout rate among qualified hitters.',
    pick: 'player', slate: 'toughestOut', serious: false, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'workhorse',
    title: 'The Workhorse',
    emoji: '🐴',
    blurb: 'Whoever kept answering the phone.',
    seededBy: 'Most outs recorded.',
    pick: 'player', slate: 'workhorse', serious: false, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'utility',
    title: 'Swiss Army Glove',
    emoji: '🔧',
    blurb: 'Most places on the field in one season. Somebody has to catch, and then play short.',
    seededBy: 'Distinct positions played, from the box scores.',
    pick: 'player', slate: 'utility', serious: false, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'cannon',
    title: 'The Cannon',
    emoji: '🚀',
    blurb: 'The arm that made the radar gun sit up.',
    seededBy: 'Hardest pitch thrown, from the tracking data.',
    pick: 'player', slate: 'cannon', serious: false, needsTracking: true, closesAt: AWARDS_CLOSE_AT,
  },
  {
    id: 'contact',
    title: 'Loudest Contact',
    emoji: '💥',
    blurb: 'The one you heard from the back row.',
    seededBy: 'Hardest ball hit, from the tracking data.',
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
