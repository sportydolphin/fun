import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import {
  ModalShell, SectionLabel, TeamBadge, pressable, FOCUS_RING, TAPPABLE, useWpblDark, TYPE_SCALE,
  chromePx,
} from './ui'
import { wpblAccent } from './constants'
import {
  seriesPickCategory, seriesPickOptions, seriesPickOpen, seriesResultChoice,
  championshipEntrants, parsePickChoice, pickShares,
} from './derive/seriesPicks'
import {
  fetchWpblAwardBallot, fetchWpblAwardResults, castWpblAwardVote, clearWpblAwardVote,
} from './awardVotes'
import type { AwardBallot, AwardResults } from './awardVotes'
import { track, EVENTS } from '../lib/analytics'
import { useAuth } from '../AuthContext'
import type { BracketSeries, WpblBracket } from './derive/bracket'
import type { WpblTeam } from './types'

/**
 * Call the postseason: one pick per series, club and series score.
 *
 * WHY IT IS A MODE BEHIND A BUTTON AND NOT CONTROLS ON THE CARD. The first pass put four chips
 * under every series box: twelve permanent controls inside a card whose job is to draw a
 * bracket, and it asked the whole question at once. "SF in 2" and "BOS in 3" were the same size
 * and weight in one grid of four, with nothing saying which half you were answering. A reader who
 * never wants to predict anything paid for all of it on every visit. So the card carries ONE
 * control, and the picking happens somewhere with room for it.
 *
 * WHY NOT A WIN COUNTER. Tapping a club to add a win is the shape of the data rather than the
 * shape of the thought: a series prediction is one sentence, "Firebells in three", and a counter
 * makes the reader assemble it a game at a time with no obvious way back. Two taps, club then
 * length, says it in the order people say it, and the second question only ever has two or three
 * answers because the first one has already been settled.
 *
 * A PICK NEEDS AN ACCOUNT, AND THAT IS A REVERSAL. This shipped keyed to the browser, the same
 * rule the fan-award ballot sets and for the reason it gives: an account requirement on a poll
 * with nothing at stake costs more real answers than it saves fake ones, and signing in bought
 * the reader nothing. What changed is the second half. These picks are going to be scored and
 * published, so "who picked what" has to survive a cleared cache and a second device, and a
 * browser id survives neither. A leaderboard built on one would credit a stranger's phone.
 *
 * SO THE PICK'EM KEYS ON THE USER ID WHILE THE AWARDS BALLOT STAYS ON THE BROWSER, and
 * `wpbl_award_votes.voter_key` now holds two kinds of value. That is deliberate and worth
 * knowing: the two features want opposite trades, one wants every answer it can get and the
 * other wants answers it can attribute. Nothing in the table distinguishes them, and nothing
 * needs to, because a category belongs to exactly one of the two.
 *
 * A SIGNED-OUT READER STILL SEES THE QUESTIONS. The gate is on answering, not on looking: the
 * sheet opens, the clubs and formats are all there, and the controls are replaced by one line
 * saying why. Hiding the feature behind the wall would cost the sign-ups the wall is for.
 *
 * THE TALLY IS HIDDEN UNTIL YOU ANSWER. A poll that shows its results first stops measuring what
 * people think and starts measuring what the first fifty people thought. Once a series is under
 * way the shares show regardless, since by then there is nothing left to influence.
 */

/** The ballot, the tally, and how to write to them. Held once by the bracket rather than by each
 *  series, so the whole card costs two requests and a pick moves its own bar without asking the
 *  server for the sum again. */
export interface SeriesPickState {
  ballot: AwardBallot
  results: AwardResults
  loaded: boolean
  /** Whether this reader can answer at all. False signs out every control in the sheet and
   *  puts the reason in their place. */
  canPick: boolean
  /** Open the sign-in dialog, for the prompt that replaces the controls. */
  signIn: () => void
  cast: (category: string, choice: string) => void
  /** Take answers back entirely. Several at once, because the reader thinks of their picks as
   *  one thing and clearing them one series at a time is three confirmations of the same
   *  decision. */
  clear: (categories: string[]) => void
}

