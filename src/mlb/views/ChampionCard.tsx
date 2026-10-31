import React, { useEffect, useState } from 'react'
import { Box, Skeleton, Typography } from '@mui/material'
import { TYPE_SCALE, edge } from '../../ui/card'
import { FOCUS_RING } from '../../ui/interaction'
import { NameText } from '../../ui/NameText'
import { trophyPalette } from '../../ui/trophy'
import { useDark } from '../../ui/useDark'
import { chromePx, typePx } from '../../ui/scale'
import { TeamLogo } from '../components/TeamLogo'
import { HEADSHOT, TEAM_NICKNAME } from '../constants'
import { LINK_SX, playerLink, teamLink } from '../lib/links'
import { fetchWorldSeriesMvp } from '../postseason'
import type { Bracket, SeriesMvp } from '../postseason'

/**
 * The new champion, leading Home for the week after the final out (see `homeStageOn`). The bracket
 * under it is the record of the whole October; this is the one fact a reader came to see, which until
 * Oct 29, 2026 was a single line of text above a card one quarter of the page wide.
 *
 * The MVP is the one thing here that needs a read, and it is published with the final out, so its row
 * holds its room until the read returns rather than arriving under the name.
 *
 * `compact` is the row it shrinks to after that week, on top of Home until Opening Day. It needs no
 * MVP: the awards card carries the MVP once this one stops naming it.
 */
export function ChampionCard({ bracket, compact, linkLabel, linkProps, onTeamClick, onPlayerClick }: {
  bracket: Bracket
  compact?: boolean
  /** The strip's one link: the recap on Home, the series on the recap. */
  linkLabel: string
  linkProps: Record<string, unknown>
  onTeamClick?: (id: number) => void
  onPlayerClick?: (id: number) => void
}) {
  const dark = useDark()
  const { gold, goldSoft, stripBg, cardBg } = trophyPalette(dark)
  const [mvp, setMvp] = useState<SeriesMvp | null | undefined>(undefined)

  useEffect(() => {
    if (compact) return
    let cancelled = false
    fetchWorldSeriesMvp(bracket.season).then(m => { if (!cancelled) setMvp(m) })
    return () => { cancelled = true }
  }, [bracket.season, compact])

  const ws = bracket.series.W_1
  if (ws.winnerId == null) return null
  const topWon = ws.winnerId === ws.top.id
  const champ = topWon ? ws.top : ws.bottom
  const runnerUp = topWon ? ws.bottom : ws.top
  const result = `Beat ${TEAM_NICKNAME[runnerUp.id] ?? runnerUp.abbr} ${Math.max(ws.winsTop, ws.winsBottom)}–${Math.min(ws.winsTop, ws.winsBottom)}`

  if (compact) return (
    <CompactRow
      season={bracket.season}
      result={`Beat ${TEAM_NICKNAME[runnerUp.id] ?? runnerUp.abbr} ${Math.max(ws.winsTop, ws.winsBottom)}–${Math.min(ws.winsTop, ws.winsBottom)}`}
      logo={<TeamLogo teamId={champ.id} abbr={champ.abbr} size={36} decorative />}
      name={
        <Typography {...teamLink(champ.id, onTeamClick)} sx={{
          ...LINK_SX, display: 'block', fontSize: TYPE_SCALE.title, fontWeight: 800, lineHeight: 1.2,
          color: 'text.primary', '&:hover': { textDecoration: 'underline' }, ...FOCUS_RING,
        }}>
          {champ.name}
        </Typography>
      }
      link={
        <Box {...linkProps} sx={{
          ...LINK_SX, fontSize: TYPE_SCALE.meta, fontWeight: 800, color: goldSoft, whiteSpace: 'nowrap',
          '&:hover': { textDecoration: 'underline' }, ...FOCUS_RING,
        }}>
          {linkLabel} ›
        </Box>
      }
    />
  )

  return (
    <Box sx={{
      borderRadius: 3, overflow: 'hidden', border: '1px solid', borderColor: edge(gold),
      backgroundImage: cardBg,
    }}>
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.75,
        background: stripBg, borderBottom: '1px solid', borderColor: 'divider',
      }}>
        <Typography sx={{
          flex: 1, minWidth: 0, fontSize: TYPE_SCALE.meta, fontWeight: 900, letterSpacing: typePx(1),
          textTransform: 'uppercase', color: goldSoft,
        }}>
          {bracket.season} World Series champions
        </Typography>
        <Box {...linkProps} sx={{
          ...LINK_SX, flexShrink: 0, fontSize: TYPE_SCALE.meta, fontWeight: 800, color: goldSoft,
          whiteSpace: 'nowrap', '&:hover': { textDecoration: 'underline' }, ...FOCUS_RING,
        }}>
          {linkLabel} ›
        </Box>
      </Box>

      <Box sx={{
        p: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between', gap: { xs: 1.5, sm: 3 },
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, minWidth: 0 }}>
          <TeamLogo teamId={champ.id} abbr={champ.abbr} size={52} decorative />
          <Box sx={{ minWidth: 0 }}>
            <Typography {...teamLink(champ.id, onTeamClick)} sx={{
              ...LINK_SX, display: 'block', fontSize: TYPE_SCALE.display, fontWeight: 900, lineHeight: 1.15,
              color: 'text.primary', '&:hover': { textDecoration: 'underline' }, ...FOCUS_RING,
            }}>
              {champ.name}
            </Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, color: 'text.primary', mt: 0.35 }}>
              {result}
            </Typography>
          </Box>
        </Box>

        {/* Null is a feed that has not published one: no row at all rather than an empty label. */}
        {mvp !== null && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flexShrink: 0 }}>
            <Box sx={{ width: chromePx(40), borderRadius: 1.5, overflow: 'hidden', flexShrink: 0, bgcolor: 'action.hover' }}>
              {mvp
                ? <Box component="img" src={HEADSHOT(mvp.id)} alt="" sx={{ width: '100%', height: 'auto', aspectRatio: '2 / 3', objectFit: 'cover', display: 'block' }} />
                : <Box sx={{ width: '100%', aspectRatio: '2 / 3' }} />}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: typePx(0.5), textTransform: 'uppercase', color: 'text.primary' }}>
                World Series MVP
              </Typography>
              {mvp ? (
                <NameText
                  name={mvp.name}
                  linkProps={playerLink(mvp.id, mvp.name, onPlayerClick)}
                  sx={{ ...LINK_SX, display: 'block', fontSize: TYPE_SCALE.title, fontWeight: 800, color: 'text.primary', '&:hover': { textDecoration: 'underline' }, ...FOCUS_RING }}
                />
              ) : (
                <Typography sx={{ fontSize: TYPE_SCALE.title }}><Skeleton width="8rem" /></Typography>
              )}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  )
}

