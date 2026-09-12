// /wpbl/sources: where everything on this section comes from, and who it belongs to.
//
// WHY THIS IS ITS OWN PAGE. Credit already sits beside the content that uses it, which is the
// part that actually stops a reader mistaking somebody else's work for ours (Aug 26, 2026: they
// were doing exactly that with the mirrored Substack, and the fix was the byline on the card).
// What did not exist was a URL answering "where does this site's data come from" for all of it
// at once. The only place naming any of it together was the Terms page, which is the worst home
// there is: nobody reads it, and it frames credit as a legal disclaimer rather than as thanks.
//
// AND IT IS THE PAGE TO HAND SOMEBODY. docs/BACKLINKS.md says the site's remaining constraint is
// not code, it is inbound links. Four independent parties are linked FROM here, three of them by
// permission alone. "We link to you from every game page and from our sources page" is a very
// different email from "please link to us", and this is the URL that sentence needs.
//
// A CREDITS PAGE, NOT A LINKS PAGE, and the distinction is load-bearing. Every entry is
// something the site genuinely uses. The day it grows a "other sites you might like" section it
// becomes a link farm and stops being worth linking to, which was the entire point of it.
//
// A SIBLING PATH, not a section of /wpbl/league, on the same reasoning routes.ts records for the
// glossary: a distinct URL is what somebody can cite, and one page cannot carry two intents.
// No nav pill. The footer is the crawl path that has actually worked.
import { Box, Typography } from '@mui/material'
import { WPBL_SOURCES, SOURCE_GROUPS } from './sources'
import { CARD_BORDER, SectionCard, TYPE_SCALE, hoverOnly } from './ui'
import { useWpblHeadingTag } from './PageHeading'

export default function SourcesPage() {
  const headingTag = useWpblHeadingTag()
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* NO STANDFIRST UNDER THIS HEADING. The first draft opened "almost nothing on this site
          is original reporting", which is both true and a terrible thing to say to a reader:
          this is the page handed to somebody deciding whether to trust or link to the site, and
          it opened by talking it down. The heading names the page and each group's own line
          says what that group is; a paragraph apologising for the whole thing helps nobody. */}
      <Typography component={headingTag} sx={{
        fontSize: TYPE_SCALE.heading, fontWeight: 800, letterSpacing: '-0.3px', lineHeight: 1.2,
      }}>
        Data sources
      </Typography>

      {SOURCE_GROUPS.map(group => {
        const rows = WPBL_SOURCES.filter(s => s.kind === group.kind)
        if (rows.length === 0) return null
        return (
          <SectionCard key={group.kind} title={group.label}>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.5, mb: 1.5 }}>
              {group.blurb}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {rows.map(s => (
                <Box key={s.url} sx={{
                  p: 1.5, borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
                }}>
                  {/* THE NAME IS THE LINK, and it opens in a new tab like every other link to
                      somebody else's work in this section. A reader on this page is checking
                      provenance; sending them away from what they were checking is the one
                      thing it should not do. */}
                  <Typography
                    component="a"
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      display: 'inline-block', fontSize: TYPE_SCALE.body, fontWeight: 700,
                      color: 'inherit', textDecoration: 'none',
                      ...hoverOnly({ textDecoration: 'underline' }),
                      '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
                    }}
                  >
                    {s.name} <Box component="span" aria-hidden sx={{ color: 'text.disabled' }}>↗</Box>
                  </Typography>
                  <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.5, mt: 0.25 }}>
                    {s.who}
                  </Typography>
                  {/* What was taken and where it shows, as a definition list rather than prose:
                      somebody checking a specific claim is scanning for their own name and then
                      for the scope, and three labelled lines is faster to scan than a paragraph
                      that says the same thing. */}
                  <Box component="dl" sx={{ m: 0, mt: 1, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 1.25, rowGap: 0.5 }}>
                    <Detail label="Used for">{s.uses}</Detail>
                    <Detail label="Shown on">{s.seenOn}</Detail>
                    <Detail label="Basis">{s.basis}</Detail>
                  </Box>
                </Box>
              ))}
            </Box>
          </SectionCard>
        )
      })}

      <SectionCard title="Corrections">
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.6 }}>
          If you are one of the people above and something here is wrong, or you would rather this
          site did not use your work, say so and it will be changed or removed. There is a feedback
          link in the footer of every page.
        </Typography>
      </SectionCard>

      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', lineHeight: 1.5 }}>
        Not affiliated with the WPBL, or with any of the sites above. The MLB section of this site
        is built on the public MLB Stats API in the same way.
      </Typography>
    </Box>
  )
}

/** One labelled line of a source's entry. The label is a real `<dt>`, since this whole block is
 *  a definition list and a screen reader should meet it as one. */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <Typography component="dt" sx={{
        fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
        color: 'text.disabled', lineHeight: 1.9, whiteSpace: 'nowrap',
      }}>
        {label}
      </Typography>
      <Typography component="dd" sx={{ m: 0, fontSize: TYPE_SCALE.meta, lineHeight: 1.5 }}>
        {children}
      </Typography>
    </>
  )
}
