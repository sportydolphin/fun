import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import {
  SectionCard, ModalShell, TeamBadge, PlayerPortrait,
  pressable, linkPress, FOCUS_RING, TAPPABLE, hoverOnly, useWpblDark, useWpblName, TYPE_SCALE, chromePx,
} from './ui'
import { useWpblPlayerLink, useWpblTeamLink } from './LinkContext'
import { wpblManagerPortrait } from './portraits'
import { wpblAccent } from './constants'
import { useEraBasis } from './EraBasisContext'
import { fanVoteAwards, AWARDS_CLOSE_LABEL, WPBL_AWARDS_CREDIT, awardsCreditLine } from './awards'
import { WPBL_AWARDS_PATH } from './routes'
import type { WpblAward } from './awards'
import { buildAwardBallot, withWriteIns } from './derive/awards'
import type { AwardBallotEntry, AwardCandidate } from './derive/awards'
import {
  fetchWpblAwardBallot, fetchWpblAwardResults, castWpblAwardVote, clearWpblAwardVote,
  awardVoteCount,
} from './awardVotes'
import type { AwardBallot, AwardResults } from './awardVotes'
import { searchPlayers } from './playerSearch'
import { fetchWpblAllFielding, getCachedWpblAllFielding } from './api'
import { track, EVENTS } from '../lib/analytics'
import { useAuth } from '../AuthContext'
import type { MvpRace } from './derive/mvpRace'
import type {
  WpblBattingLine, WpblFieldingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblRunValuePlay,
  WpblTeam,
} from './types'

/**
 * The fan awards: five questions, one card on Home, one sheet to answer them in.
 *
 * WHAT THIS IS REPLACING, AND WHAT IT IS NOT. The MVP race card held this slot and answered a
 * question the site had already answered everywhere else: the race is a number, the number is on
 * the Stats tab, and the card was a third rendering of it. This asks something the section
 * genuinely cannot answer, which is what the people reading it think. It is also the first
 * surface on `/wpbl` that a reader can put something INTO rather than take something out of,
 * and the one thing here that keeps working after Sep 22, when the feed goes quiet and every
 * other card on this page freezes.
 *
 * THE ENGINE ALREADY EXISTED AND HAD NEVER BEEN DRAWN. `awards.ts` is the catalog, and
 * `derive/awards.ts` builds every shortlist from figures the section already publishes: the MVP
 * race for value, the run-expectancy table for runs saved, the qualifier bar for who counts as a
 * regular. Both are tested. All this file does is render them and take the answer, which is why
 * it contains no arithmetic about baseball at all.
 *
 * A SHORTLIST IS A STARTING POINT, NOT A BALLOT PAPER. Every category takes a vote for anybody
 * in the league through the search below the names, and every seeded category prints where its
 * names came from. That distinction is the whole reason the search is not hidden behind a "more"
 * link: an award whose winner can only be one of six names the site chose is the site's award.
 *
 * NO ACCOUNT, DELIBERATELY, AND IT IS THE OPPOSITE CALL FROM THE PICK'EM NEXT DOOR. Votes key on
 * the browser id (`awardVoterKey`), which is what CLAUDE.md records for this table and the reason
 * is that the two features want opposite trades: the pick'em publishes its tally back as the
 * feature itself and so needs a key that is more work to mint than a private window, while a poll
 * with nothing at stake loses more real answers to a sign-in wall than it saves fake ones. A cleared cache is a lost vote here and that is
 * accepted.
 *
 * THE TALLY IS HIDDEN UNTIL YOU ANSWER, per category, same rule the pick'em uses: a poll that
 * shows its results first stops measuring what people think and starts measuring what the first
 * fifty people thought.
 */

// ─── the ballot, and the vote ────────────────────────────────────────────────────

export interface FanVoteState {
  ballot: AwardBallot
  results: AwardResults
  loaded: boolean
  /** Whether this reader can answer at all. A signed-out reader reads the whole ballot and
   *  votes on none of it: every tile turns into the ask instead. */
  canPick: boolean
  /** Open the sign-in dialog, which is what a tile does for a reader who cannot vote yet. */
  signIn: () => void
  cast: (category: string, choice: string) => void
  clear: (category: string) => void
}

/**
 * This browser's answers and the running tally, held once for all five categories.
 *
 * ONE PIECE OF STATE HOLDING BOTH HALVES, for the reason the pick'em's copy of this spells out:
 * a vote moves the ballot and the tally together, and doing the second inside the first's updater
 * is a side effect in a function React may call twice, which under StrictMode counts your own
 * vote twice on your own screen and nowhere else.
 */
