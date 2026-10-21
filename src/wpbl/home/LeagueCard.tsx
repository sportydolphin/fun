import { useEffect, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { WPBL_LEAGUE_PAGE, WPBL_PATH_EVENT } from '../routes'
import { CARD_BORDER, CARD_FILL, hoverOnly, TYPE_SCALE } from '../ui'
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
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, textDecoration: 'none',
        border: '1px solid', borderColor: CARD_BORDER, borderRadius: 3,
        bgcolor: CARD_FILL, px: 2, py: 1.75,
        ...hoverOnly({ borderColor: 'var(--wpbl-accent-fg)' }),
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, color: 'text.primary' }}>
          About the League
        </Typography>
      </Box>
      <Box aria-hidden sx={{ color: 'text.disabled', fontSize: TYPE_SCALE.display, flexShrink: 0 }}>›</Box>
    </Box>
  )
}
