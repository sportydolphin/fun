import { useDark } from '../../ui/useDark'
import { Box, Typography } from '@mui/material'
import { wpblAccent, outsToIp } from '../constants'
import { useWpblPlayerLink } from '../LinkContext'
import { BoxTable, BOX_POS_SX } from '../../ui/gameCenter'
import { usePhoneLayout, wpblFeatureName } from '../ui'
import type { WpblTeam, WpblPlayer, WpblBattingLine, WpblPitchingLine } from '../types'
import { BAT_COLS, PIT_COLS, buildBattingRows, BOX_NAME_MAX } from './shared'
import { TYPE_SCALE } from '../../ui/card'

export function TeamBox({ team, batting, pitching, names, onOpenPlayer }: {
  team: WpblTeam
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  names: Map<string, WpblPlayer>
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const isDark = useDark()
  const isMobile = usePhoneLayout()
  const color = wpblAccent(team.id, isDark)
  const playerLink = useWpblPlayerLink()
  const batCols = BAT_COLS
  // The phone keeps the tighter box budget; elsewhere the full name, which BoxTable fits to the
  // column it is given rather than to a character count.
  const boxName = (n: string) => (isMobile ? wpblFeatureName(n, BOX_NAME_MAX) : n)
  // Non-hitting pitchers dropped, subs ordered under their starter (see buildBattingRows).
  const battingRows = buildBattingRows(batting)
  const batTotals = battingRows.reduce((t, { b }) => {
    for (const c of batCols) (t as any)[c.key] = ((t as any)[c.key] ?? 0) + (Number(b[c.key]) || 0)
    return t
  }, {} as Record<string, number>)

  // A totals row, the same one the batting table has: without it a reader adds up the team's
  // pitching line by eye.
  //
  // IP IS SUMMED AS OUTS AND CONVERTED ONCE. Adding the printed values is the oldest arithmetic
  // trap in a box score: 6.2 + 0.1 is seven innings, not 6.3, and nothing in the string says
  // which base it is written in. `outsToIp` is the only spelling of that conversion here.
  const pitOuts = pitching.reduce((n, p) => n + (Number(p.outs) || 0), 0)
  const pitTotals = PIT_COLS.map(c => {
    const vals = pitching.map(p => p[c.key])
    // One missing value makes the column unsummable. Every cell above prints "—" when the feed
    // sent nothing, and a total that quietly leaves a reliever's pitch count out is a wrong
    // number wearing a total's clothes, where a dash is a fact.
    return vals.some(v => v == null) ? null : vals.reduce<number>((n, v) => n + (Number(v) || 0), 0)
  })

  if (battingRows.length === 0 && pitching.length === 0) return null

  // A name opens the player where the roster knows who it is; the feed's id is all a line has.
  const nameFor = (playerId: string) => {
    const p = names.get(playerId)
    return {
      name: p ? boxName(p.name) : '—',
      nameProps: p && onOpenPlayer ? playerLink(p, onOpenPlayer) as Record<string, unknown> : undefined,
    }
  }
  return (
    <Box>
      {battingRows.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <BoxTable
            head="Batting" dense={isMobile} rule={color} hoverColor={color}
            cols={batCols.map(c => ({ key: c.key as string, label: c.label, bold: c.key === 'h' }))}
            rows={battingRows.map(({ b, isSub }) => ({
              key: b.id, isSub, ...nameFor(b.player_id),
              suffix: b.position ? <Typography component="span" sx={BOX_POS_SX}>{b.position}</Typography> : null,
              cells: batCols.map(c => Number(b[c.key]) || 0),
            }))}
            totals={batCols.map(c => batTotals[c.key as string] ?? 0)}
          />
        </Box>
      )}

      {/* Its totals are drawn exactly like the batting totals: the same rule in the club's colour,
          the same label, because they are the same thing and a reader who has learned to look for
          one at the bottom of a table should find the other. */}
      {pitching.length > 0 && (
        <BoxTable
          head="Pitching" dense={isMobile} rule={color} hoverColor={color}
          cols={[{ key: 'ip', label: 'IP', bold: true, w: 32 }, ...PIT_COLS.map(c => ({ key: c.key as string, label: c.label }))]}
          rows={pitching.map(p => ({
            key: p.id, ...nameFor(p.player_id),
            suffix: p.decision ? <Typography component="span" sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, color, lineHeight: 1 }}>({p.decision})</Typography> : null,
            cells: [outsToIp(p.outs), ...PIT_COLS.map(c => (p[c.key] == null ? null : Number(p[c.key])))],
          }))}
          totals={[outsToIp(pitOuts), ...pitTotals]}
        />
      )}
    </Box>
  )
}
