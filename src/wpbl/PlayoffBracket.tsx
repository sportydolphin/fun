import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, useMediaQuery } from '@mui/material'
import { SectionCard, TeamBadge, pressable, FOCUS_RING, useWpblDark, TAPPABLE, TYPE_SCALE } from './ui'
import { wpblAccent, wpblSurface, wpblFullName } from './constants'
import { buildBracket, seriesDateLine } from './derive/bracket'
import type { BracketSeries, BracketEntrant, WpblBracket } from './derive/bracket'
import { postseasonOdds, fmtOdds } from './derive/seriesOdds'
import type { SeriesOdds, WpblPostseasonOdds } from './derive/seriesOdds'
import { seedingRace } from './derive/seeding'
import { useSeriesPicks, SeriesPickLine, PickemButton } from './SeriesPicks'
import SeriesPreview from './SeriesPreview'
import type { SeriesPickState } from './SeriesPicks'
import { track, EVENTS } from '../lib/analytics'
import type { WpblGame, WpblPlayer, WpblStandingRow, WpblTeam } from './types'

/**
 * Who goes where: the postseason bracket, drawn.
 *
 * The seeding card under the Standings table says what the last games decide, one row per
 * club, and says the pairing as a letter in a column and a name in a cell. That is the right
 * shape for a table and the wrong shape for the question a fan actually asks, which is who
 * plays whom. Four clubs and three series is a picture, and this is the picture.
 *
 * NOT A DUPLICATE OF THE SEEDING CARD, and the distinction is load-bearing. An earlier version
 * of that card drew a bracket AND a ladder in the same card, so the four clubs appeared twice
 * over, and the bracket was cut for it (see SeedingRace.tsx). The objection was to a bracket
 * beside a list, not to a bracket: this one lives on Home, where the list is not, and Home is
 * the surface with no route to a team page at all.
 *
 * LIVE FOR EVERYONE. It began behind the experimental-features switch, since it draws a matchup
 * that does not exist yet, and came out once the win-probability blend (run differential plus
 * head-to-head, see derive/seriesOdds.ts) turned it from a bare projected bracket into the
 * section's one forward-looking surface. The odds carry their own hedge in the card's footnote,
 * which is what a bracket-shaped guess needs rather than a flag almost nobody flips.
 *
 * ONE CARD FOR BOTH HALVES OF SEPTEMBER. Before the postseason the pairings are a projection
 * from the standings order, which is exactly what the seeding race is about; from Sep 9 the
 * same boxes carry real series records. It deliberately does not become a different card on
 * the day, because the interesting thing about a bracket is watching a provisional one harden.
 */

/** Every club here is a tap through to a team page. That is not decoration: opening a player
 *  or team page is the section's retention event by a tenfold margin, and Home is where the
 *  traffic says readers are lost. */
type OpenTeam = (t: WpblTeam) => void

/** Whether the reader has opened the bracket on a phone. Only ever read on xs; see the note in
 *  the component for why the default is shut there and open everywhere else. */
const BRACKET_OPEN_KEY = 'wpbl:bracketOpen'

/**
 * One club's row inside a series box, and the row IS the bar.
 *
 * WHAT THIS REPLACED, AND WHY. The row used to be a 16px name in plain white with the seed
 * beside it, and the series odds lived under both rows as a 6px two-tone bar with a percentage
 * at each end. Three things were wrong with that. Nothing on the card was bigger or bolder than
 * anything else, so a bracket sat next to Next game's 24px club names looking like a footnote.
 * The only colour in it was that hairline, so four clubs with four strong identities rendered as
 * white text. And a bar running red at one end and green at the other reads as good-against-bad
 * rather than as San Francisco against Boston, which is what it actually is.
 *
 * So the probability is drawn as a fill BEHIND the club's own name, in that club's own tint, and
 * the number sits at the end of its own row. Same information, no legend, no extra height, and
 * the colour finally says whose it is. `wpblSurface` and not `wpblAccent`: this is a field with
 * text on it, which is the whole reason that third role exists (see constants.ts).
 */
