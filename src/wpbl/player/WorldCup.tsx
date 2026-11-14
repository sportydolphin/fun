import { useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { EVENTS, track } from '../../lib/analytics'
import { RoleHeading } from '../../ui/playerCard'
import { safe } from '../api/core'
import { ERA_BASIS_CANONICAL } from '../stats'
import { useEraBasis } from '../EraBasisContext'
import type { InternationalBatting, InternationalEvent, InternationalPitching } from '../../intl/wbsc/international'
import type { WorldCupShape } from '../../intl/wbsc/worldCupShapes'
import { editionSlugOf } from '../../intl/wbsc/editions'
import { WorldCupCareerTables } from '../../intl/WorldCupCareer'
import SHAPES from '../../intl/wpblWorldCups.json'
import { navigate } from '../../nav'

export { eventLabel } from '../../intl/WorldCupCareer'

// THE PLAYER'S WORLD CUPS (ROADMAP-WOMENS-BASEBALL.md, "The rollout in phases", phase 1).
//
// Public since Nov 13, 2026, on implied permission: the rows are WBSC's box scores summed per
// event, in `wbsc_world_cup_lines`, which every reader reads through the edge cache. A "no" from
// WBSC empties that table, and the section then draws nothing (see `WorldCupSection`).
//
// The tables themselves are src/intl/WorldCupCareer.tsx, shared with the World Cup's own player
// pages so the two read alike.

const shapes = SHAPES as Record<string, WorldCupShape>

/** Whether the player has World Cup rows, known before any read. */
export const hasWorldCup = (playerId: string): boolean => Object.prototype.hasOwnProperty.call(shapes, playerId)

const NONE: InternationalEvent[] = []

/** The player's World Cup rows: null while unread, empty for a player with none. */
export function useWorldCupEvents(playerId: string): InternationalEvent[] | null {
  const listed = hasWorldCup(playerId)
  const [read, setRead] = useState<{ id: string; events: InternationalEvent[] } | null>(null)
  useEffect(() => {
    // A player the shapes do not list has no rows, so nothing is asked.
    if (!listed) return
    let alive = true
    // Under `npm run dev`, this machine's own archive first (vite-plugin-wbsc-dev.mjs), so a row
    // being reviewed shows before it is uploaded.
    const local = import.meta.env.DEV
      ? fetch(`/__dev/wbsc-world-cup/${encodeURIComponent(playerId)}`)
        .then(r => (r.ok ? r.json() as Promise<{ events: InternationalEvent[] }> : null))
        .catch(() => null)
      : Promise.resolve(null)
    void local.then(dev => dev ?? safe<{ events: InternationalEvent[] }[]>('world cup lines', () =>
      supabase.from('wbsc_world_cup_lines').select('events').eq('wpbl_player_id', playerId), [])
      .then(rows => rows[0] ?? { events: [] }))
      .then(row => { if (alive) setRead({ id: playerId, events: row.events }) })
    return () => { alive = false }
  }, [listed, playerId])
  if (!listed) return NONE
  return read?.id === playerId ? read.events : null
}

// Under `npm run dev` a row opens the edition's own page (src/intl/WorldCupPage.tsx), which exists
// nowhere else until phase 3; everywhere else it opens the event on wbsc.org.
const openEvent = (playerId: string) => (e: InternationalEvent) => () => {
  track(EVENTS.WPBL_WORLD_CUP_OPENED, { playerId, event: e.event_key })
  const slug = import.meta.env.DEV ? editionSlugOf(e.event_key) : null
  if (slug) navigate(`/world-cup/${slug}`)
  else window.open(e.url, '_blank', 'noopener')
}

const hrefOf = import.meta.env.DEV
  ? (e: InternationalEvent) => { const slug = editionSlugOf(e.event_key); return slug ? `/world-cup/${slug}` : null }
  : undefined

// The samples the empty table is drawn from: typical widths, so each column comes out the size
// the real figures make it (StatLogTable's `placeholder`).
const SAMPLE_BATTING: InternationalBatting = {
  g: 5, pa: 20, ab: 16, r: 3, h: 5, doubles: 1, triples: 0, hr: 0, rbi: 3, bb: 3, ibb: 0, so: 3,
  hbp: 1, sb: 1, cs: 0, sf: 0, sh: 0, gdp: 0, tb: 6,
}
const SAMPLE_PITCHING: InternationalPitching = {
  g: 3, gs: 2, outs: 30, bf: 45, h: 9, r: 5, er: 4, bb: 4, so: 8, hr: 0, hbp: 1, wp: 1, bk: 0,
  pitches: 160, strikes: 100, w: 1, l: 1, sv: 0,
}
function sampleEvents(shape: WorldCupShape): InternationalEvent[] {
  const n = Math.max(shape.batting, shape.pitching)
  return Array.from({ length: n }, (_, i): InternationalEvent => ({
    event_key: `2024-womens-baseball-world-cup-${i}`, event: '', year: 2024, team_id: 'AAA',
    wbsc_name: '', wbsc_id: '', url: '',
    batting: i < shape.batting ? SAMPLE_BATTING : null,
    pitching: i < shape.pitching ? SAMPLE_PITCHING : null,
    games: [],
  }))
}

const SOURCE_LINK_SX = {
  color: 'inherit', textDecoration: 'underline',
  '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
} as const

/**
 * The section, from rows the page read once with `useWorldCupEvents`: a two-way player's card
 * draws a pane per role, and each would otherwise ask for the same rows.
 */
export function WorldCupSection({ events, playerId, playerName, accent, first = false }: {
  events: InternationalEvent[] | null
  playerId: string
  /** The roster's name, beside which WBSC's is worth printing only when it differs. */
  playerName: string
  accent: string
  /** On a card with no WPBL line, the section is the card's first, with no rule above it. */
  first?: boolean
}) {
  const { fmtEra } = useEraBasis()
  const shape = shapes[playerId]
  // Read and empty: the table was emptied after this build (a takedown), so nothing is drawn.
  if (!shape || (events && !events.length)) return null
  const placeholder = events == null

  // The name each row was matched under, so a wrong link is visible to whoever reads the page. Not
  // when it is the roster's own name: "WBSC name: Ayami Sato" under Ayami Sato says nothing. Taken
  // from the shape while loading, so the line is there from the first frame too.
  const names = events ? [...new Set(events.map(e => e.wbsc_name))] : shape.names
  const sameName = names.length === 1 && names[0] === playerName

  return (
    <Box aria-busy={placeholder || undefined}>
      <RoleHeading title="World Cup" first={first} caption={
        <>Source:{' '}<Box component="a" href="https://www.wbsc.org" target="_blank" rel="noopener" sx={SOURCE_LINK_SX}>WBSC</Box></>
      } />
      {/* Stored on the league's basis, as every ERA on the site, so the reader's setting rescales it. */}
      <WorldCupCareerTables events={events ?? sampleEvents(shape)} placeholder={placeholder} accent={accent}
        eraBasis={ERA_BASIS_CANONICAL} fmtEra={fmtEra} onOpen={openEvent(playerId)} hrefOf={hrefOf} />
      {!sameName && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
          WBSC name: {names.join(' · ')}
        </Typography>
      )}
    </Box>
  )
}
