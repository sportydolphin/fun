import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Box, Typography, Menu, MenuItem, ListItemIcon } from '@mui/material'
import { EmojiEvents, IosShare, ContentCopy, Download } from '@mui/icons-material'
import html2canvas from 'html2canvas'
import {
  SectionCard, ModalShell, TeamBadge, PlayerPortrait,
  pressable, linkPress, FOCUS_RING, TAPPABLE, hoverOnly, useWpblDark, useWpblName, TYPE_SCALE, chromePx,
} from './ui'
import { useWpblPlayerLink, useWpblTeamLink } from './LinkContext'
import { wpblManagerPortraitSet, wpblPortrait, wpblManagerPortrait } from './portraits'
import { wpblAccent, wpblColor, wpblLogo, wpblSecondary, wpblFullName } from './constants'
import { useEraBasis } from './EraBasisContext'
import { fanVoteAwards, FAN_VOTE_IDS, AWARDS_CLOSE_LABEL, WPBL_AWARDS_CREDIT, awardsCreditLine } from './awards'
import { WPBL_AWARDS_PATH } from './routes'
import type { WpblAward } from './awards'
import { buildAwardBallot, withWriteIns } from './derive/awards'
import type { AwardBallotEntry, AwardCandidate } from './derive/awards'
import {
  fetchWpblAwardBallot, fetchWpblAwardResults, castWpblAwardVote, clearWpblAwardVote,
  awardVoteCount, fetchWpblAwardVoterCount,
} from './awardVotes'
import type { AwardBallot, AwardResults } from './awardVotes'
import { searchPlayers } from './playerSearch'
import { fetchWpblAllFielding, getCachedWpblAllFielding } from './api'
import { track, EVENTS } from '../lib/analytics'
import { useAuth } from '../AuthContext'
import { useIsTester } from '../lib/roles'
import type { MvpRace } from './derive/mvpRace'
import type {
  WpblBattingLine, WpblFieldingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblRunValuePlay,
  WpblTeam,
} from './types'

/**
 * The fan awards: five questions, one card on Home, one sheet to answer them in.
 *
 * WHY IT IS HERE. An MVP race card would answer a question the site already answers on the Stats
 * tab and on the player pages. This asks something the section cannot answer on its own, which is
 * what the people reading it think, and it is the one surface on `/wpbl` a reader can put
 * something INTO, which keeps it worth opening after the feed stops and every other card on Home
 * freezes.
 *
 * NO BASEBALL ARITHMETIC IN THIS FILE. `awards.ts` is the catalog, and `derive/awards.ts` builds
 * every shortlist from figures the section already publishes: the MVP race for value, the
 * run-expectancy table for runs saved, the qualifier bar for who counts as a regular. Both are
 * tested; this file renders them and takes the answer.
 *
 * A SHORTLIST IS A STARTING POINT, NOT A BALLOT PAPER. Every category takes a vote for anybody
 * in the league through the search below the names, and every seeded category prints where its
 * names came from. That distinction is the whole reason the search is not hidden behind a "more"
 * link: an award whose winner can only be one of six names the site chose is the site's award.
 *
 * SIGNED IN TO VOTE. Answering needs an account (`cast` sends a signed-out reader to sign in; see
 * the wall in the sheet), while a signed-out reader still sees the whole ballot and the tally on
 * anything already decided.
 *
 * THE TALLY IS HIDDEN UNTIL YOU ANSWER, per category, same rule the pick'em uses: a poll that
 * shows its results first stops measuring what people think and starts measuring what the first
 * fifty people thought.
 */

// ─── has this reader dealt with the ballot yet ───────────────────────────────────

/**
 * ONE BIT: has this browser opened the ballot or voted in it.
 *
 * It exists for the strip at the top of Home, which is an invitation, and an invitation that
 * keeps arriving after you have accepted it is nagging. Once you have been in, the ballot card
 * further down the page is the surface that tells you where your five answers stand; the strip
 * has nothing left to say and takes the first line of a phone screen to say it.
 *
 * A LOCAL FLAG RATHER THAN A READ OF THE BALLOT, deliberately. The strip runs no hooks and
 * makes no query on purpose (see FanAwardsCta), and asking the server whether you have voted
 * would mean the strip paints, waits, and then vanishes under the reader's thumb on every load
 * for the rest of the week. This answers before first paint or not at all. The cost is that it
 * is per browser: voting on a phone does not take the strip off a laptop, which is the right
 * way round for a piece of chrome that only ever appears on a phone anyway.
 *
 * A MODULE SINGLETON because the writer (the sheet, the vote) and the reader (the strip) are
 * in different trees, so this has to cross Home without either of them owning it. Same shape as
 * lib/notifications.ts.
 *
 * NOT A DISMISSAL. There is no way back once it is set, and there does not need to be: the
 * thing it hides is a shortcut to a card that is still on the same page, and voting closes on
 * its own a few days later.
 */
const AWARDS_ENGAGED_KEY = 'wpbl.awards.engaged'

let awardsEngaged = (() => {
  try { return localStorage.getItem(AWARDS_ENGAGED_KEY) === '1' } catch { return false }
})()
const engagedListeners = new Set<() => void>()

/** Opened the ballot, or answered a question in it. Idempotent: the second call is free. */
export function markFanAwardsEngaged(): void {
  if (awardsEngaged) return
  awardsEngaged = true
  try { localStorage.setItem(AWARDS_ENGAGED_KEY, '1') } catch { /* private mode / quota: the
    strip simply comes back next load, which is the harmless direction to fail in */ }
  for (const fn of engagedListeners) fn()
}

const subscribeEngaged = (fn: () => void) => { engagedListeners.add(fn); return () => { engagedListeners.delete(fn) } }
const engagedSnapshot = () => awardsEngaged

/** Reads the bit and re-renders when it flips, so the strip goes the moment the sheet opens
 *  under it rather than on the next load. */
