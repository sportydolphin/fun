import { useDark } from '../../ui/useDark'
import { useState } from 'react'
import { Box, Typography } from '@mui/material'
import { track, EVENTS } from '../../lib/analytics'
import { WPBL_ACCENT, wpblFullName } from '../constants'
import { formatRevisionDay, leagueDay } from '../derive/feedHealth'
import { describeRevision, revisionOverflow } from '../derive/gameRevisions'
import { pressable, FOCUS_RING, TAPPABLE } from '../ui'
import { typePx } from '../../ui/scale'
import type { WpblTeam, WpblPlayer, WpblGameRevision } from '../types'
import { TYPE_SCALE } from '../../ui/card'

/**
 * What the league changed about this game after it was final.
 *
 * The date alone comes off `wpbl_games.source_updated_at`, and what it cannot say is WHAT
 * changed. This is that, and it can only exist because the nightly drift check writes the old
 * scoring down before it repairs the mirror: nothing here is recomputed, because after the
 * repair there is nothing left to recompute it from.
 *
 * COLLAPSED, and that is not a default reached for out of habit. Nearly every game in this
 * season has been revised at some point, most revisions are a hit moving from one line to
 * another, and this sits at the foot of a recap somebody opened to read about a baseball game.
 * The summary line carries the only part that is news on its own, which is that there were
 * changes and how many.
 *
 * An empty `changes` on a stored revision is a real state, not a bug: the checker compares a
 * little more than it can write a sentence about, so a revision can move something the log has
 * no words for. Saying that plainly beats hiding the revision, because the date beside it is
 * already on the page and a reader who saw it deserves an answer.
 */
export function RevisionLog({ revisions, gameId, away, home, names, onOpenPlayer }: {
  revisions: WpblGameRevision[]
  gameId: string
  away: WpblTeam | undefined
  home: WpblTeam | undefined
  /** The whole league, as everywhere else on this sheet. A revision stores the name the player
   *  had on the night it was written, and this is what keeps a later rename or merge from
   *  leaving one spelling of her here and another in the box score above. */
  names: Map<string, WpblPlayer>
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const [open, setOpen] = useState(false)
  const dark = useDark()
  if (!revisions.length) return null

  const clubs = { away: away ? wpblFullName(away) : null, home: home ? wpblFullName(home) : null }
  const total = revisions.reduce((t, r) => t + (r.change_count ?? 0), 0)

  return (
    <Box sx={{ px: 2, pb: 2 }}>
      <Box
        component="button"
        onClick={() => { setOpen(o => !o); if (!open) track(EVENTS.WPBL_REVISIONS_OPEN, { gameId, changes: total }) }}
        aria-expanded={open}
        sx={{
          ...pressable, ...TAPPABLE, width: '100%', textAlign: 'left', border: 0, borderRadius: 1,
          background: 'transparent', color: 'text.secondary', px: 0, py: 0.5,
          display: 'flex', alignItems: 'center', gap: 1, fontSize: TYPE_SCALE.body,
          '&:focus-visible': FOCUS_RING,
        }}
      >
        <Box component="span" sx={{
          fontSize: TYPE_SCALE.caption, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(1),
          color: 'text.disabled',
        }}>Scoring changes</Box>
        <Box component="span" sx={{ color: 'text.disabled' }}>
          {total} {total === 1 ? 'change' : 'changes'} the league made after this game ended
        </Box>
        <Box component="span" sx={{ ml: 'auto', color: 'text.disabled' }}>{open ? '▾' : '▸'}</Box>
      </Box>

      {open && revisions.map(rev => {
        const lines = describeRevision(rev, clubs)
        const over = revisionOverflow(rev)
        const on = rev.source_updated_at ? leagueDay(rev.source_updated_at) : null
        return (
          <Box key={rev.id} sx={{ mt: 1.25 }}>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', mb: 0.5 }}>
              {on ? `Revised ${formatRevisionDay(on)}` : 'Revised'}
            </Typography>
            {lines.length === 0 ? (
              <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>
                The league restamped this game without changing the box score.
              </Typography>
            ) : (
              <Box sx={{
                display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 1.5, rowGap: 0.5,
              }}>
                {lines.map((l, i) => (
                  <Box key={i} sx={{ display: 'contents' }}>
                    <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', minWidth: 0 }}>
                      {l.who && (() => {
                        const who = l.playerId ? names.get(l.playerId) : undefined
                        return who && onOpenPlayer ? (
                          <Box
                            component="span" role="link" tabIndex={0}
                            onClick={() => onOpenPlayer(who)}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenPlayer(who) } }}
                            sx={{ ...pressable, color: dark ? WPBL_ACCENT : 'text.primary', fontWeight: 700, cursor: 'pointer' }}
                          >{who.name}</Box>
                        ) : <Box component="span" sx={{ fontWeight: 700 }}>{who?.name ?? l.who}</Box>
                      })()}
                      {l.who ? ' · ' : ''}{l.what}
                    </Typography>
                    <Typography sx={{
                      fontSize: TYPE_SCALE.body, color: 'text.secondary', whiteSpace: 'normal',
                      textAlign: 'right', minWidth: 0,
                    }}>
                      <Box component="span" sx={{ color: 'text.disabled' }}>{l.before}</Box>
                      {' → '}
                      <Box component="span" sx={{ fontWeight: 700 }}>{l.after}</Box>
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
            {over > 0 && (
              <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', mt: 0.5 }}>
                and {over} more, not stored: this revision rewrote more of the game than the log keeps.
              </Typography>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