export function useSeriesPicks(enabled: boolean): SeriesPickState {
  // THE ACCOUNT IS THE BALLOT ID. See the header: these picks get scored and published, so
  // they have to survive a cleared cache and follow the reader to a second device, which a
  // browser id does neither of.
  const { user, openAuthDialog } = useAuth()
  const voterKey = user?.id ?? null
  // ONE PIECE OF STATE HOLDING BOTH HALVES, because a pick moves both at once. Two useStates
  // meant the tally update had to happen inside the ballot's updater, which is a side effect
  // inside a function React is entitled to call more than once for the same change: under
  // StrictMode that is exactly what it does, and the reader's own vote would have been counted
  // twice on their screen and nowhere else.
  const [state, setState] = useState<{ ballot: AwardBallot; results: AwardResults; loaded: boolean }>(
    { ballot: {}, results: {}, loaded: false })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    // The tally is public and is read either way, because a series that has started shows
    // its shares to everyone. Only the BALLOT needs a key, and a signed-out reader has no
    // ballot to fetch rather than an empty one.
    Promise.all([
      voterKey ? fetchWpblAwardBallot(voterKey) : Promise.resolve({} as AwardBallot),
      fetchWpblAwardResults(),
    ]).then(([ballot, results]) => {
      if (cancelled) return
      setState({ ballot, results, loaded: true })
    })
    return () => { cancelled = true }
  }, [enabled, voterKey])

  /**
   * Record a pick, and move the bars locally rather than re-reading the tally.
   *
   * OPTIMISTIC IN BOTH DIRECTIONS, including taking the old answer back off its bar, because a
   * reader changing their mind is the case where a stale total shows: their first pick would
   * keep its share while their second gained one, and the percentages would add to more than a
   * hundred on their own screen. `wpbl_award_results` does the same arithmetic; this only saves
   * a round trip to agree with it.
   */
  const cast = useCallback((category: string, choice: string) => {
    setState(prev => {
      const was = prev.ballot[category]
      if (was === choice) return prev
      const bucket = { ...(prev.results[category] ?? {}) }
      if (was) bucket[was] = Math.max(0, (bucket[was] ?? 1) - 1)
      bucket[choice] = (bucket[choice] ?? 0) + 1
      return {
        ...prev,
        ballot: { ...prev.ballot, [category]: choice },
        results: { ...prev.results, [category]: bucket },
      }
    })
    track(EVENTS.WPBL_PICKEM_CAST, { category, choice })
    // Nothing is rolled back on failure. The write is an upsert through a definer function, so a
    // failure is a lost pick rather than a wrong one, and yanking a selection back out from under
    // somebody is a worse answer to a flaky network than letting them tap again.
    void castWpblAwardVote(category, choice, voterKey ?? undefined)
  }, [voterKey])

  /** Withdraw answers, and take them back off their bars. Same optimism as `cast`, and the same
   *  reason for it: the server does this arithmetic too, this only saves the round trip. */
  const clear = useCallback((categories: string[]) => {
    if (categories.length === 0) return
    setState(prev => {
      const ballot = { ...prev.ballot }
      const results = { ...prev.results }
      for (const category of categories) {
        const was = ballot[category]
        if (!was) continue
        delete ballot[category]
        const bucket = { ...(results[category] ?? {}) }
        bucket[was] = Math.max(0, (bucket[was] ?? 1) - 1)
        results[category] = bucket
      }
      return { ...prev, ballot, results }
    })
    track(EVENTS.WPBL_PICKEM_CLEAR, { count: categories.length })
    for (const category of categories) void clearWpblAwardVote(category, voterKey ?? undefined)
  }, [voterKey])

  return { ...state, cast, clear, canPick: !!voterKey, signIn: () => openAuthDialog('signin') }
}

// ─── one series, resolved against this reader's ballot ─────────────────────────

/** Everything both surfaces need about one series: who can be picked, what was picked, whether
 *  it can still be answered. Computed in one place because the card and the sheet asking the
 *  same question two ways is how they come to disagree about whether the final is answerable. */
function useSeriesPick(series: BracketSeries, bracket: WpblBracket, state: SeriesPickState) {
  const category = seriesPickCategory(series.round, series.key)
  const teams = series.round === 'championship'
    ? championshipEntrants(bracket, state.ballot)
    : [series.home.team, series.away.team]
  const options = seriesPickOptions(series.round, teams)
  const picked = state.ballot[category] ?? null
  return {
    category,
    teams: teams.filter((t): t is WpblTeam => !!t),
    options,
    picked,
    /** A stored pick this series can no longer offer. Only reachable on the final, and only once
     *  the semifinals have contradicted the reader. */
    bust: picked != null && options.length > 0 && !options.some(o => o.choice === picked),
    open: seriesPickOpen(series),
    result: seriesResultChoice(series),
    shares: pickShares(state.results[category], options),
  }
}

