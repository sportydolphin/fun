import React, { useEffect, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, CircularProgress, IconButton,
} from '@mui/material'
import { Close, ChevronRight, ExpandMore } from '@mui/icons-material'
import { Team } from './mlb/types'
import { TEAM_BG, ACCENT } from './mlb/constants'
import { fetchAllTeams } from './mlb/api'
import {
  loadPrefsFromSupabase, savePrefsToSupabase,
  getLocalFollowedTeamId, setLocalFollowedTeamId, getLocalFollowedPlayerIds,
} from './mlb/prefs'

interface Props {
  open:            boolean
  onClose:         () => void
  userId:          string
  email:           string
  currentUsername: string | null
  onEditUsername:  () => void   // closes Settings and opens the username dialog
}

export function SettingsDialog({ open, onClose, userId, email, currentUsername, onEditUsername }: Props) {
  const [teams, setTeams]     = useState<Team[]>([])
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [teamId, setTeamId]   = useState<number | null>(null)
  const [playerIds, setPlayerIds] = useState<number[]>([])
  const [saving, setSaving]   = useState(false)
  const [teamPickerOpen, setTeamPickerOpen] = useState(false)

  // Load team list + current preference whenever the dialog opens
  useEffect(() => {
    if (!open) return
    setTeamPickerOpen(false)
    setLoadingTeams(true)
    fetchAllTeams().then(setTeams).catch(() => setTeams([])).finally(() => setLoadingTeams(false))

    setPlayerIds(getLocalFollowedPlayerIds())
    setTeamId(getLocalFollowedTeamId())
    loadPrefsFromSupabase(userId).then(row => {
      if (row) {
        setTeamId(row.followed_team_id ?? null)
        setPlayerIds(row.followed_player_ids ?? [])
      }
    })
  }, [open, userId])

  const selectTeam = async (id: number | null) => {
    setTeamId(id)
    setLocalFollowedTeamId(id)
    setSaving(true)
    await savePrefsToSupabase(userId, id, playerIds)
    setSaving(false)
  }

  const sortedTeams = [...teams].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, pb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Settings
        <IconButton size="small" onClick={onClose} sx={{ color: 'text.secondary' }}>
          <Close sx={{ fontSize: '1.1rem' }} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: '8px !important' }}>
        {/* Account */}
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.disabled', mb: 0.75 }}>
          Account
        </Typography>
        <Box sx={{ mb: 2.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <Box
            onClick={onEditUsername}
            sx={{
              px: 1.75, py: 1.1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>Username</Typography>
              <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentUsername ? `@${currentUsername}` : email}
              </Typography>
            </Box>
            <ChevronRight sx={{ color: 'text.disabled', flexShrink: 0 }} />
          </Box>
        </Box>

        {/* Preferred team */}
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.disabled', mb: 0.75 }}>
          Preferred Team
        </Typography>
        <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          {(() => {
            const selectedTeam = teams.find(t => t.id === teamId)
            const bg = teamId != null ? (TEAM_BG[teamId] ?? '#444') : undefined
            return (
              <Box
                onClick={() => setTeamPickerOpen(o => !o)}
                sx={{
                  px: 1.75, py: 1.1, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  {selectedTeam ? (
                    <Box sx={{
                      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                      bgcolor: '#fff', border: `2px solid ${bg}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                    }}>
                      <Box
                        component="img"
                        src={`https://www.mlbstatic.com/team-logos/${selectedTeam.id}.svg`}
                        alt={selectedTeam.abbreviation}
                        sx={{ width: 17, height: 17, objectFit: 'contain' }}
                        onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }}
                      />
                    </Box>
                  ) : null}
                  <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {selectedTeam ? selectedTeam.name : loadingTeams ? 'Loading…' : 'Not set'}
                  </Typography>
                </Box>
                <ExpandMore sx={{ color: 'text.disabled', flexShrink: 0, transition: 'transform 0.15s', transform: teamPickerOpen ? 'rotate(180deg)' : 'none' }} />
              </Box>
            )
          })()}

          {teamPickerOpen && (
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider', p: 1 }}>
              {loadingTeams ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <CircularProgress size={20} />
                </Box>
              ) : (
                <>
                  <Box sx={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(54px, 1fr))', gap: 0.5,
                    maxHeight: 168, overflowY: 'auto', pr: 0.5,
                  }}>
                    {sortedTeams.map(t => {
                      const bg = TEAM_BG[t.id] ?? '#444'
                      const selected = teamId === t.id
                      return (
                        <Box
                          key={t.id}
                          onClick={() => selectTeam(t.id)}
                          sx={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.4,
                            p: 0.75, borderRadius: 2, cursor: 'pointer', userSelect: 'none',
                            border: '1.5px solid', borderColor: selected ? bg : 'transparent',
                            bgcolor: selected ? `${bg}1a` : 'transparent',
                            transition: 'all 0.15s',
                            '&:hover': { borderColor: bg, bgcolor: `${bg}14` },
                          }}
                        >
                          <Box sx={{
                            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                            bgcolor: '#fff', border: `2px solid ${bg}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                          }}>
                            <Box
                              component="img"
                              src={`https://www.mlbstatic.com/team-logos/${t.id}.svg`}
                              alt={t.abbreviation}
                              sx={{ width: 20, height: 20, objectFit: 'contain' }}
                              onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }}
                            />
                          </Box>
                          <Typography sx={{ fontSize: '0.56rem', fontWeight: 800, lineHeight: 1.1, textAlign: 'center' }}>
                            {t.abbreviation}
                          </Typography>
                        </Box>
                      )
                    })}
                  </Box>
                  {teamId != null && (
                    <Typography
                      onClick={() => selectTeam(null)}
                      sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'error.main', cursor: 'pointer', mt: 1, '&:hover': { textDecoration: 'underline' } }}
                    >
                      Clear preferred team
                    </Typography>
                  )}
                </>
              )}
            </Box>
          )}
        </Box>
        <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mt: 1 }}>
          {saving ? 'Saving…' : 'Synced to your account — follows you across devices.'}
        </Typography>
      </DialogContent>

      <DialogActions>
        <Button
          onClick={onClose}
          variant="contained"
          sx={{ bgcolor: ACCENT, color: '#fff', '&:hover': { bgcolor: ACCENT, filter: 'brightness(0.92)' } }}
        >
          Done
        </Button>
      </DialogActions>
    </Dialog>
  )
}
