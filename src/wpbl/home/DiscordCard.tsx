import { useEffect } from 'react'
import { edge } from '../../ui/card'
import { Box, Typography } from '@mui/material'
import { chromePx, hoverOnly, pressable, TYPE_SCALE } from '../ui'
import { track, trackImpression, EVENTS } from '../../lib/analytics'
// The dismissal key and the dev-only undo. Their own module so the dev settings menu can reach
// the undo without dragging this file into the main bundle. See discordInvite.ts.
import { DISCORD_DISMISS_KEY } from '../discordInvite'

// Community invite — links out to the WPBL fan Discord. Styled in Discord's blurple
// so it reads as "join the chat" at a glance, but kept to one slim row so it sits
// under the scoreboard without crowding the actual content.
//
// MOBILE-ONLY for now: the caller renders it inside a `display: { xs: 'block', md: 'none' }`
// wrapper. The desktop feed is a two-column subgrid that shares row boundaries, and a fifth
// card of a different shape breaks that alignment; a proper desktop home for it is a later job.

const DISCORD_INVITE = 'https://discord.gg/hTaZKFzk6H'

const DISCORD_BLURPLE = '#5865F2'

export function DiscordCard({ onDismiss }: { onDismiss: () => void }) {
  // Dismissal is remembered (localStorage) and owned by the parent, which only mounts this card
  // when it hasn't been dismissed, so once closed it stays gone and leaves no empty slot behind.
  // Count one impression per mount, i.e. only for users who actually see the card.
  useEffect(() => { trackImpression(EVENTS.DISCORD_SHOWN) }, [])
  const dismiss = () => {
    track(EVENTS.DISCORD_DISMISSED)
    try { localStorage.setItem(DISCORD_DISMISS_KEY, '1') } catch { /* private mode / quota: non-fatal */ }
    onDismiss()
  }
  return (
    <Box
      component="a"
      href={DISCORD_INVITE}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track(EVENTS.DISCORD_JOINED)}
      sx={{
        // `px: 2` and `borderRadius: 3` are NOT free choices: they are what every SectionCard on this
        // page uses, and this card sits in the middle of a stack of them. The eye reads the left edges of
        // a vertical stack as one line, so a card whose content starts a few pixels off, or whose corners
        // are a few pixels tighter, looks wrong without looking like a bug.
        //
        // The vertical padding stays tighter than the horizontal on purpose. This is a promo strip
        // rather than a section, and the row's height is set by the 34px avatar anyway, so `py: 2` would
        // only add empty space to a card that is one line tall.
        display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25,
        textDecoration: 'none', cursor: 'pointer',
        borderRadius: 3, border: '1.5px solid', borderColor: edge(DISCORD_BLURPLE),
        bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(88,101,242,0.09)' : 'rgba(88,101,242,0.06)',
        transition: 'background-color 0.15s, border-color 0.15s',
        ...hoverOnly({
          bgcolor: 'rgba(88,101,242,0.18)',
          borderColor: DISCORD_BLURPLE,
        }),
      }}
    >
      <Box sx={{ width: 34, height: 34, borderRadius: '50%', bgcolor: DISCORD_BLURPLE, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: 19, height: 19 }}>
          <path fill="#fff" d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
        </Box>
      </Box>
      {/* ONE LINE. This card sits third on a phone, between the scoreboard and the first thing
          about a game, so a second line is fold space. "Live game chats and more." is what a
          Discord is; the title already says which one and the button says what tapping does.
          Wrapping is off for the same reason it is off on the reminder row: a title that grows
          a second line puts the height straight back, and this one is a hair under its budget
          at 320px with the Join button beside it. */}
      <Typography noWrap sx={{
        flex: 1, minWidth: 0, fontSize: TYPE_SCALE.title, fontWeight: 800, lineHeight: 1.2, color: 'text.primary',
      }}>
        Fan Discord
      </Typography>
      <Box sx={{ flexShrink: 0, px: 1.5, py: 0.6, borderRadius: 999, bgcolor: DISCORD_BLURPLE, color: '#fff', fontSize: TYPE_SCALE.meta, fontWeight: 800, whiteSpace: 'nowrap' }}>
        Join
      </Box>
      <Box
        {...pressable(e => { e.preventDefault(); e.stopPropagation(); dismiss() })}
        aria-label="Dismiss Discord invite"
        sx={{
          // 28px, not 22: WCAG 2.2 wants 24 as a floor and this is the one control on the card whose only
          // job is to make the card go away, which is a bad thing to have to aim at twice. Sized through
          // `chromePx` because a tap target is structure and must not ride the reader's text scale.
          //
          // The negative margin: the ✕ is an 8px glyph in a much larger box, so left at the padding line
          // the MARK sits further from the card edge than the avatar does on the left and the row looks
          // lopsided. The pull is half the box's growth past the glyph, so the mark stays put and only the
          // target around it is bigger. Optical alignment is checked by eye, not computed.
          flexShrink: 0, width: chromePx(28), height: chromePx(28), ml: 0, mr: -1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '50%', color: 'text.disabled', fontSize: TYPE_SCALE.body, lineHeight: 1,
          ...hoverOnly({ bgcolor: 'action.hover', color: 'text.primary' }),
        }}
      >
        ✕
      </Box>
    </Box>
  )
}