/** "Firebells in 3", from a stored choice. Null when it names nobody this bracket knows about. */
function pickSentence(choice: string | null, bracket: WpblBracket): string | null {
  const p = parsePickChoice(choice ?? '')
  if (!p) return null
  const all = [
    ...bracket.semifinals.flatMap(s => [s.home.team, s.away.team]),
    bracket.championship.home.team, bracket.championship.away.team,
  ]
  const team = all.find(t => t?.id === p.teamId)
  return team ? `${team.name} in ${p.wins + p.losses}` : null
}

// ─── on the card ───────────────────────────────────────────────────────────────

/**
 * What a series box carries once the reader has answered it, or once it is past answering.
 *
 * Read-only by design: the controls live in the sheet. This is the receipt, and it is what makes
 * the button worth pressing, since a pick that disappeared into a dialog would be a pick nobody
 * could see they had made.
 */
export function SeriesPickLine({ series, bracket, state }: {
  series: BracketSeries; bracket: WpblBracket; state: SeriesPickState
}) {
  const dark = useWpblDark()
  const { picked, bust, open, result, shares } = useSeriesPick(series, bracket, state)
  const mine = pickSentence(picked, bracket)

  if (!mine) return null
  const right = !!result && result === picked
  const accentId = parsePickChoice(picked ?? '')?.teamId ?? null

  return (
    // `px: 1.25` and not 1, because this is the fourth row of a series box and the three above
    // it (the header band, the club rows, the dates) all sit at 1.25. At 1 the receipt hung 2px
    // out past a stack of otherwise flush edges, on both sides at once, which reads as the row
    // being pasted on rather than as part of the box.
    <Box sx={{
      px: 1.25, py: 0.5, borderTop: '1px solid', borderColor: 'divider',
      display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0,
    }}>
      <Typography sx={{
        fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
        color: 'text.disabled', flexShrink: 0,
      }}>{result ? (right ? 'You called it' : 'You had') : 'Your call'}</Typography>
      <Typography sx={{
        fontSize: TYPE_SCALE.caption, fontWeight: 800, minWidth: 0,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        color: result ? (right ? 'success.main' : 'text.disabled')
          : accentId ? wpblAccent(accentId, dark) : 'text.secondary',
        textDecoration: bust ? 'line-through' : 'none',
      }}>{mine}</Typography>
      <Box sx={{ flex: 1 }} />
      {/* The crowd, but only where it cannot influence the answer: the reader has answered, or
          the series has started. Before either, `shares` is zero and this does not draw. */}
      {(picked || !open) && shares.total > 1 && !bust && (
        <Typography sx={{
          fontSize: TYPE_SCALE.caption, color: 'text.disabled', flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
        }}>{Math.round(shares.share(picked ?? '') * 100)}% agree</Typography>
      )}
    </Box>
  )
}

/**
 * The one control on the card: a full-width button that opens the mode.
 *
 * Its label is most of the design. With nothing picked it asks; part way through it says how
 * many are left, which is the only nudge that has anything true to say; once every open series
 * is called it drops to an outlined "change", because by then the strongest thing on the card
 * should be the bracket and not a receipt.
 */
