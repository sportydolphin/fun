import { lazy, Suspense } from 'react'
import { Box } from '@mui/material'
import type { PlayerValueSeason } from '../derive/playerValue'
import {
  aggregateBatting, aggregatePitching, aggregateFielding,
  wpblQualifiers,
  type WpblBattingTotals, type WpblPitchingTotals, type WpblBatSeason, type WpblPitSeason, type FipWeights,
} from '../stats'
import type { WpblTeam, WpblPlayer, WpblGame, WpblBattingLine, WpblPitchingLine, WpblFieldingLine } from '../types'
import type { SeasonScope } from '../season'
import {
  type FinderBoardSide, type FinderQuery,
} from '../derive/finder'
import { OVR_COLS, type Col } from '../statColumns'
import { LeadersBoard, LeadersBoardSkeleton } from '../LeadersBoard'
import type { Side, BallSide, Source } from './axes'
import { FLD_COLS } from './columns'
import { fullBleedSx } from './layout'
import { SubViewFallback } from './Skeleton'

// The boards that render outside the shared season table, behind their own chunks. Hitting and
// Pitching are what the tab opens on; Tracking (the TrackMan boards) is a separate sub-tab with
// its own layout, not reachable without a deliberate tap. The draft-value model lives on
// /wpbl/league: it is one analysis of the draft class, not a season stat.
const WpblTrackingView = lazy(() => import('../TrackingView'))
const WpblPitchView = lazy(() => import('../PitchView'))
const WpblRunValueView = lazy(() => import('../RunValueView'))
const WpblBestsView = lazy(() => import('../BestsView'))
const WpblFindView = lazy(() => import('../FindView'))
// The draft-class model. On Stats since it left the league page: it is a question about how players
// performed, asked of the draft, and this is where a reader looks for how players performed.
const WpblDraftValue = lazy(() => import('../DraftValue'))
const WpblChartsView = lazy(() => import('../ChartsView'))

/** What the Charts board plots: the regular season's totals for the year on screen, whichever slice
 *  the tables are showing. Null while neither the stored seasons nor the box-score lines have answered. */
export interface ChartInputs {
  batting: WpblBatSeason[]
  pitching: WpblPitSeason[]
  league: { batting: WpblBattingTotals; pitching: WpblPitchingTotals }
  fWeights: FipWeights | null
}

/** The Leaders board on whichever side is showing, or that side's skeleton until its read lands. */
export function LeadersPane({ side, valueSeasons, fielding, linesIn, leaderSeasons, hitCols, pitCols, qual,
  onOpenPlayer, seeAll, seeAllHref }: {
  side: Side
  valueSeasons: PlayerValueSeason<WpblPlayer>[] | null
  fielding: WpblFieldingLine[] | null
  linesIn: boolean
  leaderSeasons: {
    batting: ReturnType<typeof aggregateBatting>
    pitching: ReturnType<typeof aggregatePitching>
    fielding: ReturnType<typeof aggregateFielding>
  }
  hitCols: Col<WpblBattingTotals>[]
  pitCols: Col<WpblPitchingTotals>[]
  qual: ReturnType<typeof wpblQualifiers>
  onOpenPlayer: (p: WpblPlayer) => void
  seeAll: (key: string) => void
  seeAllHref: (key: string) => string
}) {
  return (
    // Full bleed and not capped, as the season table is.
    <Box sx={fullBleedSx}>
      <Box>
        {side === 'overall' ? (
          valueSeasons == null ? <LeadersBoardSkeleton side="overall" /> : (
            <LeadersBoard side="overall" cols={OVR_COLS} seasons={valueSeasons} qual={qual}
              onOpenPlayer={onOpenPlayer} onSeeAll={seeAll} seeAllHref={seeAllHref} />
          )
        ) : side === 'fielding' ? (
          fielding == null || !linesIn ? <LeadersBoardSkeleton side="fielding" /> : (
            <LeadersBoard side="fielding" cols={FLD_COLS} seasons={leaderSeasons.fielding} qual={qual}
              onOpenPlayer={onOpenPlayer} onSeeAll={seeAll} seeAllHref={seeAllHref} />
          )
        ) : side === 'hitting' ? (
          <LeadersBoard side="hitting" cols={hitCols} seasons={leaderSeasons.batting} qual={qual}
            onOpenPlayer={onOpenPlayer} onSeeAll={seeAll} seeAllHref={seeAllHref} />
        ) : (
          <LeadersBoard side="pitching" cols={pitCols} seasons={leaderSeasons.pitching} qual={qual}
            onOpenPlayer={onOpenPlayer} onSeeAll={seeAll} seeAllHref={seeAllHref} />
        )}
      </Box>
    </Box>
  )
}

/** Every board past the season tables and Leaders: Bests, Find and the Analysis boards, each behind its
 *  own chunk. */
