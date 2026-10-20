import { useDark } from '../../ui/useDark'
import { NameText } from '../../ui/NameText'
import { edge } from '../../ui/card'
import { Box, Typography } from '@mui/material'
import { TeamBadge, PlayerPortrait, pressable, FOCUS_RING, TAPPABLE, TYPE_SCALE, chromePx } from '../ui'
import { useWpblPlayerLink, useWpblTeamLink } from '../LinkContext'
import { wpblManagerPortraitSet } from '../portraits'
import { wpblAccent } from '../constants'
import { useEraBasis } from '../EraBasisContext'
import type { WpblAward } from '../awards'
import type { AwardCandidate } from '../derive/awards'
import type { WpblPlayer, WpblTeam } from '../types'
import { typePx } from '../../ui/scale'

// ─── one candidate, one tap ──────────────────────────────────────────────────────

/**
 * The crowd's number, on the corner of the face it belongs to.
 *
 * NOT A LINE UNDER THE FIGURES. A tile's last row is a grid of value-over-label pairs, so a bare
 * "50%" beneath it lands under a stat in the same column with no label of its own, and the eye
 * reads it as another line of that stat rather than as the poll. The figures are about the player
 * and this number is about the people voting, so it goes somewhere the figures are not.
 *
 * ON THE PORTRAIT RATHER THAN IN A CORNER OF THE TILE, because the tile's corners are taken.
 * Top right is the link out to the player's page, and the bottom edge is the stats row on a
 * phone, where the tile is a centered column and there is no free margin either side of it. The
 * portrait is in the same place at both breakpoints and is the one element every tile has.
 *
 * AND IT COSTS NO LAYOUT. `showShare` is `!!picked || closed`, so it flips for a whole question
 * at once: a row that appeared on the first vote would grow all four tiles together and push
 * every question below down the sheet under the reader's thumb. An overlay cannot move anything,
 * so nothing has to be reserved.
 *
 * The tick stays, and stays inside the pill: `aria-checked` has already said this is your
 * answer to a screen reader, and the ring and the tint say it in color. The tick is the one
 * signal that is neither.
 */
function ShareBadge({ share, on, accent, dark }: {
  share: number; on: boolean; accent: string; dark: boolean
}) {
  return (
    <Box sx={{
      // Centered ON the portrait's bottom edge, rather than hung off its corner or sat under
      // its chin. Two things this is dodging, both only visible at a text scale nobody
      // developing it is using: the corner put the pill in the gap between the portrait and
      // the text column, inches from the first stat value, and that gap is chrome, which does
      // not grow with the reader's type while the pill does. And a pill anchored by its
      // BOTTOM grows upward over the face for the same reason. Straddling the edge splits
      // that growth in two, half of it into the gap under the portrait.
      position: 'absolute', top: '100%', left: '50%', transform: 'translate(-50%, -50%)',
      display: 'flex', alignItems: 'center', gap: '0.15em',
      // Sized by its own text, in em, so the pill grows with the reader's type instead of
      // clipping "100%" at Large. The offsets above are ornament and stay raw px.
      px: '0.4em', py: '0.2em', borderRadius: '999px',
      fontSize: TYPE_SCALE.caption, fontWeight: 800, lineHeight: 1,
      fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      // A pill sitting half on a photograph needs its own ground, or the digits land on
      // whatever the crop happens to have behind them. Yours is filled; everyone else's is
      // the card's own surface with a hairline, so four tiles do not read as four selections.
      color: on ? '#fff' : 'text.secondary',
      bgcolor: on ? accent : (dark ? '#161a20' : '#fff'),
      border: '1px solid', borderColor: on ? edge(accent) : 'outline',
    }}>
      {on && <Box component="span" aria-hidden sx={{ fontWeight: 900 }}>✓</Box>}
      {Math.round(share * 100)}%
    </Box>
  )
}

