/**
 * The questions that exist only in the Discord.
 *
 * WHY THEY ARE HERE AND NOT IN awards.ts. That catalog is the site's ballot: every question in it
 * is rendered by the app, seeded from the season, and answerable by anyone who opens the page.
 * These are neither. They are hand-written, their options are typed out rather than computed, and
 * they are asked in one channel. Keeping them in a file the client bundle never imports means the
 * site cannot accidentally grow a question nobody outside the Discord can answer.
 *
 * THE `id` IS PERMANENT, exactly as it is on the site's ballot. It lands in
 * `wpbl_award_votes.category` on every vote cast, so renaming one orphans every answer already
 * stored under it. The `discord:2026:` prefix keeps them clear of the site's ids ('mvp') and the
 * pick'em's (`pickem:2026:…`), and carries the season so 2027 can ask the same question again
 * without inheriting this year's answers. Retire an id, never rename it.
 *
 * AN OPTION `key` IS PERMANENT FOR THE SAME REASON: it is the stored `choice`. A slug rather than
 * a position, because "the second option" stops meaning anything the moment the list is reordered
 * and a reordered list is the likeliest edit a question ever gets.
 *
 * WHAT A QUESTION MAY ASK. Anything the season cannot answer, which is the whole point of the
 * two ballots being different: the site's five are the ones a leaderboard could argue about, and
 * these are the ones only the people watching together can settle.
 *
 * TEN OPTIONS IS THE CEILING, from the emoji list in sync-wpbl-discord-awards.ts. A question with
 * more than about six is a survey rather than a vote, and reads as a wall in a chat client.
 */

export interface DiscordQuestionOption {
  /** Stored in `wpbl_award_votes.choice`. Permanent, see the header. */
  key: string
  /** What the message prints beside the number. */
  label: string
  /** An optional half-line after the label, for a figure or a reminder of who somebody is. */
  note?: string
}

export interface DiscordQuestion {
  /** Stored in `wpbl_award_votes.category`. Permanent, see the header. */
  id: string
  emoji: string
  title: string
  /** The one line under the title: what the question is actually asking. */
  blurb?: string
  /** ISO instant after which the question stops accepting votes. Defaults to the site ballot's
   *  close, which is first pitch of the final, so the two surfaces shut together. */
  closesAt?: string
  options: DiscordQuestionOption[]
}

/**
 * The five, when they land.
 *
 * Empty is a working state, not a stub: the poll job asks the site's five questions and whatever
 * is in here, so an empty list simply means the Discord has no extra questions today. Nothing
 * else has to change to add one.
 */
export const WPBL_DISCORD_QUESTIONS: readonly DiscordQuestion[] = [
  // Example of the shape, kept commented so the first real one has something to copy:
  //
  // {
  //   id: 'discord:2026:best-celebration',
  //   emoji: '🎉',
  //   title: 'Best Celebration',
  //   blurb: 'The dugout moment you are still doing at home.',
  //   options: [
  //     { key: 'firebells-dugout-bell', label: 'The Firebells ringing the bell' },
  //     { key: 'queens-hat-toss', label: 'The Queens and the hat toss', note: 'since Aug 12' },
  //   ],
  // },
]
