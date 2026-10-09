import React, { useEffect, useRef } from 'react'
import { Typography } from '@mui/material'
import { useWpblHeadingTag } from './PageHeading'
import { TYPE_SCALE } from './ui'
import StandalonePage from '../ui/StandalonePage'
import { trackImpression, EVENTS } from '../lib/analytics'

// The standalone-page frame lives in src/ui/StandalonePage.tsx since Oct 9, 2026, shared with MLB's
// glossary. This is WPBL's binding of it: Back to /wpbl, and the heading rule the section's tabs use.
export default function WpblPage(props: {
  title: React.ReactNode
  standfirst?: React.ReactNode
  maxWidth?: number | string
  children: React.ReactNode
}) {
  const headingTag = useWpblHeadingTag()
  return <StandalonePage {...props} back={{ href: '/wpbl', label: 'Back to WPBL' }} headingTag={headingTag} />
}

/**
 * A heading WITHIN a page, above a section of it. One definition so "Final standings", "How the
 * league works" and the rest read the same everywhere; it snaps to TYPE_SCALE.heading, which is
 * what that token names. Was a local copy in SeasonPage set a step too large by hand.
 */
export function SectionHeading({ children, seen, id }: {
  children: React.ReactNode
  /** An anchor for in-page jump links. The heading keeps a small margin above it when scrolled
   *  to, so it does not land flush against the top edge. */
  id?: string
  /** The page's name for `wpbl_page_section_seen`: report, once per page load, that the reader
   *  scrolled this far. Opt-in, so a long reference page (the glossary) does not send forty. The
   *  section is the heading's own text, so renaming a heading renames its series; that is the
   *  honest reading, since it is a different section to the reader too. */
  seen?: string
}) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!seen || !el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      const section = (el.textContent ?? '').trim().slice(0, 60)
      trackImpression(EVENTS.WPBL_PAGE_SECTION_SEEN, { page: seen, section }, `${seen}|${section}`)
      io.disconnect()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return (
    <Typography ref={ref} id={id} component="h2" sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 800, mt: 4, mb: 1.5, scrollMarginTop: 12 }}>
      {children}
    </Typography>
  )
}