export function useFanVote(enabled: boolean): FanVoteState {
  // THE ACCOUNT IS THE BALLOT ID, the same key the pick'em writes under and for the reasons in
  // awardVotes.ts: the tally is published back to the reader, so it has to cost more than a
  // private window to move, and it has to survive a cleared cache and follow them to a phone.
  const { user, openAuthDialog } = useAuth()
  const voterKey = user?.id ?? null
  const [state, setState] = useState<{ ballot: AwardBallot; results: AwardResults; loaded: boolean }>(
    { ballot: {}, results: {}, loaded: false })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    // The tally is public and is read either way: a reader who cannot vote yet still sees what
    // everyone else thinks once they have answered nothing, which is the same rule as before.
    // Only the BALLOT needs a key, and a signed-out reader has no ballot rather than an empty one.
    Promise.all([
      voterKey ? fetchWpblAwardBallot(voterKey) : Promise.resolve({} as AwardBallot),
      fetchWpblAwardResults(),
    ]).then(([ballot, results]) => {
      if (!cancelled) setState({ ballot, results, loaded: true })
    })
    return () => { cancelled = true }
  }, [enabled, voterKey])

  const cast = (category: string, choice: string) => {
    // Refused here as well as in the UI. The controls send a signed-out reader to the dialog
    // instead of calling this, and this is what makes that a rule rather than a habit: without
    // it, one call site that forgets is a vote written under nobody, which is exactly how a
    // table at zero rows comes to look like a poll nobody answered.
    if (!voterKey) { openAuthDialog('signin'); return }
    setState(prev => {
      const was = prev.ballot[category]
      if (was === choice) return prev
      const bucket = { ...(prev.results[category] ?? {}) }
      if (was) bucket[was] = Math.max(0, (bucket[was] ?? 1) - 1)
      bucket[choice] = (bucket[choice] ?? 0) + 1
      return { ...prev, ballot: { ...prev.ballot, [category]: choice }, results: { ...prev.results, [category]: bucket } }
    })
    track(EVENTS.WPBL_AWARD_VOTE, { category, choice })
    // Not rolled back on failure, same reasoning as the pick'em: the write is a definer function,
    // so a failure is a lost vote rather than a wrong one, and pulling a selection back out from
    // under somebody is a worse answer to a flaky network than letting them tap again.
    void castWpblAwardVote(category, choice, voterKey)
  }

  const clear = (category: string) => {
    if (!voterKey) return
    setState(prev => {
      const was = prev.ballot[category]
      if (!was) return prev
      const ballot = { ...prev.ballot }; delete ballot[category]
      const bucket = { ...(prev.results[category] ?? {}) }
      bucket[was] = Math.max(0, (bucket[was] ?? 1) - 1)
      return { ...prev, ballot, results: { ...prev.results, [category]: bucket } }
    })
    void clearWpblAwardVote(category, voterKey)
  }

  return { ...state, cast, clear, canPick: !!voterKey, signIn: () => openAuthDialog('signin') }
}

// ─── one candidate, one tap ──────────────────────────────────────────────────────

/**
 * The crowd's number, on the corner of the face it belongs to.
 *
 * IT USED TO BE A LINE OF ITS OWN UNDER THE FIGURES, and that is the whole reason this
 * component exists. A tile's last row is a grid of value-over-label pairs, so a bare "50%"
 * printed beneath it landed directly under an AVG of .451 in the same column, with no label
 * of its own: the eye read it as a fourth line of that stat rather than as the poll. The
 * figures are about the player and this number is about the people voting, so it is now
 * somewhere the figures are not.
 *
 * ON THE PORTRAIT RATHER THAN IN A CORNER OF THE TILE, because the tile's corners are taken.
 * Top right is the link out to her page, and the bottom edge is the stats row on a phone,
 * where the tile is a centred column and there is no free margin either side of it. The
 * portrait is in the same place at both breakpoints and is the one element every tile has.
 *
 * AND IT COSTS NO LAYOUT, which the old row went to some trouble to arrange. `showShare` is
 * `!!picked || closed`, so it flips for a whole question at once: the first vote in a category
 * used to grow all four tiles by a line together, which grew the grid, which pushed every
 * question below it down the sheet under the reader's thumb. The old row was therefore
 * reserved from first paint and left empty until there was something to put in it. An overlay
 * cannot move anything, so nothing has to be reserved and the tile is a line shorter.
 *
 * The tick stays, and stays inside the pill: `aria-checked` has already said this is your
 * answer to a screen reader, and the ring and the tint say it in colour. The tick is the one
 * signal that is neither.
 */
function ShareBadge({ share, on, accent, dark }: {
  share: number; on: boolean; accent: string; dark: boolean
}) {
  return (
    <Box sx={{
      // Centred ON the portrait's bottom edge, rather than hung off its corner or sat under
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
      border: '1px solid', borderColor: on ? accent : 'divider',
    }}>
      {on && <Box component="span" aria-hidden sx={{ fontWeight: 900 }}>✓</Box>}
      {Math.round(share * 100)}%
    </Box>
  )
}

