import { Box, Typography } from '@mui/material'
import { TYPE_SCALE } from './card'
import type { SearchResultAvatar } from '../mlb/state/SearchBridgeContext'

/** A search row's portrait or logo, drawn from primitive data only, so the always-loaded toolbar
 *  and the Ctrl+K palette never import a section's lazy chunk to draw one. */
export function SearchAvatar({ avatar: a, size = 36 }: { avatar: SearchResultAvatar; size?: number }) {
  const contain = a.fit === 'contain'
  return (
    <Box sx={{
      width: size, height: size, flexShrink: 0,
      borderRadius: a.circle ? '50%' : 1.5,
      bgcolor: a.bg ?? 'grey.700',
      border: a.ring ? `2px solid ${a.ring}` : undefined,
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      {a.imageUrl
        ? <Box component="img" src={a.imageUrl} alt="" loading="lazy" sx={{ width: contain ? '74%' : '100%', height: contain ? '74%' : '100%', objectFit: a.fit ?? 'cover' }} />
        : <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 800, color: '#fff' }}>{a.fallbackText}</Typography>}
    </Box>
  )
}
