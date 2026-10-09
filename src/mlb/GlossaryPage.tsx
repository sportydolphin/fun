// /mlb/glossary: the rules a reader asks about, and what every abbreviation in the section means.
//
// WPBL's page with MLB's data. The frame (src/ui/StandalonePage) and both lists (src/ui/Glossary)
// are shared, so the two reference pages cannot drift into two designs; what differs is only what
// the leagues differ on. The tooltips stay the way a reader learns a term: this is the crawlable,
// linkable copy, for a search result or an answer in a chat to point at.
import { Box, Typography } from '@mui/material'
import StandalonePage from '../ui/StandalonePage'
import { GlossaryRules, GlossaryTerms } from '../ui/Glossary'
import { TYPE_SCALE } from '../ui/card'
import { MLB_GLOSSARY_GROUPS, MLB_RULES, mlbGlossaryTerm } from './statGlossary'
import { ACCENT_TEXT } from './constants'

// Every rule here is MLB's own, so none is badged. The parameter is there for WPBL's.
const noBadge = () => null

export default function MlbGlossaryPage() {
  return (
    <StandalonePage
      title="MLB rules & stats glossary"
      standfirst={<>
        How a pitcher earns a win or a save, who qualifies for a batting title, and what every
        abbreviation in the MLB section means, from AVG to xwOBA.
      </>}
      back={{ href: '/mlb', label: 'Back to MLB' }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <GlossaryRules title="The rules people ask about" rules={MLB_RULES} badge={noBadge} />
        <GlossaryTerms groups={MLB_GLOSSARY_GROUPS} term={mlbGlossaryTerm} accent={ACCENT_TEXT} />
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled', lineHeight: 1.5 }}>
          Not affiliated with Major League Baseball. Advanced numbers (WAR, wRC+, the expected stats)
          are as MLB&rsquo;s own Stats API publishes them.
        </Typography>
      </Box>
    </StandalonePage>
  )
}