export function useFanAwardsEngaged(): boolean {
  return useSyncExternalStore(subscribeEngaged, engagedSnapshot, engagedSnapshot)
}

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
    // Answering is the strongest form of having dealt with the invitation, and it is caught
    // here rather than at the tiles so no control can vote without also taking the strip down.
    markFanAwardsEngaged()
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
 * NOT A LINE UNDER THE FIGURES. A tile's last row is a grid of value-over-label pairs, so a bare
 * "50%" beneath it lands under a stat in the same column with no label of its own, and the eye
 * reads it as another line of that stat rather than as the poll. The figures are about the player
 * and this number is about the people voting, so it goes somewhere the figures are not.
 *
 * ON THE PORTRAIT RATHER THAN IN A CORNER OF THE TILE, because the tile's corners are taken.
 * Top right is the link out to the player's page, and the bottom edge is the stats row on a
 * phone, where the tile is a centred column and there is no free margin either side of it. The
 * portrait is in the same place at both breakpoints and is the one element every tile has.
 *
 * AND IT COSTS NO LAYOUT. `showShare` is `!!picked || closed`, so it flips for a whole question
 * at once: a row that appeared on the first vote would grow all four tiles together and push
 * every question below down the sheet under the reader's thumb. An overlay cannot move anything,
 * so nothing has to be reserved.
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
        // Two columns of a 720px sheet is 340px a card. A centred column inside 340px is a 46px
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
              a control it would read as "more of this card", which is the one thing it does
              not do. The diagonal is the mark for leaving, and this leaves: it puts a whole
              other page over the ballot.

              DRAWN, NOT TYPESET, which is what centres it. A glyph ('›', '↗') is not centred in
              its own box in any font and carries a text node's line-height besides, so it lands
              high and right in the circle and no nudge holds at every text scale. This path is
              symmetric about (12, 12) in its own viewBox, so it is centred by construction, at
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
                fontSize: TYPE_SCALE.caption, fontWeight: 700, letterSpacing: 0.4,
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
      {/* THE AWARD'S NAME IS THE QUESTION, so it is set like one, not as the section's furniture
          label (small, uppercase, `text.disabled`), which would put the one thing the reader is
          being asked about below every candidate name in both size and contrast.

          NO SUBTITLE. "The defender you were glad was out there" is a nicer sentence than
          "Defensive Wizard" is a title, but it restates a title that already says the thing, and
          a paragraph between the question and the names pushes the candidates far enough down
          that the next award is never on screen with its own heading. `award.blurb` is still in
          the catalog: nothing renders it today, and a results page is the surface that would
          want it. */}
      {/* NO EMOJI IN FRONT OF THE QUESTION. An icon per heading, five headings deep, is the
          house style of a generated page rather than of this section, which labels nothing
          else this way. The catalog still carries one, because the Discord post is written in
          a register where an emoji on a heading is native and it is the only thing separating
          five questions in a wall of chat. */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, minWidth: 0 }}>
        {/* 800, NOT 900, AND IT OUTRANKS THE NAMES BY SIZE INSTEAD. A candidate's name is
            `body` at 800, so at 900 the heading would win on both size AND weight at once and
            come out as a black bar over a grid of six cards, which is more emphasis than a
            five-question sheet can spend five times. Same trade the weight ceiling in ui.tsx
            makes for small type, arrived at from the other end: this size is above that ceiling
            and 900 is allowed here, it just is not wanted. Matching the names' weight and
            keeping the size step is the quieter half of the hierarchy and still unmistakable. */}
        <Typography component="h3" sx={{
          fontSize: TYPE_SCALE.heading, fontWeight: 800, color: 'text.primary',
          lineHeight: 1.2, m: 0, minWidth: 0,
        }}>{award.title}</Typography>
      </Box>

      {/* TWO COLUMNS, BECAUSE SIX DIVIDES BY TWO. Four across leaves the second row two thirds
          empty on every player category, which is what a shortlist of six does against a grid
          of four, and the hole is the first thing the eye lands on. Two gives three full rows
          and no gap at any width. It also doubles what a card is allowed to be: half a 720px
          sheet is 340px, which is a player card rather than a tile, and that is what the layout
          below spends the extra on. `minmax(0, 1fr)` so the columns divide whatever the sheet
          has at any text scale rather than overflowing it. */}
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

      {/* NOTHING AT ALL BEFORE A VOTE. The bars are hidden until you answer for the reason
          `showShare` gives, and that rule does not need announcing: a reader who has not voted
          yet would be told the terms of a transaction they have not been offered, one line under
          the tiles that ARE the offer, and it would read as an instruction on the one surface
          trying hardest not to give any. The whole row goes rather than just the sentence, so
          an empty caption is not left holding a margin open. */}
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

// ─── the winner's confetti ─────────────────────────────────────────────────────────

/**
 * A one-shot confetti pop over a winner's portrait, fired when the results sheet opens.
 *
 * THE SAME NOD AS THE LEAGUE SWITCHER'S BURST (ConfettiBurst in App.tsx), rebuilt for this
 * surface: that one portals to <body> at fixed viewport coords because it fires from a bar that
 * scrolls under sticky chrome. This is placed by `x`/`y` inside AwardResult's OUTER box, which is
 * NOT overflow-clipped, so the burst flies free of the results card's rounded corners rather than
 * being cut off at the card's top edge (the card clips its own wash and bars). The caller measures
 * the portrait so the origin and the rim radius `r` are exact at any chrome scale. Purely
 * cosmetic, `pointer-events: none`, radial because a portrait has room on every side, and it
 * animates once on mount: each winner row remounts every time the sheet opens.
 *
 * HONOURS reduced motion: a reader who has asked the OS for less movement gets the trophy and the
 * result and no burst.
 */
const WINNER_CONFETTI_COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#5856d6', '#af52de']

function WinnerConfetti({ x, y, r }: { x: number; y: number; r: number }) {
  const reduce = typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  // Each piece LAUNCHES FROM THE RIM (radius `r`, the measured portrait) rather than the centre,
  // so the burst reads as coming off the edge of the circle.
  const pieces = useMemo(() => Array.from({ length: 26 }, (_, i) => {
    // Radial: a portrait has space all around it, unlike the switcher at the top of the page.
    const angle = Math.random() * Math.PI * 2
    // Farther and more varied than before, so the burst carries well past the portrait: a fuller,
    // more prominent pop now that nothing clips it.
    const dist = 30 + Math.random() * 60
    const cos = Math.cos(angle), sin = Math.sin(angle)
    return {
      id: i,
      // Start on the circle's edge, travel outward from there along the same ray.
      sx: cos * r, sy: sin * r,
      ex: cos * (r + dist), ey: sin * (r + dist),
      rot: (Math.random() * 2 - 1) * 300,
      delay: Math.random() * 90,
      color: WINNER_CONFETTI_COLORS[i % WINNER_CONFETTI_COLORS.length],
      size: 5 + Math.random() * 5,
      round: Math.random() < 0.4,
    }
  }), [r])
  if (reduce) return null
  return (
    <Box aria-hidden sx={{
      // Placed on the portrait's centre within the un-clipped outer box; pieces start at the rim.
      position: 'absolute', left: x, top: y, width: 0, height: 0, pointerEvents: 'none', zIndex: 3,
      '@keyframes winnerConfetti': {
        '0%':   { transform: 'translate(calc(-50% + var(--sx)), calc(-50% + var(--sy))) rotate(0deg)', opacity: 1 },
        '100%': { transform: 'translate(calc(-50% + var(--ex)), calc(-50% + var(--ey))) rotate(var(--rot))', opacity: 0 },
      },
    }}>
      {pieces.map(p => (
        <Box
          key={p.id}
          style={{
            '--sx': `${p.sx}px`, '--sy': `${p.sy}px`,
            '--ex': `${p.ex}px`, '--ey': `${p.ey}px`, '--rot': `${p.rot}deg`,
            width: p.size, height: p.size, background: p.color,
            borderRadius: p.round ? '50%' : '1px', animationDelay: `${p.delay}ms`,
          } as React.CSSProperties}
          sx={{ position: 'absolute', left: 0, top: 0, animation: 'winnerConfetti 1.6s cubic-bezier(0.2, 0.6, 0.35, 1) forwards' }}
        />
      ))}
    </Box>
  )
}

// ─── sharing a single result ───────────────────────────────────────────────────────

/** Everything a share card needs, pre-resolved so the card itself is presentational and the
 *  capture is deterministic (fixed px, no dependence on the reader's text or chrome scale). */
