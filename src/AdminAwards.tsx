import { useEffect, useMemo, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, CircularProgress,
} from '@mui/material'
import { Close, Refresh } from '@mui/icons-material'
import {
  fetchAdminAwardVotes, buildAdminAwardReport, awardChoiceLabel, awardChoiceTeam,
} from './lib/adminAwards'
import type { AdminAwardVote } from './lib/adminAwards'
import { fetchWpblAllPlayers } from './wpbl/api'
import { AWARDS_CLOSE_LABEL } from './wpbl/awards'
import { TeamBadge } from './wpbl/ui'
import { WPBL_TEAMS } from './wpbl/constants'
import type { WpblPlayer } from './wpbl/types'

// ─── The fan-award panel ──────────────────────────────────────────────────────
//
// WHAT AN OWNER CANNOT SEE FROM THE BALLOT ITSELF, which is the reason this exists at all.
// The sheet shows the tally, and only for the categories a reader has answered; it counts
// answers rather than people, hides everything until you have voted, and shows five of the
// thirteen questions the table holds. This shows the lot: every category including the eight
// that are defined and unasked, the pick'em rows that share the table, how many PEOPLE have
// voted rather than how many answers exist, how far they got, and when the last one arrived.
//
// IT IS A READ. There is no way to change or delete a vote from here, deliberately: the panel
// is for looking at a poll, and the moment it can edit one it is a poll the owner is in.

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 900, lineHeight: 1.1 }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary' }}>{label}</Typography>
      {sub && <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled' }}>{sub}</Typography>}
    </Box>
  )
}

/** One choice: the club, the name, the bar, the count. The bar is the share of THIS category,
 *  which is the only denominator that means anything on a question people answer once. */
function ChoiceRow({ choice, votes, share, players }: {
  choice: string; votes: number; share: number; players: WpblPlayer[]
}) {
  const teamId = awardChoiceTeam(choice, players)
  const team = teamId ? WPBL_TEAMS[teamId] : null
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.55 }}>
      {team
        ? <TeamBadge team={team} size={20} />
        : <Box sx={{ width: 20, flexShrink: 0 }} />}
      <Typography sx={{
        fontSize: '0.78rem', fontWeight: 600, minWidth: 0, flexShrink: 1,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{awardChoiceLabel(choice, players)}</Typography>
      {/* The bar takes what the name does not, so a long name shortens it rather than wrapping
          the row. It is the one thing here that has to be read at a glance. */}
      <Box sx={{ flex: 1, minWidth: 24, height: 6, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box sx={{ width: `${Math.round(share * 100)}%`, height: '100%', bgcolor: 'primary.main' }} />
      </Box>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, flexShrink: 0, width: 56, textAlign: 'right' }}>
        {votes} · {Math.round(share * 100)}%
      </Typography>
    </Box>
  )
}

export function AwardsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [votes, setVotes] = useState<AdminAwardVote[] | null>(null)
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    // The roster is cached app-wide, so this costs one request the first time and nothing after.
    // It is what turns a column of uuids into names, and the panel is useless without it.
    Promise.all([fetchAdminAwardVotes(), fetchWpblAllPlayers()])
      .then(([v, p]) => { if (!cancelled) { setVotes(v); setPlayers(p) } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [open, nonce])

  const report = useMemo(() => votes ? buildAdminAwardReport(votes) : null, [votes])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Typography sx={{ flex: 1, fontSize: '1rem', fontWeight: 800 }}>Fan awards</Typography>
        <IconButton size="small" onClick={() => setNonce(n => n + 1)} aria-label="Reload the votes">
          <Refresh fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={onClose} aria-label="Close"><Close fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Typography sx={{ fontSize: '0.8rem', color: 'error.main', mb: 2 }}>{error}</Typography>
        )}
        {!report && !error && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>
        )}
        {report && (
          <>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 2.5 }}>
              <Stat label="voters" value={report.voters} sub="people, not answers" />
              <Stat label="votes cast" value={report.votes} />
              <Stat label="finished all five" value={report.completed} />
              <Stat
                label="last vote"
                value={report.latest ? new Date(report.latest).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}
                sub={report.latest ? new Date(report.latest).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : `closes ${AWARDS_CLOSE_LABEL}`}
              />
            </Box>

            {/* HOW FAR PEOPLE GET, which is the number that says whether the sheet is too long.
                A ballot abandoned after one answer and a ballot finished are the same row in
                every other view here. */}
            {report.voters > 0 && (
              <Box sx={{ mb: 2.5 }}>
                <Typography sx={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: 'text.disabled', mb: 0.5 }}>
                  How many of the five they answered
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {report.byAnswered.slice(1).map((n, i) => (
                    <Box key={i} sx={{ flex: 1, textAlign: 'center', py: 0.6, borderRadius: 1, bgcolor: 'action.hover' }}>
                      <Typography sx={{ fontSize: '0.85rem', fontWeight: 800 }}>{n}</Typography>
                      <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>{i + 1}</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            {report.categories.length === 0 && (
              <Typography sx={{ fontSize: '0.8rem', color: 'text.disabled' }}>
                Nobody has voted yet.
              </Typography>
            )}

            {report.categories.map(c => (
              <Box key={c.category} sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.25 }}>
                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, minWidth: 0 }}>{c.label}</Typography>
                  {/* The eight defined-and-unasked categories and the pick'em rows are marked,
                      because "Rookie of the Year: 3 votes" out of context reads as a live
                      question rather than as an id somebody reached before it was on the card. */}
                  {!c.onTheCard && (
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.disabled', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                      not on the card
                    </Typography>
                  )}
                  <Box sx={{ flex: 1 }} />
                  <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
                    {c.votes} {c.votes === 1 ? 'vote' : 'votes'}
                  </Typography>
                </Box>
                {c.choices.map(ch => (
                  <ChoiceRow key={ch.choice} choice={ch.choice} votes={ch.votes} share={ch.share} players={players} />
                ))}
              </Box>
            ))}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
