import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import WpblPage from './WpblPage'
import { ChipRow, FilterChip } from './FilterChips'
import { AuthorByline, ReadingCard, ReadingLead } from './Reading'
import { FLAT_CARDS_DARK } from './ui'
import { fetchWpblArticles, fetchWpblTeams, getCachedWpblArticles, getCachedWpblTeams } from './api'
import { SOURCES, sourceOf } from './derive/articles'
import type { WpblArticle, WpblTeam } from './types'
import { track, trackImpression, EVENTS } from '../lib/analytics'

// /wpbl/reading: everything two independent writers have written about the league, newest first:
// mary mustard's towards a more perfect game and D.A. Espinoza's The Rising Fastball, both featured
// with permission.
//
// ONE FEED WITH A WRITER FILTER, not a section per writer. A reader comes here for the league, and
// the newest post is the answer to "anything new" whoever wrote it; the writer chips are for the
// reader who has a favourite. Every card names its writer (ReadingCard), so the merge never blurs
// whose words are whose.
//
// WHY A PAGE AND NOT A SHELF. The writing used to be one of three segments in a collapsible card
// on the league page, itself one entry in the More menu, behind a rail that stopped at twelve with
// the rest in a modal that had no URL. Four steps to the fourteenth post, none of it shareable or
// indexable. A page gives the writing an address, a list that shows every post, and a club filter,
// which is the one way a reader actually narrows 27 headlines.
//
// JUST READING. Highlights live on the season recap and on each game, and the Commons archive is a
// category of the gallery: this page is the writers' work and nothing else, which is also what
// keeps it from reading as this site's own editorial.
//
// EVERY ROW LEAVES THE SITE. See the note at the top of Reading.tsx: no in-app reader, by design.

export default function ReadingPage() {
  const [articles, setArticles] = useState<WpblArticle[] | null>(() => getCachedWpblArticles())
  const [teams, setTeams] = useState<WpblTeam[]>(() => getCachedWpblTeams() ?? [])
  const [club, setClub] = useState<string>('all')
  const [writer, setWriter] = useState<string>('all')
  const pickWriter = (key: string) => { setWriter(key); track(EVENTS.WPBL_PAGE_CONTROL, { page: 'reading', control: 'writer', value: key }) }
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
  // The writers with anything here, in SOURCES order, each with a count.
  const writers = useMemo(() => {
    const list = articles ?? []
    return SOURCES
      .map(src => ({ src, count: list.filter(a => sourceOf(a.source).key === src.key).length }))
      .filter(w => w.count > 0)
  }, [articles])
  // The writer filter applies first, so the club chips count what is left to narrow.
  const byWriter = useMemo(() => {
    const list = articles ?? []
    return writer === 'all' ? list : list.filter(a => sourceOf(a.source).key === writer)
  }, [articles, writer])
  const clubChips = useMemo(() => {
    const list = byWriter
    return teams
      .map(t => ({ team: t, count: list.filter(a => a.team_ids.includes(t.id)).length }))
      .filter(c => c.count > 0)
  }, [byWriter, teams])
  // A club picked under one writer may have nothing under the next, and then its chip is gone
  // and the list is empty with no way to see why. Fall back to every club rather than show that.
  const activeClub = club !== 'all' && clubChips.some(c => c.team.id === club) ? club : 'all'
  const rows = useMemo(
    () => activeClub === 'all' ? byWriter : byWriter.filter(a => a.team_ids.includes(activeClub)),
    [byWriter, activeClub])
  // The newest post leads, drawn large; the rest fall under a heading per month. Sixty-odd
  // headlines in one undivided run gave a reader nothing to find their place by.
  const lead = rows[0]
  const months = useMemo(() => {
    const out: { key: string; label: string; items: WpblArticle[] }[] = []
    for (const a of rows.slice(1)) {
      const d = new Date(a.published_at)
      const key = Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${d.getMonth()}`
      if (out.length === 0 || out[out.length - 1].key !== key) {
        out.push({ key, label: key ? d.toLocaleDateString([], { month: 'long', year: 'numeric' }) : 'Undated', items: [] })
      }
      out[out.length - 1].items.push(a)
    }
    return out
  }, [rows])

  return (
    // Wider than the section's reading column: the posts lay out as a grid of cards on a
    // desktop, and at 56rem that grid is two narrow columns with the covers shrunk to stamps.
    <WpblPage title="Reading" maxWidth="72rem" standfirst={<>
      Everything two independent writers have written about the league, newest first:{' '}
      {SOURCES.map((src, i) => (
        <span key={src.key}>{i > 0 && ' and '}{src.authorName}&rsquo;s <em>{src.publicationName}</em></span>
      ))}. Each post opens on the writer&rsquo;s own Substack.
    </>}>
      <Box sx={FLAT_CARDS_DARK}>
        {articles == null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
        ) : articles.length === 0 ? (
          <Typography sx={{ color: 'text.secondary', py: 4 }}>No posts yet.</Typography>
        ) : (
          <>
            {/* The credits lead: on this page the writers are the point, not a footnote under a
                rail. Side by side where there is room, stacked on a phone. */}
            <Box sx={{ mb: 2, display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: `repeat(${writers.length}, 1fr)` } }}>
              {writers.map(w => <AuthorByline key={w.src.key} source={w.src} from="page" compact />)}
            </Box>
            {writers.length > 1 && (
              <ChipRow mb={1}>
                <FilterChip label={`Both writers (${articles.length})`} active={writer === 'all'} onClick={() => pickWriter('all')} />
                {writers.map(w => (
                  <FilterChip key={w.src.key} label={`${w.src.authorName} (${w.count})`}
                    active={writer === w.src.key} onClick={() => pickWriter(w.src.key)} />
                ))}
              </ChipRow>
            )}
            {clubChips.length > 1 && (
              <ChipRow mb={1.75}>
                <FilterChip label={`All clubs (${byWriter.length})`} active={activeClub === 'all'} onClick={() => pickClub('all')} />
                {clubChips.map(c => (
                  <FilterChip key={c.team.id} label={`${c.team.name} (${c.count})`}
                    active={activeClub === c.team.id} onClick={() => pickClub(c.team.id)} />
                ))}
              </ChipRow>
            )}
            {lead && <ReadingLead article={lead} teamById={teamById} from="page" />}
            {months.map(m => (
              <Box component="section" key={m.key} sx={{ mt: 2.5 }}>
                <Typography component="h2" sx={{
                  fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6,
                  color: 'text.secondary', mb: 1,
                }}>
                  {m.label}
                </Typography>
                <Box sx={{
                  display: 'grid', gap: { xs: 1, sm: 1.5 },
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
                }}>
                  {m.items.map(a => <ReadingCard key={a.post_id} article={a} teamById={teamById} from="page" />)}
                </Box>
              </Box>
            ))}
          </>
        )}
      </Box>
    </WpblPage>
  )
}
