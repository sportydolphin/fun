import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { CURRENT_SEASON, TEAM_ABBR } from '../constants'
import { fetchAllTeamStats } from '../api'
import { fetchSeasonFielding } from '../apiSeasonStats'
import type { GameScope } from '../lib/gameScope'
import { FIELDING_DEFS, fieldingQualified, fieldingRows, combineFieldingSplits, combineTeamLines, type GridRow } from '../lib/seasonGrid'
import { mlbUrlFor } from '../routes'
import { playerLink } from '../lib/links'
import { LeaderCard, LeaderCardSkeleton, LEADER_GRID_SX, LEADERS_SHOWN, PORTRAIT_PX, printedRanks } from '../../ui/leaders'
import { LogoBubble } from '../components/boxScore'
import { PlayerHeadshot } from '../components/leaderboards'

// LEADERS ON THE FIELDING SIDE, the four cards WPBL's Leaders draws for it (LEADER_CARDS.fielding in
// src/wpbl/LeadersBoard.tsx), from the same read and the same rules as the Fielding table they open:
// one row per player per position, pitchers left out as the table's All leaves them out, and the
// rate gated on the fielding title's bar (fieldingQualified) while the counts rank everyone. Errors
// and the catcher's columns are not cards: a fewest-errors card is led by whoever played least.

const CARDS: { key: string; title: string }[] = [
  { key: 'fpct', title: 'Fielding %' }, { key: 'a', title: 'Assists' },
  { key: 'po', title: 'Putouts' }, { key: 'dp', title: 'Double Plays' },
]

interface Loaded { key: string; rows: GridRow[]; teamGames: Map<number, number> }

export function FieldingLeaders({ season, gameScope, canHover, onOpenPlayer, onSeeAll }: {
  season: number
  gameScope: GameScope
  canHover: boolean
  onOpenPlayer: (playerId: number) => void
  /** The Fielding table ranked by this column. */
  onSeeAll: (key: string) => void
}) {
  const loadKey = `${season}|${gameScope}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setFailed(null)
    // SeasonGridView's read, so the cards and the table they open rank the same rows.
    const clubLines = gameScope === 'all'
      ? Promise.all([fetchAllTeamStats('hitting', season), fetchAllTeamStats('hitting', season, 'P')]).then(([r, p]) => combineTeamLines(r, p))
      : fetchAllTeamStats('hitting', season, gameScope === 'post' ? 'P' : 'R')
    const splits = gameScope === 'all'
      ? Promise.all([fetchSeasonFielding(season), fetchSeasonFielding(season, 'P')]).then(([r, p]) => combineFieldingSplits(r, p))
      : fetchSeasonFielding(season, gameScope === 'post' ? 'P' : 'R')
    Promise.all([splits, clubLines])
      .then(([sp, clubs]) => {
        if (!live) return
        const teamGames = new Map([...clubs].map(([id, s]) => [id, Number(s?.gamesPlayed) || 0] as [number, number]))
        setLoaded({ key: loadKey, rows: fieldingRows(sp).filter(r => r.position !== 'P'), teamGames })
      })
      .catch(() => { if (live) setFailed(loadKey) })
    return () => { live = false }
  }, [loadKey, season, gameScope])
  const data = loaded?.key === loadKey ? loaded : null

  const cards = useMemo(() => {
    if (!data) return null
    const maxGames = Math.max(0, ...data.teamGames.values())
    return CARDS.map(card => {
      const def = FIELDING_DEFS.find(d => d.key === card.key)!
      const pool = data.rows
        .filter(r => !def.isRate || fieldingQualified(r, data.teamGames.get(r.teamId) ?? maxGames))
        .map(r => ({ r, v: Number(def.leaderValue ? def.leaderValue(r.stat) : def.getValue(r.stat)) }))
        .filter(x => Number.isFinite(x.v) && (def.isRate || x.v > 0))
        // Ties break toward the bigger sample, chances, as the table's do.
        .sort((a, b) => (a.v !== b.v ? b.v - a.v : (Number(b.r.stat.chances) || 0) - (Number(a.r.stat.chances) || 0)))
        .slice(0, LEADERS_SHOWN)
      const texts = pool.map(x => def.format(def.getValue(x.r.stat)))
      const ranks = printedRanks(texts)
      return { card, items: pool.map((x, i) => ({ row: x.r, text: texts[i], ...ranks[i] })) }
    })
  }, [data])

  if (failed === loadKey) {
    return (
      <Typography sx={{ textAlign: 'center', py: 6, color: 'text.secondary', fontSize: '0.9rem' }}>
        Couldn’t load fielding stats. Try again in a moment.
      </Typography>
    )
  }
  if (!cards) {
    return (
      <Box aria-hidden sx={LEADER_GRID_SX}>
        {CARDS.map(c => <LeaderCardSkeleton key={c.key} title={c.title} />)}
      </Box>
    )
  }
  return (
    <Box onMouseLeave={() => setHover(null)} sx={LEADER_GRID_SX}>
      {cards.map(({ card, items }) => (
        <LeaderCard key={card.key} title={card.title}
          seeAll={{
            href: mlbUrlFor({ view: 'fielding', season, games: gameScope, sort: card.key === 'fpct' ? null : card.key }, CURRENT_SEASON),
            onClick: () => onSeeAll(card.key),
          }}
          hoverKey={hover}
          onHover={canHover ? setHover : undefined}
          empty={gameScope === 'post' ? 'No playoff games yet' : 'Nobody yet'}
          items={items.map(it => ({
            // The row's own id: a player can lead one card at two positions.
            key: it.row.id, rank: it.rank, tied: it.tied, name: it.row.name, value: it.text,
            portrait: <PlayerHeadshot variant="ring" playerId={it.row.playerId!} name={it.row.name} teamId={it.row.teamId} size={PORTRAIT_PX} />,
            badge: it.row.teamId > 0 ? <LogoBubble teamId={it.row.teamId} abbr={TEAM_ABBR[it.row.teamId] ?? ''} size={16} ring={1} /> : undefined,
            linkProps: playerLink(it.row.playerId!, it.row.name, onOpenPlayer),
          }))} />
      ))}
    </Box>
  )
}
