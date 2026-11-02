import { useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { useIsAdmin } from '../../lib/admin'
import { RoleHeading, StatLogTable, type StatLogRow } from '../../ui/playerCard'
import { outsToIp } from '../../league/innings'
import { safe } from '../api/core'
import { ERA_BASIS_CANONICAL, fmtRate } from '../stats'
import { useEraBasis } from '../EraBasisContext'
import type { InternationalEvent } from '../../intl/wbsc/international'

// THE PLAYER'S WORLD CUPS, AS THE OWNER'S PREVIEW (ROADMAP-WOMENS-BASEBALL.md, stage 1).
//
// TWO GATES, AND ONLY ONE OF THEM IS REAL. `useIsAdmin` keeps everyone else from asking at all,
// which saves them a refused request; it hides nothing, since this file ships to every reader. The
// data is what WBSC has not yet said may be published, so it lives in `wbsc_world_cup_lines`, which
// RLS lets only the site owner read (migration 20261102200647). Drop the `useIsAdmin` check and the
// table still answers no one else. On WBSC's yes the rows move into a public file and both go.
//
// ONE ROW PER EVENT, NEVER A TOTAL. A group stage and the Finals are separate rows, and a World Cup
// line is never added to a WPBL one (docs/PLAYER_PAGE.md). Oldest first, as a career table reads.

/** The player's World Cup rows: null while unread, and for anyone but the owner. */
export function useWorldCupEvents(playerId: string): InternationalEvent[] | null {
  const owner = useIsAdmin()
  const [read, setRead] = useState<{ id: string; events: InternationalEvent[] } | null>(null)
  useEffect(() => {
    if (!owner) return
    let alive = true
    // Under `npm run dev`, this machine's own archive first (vite-plugin-wbsc-dev.mjs): the dev
    // menu's Owner view holds no session the table would answer.
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
  }, [owner, playerId])
  return owner && read?.id === playerId ? read.events : null
}

/** '2023-ix-womens-baseball-world-cup-group-a' reads '2023 Group A'; 2016 and 2018 the year alone. */
export function eventLabel(key: string): string {
  const tail = (key.split('world-cup')[1] ?? '').replace(/^-/, '').replace('group-stage-', '')
  const words = tail.split('-').filter(Boolean).map(w => (w.length === 1 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
  return [key.slice(0, 4), ...words].join(' ')
}

const open = (url: string) => () => { window.open(url, '_blank', 'noopener') }

/**
 * The section, from rows the page read once with `useWorldCupEvents`: a two-way player's card
 * draws a pane per role, and each would otherwise ask for the same rows.
 */
export function WorldCupSection({ events, playerName, accent, first = false }: {
  events: InternationalEvent[] | null
  /** The roster's name, beside which WBSC's is worth printing only when it differs. */
  playerName: string
  accent: string
  /** On a card with no WPBL line, the section is the card's first, with no rule above it. */
  first?: boolean
}) {
  const { fmtEra } = useEraBasis()
  if (!events?.length) return null

  const lead = (e: InternationalEvent) => [eventLabel(e.event_key), e.team_id]
  const batting: StatLogRow[] = events.flatMap(e => {
    const b = e.batting
    if (!b) return []
    const obp = b.ab + b.bb + b.hbp + b.sf > 0 ? (b.h + b.bb + b.hbp) / (b.ab + b.bb + b.hbp + b.sf) : null
    const slg = b.ab > 0 ? b.tb / b.ab : null
    return [{
      lead: lead(e), onOpen: open(e.url),
      cells: [b.g, b.pa, b.ab, b.r, b.h, b.doubles, b.triples, b.hr, b.rbi, b.sb, b.bb, b.so,
        fmtRate(b.ab > 0 ? b.h / b.ab : null), fmtRate(obp), fmtRate(slg), fmtRate(obp != null && slg != null ? obp + slg : null)],
    }]
  })
  const pitching: StatLogRow[] = events.flatMap(e => {
    const p = e.pitching
    if (!p) return []
    // Stored on the league's basis, as every ERA on the site, so the reader's setting rescales it.
    const era = p.outs > 0 ? (p.er * ERA_BASIS_CANONICAL * 3) / p.outs : null
    return [{
      lead: lead(e), onOpen: open(e.url),
      cells: [p.g, p.gs, `${p.w}-${p.l}`, p.sv, outsToIp(p.outs), p.h, p.r, p.er, p.bb, p.so, p.hr, fmtEra(era)],
    }]
  })
  // The name each row was matched under, so a wrong link is visible to whoever reads the page. Not
  // when it is the roster's own name: "WBSC name: Ayami Sato" under Ayami Sato says nothing.
  const names = [...new Set(events.map(e => e.wbsc_name))]
  const sameName = names.length === 1 && names[0] === playerName

  return (
    <>
      <RoleHeading title="World Cup" caption="Owner preview" first={first} />
      {batting.length > 0 && (
        <StatLogTable title="Batting" leadHeaders={['Event', 'Team']} totalsLabel="" accent={accent} noun={['event', 'events']}
          statHeaders={['G', 'PA', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'BB', 'SO', 'AVG', 'OBP', 'SLG', 'OPS']}
          rows={batting} />
      )}
      {pitching.length > 0 && (
        <Box sx={{ mt: batting.length > 0 ? 2.5 : 0 }}>
          <StatLogTable title="Pitching" leadHeaders={['Event', 'Team']} totalsLabel="" accent={accent} noun={['event', 'events']}
            statHeaders={['G', 'GS', 'W-L', 'SV', 'IP', 'H', 'R', 'ER', 'BB', 'SO', 'HR', 'ERA']}
            rows={pitching} />
        </Box>
      )}
      {!sameName && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
          WBSC name: {names.join(' · ')}
        </Typography>
      )}
    </>
  )
}
