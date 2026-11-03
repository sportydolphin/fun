import { useEffect, useState } from 'react'
import { Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { useIsAdmin } from '../../lib/admin'
import { RoleHeading } from '../../ui/playerCard'
import { safe } from '../api/core'
import { ERA_BASIS_CANONICAL } from '../stats'
import { useEraBasis } from '../EraBasisContext'
import type { InternationalEvent } from '../../intl/wbsc/international'
import { editionSlugOf } from '../../intl/wbsc/editions'
import { WorldCupCareerTables } from '../../intl/WorldCupCareer'
import { navigate } from '../../nav'

export { eventLabel } from '../../intl/WorldCupCareer'

// THE PLAYER'S WORLD CUPS, AS THE OWNER'S PREVIEW (ROADMAP-WOMENS-BASEBALL.md, stage 1).
//
// TWO GATES, AND ONLY ONE OF THEM IS REAL. `useIsAdmin` keeps everyone else from asking at all,
// which saves them a refused request; it hides nothing, since this file ships to every reader. The
// data is what WBSC has not yet said may be published, so it lives in `wbsc_world_cup_lines`, which
// RLS lets only the site owner read (migration 20261102200647). Drop the `useIsAdmin` check and the
// table still answers no one else. On WBSC's yes the rows move into a public file and both go.
//
// The tables themselves are src/intl/WorldCupCareer.tsx, shared with the World Cup's own player
// pages so the two read alike.

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

// Under `npm run dev` a row opens the edition's own page (src/intl/WorldCupPage.tsx), which exists
// nowhere else yet; everywhere else it opens the event on wbsc.org.
const openEvent = (e: InternationalEvent) => () => {
  const slug = import.meta.env.DEV ? editionSlugOf(e.event_key) : null
  if (slug) navigate(`/world-cup/${slug}`)
  else window.open(e.url, '_blank', 'noopener')
}

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

  // The name each row was matched under, so a wrong link is visible to whoever reads the page. Not
  // when it is the roster's own name: "WBSC name: Ayami Sato" under Ayami Sato says nothing.
  const names = [...new Set(events.map(e => e.wbsc_name))]
  const sameName = names.length === 1 && names[0] === playerName

  return (
    <>
      <RoleHeading title="World Cup" caption="Owner preview" first={first} />
      {/* Stored on the league's basis, as every ERA on the site, so the reader's setting rescales it. */}
      <WorldCupCareerTables events={events} accent={accent} eraBasis={ERA_BASIS_CANONICAL} fmtEra={fmtEra} onOpen={openEvent} />
      {!sameName && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
          WBSC name: {names.join(' · ')}
        </Typography>
      )}
    </>
  )
}
