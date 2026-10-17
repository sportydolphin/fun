import { useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { pressable, FOCUS_RING, TAPPABLE, TYPE_SCALE } from '../ui'
import { withWriteIns } from '../derive/awards'
import type { AwardBallotEntry, AwardCandidate } from '../derive/awards'
import { awardVoteCount } from '../awardVotes'
import { searchPlayers } from '../playerSearch'
import type { WpblPlayer, WpblTeam } from '../types'
import { NO_VOTES } from './useFanVote'
import type { FanVoteState } from './useFanVote'
import { CandidateTile } from './CandidateTile'

// ─── one category ────────────────────────────────────────────────────────────────

/**
 * One award: its question, its shortlist, a search for everyone else, and the tally once you
 * have answered it.
 *
 * THE SEARCH IS PART OF THE BALLOT AND NOT AN ESCAPE HATCH. It sits under the names with its own
 * label rather than behind a disclosure, because the claim the shortlists make is that they are a
 * starting point, and a starting point you have to go looking for is a shortlist.
 */
export function AwardQuestion({ entry, players, teams, state, closed, onOpenPlayer, onOpenTeam }: {
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
  const bucket = state.results[award.id] ?? NO_VOTES
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
              borderRadius: 2, border: '1px solid', borderColor: 'outline',
              bgcolor: 'transparent', color: 'text.primary',
              px: 1.25, py: 0.85, outline: 'none',
              '&:focus': { borderColor: 'var(--wpbl-accent-fg)' },
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
