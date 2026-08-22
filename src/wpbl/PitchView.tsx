import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress, useMediaQuery } from '@mui/material'
import {
  fetchWpblAllPitchPlays, fetchWpblAllPlayers,
  getCachedWpblAllPitchPlays, getCachedWpblAllPlayers,
} from './api'
import {
  aggregatePitchCodes, pitchQualifiers, rankBy, fmtPct,
  type PitchBoard, type PitchProfile, type PitchCounts, type PitchKind,
} from './derive/pitches'
import { wpblAccentFg } from './constants'
import { SectionCard, LeaderRow, CARD_BORDER, useWpblDark } from './ui'
import type { WpblGame, WpblPlayer, WpblTeam } from './types'
import { wpblQualifiers } from './stats'

// The Pitches board: plate discipline and pitch mix for the whole league, from the one code
// letter per pitch that the feed puts on every plate appearance (see derive/pitches.ts).
//
// It sits beside Tracked on the Stats tab's source axis rather than inside it, because the two
// answer the same kind of question from opposite ends: TrackMan measures how a pitch moved and
// covers two games, this counts what the pitch DID and covers all of them. Keeping them as
// peers is what makes the coverage note on each one meaningful.

// ── Pitch outcomes ───────────────────────────────────────────────────────────────
//
// A ranked bar per outcome, under the one split that explains all six: the batter either
// offered or did not. It replaced a six-colour stacked bar, which asked the reader to hold a
// colour key in their head and then read six widths off one line, the widest slice of which
// was 1%. Here the label sits on its own row, the length is the value, and colour carries a
// single fact (take or swing) rather than six arbitrary ones.
//
// ORDERING. Two descending runs, one per group, under a heading that says which group and how
// big it is. Sorting all six by size instead would put "In play" between "Hit by pitch" and
// "Foul" and break the colour grouping for nothing; leaving them ungrouped and unsorted, which
// is what the first version did, made the run of bars look arbitrary (long, medium, tiny,
// medium) because nothing marked where one group ended.
//
// Names are spelled out. "Called" and "Swinging" alone read as adjectives with the noun
// missing; both are strikes, and that is the point of listing them apart from Ball.
type Offer = 'take' | 'swing'

const OUTCOMES: { key: keyof PitchCounts & PitchKind; label: string; offer: Offer }[] = [
  { key: 'ball',     label: 'Ball',            offer: 'take' },
  { key: 'called',   label: 'Called strike',   offer: 'take' },
  { key: 'hbp',      label: 'Hit by pitch',    offer: 'take' },
  { key: 'inplay',   label: 'In play',         offer: 'swing' },
  { key: 'foul',     label: 'Foul',            offer: 'swing' },
  { key: 'swinging', label: 'Swinging strike', offer: 'swing' },
]

const GROUPS: { offer: Offer; label: string }[] = [
  { offer: 'take', label: 'Taken' },
  { offer: 'swing', label: 'Swung at' },
]

// Two colours, each meaning one thing, and both dark enough to clear 3:1 against the surface
// they sit on. The light-mode pair is not the dark pair: #60a5fa measures 2.3:1 on this app's
// light surfaces (see wpblAccentFg in constants.ts), which is fine for a fill behind white
// text and not fine for a bar whose length IS the information.
const offerColors = (isDark: boolean): Record<Offer, string> => ({
  take: isDark ? '#94a3b8' : '#64748b',
  swing: wpblAccentFg(isDark),
})

// The three columns every row lines up on, group headings included, so a group's bar reads as
// the sum of the bars indented under it.
const LABEL_W = { xs: 104, sm: 112 }
const VALUE_W = 34