interface ShareCardData {
  category: string
  name: string
  /** The winner's face, already resolved to a plain URL. The card draws it as a background image
   *  rather than an <img>, because html2canvas 1.4 mishandles srcSet + object-fit and rendered the
   *  portrait blank; background-size: cover it renders correctly. */
  portraitSrc: string | null
  /** The winner's club, for the background gradient and the portrait's fallback fill. */
  teamId: string | null
  /** Initials for a winner with no bundled face. */
  initials: string
  detail: string
  stats: { value: string; label: string }[]
  pct: number
}

/**
 * The branded picture of one result, laid out at a fixed pixel size for html2canvas.
 *
 * EXPLICIT px, NOT THE SECTION'S SCALE. Everything on the sheet is sized in rem against
 * `--app-type` and structural px against `--app-chrome`, both of which the reader can move; a
 * capture target must not, or the same result would export at different sizes for different
 * readers. So this card hardcodes its type and spacing and forces `--app-chrome: 1` on its root,
 * which is also what keeps the portrait a known size. Dark ground on purpose: a share image is
 * seen outside the app, where it should look like itself rather than like whoever's light setting.
 */
const SHARE_W = 540
const SHARE_H = 540

function WinnerShareCard({ data }: { data: ShareCardData }) {
  const { category, name, detail, stats, pct, portraitSrc, teamId, initials } = data
  // The club's colours: primary behind the photo, secondary as the portrait ring (the one place
  // the second colour appears now that the background is a plain dark ground).
  const primary = wpblColor(teamId)
  const secondary = wpblSecondary(teamId)
  return (
    <Box
      // Force the chrome scale to 1 so PlayerPortrait/TeamBadge render at exactly the px asked for.
      style={{ ['--app-chrome' as string]: '1' } as React.CSSProperties}
      sx={{
        width: SHARE_W, height: SHARE_H, boxSizing: 'border-box', p: '34px',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: '"Inter", system-ui, sans-serif', color: '#f4f6f8',
        // The whole card in the club's primary (a near-black team colour), with the secondary as
        // the portrait ring. Square corners, so the exported PNG is a full square rather than one
        // with transparent rounded corners.
        backgroundColor: primary,
        position: 'relative',
      }}
    >
      {/* Header: the award mark beside the section name. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <EmojiEvents sx={{ fontSize: 22, color: '#eab308' }} />
        <Box component="span" sx={{
          fontSize: 15, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: '#aeb6bf',
        }}>WPBL Fan Awards</Box>
      </Box>

      {/* THE MIDDLE, VERTICALLY CENTRED. Category, then the winner, then the big share, as one
          block that sits in the middle of the card so there is no dead gap under the header. */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '22px', minWidth: 0 }}>
        <Box component="div" sx={{
          // The club's SECONDARY colour, not the accent: on a card washed in the primary, the
          // accent can be the same hue (Boston green on green) and vanish. The secondary is the
          // contrasting brand colour (Boston orange), which is also the ring and the pop here.
          fontSize: 32, fontWeight: 900, letterSpacing: 1, textTransform: 'uppercase',
          color: secondary, lineHeight: 1.1,
        }}>{category}</Box>

        {/* The winner. The face is drawn twice: as a background image so it is present if anything
            goes wrong, and (for sharpness) composited at full resolution onto the captured canvas
            afterwards, since html2canvas rasterises a background image at its CSS size and upscales
            it, which is what looked pixelated. `data-portrait` is how the compositor finds this
            circle. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '20px', minWidth: 0 }}>
          <Box data-portrait="1" sx={{
            width: 132, height: 132, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box',
            border: `3px solid ${secondary}`, backgroundColor: primary,
            backgroundImage: portraitSrc ? `url("${portraitSrc}")` : 'none',
            backgroundSize: 'cover', backgroundPosition: 'center top', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {!portraitSrc && (
              <Box component="span" sx={{ fontSize: 44, fontWeight: 800, color: '#fff' }}>{initials}</Box>
            )}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <Box component="span" sx={{
                // lineHeight generous enough that overflow:hidden (there for the ellipsis) does not
                // clip a descender like the g in "Gigi"; a touch of bottom padding for the same.
                fontSize: 42, fontWeight: 900, lineHeight: 1.3, letterSpacing: -0.5, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis', pb: '3px',
              }}>{name}</Box>
            </Box>
            {detail && (
              <Box component="div" sx={{ mt: '4px', fontSize: 17, color: '#aeb6bf', lineHeight: 1.3 }}>{detail}</Box>
            )}
            {stats.length > 0 && (
              <Box sx={{ mt: '12px', display: 'flex', flexWrap: 'wrap', columnGap: '18px', rowGap: '2px', alignItems: 'baseline' }}>
                {stats.map(s => (
                  <Box key={s.label} sx={{ display: 'flex', alignItems: 'baseline', gap: '5px' }}>
                    <Box component="span" sx={{ fontSize: 22, fontWeight: 800 }}>{s.value}</Box>
                    <Box component="span" sx={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: '#8b939c' }}>{s.label}</Box>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Box>

        {/* The winning share, big, in the club's secondary so it pops off the primary ground. */}
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <Box component="span" sx={{ fontSize: 78, fontWeight: 900, lineHeight: 1, letterSpacing: -1, color: secondary }}>{pct}%</Box>
          <Box component="span" sx={{ fontSize: 16, color: 'rgba(255,255,255,0.65)', letterSpacing: 0.3 }}>of the fan vote</Box>
        </Box>
      </Box>

      {/* Footer: the brand mark and the wordmark. The mark is a black frame with a white dolphin,
          so on the dark card it sits in a small white chip rather than being inverted (html2canvas
          does not apply CSS filters, so an invert would not survive the capture). */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', bgcolor: '#fff', borderRadius: '3px', p: '1px' }}>
          <Box component="img" src="/logo-mark.png" alt="" sx={{ height: 20, width: 'auto', display: 'block' }} />
        </Box>
        <Box component="span" sx={{ fontSize: 16, fontWeight: 800, color: 'rgba(255,255,255,0.9)', letterSpacing: 0.2 }}>sportydolphin.fun</Box>
      </Box>
    </Box>
  )
}

type ShareAction = 'share' | 'copy' | 'download'

/** Whether the browser can copy an image to the clipboard / share files, for deciding which menu
 *  items to offer. Guarded for SSR and older browsers. */
export const canCopyImage = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.clipboard
  && typeof navigator.clipboard.write === 'function' && typeof window.ClipboardItem !== 'undefined'
/** Whether the browser can share an actual FILE (the OS share sheet on iOS/Android), tested with a
 *  throwaway file so it is a real answer rather than just "navigator.share exists" (which is true on
 *  desktops that cannot share files). When this is true the button skips our menu and goes straight
 *  to the native sheet, which carries its own copy and save options. */
export const canNativeShareFiles = (): boolean => {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false
  try { return navigator.canShare({ files: [new File([''], 'wpbl.png', { type: 'image/png' })] }) }
  catch { return false }
}

