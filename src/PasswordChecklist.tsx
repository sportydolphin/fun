import { Box, Typography } from '@mui/material'
import { passwordChecklist, type PasswordContext } from './lib/passwordPolicy'

/**
 * The password requirements, under the field, updating as it is typed.
 *
 * Shown rather than withheld until submission. A rule you only learn about by breaking it turns
 * choosing a password into guesswork, and the usual result is that people retry small variations
 * of the same word until one is accepted, which is exactly the outcome the rules exist to avoid.
 *
 * A tick and a dash rather than a tick and a cross. Nothing here is WRONG before it has been
 * typed, and marking an untouched requirement with a red cross reads as an error the reader has
 * already made. The state is "not yet", and it should look like it.
 *
 * Shared by all three places a password is chosen, so the requirements cannot drift apart
 * between signing up, resetting and changing.
 */
export function PasswordChecklist({ password, context, sx }: {
  password: string
  /** The account's own email and username, which a password must not be built from. Omit where
   *  they are not known yet and that line is left off entirely. */
  context?: PasswordContext
  sx?: object
}) {
  const items = passwordChecklist(password, context)
  return (
    <Box component="ul" aria-label="Password requirements" sx={{ m: 0, mt: 0.75, pl: 0, listStyle: 'none', ...sx }}>
      {items.map(item => (
        <Box
          component="li"
          key={item.label}
          sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.6, mb: 0.2 }}
        >
          {/* aria-hidden on the glyph, with the state spelled out in the label text instead:
              a screen reader announcing "tick" or "dash" says nothing useful on its own. */}
          <Box component="span" aria-hidden sx={{
            fontSize: '0.7rem', lineHeight: 1.6, width: 12, flexShrink: 0, textAlign: 'center',
            color: item.ok ? 'success.main' : 'text.disabled',
          }}>
            {item.ok ? '✓' : '·'}
          </Box>
          <Typography sx={{
            fontSize: '0.72rem', lineHeight: 1.6,
            color: item.ok ? 'success.main' : 'text.secondary',
          }}>
            {/* Every unit is a STRING. MUI's sx reads a bare `width: 1` as 100%, not one pixel,
                which left this "hidden" span the full width of the card and relying entirely on
                the clip to disappear. */}
            <Box component="span" className="sr-only" sx={{
              position: 'absolute', width: '1px', height: '1px',
              overflow: 'hidden', clipPath: 'inset(50%)',
              padding: 0, margin: '-1px', border: 0, whiteSpace: 'nowrap',
            }}>
              {item.ok ? 'Met: ' : 'Not met: '}
            </Box>
            {item.label}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}
