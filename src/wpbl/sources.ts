/**
 * Where everything on the WPBL section comes from, as data.
 *
 * WHY IT IS A MODULE AND NOT JUST A PAGE, the same call glossary.ts made: a list like this is
 * the sort of thing that gets restated in three places and then disagrees with itself. It is
 * stated once, the page renders it, and a test asserts the one property that actually matters
 * (see below).
 *
 * WHAT THIS PAGE IS FOR. Credit today is scattered across the surfaces that use each source,
 * which is right and is not enough: RetroWPBL is credited twice inside Game Center, the two
 * writers on their own cards, Commons in the photo gallery, and the only place naming any of it
 * together was the Terms page, which is the worst home for it. Nothing answered "where does this
 * site's data come from" at a URL you could hand somebody.
 *
 * IT IS A CREDITS PAGE, NOT A LINKS PAGE. Every entry is something the site actually uses. The
 * moment it grows a "other sites you might like" section it becomes a link farm and stops being
 * worth linking to, which is the entire point of having it (see docs/BACKLINKS.md: the site's
 * remaining constraint is inbound links, and the honest way to ask for one is to have already
 * given one).
 *
 * IT DOES NOT REPLACE THE CREDIT BESIDE THE CONTENT. Readers came away from Home on Aug 26,
 * 2026 believing the writer of the mirrored Substack ran this site, and the fix was the byline
 * on the card, not a page elsewhere. This is additional.
 *
 * Data only, no React, so the page and the tests read the same list.
 */
import { WPBL_AWARDS_CREDIT } from './awards'

export type SourceKind = 'league' | 'writing' | 'data' | 'photography' | 'collaboration'

export interface WpblSource {
  name: string
  /** Their own home, which is where every link on the page goes. */
  url: string
  kind: SourceKind
  /** Who they are, in a sentence, in our words rather than theirs. */
  who: string
  /** What we take. Specific: a reader checking our provenance wants the scope, not a category. */
  uses: string
  /** Where it shows up on this site, so the claim is checkable. */
  seenOn: string
  /**
   * The basis for using it, and the reason this field is not optional.
   *
   * THREE of these are somebody's own work, used by permission with a date: two writers and a
   * transcriber, none of whom had to say yes. That is the sort of fact that decays into folklore
   * unless it is written where it renders, so every entry has to say something here and the
   * tests assert it, with the three permissions checked for the word and the year.
   */
  basis: string
}

/**
 * THE ORDER IS THE ARGUMENT. The league's own publications first, because that is where most of
 * the numbers come from and a reader checking our provenance should meet it immediately.
 * Independent people after, because they are the ones whose names deserve to be read rather
 * than skimmed past in a table of feeds.
 */