function SeriesTeamRow({ entrant, series, leading, winP, wide, placeholder }: {
  entrant: BracketEntrant
  series: BracketSeries
  leading: boolean
  /** Whether the column is wide enough for "San Francisco Firebells" rather than "Firebells".
   *  Decided once by the diagram, from the COLUMN's width and not the viewport's: this row is
   *  drawn inside a half-card, so what matters is how much of the card it got. */
  wide: boolean
  /** This club's chance to take the series, 0-1, or null where there is no model to ask (an
   *  undecided championship, a series already over). Null draws no fill and no number. */
  winP: number | null
  /** What an empty slot reads as. The championship names WHICH semifinal feeds each slot
   *  ("Semifinal A winner") rather than a bare "Semifinal winner" that is the same on both. */
  placeholder?: string
}) {
  const dark = useWpblDark()
  const { team, seed, wins } = entrant

  // An undecided championship slot still draws a row, so the box keeps its height and the
  // bracket does not resize under the reader the moment a semifinal ends.
  if (!team) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 1.1, minWidth: 0 }}>
        {/* Holds the seed column's place on a row that has no seed yet. Same rem as the
            real one below, so an undecided slot lines up with a decided one at any text size. */}
        <Box sx={{ width: '0.875rem', flexShrink: 0 }} />
        <Box sx={{
          width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
          border: '1px dashed', borderColor: 'divider',
        }} />
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled', flex: 1, minWidth: 0 }}>
          {placeholder ?? 'Semifinal winner'}
        </Typography>
      </Box>
    )
  }

  const beaten = !!series.winner && series.winner.id !== team.id

  return (
    // NOT ITS OWN TARGET ANY MORE. Each row used to be a tap through to that club's page, which
    // made a series box two controls with a strip of nothing between them and left the box
    // itself, the thing a reader points at, inert. The box opens the series now and the club
    // links live in there, where there is room to label them.
    <Box
      sx={{
        position: 'relative', overflow: 'hidden',
        display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 1.1, minWidth: 0,
        // The club that is through, or ahead, carries the only weight in the box. Everything
        // else stays flat so the eye lands on it without reading the numbers.
        opacity: beaten ? 0.45 : 1,
      }}
    >
      {/* The fill. Behind everything, so the name is read against it rather than beside it, and
          `aria-hidden` because the number to its right already says what it is. */}
      {winP != null && (
        <Box aria-hidden sx={{
          position: 'absolute', inset: 0, width: `${Math.max(winP * 100, winP > 0 ? 1.5 : 0)}%`,
          bgcolor: wpblSurface(team.id, dark),
        }} />
      )}
      <Typography sx={{
        position: 'relative', width: '0.875rem', flexShrink: 0,
        fontSize: TYPE_SCALE.caption, fontWeight: 800,
        color: 'text.disabled', fontVariantNumeric: 'tabular-nums',
      }}>{seed ?? ''}</Typography>
      <Box sx={{ position: 'relative', flexShrink: 0, display: 'flex' }}><TeamBadge team={team} size={26} /></Box>
      <Typography sx={{
        position: 'relative', flex: 1, minWidth: 0, fontSize: TYPE_SCALE.heading, lineHeight: 1.15,
        fontWeight: leading ? 900 : 700,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        color: leading ? wpblAccent(team.id, dark) : 'text.primary',
      }}>{wide ? wpblFullName(team) : team.name}</Typography>
      {/* Series wins once there are any, and the odds until then. Never both: two numbers at the
          end of one row, one of them a count and one a percentage, is the kind of column a
          reader has to be told how to read. A column of zeroes on Aug 20 would read as a series
          played and finished nil-nil, which is why the count waits for a game. */}
      {series.played > 0 ? (
        <Typography sx={{
          position: 'relative', fontSize: TYPE_SCALE.display, fontWeight: 900, flexShrink: 0,
          minWidth: '1.25rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
          color: leading ? 'text.primary' : 'text.secondary',
        }}>{wins}</Typography>
      ) : winP != null && (
        <Typography sx={{
          position: 'relative', fontSize: TYPE_SCALE.title, fontWeight: 900, flexShrink: 0,
          minWidth: '2.5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
          // ALWAYS THE CLUB'S OWN COLOUR, not "the favourite's". It is that club's number, on
          // that club's row, over that club's tint, so anything else would be the card picking a
          // side before a ball is thrown. `leading` is about a series lead and there is not one
          // yet, which is why keying the colour on it left both numbers grey.
          color: wpblAccent(team.id, dark),
        }}>{fmtOdds(winP)}</Typography>
      )}
    </Box>
  )
}

