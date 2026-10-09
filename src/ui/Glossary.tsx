// The two halves of a rules & glossary page: the rules as questions, and the abbreviations by
// group. Built for /wpbl/glossary and shared with /mlb/glossary since Oct 9, 2026, so the two
// leagues' reference pages read as one site. Each section keeps its own data (wpbl/glossary.ts,
// mlb/statGlossary.ts) because the leagues differ exactly where a glossary has to be right: ERA per
// seven against per nine, a four-inning win against a five-inning one.
import { useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { CARD_BORDER, SectionCard, TYPE_SCALE } from './card'
import { PillGroup } from './PillGroup'
import { typePx } from './scale'

export interface GlossaryRule {
  /** Slug, and stable: it is the anchor a link to this rule points at. */
  id: string
  question: string
  answer: string
  /** Where the rule came from; `badge` turns it into the label shown beside the question. */
  source: string
  /** The working, shown under the answer. */
  note?: string
}

export interface GlossaryEntry { full: string; plain?: string | null }

export interface GlossaryGroup { key: string; label: string; keys: string[] }

export function GlossaryRules({ title, rules, badge }: {
  title: string
  rules: GlossaryRule[]
  /** The label for a source, or null for the default a reader assumes (the league's own word):
   *  badging every rule would make the ones that matter invisible among them. */
  badge: (source: string) => string | null
}) {
  return (
    <SectionCard title={title} frameless bare>
      <Box component="dl" sx={{ m: 0, display: 'flex', flexDirection: 'column', gap: 1.75 }}>
        {rules.map(r => {
          const label = badge(r.source)
          return (
            // A real <dt>/<dd>, because this page IS a definition list and the FAQPage markup in
            // seo.ts claims as much. An id per rule so a link can point at one.
            <Box key={r.id} id={r.id} sx={{ scrollMarginTop: '5rem' }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                <Typography component="dt" sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, lineHeight: 1.25 }}>
                  {r.question}
                </Typography>
                {label && (
                  <Typography component="span" sx={{
                    flexShrink: 0, fontSize: TYPE_SCALE.caption, fontWeight: 800,
                    textTransform: 'uppercase', letterSpacing: typePx(0.4),
                    px: 0.6, py: '1px', borderRadius: 0.75,
                    border: '1px solid', borderColor: CARD_BORDER, color: 'text.secondary',
                  }}>
                    {label}
                  </Typography>
                )}
              </Box>
              <Typography component="dd" sx={{
                m: 0, mt: 0.4, fontSize: TYPE_SCALE.body, lineHeight: 1.55, color: 'text.primary',
              }}>
                {r.answer}
              </Typography>
              {r.note && (
                // The working, and it is quieter than the answer on purpose: a reader who wants
                // the rule has it above, and a reader who wants to know how we know reads on.
                <Typography sx={{
                  fontSize: TYPE_SCALE.meta, lineHeight: 1.5, color: 'text.secondary',
                  mt: 0.5, pl: 1.25, borderLeft: '2px solid', borderColor: CARD_BORDER,
                }}>
                  {r.note}
                </Typography>
              )}
            </Box>
          )
        })}
      </Box>
    </SectionCard>
  )
}

export function GlossaryTerms({ groups, term, accent }: {
  groups: GlossaryGroup[]
  /** The definition of an abbreviation, or null when there is none. */
  term: (k: string) => GlossaryEntry | null
  /** The abbreviation's colour: the section's text-safe accent. */
  accent: string
}) {
  const [group, setGroup] = useState(groups[0].key)

  const shown = useMemo(() => {
    const g = groups.find(x => x.key === group) ?? groups[0]
    // Filtered against the definitions rather than trusted, so a key removed from the glossary
    // cannot leave a blank row here: the group lists are a running order, not a second source
    // of truth about which terms exist.
    return g.keys.flatMap(k => { const t = term(k); return t ? [{ k, ...t }] : [] })
  }, [groups, group, term])

  return (
    <SectionCard
      title="What the abbreviations mean"
      subtitle="The same definitions the tooltips show, in one place"
      frameless
      bare
    >
      {/* IN THE BODY, NOT THE HEADER'S `action` SLOT, and it was there first. That slot does not
          shrink, so at 375px the three pills took 255px of a 341px header and squeezed the title
          into 46px. A switch over a list also belongs with the list rather than opposite its title. */}
      <PillGroup
        options={groups.map(g => ({ value: g.key, label: g.label }))}
        value={group}
        onChange={setGroup}
        mb={1.25}
      />
      <Box component="dl" sx={{
        m: 0, display: 'grid', gap: 0.25,
        // Two columns from sm up: these are short rows and a single column on a wide screen is a
        // very long page of mostly empty line.
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2.5,
      }}>
        {shown.map(t => (
          <Box key={t.k} sx={{
            display: 'flex', gap: 1.25, py: 0.6,
            borderTop: '1px solid', borderColor: 'divider',
            '&:first-of-type': { borderTop: 0 },
            // The second column's first row needs its rule back: `:first-of-type` only clears the
            // very first cell in the grid, and without this the top of column two sits flush
            // while column one has a rule under its heading.
            '@media (min-width: 600px)': { '&:nth-of-type(2)': { borderTop: 0 } },
          }}>
            <Typography component="dt" sx={{
              flexShrink: 0, width: '3.25rem', fontSize: TYPE_SCALE.meta, fontWeight: 800,
              fontVariantNumeric: 'tabular-nums', color: accent, lineHeight: 1.4,
            }}>
              {t.k}
            </Typography>
            <Box sx={{ minWidth: 0 }}>
              <Typography component="dd" sx={{ m: 0, fontSize: TYPE_SCALE.meta, fontWeight: 600, lineHeight: 1.4 }}>
                {t.full}
              </Typography>
              {t.plain && (
                <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.4, mt: 0.15 }}>
                  {t.plain}
                </Typography>
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </SectionCard>
  )
}