function CandidateTile({ candidate, award, team, player, on, share, showShare, reserveStats,
  onPick, onOpenPlayer, onOpenTeam }: {
  candidate: AwardCandidate
  award: WpblAward
  /** The club behind a club vote, for its badge. Null for a player pick, which draws a portrait. */
  team?: WpblTeam | null
  /** Her roster row, for the link out to her page. Absent for a club, a game or a play, and for
   *  a write-in naming somebody the roster no longer carries. */
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
  const dark = useWpblDark()
  const playerLink = useWpblPlayerLink()
  const teamLink = useWpblTeamLink()
  const short = useWpblName()
  const accent = wpblAccent(candidate.teamId, dark)
  // THE ONE FIGURE THIS COMPONENT HAS TO SPELL ITSELF. Everything else on a tile arrives
  // pre-formatted from a pure builder, but ERA is stored on the league's basis and the reader
  // can flip it, so the builder hands over the raw number and the scaling happens here, where
  // the setting is readable. `fmtEra` is the same one the stats board and the player page use,
  // so a pitcher cannot read 4.72 on one surface and 6.07 on another.
  const { fmtEra } = useEraBasis()
  // Null for everybody but the four managers, whose art is bundled and keyed on their own id
  // rather than on a name: see wpblManagerPortrait.
  const headshot = wpblManagerPortrait(candidate.key)
  const stats = candidate.stats ?? []
  // WHERE THIS CARD LETS YOU OUT, or null where it cannot. A player goes to her page; a manager,
  // who has none, goes to her club's. Resolved once here rather than twice in the markup so the
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
        // Two columns of a 720px sheet is 340px a card. A centred column inside 340px is a 46px
        // portrait with 140px of nothing either side of it, which is the same empty space the
        // four-column grid was creating, moved inside the card. Laid across, the portrait sits
        // left and the name and figures use the rest, which is what a player card looks like.
        //
        // A phone keeps the column: two columns of 375px is 165px a card, and 165px minus a
        // portrait and a gap leaves about 100px for a name, which is not a row.
        // The xs gap holds the lower half of the share pill, which straddles the portrait's
        // bottom edge: at 0.6 it was 5px of room for an 8px overhang and the pill sat on the
        // name. See ShareBadge.
        display: 'flex', gap: { xs: 1.1, sm: 1 },
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: 'center',
        borderRadius: 2, border: '1px solid',
        px: { xs: 0.75, sm: 1.25 }, py: 1.1, cursor: 'pointer',
        borderColor: on ? accent : 'divider',
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
          The sheet used to offer one "Open <name>" link under the grid and only once you had
          answered, which is the wrong way round twice: the moment a reader wants to look a
          player up is while they are deciding between four of them, and by the time they have
          decided the link they are given is to the one name they no longer have a question
          about. Every tile now carries its own, and the footer link is gone.

          A CHEVRON RATHER THAN A WORD, because the tile is already carrying a portrait, a name,
          a position, five figures and a tally, and "View page" on each of four cards is four
          more strings in a grid that is full. `aria-label` says the whole sentence, so nothing
          is lost to a screen reader.

          IT IS DRAWN AS A CHIP, AND THAT IS THE WHOLE ANSWER TO "WHICH ONE AM I TAPPING". A
          thumb needs about 32px and a bare glyph gave it 26, but simply growing an invisible
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
          managers at all (see WPBL_MANAGERS), so hers does not exist and the club's is the page
          the question is actually about. Without it this was the one card on the sheet a reader
          could not leave, which is exactly backwards for the category where the case is a record
          and a run differential that live somewhere else.

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
            border: '1px solid', borderColor: 'divider',
            bgcolor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            ...TAPPABLE, ...FOCUS_RING,
            '@media (hover: hover)': {
              '&:hover': { color: accent, borderColor: accent },
            },
          }}
        >
          {/* AN ARROW OUT, NOT A CHEVRON. A '›' is the section's own "next" mark: it pages the
              rails on Home and it opens the row it sits at the end of. On a card that is itself
              a control it therefore read as "more of this card", which is the one thing it does
              not do. The diagonal is the mark for leaving, and this leaves: it puts a whole
              other page over the ballot.

              DRAWN, NOT TYPESET, which is what fixed the centring. A glyph ('›', '↗') is not
              centred in its own box in any font and carries a text node's line-height besides,
              so it landed high and right in the circle and no nudge held at every text scale.
              This path is symmetric about (12, 12) in its own viewBox, so it is centred by
              construction, at any size and in any font the reader has. */}
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
        <Typography sx={{
          fontSize: TYPE_SCALE.body, fontWeight: on ? 800 : 700, lineHeight: 1.25,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{candidate.playerId ? short(candidate.name) : candidate.name}</Typography>
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
            // the slates would like to say. It was TWO until Sep 9, 2026 and that was simply
            // too conservative: a whole column of the tile sat empty.
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
                fontSize: TYPE_SCALE.caption, fontWeight: 700, letterSpacing: 0.4,
                textTransform: 'uppercase', color: 'text.disabled', lineHeight: 1.3,
                whiteSpace: 'nowrap',
              }}>{st.label}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* A TILE WITH NO FIGURES STANDS AS TALL AS THE ONES BESIDE IT, and this hidden pair is
          what makes it. A write-in and a search hit carry a name and nothing else, so they came
          out one text pair shorter than every seeded tile; alone on the last row of the grid
          there is nothing to stretch against, so the card visibly shrank and the share pill on
          its portrait sat at a different height from the four above it.

          `visibility: hidden` rather than a measured `minHeight`: the row it is holding room for
          is two lines of type at two different sizes, and any number written down here would be
          right at one text scale and wrong at the rest. An em dash is the section's own glyph for
          "no value", so if this ever becomes visible by accident it reads as a blank figure
          rather than as a mistake.

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

// ─── one category ────────────────────────────────────────────────────────────────

/**
 * One award: its question, its shortlist, a search for everyone else, and the tally once you
 * have answered it.
 *
 * THE SEARCH IS PART OF THE BALLOT AND NOT AN ESCAPE HATCH. It sits under the names with its own
 * label rather than behind a disclosure, because the claim the shortlists make is that they are a
 * starting point, and a starting point you have to go looking for is a shortlist.
 */