export function PickemButton({ bracket, state, from, compact }: {
  bracket: WpblBracket; state: SeriesPickState; from: string
  /**
   * The header version: a pill beside the card title rather than a band across the body.
   *
   * TWO SURFACES ASK FOR IT, FOR TWO REASONS. A PHONE OPENS THIS CARD SHUT, on a measured
   * decision (it is 709px on a 375px screen and arrives at 57% scroll depth), and a collapsed
   * SectionCard renders none of its children, so a button at the top of the body is behind a tap
   * on exactly the surface where the traffic is. This one rides in the header instead, where it
   * survives the collapse, and it opens the sheet directly rather than expanding the card first:
   * from a shut card, picking is one tap rather than three. On DESKTOP the card is 1,214px wide
   * and the reason is shape: a control above the diagram spans the whole of it and reads as a
   * header band, which is what the body version's own `maxWidth` was already fighting.
   *
   * So this flag means "in the header", not "on a phone", and the `compact` it reports to
   * analytics should be read that way.
   */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)

  const all = useMemo(() => [...bracket.semifinals, bracket.championship], [bracket])
  const askable = all.filter(seriesPickOpen)
  const answered = askable.filter(s => state.ballot[seriesPickCategory(s.round, s.key)]).length
  const done = answered >= askable.length

  const shown = state.loaded && askable.length > 0
  useEffect(() => {
    if (shown) track(EVENTS.WPBL_PICKEM_SHOWN, { open: askable.length, answered, from })
  }, [shown, askable.length, answered, from])

  // Nothing left to call. The lines inside the boxes still report what was picked, so the card
  // keeps the reader's answers; it just stops asking for more.
  if (askable.length === 0) return null

  const openSheet = (e?: { stopPropagation: () => void }) => {
    // The whole SectionCard header is the collapse toggle, so the compact version has to keep
    // its own click: without this, opening the sheet also expands the card underneath it.
    e?.stopPropagation()
    setOpen(true)
    track(EVENTS.WPBL_PICKEM_OPEN, { answered, from, compact: !!compact })
  }

  if (compact) {
    return (
      <>
        <Box
          {...pressable(openSheet)}
          sx={{
            ...TAPPABLE, ...FOCUS_RING,
            borderRadius: 999, px: { xs: 1.25, sm: 1.75 }, py: { xs: 0.5, sm: 0.65 },
            cursor: 'pointer', userSelect: 'none',
            whiteSpace: 'nowrap', flexShrink: 0,
            ...(done
              ? { border: '1px solid', borderColor: 'divider', color: 'text.secondary' }
              : { bgcolor: 'var(--wpbl-accent-solid)', color: '#fff' }),
          }}
        >
          {/* Bigger from `sm` up, where this is the card's ONE action rather than a pill squeezed
              into a collapsed phone header. At the caption size it came out as a 12px label in a
              28px pill beside a 19px title, which is smaller than anything else on the card and
              reads as a footnote to the heading. On a phone the header is title, subtitle, pill
              and chevron across 375px, so the small size there is the constraint it was picked
              for and stays. */}
          <Typography sx={{ fontSize: { xs: TYPE_SCALE.caption, sm: TYPE_SCALE.body }, fontWeight: 900 }}>
            {answered === 0 ? 'Make your picks' : done ? 'Your picks' : `Picks · ${answered}/${askable.length}`}
          </Typography>
        </Box>
        {open && <PickemSheet bracket={bracket} state={state} onClose={() => setOpen(false)} />}
      </>
    )
  }

  const label = answered === 0 ? 'Make your picks'
    : !done ? `Finish your picks · ${answered} of ${askable.length}`
      : 'Change your picks'
  const hint = answered === 0
    ? 'Who wins each series, and in how many games.'
    : !done ? 'Two taps each, and you can change them until first pitch.'
      : 'Each one locks when its series starts.'

  return (
    <>
      <Box
        {...pressable(() => openSheet())}
        sx={{
          ...TAPPABLE, ...FOCUS_RING,
          borderRadius: 2, px: 1.5, py: 1, cursor: 'pointer', userSelect: 'none',
          display: 'flex', alignItems: 'center', gap: 1, minWidth: 0,
          // Full width on a phone, capped on a desktop. The card is 1,214px wide there and a
          // button that wide is a header band: its label and its chevron finish a foot apart and
          // nothing about it reads as pressable. `chromePx` because a cap on a control is a
          // structural length rather than room reserved for a string, so it follows the desktop
          // chrome scale and not the reader's text size.
          maxWidth: { xs: '100%', sm: chromePx(400) },
          mb: 1.25,
          ...(done
            ? { border: '1px solid', borderColor: 'divider', color: 'text.secondary' }
            : { bgcolor: 'var(--wpbl-accent-solid)', color: '#fff' }),
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 900, lineHeight: 1.25 }}>{label}</Typography>
          <Typography sx={{
            fontSize: TYPE_SCALE.caption, lineHeight: 1.3,
            opacity: done ? 1 : 0.85, color: done ? 'text.disabled' : 'inherit',
          }}>{hint}</Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 900, flexShrink: 0 }}>›</Typography>
      </Box>
      {open && <PickemSheet bracket={bracket} state={state} onClose={() => setOpen(false)} />}
    </>
  )
}

// ─── the mode ──────────────────────────────────────────────────────────────────

