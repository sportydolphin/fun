import { useEffect, useMemo, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import { fetchWpblScoreCardLines, fetchWpblAllPlayers, type WpblScoreCardLines } from './api'
import { buildRecap, leagueRecapContext, type RecapDecision, type RecapStar } from './derive/recap'
import { PlayerPortrait, TYPE_SCALE } from './ui'
import { useWpblPlayerLink } from './LinkContext'
import { typePx } from '../ui/scale'
import { nameAtStage, useLineNameFit } from '../ui/names'
import type { WpblBattingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblTeam } from './types'

/** What a final's card says about the people in it: the pitchers of record and the star. */
export interface GameNotes {
  decisions: RecapDecision[]
  star: RecapStar | null
  headline: string
}

/**
 * The decisions and the star of every final, from the recap engine itself, so the name on a
 * score card is the name Game Center, Discord and Bluesky gave the same game. Plays are passed
 * empty: they feed one sentence of the blurb (back-to-back homers) and nothing drawn here.
 *
 * Names come from `fetchWpblAllPlayers`, never the club rosters, because a line's player may
 * have moved club since (see the trade note in CLAUDE.md).
 */
export function useGameNotes(games: WpblGame[], teams: WpblTeam[]): {
  notes: Map<string, GameNotes>
  players: Map<string, WpblPlayer>
  /** Both reads have settled, either way. Until then a final draws ScoreCardFooterSkeleton in the
   *  footer's place, so the cards do not grow under the reader when the names land. */
  settled: boolean
} {
  const [lines, setLines] = useState<WpblScoreCardLines | null>(null)
  const [roster, setRoster] = useState<WpblPlayer[]>([])
  const [pending, setPending] = useState(2)
  useEffect(() => {
    let live = true
    const done = () => { if (live) setPending(n => n - 1) }
    fetchWpblScoreCardLines().then(l => { if (live) setLines(l) }).catch(() => {}).finally(done)
    fetchWpblAllPlayers().then(p => { if (live) setRoster(p) }).catch(() => {}).finally(done)
    return () => { live = false }
  }, [])
  const players = useMemo(() => new Map(roster.map(p => [p.id, p])), [roster])
  const notes = useMemo(() => {
    const out = new Map<string, GameNotes>()
    if (!lines) return out
    const teamMap = new Map(teams.map(t => [t.id, t]))
    const ctx = leagueRecapContext(games)
    const nameOf = (id: string) => players.get(id)?.name ?? '—'
    // The slim read carries every column the star and decision code reads (see
    // fetchWpblScoreCardLines); the cast is to the full line type buildRecap is declared over.
    const bat = new Map<string, WpblBattingLine[]>()
    for (const b of lines.batting as WpblBattingLine[]) bat.set(b.game_id, [...(bat.get(b.game_id) ?? []), b])
    const pit = new Map<string, WpblPitchingLine[]>()
    for (const p of lines.pitching as WpblPitchingLine[]) pit.set(p.game_id, [...(pit.get(p.game_id) ?? []), p])
    for (const g of games) {
      if (g.status !== 'final') continue
      const r = buildRecap(g, teamMap, bat.get(g.id) ?? [], pit.get(g.id) ?? [], [], nameOf, ctx)
      if (r) out.set(g.id, { decisions: r.decisions, star: r.stars[0] ?? null, headline: r.headline })
    }
    return out
  }, [lines, games, teams, players])
  return { notes, players, settled: pending === 0 }
}

/** A name that opens the player, raised above the card's stretched game link. `name` is drawn as
 *  given: the line holding it decides how far to shorten it (useLineNameFit). */
function PersonLink({ id, name, players, onOpenPlayer, bold }: {
  id: string; name: string; players: Map<string, WpblPlayer>
  onOpenPlayer?: (p: WpblPlayer) => void; bold?: boolean
}) {
  const playerLink = useWpblPlayerLink()
  return (
    <Box component="span" {...playerLink(players.get(id) ?? null, onOpenPlayer)} sx={{
      position: 'relative', zIndex: 1, color: 'text.primary', fontWeight: bold ? 700 : 600,
      textDecoration: 'none', '@media (hover: hover)': { '&:hover': { textDecoration: 'underline' } },
    }}>{name}</Box>
  )
}

const FOOTER_SX = { pt: 0.6, borderTop: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.5 } as const
const PORTRAIT = 24

const KEY_SX = { fontWeight: 800, color: 'text.disabled', mr: 0.4 } as const

// ONE LINE, ALWAYS. Wrapped, a card's height depended on its width and on how long three pitchers'
// names happened to be, so no skeleton could reserve it and the grid's rows went ragged. When the
// three do not fit, all of them step down to "F. Last" together (the site's rule: shorten a name,
// never cut it off), and only a line still too long after that is ellipsed.
function Decisions({ notes, players, onOpenPlayer }: {
  notes: GameNotes; players: Map<string, WpblPlayer>; onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const { ref, stage } = useLineNameFit<HTMLDivElement>(notes.decisions.map(d => d.name))
  return (
    <Typography ref={ref} component="div" noWrap sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', minWidth: 0 }}>
      {notes.decisions.map((d, i) => (
        <Box component="span" key={d.key} sx={{ ml: i ? 1.25 : 0 }}>
          <Box component="span" sx={KEY_SX}>{d.key}</Box>
          <PersonLink id={d.playerId} name={nameAtStage(d.name, stage)} players={players} onOpenPlayer={onOpenPlayer} />
        </Box>
      ))}
    </Typography>
  )
}

/** The star's name and line, the name stepping down before the line is cut. */
function StarLine({ star, players, onOpenPlayer }: {
  star: RecapStar; players: Map<string, WpblPlayer>; onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const { ref, stage } = useLineNameFit<HTMLDivElement>([star.name])
  return (
    <Typography ref={ref} component="div" noWrap sx={{ fontSize: TYPE_SCALE.body, minWidth: 0, color: 'text.secondary' }}>
      <PersonLink id={star.playerId} name={nameAtStage(star.name, stage)} players={players} onOpenPlayer={onOpenPlayer} bold />
      <Box component="span" sx={{ ml: 0.75 }}>{star.statline}</Box>
    </Typography>
  )
}

/**
 * The footer under a final's matchup: the star of the game with their line, then the pitchers of
 * record. Every name is its own link to the player, raised above the card's stretched game link.
 */
export function ScoreCardFooter({ notes, players, onOpenPlayer }: {
  notes: GameNotes | undefined
  players: Map<string, WpblPlayer>; onOpenPlayer?: (p: WpblPlayer) => void
}) {
  if (!notes || (notes.decisions.length === 0 && !notes.star)) return null
  const s = notes.star
  return (
    <Box sx={FOOTER_SX}>
      {s && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <PlayerPortrait name={s.name} teamId={s.teamId} size={PORTRAIT} />
          <StarLine star={s} players={players} onOpenPlayer={onOpenPlayer} />
          <Typography sx={{ ml: 'auto', flexShrink: 0, fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: typePx(0.4), textTransform: 'uppercase', color: 'text.disabled' }}>
            Star
          </Typography>
        </Box>
      )}
      <Decisions notes={notes} players={players} onOpenPlayer={onOpenPlayer} />
    </Box>
  )
}

/**
 * The footer drawn empty, for a final whose names have not arrived, and for the tab's own loading
 * skeleton. Built from the footer's own rows (the portrait's box, the body line, the meta line),
 * so it is the same height by construction rather than by a measured number.
 */
export function ScoreCardFooterSkeleton() {
  return (
    <Box sx={FOOTER_SX}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <Skeleton variant="circular" sx={{
          flexShrink: 0,
          width: `calc(${PORTRAIT}px * var(--app-chrome, 1))`, height: `calc(${PORTRAIT}px * var(--app-chrome, 1))`,
        }} />
        <Typography sx={{ fontSize: TYPE_SCALE.body }}><Skeleton width="11rem" /></Typography>
      </Box>
      <Typography sx={{ fontSize: TYPE_SCALE.meta }}><Skeleton width="9rem" /></Typography>
    </Box>
  )
}
