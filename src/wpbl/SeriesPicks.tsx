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
import { fetchWpblAwardBallot, fetchWpblAwardResults, castWpblAwardVote } from './awardVotes'
import type { AwardBallot, AwardResults } from './awardVotes'
import { track, EVENTS } from '../lib/analytics'
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
 * NO SIGN-IN WALL. A pick is stored against the browser (see awardVotes.ts), the same rule the
 * fan-award ballot sets and for the reason it gives: an account requirement on a poll with
 * nothing at stake costs more real answers than it saves fake ones. It is also the honest option
 * while nothing here scores a pick, since signing in would buy the reader precisely nothing
 * today. The sheet says where the picks are kept rather than leaving them to wonder.
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
  cast: (category: string, choice: string) => void
}

export function useSeriesPicks(enabled: boolean): SeriesPickState {
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
    Promise.all([fetchWpblAwardBallot(), fetchWpblAwardResults()]).then(([ballot, results]) => {
      if (cancelled) return
      setState({ ballot, results, loaded: true })
    })
    return () => { cancelled = true }
  }, [enabled])

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
    void castWpblAwardVote(category, choice)
  }, [])

  return { ...state, cast }
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
    <Box sx={{
      px: 1, py: 0.5, borderTop: '1px solid', borderColor: 'divider',
      display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0,
    }}>
      <Typography sx={{
        fontSize: TYPE_SCALE.caption, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase',
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
export function PickemButton({ bracket, state, from }: {
  bracket: WpblBracket; state: SeriesPickState; from: string
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
        {...pressable(() => { setOpen(true); track(EVENTS.WPBL_PICKEM_OPEN, { answered, from }) })}
        sx={{
          ...TAPPABLE, ...FOCUS_RING,
          mt: 1.25, borderRadius: 2, px: 1.5, py: 1, cursor: 'pointer', userSelect: 'none',
          display: 'flex', alignItems: 'center', gap: 1, minWidth: 0,
          // Full width on a phone, capped on a desktop. The card is 1,200px wide there, and a
          // button that wide is a banner: its label and its chevron end up a metre apart and
          // nothing about it reads as pressable. `chromePx` because this is a structural length
          // and not room reserved for a string, so it follows the desktop chrome scale and not
          // the reader's text size.
          maxWidth: { xs: '100%', sm: chromePx(400) },
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
function PickTile({ label, on, accent, share, showShare, onClick, badge, ariaLabel }: {
  label: string
  on: boolean
  accent: string
  share: number
  showShare: boolean
  onClick?: () => void
  badge?: WpblTeam
  ariaLabel: string
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
        position: 'relative', overflow: 'hidden', flex: 1, minWidth: 0,
        display: 'flex', alignItems: 'center', gap: 0.9,
        borderRadius: 2, border: '1px solid', px: 1, py: 0.85,
        cursor: onClick ? 'pointer' : 'default',
        borderColor: on ? accent : 'divider',
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
        <SectionLabel>{series.label}</SectionLabel>
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled', mt: 0.75, lineHeight: 1.4 }}>
          Call both semifinals and this becomes the two clubs you sent through.
        </Typography>
      </Box>
    )
  }

  const showShare = !!picked || !open
  const lengths = options.filter(o => o.teamId === activeTeam)
  const canPick = open && state.loaded

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
        <Box role={canPick ? 'radiogroup' : undefined} aria-label={`${series.label}: in how many`}
          sx={{ display: 'flex', gap: 0.75, mt: 0.75 }}>
          {lengths.map(o => (
            <PickTile
              key={o.choice}
              label={o.label}
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
            : !activeTeam ? 'Pick a club.'
              : draftTeam || !picked ? 'Now say how long.'
                : shares.total > 1 ? `${shares.total} fans have called this one.` : 'Called.'}
      </Typography>
    </Box>
  )
}

function PickemSheet({ bracket, state, onClose }: {
  bracket: WpblBracket; state: SeriesPickState; onClose: () => void
}) {
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
          starts. Kept on this device, no account needed.
        </Typography>
        {[...bracket.semifinals, bracket.championship].map(s => (
          <SeriesQuestion key={s.label} series={s} bracket={bracket} state={state} />
        ))}
      </Box>
    </ModalShell>
  )
}