/**
 * Mounts the share card off-screen, captures it, and performs the chosen action: the OS share
 * sheet, a clipboard copy, or a download.
 *
 * OFF-SCREEN RATHER THAN VISIBLE: the reader shares the RESULT, not a modal, so the card is
 * rendered where html2canvas can reach it but the eye cannot, and torn down when done. Portraits
 * are bundled assets (same origin), so nothing is CORS-tainted; it still preloads them so the
 * capture is not blank.
 *
 * EVERY ACTION FALLS BACK TO A DOWNLOAD, which is the one that cannot fail: a share the browser
 * refuses (or the reader's browser cannot do), a copy an engine does not support. A share the
 * reader CANCELS (AbortError) is left alone rather than downloaded, since they chose to stop.
 */
function WinnerShareLauncher({ data, action, onDone }: { data: ShareCardData; action: ShareAction; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    const slug = `${data.category}-${data.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const filename = `wpbl-${slug || 'award'}.png`
    ;(async () => {
      const node = ref.current
      if (!node) { onDone(); return }
      try {
        // Preload the images so nothing captures blank. The portrait is kept as a decoded element:
        // it is composited onto the canvas at full resolution below, not left to html2canvas.
        const preload = (src: string) => new Promise<HTMLImageElement | null>(res => {
          const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src
        })
        const [portraitImg] = await Promise.all([
          data.portraitSrc ? preload(data.portraitSrc) : Promise.resolve(null),
          preload('/logo-mark.png'),
        ])
        const cardRect = node.getBoundingClientRect()
        // 3x, so the type and chrome are crisp; the portrait is drawn sharper still below.
        const canvas = await html2canvas(node, { scale: 3, backgroundColor: null, logging: false, useCORS: true })

        // COMPOSITE THE PORTRAIT AT FULL RESOLUTION. html2canvas draws a background image at the
        // element's CSS pixels and then scales the whole canvas up, which pixelates a face; drawing
        // the decoded image straight onto the output canvas, clipped to the circle, uses every
        // pixel of the source instead. Cover fit, anchored centre-top to match the CSS.
        if (portraitImg && portraitImg.naturalWidth) {
          const el = node.querySelector('[data-portrait]') as HTMLElement | null
          const ctx = canvas.getContext('2d')
          if (el && ctx) {
            const pr = el.getBoundingClientRect()
            const s = canvas.width / cardRect.width
            const x = (pr.left - cardRect.left) * s
            const y = (pr.top - cardRect.top) * s
            const d = pr.width * s
            const ringPx = 3 * s // keep the secondary ring html2canvas drew
            ctx.save()
            ctx.beginPath()
            ctx.arc(x + d / 2, y + d / 2, d / 2 - ringPx, 0, Math.PI * 2)
            ctx.closePath()
            ctx.clip()
            const cover = Math.max(d / portraitImg.naturalWidth, d / portraitImg.naturalHeight)
            const dw = portraitImg.naturalWidth * cover
            const dh = portraitImg.naturalHeight * cover
            ctx.drawImage(portraitImg, x + d / 2 - dw / 2, y, dw, dh)
            ctx.restore()
          }
        }
        const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
        if (!alive || !blob) { onDone(); return }
        const file = new File([blob], filename, { type: 'image/png' })
        const title = `${data.category}: ${data.name}`
        const download = () => {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        }
        if (action === 'copy') {
          try { await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]) }
          catch { download() }
        } else if (action === 'share' && navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file], title }) }
          catch (err) { if ((err as { name?: string })?.name !== 'AbortError') download() }
        } else {
          download()
        }
      } catch (e) {
        console.warn('[awards] share capture failed:', e)
      } finally {
        if (alive) onDone()
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return createPortal(
    <div ref={ref} style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none', zIndex: -1 }}>
      <WinnerShareCard data={data} />
    </div>,
    document.body,
  )
}

// ─── one category, once the votes are locked ──────────────────────────────────────

/**
 * The RESULT of a category, not the ballot for it: the winner shown large, then the two names
 * behind them.
 *
 * A DIFFERENT SHAPE FROM `AwardQuestion` ON PURPOSE. The voting view is a grid of equal tiles,
 * because before the votes are in every name is a live option and the layout must not say
 * otherwise. Once it is locked that even weighting is the wrong answer: there is one winner and
 * the sheet should read like a results page, so this promotes the top name to a hero row and
 * demotes the rest to a short list under it.
 *
 * THE WINNER IS RESOLVED THROUGH `withWriteIns`, closed and revealed, so a name the crowd wrote
 * in can win: the seeded four are a seed, not the ballot paper (see derive/awards), and a
 * results view that could only ever crown one of them would be the site's award rather than the
 * fans'. An unrostered write-in with no portrait or page is the one it cannot draw, the same
 * limit the tiles have, so the top DRAWABLE name stands in that rare case.
 *
 * EMPTY IS A REAL STATE. A category nobody voted in has no winner, and a hero row built around a
 * zero-vote name would invent one; it says so plainly instead.
 */
/** How long each award waits behind the one above it before its confetti fires. */
const WINNER_CONFETTI_STAGGER_MS = 180

function AwardResult({ entry, index, players, teams, state, onOpenPlayer, onOpenTeam }: {
  entry: AwardBallotEntry
  /** This award's position in the sheet, top-first, for the staggered confetti cascade. */
  index: number
  players: WpblPlayer[]
  teams: WpblTeam[]
  state: FanVoteState
  onOpenPlayer?: (p: WpblPlayer) => void
  onOpenTeam?: (t: WpblTeam) => void
}) {
  const dark = useWpblDark()
  const short = useWpblName()
  const playerLink = useWpblPlayerLink()
  const teamLink = useWpblTeamLink()
  // ERA is stored on the league's basis and rescaled at DISPLAY time, so the same formatter the
  // tiles and the stats board use has to price a winner's headline figure too, or a pitcher's
  // ERA on this card would disagree with her ERA everywhere else. See AwardStat in derive/awards.
  const { fmtEra } = useEraBasis()
  const { award, candidates } = entry

  const bucket = state.results[award.id] ?? {}
  const total = awardVoteCount(state.results, award.id)
  const votesOf = (key: string) => bucket[key] ?? 0
  // Vote order, write-ins included, the same list the tiles fall back to at close. Only names
  // with real votes are winners: a slate carries four candidates whether or not anyone picked
  // them, and withWriteIns keeps the seeded four in the list at zero.
  const ranked = useMemo(() => withWriteIns(candidates, {
    bucket, players, picked: state.ballot[award.id] ?? null, reveal: true, closed: true,
  }).filter(c => votesOf(c.key) > 0), [candidates, bucket, players, state.ballot, award.id])

  const teamOf = (id: string | null) => (id ? teams.find(t => t.id === id) ?? null : null)
  const label = (c: AwardCandidate) => (c.playerId ? short(c.name) : c.name)
  const pct = (c: AwardCandidate) => (total > 0 ? Math.round((votesOf(c.key) / total) * 100) : 0)

  // A per-award share button, open to everyone. Tapping it opens a small menu (Share / Copy /
  // Download); the chosen action builds a picture of this one result and runs it.
  const shareBtnRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sharing, setSharing] = useState<ShareAction | null>(null)

  const winner = ranked[0] ?? null
  const runnersUp = ranked.slice(1, 3)
  // The empty groove a share bar fills, faint in both themes.
  const track = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)'

  // The way out of the hero row: a player to her page, a club (manager, aura) to the club page.
  // A play or game winner has no page these two helpers reach, so it simply is not a link, the
  // same rule the tile's `exit` follows.
  const winnerPlayer = winner?.playerId ? players.find(p => p.id === winner.playerId) ?? null : null
  const winnerTeam = winner ? teamOf(winner.teamId) : null
  const exit = winner && winnerPlayer && onOpenPlayer
    ? playerLink(winnerPlayer, onOpenPlayer)
    : winner && !winnerPlayer && winnerTeam && onOpenTeam
      ? teamLink(winnerTeam, () => onOpenTeam(winnerTeam))
      : null

  // Every portrait rings in its OWN club's accent, so a card reads as one colour per row: the
  // hero in the winner's, each runner-up in theirs. Overriding the default secondary ring is what
  // stops the accent from stacking outside it as a second hue (see the ring note on the hero).
  const portrait = (c: AwardCandidate, size: number) => {
    const ring = wpblAccent(c.teamId, dark)
    const headshot = wpblManagerPortraitSet(c.key)
    if (c.playerId || headshot) return <PlayerPortrait name={c.name} teamId={c.teamId} size={size} src={headshot} ring={ring} />
    const t = teamOf(c.teamId)
    return t ? <TeamBadge team={t} size={size} ring={ring} /> : null
  }

  // The confetti fires from the winner portrait but is DRAWN in this outer box, which is not
  // overflow-clipped, so the burst flies past the results card's rounded corners instead of being
  // cut off at its top edge. Measuring the portrait after layout gives an exact origin and rim at
  // any chrome/text scale; the size is fixed (56px) so the number is stable before the image loads.
  const rootRef = useRef<HTMLDivElement>(null)
  const portraitRef = useRef<HTMLDivElement>(null)
  const [origin, setOrigin] = useState<{ x: number; y: number; r: number } | null>(null)
  useLayoutEffect(() => {
    const root = rootRef.current, port = portraitRef.current
    if (!winner || !root || !port) { setOrigin(null); return }
    const rr = root.getBoundingClientRect(), pr = port.getBoundingClientRect()
    setOrigin({ x: pr.left - rr.left + pr.width / 2, y: pr.top - rr.top + pr.height / 2, r: pr.width / 2 })
  }, [winner?.key])

  // STAGGERED, TOP TO BOTTOM. All the winners are on screen when the sheet opens, so firing them at
  // once is one flat pop; delaying each by its position turns it into a cascade that draws the eye
  // down the results the way a reader would read them. Mounts the burst only when its turn comes,
  // so each one animates from its start rather than sitting at the rim through the wait.
  const [fire, setFire] = useState(false)
  useEffect(() => {
    if (!origin) return
    const t = window.setTimeout(() => setFire(true), index * WINNER_CONFETTI_STAGGER_MS)
    return () => window.clearTimeout(t)
  }, [origin, index])

  return (
    <Box ref={rootRef} sx={{ position: 'relative' }}>
      {/* The confetti, drawn here so it flies free of the card below rather than being clipped by
          its rounded overflow. Placed on the measured winner portrait. */}
      {origin && fire && <WinnerConfetti x={origin.x} y={origin.y} r={origin.r} />}
      {/* Off-screen capture, mounted only while an action is in flight; runs whichever the menu
          chose. */}
      {sharing && winner && (
        <WinnerShareLauncher
          action={sharing}
          data={{
            category: award.title,
            name: winner.name,
            // The FULL 512 file, not the thumbnail `.src` a set hands out, so the capture is sharp:
            // manager headshot, else the player's bundled portrait, else the club logo.
            portraitSrc: wpblManagerPortrait(winner.key)
              ?? (winner.playerId ? wpblPortrait(winner.name) : null)
              ?? (winner.teamId ? wpblLogo(winner.teamId) : null),
            teamId: winner.teamId,
            initials: winner.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join(''),
            detail: (() => {
              // The FULL club name ("Boston Hunters") in the share card's subtitle, not the
              // nickname the compact rows use.
              const t = teamOf(winner.teamId)
              const full = t ? wpblFullName(t) : null
              return winner.playerId
                ? [full, winner.sub].filter(Boolean).join(' · ')
                : (winner.sub ?? full ?? '')
            })(),
            stats: (winner.stats ?? []).filter(s => s.label !== 'Team').slice(0, 3).map(s => ({
              value: s.eraBasisValue !== undefined ? fmtEra(s.eraBasisValue) : s.value, label: s.label,
            })),
            pct: pct(winner),
          }}
          onDone={() => setSharing(null)}
        />
      )}
      {/* THE CATEGORY IS THE EYEBROW, NOT THE HEADLINE. In the voting view the award's name is
          the question and takes the largest type; here the question is answered, so the winner's
          name is the thing worth reading big and the category steps back to a label above it.
          The share button sits on this row. */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.75 }}>
        <Typography sx={{
          // The category, stepped up so it reads as the section heading it is. Uppercase and
          // secondary keep it clearly below the winner's name, which is bigger still.
          fontSize: { xs: TYPE_SCALE.body, md: TYPE_SCALE.title }, fontWeight: 800, letterSpacing: 0.5,
          textTransform: 'uppercase', color: 'text.secondary', lineHeight: 1.3, minWidth: 0,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{award.title}</Typography>
        {winner && (
          <Box
            ref={shareBtnRef}
            {...pressable(() => {
              if (sharing) return
              // On a phone the native share sheet already offers copy and save, so go straight to
              // it; only fall back to our own Copy/Download menu where a file share is unavailable.
              if (canNativeShareFiles()) setSharing('share')
              else setMenuOpen(true)
            })}
            aria-label={`Share the ${award.title} result`}
            aria-haspopup="menu"
            title="Share this result"
            sx={{
              ...TAPPABLE, ...FOCUS_RING, flexShrink: 0, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: chromePx(4),
              borderRadius: 999, px: chromePx(8), py: chromePx(4),
              border: '1px solid', borderColor: 'divider', color: 'text.secondary',
              ...hoverOnly({ borderColor: 'var(--wpbl-accent-solid)', color: 'var(--wpbl-accent-solid)' }),
            }}
          >
            <IosShare sx={{ fontSize: TYPE_SCALE.body }} />
            <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800 }}>
              {sharing ? '…' : 'Share'}
            </Typography>
          </Box>
        )}
      </Box>

      {/* The desktop fallback menu: only reached where there is no native file share (the button
          goes straight to the OS sheet otherwise). Copy where the clipboard takes an image;
          Download always, as the floor every browser can do. No "Share…" item here: it would just
          repeat the button, and this menu only exists where a native share is not possible. */}
      <Menu
        anchorEl={shareBtnRef.current}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        // Above the results sheet (ModalShell defaults to 1500), or the menu opens behind it and
        // the tap looks like it did nothing.
        sx={{ zIndex: 1700 }}
      >
        {canCopyImage() && (
          <MenuItem onClick={() => { setMenuOpen(false); setSharing('copy') }}>
            <ListItemIcon><ContentCopy fontSize="small" /></ListItemIcon>
            Copy image
          </MenuItem>
        )}
        <MenuItem onClick={() => { setMenuOpen(false); setSharing('download') }}>
          <ListItemIcon><Download fontSize="small" /></ListItemIcon>
          Download
        </MenuItem>
      </Menu>

      {!winner ? (
        // No votes at all. A hero row here would crown a zero, so say the true thing instead.
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled', lineHeight: 1.4 }}>
          No votes in this category yet.
        </Typography>
      ) : (
        // ONE BAR SCALE FOR THE WHOLE CARD. The winner and the runners-up are the SAME row shape,
        // and every bar spans the full card width from the same left edge, filled to that name's
        // share of the vote. That is the whole fix for the bars reading oddly before: they used to
        // start at different x's and run to different maxes (the hero's flush to the card, each
        // runner's inset under its name), so two lengths a reader is meant to compare could not be.
        // Now 41% and 38% are 41% and 38% of the same line, and the winner is set apart by size,
        // weight and a colour wash instead of by a bar that did not line up.
        <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          {[winner, ...runnersUp].map((c, idx) => {
            const isWinner = idx === 0
            const rowAccent = wpblAccent(c.teamId, dark)
            // Only the winner links out, the one name this card is really about; a runner-up is a
            // figure in a chart here, not a destination.
            const rowExit = isWinner ? exit : null
            // Drop the aura award's lone "Team" stat: the club is already in the subtitle below the
            // name, so the stat just repeats it. Leaves aura as name + subtitle, nothing else.
            const stats = (c.stats ?? []).filter(s => s.label !== 'Team').slice(0, 3)
            const club = teamOf(c.teamId)?.name
            const detail = c.playerId ? [club, c.sub].filter(Boolean).join(' · ') : (c.sub ?? club ?? '')
            return (
              <Box
                key={c.key}
                {...(rowExit ?? {})}
                aria-label={rowExit ? `Open ${c.name}` : undefined}
                sx={{
                  position: 'relative',
                  display: 'flex', alignItems: 'center', gap: chromePx(isWinner ? 12 : 10),
                  // The extra bottom padding is the room the full-width share bar sits in.
                  px: chromePx(14),
                  pt: chromePx(isWinner ? 12 : 9),
                  pb: chromePx(isWinner ? 16 : 13),
                  // The winner alone gets the colour wash; the runners-up stay plain so the hero
                  // reads as the answer and they read as the field.
                  bgcolor: isWinner ? `${rowAccent}1f` : 'transparent',
                  textDecoration: 'none', color: 'text.primary',
                  ...(rowExit ? { cursor: 'pointer', ...TAPPABLE, ...FOCUS_RING } : null),
                }}
              >
                {/* The rank on a runner-up, so 2 and 3 read as places rather than as two more
                    winners. The hero needs none: it is the winner by every other signal here. */}
                {!isWinner && (
                  <Typography sx={{
                    fontSize: TYPE_SCALE.caption, fontWeight: 800, color: 'text.disabled',
                    width: chromePx(14), flexShrink: 0, fontVariantNumeric: 'tabular-nums',
                  }}>{idx + 1}</Typography>
                )}
                {/* One ring, in the row's own club accent (see the portrait helper): the hero and
                    each runner are keyed to their own club rather than stacking a second hue. The
                    winner's portrait is measured (ref) so the confetti above can fire from its
                    exact centre and rim. */}
                <Box ref={isWinner ? portraitRef : undefined} sx={{ flexShrink: 0, display: 'flex' }}>
                  {portrait(c, isWinner ? 56 : 30)}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  {/* The winner's FULL name behind a trophy; the runners-up abbreviate to hold one
                      line. The hero name steps up on desktop so it stays the biggest thing on the
                      card, above the enlarged category heading. */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: chromePx(6), minWidth: 0 }}>
                    <Typography sx={{
                      fontSize: isWinner ? { xs: TYPE_SCALE.title, md: TYPE_SCALE.heading } : TYPE_SCALE.body,
                      fontWeight: isWinner ? 800 : 700, lineHeight: 1.2, minWidth: 0,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{isWinner ? c.name : label(c)}</Typography>
                    {isWinner && (
                      // The one place the section spends a trophy: it marks the winner and nothing
                      // else on the sheet competes for the mark. After the name so it reads as a
                      // seal on it. Gold rather than the club accent, because a trophy reads as
                      // first place in a colour a green or blue one would not; sized off the name.
                      <EmojiEvents titleAccess="Winner" sx={{
                        fontSize: { xs: TYPE_SCALE.title, md: TYPE_SCALE.heading }, color: '#eab308', flexShrink: 0,
                      }} />
                    )}
                  </Box>
                  {isWinner && detail && (
                    <Typography sx={{
                      // A step up on desktop, where the caption size was barely legible in the
                      // wide hero; still compact on a phone.
                      fontSize: { xs: TYPE_SCALE.caption, md: TYPE_SCALE.meta },
                      color: 'text.secondary', lineHeight: 1.35, mt: '2px',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{detail}</Typography>
                  )}
                  {/* THE HEADLINE STAT LINE, on the winner only: the same figures the tile carded
                      her on, so the result says WHY as well as who. Empty for a write-in or an
                      open-field category, which carry no figures by design.

                      THE VALUES ARE THE READABLE HALF, so they carry the weight and the size and
                      the labels stay small and quiet beside them. On desktop the values step up to
                      body, where a caption-sized stat line all but disappeared in the wide row. */}
                  {isWinner && stats.length > 0 && (
                    <Box sx={{
                      display: 'flex', flexWrap: 'wrap', alignItems: 'baseline',
                      columnGap: chromePx(10), rowGap: '2px', mt: '4px',
                    }}>
                      {stats.map(s => (
                        <Box key={s.label} sx={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                          <Typography component="span" sx={{
                            fontSize: { xs: TYPE_SCALE.body, md: TYPE_SCALE.title }, fontWeight: 800,
                            color: 'text.primary', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums',
                          }}>{s.eraBasisValue !== undefined ? fmtEra(s.eraBasisValue) : s.value}</Typography>
                          <Typography component="span" sx={{
                            fontSize: { xs: TYPE_SCALE.caption, md: TYPE_SCALE.meta }, fontWeight: 700,
                            letterSpacing: 0.3, textTransform: 'uppercase', color: 'text.secondary', lineHeight: 1.2,
                          }}>{s.label}</Typography>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
                <Box sx={{ flexShrink: 0, textAlign: 'right' }}>
                  <Typography sx={{
                    fontSize: isWinner ? TYPE_SCALE.heading : TYPE_SCALE.body,
                    fontWeight: isWinner ? 900 : 800, lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums', color: rowAccent,
                  }}>{pct(c)}%</Typography>
                </Box>
                {/* THE SHARE BAR: full card width, same left edge and same 100% for every row, so
                    the lengths are comparable. It doubles as the divider between rows. */}
                <Box aria-hidden sx={{
                  position: 'absolute', left: 0, right: 0, bottom: 0, height: chromePx(4), bgcolor: track,
                }}>
                  <Box sx={{ height: '100%', width: `${pct(c)}%`, bgcolor: rowAccent }} />
                </Box>
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

// ─── the sheet ───────────────────────────────────────────────────────────────────

function FanVoteSheet({ entries, players, teams, state, closed, testerPreview = false, voterCount = null, onClose, onOpenPlayer, onOpenTeam }: {
  entries: AwardBallotEntry[]
  players: WpblPlayer[]
  teams: WpblTeam[]
  state: FanVoteState
  closed: boolean
  /** The closed state is a tester preview rather than the real deadline: say so, and don't let
   *  the sheet claim voting has finished when it has not. */
  testerPreview?: boolean
  /** Distinct people who voted, for the results header. Null until it loads. */
  voterCount?: number | null
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
      // fourth figure fitting and not. 880 is where the VOTING grid stops gaining: past it the
      // portrait and the name stay put and the gap after the figures grows instead.
      //
      // THE RESULTS VIEW WANTS MORE, though: it is a single wide row per category (a hero and its
      // bars), so the extra width goes into the name, the stat line and the bar rather than into a
      // gap, which is why the closed sheet opens wider.
      maxWidth={{ xs: 560, md: closed ? 1040 : 880 }}
      onClose={onClose}
      footer={
        <Box {...pressable(onClose)} sx={{
          ...FOCUS_RING, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 2, cursor: 'pointer', userSelect: 'none',
          bgcolor: 'var(--wpbl-accent-solid)', color: '#fff', fontWeight: 800, fontSize: TYPE_SCALE.title,
        }}>{closed || answered === entries.length ? 'Done' : `Done · ${answered} of ${entries.length}`}</Box>
      }
    >
      <Box sx={{ px: 2, py: 1.75, display: 'flex', flexDirection: 'column', gap: 2.75 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.45 }}>
          {testerPreview
            // The locked state, shown early to a tester. Say it is a preview and that voting is
            // still live, so the read-only ballot below does not read as an early shutdown.
            ? 'Tester preview of the locked ballot. Voting is still open for everyone else.'
            : closed
            // ONE LINE AT 375px, WHICH IS WHAT DECIDES THE WORDING. This sits between the sheet's
            // title and the first question, and at two lines it pushes the first grid of faces far
            // enough down that the sheet opens on a paragraph. The date says what a sentence about
            // first pitch of the final would, to anyone holding the bracket, and the ballot's own
            // header carries the rest.
            ? 'Voting is closed. Here is how it finished.'
            : `Change your votes until ${AWARDS_CLOSE_LABEL}.`}
        </Typography>
        {/* THE ONE HONEST HEADCOUNT. A per-category tally counts answers, so summing it double-
            counts anyone who voted in more than one category; this is the distinct-voter number,
            the same one the admin panel reports (see fetchWpblAwardVoterCount). Only on the results
            view, and only once it is a real number, so it never flashes a zero while it loads. */}
        {closed && voterCount != null && voterCount > 0 && (
          <Typography sx={{
            fontSize: TYPE_SCALE.title, fontWeight: 800, color: 'text.primary', lineHeight: 1.3, mt: -1.5,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {voterCount.toLocaleString()} {voterCount === 1 ? 'fan' : 'fans'} voted
          </Typography>
        )}
        {/* THE WALL, AND IT STANDS BEHIND THE QUESTIONS RATHER THAN IN FRONT OF THEM. A reader
            who is not signed in still gets the whole ballot: every category, every nominee,
            every figure, and the tally on anything already decided. What they cannot do is
            answer, and this is the one line that says so. Same shape and the same reasoning as
            the pick'em's.

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
        {/* LOCKED READS AS A RESULTS PAGE, OPEN READS AS A BALLOT. Once voting is closed the even
            grid of tiles is the wrong shape (see AwardResult): there is a winner, so the sheet
            shows one per category instead of asking a question that is already answered. */}
        {closed
          ? entries.map((e, i) => (
            <AwardResult key={e.award.id} entry={e} index={i} players={players} teams={teams} state={state}
              onOpenPlayer={onOpenPlayer} onOpenTeam={onOpenTeam} />
          ))
          : entries.map(e => (
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
            // `body`, the same size as the deadline line at the top of the sheet, so this is in the
            // sheet's own voice rather than in fine print. Not `caption` in `text.disabled`, which is the
            // treatment for a stat label: at the foot of a long sheet that reads as legal boilerplate,
            // too quiet to be a credit and too flat to look like anywhere you could go.
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
  const engaged = useFanAwardsEngaged()
  const t = now()
  if (!fanVoteAwards().some(a => t < Date.parse(a.closesAt))) return null
  // Already been in. See markFanAwardsEngaged: an invitation you have accepted is nagging.
  if (engaged) return null
  return (
    <Box
      {...linkPress(WPBL_AWARDS_PATH, () => {
        markFanAwardsEngaged()
        onOpen?.()
        track(EVENTS.WPBL_AWARD_OPEN, { answered: 0, from: 'cta' })
      })}
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
          Closes {AWARDS_CLOSE_LABEL}.
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
  // EVERY WAY INTO THE SHEET, IN ONE PLACE. The strip's own tap is marked at the tap, but the
  // card's rows and a cold load of /wpbl/awards both arrive here as `open` with nothing having
  // been pressed on this page, and a reader who read the whole ballot has plainly dealt with
  // the invitation whether or not they answered anything.
  useEffect(() => { if (open) markFanAwardsEngaged() }, [open])

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

  // `drawable` asks only whether there is a ballot worth drawing. The ballot is open to
  // everybody, so there is no audience gate here: this stays exactly one call so the "gated by
  // nothing" invariant in routes.test.ts holds, and nothing below hides the ballot from anyone.
  const drawable = fanVoteIsWorthDrawing(entries)
  const state = useFanVote(drawable)
  const clockClosed = useMemo(
    () => entries.length > 0 && entries.every(e => now() > Date.parse(e.award.closesAt)),
    [entries, now])

  // A TESTER PREVIEW OF THE LOCKED BALLOT, and NOT a gate. Everyone still gets the full,
  // votable ballot (drawable is untouched, and this never suppresses a render); a tester sees
  // the closed rendering ahead of the real deadline so the locked state can be checked before
  // the one evening it is ever live. It changes presentation only: voting still goes through
  // wpbl_cast_award_vote, which has no clock, so for a tester the ballot is in fact still open
  // underneath the preview. clockClosed remains the real answer for every other reader.
  const isTester = useIsTester()
  const testerPreview = isTester && !clockClosed && entries.length > 0
  const closed = clockClosed || testerPreview

  // HOW MANY PEOPLE VOTED, fetched only for the results view, where it is the one honest headline
  // the per-category tallies cannot give (a category count is answers, not people). It is the same
  // distinct-voter number the admin panel reports; see fetchWpblAwardVoterCount. Only when closed,
  // so the open ballot pays nothing for it.
  const [voterCount, setVoterCount] = useState<number | null>(null)
  useEffect(() => {
    if (!closed) return
    let cancelled = false
    fetchWpblAwardVoterCount(FAN_VOTE_IDS).then(n => { if (!cancelled) setVoterCount(n) })
    return () => { cancelled = true }
  }, [closed])

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
      // A tester sees the locked rendering before the deadline, so the subtitle says so plainly:
      // without it a tester reads the closed ballot as voting having shut early and files a bug.
      subtitle={testerPreview ? 'Tester preview of the locked ballot. Voting is still open.'
        : closed ? 'Voting is closed. See where it finished.'
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

          FACES, because a nominee's face is what makes an award read as a contest rather than
          as a form; without them the card is a column of titles, the word "Vote" and a wide
          empty middle on a desktop. Every candidate already carries a portrait and a club.

          THE PILE IS THE SEEDED SHORTLIST, IN SEEDED ORDER, which is what keeps it clear of the
          hidden-until-you-answer rule. It is the same list the sheet opens with and leaks
          nothing about how anyone voted; deliberately NOT `withWriteIns`, which sorts by votes
          once the tally is out and would turn this row into a running result. */}
      {/* FILLS THE CARD, on the desktop pairing where it is stretched to match the taller card
          beside it (Next game, with its season stats). Rather than let 70-odd pixels pool as a
          gap under the last row, the rows GROW EQUALLY into it (`flex: 1 0 auto` each), so every
          row gains the same few pixels with its faces centred and the dividers stay snug between
          them. Spreading with a gap instead opens canyons between rows, which reads as a list
          coming apart. Below md there is no stretch, so the rows sit at their content height. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
        {entries.map((e, i) => {
          const picked = state.ballot[e.award.id]
          const mineC = picked
            ? (e.candidates.find(c => c.key === picked)
              ?? (() => { const p = players.find(x => x.id === picked)
                return p ? { key: p.id, name: p.name, teamId: p.team_id, playerId: p.id, line: '' } as AwardCandidate : null })())
            : null
          // ONCE LOCKED, THE ROW IS THE WINNER, NOT YOUR VOTE. The card is a glance at the ballot;
          // while it is open that glance is your own five picks, but after it closes the answer is
          // the crowd's, so the row shows who won (write-ins included, the same resolution the
          // results sheet uses) with a trophy in place of your pick. Null only if nobody voted the
          // category, which the row then shows as a dash.
          const bucket = state.results[e.award.id] ?? {}
          const winnerC = closed
            ? (withWriteIns(e.candidates, { bucket, players, picked: picked ?? null, reveal: true, closed: true })
                .find(c => (bucket[c.key] ?? 0) > 0) ?? null)
            : null
          // Three faces: enough to read as a field, few enough to leave the question room on a
          // 375px phone. Your own pick (or, once locked, the winner) replaces the pile entirely,
          // because the one name on this row that matters is the one that should be on it.
          const faces = closed
            ? (winnerC ? [winnerC] : e.candidates.slice(0, 3))
            : (mineC ? [mineC] : e.candidates.slice(0, 3))
          return (
            <Box key={e.award.id}
              {...linkPress(WPBL_AWARDS_PATH, () => { setOpen(true); track(EVENTS.WPBL_AWARD_OPEN, { answered, from: e.award.id }) })}
              sx={{
                ...TAPPABLE, ...FOCUS_RING, cursor: 'pointer',
                textDecoration: 'none', color: 'text.primary',
                // Grow to share the card's slack (see the note on the column above); `0 auto` so a
                // row never shrinks below its own content and its natural height is the floor.
                flex: '1 0 auto',
                display: 'flex', alignItems: 'center', gap: 1, minWidth: 0,
                py: 0.85, borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider',
              }}
            >
              <Typography sx={{
                fontSize: TYPE_SCALE.body, fontWeight: 700, minWidth: 0,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{e.award.title}</Typography>
              <Box sx={{ flex: 1, minWidth: chromePx(8) }} />
              {/* Overlapped, with a ring in the card's own colour so the edges stay separate against a
                  portrait behind them. `chromePx` on the overlap because it is structure: left raw it
                  would not shrink with the art it is overlapping.

                  `isolation` IS LOAD-BEARING: WITHOUT IT THE PILE DRAWS OVER THE TOOLBAR. The faces
                  below order themselves with `zIndex`, and a FLEX ITEM honours z-index with no
                  `position` at all, which is the part that surprises: each face becomes a stacking
                  context in the page's own order rather than in this pile's. Their nearest such
                  ancestor is then the swipe pager, three components up, whose `transform` makes one.
                  So as Home scrolls, these portraits carry their own compositing past the sticky
                  toolbar and draw ON TOP of it, while the award's name beside them slides under it
                  correctly. It reads as a rendering glitch rather than a z-index bug precisely because
                  the rest of the row behaves.

                  One line confines them: the three indexes compete only with each other, which is all
                  they were ever meant to do. Ordering siblings inside a pile is what this property is
                  for, and any pile of overlapping art that reaches for z-index wants it. */}
              <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, isolation: 'isolate' }}>
                {faces.map((c, j) => (
                  <Box key={c.key} sx={{
                    display: 'flex', borderRadius: '50%',
                    ml: j === 0 ? 0 : `calc(-1 * ${chromePx(9)})`,
                    boxShadow: t => `0 0 0 2px ${t.palette.background.paper}`,
                    // Later faces sit UNDER earlier ones, so the pile reads left to right in
                    // seeded order rather than the last one covering the seed.
                    zIndex: faces.length - j,
                  }}>
                    {(() => {
                      // A manager has no playerId but a bundled headshot keyed on her `mgr:` key,
                      // the same one the results sheet's portrait helper uses; without this the
                      // card fell back to the club badge for Manager of the Year while the sheet
                      // showed her face.
                      const headshot = wpblManagerPortraitSet(c.key)
                      if (c.playerId || headshot) return <PlayerPortrait name={c.name} teamId={c.teamId} size={26} src={headshot} />
                      const t = teams.find(x => x.id === c.teamId)
                      return t ? <TeamBadge team={t} size={26} /> : null
                    })()}
                  </Box>
                ))}
              </Box>
              {closed ? (
                winnerC ? (
                  // The winner, with a trophy in place of your pick. Gold, and after the name, the
                  // same treatment the results sheet gives its heroes.
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: chromePx(4), flexShrink: 0 }}>
                    <Typography sx={{
                      fontSize: TYPE_SCALE.body, fontWeight: 800, color: 'text.primary', whiteSpace: 'nowrap',
                    }}>{winnerC.playerId ? short(winnerC.name) : winnerC.name}</Typography>
                    <EmojiEvents titleAccess="Winner" sx={{ fontSize: TYPE_SCALE.body, color: '#eab308' }} />
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'text.disabled', flexShrink: 0 }}>&#8212;</Typography>
                )
              ) : (
                <Typography sx={{
                  fontSize: TYPE_SCALE.body, fontWeight: mineC ? 800 : 700, flexShrink: 0,
                  whiteSpace: 'nowrap',
                  color: mineC ? 'text.primary' : 'var(--wpbl-accent-solid)',
                }}>{mineC ? (mineC.playerId ? short(mineC.name) : mineC.name) : 'Vote'}</Typography>
              )}
            </Box>
          )
        })}
      </Box>
      {open && (
        <FanVoteSheet entries={entries} players={players} teams={teams} state={state} closed={closed}
          testerPreview={testerPreview} voterCount={voterCount}
          onClose={() => setOpen(false)} onOpenPlayer={onOpenPlayer} onOpenTeam={onOpenTeam} />
      )}
    </SectionCard>
  )
}
