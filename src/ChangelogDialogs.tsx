import React, { useMemo, useState } from 'react'
import { Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Button, useMediaQuery } from '@mui/material'
import { APP_VERSION } from './version'
import type { ChangelogChange, ChangelogEntry } from './version'
import { CHANGELOG } from './changelog'
import { ACCENT } from './mlb/constants'

/**
 * The "What's New" dialog and its per-day detail view.
 *
 * Lives in its own lazily-loaded module because it is the only thing that reads CHANGELOG:
 * ~59 KB of release prose that used to sit in the entry chunk, downloaded by every visitor on
 * every cold load to render a dialog opened from a footer link. Nothing here is needed until
 * that link is clicked.
 *
 * A DAY IS THE UNIT, NOT A VERSION NUMBER. This rendered every entry in the file, one heading
 * each, all of them at once: 112 releases and 398 changes over 44 days, and Sep 6 alone was 13
 * headings deep. The scrollbar came up as a sliver and the thing read as a build log. The split
 * into 1.74.1 and 1.74.2 is real to the repository and means nothing to a reader, who wants to
 * know what changed and roughly when, so releases from the same day are drawn as one dated
 * block. That is presentation only. Every entry and every word of it is still in changelog.ts,
 * still reachable, and adding a release still means adding an entry at the top of that file
 * exactly as before; nothing here has to be kept in step with it.
 *
 * The version numbers stay, in small type beside the date, because a bug report saying "since
 * 1.74" is worth being able to place.
 */

/** How many days show before the reader asks for more. About a week at the current pace, which
 *  is short enough to read standing up. The rest is one tap away and nothing is dropped. */
const INITIAL_DAYS = 5

/** Bullets on a day in the summary. A day can carry thirty; the point of this dialog is to say
 *  what happened, not to list it, so the tail goes behind the day's own link. */
const SUMMARY_BULLETS = 3

/** One day's releases. */
interface ChangelogDay {
  date: string
  /** BIGGEST FIRST, not newest first, and that ordering is the whole reason a day reads as
   *  anything. Within a day the newest release is systematically the SMALLEST: a day's work
   *  ships as a feature and then the patches that follow it, so the last version of Sep 8 is
   *  the one-line "One character off the next game" and the last of Sep 6 is a play-by-play
   *  fix, while the same days carried "Picks belong to you now" and a whole Live tab. Led by
   *  the newest, every busy day was titled by its most trivial release. */
  releases: ChangelogEntry[]
  /** Every change made that day, in that same order, for the summary bullets and the count.
   *  Which is what keeps the heading and the three bullets under it talking about one thing. */
  changes: ChangelogChange[]
  /** What the day is called: the leading release's title. Days without one fall back to the
   *  date, since a heading a reader cannot use is worse than no heading. */
  title?: string
  /** "v1.74.2", or "v1.68.0 to v1.74.1" for a day that shipped several. Taken from the ends of
   *  the day's list in FILE order, before the reordering above, so it still reads as a range. */
  versions: string
}

/** Group the flat, newest-first list by date. Pure, and derived rather than stored, so the file
 *  stays the one place a release is written down. */
export function groupByDay(entries: ChangelogEntry[]): ChangelogDay[] {
  const byDate: ChangelogEntry[][] = []
  for (const entry of entries) {
    const last = byDate[byDate.length - 1]
    if (last && last[0].date === entry.date) last.push(entry)
    else byDate.push([entry])
  }
  return byDate.map(group => {
    const versions = group.length === 1
      ? `v${group[0].version}`
      : `v${group[group.length - 1].version} to v${group[0].version}`
    // Stable: `sort` is stable in every engine we ship to, so releases of equal size keep the
    // file's order, which is newest first.
    const releases = [...group].sort((a, b) => b.changes.length - a.changes.length)
    return {
      date: group[0].date,
      releases,
      changes: releases.flatMap(r => r.changes),
      title: releases.find(r => r.title)?.title,
      versions,
    }
  })
}

const fmtDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })

function ChangelogBullet({ text }: { text: string }) {
  return (
    <Typography component="li" sx={{ fontSize: '0.86rem', color: 'text.secondary', mb: 0.6, lineHeight: 1.45 }}>
      {text}
    </Typography>
  )
}

/** The one link on a summary block, and it only appears when there is something behind it. It
 *  used to sit under every release including the ones with a single change, where it opened the
 *  same sentence again at greater length. */
function MoreLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Box
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      sx={{
        display: 'inline-block', mt: 0.75, cursor: 'pointer',
        fontSize: '0.72rem', fontWeight: 700, color: ACCENT,
        '&:hover': { textDecoration: 'underline' },
      }}
    >
      {label}
    </Box>
  )
}

export default function ChangelogDialogs({ open, onClose }: { open: boolean; onClose: () => void }) {
  // The day whose full prose is open. Keyed on the date rather than on a version, because a day
  // is what the summary offers and one of them can hold thirteen versions.
  const [viewAllDate, setViewAllDate] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const isDesktop = useMediaQuery('(min-width:900px)')

  const days = useMemo(() => groupByDay(CHANGELOG), [])
  const shown = showAll ? days : days.slice(0, INITIAL_DAYS)
  const hiddenDays = days.length - shown.length
  const openDay = days.find(d => d.date === viewAllDate) ?? null

  // Closing the dialog puts it back to the top of the list. A reader who expanded three months
  // of history once should not find it expanded the next time they want the last thing shipped.
  const closeAll = () => { setShowAll(false); onClose() }

  return (
    <>
      <Dialog open={open} onClose={closeAll} maxWidth="sm" fullWidth fullScreen={!isDesktop}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
          What's New
          <Typography component="span" sx={{ fontSize: '0.8rem', color: 'text.disabled', fontWeight: 600 }}>
            · currently v{APP_VERSION}
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          {shown.map((day, idx) => {
            const rest = day.changes.length - SUMMARY_BULLETS
            return (
              <Box key={day.date} sx={{ mb: idx === shown.length - 1 ? 0 : 3 }}>
                {/* The date leads and the version rides along in small type. The other way round
                    is what made this read as a build log: "v1.74.1" is the first thing a reader
                    met on every one of a hundred and twelve blocks, and it is the one thing on
                    them they have no use for. */}
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1.2 }}>
                    {day.title ?? fmtDate(day.date)}
                  </Typography>
                  <Typography sx={{ ml: 'auto', fontSize: '0.72rem', color: 'text.disabled', lineHeight: 1.2 }}>
                    {day.title ? `${fmtDate(day.date)} · ${day.versions}` : day.versions}
                  </Typography>
                </Box>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {day.changes.slice(0, SUMMARY_BULLETS).map((c, i) => (
                    <ChangelogBullet key={i} text={c.short} />
                  ))}
                </Box>
                {/* The label says what is actually behind it, in the words someone would use out
                    loud. "View all changes" sat under every block before, including the ones
                    with a single change, where all it opened was the same sentence again at
                    greater length. */}
                <MoreLink
                  label={rest > 0
                    ? `See all ${day.changes.length} changes`
                    : 'Read the full notes'}
                  onClick={() => setViewAllDate(day.date)}
                />
              </Box>
            )
          })}
          {hiddenDays > 0 && (
            <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider', textAlign: 'center' }}>
              <Button size="small" onClick={() => setShowAll(true)}>
                Show earlier updates
              </Button>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAll}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={openDay !== null} onClose={() => setViewAllDate(null)} maxWidth="sm" fullWidth fullScreen={!isDesktop}>
        {openDay && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
              {fmtDate(openDay.date)}
              <Typography component="span" sx={{ fontSize: '0.8rem', color: 'text.disabled', fontWeight: 600 }}>
                {openDay.versions}
              </Typography>
            </DialogTitle>
            <DialogContent dividers>
              {/* The releases keep their own titles in here, which is the reason this view is
                  worth opening on a busy day: "Open a series" and "Call the postseason" shipped
                  within hours of each other and are not one thing. The summary can only name the
                  first of them, so the rest are named here. */}
              {openDay.releases.map((entry, idx) => (
                <Box key={entry.version} sx={{ mb: idx === openDay.releases.length - 1 ? 0 : 2.5 }}>
                  {(entry.title || openDay.releases.length > 1) && (
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                      <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', lineHeight: 1.2 }}>
                        {entry.title ?? `v${entry.version}`}
                      </Typography>
                      {entry.title && (
                        <Typography sx={{ ml: 'auto', fontSize: '0.72rem', color: 'text.disabled', lineHeight: 1.2 }}>
                          v{entry.version}
                        </Typography>
                      )}
                    </Box>
                  )}
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {entry.changes.map((c, i) => (
                      <ChangelogBullet key={i} text={c.full} />
                    ))}
                  </Box>
                </Box>
              ))}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setViewAllDate(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  )
}
