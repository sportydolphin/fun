import { useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { SectionCard, CardLink, TYPE_SCALE } from '../../ui/card'
import { NameText } from '../../ui/NameText'
import { chromePx } from '../../ui/scale'
import { useLastShape, useRememberShape } from '../../lib/lastShape'
import { awardCardRows, awardSections, fetchAwards, positionCounts, seededAwards } from '../awardWinners'
import type { AwardWinner } from '../awardWinners'
import { CountRow } from '../components/CountRow'
import { MlbSheet } from '../components/MlbSheet'
import { TeamLogo } from '../components/TeamLogo'
import { TEAM_ABBR } from '../constants'
import { LINK_SX, playerLink } from '../lib/links'
import { clearOverlayIf, getHomeOverlay, stampOverlay } from '../state/homeOverlay'

const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Only measured, never read: the row a loading card ghosts. */
const GHOST: AwardWinner = { code: '', label: 'AL Rookie of the Year', kind: 'major', group: '', playerId: null, name: 'Bobby Witt Jr.', position: null, teamId: null, date: '' }

function WinnerRow({ w, detail, onPlayerClick, ghost }: {
  w: AwardWinner
  detail: string
  onPlayerClick?: (id: number) => void
  ghost?: boolean
}) {
  const abbr = w.teamId != null ? TEAM_ABBR[w.teamId] : undefined
  return (
    <Box aria-hidden={ghost || undefined} sx={{
      display: 'flex', alignItems: 'center', gap: 1.25, py: 0.75, minWidth: 0,
      visibility: ghost ? 'hidden' : undefined,
    }}>
      <Box sx={{ width: chromePx(28), flexShrink: 0, display: 'flex' }}>
        {w.teamId != null && abbr && <TeamLogo teamId={w.teamId} abbr={abbr} size={28} decorative />}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <NameText
          name={w.name}
          linkProps={w.playerId != null ? playerLink(w.playerId, w.name, onPlayerClick) : undefined}
          sx={{ ...LINK_SX, display: 'block', fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.25, color: 'text.primary' }}
        />
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.25 }}>{detail}</Typography>
      </Box>
    </Box>
  )
}

const cardDetail = (w: AwardWinner) => (w.kind === 'position' && w.position ? `${w.label} · ${w.position}` : w.label)

function AwardsSheet({ season, awards, onClose, onPlayerClick }: {
  season: number
  awards: AwardWinner[]
  onClose: () => void
  onPlayerClick?: (id: number) => void
}) {
  return (
    <MlbSheet onClose={onClose} maxWidth={chromePx(540)} sheet sheetFill eyebrow={`${season} Awards`}>
      <Box sx={{ px: 2, pb: 2 }}>
        {awardSections(awards).map(s => (
          <Box key={s.label} sx={{ mt: 1.5 }}>
            <Typography component="h3" sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 800, color: 'text.secondary', mb: 0.25 }}>{s.label}</Typography>
            {s.winners.map(w => (
              <WinnerRow
                key={`${w.code}:${w.name}`}
                w={w}
                detail={w.position ?? 'Manager'}
                onPlayerClick={stampOverlay({ kind: 'awards' }, onPlayerClick)}
              />
            ))}
          </Box>
        ))}
      </Box>
    </MlbSheet>
  )
}

/**
 * The season's awards, as the league gives them, from the end of the World Series to Opening Day.
 * Draws nothing until the first is given. The rows the card held last time are ghosted while it reads,
 * so a returning reader's column does not move; the seed covers almost everyone after the first read.
 */
export function AwardsCard({ season, followedTeamId, withSeriesMvp, onPlayerClick }: {
  season: number
  followedTeamId?: number | null
  /** Off while the champion card above already names the MVP. */
  withSeriesMvp: boolean
  onPlayerClick?: (id: number) => void
}) {
  const [awards, setAwards] = useState<AwardWinner[]>(() => seededAwards(season))
  const [loaded, setLoaded] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(() => getHomeOverlay()?.kind === 'awards')

  useEffect(() => {
    let cancelled = false
    fetchAwards(season, localToday()).then(a => { if (!cancelled) { setAwards(a); setLoaded(true) } })
    return () => { cancelled = true }
  }, [season])

  const rows = awardCardRows(awards, followedTeamId, withSeriesMvp)
  const counts = positionCounts(awards)
  const shape = rows.length + counts.length
  const ghostRows = useLastShape('mlb.awards', 0)
  useRememberShape('mlb.awards', loaded ? shape : undefined)

  const drawnEmpty = shape === 0 && !loaded
  if (shape === 0 && !(drawnEmpty && ghostRows > 0)) return null
  const close = () => { setSheetOpen(false); clearOverlayIf('awards') }

  return (
    <SectionCard
      title={`${season} Awards`}
      action={shape > 0 ? <CardLink label="All awards" onClick={() => setSheetOpen(true)} /> : undefined}
    >
      {shape === 0
        ? Array.from({ length: ghostRows }, (_, i) => <WinnerRow key={i} w={GHOST} detail={GHOST.label} ghost />)
        : (
          <>
            {rows.map(w => (
              <WinnerRow key={`${w.code}:${w.name}`} w={w} detail={cardDetail(w)} onPlayerClick={onPlayerClick} />
            ))}
            {counts.map(c => (
              <CountRow key={c.group} label={c.group} value={`${c.count} ${c.count === 1 ? 'winner' : 'winners'}`} onOpen={() => setSheetOpen(true)} />
            ))}
          </>
        )}
      {sheetOpen && <AwardsSheet season={season} awards={awards} onClose={close} onPlayerClick={onPlayerClick} />}
    </SectionCard>
  )
}
