import { useCallback, useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { TeamBadge, pressable, FOCUS_RING, TAPPABLE, useWpblDark, TYPE_SCALE } from './ui'
import { wpblAccent } from './constants'
import {
  seriesPickCategory, seriesPickOptions, seriesPickOpen, seriesResultChoice,
  championshipEntrants, parsePickChoice, pickShares,
} from './derive/seriesPicks'
import type { SeriesPickOption } from './derive/seriesPicks'
import {
  fetchWpblAwardBallot, fetchWpblAwardResults, castWpblAwardVote,
} from './awardVotes'
import type { AwardBallot, AwardResults } from './awardVotes'
import { track, EVENTS } from '../lib/analytics'
import type { BracketSeries, WpblBracket } from './derive/bracket'
import type { WpblTeam } from './types'

/**
 * Call the postseason: one pick per series, club and series score.
 *
 * WHY THIS AND NOT A WINNER PICKER. The bracket already prints each club's chance to win the
 * series and the title, to a percentage. A pick that only named a winner would be the reader
 * agreeing or disagreeing with a number already on the same card. "In three" is the part no
 * model on this page states, and it is what people actually argue about.
 *
 * IT STORES INTO THE AWARDS BALLOT, which is a real feature and not a shortcut: see the header
 * of derive/seriesPicks.ts. One browser, one answer per question, changeable until the series
 * starts, aggregate-readable by everyone.
 *
 * THE TALLY IS HIDDEN UNTIL YOU ANSWER. A poll that shows its results first is a poll that
 * measures how the first fifty voters felt, because everyone after them is answering a
 * different question. Once the series is under way the bars show regardless, since there is
 * nothing left to influence.
 */

/** Everything the strips on one card share: the ballot, the tally, and how to write to them.
 *  Held once by the bracket rather than per series, so three strips make two requests instead
 *  of six and a vote updates its own bar without asking the server for the sum again. */
export interface SeriesPickState {
  ballot: AwardBallot
  results: AwardResults
  loaded: boolean
  cast: (category: string, choice: string) => void
}

export function useSeriesPicks(enabled: boolean): SeriesPickState {
  const [ballot, setBallot] = useState<AwardBallot>({})
  const [results, setResults] = useState<AwardResults>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    Promise.all([fetchWpblAwardBallot(), fetchWpblAwardResults()]).then(([b, r]) => {
      if (cancelled) return
      setBallot(b); setResults(r); setLoaded(true)
    })
    return () => { cancelled = true }
  }, [enabled])

  /**
   * Record a pick, and move the bars locally rather than re-reading the tally.
   *
   * OPTIMISTIC IN BOTH DIRECTIONS, including taking the old answer back off its bar, because a
   * reader who changes their mind is the case where a stale total is visible: their first pick
   * would otherwise keep its share while their second gained one, and the percentages would
   * add to more than a hundred on their screen. The server has the same arithmetic in
   * `wpbl_award_results`; this is only saving a round trip to agree with it.
   */
  const cast = useCallback((category: string, choice: string) => {
    setBallot(prev => {
      const was = prev[category]
      if (was === choice) return prev
      setResults(r => {
        const bucket = { ...(r[category] ?? {}) }
        if (was) bucket[was] = Math.max(0, (bucket[was] ?? 1) - 1)
        bucket[choice] = (bucket[choice] ?? 0) + 1
        return { ...r, [category]: bucket }
      })
      return { ...prev, [category]: choice }
    })
    track(EVENTS.WPBL_PICKEM_CAST, { category, choice })
    // Nothing is rolled back on failure. The write is an upsert on a table with no select
    // policy, so a failure here is a lost pick and not a wrong one, and yanking a chip back
    // out from under somebody is a worse answer to a flaky network than letting them try again.
    void castWpblAwardVote(category, choice)
  }, [])

  return { ballot, results, loaded, cast }
}

/** One club's row of scorelines. The club is the row and the score is the chip, so a
 *  best-of-five reads as one name and three lengths rather than as six sentences. */