/** One tappable answer, with the crowd's share drawn behind it once that is allowed to be seen.
 *  One component for both questions, so a club and a length cannot drift into looking like two
 *  different kinds of control. */
function PickTile({ label, on, accent, share, showShare, onClick, badge, ariaLabel, follows }: {
  label: string
  on: boolean
  accent: string
  share: number
  showShare: boolean
  onClick?: () => void
  badge?: WpblTeam
  ariaLabel: string
  /**
   * This tile is the SECOND question, answered about a club chosen on the row above.
   *
   * TWO CLUBS OVER TWO LENGTHS IS A GRID, AND THE COLUMNS LIED. A best-of-3 offers exactly two
   * lengths, so a stretched length row lined up cell for cell under the two clubs: pick the club
   * on the left and "in 3" lit up in the RIGHT-hand column, directly under the club that had just
   * been rejected. Read as a grid, which is how a 2x2 of identical tiles reads, that says
   * "Hunters in 3". Nothing in the group was wrong; the layout said something the answer did not,
   * and it happened to read correctly only for the best-of-5 final, where three tiles cannot line
   * up under two.
   *
   * So a length sizes to its own label instead of claiming a column, and it carries the chosen
   * club's colour whether or not it is the selected one. Two chips cannot line up cell for cell
   * under two stretched tiles, and the hue says whose they are without the label repeating the
   * club four tiles running.
   *
   * SIDE STILL MEANS SOMETHING, though, and it is the opposite of what it used to: the row hangs
   * off the chosen club's edge (see `activeSide`), so the lengths are under the answer to the
   * question above rather than under the club that was passed over. Pinning them left whatever
   * was picked was the first fix for this and only half of one.
   */
  follows?: boolean
}) {
  return (
    <Box
      {...pressable(onClick)}
      // A single-choice group, so these are radios and not buttons: it is what a screen reader
      // needs to read the selection back, and it keeps them out of every getAllByRole('button')
      // that walks a series box looking for its two club rows.
      role={onClick ? 'radio' : undefined}
      aria-checked={onClick ? on : undefined}
      aria-label={ariaLabel}
      sx={{
        position: 'relative', overflow: 'hidden',
        // A club claims its half of the row; a length is only as wide as it needs to be. The floor
        // is in rem because it reserves room for a STRING ("in 5", with a share beside it), so it
        // has to grow with the reader's text size rather than clip at the Large setting.
        ...(follows ? { flex: '0 0 auto', minWidth: '6rem' } : { flex: 1, minWidth: 0 }),
        display: 'flex', alignItems: 'center', gap: 0.9,
        borderRadius: 2, border: '1px solid', px: 1, py: 0.85,
        cursor: onClick ? 'pointer' : 'default',
        // A length is drawn in the club's hue even when it is not the selected one, which is the
        // other half of what stops it reading as an answer about whatever sits above it. `59` is
        // roughly a third alpha: enough to bind the row together, weak enough that the selected
        // tile still wins the row.
        borderColor: on ? accent : follows ? `${accent}59` : 'divider',
        bgcolor: on ? `${accent}1f` : 'transparent',
        ...(onClick ? TAPPABLE : null),
        ...FOCUS_RING,
      }}
    >
      {showShare && (
        <Box aria-hidden sx={{
          position: 'absolute', inset: 0, width: `${share * 100}%`,
          bgcolor: accent, opacity: on ? 0.26 : 0.14,
        }} />
      )}
      {badge && <Box sx={{ position: 'relative', flexShrink: 0, display: 'flex' }}><TeamBadge team={badge} size={26} /></Box>}
      <Typography sx={{
        position: 'relative', flex: 1, minWidth: 0,
        fontSize: TYPE_SCALE.body, fontWeight: on ? 900 : 700, lineHeight: 1.2,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        // Accent whether or not it is selected: the selected tile already wins on its border,
        // its fill and its weight, and leaving it the only white label in a coloured row made the
        // unpicked one look like the live option.
        color: follows ? accent : 'text.primary',
      }}>{label}</Typography>
      {showShare && (
        <Typography sx={{
          position: 'relative', flexShrink: 0, fontSize: TYPE_SCALE.caption, fontWeight: 800,
          color: 'text.disabled', fontVariantNumeric: 'tabular-nums',
        }}>{Math.round(share * 100)}%</Typography>
      )}
    </Box>
  )
}

