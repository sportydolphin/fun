import React, { useEffect, useRef } from 'react'
import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import { trackImpression, EVENTS } from '../../lib/analytics'

/**
 * One MLB Home card, measured as a pair: seen, then used. See MLB_CARD_SEEN / MLB_CARD_USED.
 *
 * A WRAPPER RATHER THAN A CALL IN EACH CARD, because the fourteen cards share nothing: a scoreboard,
 * a pick sheet, a leaderboard, a team picker. Threading an "I was used" callback through each would
 * be fourteen places to forget, and the question is the same for all of them.
 *
 * SEEN means the card reached the top three-quarters of the screen, not that it rendered. MLB Home
 * is one long column on a phone, so every card renders on every visit and a render count would rank
 * them by nothing. The bottom margin keeps a card that merely peeks over the fold from counting.
 *
 * USED is the first click that lands anywhere inside, in the capture phase so a card that stops
 * propagation still counts, and it includes clicks inside a modal the card opened, since React
 * events travel up the component tree. Both go through `trackImpression`, which is what makes them
 * once per page load per card.
 *
 * `&:empty` hides the wrapper while the card inside renders nothing (Live Drama between games, a
 * card still loading), so an empty box never takes a slot in the column's gap.
 */
export function TrackedCard({ card, sx, children }: {
  /** A stable id, snake_case. It is the key the admin card groups by, so renaming it starts a new series. */
  card: string
  sx?: SxProps<Theme>
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      trackImpression(EVENTS.MLB_CARD_SEEN, { card }, card)
      io.disconnect()
    }, { rootMargin: '0px 0px -25% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [card])

  return (
    <Box
      ref={ref}
      data-mlb-card={card}
      onClickCapture={() => trackImpression(EVENTS.MLB_CARD_USED, { card }, card)}
      sx={[{ '&:empty': { display: 'none' } }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {children}
    </Box>
  )
}