function AwardQuestion({ entry, players, teams, state, closed, onOpenPlayer, onOpenTeam }: {
  entry: AwardBallotEntry
  players: WpblPlayer[]
  teams: WpblTeam[]
  state: FanVoteState
  closed: boolean
  onOpenPlayer?: (p: WpblPlayer) => void
  onOpenTeam?: (t: WpblTeam) => void
}) {
  const [query, setQuery] = useState('')
  const { award, candidates } = entry
  const picked = state.ballot[award.id] ?? null
  const total = awardVoteCount(state.results, award.id)
  const bucket = state.results[award.id] ?? {}
  // Yours, or the whole league's once it is over: before either, a tally would be telling the
  // next fifty voters what the first fifty thought.
  const showShare = !!picked || closed
  const share = (key: string) => (total > 0 ? (bucket[key] ?? 0) / total : 0)

  // Anybody at all, for the categories where six names cannot be the whole answer. Only players:
  // the one club award has four candidates and every one of them is already on screen.
  const hits = useMemo(() => {
    if (award.pick !== 'player' || query.trim().length < 2) return []
    const onList = new Set(candidates.map(c => c.key))
    return searchPlayers(query, players).map(h => h.player).filter(p => !onList.has(p.id)).slice(0, 5)
  }, [award.pick, query, players, candidates])

  // The seeded four, plus this reader's own write-in, plus any write-in the crowd has actually
  // got behind. The last of those only once the tally is on screen anyway; see withWriteIns for
  // why a ballot that reorders itself by its own running total is a worse ballot.
  const shown = useMemo(() => withWriteIns(candidates, {
    bucket, players, picked, reveal: showShare, closed,
  }), [candidates, bucket, players, picked, showShare, closed])

  // Whether this question cards anybody on numbers. The seeded slate is what decides it, and
  // the answer has to be the same for every tile in the grid or the reserved row would appear
  // on some and not others.
  const anyStats = useMemo(() => candidates.some(c => (c.stats?.length ?? 0) > 0), [candidates])

  /**
   * A write-in, or a name off the search, carded like the shortlist.
   *
   * A slate only computes figures for the names it chose, so both of those arrived with a name
   * and nothing under it: the vote a reader had to go looking for was the one tile that told
   * them nothing. `entry.statsFor` prices anybody in the league on the same figures this
   * question is asking about.
   *
   * THE LINE MOVES UP INTO `sub`, WHICH IS THE WHOLE REASON IT IS NOT A ONE-LINER. The tile
   * draws `line` only where a candidate has no figures, on the reasoning that a candidate with
   * a stat row has already said what the sentence would: it is the slot that holds "P / CF" on
   * a seeded tile. But "Your write-in" is not that kind of sentence. It is the only thing on
   * the sheet saying why an unseeded face is in the grid at all, so filling the figures in must
   * not be what takes it away.
   */
  const carded = (c: AwardCandidate): AwardCandidate => {
    if (!c.playerId || (c.stats?.length ?? 0) > 0) return c
    const stats = entry.statsFor(c.playerId)
    return stats.length ? { ...c, sub: c.sub ?? c.line, stats } : c
  }

  return (
    <Box>
      {/* THE AWARD'S NAME IS THE QUESTION, so it is set like one.
          It was a `SectionLabel`: 0.63rem, uppercase, `text.disabled`. That is the section's
          furniture label, the same treatment as "SEMIFINAL A · BEST OF 3", and it put the one
          thing the reader is being asked about below every candidate name on the ballot in both
          size and contrast. Five questions read as five captions over five grids.

          The subtitle under it is gone with it. "The defender you were glad was out there" is a
          nicer sentence than "Defensive Wizard" is a title, but it restates a title that already
          says the thing, and a paragraph between the question and the names is what pushed the
          candidates far enough down that the second award was never on screen with its own
          heading. `award.blurb` is still in the catalog: nothing renders it today, and a results
          page is the surface that would want it. */}
      {/* NO EMOJI IN FRONT OF THE QUESTION. An icon per heading, five headings deep, is the
          house style of a generated page rather than of this section, which labels nothing
          else this way. The catalog still carries one, because the Discord post is written in
          a register where an emoji on a heading is native and it is the only thing separating
          five questions in a wall of chat. */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, minWidth: 0 }}>
        {/* 800, NOT 900, AND IT OUTRANKS THE NAMES BY SIZE INSTEAD. A candidate's name is
            `body` at 800, so at 900 the heading was winning on both size AND weight at once and
            came out as a black bar over a grid of six cards, which is more emphasis than a
            five-question sheet can spend five times. Same trade the weight ceiling in ui.tsx
            makes for small type, arrived at from the other end: this size is above that ceiling
            and 900 is allowed here, it just is not wanted. Matching the names' weight and
            keeping the size step is the quieter half of the hierarchy and still unmistakable. */}
        <Typography component="h3" sx={{
          fontSize: TYPE_SCALE.heading, fontWeight: 800, color: 'text.primary',
          lineHeight: 1.2, m: 0, minWidth: 0,
        }}>{award.title}</Typography>
      </Box>

      {/* TWO COLUMNS, BECAUSE SIX DIVIDES BY TWO. Four across left the second row two thirds
          empty on every player category, which is what a shortlist of six does against a grid of
          four, and the hole was the first thing the eye landed on. Two gives three full rows and
          no gap at any width. It also doubles what a card is allowed to be: half a 720px sheet is
          340px, which is a player card rather than a tile, and that is what the layout below
          spends the extra on. `minmax(0, 1fr)` so the columns divide whatever the sheet has at
          any text scale rather than overflowing it. */}
      <Box role="radiogroup" aria-label={award.title}
        sx={{ display: 'grid', gap: 0.75, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {shown.map(carded).map(c => (
          <CandidateTile key={c.key} candidate={c} award={award}
            team={teams.find(t => t.id === c.teamId) ?? null}
            player={c.playerId ? players.find(p => p.id === c.playerId) ?? null : null}
            on={picked === c.key} share={share(c.key)} showShare={showShare} reserveStats={anyStats}
            onPick={() => (closed ? undefined : state.cast(award.id, c.key))}
            onOpenPlayer={onOpenPlayer} onOpenTeam={onOpenTeam} />
        ))}
      </Box>

      {award.pick === 'player' && !closed && (
        <Box sx={{ mt: 1 }}>
          <Box
            component="input"
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            placeholder="Or vote for anyone in the league"
            aria-label={`${award.title}: search for any player`}
            sx={{
              width: '100%', boxSizing: 'border-box',
              fontSize: TYPE_SCALE.body, fontFamily: 'inherit',
              borderRadius: 2, border: '1px solid', borderColor: 'divider',
              bgcolor: 'transparent', color: 'text.primary',
              px: 1.25, py: 0.85, outline: 'none',
              '&:focus': { borderColor: 'var(--wpbl-accent-solid)' },
              '&::placeholder': { color: 'text.disabled' },
            }}
          />
          {hits.length > 0 && (
            <Box sx={{ display: 'grid', gap: 0.75, mt: 0.75, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              {hits.map(p => (
                <CandidateTile
                  key={p.id} award={award} player={p}
                  candidate={carded(
                    { key: p.id, name: p.name, teamId: p.team_id, playerId: p.id, line: 'Not on the list' })}
                  on={picked === p.id} share={share(p.id)} showShare={showShare} reserveStats={anyStats}
                  onPick={() => { state.cast(award.id, p.id); setQuery('') }}
                  onOpenPlayer={onOpenPlayer} onOpenTeam={onOpenTeam} />
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* NOTHING AT ALL BEFORE A VOTE, where this used to say "Results show once you have voted."
          The bars are hidden until you answer for the reason `showShare` gives, and that rule
          does not need announcing: a reader who has not voted yet is being told the terms of a
          transaction they have not been offered, one line under the tiles that ARE the offer. It
          also read as an instruction on the one surface that is trying hardest not to give any.
          The whole row goes rather than just the sentence, so an empty caption is not left
          holding a margin open. */}
      {(closed || picked) && (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled' }}>
          {closed ? `Closed · ${total} ${total === 1 ? 'vote' : 'votes'}`
            : `${total} ${total === 1 ? 'vote' : 'votes'} so far`}
        </Typography>
        {picked && !closed && (
          <Box {...pressable(() => state.clear(award.id))} sx={{
            ...TAPPABLE, ...FOCUS_RING, cursor: 'pointer', borderRadius: 1, px: 0.5,
          }}>
            <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, color: 'text.disabled' }}>
              Take it back
            </Typography>
          </Box>
        )}
      </Box>
      )}
    </Box>
  )
}

// ─── the sheet ───────────────────────────────────────────────────────────────────

function FanVoteSheet({ entries, players, teams, state, closed, onClose, onOpenPlayer, onOpenTeam }: {
  entries: AwardBallotEntry[]
  players: WpblPlayer[]
  teams: WpblTeam[]
  state: FanVoteState
  closed: boolean
  onClose: () => void
  onOpenPlayer?: (p: WpblPlayer) => void
  onOpenTeam?: (t: WpblTeam) => void
}) {
  const answered = entries.filter(e => state.ballot[e.award.id]).length
  return (
    <ModalShell
      sheet
      eyebrow="Fan awards"
      // WIDER THAN THE OTHER SHEETS IN THE SECTION, on purpose. Every other modal here shows a
      // thing to read and 720 is generous for prose; this one shows five grids of player cards,
      // and each extra 80px of sheet is 40px on every card, which is the difference between a
      // fourth figure fitting and not. 880 is where the cards stop gaining: past it the portrait
      // and the name stay put and the gap after the figures grows instead.
      maxWidth={{ xs: 560, md: 880 }}
      onClose={onClose}
      footer={
        <Box {...pressable(onClose)} sx={{
          ...FOCUS_RING, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 2, cursor: 'pointer', userSelect: 'none',
          bgcolor: 'var(--wpbl-accent-solid)', color: '#fff', fontWeight: 800, fontSize: TYPE_SCALE.title,
        }}>{answered === entries.length ? 'Done' : `Done · ${answered} of ${entries.length}`}</Box>
      }
    >
      <Box sx={{ px: 2, py: 1.75, display: 'flex', flexDirection: 'column', gap: 2.75 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.45 }}>
          {closed
            // ONE LINE AT 375px, WHICH IS WHAT DECIDES THE WORDING. This sits between the
            // sheet's title and the first question, and at two lines it pushed the first grid
            // of faces far enough down that the sheet opened on a paragraph. The long version
            // said the deadline was first pitch of the final; the date says the same thing to
            // anyone holding the bracket, and the ballot's own header carries the rest.
            ? 'Voting is closed. Here is how it finished.'
            : `Change your votes until ${AWARDS_CLOSE_LABEL}.`}
        </Typography>
        {/* THE WALL, AND IT STANDS BEHIND THE QUESTIONS RATHER THAN IN FRONT OF THEM. A reader
            who is not signed in still gets the whole ballot: every category, every nominee,
            every figure, and the tally on anything already decided. What they cannot do is
            answer, and this is the one line that says so. Same shape and the same reasoning as
            the pick'em's, which reached this a fortnight earlier.

            SIZED TO ITS OWN WORDS, not stretched across the sheet: a four-word ask spanning
            720px is a banner, and a banner does not read as a thing you press. Tapping a
            nominee gets here too, because `cast` sends a reader with no account to the same
            dialog rather than doing nothing at all. */}
        {!closed && !state.canPick && (
          <Box
            {...pressable(state.signIn)}
            sx={{
              ...TAPPABLE, ...FOCUS_RING, borderRadius: 2, px: 1.5, py: 1.1, cursor: 'pointer',
              border: '1px solid', borderColor: 'var(--wpbl-accent-solid)',
              display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, alignSelf: 'flex-start',
              mt: -1.75,
            }}
          >
            <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 900, lineHeight: 1.25, minWidth: 0 }}>
              Sign in for your vote to count
            </Typography>
            <Typography aria-hidden sx={{ fontSize: TYPE_SCALE.title, fontWeight: 900, flexShrink: 0 }}>&#8250;</Typography>
          </Box>
        )}
        {entries.map(e => (
          <AwardQuestion key={e.award.id} entry={e} players={players} teams={teams} state={state}
            closed={closed} onOpenPlayer={onOpenPlayer} onOpenTeam={onOpenTeam} />
        ))}
        {/* THE CREDIT GOES LAST, AND IT IS A CREDIT RATHER THAN A PROMOTION. This ballot exists
            because Ghost Baseboo suggested it and helped pick the categories, and that stays
            true however the traffic runs between the two sites. It sits under the final question
            instead of beside the deadline at the top because the sheet's job on open is to ask,
            not to introduce itself: a reader who has scrolled past five questions has finished
            the thing this is a footnote to.

            THE ONE EXTERNAL LINK IN THE SECTION, hence `noopener noreferrer` and a new tab,
            neither of which any internal link here needs. A real anchor for the usual reason
            (see CLAUDE.md on onClick-only controls), though this one is a plain `<a>`: `linkTo`
            and the section's link helpers are for routes this app owns, and routing an off-site
            URL through them would claim it as one. */}
        <Typography
          component="a"
          href={WPBL_AWARDS_CREDIT.url}
          target="_blank"
          rel="noopener noreferrer"
          title={awardsCreditLine()}
          sx={{
            // `body`, the same size as the deadline line at the top of the sheet, so this is in
            // the sheet's own voice rather than in fine print. It was `caption` in
            // `text.disabled`, which is the treatment used for a stat label, and at the foot of a
            // long sheet it read as legal boilerplate: too quiet to be a credit and too flat to
            // look like anywhere you could go.
            fontSize: TYPE_SCALE.body, color: 'text.secondary', textDecoration: 'none',
            alignSelf: 'center', textAlign: 'center', ...FOCUS_RING, ...TAPPABLE,
            borderRadius: 1, px: 1, py: 0.5,
          }}
        >
          {WPBL_AWARDS_CREDIT.prefix}{' '}
          {/* THE NAME CARRIES THE ACCENT, which is the only thing that says this is a link.
              Underlining the whole line would put a rule under four words of ordinary prose;
              colouring the name is how the rest of the section marks somewhere to go, and it is
              the half a reader would actually be looking for. */}
          <Box component="span" sx={{
            fontWeight: 800, color: 'var(--wpbl-accent-solid)',
            '@media (hover: hover)': { 'a:hover &': { textDecoration: 'underline' } },
          }}>{WPBL_AWARDS_CREDIT.name}</Box>
        </Typography>
      </Box>
    </ModalShell>
  )
}

// ─── the card ────────────────────────────────────────────────────────────────────

/** Whether there is a ballot worth drawing. Every category needs candidates, or the card is a
 *  list of questions with nothing under them. */
export function fanVoteIsWorthDrawing(entries: AwardBallotEntry[]): boolean {
  return entries.length > 0 && entries.every(e => e.candidates.length > 0)
}

/**
 * THE INVITATION, for the top of a phone.
 *
 * THE CARD IS NOT ENOUGH ON A PHONE, which is the whole reason this exists. Home's two columns
 * stack below md and the ballot sits in the second one, so on a 375px handset it is the third
 * card down, past the scoreboard, Next game and Last game: about two screens of scrolling for
 * the one thing on this page that ASKS the reader for something. Everything else on Home
 * reports. A reader who does not scroll that far never learns the ballot is open at all.
 *
 * A LINK AND NOT A SECOND BALLOT. It reads no vote state and runs no hooks: a second
 * `useFanVote` would mean a second tally read and a second `wpbl_award_shown` on every load,
 * and the card below is still the thing that shows what you answered. This says the ballot is
 * open and gets you there in one tap.
 *
 * IT DISAPPEARS ON ITS OWN, on the deadline the card below prints: first pitch of the final,
 * see AWARDS_CLOSE_AT. Nobody has to remember to take it down.
 *
 * ON THE CLOSING DATE AND NOT ON `anyAwardOpen`, which is the same question asked worse here.
 * That helper also decides whether voting has STARTED, from the last regular-season date on the
 * schedule, and the feed sends `counts_in_standings: true` on postseason rows (CLAUDE.md), so
 * it reads the bracket as regular season and puts the opening day after the last playoff game.
 * The ballot is plainly open: it is rendering on this page, taking votes. A strip advertising
 * it must not be able to disagree with the card it points at.
 */
export function FanAwardsCta({ onOpen, now = () => Date.now() }: {
  onOpen?: () => void
  /** Injectable clock, so the closed state is testable without waiting for September. */
  now?: () => number
}) {
  const t = now()
  if (!fanVoteAwards().some(a => t < Date.parse(a.closesAt))) return null
  return (
    <Box
      {...linkPress(WPBL_AWARDS_PATH, () => { onOpen?.(); track(EVENTS.WPBL_AWARD_OPEN, { answered: 0, from: 'cta' }) })}
      aria-label="Vote in the WPBL fan awards"
      sx={{
        ...TAPPABLE, ...FOCUS_RING,
        display: { xs: 'flex', md: 'none' }, alignItems: 'center', gap: 1,
        textDecoration: 'none', cursor: 'pointer', userSelect: 'none',
        mb: 1.5, px: 1.5, py: 1.15, borderRadius: 2,
        // The section accent as a FILL, which nothing else on Home is. Home is a page of
        // bordered cards on a plain ground, so the one control on it that wants a tap cannot
        // be another one of those: the point of the strip is that a reader scanning past stops.
        bgcolor: 'var(--wpbl-accent-solid)', color: '#fff',
        transition: 'transform 120ms ease',
        '&:active': { transform: 'scale(0.99)' },
      }}
    >
      <Typography aria-hidden sx={{ fontSize: '1.05rem', lineHeight: 1, flexShrink: 0 }}>&#127942;</Typography>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 900, lineHeight: 1.25 }}>
          Fan awards are open
        </Typography>
        {/* The deadline, because it is the only thing here that makes it worth doing NOW: a
            poll with no visible one is a poll people mean to come back to. */}
        <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 600, opacity: 0.88, lineHeight: 1.25 }}>
          Five questions the numbers cannot settle. Closes {AWARDS_CLOSE_LABEL}.
        </Typography>
      </Box>
      <Typography sx={{
        fontSize: TYPE_SCALE.caption, fontWeight: 900, flexShrink: 0,
        px: 1.1, py: 0.4, borderRadius: 999, bgcolor: 'rgba(255,255,255,0.22)',
      }}>Vote</Typography>
    </Box>
  )
}

export default function FanVoteCard({
  players, teams, games, batting, pitching, race, plays = [], onOpenPlayer, onOpenTeam,
  fill, now = () => Date.now(),
  open: openProp, onOpen, onClose,
}: {
  players: WpblPlayer[]
  teams: WpblTeam[]
  games: WpblGame[]
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  /** The MVP race, which seeds the MVP and Pitcher shortlists. Absent until the play log lands,
   *  which is a deferred read on Home; the card simply does not draw until it does. */
  race?: MvpRace | null
  /** The play log, for the one figure a fielding row cannot hold: whether a catcher threw
   *  anybody out. Arrives with the race and is empty until it does, which the card shows as
   *  "—" on that line rather than as a zero nobody earned. */
  plays?: readonly WpblRunValuePlay[]
  onOpenPlayer?: (p: WpblPlayer) => void
  /** Manager of the Year's way out: her club's page, since she has no page of her own. */
  onOpenTeam?: (t: WpblTeam) => void
  fill?: boolean
  /** Injectable clock, so the closed state is testable without waiting for September. */
  now?: () => number
  /**
   * CONTROLLED WHEN THE SECTION IS DRIVING, uncontrolled otherwise.
   *
   * The ballot has a URL (`/wpbl/awards`), and a URL cannot open a sheet whose only record of
   * being open is a `useState` in here. So WpblApp holds it on the history entry and passes it
   * down, the same arrangement the player and game modals already have. `open` left undefined
   * falls back to the local state, which is what keeps this card renderable on its own: the
   * tests mount it directly, and a caller with no router still gets a working sheet.
   */
  open?: boolean
  onOpen?: () => void
  onClose?: () => void
}) {
  const [openLocal, setOpenLocal] = useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : openLocal
  const setOpen = (v: boolean) => {
    if (!controlled) setOpenLocal(v)
    if (v) onOpen?.(); else onClose?.()
  }
  // Fielding is read here and nowhere else in the section: only the Defensive Wizard shortlist
  // wants it, and only once this card is on screen. Seeded from the cache so a second visit
  // draws the full ballot on first paint.
  // The section's short-name rule (12 chars on a phone, 20 on a desktop), so a long winner
  // shortens instead of pushing the QUESTION into an ellipsis. The question is what this row
  // exists to ask; which of your five picks it was is recoverable from the sheet.
  const short = useWpblName()
  const [fielding, setFielding] = useState<WpblFieldingLine[]>(() => getCachedWpblAllFielding() ?? [])
  useEffect(() => {
    if (fielding.length > 0) return
    let cancelled = false
    fetchWpblAllFielding().then(rows => { if (!cancelled) setFielding(rows) })
    return () => { cancelled = true }
  }, [fielding.length])

  const entries = useMemo(() => {
    const awards = fanVoteAwards()
    return buildAwardBallot({ players, teams, games, batting, pitching, fielding, mvp: race, plays })
      .filter(e => awards.some(a => a.id === e.award.id))
      .sort((a, b) => awards.findIndex(x => x.id === a.award.id) - awards.findIndex(x => x.id === b.award.id))
  }, [players, teams, games, batting, pitching, fielding, race, plays])

  // OPEN TO EVERYBODY SINCE SEP 10, 2026. This was an owner-and-collaborator gate for its first
  // day, and both call sites are gone with it: Home no longer picks between this card and the
  // MVP race, and `drawable` is back to the one question it should ever have asked, which is
  // whether there is a ballot worth drawing.
  const drawable = fanVoteIsWorthDrawing(entries)
  const state = useFanVote(drawable)
  const closed = useMemo(
    () => entries.length > 0 && entries.every(e => now() > Date.parse(e.award.closesAt)),
    [entries, now])

  const answered = entries.filter(e => state.ballot[e.award.id]).length

  useEffect(() => {
    if (drawable && state.loaded) track(EVENTS.WPBL_AWARD_SHOWN, { answered, categories: entries.length })
    // Once per load, not once per vote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawable, state.loaded])

  if (!drawable) return null

  return (
    <SectionCard
      title="Fan awards"
      // NO SUBTITLE BEFORE THE FIRST ANSWER. The rows under the header are the five questions
      // and the nominees, so a line describing them said the same thing twice, above the thing
      // it was describing. What a reader who has answered nothing needs is to see the names.
      subtitle={closed ? 'Voting is closed. See where it finished.'
        : answered === 0 ? undefined
          : answered < entries.length ? `${answered} of ${entries.length} answered.`
            : 'All five in. Change them any time.'}
      fill={fill}
      action={
        <Box
          {...linkPress(WPBL_AWARDS_PATH, () => { setOpen(true); track(EVENTS.WPBL_AWARD_OPEN, { answered }) })}
          // The visible word is one or two, which is right on a card header and thin on its own
          // in a screen reader's list of links. The label says which ballot and what pressing it
          // does; the text stays short.
          aria-label={closed ? 'See the fan award results' : answered === 0 ? 'Vote in the fan awards' : 'Open your fan award ballot'}
          sx={{
            ...TAPPABLE, ...FOCUS_RING,
            display: 'flex', alignItems: 'center', gap: 0.4,
            borderRadius: 999, px: { xs: 1.25, sm: 1.75 }, py: { xs: 0.5, sm: 0.65 },
            cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', flexShrink: 0,
            textDecoration: 'none',
            // LIFT AND BRIGHTEN, NOT A SECOND COLOUR. The unanswered state is already the accent
            // at full strength, so there is no darker version of it to hover to that does not
            // read as disabled, and the answered state is a quiet outline that should stay
            // quiet. `hoverOnly` guards both, so a phone does not keep the hover state painted
            // on after the tap that navigated away.
            transition: 'transform 120ms ease, filter 120ms ease, box-shadow 120ms ease',
            '&:active': { transform: 'scale(0.97)' },
            ...(answered > 0
              ? {
                border: '1px solid', borderColor: 'divider', color: 'text.secondary',
                ...hoverOnly({ borderColor: 'var(--wpbl-accent-solid)', color: 'var(--wpbl-accent-solid)' }),
              }
              : {
                bgcolor: 'var(--wpbl-accent-solid)', color: '#fff',
                // A shadow in the button's own hue rather than a grey one, so it reads as the
                // colour glowing rather than as a piece of paper lifting off the card.
                boxShadow: '0 1px 6px -1px color-mix(in srgb, var(--wpbl-accent-solid) 55%, transparent)',
                ...hoverOnly({ filter: 'brightness(1.08)', transform: 'translateY(-1px)' }),
              }),
          }}
        >
          <Typography sx={{ fontSize: { xs: TYPE_SCALE.caption, sm: TYPE_SCALE.body }, fontWeight: 900 }}>
            {closed ? 'Results' : answered === 0 ? 'Vote' : 'Your ballot'}
          </Typography>
          {/* Ornament, and hidden from the accessibility tree: the label above already says this
              goes somewhere. Raw px because a chevron is neither type nor structure. */}
          <Box aria-hidden sx={{ fontSize: 11, lineHeight: 1, opacity: 0.85, mt: '1px' }}>&#8250;</Box>
        </Box>
      }
    >
      {/* THE CARD IS THE BALLOT AT A GLANCE, not a teaser for it. One row per category, showing
          your answer where you have given one and the question where you have not, so a reader
          who never opens the sheet still learns what is being asked and a reader who has voted
          can see all five of their calls without a tap.

          IT SHOWS FACES NOW, AND THAT IS THE WHOLE CHANGE. Five questions about players, and
          the card drew no players: a column of titles hard against the left edge, the word
          "Vote" hard against the right, and 300px of nothing in between on a desktop. The empty
          middle was most of the card. A nominee's face is the thing that makes an award read as
          a contest rather than as a form, and it is the one picture this card already had the
          data for, since every candidate carries a portrait and a club.

          THE PILE IS THE SEEDED SHORTLIST, IN SEEDED ORDER, which is what keeps it clear of the
          hidden-until-you-answer rule. It is the same list the sheet opens with and leaks
          nothing about how anyone voted; deliberately NOT `withWriteIns`, which sorts by votes
          once the tally is out and would turn this row into a running result. */}
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        {entries.map((e, i) => {
          const picked = state.ballot[e.award.id]
          const mineC = picked
            ? (e.candidates.find(c => c.key === picked)
              ?? (() => { const p = players.find(x => x.id === picked)
                return p ? { key: p.id, name: p.name, teamId: p.team_id, playerId: p.id, line: '' } as AwardCandidate : null })())
            : null
          // Three faces: enough to read as a field, few enough to leave the question room on a
          // 375px phone. Your own pick replaces the pile entirely, because once you have
          // answered, the only name on this row that is about you is the one that should be on it.
          const faces = mineC ? [mineC] : e.candidates.slice(0, 3)
          return (
            <Box key={e.award.id}
              {...linkPress(WPBL_AWARDS_PATH, () => { setOpen(true); track(EVENTS.WPBL_AWARD_OPEN, { answered, from: e.award.id }) })}
              sx={{
                ...TAPPABLE, ...FOCUS_RING, cursor: 'pointer',
                textDecoration: 'none', color: 'text.primary',
                display: 'flex', alignItems: 'center', gap: 1, minWidth: 0,
                py: 0.85, borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider',
              }}
            >
              <Typography sx={{
                fontSize: TYPE_SCALE.body, fontWeight: 700, minWidth: 0,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{e.award.title}</Typography>
              <Box sx={{ flex: 1, minWidth: chromePx(8) }} />
              {/* Overlapped, with a ring in the card's own colour so the edges stay separate
                  against a portrait behind them. `chromePx` on the overlap because it is
                  structure: left raw it would not shrink with the art it is overlapping. */}
              <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                {faces.map((c, j) => (
                  <Box key={c.key} sx={{
                    display: 'flex', borderRadius: '50%',
                    ml: j === 0 ? 0 : `calc(-1 * ${chromePx(9)})`,
                    boxShadow: t => `0 0 0 2px ${t.palette.background.paper}`,
                    // Later faces sit UNDER earlier ones, so the pile reads left to right in
                    // seeded order rather than the last one covering the seed.
                    zIndex: faces.length - j,
                  }}>
                    {c.playerId
                      ? <PlayerPortrait name={c.name} teamId={c.teamId} size={26} />
                      : (() => { const t = teams.find(x => x.id === c.teamId)
                        return t ? <TeamBadge team={t} size={26} /> : null })()}
                  </Box>
                ))}
              </Box>
              <Typography sx={{
                fontSize: TYPE_SCALE.body, fontWeight: mineC ? 800 : 700, flexShrink: 0,
                whiteSpace: 'nowrap',
                color: mineC ? 'text.primary' : 'var(--wpbl-accent-solid)',
              }}>{mineC ? (mineC.playerId ? short(mineC.name) : mineC.name) : 'Vote'}</Typography>
            </Box>
          )
        })}
      </Box>
      {open && (
        <FanVoteSheet entries={entries} players={players} teams={teams} state={state} closed={closed}
          onClose={() => setOpen(false)} onOpenPlayer={onOpenPlayer} onOpenTeam={onOpenTeam} />
      )}
    </SectionCard>
  )
}