/**
 * One series, asked in two steps.
 *
 * THE SECOND STEP APPEARS WITH THE FIRST ANSWER, which is what turns one question of four or six
 * options into two questions of two or three. It also means a length is always read in the
 * chosen club's own colour, directly under its name, so "in 3" never has to say whose.
 *
 * A HALF-ANSWER IS NOT STORED. Choosing a club sets local state only; the row is written when
 * the length is chosen. The database holds sentences, not drafts, and a "Firebells in ?" in the
 * tally would be a pick nobody made.
 */
function SeriesQuestion({ series, bracket, state }: {
  series: BracketSeries; bracket: WpblBracket; state: SeriesPickState
}) {
  const dark = useWpblDark()
  const { category, teams, options, picked, bust, open, result, shares } =
    useSeriesPick(series, bracket, state)
  const pickedTeamId = parsePickChoice(picked ?? '')?.teamId ?? null
  const [draftTeam, setDraftTeam] = useState<string | null>(null)
  const activeTeam = draftTeam ?? (bust ? null : pickedTeamId)

  if (teams.length < 2) {
    return (
      <Box>
        {/* The format stays on the heading even with nobody in the series yet: it is a fact about
            the round rather than about its entrants, and dropping it here made the final the one
            question in the sheet that never said how long it runs. */}
        <SectionLabel>{`${series.label} · best of ${series.bestOf}`}</SectionLabel>
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled', mt: 0.75, lineHeight: 1.4 }}>
          Call both semifinals and this becomes the two clubs you sent through.
        </Typography>
      </Box>
    )
  }

  const showShare = !!picked || !open
  const lengths = options.filter(o => o.teamId === activeTeam)
  const canPick = open && state.loaded && state.canPick
  // Which end of the club row the answer is at, so the lengths can hang off the same edge. From
  // the LAST tile rather than from index 1, because the row is `teams.map` and the final's two
  // entrants come from a different function than a semifinal's.
  const activeSide = activeTeam && teams.length > 1 && teams[teams.length - 1].id === activeTeam
    ? 'right' : 'left'

  return (
    <Box>
      <SectionLabel>{`${series.label} · best of ${series.bestOf}`}</SectionLabel>
      {bust && (
        <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'warning.main', mt: 0.4 }}>
          The club you had is not in it. Call it again.
        </Typography>
      )}
      <Box role={canPick ? 'radiogroup' : undefined} aria-label={`${series.label}: who wins`}
        sx={{ display: 'flex', gap: 0.75, mt: 0.9 }}>
        {teams.map(t => (
          <PickTile
            key={t.id}
            badge={t}
            label={t.name}
            on={activeTeam === t.id}
            accent={wpblAccent(t.id, dark)}
            // A club's share is every way it could win, added up. The reader is choosing a club
            // at this step, so the number beside it has to be about the club rather than about
            // one of its scorelines.
            share={options.filter(o => o.teamId === t.id).reduce((n, o) => n + shares.share(o.choice), 0)}
            showShare={showShare}
            ariaLabel={`${series.label}: ${t.name} to win`}
            onClick={canPick ? () => setDraftTeam(t.id) : undefined}
          />
        ))}
      </Box>

      {activeTeam && lengths.length > 0 && (
        // THE LENGTHS SIT ON THE CHOSEN CLUB'S SIDE. Pick the club on the right and they move
        // right, so the second question is always under the answer to the first one and the row
        // points at its own subject. Left-aligned whatever was picked, which is what this was
        // first, the reader had to take the association on trust every time they chose the club
        // on the right.
        //
        // `flexWrap` because these do not stretch: three best-of-5 lengths at a 6rem floor want
        // 18rem plus gaps, which is more than a 320px phone has at the Large text setting.
        // Wrapping is the right answer for a row of chips and is impossible for a stretched one,
        // and with `flex-end` a wrapped row stays hung off the same edge.
        <Box role={canPick ? 'radiogroup' : undefined} aria-label={`${series.label}: in how many`}
          sx={{
            display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.75,
            justifyContent: activeSide === 'right' ? 'flex-end' : 'flex-start',
          }}>
          {lengths.map(o => (
            <PickTile
              key={o.choice}
              label={o.label}
              follows
              on={picked === o.choice}
              accent={wpblAccent(activeTeam, dark)}
              share={shares.share(o.choice)}
              showShare={showShare}
              ariaLabel={`${series.label}: ${teams.find(t => t.id === activeTeam)?.name} ${o.label}`}
              onClick={canPick ? () => { state.cast(category, o.choice); setDraftTeam(null) } : undefined}
            />
          ))}
        </Box>
      )}

      <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled', mt: 0.6 }}>
        {result ? (result === picked ? 'You called it.' : 'Decided.')
          : !open ? 'Under way, so this one is locked.'
            : !state.canPick ? 'Sign in above to call this one.'
            : !activeTeam ? 'Pick a club.'
              : draftTeam || !picked ? 'Now say how long.'
                : shares.total > 1 ? `${shares.total} fans have called this one.` : 'Called.'}
      </Typography>
    </Box>
  )
}

