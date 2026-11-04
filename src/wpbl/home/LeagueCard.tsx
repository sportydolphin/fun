import { useEffect, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { WPBL_LEAGUE_PAGE, WPBL_PATH_EVENT } from '../routes'
import { hoverOnly, FOCUS_RING } from '../ui'
import { SECTION_HEADING_SX, SECTION_RULE } from '../../ui/card'
import { track, trackImpression, EVENTS } from '../../lib/analytics'
import { isModified } from '../../nav'

/**
 * One line on Home pointing at /wpbl/league, where Reading, Highlights and the archive live.
 *
 * IT MEASURES ITSELF, and that is not boilerplate. Anything on Home carries its own impression
 * event, so a card that stops rendering does not take its denominator with it. This one has a
 * specific question to answer: the shelf this line replaced was seen far more often than it was
 * opened, and if this card is shown as often and opened less, the move was wrong and the shelf
 * should come back rather than the link being made louder.
 */
export function LeagueCard() {
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current) return
    shown.current = true
    trackImpression(EVENTS.WPBL_LEAGUE_CARD_SHOWN)
  }, [])

  // Modified clicks fall through untouched, so open-in-new-tab still works; the rest is the
  // section's own navigation, copied from WpblApp's `push`. /wpbl/league is an App-level route
  // rather than a tab, so there is no view to switch to: push the entry and tell the shell the
  // path moved, which is what makes it re-read and swap in the page.
  const go = (e: React.MouseEvent) => {
    if (isModified(e)) return
    e.preventDefault()
    track(EVENTS.WPBL_LEAGUE_CARD_OPEN, { from: 'home' })
    window.history.pushState({ ...window.history.state, wpbl: undefined }, '', WPBL_LEAGUE_PAGE)
    window.dispatchEvent(new Event(WPBL_PATH_EVENT))
  }

  return (
    <Box
      component="a"
      href={WPBL_LEAGUE_PAGE}
      onClick={go}
      // A section's heading that is a link, the way every other way-on on Home is since Nov 3, 2026:
      // it was the last outlined box on the page, a frame around four words and a chevron.
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.5, textDecoration: 'none',
        ...SECTION_RULE, px: 2, py: 1.25,
        ...hoverOnly({ '& .sd-league-title': { textDecoration: 'underline' } }), ...FOCUS_RING,
      }}
    >
      <Typography className="sd-league-title" sx={{ ...SECTION_HEADING_SX, color: 'text.primary' }}>
        About the League
      </Typography>
    </Box>
  )
}
