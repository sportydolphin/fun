// /wpbl/glossary: how the league works, and what every abbreviation on a box score means.
//
// THE ONE PAGE HERE WRITTEN FOR A QUESTION THE WEB CANNOT ANSWER. The WPBL does not publish
// how a pitcher earns a win. Searching for it returns the league's format, its schedule and a
// dozen explainers about the nine-inning version of the rule, and nothing about this league.
// Every other page in the section competes with the league's own site on facts the league
// itself publishes better; this one does not compete with anything.
//
// AND IT IS NOT THE WAY ANYONE IS MEANT TO LEARN A TERM. That job belongs to the tooltip on
// the column a reader is already squinting at, which is why glossary.ts is a data module with
// this page as one consumer rather than the other way round. A reference section on this site
// has a measured track record: 575 browsers saw the Reading shelf, 39 clicked it, 3 opened a
// photo. This page is the crawlable, linkable copy — the thing a search result and a Discord
// answer can point at — and it is built to be worth landing on cold, not to be browsed.
//
// EVERY RULE CARRIES ITS SOURCE. Two of the five are not the league's: the qualifying bar is
// our own convention and the win rule is inferred from the league's own scoring. Saying so is
// the difference between a definition and a claim about somebody else's league, and it is
// enforced by a test rather than by good intentions (see glossary.test.ts).
import { useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { STAT_TERMS, WPBL_RULES, statFull, type RuleSource } from './glossary'
import { useEraBasis } from './EraBasisContext'
import { CARD_BORDER, SectionCard, TYPE_SCALE, PillGroup } from './ui'
import { WPBL_ACCENT } from './constants'
import { useWpblHeadingTag } from './PageHeading'

/** How a source is labelled on screen. `league` gets no badge: it is the default a reader
 *  assumes, and badging all five would make the two that matter invisible among them. */
const SOURCE_BADGE: Record<RuleSource, string | null> = {
  league: null,
  site: 'Our convention',
  observed: 'Not published by the league',
}

// The batting/pitching split is how a box score is read and how every other surface in the
// section groups these, so the glossary groups them the same way rather than inventing an
// alphabetical order nobody thinks in. "Both" is the short tail that belongs to neither.
const GROUPS: { key: string; label: string; keys: string[] }[] = [
  {
    key: 'batting', label: 'Batting',
    keys: ['AVG', 'OBP', 'SLG', 'OPS', 'PA', 'AB', 'H', '2B', '3B', 'HR', 'R', 'RBI', 'BB',
      'SO', 'SB', 'CS', 'TB', 'HBP', 'GDP', 'SF', 'SH'],
  },
  {
    key: 'pitching', label: 'Pitching',
    keys: ['ERA', 'WHIP', 'W-L', 'SV', 'IP', 'ER', 'BF', 'GS', 'K/7', 'K/9', 'K/BB', 'WP',
      'BK', 'P', 'DEC'],
  },
  {
    key: 'fielding', label: 'Fielding',
    keys: ['FPCT', 'PO', 'A', 'E', 'DP', 'PB', 'SBA', 'G', 'POS', 'OPP'],
  },
]

export default function WpblGlossaryPage() {
  const headingTag = useWpblHeadingTag()
  const { basis } = useEraBasis()
  const [group, setGroup] = useState(GROUPS[0].key)

  const shown = useMemo(() => {
    const g = GROUPS.find(x => x.key === group) ?? GROUPS[0]
    // Filtered against STAT_TERMS rather than trusted, so a key removed from the glossary
    // cannot leave a blank row here: the group lists are a running order, not a second
    // source of truth about which terms exist.
    return g.keys.filter(k => STAT_TERMS[k]).map(k => ({ k, ...STAT_TERMS[k] }))
  }, [group])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <Typography component={headingTag} sx={{
          fontSize: TYPE_SCALE.heading, fontWeight: 800, letterSpacing: '-0.3px', lineHeight: 1.2,
        }}>
          WPBL rules &amp; glossary
        </Typography>
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', mt: 0.5, lineHeight: 1.5 }}>
          How the Women&rsquo;s Pro Baseball League works, and what the numbers on a box score mean.
          New to baseball? Start with the rules; the abbreviations underneath are the ones you will
          meet on every page here.
        </Typography>
      </Box>

      <SectionCard title="How the league works">
        <Box component="dl" sx={{ m: 0, display: 'flex', flexDirection: 'column', gap: 1.75 }}>
          {WPBL_RULES.map(r => (
            // A real <dt>/<dd>, because this page IS a definition list and the FAQPage markup
            // in seo.ts claims as much. An id per rule so a link can point at one: the win
            // rule is the reason this page exists and it should be quotable on its own.
            <Box key={r.id} id={r.id} sx={{ scrollMarginTop: '5rem' }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                <Typography component="dt" sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, lineHeight: 1.25 }}>
                  {r.question}
                </Typography>
                {SOURCE_BADGE[r.source] && (
                  <Typography component="span" sx={{
                    flexShrink: 0, fontSize: TYPE_SCALE.caption, fontWeight: 800,
                    textTransform: 'uppercase', letterSpacing: 0.4,
                    px: 0.6, py: '1px', borderRadius: 0.75,
                    border: '1px solid', borderColor: CARD_BORDER, color: 'text.secondary',
                  }}>
                    {SOURCE_BADGE[r.source]}
                  </Typography>
                )}
              </Box>
              <Typography component="dd" sx={{
                m: 0, mt: 0.4, fontSize: TYPE_SCALE.body, lineHeight: 1.55, color: 'text.primary',
              }}>
                {r.answer}
              </Typography>
              {r.note && (
                // The working, and it is quieter than the answer on purpose: a reader who
                // wants the rule has it above, and a reader who wants to know how we know is
                // the one who reads on.
                <Typography sx={{
                  fontSize: TYPE_SCALE.meta, lineHeight: 1.5, color: 'text.secondary',
                  mt: 0.5, pl: 1.25, borderLeft: '2px solid', borderColor: CARD_BORDER,
                }}>
                  {r.note}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      </SectionCard>

      <SectionCard
        title="What the abbreviations mean"
        subtitle="The same definitions the tooltips show, in one place"
      >
        {/* IN THE BODY, NOT THE HEADER'S `action` SLOT, and it was there first. That slot does
            not shrink, so at 375px the three pills took 255px of a 341px header and squeezed
            the title into 46px: "What the abbreviations mean" wrapping down a column four
            characters wide, beside a control that fit perfectly. A switch over a list also
            simply belongs with the list rather than opposite its title. */}
        <PillGroup
          options={GROUPS.map(g => ({ value: g.key, label: g.label }))}
          value={group}
          onChange={setGroup}
          mb={1.25}
        />
        <Box component="dl" sx={{
          m: 0, display: 'grid', gap: 0.25,
          // Two columns from sm up: these are short rows and a single column on a wide screen
          // is a very long page of mostly empty line.
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2.5,
        }}>
          {shown.map(t => (
            <Box key={t.k} sx={{
              display: 'flex', gap: 1.25, py: 0.6,
              borderTop: '1px solid', borderColor: 'divider',
              '&:first-of-type': { borderTop: 0 },
              // The second column's first row needs its rule back: `:first-of-type` only
              // clears the very first cell in the grid, and without this the top of column
              // two sits flush while column one has a rule under its heading.
              '@media (min-width: 600px)': { '&:nth-of-type(2)': { borderTop: 0 } },
            }}>
              <Typography component="dt" sx={{
                flexShrink: 0, width: '3.25rem', fontSize: TYPE_SCALE.meta, fontWeight: 800,
                fontVariantNumeric: 'tabular-nums', color: WPBL_ACCENT, lineHeight: 1.4,
              }}>
                {t.k}
              </Typography>
              <Box sx={{ minWidth: 0 }}>
                <Typography component="dd" sx={{ m: 0, fontSize: TYPE_SCALE.meta, fontWeight: 600, lineHeight: 1.4 }}>
                  {/* ERA is the one whose meaning is incomplete without its denominator, and
                      it follows the reader's own setting here exactly as it does in a tooltip. */}
                  {statFull(t.k, basis)}
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

      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', lineHeight: 1.5 }}>
        Not affiliated with the WPBL. Where a rule is not published by the league, this page says
        so and shows how it was worked out.
      </Typography>
    </Box>
  )
}
