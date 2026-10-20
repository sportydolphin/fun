import { useMemo } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import { ModalShell, pressable, FOCUS_RING, TAPPABLE, TYPE_SCALE } from '../ui'
import { type ShareCardData } from '../awardShareCard'
import AwardsWinnersExport from '../AwardsWinnersExport'
import { useEraBasis } from '../EraBasisContext'
import { fanVoteAwards, AWARDS_CLOSE_LABEL, WPBL_AWARDS_CREDIT, awardsCreditLine } from '../awards'
import type { AwardBallotEntry } from '../derive/awards'
import type { WpblPlayer, WpblTeam } from '../types'
import type { FanVoteState } from './useFanVote'
import { AwardQuestion } from './AwardQuestion'
import { winnerShareData, AwardResult } from './AwardResult'

// ─── the sheet ───────────────────────────────────────────────────────────────────

export function FanVoteSheet({ entries, players, teams, state, closed, testerPreview = false, voterCount = null, loading = false, failed = false, onClose, onOpenPlayer, onOpenTeam }: {
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
  /** The results are still in flight: draw each category's result empty (see AwardResult's
   *  `skeleton`) so the sheet can open at once and nothing in it moves when they land. */
  loading?: boolean
  /** Everything has answered and there is still no ballot to draw. Says so, rather than leaving
   *  the skeleton up forever or closing a sheet the reader asked for. */
  failed?: boolean
  onClose: () => void
  onOpenPlayer?: (p: WpblPlayer) => void
  onOpenTeam?: (t: WpblTeam) => void
}) {
  const answered = entries.filter(e => state.ballot[e.award.id]).length
  const { fmtEra } = useEraBasis()
  // Every category's winner as share-card data, for the admin-only "export all winners" poster.
  // Only built once voting is locked, since that is the only time there is a winner to draw.
  const winners = useMemo(
    () => (closed
      ? entries.map(e => winnerShareData(e, state, players, teams, fmtEra)).filter((w): w is ShareCardData => w !== null)
      : []),
    [closed, entries, state, players, teams, fmtEra],
  )
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
        {/* Reserved while it loads, since nearly every ballot has a voter: the line arriving
            under the reader would push all five results down. */}
        {closed && !failed && (voterCount == null || voterCount > 0) && (() => {
          const line = (
            <Typography sx={{
              fontSize: TYPE_SCALE.title, fontWeight: 800, color: 'text.primary', lineHeight: 1.3,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {voterCount == null ? '000 fans voted' : `${voterCount.toLocaleString()} ${voterCount === 1 ? 'fan' : 'fans'} voted`}
            </Typography>
          )
          return <Box sx={{ mt: -1.5 }}>{voterCount == null ? <Skeleton>{line}</Skeleton> : line}</Box>
        })()}
        {/* Owner-only, and it renders nothing for anyone else (the gate lives inside the component,
            so this file stays free of the role check the ballot must never carry). One poster of
            every winner, in the same card art as the per-result Share button. */}
        {closed && <AwardsWinnersExport winners={winners} />}
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
              border: '1px solid', borderColor: 'var(--wpbl-accent-fg)',
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
        {failed
          ? (
            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled', lineHeight: 1.4 }}>
              The results did not load. Try again in a moment.
            </Typography>
          )
          : loading
          // Keyed on the award id, the same key the loaded rows use, so React keeps each
          // category's box and only swaps what is inside it.
          ? fanVoteAwards().map((award, i) => (
            <AwardResult key={award.id} entry={{ award, candidates: [], statsFor: () => [] }} index={i}
              players={players} teams={teams} state={state} skeleton />
          ))
          : closed
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
              coloring the name is how the rest of the section marks somewhere to go, and it is
              the half a reader would actually be looking for. */}
          <Box component="span" sx={{
            fontWeight: 800, color: 'var(--wpbl-accent-fg)',
            '@media (hover: hover)': { 'a:hover &': { textDecoration: 'underline' } },
          }}>{WPBL_AWARDS_CREDIT.name}</Box>
        </Typography>
      </Box>
    </ModalShell>
  )
}