/** The season series between these two clubs, as a fan would say it ("SF 5-0"). Its own line
 *  because the odds are built on it, so it is the one number that explains the fill above. */
function seasonSeriesLine(series: BracketSeries, odds?: SeriesOdds): string | null {
  const h = odds?.h2h
  if (!h || !series.home.team || !series.away.team) return null
  if (h.homeWins + h.awayWins === 0) return null
  const [leadAbbr, hi, lo] = h.homeWins >= h.awayWins
    ? [series.home.team.abbr, h.homeWins, h.awayWins]
    : [series.away.team.abbr, h.awayWins, h.homeWins]
  return hi === lo ? `Season series ${hi}-${lo}` : `Season series ${leadAbbr} ${hi}-${lo}`
}

/**
 * One series.
 *
 * THE FOOT OF THE BOX IS ONE LINE NOW, not three. It carried the published dates, then a
 * two-tone odds bar with a percentage at each end, then the season series centred underneath:
 * three rows of 12px type saying three unrelated things, under two rows of 16px type saying the
 * thing the box is about. The odds moved into the club rows (see SeriesTeamRow), which leaves
 * the dates and the season series, and those fit on one line as a left and a right.
 */
function SeriesBox({ series, odds, onOpen, bracket, picks, fill, wide, children }: {
  series: BracketSeries; odds?: SeriesOdds
  /** Open this series' overview. Absent where there is nowhere to open one, which is any
   *  surface drawing the diagram outside Home. */
  onOpen?: () => void
  /** Passed through to the club rows. See SeriesTeamRow. */
  wide: boolean
  /** Both only for the pick strip, which needs the whole bracket to work out who could still
   *  reach the final. Absent on any surface that draws the diagram without one. */
  bracket?: WpblBracket; picks?: SeriesPickState
  /** Take the whole height of the column, putting the slack inside the box instead of above it.
   *  The championship asks for this; see the diagram. */
  fill?: boolean
  /** Anything that belongs inside this box under the meta line. The championship's title odds
   *  ride here rather than in a strip of their own. */
  children?: React.ReactNode
}) {
  const { home, away, winner } = series
  const homeLeads = winner ? winner.id === home.team?.id : home.wins > away.wins
  const awayLeads = winner ? winner.id === away.team?.id : away.wins > home.wins
  const isFinal = series.round === 'championship'
  // The most dramatic true thing about a live series is when one club is a loss from going home.
  const elim = odds?.eliminationFor ?? null
  const dates = seriesDateLine(series.round, series.key)
  const season = seasonSeriesLine(series, odds)
  // No model to show once a series is decided: a finished series has a winner, not a chance.
  const showOdds = !!odds && !winner && !!home.team && !!away.team

  return (
    <Box
      {...pressable(onOpen)}
      aria-label={onOpen ? `${series.label} overview` : undefined}
      sx={{
        borderRadius: 2, overflow: 'hidden', flex: 1, minWidth: 0,
        border: '1px solid', borderColor: isFinal ? 'var(--wpbl-medal-1)' : 'divider',
        bgcolor: 'background.paper',
        cursor: onOpen ? 'pointer' : 'default',
        ...(onOpen ? TAPPABLE : null),
        ...(onOpen ? FOCUS_RING : null),
        ...(fill ? { display: 'flex', flexDirection: 'column' } : {}),
      }}
    >
      <Box sx={{
        display: 'flex', alignItems: 'baseline', gap: 0.75, px: 1.25, py: 0.6,
        bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider',
      }}>
        <Typography sx={{
          fontSize: TYPE_SCALE.caption, fontWeight: 900, letterSpacing: 0.7, textTransform: 'uppercase',
          color: isFinal ? 'var(--wpbl-medal-1)' : 'text.disabled', whiteSpace: 'nowrap',
        }}>{series.label}</Typography>
        {elim && (
          <Typography sx={{
            fontSize: TYPE_SCALE.nano, fontWeight: 900, letterSpacing: 0.6, textTransform: 'uppercase',
            color: 'error.main', border: '1px solid', borderColor: 'error.main', borderRadius: 0.75,
            px: 0.5, py: 0.05, whiteSpace: 'nowrap', lineHeight: 1.3,
          }}>Elimination</Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{
          fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.secondary', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{series.summary}</Typography>
        {/* The affordance. A box that opens something has to say so somewhere, and the header
            band is the one strip of it that is chrome rather than content. */}
        {onOpen && (
          <Typography aria-hidden sx={{
            fontSize: TYPE_SCALE.caption, fontWeight: 900, color: 'text.disabled', flexShrink: 0,
          }}>›</Typography>
        )}
      </Box>
      {/* In the final, the two empty slots name their source semifinal. The bracket draws A on
          top and B below, and the connector runs A → the top (home) slot, so that is the match. */}
      <SeriesTeamRow entrant={home} series={series} leading={homeLeads}
        winP={showOdds ? odds!.homeWinP : null} wide={wide}
        placeholder={isFinal ? 'Semifinal A winner' : undefined} />
      <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }} />
      <SeriesTeamRow entrant={away} series={series} leading={awayLeads}
        winP={showOdds ? odds!.awayWinP : null} wide={wide}
        placeholder={isFinal ? 'Semifinal B winner' : undefined} />
      {/* The league's published dates, and the season series the odds are built on, as one line.
          Dates are dropped once a series is decided: when it was going to be played is no longer
          news, and a finished card should read as a record rather than a fixture list. The
          asterisk marks a game played only if the series is still alive. */}
      {(dates || season) && (
        <Box sx={{
          display: 'flex', alignItems: 'baseline', gap: 1, px: 1.25, pt: 0.6, pb: 0.7, minWidth: 0,
          borderTop: '1px solid', borderColor: 'divider',
        }}>
          <Typography sx={{
            fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.disabled',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{series.status !== 'done' ? dates : ''}</Typography>
          <Box sx={{ flex: 1 }} />
          {season && (
            <Typography sx={{
              fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.disabled',
              textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap', flexShrink: 0,
            }}>{season}</Typography>
          )}
        </Box>
      )}
      {children}
      {/* The reader's own call, once they have made one. Read-only: the asking happens in the
          sheet behind the card's one button, so a box that has not been picked stays a bracket. */}
      {bracket && picks && (
        <SeriesPickLine series={series} bracket={bracket} state={picks} />
      )}
    </Box>
  )
}

/** One row's worth of the elbow joining the two semifinals to the championship. Drawn only
 *  from `sm` up, where the three boxes sit side by side and the line has something to connect;
 *  stacked on a phone the boxes are already in reading order and a connector would be
 *  decoration.
 *
 *  THREE PIECES, ONE PER BRACKET ROW, BECAUSE ONLY THE GRID KNOWS WHERE THE BOXES ARE. The
 *  elbow used to be a single stretched box putting its stubs at 25% and 75% of its own height,
 *  which was right only because the semifinal boxes were stretched to a quarter of the column
 *  each: a quarter WAS their centre. That stretch is what left a band of empty card under both
 *  semifinals, which is the thing this is undoing. With the boxes back at their natural height
 *  the quarters point at nothing, so each stub now lives in the same grid row as the box it
 *  comes out of and sits at 50% of THAT row, which is that box's centre whatever it measures.
 *
 *  The championship's stub is at 50% of the middle row, and lands on the box because the
 *  right-hand column centres it over the same three rows. That also makes the middle row the
 *  only place the two halves have to agree, rather than four percentages that all have to. */
function ConnectorPiece({ row }: { row: 1 | 2 | 3 }) {
  const line = { borderColor: 'divider' } as const
  return (
    <Box aria-hidden sx={{
      display: { xs: 'none', sm: 'block' }, position: 'relative',
      gridColumn: 2, gridRow: row,
    }}>
      {/* Stub out of the semifinal in this row, at that box's vertical centre. */}
      {row !== 2 && (
        <Box sx={{ position: 'absolute', left: 0, width: '50%', top: '50%', borderTop: '1px solid', ...line }} />
      )}
      {/* The spine, in the piece of it this row owns: from the box's centre to the edge facing
          the middle, and straight through in the middle row. */}
      <Box sx={{
        position: 'absolute', left: '50%', borderLeft: '1px solid', ...line,
        top: row === 1 ? '50%' : 0,
        bottom: row === 3 ? '50%' : 0,
      }} />
      {/* Stub into the championship, on the spine's midpoint. */}
      {row === 2 && (
        <Box sx={{ position: 'absolute', left: '50%', width: '50%', top: '50%', borderTop: '1px solid', ...line }} />
      )}
    </Box>
  )
}

export function BracketDiagram({ bracket, odds, onOpenSeries, onOpenTeam, picks }: {
  bracket: WpblBracket; odds?: WpblPostseasonOdds | null
  /** Only the title-odds list uses this now; a series box opens its overview instead. */
  onOpenTeam?: OpenTeam
  /** Open one series' overview. Omitted by any caller that has nowhere to open one. */
  onOpenSeries?: (s: BracketSeries, o?: SeriesOdds) => void
  /** Omitted by any caller that wants the picture without the poll. */
  picks?: SeriesPickState
}) {
  /**
   * FULL CLUB NAMES ONCE THE COLUMN CAN HOLD ONE. The same call GameDetail's scoreboard makes,
   * and the same direction: a club's whole name where it reads, its nickname where it would not.
   *
   * THE QUERY IS ABOUT THE COLUMN, NOT THE SCREEN. A series box is half the card minus the
   * connector, so between 600 and 899 it is nearer 250px with the type scale still at 1, and
   * "San Francisco Firebells" would ellipsise to "San Francisco Fireb…", which is a worse answer
   * than the nickname it replaced.
   *
   * 1000 AND NOT 900, WHICH IS THE MEASUREMENT AND NOT A ROUND NUMBER. At 920px the longest name
   * fits at the default text size with nothing to spare, and clips by 8px at the Large setting
   * (1.125, see TEXT_SCALE_FACTOR): the setting grows the name and the two rem-sized columns
   * either side of it at once, so the string gets longer while its box gets narrower. 1000px
   * leaves about 30px of slack at Large, which is the width this should be judged at, since a
   * reader who has asked for bigger type is exactly the reader an ellipsis fails.
   */
  const wide = useMediaQuery('(min-width:1000px)')
  return (
    /* ONE GRID AT sm+, NOT A ROW OF COLUMNS, AND THE MIDDLE ROW IS WHAT CHANGED.
       The two halves of this diagram are different heights: the semifinals stack to their own
       content while the right-hand column is a centred championship with the title odds under
       it, which is always the taller of the two. As a flex row that difference was paid by the
       semifinal boxes, which stretched to fill the column and ended up with 40-odd px of blank
       card below their last line each. Rows of `auto 1fr auto` pay it out of the GAP between
       the two boxes instead, which is where a bracket wants its slack anyway: the boxes keep
       their natural height and the championship sits in the space that opens between them.

       Grid also gives the elbow something to measure against; see ConnectorPiece. DOM order is
       still the phone's reading order (semifinal A, semifinal B, the connector pieces which are
       display:none there, the label, then the championship), so the `xs` flex column needs no
       ordering of its own. */
    <Box sx={{
      display: { xs: 'flex', sm: 'grid' },
      flexDirection: 'column', alignItems: 'stretch', gap: { xs: 1, sm: 0 },
      gridTemplateColumns: { sm: '1fr 22px 1fr' },
      // `minmax` so the two boxes cannot touch if the right column ever comes out shorter
      // than they do: the middle row is slack, not structure.
      gridTemplateRows: { sm: 'auto minmax(8px, 1fr) auto' },
    }}>
      {bracket.semifinals.map((s, i) => (
        <Box key={s.label} sx={{ display: 'flex', minWidth: 0, gridColumn: 1, gridRow: i === 0 ? 1 : 3 }}>
          <SeriesBox series={s} odds={odds?.semifinals[i]}
            onOpen={onOpenSeries ? () => onOpenSeries(s, odds?.semifinals[i]) : undefined}
            bracket={bracket} picks={picks} wide={wide} />
        </Box>
      ))}
      <ConnectorPiece row={1} />
      <ConnectorPiece row={2} />
      <ConnectorPiece row={3} />
      {/* On a phone the championship follows the two semifinals in a column, so it gets a word
          instead of a line: without one it reads as a third semifinal. */}
      <Typography sx={{
        display: { xs: 'block', sm: 'none' },
        fontSize: TYPE_SCALE.caption, fontWeight: 900, letterSpacing: 0.7, textTransform: 'uppercase',
        color: 'text.disabled', textAlign: 'center', mt: 0.25,
      }}>The winners meet in the</Typography>
      {/* THE CHAMPIONSHIP TAKES THE WHOLE COLUMN, AND THE TITLE ODDS ARE INSIDE IT.
          Measured before touching it: this column ran `1fr auto 1fr` with a 137px box floating
          in the middle and the odds strip pinned to the bottom, which left a 598 by 165 hole in
          the top right doing nothing at all, and the left column carried 114px of matching slack
          between its two boxes. Roughly a quarter of a 506px card was blank.

          The fix is not to move something into the hole, it is to stop making one. Two boxes on
          the left against one on the right will always leave the right column short unless the
          one box is allowed to be tall, so it is: the championship stretches to the column and
          takes the title odds inside it, which is where they belonged anyway. "Chance to win it
          all" IS the championship's question, and it was being asked in a separate strip
          underneath the box that asks it.

          The elbow still lands, and needs no arithmetic to: a box that fills the column has its
          centre at the column's centre, which is what the connector points at. */}
      <Box sx={{ minWidth: 0, gridColumn: 3, gridRow: '1 / 4', display: 'flex', minHeight: 0 }}>
        <SeriesBox series={bracket.championship} odds={odds?.championship ?? undefined}
          onOpen={onOpenSeries ? () => onOpenSeries(bracket.championship, odds?.championship ?? undefined) : undefined}
          bracket={bracket} picks={picks} fill wide={wide}>
          {odds && <TitleOddsStrip odds={odds} onOpenTeam={onOpenTeam} />}
        </SeriesBox>
      </Box>
    </Box>
  )
}

/** The headline the bracket cannot draw: each club's chance to WIN IT ALL, ranked by that
 *  chance rather than by record. Ordered by probability, so a stronger lower seed can sit above
 *  a weaker higher one, which is the whole point of pricing it off run differential instead of
 *  reading the standings back. Champion crowned once the final is decided. */
function TitleOddsStrip({ odds, onOpenTeam }: {
  odds: WpblPostseasonOdds; onOpenTeam?: OpenTeam
}) {
  const dark = useWpblDark()
  if (odds.title.length === 0) return null
  const decided = odds.title.some(t => t.p >= 1)
  return (
    // INSIDE THE CHAMPIONSHIP BOX, under its meta line, which is why it carries the box's own
    // padding and a top rule rather than a margin. `mt: auto` is what claims the slack: the box
    // stretches to the column, the entrants stay at the top where the connector points at them,
    // and the difference collects here instead of above the box. Before this the strip was a
    // separate band and the slack was a hole.
    <Box sx={{
      width: '100%', minWidth: 0, mt: 'auto',
      px: 1.25, pt: 1, pb: 1.1, borderTop: '1px solid', borderColor: 'divider',
    }}>
      <Typography sx={{
        fontSize: TYPE_SCALE.caption, fontWeight: 900, letterSpacing: 0.7, textTransform: 'uppercase',
        color: 'text.disabled', mb: 0.75,
      }}>{decided ? 'Champion' : 'Chance to win it all'}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {odds.title.map(t => {
          const accent = wpblAccent(t.team.id, dark)
          const open = onOpenTeam
            ? () => { track(EVENTS.WPBL_BRACKET_TEAM, { teamId: t.team.id, seed: t.seed, from: 'title-odds' }); onOpenTeam(t.team) }
            : undefined
          return (
            <Box
              key={t.team.id}
              {...pressable(open)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.9, minWidth: 0,
                cursor: onOpenTeam ? 'pointer' : 'default', borderRadius: 1, px: 0.5, py: 0.3,
                ...(onOpenTeam ? TAPPABLE : null),
                ...FOCUS_RING,
              }}
            >
              <TeamBadge team={t.team} size={20} />
              {/* Fixed name column so every bar starts at the same x and the four read as one
                  chart. In rem because it is reserving room for a STRING: at a larger text size
                  a pixel version stays put while the name in it grows, and the ellipsis it keeps
                  as a backstop becomes the normal rendering.

                  NICKNAMES HERE, THOUGH, WHILE THE BOXES ABOVE USE FULL NAMES. This strip is a
                  chart and the bars are its subject: "San Francisco Firebells" needs 11rem of a
                  ~36rem row, which takes a third of the length out of every bar to say a city
                  four rows of the same card have already said. A series box is the opposite,
                  the club IS the subject there, which is why the two differ on purpose. */}
              <Typography sx={{
                width: '5.75rem', flexShrink: 0, fontSize: TYPE_SCALE.body, fontWeight: 700,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{t.team.name}</Typography>
              {/* The bar fills the row: name on the left, percentage on the right, no gap
                  between. Length is the probability, so the four bars are directly comparable. */}
              <Box sx={{ flex: 1, minWidth: 0, height: 8, borderRadius: 4, overflow: 'hidden', bgcolor: 'action.hover' }}>
                <Box sx={{ width: `${Math.max(t.p * 100, t.p > 0 ? 2 : 0)}%`, height: '100%', bgcolor: accent }} />
              </Box>
              <Typography sx={{
                width: '2.5rem', flexShrink: 0, fontSize: TYPE_SCALE.body, fontWeight: 800,
                fontVariantNumeric: 'tabular-nums', textAlign: 'right',
                color: t.p >= 1 ? accent : 'text.primary',
              }}>{fmtOdds(t.p)}</Typography>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

export default function PlayoffBracket({ rows, games, onOpenTeam, onOpenPlayer, onOpenGame, from = 'home' }: {
  /** Standings rows, in order, from `computeStandings`. */
  rows: WpblStandingRow[]
  games: WpblGame[]
  onOpenTeam?: OpenTeam
  /** For the series overview's leader lines. Optional: the card still opens one without it,
   *  the names just stop being links. */
  onOpenPlayer?: (p: WpblPlayer) => void
  /** For the series overview's season meetings, each of which opens its own box score. */
  onOpenGame?: (g: WpblGame) => void
  from?: string
}) {
  const bracket = useMemo(() => buildBracket(rows, games), [rows, games])
  const odds = useMemo(() => bracket ? postseasonOdds(bracket, rows, games) : null, [bracket, rows, games])
  // Games left is the seeding card's own figure, recomputed here rather than passed down so
  // the two cards cannot drift: each remaining game sits on two clubs, hence the halving.
  const left = useMemo(() => {
    const seeds = seedingRace(rows, games)
    return Math.round(seeds.reduce((n, s) => n + s.remaining, 0) / 2)
  }, [rows, games])

  // COLLAPSED BY DEFAULT ON A PHONE, EXPANDED EVERYWHERE ELSE.
  //
  // This is 709px on a 375px screen and it arrives at 57% scroll depth: 30% of a Home page that
  // is already 2.9 screens, on a section where 670 of 2,037 browsers fire exactly one event and
  // leave. It is also the one card here nobody needs on every visit, because a bracket in
  // August moves on the days a series is decided and not otherwise.
  //
  // WHAT COLLAPSES IS THE DRAWING, NOT THE ANSWER. The subtitle carries the leader and its
  // number while the card is shut, so a reader who never opens it still gets the headline the
  // bracket exists to deliver, in one line instead of eleven. A collapse that hides the point
  // along with the picture is just a card nobody opens.
  //
  // `noSsr` because the alternative is a first paint at 709px that snaps shut a frame later,
  // which is worse than either state. The choice persists, so opening it once is not a decision
  // the reader re-makes on every visit; a phone that cannot write localStorage simply gets the
  // default back each time.
  // The pick'em's ballot and tally, fetched once for the whole card. Held here rather than in
  // each strip so three series make two requests instead of six, and gated on the card having
  // a bracket at all: two RPCs on a page that is not going to draw a question would be spent
  // for nothing.
  const picks = useSeriesPicks(!!bracket)
  /** The series whose overview is open, with the odds it was drawn from. Held here rather than
   *  in the box so the sheet is a sibling of the card and not a child of a 300px column. */
  const [openSeries, setOpenSeries] = useState<{ series: BracketSeries; odds?: SeriesOdds } | null>(null)

  const isPhone = useMediaQuery('(max-width:599.95px)', { noSsr: true })
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(BRACKET_OPEN_KEY) === '1' } catch { return false }
  })
  const toggle = () => setOpen(v => {
    try { localStorage.setItem(BRACKET_OPEN_KEY, v ? '0' : '1') } catch { /* private mode, non-fatal */ }
    return !v
  })

  const logged = useRef(false)
  useEffect(() => {
    if (logged.current || !bracket) return
    logged.current = true
    track(EVENTS.WPBL_BRACKET_SHOWN, {
      settled: bracket.settled, started: bracket.started, gamesLeft: left, from,
    })
  }, [bracket, left, from])

  if (!bracket) return null

  // Three states, one card. The subtitle is the only part that changes, because it is the only
  // part whose meaning does: the same boxes are a projection, then a scoreboard, then a record.
  // Kept to one line on a phone: the format (best-of-N) shows in each series box, and the
  // seeding mechanic in the footnote below, so the subtitle need not carry either.
  const subtitle =
    bracket.champion ? `${bracket.champion.name} are the inaugural champions.`
    : bracket.started ? 'Series odds, updated after every game.'
    : bracket.settled ? 'Seeds are set. Semifinals begin Sep 9.'
    : 'The bracket and title odds as they stand today.'

  // The one line the card is worth while it is shut: who is favourite, and by how much. It
  // replaces the subtitle rather than joining it, because the subtitle above describes the
  // PICTURE ("the bracket and title odds as they stand today"), and a description of a picture
  // nobody can see is the least useful line available. A crowned champion already IS the
  // headline, so that one stands.
  const favourite = odds?.title[0]
  const shutSubtitle = bracket.champion || !favourite ? subtitle
    : `${favourite.team.name} ${fmtOdds(favourite.p)} to win it all`

  const collapsed = isPhone && !open

  return (
    <SectionCard
      title={bracket.started ? 'Postseason' : 'Road to the title'}
      subtitle={collapsed ? shutSubtitle : subtitle}
      collapsed={isPhone ? collapsed : undefined}
      onToggleCollapse={isPhone ? toggle : undefined}
      // A collapsed card renders none of its children, so the button at the top of the body is
      // behind a tap on the one surface that opens this card shut. The header keeps a compact
      // one, which opens the sheet without expanding the card first. Only one of the two is ever
      // in the page.
      action={collapsed ? <PickemButton bracket={bracket} state={picks} from={from} compact /> : undefined}
    >
      {/* FIRST IN THE CARD, ABOVE THE DIAGRAM. It is the one thing here a reader can DO, and
          everything under it is something to read. The collapsed card has its own in the
          header; see `action` above. */}
      <PickemButton bracket={bracket} state={picks} from={from} />
      <BracketDiagram bracket={bracket} odds={odds} onOpenTeam={onOpenTeam} picks={picks}
        onOpenSeries={(s, o) => {
          track(EVENTS.WPBL_BRACKET_SERIES, { round: s.round, key: s.key, status: s.status, from })
          setOpenSeries({ series: s, odds: o })
        }} />
      {openSeries && (
        <SeriesPreview
          series={openSeries.series} odds={openSeries.odds}
          teams={rows.map(r => r.team)} games={games} rows={rows}
          onClose={() => setOpenSeries(null)}
          onOpenTeam={onOpenTeam} onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame}
        />
      )}
      {odds && !bracket.champion && (
        <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled', mt: 1, lineHeight: 1.45 }}>
          Odds blend each club’s run differential with its head-to-head results, then
          play the bracket out to a champion.
        </Typography>
      )}
    </SectionCard>
  )
}
