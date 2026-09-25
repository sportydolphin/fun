import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import WpblPage from './WpblPage'
import { ChipRow, FilterChip } from './FilterChips'
import { AuthorByline, ReadingRow } from './Reading'
import { FLAT_CARDS_DARK } from './ui'
import { fetchWpblArticles, fetchWpblTeams, getCachedWpblArticles, getCachedWpblTeams } from './api'
import { AUTHOR_NAME } from './derive/articles'
import type { WpblArticle, WpblTeam } from './types'
import { track, trackImpression, EVENTS } from '../lib/analytics'

// /wpbl/reading: every post mary mustard has written about the league, newest first.
//
// WHY A PAGE AND NOT A SHELF. The writing used to be one of three segments in a collapsible card
// on the league page, itself one entry in the More menu, behind a rail that stopped at twelve with
// the rest in a modal that had no URL. Four steps to the fourteenth post, none of it shareable or
// indexable. A page gives the writing an address, a list that shows every post, and a club filter,
// which is the one way a reader actually narrows 27 headlines.
//
// JUST READING. Highlights live on the season recap and on each game, and the Commons archive is a
// category of the gallery: this page is one writer's work and nothing else, which is also what
// keeps it from reading as this site's own editorial.
//
// EVERY ROW LEAVES THE SITE. See the note at the top of Reading.tsx: no in-app reader, by design.

export default function ReadingPage() {
  const [articles, setArticles] = useState<WpblArticle[] | null>(() => getCachedWpblArticles())
  const [teams, setTeams] = useState<WpblTeam[]>(() => getCachedWpblTeams() ?? [])
  const [club, setClub] = useState<string>('all')
  const pickClub = (id: string) => { setClub(id); track(EVENTS.WPBL_PAGE_CONTROL, { page: 'reading', control: 'club', value: id }) }

  useEffect(() => {
    let live = true
    fetchWpblArticles().then(a => { if (live) setArticles(a) }).catch(() => { if (live) setArticles(a => a ?? []) })
    fetchWpblTeams().then(t => { if (live) setTeams(t) }).catch(() => { /* rows render without badges */ })
    return () => { live = false }
  }, [])

  // Reuses the shelf's impression event, so the page's reach reads against the shelf it replaced.
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current || !articles || articles.length === 0) return
    shown.current = true
    trackImpression(EVENTS.WPBL_READING_SHOWN, { count: articles.length, from: 'page' }, 'page')
  }, [articles])

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  // Only clubs somebody has written about, in the order the feed lists the clubs, each with its
  // count. A post can be about two clubs (a series preview), so the counts can sum past the total.
  const clubChips = useMemo(() => {
    const list = articles ?? []
    return teams
      .map(t => ({ team: t, count: list.filter(a => a.team_ids.includes(t.id)).length }))
      .filter(c => c.count > 0)
  }, [articles, teams])
  const rows = useMemo(() => {
    const list = articles ?? []
    return club === 'all' ? list : list.filter(a => a.team_ids.includes(club))
  }, [articles, club])

  return (
    <WpblPage title="Reading" standfirst={<>
      Everything {AUTHOR_NAME} has written about the league, newest first. Each post opens on their
      Substack.
    </>}>
      <Box sx={FLAT_CARDS_DARK}>
        {articles == null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
        ) : articles.length === 0 ? (
          <Typography sx={{ color: 'text.secondary', py: 4 }}>No posts yet.</Typography>
        ) : (
          <>
            {/* The credit leads: on this page she is the point, not a footnote under a rail. */}
            <Box sx={{ mb: 2 }}><AuthorByline from="page" /></Box>
            {clubChips.length > 1 && (
              <ChipRow mb={1.75}>
                <FilterChip label={`All (${articles.length})`} active={club === 'all'} onClick={() => pickClub('all')} />
                {clubChips.map(c => (
                  <FilterChip key={c.team.id} label={`${c.team.name} (${c.count})`}
                    active={club === c.team.id} onClick={() => pickClub(c.team.id)} />
                ))}
              </ChipRow>
            )}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {rows.map(a => <ReadingRow key={a.post_id} article={a} teamById={teamById} from="page" />)}
            </Box>
          </>
        )}
      </Box>
    </WpblPage>
  )
}
