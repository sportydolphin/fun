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
import { useCallback } from 'react'
import { Box, Typography } from '@mui/material'
import { STAT_TERMS, WPBL_RULES, statFull, type RuleSource } from './glossary'
import { useEraBasis } from './EraBasisContext'
import { TYPE_SCALE } from './ui'
import { WPBL_ACCENT } from './constants'
import WpblPage from './WpblPage'
import { GlossaryRules, GlossaryTerms } from '../ui/Glossary'

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
    keys: ['AVG', 'OBP', 'SLG', 'OPS', 'wOBA', 'wRC+', 'ISO', 'BABIP', 'PA', 'AB', 'H', '2B', '3B', 'XBH', 'HR', 'R',
      'RBI', 'BB', 'IBB', 'SO', 'K%', 'BB%', 'SB', 'CS', 'SB%', 'TB', 'HBP', 'GDP', 'SF', 'SH'],
  },
  {
    key: 'pitching', label: 'Pitching',
    keys: ['ERA', 'FIP', 'WHIP', 'W-L', 'SV', 'IP', 'ER', 'BF', 'GS', 'K/7', 'K/9', 'HR/7',
      'HR/9', 'K/BB', 'K%', 'BB%', 'K-BB%', 'BABIP', 'WP', 'BK', 'P', 'DEC'],
  },
  {
    key: 'fielding', label: 'Fielding',
    keys: ['FPCT', 'PO', 'A', 'E', 'DP', 'PB', 'SBA', 'G', 'POS', 'OPP'],
  },
]

export default function WpblGlossaryPage() {
  const { basis } = useEraBasis()
  // ERA is the one whose meaning is incomplete without its denominator, and it follows the
  // reader's own setting here exactly as it does in a tooltip.
  const term = useCallback((k: string) => {
    const t = STAT_TERMS[k]
    return t ? { full: statFull(k, basis), plain: t.plain } : null
  }, [basis])

  return (
    <WpblPage
      title="WPBL rules & glossary"
      standfirst={<>
        How the Women&rsquo;s Pro Baseball League works, and what the numbers on a box score mean.
        New to baseball? Start with the rules; the abbreviations underneath are the ones you will
        meet on every page here.
      </>}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <GlossaryRules title="How the league works" rules={WPBL_RULES} badge={s => SOURCE_BADGE[s as RuleSource]} />
        <GlossaryTerms groups={GROUPS} term={term} accent={WPBL_ACCENT} />
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', lineHeight: 1.5 }}>
          Not affiliated with the WPBL. Where a rule is not published by the league, this page says
          so and shows how it was worked out.
        </Typography>
      </Box>
    </WpblPage>
  )
}
