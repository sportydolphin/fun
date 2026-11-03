// A player's World Cups as two career tables, one row per event: the same tables on a WPBL player's
// page (src/wpbl/player/WorldCup.tsx) and on a World Cup player's own (WorldCupPage.tsx), so the
// two read alike. Built on the player card's `StatLogTable`, as every career table on the site is.
//
// ONE ROW PER EVENT. A group stage and the Finals are separate rows, and a World Cup line is never
// added to a WPBL one (docs/PLAYER_PAGE.md). Oldest first, as a career table reads. A World Cup
// player's own page adds a World Cup total (`total`), which sums World Cups only.
import { Box } from '@mui/material'
import { linkTo, UNSTYLED_LINK } from '../nav'
import { StatLogTable, type StatLogRow } from '../ui/playerCard'
import { outsToIp } from '../league/innings'
import type { ReactNode } from 'react'
import type { InternationalBatting, InternationalEvent, InternationalPitching } from './wbsc/international'

/** '2023-ix-womens-baseball-world-cup-group-a' reads '2023 Group A'; 2016 and 2018 the year alone. */
export function eventLabel(key: string): string {
  const tail = (key.split('world-cup')[1] ?? '').replace(/^-/, '').replace('group-stage-', '')
  const words = tail.split('-').filter(Boolean).map(w => (w.length === 1 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
  return [key.slice(0, 4), ...words].join(' ')
}

const fmtRate = (v: number | null): string => (v == null ? '—' : v.toFixed(3).replace(/^0(?=\.)/, ''))

const sumOf = <T extends object>(rows: readonly T[]): T =>
  rows.reduce((acc, r) => {
    for (const k of Object.keys(r) as (keyof T)[]) (acc as Record<keyof T, number>)[k] = (Number(acc[k]) || 0) + (Number(r[k]) || 0)
    return acc
  }, {} as T)

export function WorldCupCareerTables({ events, accent, eraBasis, fmtEra, onOpen, hrefOf, markOf, total = false }: {
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
  /** Drawn after an event's name, such as the medal its team won there. */
  markOf?: (e: InternationalEvent) => ReactNode
  /** A Total row under two or more events. */
  total?: boolean
}) {
  const lead = (e: InternationalEvent) => {
    const href = hrefOf?.(e)
    const mark = markOf?.(e)
    const name = href
      ? <Box key="event" {...linkTo(href)} sx={{ ...UNSTYLED_LINK, '&:hover': { textDecoration: 'underline' } }}>{eventLabel(e.event_key)}</Box>
      : eventLabel(e.event_key)
    return [mark ? <Box key="event" component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.75 }}>{name}{mark}</Box> : name, e.team_id]
  }
  const open = (e: InternationalEvent) => {
    const href = hrefOf?.(e)
    const go = onOpen(e)
    return () => { if (!href || window.location.pathname !== href) go() }
  }
  const batCells = (b: InternationalBatting) => {
    const obp = b.ab + b.bb + b.hbp + b.sf > 0 ? (b.h + b.bb + b.hbp) / (b.ab + b.bb + b.hbp + b.sf) : null
    const slg = b.ab > 0 ? b.tb / b.ab : null
    return [b.g, b.pa, b.ab, b.r, b.h, b.doubles, b.triples, b.hr, b.rbi, b.sb, b.bb, b.so,
      fmtRate(b.ab > 0 ? b.h / b.ab : null), fmtRate(obp), fmtRate(slg), fmtRate(obp != null && slg != null ? obp + slg : null)]
  }
  const pitCells = (p: InternationalPitching) => {
    const era = p.outs > 0 ? (p.er * eraBasis * 3) / p.outs : null
    return [p.g, p.gs, `${p.w}-${p.l}`, p.sv, outsToIp(p.outs), p.h, p.r, p.er, p.bb, p.so, p.hr, fmtEra(era)]
  }
  const batLines = events.flatMap(e => (e.batting ? [{ e, b: e.batting }] : []))
  const pitLines = events.flatMap(e => (e.pitching ? [{ e, p: e.pitching }] : []))
  const batting: StatLogRow[] = batLines.map(({ e, b }) => ({ lead: lead(e), onOpen: open(e), cells: batCells(b) }))
  const pitching: StatLogRow[] = pitLines.map(({ e, p }) => ({ lead: lead(e), onOpen: open(e), cells: pitCells(p) }))
  const batTotal = total && batLines.length > 1 ? batCells(sumOf(batLines.map(x => x.b))) : undefined
  const pitTotal = total && pitLines.length > 1 ? pitCells(sumOf(pitLines.map(x => x.p))) : undefined
  return (
    <>
      {batting.length > 0 && (
        <StatLogTable title="Batting" leadHeaders={['Event', 'Team']} totalsLabel={batTotal ? 'Total' : ''} totals={batTotal} accent={accent} noun={['event', 'events']}
          statHeaders={['G', 'PA', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'BB', 'SO', 'AVG', 'OBP', 'SLG', 'OPS']}
          rows={batting} />
      )}
      {pitching.length > 0 && (
        <Box sx={{ mt: batting.length > 0 ? 2.5 : 0 }}>
          <StatLogTable title="Pitching" leadHeaders={['Event', 'Team']} totalsLabel={pitTotal ? 'Total' : ''} totals={pitTotal} accent={accent} noun={['event', 'events']}
            statHeaders={['G', 'GS', 'W-L', 'SV', 'IP', 'H', 'R', 'ER', 'BB', 'SO', 'HR', 'ERA']}
            rows={pitching} />
        </Box>
      )}
    </>
  )
}