export function BoardPane({ source, side, boardSide, findSide, teams, players, lines, fielding, linesIn, games,
  scope, findQuery, setFindQuery, trackedOffered, charts, onOpenPlayer, onOpenGame, onOpenTeam }: {
  source: Source
  side: Side
  boardSide: BallSide
  findSide: FinderBoardSide
  teams: WpblTeam[]
  players: WpblPlayer[]
  lines: { batting: WpblBattingLine[]; pitching: WpblPitchingLine[] }
  fielding: WpblFieldingLine[] | null
  linesIn: boolean
  games: WpblGame[]
  scope: SeasonScope
  findQuery: Omit<FinderQuery, 'scope'>
  setFindQuery: (q: Omit<FinderQuery, 'scope'>) => void
  trackedOffered: boolean
  charts: ChartInputs | null
  onOpenPlayer: (p: WpblPlayer) => void
  onOpenGame?: (g: WpblGame) => void
  onOpenTeam?: (t: WpblTeam) => void
}) {
  return source === 'tracked' ? (
    <Suspense fallback={<SubViewFallback />}>
      <WpblTrackingView side={boardSide} games={games} onOpenPlayer={onOpenPlayer} />
    </Suspense>
  ) : (!linesIn && (source === 'bests' || source === 'find' || source === 'draft' || source === 'runs'))
    || (source === 'find' && side === 'fielding' && fielding == null) ? (
    // Bests, Find, Draft and Run value read the box-score lines, which a tab opened on a board
    // the stored seasons answer has not read yet; Find on Fielding the fielding lines too.
    <SubViewFallback />
  ) : source === 'bests' ? (
    // FULL BLEED for the same reason Run value is, and the board caps and centers inside
    // it: below `sm` the bleed is `calc(100vw - 24px)`, which is WIDER than the page
    // column, and those 8px are the difference between a name fitting and being clipped at
    // the reader's Large text setting. The cap simply never binds on a phone.
    <Box sx={fullBleedSx}>
      <Suspense fallback={<SubViewFallback />}>
        <WpblBestsView side={boardSide} players={players} batting={lines.batting}
          pitching={lines.pitching} games={games} scope={scope}
          onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
      </Suspense>
    </Box>
  ) : source === 'find' ? (
    <Box sx={fullBleedSx}>
      <Suspense fallback={<SubViewFallback />}>
        <WpblFindView side={findSide} teams={teams} players={players} batting={lines.batting}
          pitching={lines.pitching} fielding={fielding ?? []} games={games}
          query={{ ...findQuery, scope }} onQuery={q => setFindQuery(q)}
          onOpenPlayer={onOpenPlayer} onOpenGame={onOpenGame} />
      </Suspense>
    </Box>
  ) : source === 'pitches' ? (
    <Suspense fallback={<SubViewFallback />}>
      <WpblPitchView side={boardSide} teams={teams} games={games} trackedVisible={trackedOffered} onOpenPlayer={onOpenPlayer} />
    </Suspense>
  ) : source === 'charts' ? (
    charts == null ? <SubViewFallback /> : (
      // Full-bleed like the table: in the 720px page column two charts side by side were 340px each
      // beside a band of empty page on either side.
      <Box sx={fullBleedSx}>
      <Suspense fallback={<SubViewFallback />}>
        <WpblChartsView side={boardSide} teams={teams} players={players} games={games}
          batting={charts.batting} pitching={charts.pitching} league={charts.league}
          fWeights={charts.fWeights} onOpenPlayer={onOpenPlayer} onOpenTeam={onOpenTeam} />
      </Suspense>
      </Box>
    )
  ) : source === 'draft' ? (
    <Suspense fallback={<SubViewFallback />}>
      <WpblDraftValue side={boardSide} players={players} batting={lines.batting}
        pitching={lines.pitching} games={games} onOpenPlayer={onOpenPlayer} />
    </Suspense>
  ) : source === 'runs' ? (
    // STILL FULL-BLEED, with the content inside capped and centered, even though the board is one
    // sentence, one list and one collapsed explainer with nothing to spend width on.
    //
    // Dropping the bleed looks identical on a desktop and is wrong on a PHONE: `FULL_BLEED_W` is
    // `calc(100vw - 24px)` there, which is 351px on a 375px screen against the page column's 343,
    // so below `sm` the bleed is the WIDER of the two. Those 8px are real: at the Large text
    // setting, losing them clips names off the leaderboard.
    //
    // So the box keeps the width at every size and `RunValueView` decides what to do with it:
    // nothing on a phone, where the cap never binds, and a centered column on a desktop.
    <Box sx={fullBleedSx}>
      <Suspense fallback={<SubViewFallback />}>
        <WpblRunValueView side={boardSide} teams={teams} games={games} battingLines={lines.batting}
          onOpenPlayer={onOpenPlayer} />
      </Suspense>
    </Box>
  ) : null
}