function PitchMix({ counts, total }: { counts: PitchCounts; total: number }) {
  const color = offerColors(useWpblDark())
  if (total === 0) return null

  const groupTotal: Record<Offer, number> = {
    take: counts.ball + counts.called + counts.hbp,
    swing: counts.swinging + counts.foul + counts.inplay,
  }
  // One scale for everything, set by the bigger of the two groups, so the widest bar on the
  // chart fills its track and every other bar is honestly proportional to it. Scaling to 100%
  // instead would leave the largest group at three-fifths and the 1% row invisible.
  const scale = Math.max(groupTotal.take, groupTotal.swing) || 1
  const width = (n: number) => `${(n / scale) * 100}%`

  return (
    <Box sx={{ display: 'grid', rowGap: 0.3 }}>
      {GROUPS.map(g => (
        <Box key={g.offer} sx={{ display: 'grid', rowGap: 0.3, mt: g.offer === 'swing' ? 0.85 : 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{
              width: LABEL_W, flexShrink: 0, fontSize: '0.62rem', fontWeight: 800,
              textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', whiteSpace: 'nowrap',
            }}>{g.label}</Typography>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ width: width(groupTotal[g.offer]), height: 10, borderRadius: 5, bgcolor: color[g.offer] }} />
            </Box>
            <Typography sx={{ width: VALUE_W, flexShrink: 0, textAlign: 'right', fontSize: '0.72rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {fmtPct(groupTotal[g.offer] / total, 0)}
            </Typography>
          </Box>

          {OUTCOMES.filter(o => o.offer === g.offer && counts[o.key] > 0).map(o => (
            <Box key={o.key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ width: LABEL_W, flexShrink: 0, pl: 1, fontSize: '0.72rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                {o.label}
              </Typography>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {/* minWidth keeps the 1% row (hit by pitch) a bar rather than a dot. */}
                <Box sx={{ width: width(counts[o.key]), minWidth: 3, height: 6, borderRadius: 3, bgcolor: color[o.offer], opacity: 0.75 }} />
              </Box>
              <Typography sx={{ width: VALUE_W, flexShrink: 0, textAlign: 'right', fontSize: '0.72rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {fmtPct(counts[o.key] / total, 0)}
              </Typography>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

/** The league's four headline numbers, as one divided block rather than four tinted cards.
 *
 *  The cards were a blue gradient wash with the number set in the same blue on top of it,
 *  which muddied the one thing here that should be legible from across the room and spent the
 *  section's accent on decoration. Accent now means something everywhere it appears on this
 *  board (a rank, a value in a leaderboard, the swung-at half of the chart), and the numbers
 *  are simply the most contrast on the page at the biggest size.
 *
 *  One bordered box divided by hairlines, rather than four boxes with gaps: these are four
 *  readings off the same instrument, not four separate things, and the season table and
 *  Standings next door are both drawn as a border on the page this way.
 *
 *  TWO BY TWO AT EVERY WIDTH, including desktop, where there is room for four across and it
 *  is still wrong: the block shares a row with the outcome chart there, so four columns land
 *  in about 80px each and every subtitle truncates to "across all...". A phone is the wider
 *  of the two places this renders. */
function StatStrip({ items }: { items: { label: string; value: string; sub: string }[] }) {
  return (
    <Box sx={{
      display: 'grid', gridTemplateColumns: '1fr 1fr',
      // Fill the row rather than sitting at its natural height. Beside the outcome chart this
      // block is the shorter of the two by about 40px, which read as a gap hanging under a
      // bordered box rather than as two columns of one header. The rows share whatever height
      // that leaves, so the border still closes level with the last bar.
      height: '100%', gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
      border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden',
    }}>
      {items.map((t, i) => (
        <Box key={t.label} sx={{
          px: 1.25, py: 1.1, minWidth: 0,
          // Centred so the slack from the stretch above is split above and below each tile,
          // instead of collecting under the text and against the hairline.
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          // Interior hairlines only: a left edge for the right-hand column, a top edge for
          // every row after the first.
          borderColor: 'divider', borderStyle: 'solid',
          borderWidth: 0,
          borderLeftWidth: i % 2 === 1 ? '1px' : 0,
          borderTopWidth: i >= 2 ? '1px' : 0,
        }}>
          <Typography sx={{
            fontSize: '0.58rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7,
            color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{t.label}</Typography>
          <Typography sx={{
            fontSize: { xs: '1.5rem', sm: '1.6rem' }, fontWeight: 800, lineHeight: 1.15,
            letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'text.primary',
          }}>{t.value}</Typography>
          <Typography sx={{
            fontSize: '0.68rem', color: 'text.secondary', lineHeight: 1.35,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{t.sub}</Typography>
        </Box>
      ))}
    </Box>
  )
}

/** A figure inside a sentence: tabular so the header line does not jitter as the numbers
 *  update mid-game, and weighted so the line scans as data rather than prose. */
function Num({ children }: { children: React.ReactNode }) {
  return (
    <Box component="span" sx={{ fontWeight: 800, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
      {children}
    </Box>
  )
}

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 5, px: 2, color: 'text.secondary' }}>
      <Typography sx={{ fontSize: '1rem', fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      {hint && <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled' }}>{hint}</Typography>}
    </Box>
  )
}

/** One leaderboard: a rate, ranked, with the league's own number in the subtitle so a reader
 *  can tell a good one from a bad one without knowing the sport's baselines.
 *
 *  `explain` is a plain sentence, not a formula. Most of these are a percentage of something,
 *  and the honest way to say that out loud is "how often X happens", not "X per Y" (which
 *  means a different thing and was the first version) or "X as a share of Y" (which is right
 *  and reads like a statistics textbook). Anyone who wants the formula can read the number. */
function RateBoard({ title, explain, rows, valueOf, subOf, league, accent, onOpenPlayer }: {
  title: string
  explain: string
  rows: PitchProfile[]
  valueOf: (p: PitchProfile) => string
  subOf: (p: PitchProfile) => string
  league: string
  accent: string
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  return (
    <SectionCard bare title={title} subtitle={`${explain} · League ${league}`}>
      {rows.length === 0
        ? <EmptyState title="Not enough pitches yet" />
        : rows.slice(0, 10).map((p, i) => (
            <LeaderRow key={p.player?.id ?? p.name} rank={i + 1} player={p.player} name={p.name} teamId={p.teamId}
              value={valueOf(p)} sub={subOf(p)} accent={accent} onOpen={onOpenPlayer} />
          ))}
    </SectionCard>
  )
}

export default function WpblPitchView({ side, teams, games, trackedVisible, onOpenPlayer }: {
  // Which half of the game to show. Owned by the Stats bar above, exactly as Tracked takes it,
  // so switching Hitting/Pitching up there carries through instead of being asked twice.
  side: 'hitting' | 'pitching'
  teams: WpblTeam[]
  // Required, not convenience: the aggregation cannot tell a postseason plate appearance from a
  // regular-season one without the schedule. See aggregatePitchCodes.
  games: WpblGame[]
  /** Whether the Tracked board is currently offered on the bar above. The footnote points
   *  readers there for velocity and spin, and must not point at a chip that is not there:
   *  Tracked hides itself while the league has published radar for barely any games. */
  trackedVisible?: boolean
  onOpenPlayer: (p: WpblPlayer) => void
}) {
  const [plays, setPlays] = useState(() => getCachedWpblAllPitchPlays())
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [loading, setLoading] = useState(() => getCachedWpblAllPitchPlays() == null)

  // Refetch on every mount, but paint from the session cache first. The bulk fetchers collapse
  // anything inside their own freshness window, so a reader flipping Tracked ⇆ Pitches does not
  // re-run the season-wide play scan; a genuinely stale tab still picks up the new games.
  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblAllPitchPlays(), fetchWpblAllPlayers()])
      .then(([p, pl]) => {
        if (cancelled) return
        setPlays(p); setPlayers(pl); setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const board: PitchBoard | null = useMemo(
    () => (plays ? aggregatePitchCodes(plays, players, games) : null), [plays, players, games])

  // Same bar the season table uses, restated in pitches: a hitter who qualifies there should
  // qualify here, so the two boards do not disagree about who counts as a regular.
  const qual = useMemo(() => wpblQualifiers(teams, games), [teams, games])
  const mins = useMemo(() => pitchQualifiers(qual.active ? qual.teamGames : 0), [qual])

  // Readable on both themes: these boards use it for the ranked value, which is text.
  const accent = wpblAccentFg(useWpblDark())
  // Same breakpoint the Stats table uses for its own phone layout.
  const narrow = useMediaQuery('(max-width:600px)')
  const pitching = side === 'pitching'
  const min = pitching ? mins.minPitcher : mins.minBatter
  const pool = pitching ? board?.pitchers ?? [] : board?.batters ?? []
  const league = board?.league

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  }
  if (!board || board.pitches === 0 || !league) {
    return <EmptyState title="No pitch data yet" hint="These boards fill in from the play-by-play as games are played." />
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 1.5, sm: 2 } }}>
      {/* One title line and the mix bar, and that is the whole header.
          It was a tinted coverage callout, three stat tiles and a titled card around the bar:
          about 300px on a phone, which put the first leaderboard row below the fold on a board
          whose entire purpose is leaderboards. The coverage claim still has to be made, since
          "all 16 games" against Tracked's two is the reason this board exists, so it is made in
          the subtitle instead of a box. The numbers the tiles carried are in the same line, and
          "what each pitch did, not how fast" moved to the footnote at the bottom. */}
      {/* Two columns from md up, one on a phone. Stacked full-width, the four tiles and the
          outcome chart each ran the width of the page for a line and a half of content apiece,
          which on a desktop is a lot of empty measure and a first leaderboard pushed down for
          no reason. Side by side they read as one header block and cost half the height. */}
      <Box>
        <Typography component="h2" sx={{ fontSize: { xs: '1rem', sm: '1.1rem' }, fontWeight: 800, lineHeight: 1.2 }}>
          Every pitch, every game
        </Typography>
        <Box sx={{
          // Stretch, not start: the two columns are one header block, so the shorter of them
          // fills the row instead of leaving a hole below it. See StatStrip.
          mt: 1, display: 'grid', alignItems: 'stretch',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1.15fr)' },
          gap: { xs: 1.5, md: 2.5 },
        }}>
          <StatStrip items={[
            { label: 'Pitches', value: board.pitches.toLocaleString(),
              sub: `across all ${board.gameCount} ${board.gameCount === 1 ? 'game' : 'games'}` },
            { label: 'Per PA', value: (league.pitchesPerPa ?? 0).toFixed(2),
              sub: `${board.pa.toLocaleString()} plate appearances` },
            { label: 'Strikes', value: fmtPct(league.strikePct, 0),
              sub: `${fmtPct(league.firstStrikePct, 0)} on the first pitch` },
            { label: 'Swung at', value: fmtPct(league.swingPct, 0),
              sub: `${fmtPct(league.contactPct, 0)} made contact` },
          ]} />

          <Box>
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.secondary', mb: 0.75 }}>
              Pitch outcomes
            </Typography>
            <PitchMix counts={league.counts} total={board.pitches} />
          </Box>
        </Box>
      </Box>

      {pitching ? (
        <>
          <RateBoard
            title="Swing and miss" explain="How often a pitch draws a swing and a miss"
            league={fmtPct(league.swStrPct)} accent={accent} onOpenPlayer={onOpenPlayer}
            rows={rankBy(pool, 'swStrPct', min, false, league)}
            valueOf={p => fmtPct(p.swStrPct)}
            subOf={p => `${fmtPct(p.whiffPct)} of ${p.swings} swings missed`}
          />
          <RateBoard
            title="Strike throwers" explain="How often a pitch is a strike"
            league={fmtPct(league.strikePct)} accent={accent} onOpenPlayer={onOpenPlayer}
            rows={rankBy(pool, 'strikePct', min, false, league)}
            valueOf={p => fmtPct(p.strikePct)}
            subOf={p => narrow
              ? `${fmtPct(p.firstStrikePct)} first pitch · ${(p.pitchesPerPa ?? 0).toFixed(2)}/PA`
              : `${fmtPct(p.firstStrikePct)} first-pitch strikes · ${(p.pitchesPerPa ?? 0).toFixed(2)} per PA`}
          />
          <RateBoard
            title="Putting hitters away" explain="How often a two-strike count ends in a strikeout"
            league={fmtPct(league.putawayPct)} accent={accent} onOpenPlayer={onOpenPlayer}
            rows={rankBy(pool, 'putawayPct', min, false, league)}
            valueOf={p => fmtPct(p.putawayPct)}
            subOf={p => `${p.strikeouts} of ${p.twoStrikePa} two-strike PA`}
          />
        </>
      ) : (
        <>
          <RateBoard
            title="Best contact" explain="How often a swing makes contact"
            league={fmtPct(league.contactPct)} accent={accent} onOpenPlayer={onOpenPlayer}
            rows={rankBy(pool, 'contactPct', min, false, league)}
            valueOf={p => fmtPct(p.contactPct)}
            subOf={p => `${fmtPct(p.swingPct)} swing rate · ${p.swings} swings`}
          />
          <RateBoard
            title="Making them work" explain="Pitches seen in an average plate appearance"
            league={(league.pitchesPerPa ?? 0).toFixed(2)} accent={accent} onOpenPlayer={onOpenPlayer}
            rows={rankBy(pool, 'pitchesPerPa', min, false, league)}
            valueOf={p => (p.pitchesPerPa ?? 0).toFixed(2)}
            subOf={p => `${fmtPct(p.swingPct)} swing rate · ${p.pa} PA`}
          />
          <RateBoard
            title="Two-strike survivors" explain="How rarely two strikes turns into a strikeout"
            league={fmtPct(league.putawayPct)} accent={accent} onOpenPlayer={onOpenPlayer}
            rows={rankBy(pool, 'putawayPct', min, true, league)}
            valueOf={p => fmtPct(p.putawayPct)}
            subOf={p => narrow
              ? `${p.strikeouts} of ${p.twoStrikePa} two-strike PA`
              : `${p.strikeouts} ${p.strikeouts === 1 ? 'strikeout' : 'strikeouts'} in ${p.twoStrikePa} two-strike PA`}
          />
        </>
      )}

      <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', textAlign: 'center', px: 1, lineHeight: 1.5 }}>
        Counted from the play-by-play, one code per pitch: what each pitch did, not how fast it
        was.{trackedVisible ? ' Velocity and spin are on Tracked.' : ''}
        {' '}{pitching ? `Pitchers with at least ${min} pitches thrown.` : `Hitters with at least ${min} pitches seen.`}
        {' '}Postseason games are left out, like every other season number here.
        {league.counts.unknown > 0 && ` ${league.counts.unknown} pitches carried a code we don't recognise and are left out of the rates.`}
      </Typography>
    </Box>
  )
}