function CompactRow({ season, logo, name, link, result }: {
  season: number
  logo: React.ReactNode
  name: React.ReactNode
  link: React.ReactNode
  result: React.ReactNode
}) {
  const { gold, goldSoft, cardBg } = trophyPalette(useDark())
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 1,
      borderRadius: 3, border: '1px solid', borderColor: edge(gold), backgroundImage: cardBg,
    }}>
      <Box sx={{ width: chromePx(36), height: chromePx(36), flexShrink: 0 }}>{logo}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 900, letterSpacing: typePx(0.5), textTransform: 'uppercase', color: goldSoft, lineHeight: 1.3 }}>
          {season} World Series champions
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1 }}>
          {name}
          <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: 'text.primary', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
            {result}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ flexShrink: 0 }}>{link}</Box>
    </Box>
  )
}

/** The card drawn empty, for the recap page before its bracket is read (src/CLAUDE.md). */
export function ChampionCardSkeleton({ season, compact }: { season: number; compact?: boolean }) {
  const dark = useDark()
  const { gold, goldSoft, stripBg, cardBg } = trophyPalette(dark)
  if (compact) return (
    <Box aria-hidden>
      <CompactRow
        season={season}
        logo={null}
        name={<Typography sx={{ fontSize: TYPE_SCALE.title, lineHeight: 1.2 }}><Skeleton width="9rem" /></Typography>}
        link={<Box sx={{ fontSize: TYPE_SCALE.meta, visibility: 'hidden' }}>Recap ›</Box>}
        result={<Skeleton width="5.5rem" sx={{ display: 'inline-block' }} />}
      />
    </Box>
  )
  return (
    <Box aria-hidden sx={{ borderRadius: 3, overflow: 'hidden', border: '1px solid', borderColor: edge(gold), backgroundImage: cardBg }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.75, background: stripBg, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.meta, fontWeight: 900, letterSpacing: typePx(1), textTransform: 'uppercase', color: goldSoft }}>
          {season} World Series champions
        </Typography>
      </Box>
      <Box sx={{
        p: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between', gap: { xs: 1.5, sm: 3 },
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, minWidth: 0 }}>
          <Box sx={{ width: chromePx(52), height: chromePx(52), flexShrink: 0 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: TYPE_SCALE.display, lineHeight: 1.15 }}><Skeleton width="12rem" /></Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.body, mt: 0.35 }}><Skeleton width="7rem" /></Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flexShrink: 0 }}>
          <Box sx={{ width: chromePx(40), aspectRatio: '2 / 3', borderRadius: 1.5, flexShrink: 0, bgcolor: 'action.hover' }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: typePx(0.5), textTransform: 'uppercase', color: 'text.primary' }}>
              World Series MVP
            </Typography>
            <Typography sx={{ fontSize: TYPE_SCALE.title }}><Skeleton width="8rem" /></Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