function PickRow({ team, options, picked, result, showBars, shares, onPick, seriesLabel }: {
  team: WpblTeam
  /** Named on every control, because the same club and the same length appear in two series:
   *  "Heights in 3" is both a semifinal answer and a championship one, and a label that cannot
   *  tell them apart is one a screen reader cannot either. */
  seriesLabel: string
  options: SeriesPickOption[]
  picked: string | null
  /** The choice the series actually ended on, once it has. */
  result: string | null
  showBars: boolean
  shares: { total: number; share: (choice: string) => number }
  onPick: ((choice: string) => void) | null
}) {
  const dark = useWpblDark()
  const accent = wpblAccent(team.id, dark)

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <TeamBadge team={team} size={18} />
      {/* Reserving room for a club abbreviation, so it goes in rem: at a larger text size a
          px column keeps its width while the letters in it grow. */}
      <Typography sx={{
        width: '1.75rem', flexShrink: 0, fontSize: TYPE_SCALE.caption, fontWeight: 800,
        color: 'text.secondary', whiteSpace: 'nowrap',
      }}>{team.abbr}</Typography>
      <Box role={onPick ? 'radiogroup' : undefined} aria-label={`${seriesLabel}: ${team.name} in how many`}
        sx={{ display: 'flex', gap: 0.5, flex: 1, minWidth: 0 }}>
        {options.map(o => {
          const on = picked === o.choice
          const won = result === o.choice
          const share = shares.share(o.choice)
          return (
            <Box
              key={o.choice}
              {...pressable(onPick ? () => onPick(o.choice) : undefined)}
              // A single-choice group, so the chips are radios rather than buttons. That is
              // what a screen reader needs to say "2 of 4" and read the selection back, and it
              // is also what keeps them out of every `getAllByRole('button')` that walks a
              // series box looking for its two club rows.
              role={onPick ? 'radio' : undefined}
              aria-checked={onPick ? on : undefined}
              aria-label={`${seriesLabel}: ${team.name} ${o.label}`}
              sx={{
                position: 'relative', overflow: 'hidden', flex: 1, minWidth: 0,
                borderRadius: 1, border: '1px solid', px: 0.5, py: 0.35,
                textAlign: 'center', cursor: onPick ? 'pointer' : 'default',
                borderColor: won ? 'success.main' : on ? accent : 'divider',
                bgcolor: on ? `${accent}1f` : 'transparent',
                ...(onPick ? TAPPABLE : null),
                ...FOCUS_RING,
              }}
            >
              {/* The crowd's share, drawn UNDER the label rather than beside it: the chips are
                  narrow enough that a percentage and a scoreline cannot both be legible, and a
                  bar is the half a reader takes in without reading. */}
              {showBars && (
                <Box aria-hidden sx={{
                  position: 'absolute', inset: 0, width: `${share * 100}%`,
                  bgcolor: accent, opacity: on ? 0.28 : 0.16,
                }} />
              )}
              <Typography sx={{
                position: 'relative', fontSize: TYPE_SCALE.caption, fontWeight: on || won ? 900 : 700,
                whiteSpace: 'nowrap', color: won ? 'success.main' : on ? 'text.primary' : 'text.secondary',
              }}>
                {o.label}{showBars && shares.total > 0 ? ` · ${Math.round(share * 100)}%` : ''}
              </Typography>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/**
 * The strip under one series box.
 *
 * Renders nothing at all rather than an empty prompt when there is nothing to ask: a series
 * whose clubs are unknown and whose feeder picks have not been made yet is a question the
 * reader cannot answer, and a disabled control saying so on every visit is chrome.
 */
export default function SeriesPicks({ series, bracket, state, from }: {
  series: BracketSeries
  bracket: WpblBracket
  state: SeriesPickState
  from: string
}) {
  const category = seriesPickCategory(series.round, series.key)
  const isFinal = series.round === 'championship'
  const teams = isFinal
    ? championshipEntrants(bracket, state.ballot)
    : [series.home.team, series.away.team]
  const open = seriesPickOpen(series)
  const options = seriesPickOptions(series.round, teams)
  const picked = state.ballot[category] ?? null
  const result = seriesResultChoice(series)
  const shares = pickShares(state.results[category], options)

  // The final, before the reader has called both semifinals. Said out loud rather than left
  // blank, because the box above it is visibly the one series with no question under it.
  if (isFinal && options.length === 0) {
    return open ? (
      <Typography sx={{
        fontSize: TYPE_SCALE.caption, color: 'text.disabled', px: 1, pt: 0.6, pb: 0.75,
        borderTop: '1px solid', borderColor: 'divider', mt: 0.4,
      }}>Call both semifinals to pick the championship.</Typography>
    ) : null
  }
  if (options.length === 0) return null

  // A stored pick for a club that is not in the series any more. Only possible on the final,
  // and only once the semifinals have contradicted the reader.
  const bust = picked != null && !options.some(o => o.choice === picked)
  const pickedTeamId = parsePickChoice(picked ?? '')?.teamId ?? null
  const bustName = bust
    ? [...bracket.semifinals.flatMap(s => [s.home.team, s.away.team])]
      .find(t => t?.id === pickedTeamId)?.name ?? null
    : null

  const showBars = !!picked || !open
  const onPick = open && state.loaded ? (choice: string) => state.cast(category, choice) : null

  return (
    <Box sx={{ px: 1, pt: 0.6, pb: 0.75, borderTop: '1px solid', borderColor: 'divider', mt: 0.4 }}>
      <Typography sx={{
        fontSize: TYPE_SCALE.caption, fontWeight: 900, letterSpacing: 0.6, textTransform: 'uppercase',
        color: 'text.disabled', mb: 0.5,
      }}>
        {result ? 'Fans called it' : open ? 'Your call' : 'Fans called it'}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {teams.map(team => team && (
          <PickRow
            key={team.id}
            team={team}
            options={options.filter(o => o.teamId === team.id)}
            picked={picked}
            result={result}
            showBars={showBars}
            shares={shares}
            onPick={onPick}
            seriesLabel={series.label}
          />
        ))}
      </Box>
      <Typography sx={{ fontSize: TYPE_SCALE.caption, color: 'text.disabled', mt: 0.5 }}>
        {bust && bustName ? `You had ${bustName}, who are not in it.`
          : !open && !picked ? 'Picks are closed for this series.'
            : shares.total > 0 ? `${shares.total} ${shares.total === 1 ? 'pick' : 'picks'}${picked && open ? ' · tap to change yours' : ''}`
              : open ? 'Be the first to call it.' : ''}
      </Typography>
      {/* Logged once per series that actually renders a question, so the ratio of strips seen
          to picks cast is answerable. Without it, an untouched pick'em and one nobody was ever
          shown look identical. */}
      <SeenOnce category={category} open={open} from={from} />
    </Box>
  )
}

function SeenOnce({ category, open, from }: { category: string; open: boolean; from: string }) {
  useEffect(() => {
    track(EVENTS.WPBL_PICKEM_SHOWN, { category, open, from })
  }, [category, open, from])
  return null
}
