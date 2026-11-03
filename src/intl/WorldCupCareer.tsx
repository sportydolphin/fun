// A player's World Cups as two career tables, one row per event: the same tables on a WPBL player's
// page (src/wpbl/player/WorldCup.tsx) and on a World Cup player's own (WorldCupPage.tsx), so the
// two read alike. Built on the player card's `StatLogTable`, as every career table on the site is.
//
// ONE ROW PER EVENT, NEVER A TOTAL. A group stage and the Finals are separate rows, and a World Cup
// line is never added to a WPBL one (docs/PLAYER_PAGE.md). Oldest first, as a career table reads.
import { Box } from '@mui/material'
import { linkTo, UNSTYLED_LINK } from '../nav'
import { StatLogTable, type StatLogRow } from '../ui/playerCard'
import { outsToIp } from '../league/innings'
import type { InternationalEvent } from './wbsc/international'

/** '2023-ix-womens-baseball-world-cup-group-a' reads '2023 Group A'; 2016 and 2018 the year alone. */
export function eventLabel(key: string): string {
  const tail = (key.split('world-cup')[1] ?? '').replace(/^-/, '').replace('group-stage-', '')
  const words = tail.split('-').filter(Boolean).map(w => (w.length === 1 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
  return [key.slice(0, 4), ...words].join(' ')
}

const fmtRate = (v: number | null): string => (v == null ? '—' : v.toFixed(3).replace(/^0(?=\.)/, ''))

export function WorldCupCareerTables({ events, accent, eraBasis, fmtEra, onOpen, hrefOf }: {
  events: InternationalEvent[]
  accent: string
  /** The innings ERA is stored per: the WPBL's canonical basis on its pages, the World Cup's seven
   *  on its own, each formatted by the page's `fmtEra`. */
  eraBasis: number
  fmtEra: (v: number | null) => string
  onOpen: (e: InternationalEvent) => () => void
  /** The page an event's name links to, as a real <a> a crawler follows. The row's own tap opens it
   *  too, and a click on the link reaches the row after the link has navigated, so the row stands
   *  down when the reader is already there: two pushes would make Back return to the same page. */
  hrefOf?: (e: InternationalEvent) => string | null
}) {
  const lead = (e: InternationalEvent) => {
    const href = hrefOf?.(e)
    if (!href) return [eventLabel(e.event_key), e.team_id]
    return [
      <Box key="event" {...linkTo(href)} sx={{ ...UNSTYLED_LINK, '&:hover': { textDecoration: 'underline' } }}>{eventLabel(e.event_key)}</Box>,
      e.team_id,
    ]
  }
  const open = (e: InternationalEvent) => {
    const href = hrefOf?.(e)
    const go = onOpen(e)
    return () => { if (!href || window.location.pathname !== href) go() }
  }
  const batting: StatLogRow[] = events.flatMap(e => {
    const b = e.batting
    if (!b) return []
    const obp = b.ab + b.bb + b.hbp + b.sf > 0 ? (b.h + b.bb + b.hbp) / (b.ab + b.bb + b.hbp + b.sf) : null
    const slg = b.ab > 0 ? b.tb / b.ab : null
    return [{
      lead: lead(e), onOpen: open(e),
      cells: [b.g, b.pa, b.ab, b.r, b.h, b.doubles, b.triples, b.hr, b.rbi, b.sb, b.bb, b.so,
        fmtRate(b.ab > 0 ? b.h / b.ab : null), fmtRate(obp), fmtRate(slg), fmtRate(obp != null && slg != null ? obp + slg : null)],
    }]
  })
  const pitching: StatLogRow[] = events.flatMap(e => {
    const p = e.pitching
    if (!p) return []
    const era = p.outs > 0 ? (p.er * eraBasis * 3) / p.outs : null
    return [{
      lead: lead(e), onOpen: open(e),
      cells: [p.g, p.gs, `${p.w}-${p.l}`, p.sv, outsToIp(p.outs), p.h, p.r, p.er, p.bb, p.so, p.hr, fmtEra(era)],
    }]
  })
  return (
    <>
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
    </>
  )
}
