import React from 'react'
import { Box, Typography } from '@mui/material'
import { TapTip } from './TapTip'
import { TYPE_SCALE } from './card'

/**
 * A small circled "i" beside a card title that opens a plain explanation of how the card's number
 * is worked out.
 *
 * WHY NOT A SUBTITLE. The Analysis boards used to carry a caption line under every title ("Ranked
 * by exit velocity", "Steals and extra bases taken, against the average"). A caption has one line
 * at the smallest size on the card, so it could only ever name the stat, never say how it is
 * counted, and every reader paid for it whether they wanted it or not. This holds as much as the
 * explanation needs and costs the card nothing until somebody asks.
 *
 * Hover on a mouse, tap on a touchscreen (TapTip). Each string is one paragraph.
 */
export function InfoDot({ text, label = 'How this is worked out' }: {
  text: React.ReactNode | readonly React.ReactNode[]
  label?: string
}) {
  const paras = Array.isArray(text) ? text : [text]
  return (
    <TapTip
      ariaLabel={label}
      closeAfterMs={20000}
      // OPAQUE. MUI's tooltip is a translucent grey, which is fine over a word or two and not over
      // a paragraph: on the draft chart the dots and the headline showed through the text.
      tipSx={{ bgcolor: '#2a2e35', color: '#fff', px: 1.25, py: 1, '& .MuiTooltip-arrow': { color: '#2a2e35' } }}
      title={
        <Box sx={{ maxWidth: '19rem', py: 0.25 }}>
          {paras.map((t, i) => (
            <Typography key={i} sx={{ fontSize: TYPE_SCALE.body, lineHeight: 1.5, mt: i ? 0.75 : 0 }}>{t}</Typography>
          ))}
        </Box>
      }
      sx={{
        position: 'relative', flexShrink: 0, cursor: 'pointer',
        width: 16, height: 16, borderRadius: '50%',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid', borderColor: 'text.disabled', color: 'text.secondary',
        fontSize: TYPE_SCALE.caption, fontWeight: 800, lineHeight: 1, fontStyle: 'normal',
        // The circle is 16px to sit quietly beside a title; the target is not. Ten pixels of
        // invisible reach on every side brings it to a thumb's width without moving the title.
        '&::after': { content: '""', position: 'absolute', inset: -10 },
        '@media (hover: hover)': { '&:hover': { color: 'text.primary', borderColor: 'text.secondary' } },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'currentColor', outlineOffset: 2 },
      }}
    >i</TapTip>
  )
}