/**
 * Withdrawing, as opposed to changing.
 *
 * TWO TAPS, WITH THE LABEL CARRYING THE WARNING. One tap wiping three predictions deserves a
 * confirmation, and a dialog on top of a dialog to ask it is heavier than the thing being
 * confirmed. Arming resets on its own after a few seconds, so a stray tap does not leave a
 * loaded control sitting under the reader's thumb for the rest of the session.
 *
 * ONLY THE SERIES THAT ARE STILL OPEN. A locked pick cannot be changed, so it cannot be taken
 * back either: the record of what somebody called before first pitch is the whole point of
 * having called it.
 */
function ClearPicks({ categories, onClear }: { categories: string[]; onClear: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])

  if (categories.length === 0) return null
  const n = categories.length

  return (
    <Box
      {...pressable(() => { if (armed) { onClear(); setArmed(false) } else setArmed(true) })}
      sx={{
        ...TAPPABLE, ...FOCUS_RING,
        alignSelf: 'flex-start', borderRadius: 2, px: 1.25, py: 0.6, cursor: 'pointer',
        border: '1px solid', borderColor: armed ? 'error.main' : 'divider',
        color: armed ? 'error.main' : 'text.disabled',
      }}
    >
      <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800 }}>
        {armed ? `Tap again to clear ${n === 1 ? 'it' : `all ${n}`}` : 'Clear my picks'}
      </Typography>
    </Box>
  )
}

function PickemSheet({ bracket, state, onClose }: {
  bracket: WpblBracket; state: SeriesPickState; onClose: () => void
}) {
  // Answered AND still open. See ClearPicks.
  const clearable = [...bracket.semifinals, bracket.championship]
    .filter(seriesPickOpen)
    .map(s => seriesPickCategory(s.round, s.key))
    .filter(c => state.ballot[c])

  return (
    <ModalShell
      sheet
      eyebrow="Call the postseason"
      maxWidth={460}
      onClose={onClose}
      footer={
        <Box {...pressable(onClose)} sx={{
          ...FOCUS_RING, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 2, cursor: 'pointer', userSelect: 'none',
          bgcolor: 'var(--wpbl-accent-solid)', color: '#fff', fontWeight: 800, fontSize: TYPE_SCALE.title,
        }}>Done</Box>
      }
    >
      <Box sx={{ px: 2, py: 1.75, display: 'flex', flexDirection: 'column', gap: 2.25 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', lineHeight: 1.45 }}>
          Who wins, and in how many games. Change them as often as you like until a series
          starts.
        </Typography>
        {/* THE ONE PLACE THE WALL APPEARS, and it appears after the questions are visible
            rather than in front of them. A reader who is not signed in still reads the
            clubs, the formats and the deadline; what they cannot do is answer. */}
        {!state.canPick && (
          <Box
            {...pressable(state.signIn)}
            sx={{
              ...TAPPABLE, ...FOCUS_RING, borderRadius: 2, px: 1.5, py: 1.1, cursor: 'pointer',
              border: '1px solid', borderColor: 'var(--wpbl-accent-solid)',
              display: 'flex', alignItems: 'center', gap: 1, minWidth: 0,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 900, lineHeight: 1.25 }}>
                Sign in to make your picks
              </Typography>
              <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled', lineHeight: 1.35 }}>
                Picks are counted per account, so they follow you between devices and can be
                scored against how the series actually go.
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 900, flexShrink: 0 }}>›</Typography>
          </Box>
        )}
        {[...bracket.semifinals, bracket.championship].map(s => (
          <SeriesQuestion key={s.label} series={s} bracket={bracket} state={state} />
        ))}
        <ClearPicks categories={clearable} onClear={() => state.clear(clearable)} />
      </Box>
    </ModalShell>
  )
}