export function CandidateTile({ candidate, award, team, player, on, share, showShare, reserveStats,
  onPick, onOpenPlayer, onOpenTeam }: {
  candidate: AwardCandidate
  award: WpblAward
  /** The club behind a club vote, for its badge. Null for a player pick, which draws a portrait. */
  team?: WpblTeam | null
  /** The player's roster row, for the link out to their page. Absent for a club, a game or a
   *  play, and for a write-in naming somebody the roster no longer carries. */
  player?: WpblPlayer | null
  on: boolean
  share: number
  showShare: boolean
  /** True where some tile on this question carries figures, so the ones that do not hold the
   *  room anyway and the grid row keeps one height. See the reserved pair below. */
  reserveStats?: boolean
  onPick: () => void
  onOpenPlayer?: (p: WpblPlayer) => void
  /** The way out of a MANAGER's card, which has no player page to go to. See the chip below. */
  onOpenTeam?: (t: WpblTeam) => void
}) {
  const dark = useDark()
  const playerLink = useWpblPlayerLink()
  const teamLink = useWpblTeamLink()
  const accent = wpblAccent(candidate.teamId, dark)
  // THE ONE FIGURE THIS COMPONENT HAS TO SPELL ITSELF. Everything else on a tile arrives
  // pre-formatted from a pure builder, but ERA is stored on the league's basis and the reader
  // can flip it, so the builder hands over the raw number and the scaling happens here, where
  // the setting is readable. `fmtEra` is the same one the stats board and the player page use,
  // so a pitcher cannot read 4.72 on one surface and 6.07 on another.
  const { fmtEra } = useEraBasis()
  // Null for everybody but the four managers, whose art is bundled and keyed on their own id
  // rather than on a name: see wpblManagerPortrait.
  const headshot = wpblManagerPortraitSet(candidate.key)
  const stats = candidate.stats ?? []
  // WHERE THIS CARD LETS YOU OUT, or null where it cannot. A player goes to their page; a manager,
  // who has none, goes to their club's. Resolved once here rather than twice in the markup so the
  // chip below stays one control with one shape, and so a category that is neither (a game, a
  // play, a write-in the roster no longer carries) simply has no chip instead of a dead one.
  const exit = player && onOpenPlayer
    ? { link: playerLink(player, onOpenPlayer), label: `Open ${candidate.name}'s player page` }
    : !player && team && onOpenTeam
      ? { link: teamLink(team, () => onOpenTeam(team)), label: `Open the ${team.name} page` }
      : null
  return (
    <Box
      {...pressable(onPick)}
      role="radio"
      aria-checked={on}
      aria-label={`${award.title}: ${candidate.name}`}
      sx={{
        position: 'relative', overflow: 'hidden',
        // STACKED ON A PHONE, ACROSS THE CARD FROM `sm`, and the width is the whole reason.
        // Two columns of a 720px sheet is 340px a card. A centered column inside 340px is a 46px
        // portrait with 140px of nothing either side of it. Laid across, the portrait sits left and
        // the name and figures use the rest, which is what a player card looks like.
        //
        // A phone keeps the column: two columns of 375px is 165px a card, and 165px minus a
        // portrait and a gap leaves about 100px for a name, which is not a row.
        // The xs gap holds the lower half of the share pill, which straddles the portrait's
        // bottom edge; any tighter and the pill sits on the name. See ShareBadge.
        display: 'flex', gap: { xs: 1.1, sm: 1 },
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: 'center',
        borderRadius: 2, border: '1px solid',
        px: { xs: 0.75, sm: 1.25 }, py: 1.1, cursor: 'pointer',
        borderColor: on ? edge(accent) : 'outline',
        bgcolor: on ? `${accent}2e` : 'transparent',
        // The same ring and tick the pick'em uses, for the same reason it needed them: the share
        // behind the card is drawn in this club's accent too, so a selection made only of that
        // accent competes with the crowd's answer instead of standing out from it.
        boxShadow: on ? `inset 0 0 0 2px ${accent}` : 'none',
        ...TAPPABLE, ...FOCUS_RING,
      }}
    >
      {/* The crowd, as a column filling from the bottom rather than a bar across the middle: on
          a card the horizontal wipe cut straight through the portrait and the name. */}
      {showShare && (
        <Box aria-hidden sx={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: `${Math.round(share * 100)}%`,
          bgcolor: accent, opacity: on ? 0.22 : 0.11,
        }} />
      )}
      {/* A WAY OUT OF THE CARD, ON EVERY CARD, BEFORE THE VOTE RATHER THAN AFTER IT.
          The moment a reader wants to look a player up is while they are deciding between four
          of them, not after, so every tile carries its own link rather than one link under the
          grid once you have answered.

          A CHEVRON RATHER THAN A WORD, because the tile is already carrying a portrait, a name,
          a position, five figures and a tally, and "View page" on each of four cards is four
          more strings in a grid that is full. `aria-label` says the whole sentence, so nothing
          is lost to a screen reader.

          IT IS DRAWN AS A CHIP, AND THAT IS THE WHOLE ANSWER TO "WHICH ONE AM I TAPPING". A
          thumb needs about 32px and a bare glyph gives it 26, but simply growing an invisible
          target inside a card whose every other pixel casts a vote makes the ambiguity worse
          rather than better: the reader cannot see where one control stops and the other starts,
          so a near miss either votes for somebody they were only curious about or opens a page
          they meant to vote for. So the target and the thing you can see are the same shape. The
          ring and the tint are faint enough to stay ornament on a card that is already full, and
          they are what makes the size legible.

          A REAL ANCHOR, via `playerLink`: it stops the click from reaching the tile (which would
          cast a vote on the way past), and it leaves a modified click alone so open-in-new-tab
          works. See CLAUDE.md on onClick-only controls. */}
      {/* AND MANAGER OF THE YEAR GETS ONE TOO, to the club rather than to a player page, because
          it is the only category whose four names have no page of their own: the feed carries no
          managers at all (see WPBL_MANAGERS), so the club's is the page the question is actually
          about. Without it this would be the one card on the sheet a reader could not leave,
          which is exactly backwards for the category where the case is a record and a run
          differential that live somewhere else.

          The same chip, the same corner, the same size. A different destination is not a reason
          for a different control: a reader who has learned the arrow on four MVP cards should not
          have to learn a second thing one category down. */}
      {exit && (
        <Box
          {...exit.link}
          aria-label={exit.label}
          // The hover tooltip says what the arrow DOES, not where it goes: "Open Denae
          // Benites's player page" is the right thing for a screen reader, which reads the
          // control cold, and a needlessly long label on a mouse that is already over the
          // name. `aria-label` keeps the specific one.
          title="View full stats"
          sx={{
            // 4px is ornament, not structure: it keeps the chip off the corner radius and has no
            // string and no tap target to grow with.
            position: 'absolute', top: '4px', right: '4px',
            // Structure, so it holds its size against the type: see chromePx in ui.tsx. 32px is
            // the thumb, and it is the visible chip rather than an invisible margin around a
            // glyph, for the reason in the note above. Still under the 44px guidance on purpose:
            // the rest of the card is a control too, and the vote is the one this sheet is for.
            width: chromePx(32), height: chromePx(32),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '50%', cursor: 'pointer', zIndex: 1,
            color: 'text.secondary',
            border: '1px solid', borderColor: 'outline',
            bgcolor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            ...TAPPABLE, ...FOCUS_RING,
            '@media (hover: hover)': {
              '&:hover': { color: accent, borderColor: edge(accent) },
            },
          }}
        >
          {/* AN ARROW OUT, NOT A CHEVRON. A '›' is the section's own "next" mark: it pages the
              rails on Home and it opens the row it sits at the end of. On a card that is itself
              a control it would read as "more of this card", which is the one thing it does
              not do. The diagonal is the mark for leaving, and this leaves: it puts a whole
              other page over the ballot.

              DRAWN, NOT TYPESET, which is what centers it. A glyph ('›', '↗') is not centered in
              its own box in any font and carries a text node's line-height besides, so it lands
              high and right in the circle and no nudge holds at every text scale. This path is
              symmetric about (12, 12) in its own viewBox, so it is centered by construction, at
              any size and in any font the reader has. */}
          <Box component="svg" aria-hidden viewBox="0 0 24 24" sx={{
            width: chromePx(13), height: chromePx(13), display: 'block',
          }}>
            <path d="M8 16L16 8M9.5 8H16v6.5" fill="none" stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" />
          </Box>
        </Box>
      )}
      {/* A face where there is one, and a badge where there is not. Manager of the Year is the
          category this distinction was written for: the vote is for a person, so a club crest
          on the tile made four tiles that looked like a vote for the club, which is the exact
          reading `mgr:<slug>` exists to prevent. A game or a play still draws the badge, since
          the thing being voted for really is a night rather than a face. */}
      <Box sx={{ position: 'relative', display: { xs: 'flex', sm: 'none' } }}>
        {candidate.playerId || headshot
          ? <PlayerPortrait name={candidate.name} teamId={candidate.teamId} size={46} src={headshot} />
          : team ? <TeamBadge team={team} size={46} /> : null}
        {showShare && <ShareBadge share={share} on={on} accent={accent} dark={dark} />}
      </Box>
      {/* Two renders rather than one responsive size, because neither component takes a
          breakpoint map for `size`: they draw an <img> at a number of pixels. Only one is ever
          in the layout, and the other costs a display:none node. */}
      <Box sx={{ position: 'relative', display: { xs: 'none', sm: 'flex' }, flexShrink: 0 }}>
        {candidate.playerId || headshot
          ? <PlayerPortrait name={candidate.name} teamId={candidate.teamId} size={54} src={headshot} />
          : team ? <TeamBadge team={team} size={54} /> : null}
        {showShare && <ShareBadge share={share} on={on} accent={accent} dark={dark} />}
      </Box>
      <Box sx={{
        position: 'relative', width: '100%', minWidth: 0,
        textAlign: { xs: 'center', sm: 'left' },
      }}>
        {candidate.playerId
          ? <NameText name={candidate.name} sx={{ fontSize: TYPE_SCALE.body, fontWeight: on ? 800 : 700, lineHeight: 1.25 }} />
          : <Typography sx={{
              fontSize: TYPE_SCALE.body, fontWeight: on ? 800 : 700, lineHeight: 1.25,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{candidate.name}</Typography>}
        {/* Whatever the figures do not already say: the club a manager runs, the "if needed" on a
            play, the note that Boston changed benches in week one. Dropped when the stats below
            already carry the same sentence, which is the ordinary player case. */}
        {(candidate.sub || (stats.length === 0 && candidate.line)) && (
          <Typography sx={{
            fontSize: TYPE_SCALE.caption, color: 'text.disabled', lineHeight: 1.35,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>{candidate.sub ?? candidate.line}</Typography>
        )}

      {stats.length > 0 && (
        <Box sx={{
          position: 'relative', width: '100%',
          display: 'flex', justifyContent: { xs: 'center', sm: 'flex-start' },
          gap: { xs: 0.9, sm: 1.4 }, mt: 0.35,
        }}>
          {stats.map((st, i) => (
            // HOW MANY FIT IS A QUESTION ABOUT WIDTH, so it is answered per breakpoint rather
            // than by the slate, and the answer is measured rather than guessed. THREE ON A
            // PHONE: at 375px the tile is 164px with 152px inside it, and a column costs about
            // 38px (the widest real value is an OPS of "1.752" at 41px, the widest label a
            // letter-spaced "WHIP" at ~34px). Three plus two 7px gaps is ~128px and fits; four
            // needs ~174px and does not, which is why this stops at three no matter how much
            // the slates would like to say.
            //
            // FIVE FROM `sm`, where the sheet is 560px wide and a tile has ~248px inside it:
            // five columns plus four 11px gaps is ~235px. `md` widens the sheet to 880 and
            // needs no separate step, since no slate offers more than five.
            //
            // Every slate orders its figures so the ones that drop are the least load-bearing,
            // which is what makes a blunt cut safe: see valueStats on why RBI is last and
            // armSlate on why a reliever's saves are second.
            <Box key={st.label} sx={{
              minWidth: 0, textAlign: { xs: 'center', sm: 'left' },
              ...(i >= 3 ? { display: { xs: 'none', sm: 'block' } } : null),
            }}>
              <Typography sx={{
                fontSize: TYPE_SCALE.body, fontWeight: 800, lineHeight: 1.15,
                fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
              }}>{st.eraBasisValue !== undefined ? fmtEra(st.eraBasisValue) : st.value}</Typography>
              {/* 700 at `caption`, inside the ceiling in ui.tsx: this is 9.6px uppercase on a
                  phone and a heavier one closes its own counters up. */}
              <Typography sx={{
                fontSize: TYPE_SCALE.caption, fontWeight: 700, letterSpacing: typePx(0.4),
                textTransform: 'uppercase', color: 'text.disabled', lineHeight: 1.3,
                whiteSpace: 'nowrap',
              }}>{st.label}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* A TILE WITH NO FIGURES STANDS AS TALL AS THE ONES BESIDE IT, and this hidden pair is
          what makes it. A write-in and a search hit carry a name and nothing else, so they
          would come out one text pair shorter than every seeded tile; alone on the last row of
          the grid there is nothing to stretch against, so the card would visibly shrink and the
          share pill on its portrait sit at a different height from the four above it.

          `visibility: hidden` rather than a measured `minHeight`: the row it is holding room for
          is two lines of type at two different sizes, and any number written down here would be
          right at one text scale and wrong at the rest. The placeholder is the section's own
          glyph for "no value", so if this ever becomes visible by accident it reads as a blank
          figure rather than as a mistake.

          ONLY WHERE THE QUESTION HAS FIGURES AT ALL. Aura, Play and Game card nobody on numbers,
          so reserving the row there would put an empty band under every tile on those three
          questions to no purpose. `reserveStats` is decided once per question, not per tile. */}
      {stats.length === 0 && reserveStats && (
        <Box aria-hidden sx={{
          visibility: 'hidden', width: '100%', mt: 0.35,
          textAlign: { xs: 'center', sm: 'left' },
        }}>
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, lineHeight: 1.15 }}>—</Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, lineHeight: 1.3 }}>—</Typography>
        </Box>
      )}

      </Box>
    </Box>
  )
}
