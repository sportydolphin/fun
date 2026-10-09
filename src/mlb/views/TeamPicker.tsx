import React, { useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { SectionCard, CardLink } from '../../ui/card'
import { TEAM_ABBR, TEAM_DIVISION, TEAM_NICKNAME } from '../constants'
import { useIsDark, ringColor } from '../lib/colorUtils'
import { LogoBubble } from '../components/boxScore'
import { ModalShell } from '../../ui/ModalShell'
import { useSheetHistory } from '../state/sheetHistory'
import { pressable, hoverOnly, FOCUS_RING } from '../../ui/interaction'
import { chromePx, typePx } from '../../ui/scale'

// ─── Following a team, for a reader who has not ───────────────────────────────
//
// Until Oct 1, 2026 a reader with no team got all 30 logos in a grid as the first card of Home's
// feed. On a phone that grid was a screen and a half tall, straight under the bracket, so a first
// visit (which is most visits in October) had to scroll past every club in the league before
// reaching a single thing about baseball. The choice still matters, since Home is built around it,
// so it stays on the page as one compact card, and the grid moves into a sheet that opens on purpose.
//
// The sheet groups clubs BY DIVISION, the way a fan already files them: finding the Mariners in an
// alphabetical grid of abbreviations meant reading all thirty.

const DIVISIONS: Array<{ code: string; label: string }> = [
  { code: 'ALE', label: 'AL East' }, { code: 'ALC', label: 'AL Central' }, { code: 'ALW', label: 'AL West' },
  { code: 'NLE', label: 'NL East' }, { code: 'NLC', label: 'NL Central' }, { code: 'NLW', label: 'NL West' },
]

const clubsIn = (division: string) => Object.keys(TEAM_ABBR).map(Number)
  .filter(id => TEAM_DIVISION[id] === division)
  .sort((a, b) => (TEAM_NICKNAME[a] ?? '').localeCompare(TEAM_NICKNAME[b] ?? ''))

/** The card in Home's feed. Opens the sheet; following happens there. */
export function FollowTeamPrompt({ onFollow, playing }: {
  onFollow: (teamId: number) => void
  /** Clubs still in the postseason, marked in the sheet. */
  playing?: Set<number>
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <SectionCard title="Your team" action={<CardLink label="Choose a team" onClick={() => setOpen(true)} />}>
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', lineHeight: 1.35 }}>
          Follow a club to put its games, standing and players at the top of this page.
        </Typography>
      </SectionCard>
      {open && (
        <TeamPickerSheet
          playing={playing}
          onClose={() => setOpen(false)}
          onSelect={onFollow}
        />
      )}
    </>
  )
}

export function TeamPickerSheet({ onSelect, onClose, playing }: {
  onSelect: (teamId: number) => void
  onClose: () => void
  playing?: Set<number>
}) {
  const isDark = useIsDark()
  const anyPlaying = !!playing && playing.size > 0
  // A pick closes the sheet THROUGH HISTORY and follows once its entry is gone. Following lands on
  // Home, and a navigation made while the sheet's entry was still on top would leave that entry
  // behind it for the next Back to stop on. MlbSheet is not used for that reason alone: it keeps
  // its close function to itself.
  const chosen = useRef<number | null>(null)
  const close = useSheetHistory(() => {
    onClose()
    if (chosen.current != null) onSelect(chosen.current)
  })
  const pick = (id: number) => { chosen.current = id; close() }
  return (
    <ModalShell onClose={close} maxWidth={chromePx(560)} sheet eyebrow="Choose your team">
      <Box sx={{ px: 2, pt: 1.25, pb: 2 }}>
        {anyPlaying && (
          <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mb: 1, display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box component="span" sx={{ width: chromePx(6), height: chromePx(6), borderRadius: '50%', bgcolor: '#22c55e', flexShrink: 0 }} />
            Still playing this postseason
          </Typography>
        )}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2.5, rowGap: 1.5 }}>
          {DIVISIONS.map(d => (
            <Box key={d.code}>
              <Typography sx={{
                fontSize: '0.6rem', fontWeight: 800, letterSpacing: typePx(1.2), textTransform: 'uppercase',
                color: 'text.disabled', mb: 0.5,
              }}>
                {d.label}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 0.5 }}>
                {clubsIn(d.code).map(id => {
                  const col = ringColor(id, isDark)
                  const live = playing?.has(id)
                  return (
                    <Box key={id} {...pressable(() => pick(id))} aria-label={`Follow the ${TEAM_NICKNAME[id] ?? TEAM_ABBR[id]}`} sx={{
                      position: 'relative',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5,
                      py: 0.9, borderRadius: 2, cursor: 'pointer', userSelect: 'none',
                      border: '1px solid transparent',
                      ...hoverOnly({ bgcolor: `${col}1f`, borderColor: col }),
                      ...FOCUS_RING,
                    }}>
                      <LogoBubble teamId={id} abbr={TEAM_ABBR[id]} size={36} />
                      <Typography sx={{ fontSize: '0.64rem', fontWeight: 800, lineHeight: 1 }}>{TEAM_ABBR[id]}</Typography>
                      {live && (
                        <Box sx={{
                          position: 'absolute', top: chromePx(6), right: `calc(50% - ${chromePx(22)})`,
                          width: chromePx(8), height: chromePx(8), borderRadius: '50%', bgcolor: '#22c55e',
                          border: '1.5px solid', borderColor: 'background.paper',
                        }} />
                      )}
                    </Box>
                  )
                })}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </ModalShell>
  )
}