export const WPBL_SOURCES: readonly WpblSource[] = [
  {
    name: 'The WPBL stats feed',
    url: 'https://www.womensprobaseballleague.com',
    kind: 'league',
    who: 'The league’s own statistics service.',
    uses: 'Schedules, scores, box scores, play-by-play, rosters, and the pitch tracking the league published in August.',
    seenOn: 'Nearly everything: the scoreboard, standings, stats, Game Center and every player page.',
    basis: 'A public feed, read as published. This site is not affiliated with the league and does not speak for it.',
  },
  {
    name: 'The WPBL schedule page',
    url: 'https://www.womensprobaseballleague.com/schedule/',
    kind: 'league',
    who: 'The league’s own calendar, which is a different publication from the stats feed and sometimes ahead of it.',
    uses: 'First pitch times and postseason fixtures, including which club bats last.',
    seenOn: 'Game times across the section, and the postseason before the stats feed carried it.',
    basis: 'A public page, read as published. Where the two league sources disagree about a start time, the calendar wins.',
  },
  {
    name: 'The WPBL on YouTube',
    url: 'https://www.youtube.com/@womensprobaseballleague',
    kind: 'league',
    who: 'The league’s own channel.',
    uses: 'Highlight reels, matched to the game they are from.',
    seenOn: 'The reel on a finished game, and the Highlights shelf on the league page.',
    basis: 'Embedded from YouTube’s own player, never re-hosted.',
  },
  {
    name: 'This is Women’s Baseball',
    url: 'https://thisiswomensbaseball.com',
    kind: 'writing',
    who: 'An independently run site covering the WPBL, which files a recap of every game.',
    uses: 'A headline, a link, the date and their own title picture. None of their writing.',
    seenOn: 'The recap link on every finished game.',
    basis: 'Linked with their explicit permission, granted September 2026. Their work is theirs; this site only points at it.',
  },
  {
    name: 'towards a more perfect game',
    url: 'https://towardsamoreperfectgame.substack.com',
    kind: 'writing',
    who: 'mary mustard, a writer and amateur ballplayer from Albany, covering women’s baseball on her own Substack.',
    uses: 'A headline, a dek, a cover image and a date. The article itself is never stored or shown here.',
    seenOn: 'The Reading shelf on the league page, the story card on a game, and the “written about” lists on players and clubs.',
    basis: 'Mirrored with her explicit permission, granted August 17, 2026. Every card links straight to her post, and her name is on all of them. The writing is hers.',
  },
  {
    name: 'RetroWPBL',
    url: 'https://github.com/exu6jh/RetroWPBL',
    kind: 'data',
    who: 'An independent, hand-written transcription of the season into Retrosheet format.',
    uses: 'First pitch, length of game, the umpiring crew and the weather, none of which the league publishes. Plus, for a handful of at-bats the league published blank, their account of what happened.',
    seenOn: 'Under the Game Center scoreboard, and marked with a dagger on the few plays it filled in.',
    basis: 'Used with the transcriber’s explicit permission, granted August 21, 2026. The repository carries no licence, so that permission is the whole basis for it.',
  },
  {
    // THE ONE ENTRY THAT SUPPLIES NO DATA, and it belongs here anyway: this page answers "what
    // of this is not ours", and a feature somebody else's idea shaped is exactly that. Name and
    // URL come from `WPBL_AWARDS_CREDIT` rather than being retyped, because awards.ts already
    // says it is the place to look when a channel moves, and two copies is how a credit link
    // quietly dies in one of them.
    name: WPBL_AWARDS_CREDIT.name,
    url: WPBL_AWARDS_CREDIT.url,
    kind: 'collaboration',
    who: 'A YouTube channel covering the WPBL and the same four clubs this site does.',
    uses: 'Nothing is taken. The fan awards exist because they suggested them, and the categories were picked together.',
    seenOn: 'The fan awards ballot, which carries the same credit at the foot of it.',
    basis: 'A collaboration rather than a source. The credit stays true however the traffic runs between a site and a channel covering the same league.',
  },
  {
    name: 'Wikimedia Commons',
    url: 'https://commons.wikimedia.org',
    kind: 'photography',
    who: 'The free media repository behind Wikipedia.',
    uses: 'Photographs of women’s baseball, with the photographer and the licence carried on every one.',
    seenOn: 'The Archive shelf on the league page, and the photo gallery.',
    basis: 'Freely licensed images only, each shown with its author and licence as those licences require.',
  },
]

/** The headings the page groups by, in the order it shows them. */
export const SOURCE_GROUPS: readonly { kind: SourceKind; label: string; blurb: string }[] = [
  {
    kind: 'league',
    label: 'League publications',
    blurb: 'Most of the numbers here are pulled from what the league publishes.',
  },
  {
    kind: 'writing',
    label: 'Independent writing',
    blurb: 'Independent writers, linked with credit. Their words stay on their own sites: this site keeps a headline and a link, never the article.',
  },
  {
    kind: 'data',
    label: 'Independent records',
    blurb: 'Independent work that fills in what the league does not publish.',
  },
  {
    kind: 'photography',
    label: 'Photography',
    blurb: 'Freely licensed images, shown with the credit their licences require.',
  },
  {
    kind: 'collaboration',
    label: 'Collaborations',
    blurb: 'People whose ideas shaped something here, rather than whose data did.',
  },
]
