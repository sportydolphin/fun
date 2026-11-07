// /world-cup, /world-cup/<year>, /world-cup/<year>/games/<id> and /world-cup/players/<slug>: every
// Women's Baseball World Cup, an edition, a game and a player. ROADMAP-WOMENS-BASEBALL.md, stage 2.
//
// DRAWN WITH WPBL'S OWN PIECES wherever they are league-neutral (src/ui): the leader cards, the game
// center's box score and play by play, the player card's career tables. A World Cup page should read
// as the same site, and a fix to one of those pieces reaches both. Where WPBL draws a club's logo, a
// World Cup page draws the team's flag (`CountryBadge`, flags.ts).
//
// DEV ONLY UNTIL THE WORLD CUP GOES PUBLIC. App.tsx routes here only under `npm run dev`
// (`WORLD_CUP_ROUTES`), so a production build carries neither this file nor a route to it, and the
// data comes from this machine's own archive through the dev server (vite-plugin-wbsc-dev.mjs).
// Going public is: the files from `npm run wbsc -- --site` committed and served, `fetchSite` (siteFile.ts) reading
// them, the flag in App.tsx removed, and the two `_redirects` lines, routes and seo.ts entries
// every app route needs. A player page whose file says `indexable: false` gets `noindex` and stays
// out of the sitemap.
//
// EVERY PAGE CREDITS WBSC, with a link to its own page for what this one shows.
import { Fragment, useEffect, useState } from 'react'
import { Box, CircularProgress, Typography } from '@mui/material'
import StandalonePage from '../ui/StandalonePage'
import { CARD_BORDER, SectionCard, TYPE_SCALE } from '../ui/card'
import { linkTo, navigate, UNSTYLED_LINK } from '../nav'
import { countryName } from './countries'
import { flagOf } from './flags'
import { InfoDot } from '../ui/InfoDot'
import { ClubBadge } from '../ui/ClubBadge'
import { LEADER_GRID_SX, LeaderCard, PORTRAIT_PX, printedRanks } from '../ui/leaders'
import { BOX_POS_SX, BoxTable, BoxTeamHeading, HalfHeading, PLAY_TEXT_SX, PlayRow } from '../ui/gameCenter'
import { usePhoneLayout } from '../ui/ModalShell'
import { PageTabs } from '../ui/PageTabs'
import { StatLogTable, type StatLogRow } from '../ui/playerCard'
import { outsToIp } from '../league/innings'
import { WorldCupCareerTables } from './WorldCupCareer'
import { WBSC_LEAGUE } from './league'
import { fetchSite } from './siteFile'
import type { Medal, PersonGameLine, WorldCupPersonFile } from './wbsc/personFile'
import type { InternationalEvent } from './wbsc/international'
import type { EditionLeaders, WpblInField } from './wbsc/editionLeaders'
import type { WorldCupGameFile } from './wbsc/gameFile'
import type { TeamRoster } from './wbsc/editionLeaders'
import { editionSlugOf, editionTitle, type Medals, type StandingRow, type WorldCupEdition, type WorldCupGame, type WorldCupGroup, type WorldCupIndexEntry, type WorldCupStage } from './wbsc/editions'


function useSiteFile<T>(file: string): { file: string; data: T | null } | null {
  const [read, setRead] = useState<{ file: string; data: T | null } | null>(null)
  useEffect(() => {
    let alive = true
    void fetchSite<T>(file).then(data => { if (alive) setRead({ file, data }) })
    return () => { alive = false }
  }, [file])
  return read?.file === file ? read : null
}

const years = (ys: number[]) => (ys.length > 1 ? `${ys[0]}–${String(ys[ys.length - 1]).slice(2)}` : String(ys[0]))

/** 'https://www.wbsc.org/en/events/2023-ix-womens-baseball-world-cup-group-a/schedule-and-results'
 *  reads '2023 Group A', the Finals '2024 Finals', a one-event edition its year. 2010 is IBAF's
 *  stats pages in the Wayback Machine (src/intl/wbsc/ibaf.ts), which read '2010'. */
function sourceLabel(url: string): string {
  if (isIbaf(url)) return '2010'
  const key = url.split('/events/')[1]?.split('/')[0] ?? ''
  const tail = (key.split('world-cup')[1] ?? '').replace(/^-/, '').replace('group-stage-', '')
  const words = tail.split('-').filter(Boolean).map(w => (w.length === 1 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
  return [key.slice(0, 4), ...words].join(' ')
}

const isIbaf = (url: string) => url.includes('ibaf.prod.kgroup.eu')

/** Who published a source: IBAF ran the World Cup until 2013, when it merged into WBSC. */
const publisher = (url: string) => (isIbaf(url) ? 'IBAF' : 'WBSC')

/** "Source: WBSC 2012 2014", or "IBAF 2010" before it: each publisher named once, before its links. */
function SourceLinks({ links }: { links: { key: string; url: string }[] }) {
  return (
    <>
      Source:{links.map((l, i) => (
        <Fragment key={l.key}>
          {publisher(l.url) !== publisher(links[i - 1]?.url ?? '') && ` ${publisher(l.url)}`}
          <Box component="a" href={l.url} target="_blank" rel="noopener" sx={{ color: 'inherit', ml: 1 }}>
            {sourceLabel(l.url)}
          </Box>
        </Fragment>
      ))}
    </>
  )
}

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function MedalLine({ medals }: { medals: Medals }) {
  const parts: [string, string][] = [['Gold', medals.gold], ['Silver', medals.silver]]
  if (medals.bronze) parts.push(['Bronze', medals.bronze])
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5 }}>
      {parts.map(([label, team]) => (
        <Typography key={label} component="div" sx={{ fontSize: TYPE_SCALE.body, display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box component="span" sx={{ color: 'text.secondary' }}>{label}</Box>
          <CountryBadge team={team} size={18} />
          {countryName(team)}
        </Typography>
      ))}
    </Box>
  )
}

/** A team's mark: its flag filling a round badge, as a club's logo fills WPBL's. A team with no flag
 *  (flags.ts says why Chinese Taipei has none) shows its IOC code on a neutral fill instead. Never a
 *  federation's or WBSC's own mark. */
function CountryBadge({ team, size }: { team: string; size: number }) {
  return <ClubBadge size={size} src={flagOf(team)} fit="cover" alt={team} bg="#4b5563" ring={t => t.palette.outline} logoScale={0.6} decorative />
}

/** A team's flag and name, inline. A div, since the badge is one (and its fallback a paragraph). */
function TeamName({ team }: { team: string }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6, verticalAlign: 'middle' }}>
      <CountryBadge team={team} size={16} />
      {countryName(team)}
    </Box>
  )
}

/** The rule color a club's own color takes on WPBL's box score: one neutral for every country. */
const ACCENT = '#6b7280'

function Loading() {
  return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
}

function NoData() {
  return <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', py: 4 }}>No data</Typography>
}

function Index() {
  const read = useSiteFile<WorldCupIndexEntry[]>('world-cup.json')
  return (
    <StandalonePage title="World Cup" back={{ href: '/wpbl', label: 'Back to WPBL' }}>
      {!read ? <Loading /> : !read.data?.length ? <NoData /> : (
        <SectionCard title="Editions">
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {read.data.map((e, i) => (
              <Box key={e.slug} {...linkTo(`/world-cup/${e.slug}`)} sx={{
                ...UNSTYLED_LINK, display: 'block', py: 1.25,
                borderTop: i ? '1px solid' : 'none', borderColor: 'divider',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700 }}>{e.title}</Typography>
                  <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
                    {[years(e.years), e.hosts.join(' · '), `${e.teams} teams`].join(' · ')}
                  </Typography>
                </Box>
                <Box sx={{ mt: 0.5 }}>
                  {e.medals ? <MedalLine medals={e.medals} /> : (
                    <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>In progress</Typography>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        </SectionCard>
      )}
      <Box sx={{ mt: 2, px: 0.5, pt: 0.5, borderTop: '1px solid', borderColor: CARD_BORDER }}>
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
          Sources: WBSC, IBAF · Flags: <Box component="a" href="https://github.com/lipis/flag-icons" target="_blank" rel="noopener" sx={{ color: 'inherit' }}>flag-icons</Box> (MIT)
        </Typography>
      </Box>
    </StandalonePage>
  )
}

const NUM = { textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums', width: '2.5rem' }

/** A team's name as a link to its page at this edition. */
function TeamLink({ team, slug }: { team: string; slug: string }) {
  return (
    <Box {...linkTo(teamPath(slug, team))} sx={{ ...UNSTYLED_LINK, '&:hover': { textDecoration: 'underline' } }}>
      <TeamName team={team} />
    </Box>
  )
}

/** WBSC's final order, as a numbered list of teams. */
const MEDALS = ['Gold', 'Silver', 'Bronze'] as const

/** The first three are the medalists (editions.ts checks it), so they carry the medal by name in its
 *  color: the medal line above the list said the same three things again until Nov 2026. */
function Placings({ teams, slug }: { teams: string[]; slug: string }) {
  return (
    <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, fontSize: TYPE_SCALE.body }}>
      {teams.map((t, i) => (
        <Box component="li" key={t} sx={{
          display: 'grid', gridTemplateColumns: '1.75rem 1fr auto', alignItems: 'center', py: 0.75,
          borderTop: i ? '1px solid' : 'none', borderColor: 'divider',
        }}>
          <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</Box>
          <Box><TeamLink team={t} slug={slug} /></Box>
          {i < 3 && (
            <Box component="span" sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: `var(--wpbl-medal-${i + 1})` }}>{MEDALS[i]}</Box>
          )}
        </Box>
      ))}
    </Box>
  )
}

function Standings({ rows, slug }: { rows: StandingRow[]; slug: string }) {
  return (
    <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: TYPE_SCALE.body, mb: 1.5 }}>
      <thead>
        <Box component="tr" sx={{ color: 'text.secondary', fontSize: TYPE_SCALE.meta }}>
          <Box component="th" sx={{ textAlign: 'left', fontWeight: 600, pb: 0.5 }}>Team</Box>
          {['W', 'L', 'RS', 'RA'].map(h => <Box component="th" key={h} sx={{ ...NUM, fontWeight: 600, pb: 0.5 }}>{h}</Box>)}
        </Box>
      </thead>
      <tbody>
        {rows.map(r => (
          <Box component="tr" key={r.team} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
            <Box component="td" sx={{ py: 0.75 }}><TeamLink team={r.team} slug={slug} /></Box>
            {[r.w, r.l, r.rs, r.ra].map((v, i) => <Box component="td" key={i} sx={NUM}>{v}</Box>)}
          </Box>
        ))}
      </tbody>
    </Box>
  )
}

function Result({ g, slug, withYear = false }: { g: WorldCupGame; slug: string; withYear?: boolean }) {
  const awayWon = g.away_score > g.home_score
  return (
    // A forfeit has no box score, so no page to open.
    <Box {...(g.forfeit ? {} : linkTo(`/world-cup/${slug}/games/${g.wbsc_game_id}`))} sx={{
      ...UNSTYLED_LINK, display: 'grid',
      // The teams column stops at a phone's width, so on a desktop the score stays beside the name.
      gridTemplateColumns: `${withYear ? 5.5 : 3.5}rem minmax(0, 14rem) minmax(3.5rem, 1fr)`, alignItems: 'center', columnGap: 1.5,
      py: 0.75, borderTop: '1px solid', borderColor: 'divider', fontSize: TYPE_SCALE.body,
    }}>
      <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{shortDate(g.date)}{withYear ? `, ${g.date.slice(0, 4)}` : ''}</Typography>
      {/* Away over home, scores in their own column, as a scoreboard reads. On one line ("Hong Kong,
          China 9 @ Korea 8") a long name wrapped mid-row on a phone while the next row did not, so
          no two rows lined up. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 1.5, rowGap: 0.25, alignItems: 'center', minWidth: 0 }}>
        {([[g.away, g.away_score, awayWon], [g.home, g.home_score, !awayWon]] as const).map(([team, score, won]) => (
          <Fragment key={team}>
            <Box sx={{ fontWeight: won ? 700 : 400, minWidth: 0 }}><TeamName team={team} /></Box>
            <Box sx={{ fontWeight: won ? 700 : 400, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{score}</Box>
          </Fragment>
        ))}
      </Box>
      <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', textAlign: 'right' }}>
        {g.forfeit ? 'Forfeit' : g.innings === 7 ? 'Final' : `F/${g.innings}`}
      </Typography>
    </Box>
  )
}

function Group({ group, standings, slug }: { group: WorldCupGroup; standings: boolean; slug: string }) {
  return (
    <Box sx={{ '& + &': { mt: 2.5 } }}>
      {group.label && (
        <Typography component="h3" sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, mb: 1 }}>{group.label}</Typography>
      )}
      {standings && <Standings rows={group.standings} slug={slug} />}
      <Box>{group.games.map(g => <Result key={g.id} g={g} slug={slug} />)}</Box>
    </Box>
  )
}

const fmtValue = (stat: string, v: number) =>
  stat === 'AVG' || stat === 'OPS' ? (v >= 1 ? v.toFixed(3) : v.toFixed(3).replace(/^0/, ''))
    : stat === 'ERA' ? v.toFixed(2) : String(v)

function PlayerName({ name, path }: { name: string; path: string | null }) {
  return path
    ? <Box {...linkTo(path)} sx={{ ...UNSTYLED_LINK, fontWeight: 600, '&:hover': { textDecoration: 'underline' } }}>{name}</Box>
    : <Box component="span">{name}</Box>
}

const BOARD_TITLE: Record<string, string> = {
  AVG: 'Batting Average', OPS: 'OPS', HR: 'Home Runs', RBI: 'RBIs', ERA: 'ERA', SO: 'Strikeouts', W: 'Wins',
}

function Leaders({ leaders }: { leaders: EditionLeaders }) {
  const [hover, setHover] = useState<string | null>(null)
  const boards = [...leaders.batting, ...leaders.pitching].filter(b => b.rows.length)
  if (!boards.length) return <NoData />
  return (
    <Box sx={LEADER_GRID_SX} onMouseLeave={() => setHover(null)}>
      {boards.map(b => {
        const texts = b.rows.map(r => fmtValue(b.stat, r.value))
        const ranks = printedRanks(texts)
        return (
          <LeaderCard key={b.stat} title={BOARD_TITLE[b.stat] ?? b.stat} hoverKey={hover} onHover={setHover}
            items={b.rows.map((r, i) => ({
              key: r.path ?? `${r.name}-${r.team}`, rank: ranks[i].rank, tied: ranks[i].tied, name: r.name, value: texts[i],
              portrait: <CountryBadge team={r.team} size={PORTRAIT_PX} />,
              linkProps: r.path ? linkTo(r.path) : undefined,
            }))} />
        )
      })}
    </Box>
  )
}

function WpblPlayers({ teams }: { teams: WpblInField[] }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {teams.map(t => (
        <Box key={t.team}>
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mb: 0.25 }}>
            {countryName(t.team)} · {t.players.length}
          </Typography>
          <Typography sx={{ fontSize: TYPE_SCALE.body, lineHeight: 1.6 }}>
            {t.players.map((p, i) => (
              <Box component="span" key={p.path}>
                {i > 0 && <Box component="span" sx={{ color: 'text.secondary' }}>{' · '}</Box>}
                <PlayerName name={p.name} path={p.path} />
              </Box>
            ))}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

/** An edition's pages, each its own address so a link (or a crawler) lands on the one it means. The
 *  edition was one page until Nov 2026 and ran to eight phone screens, with the medal games last. */
export type EditionTab = 'overview' | 'games' | 'leaders' | 'teams'
const EDITION_TABS: { value: EditionTab; label: string }[] = [
  { value: 'overview', label: 'Overview' }, { value: 'games', label: 'Games' },
  { value: 'leaders', label: 'Leaders' }, { value: 'teams', label: 'Teams' },
]
const editionPath = (slug: string, tab: EditionTab) => (tab === 'overview' ? `/world-cup/${slug}` : `/world-cup/${slug}/${tab}`)
/** A team's code in an address is lower case, as every other path on the site is. */
const teamPath = (slug: string | null, team: string) =>
  slug ? `/world-cup/${slug}/teams/${team.toLowerCase()}` : `/world-cup/teams/${team.toLowerCase()}`

/** Every game of the edition, in the order played, forfeits included (WBSC's standings count them). */
const allGames = (e: WorldCupEdition): WorldCupGame[] =>
  e.stages.flatMap(s => s.groups.flatMap(g => g.games)).sort((a, b) => cmp(a.date, b.date) || a.wbsc_game_id - b.wbsc_game_id)

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function record(games: WorldCupGame[], team: string) {
  let w = 0, l = 0, rs = 0, ra = 0
  for (const g of games) {
    if (g.away !== team && g.home !== team) continue
    const us = g.away === team ? g.away_score : g.home_score
    const them = g.away === team ? g.home_score : g.away_score
    if (us > them) w++
    else l++
    rs += us; ra += them
  }
  return { w, l, rs, ra }
}

/** A stage's heading, with its year when the edition spans two: the 2024 World Cup's group stage was
 *  played in 2023, and its dates alone read as if it came a week before the Finals. */
function stageTitle(e: WorldCupEdition, s: WorldCupStage): string {
  const first = s.groups[0]?.games[0]?.date
  return e.years.length > 1 && first ? `${s.label} · ${first.slice(0, 4)}` : s.label
}

function SourceLine({ urls }: { urls: string[] }) {
  return (
    <Box sx={{ px: 0.5, pt: 0.5, borderTop: '1px solid', borderColor: CARD_BORDER }}>
      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
        <SourceLinks links={urls.map(u => ({ key: u, url: u }))} />
      </Typography>
    </Box>
  )
}

function Overview({ e }: { e: WorldCupEdition }) {
  const groupStages = e.stages.filter(s => s.kind === 'round-robin')
  return (
    <>
      <SectionCard title="Summary">
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mb: 1 }}>
          {[years(e.years), e.hosts.join(' · '), `${e.teams.length} teams`].join(' · ')}
        </Typography>
        {e.placings.length > 0 ? <Placings teams={e.placings} slug={e.slug} />
          : e.medals ? <MedalLine medals={e.medals} /> : (
            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>In progress</Typography>
          )}
      </SectionCard>
      {groupStages.map(s => (
        <SectionCard key={s.label} title={stageTitle(e, s)}>
          {s.groups.map((g, i) => (
            <Box key={g.label ?? i} sx={{ '& + &': { mt: 2.5 } }}>
              {g.label && <Typography component="h3" sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, mb: 1 }}>{g.label}</Typography>}
              <Standings rows={g.standings} slug={e.slug} />
            </Box>
          ))}
        </SectionCard>
      ))}
      {e.wpbl.length > 0 && (
        <SectionCard title="WPBL players">
          <WpblPlayers teams={e.wpbl} />
        </SectionCard>
      )}
    </>
  )
}

/** Newest first: the medal games are what a reader opens the page for, and they come last in time. */
function Games({ e }: { e: WorldCupEdition }) {
  return (
    <>
      {[...e.stages].reverse().map(s => (
        <SectionCard key={s.label} title={stageTitle(e, s)}>
          {s.groups.map((g, i) => <Group key={g.label ?? i} group={g} standings={false} slug={e.slug} />)}
        </SectionCard>
      ))}
    </>
  )
}

/** Placed teams in WBSC's order, then the rest by name (2024 ranks only its six finalists). */
function Teams({ e }: { e: WorldCupEdition }) {
  const games = allGames(e)
  const rest = e.teams.filter(t => !e.placings.includes(t)).sort((a, b) => cmp(countryName(a), countryName(b)))
  return (
    <SectionCard title="Teams">
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, fontSize: TYPE_SCALE.body }}>
        {[...e.placings, ...rest].map((t, i) => {
          const r = record(games, t)
          return (
            <Box component="li" key={t} sx={{ borderTop: i ? '1px solid' : 'none', borderColor: 'divider' }}>
              <Box {...linkTo(teamPath(e.slug, t))} sx={{
                ...UNSTYLED_LINK, display: 'grid', gridTemplateColumns: '1.75rem 1fr auto', alignItems: 'center', py: 0.9,
                '&:hover .team-name': { textDecoration: 'underline' },
              }}>
                <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                  {i < e.placings.length ? i + 1 : '—'}
                </Box>
                <Box className="team-name"><TeamName team={t} /></Box>
                <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{r.w}–{r.l}</Box>
              </Box>
            </Box>
          )
        })}
      </Box>
    </SectionCard>
  )
}

function Edition({ slug, tab }: { slug: string; tab: EditionTab }) {
  const read = useSiteFile<WorldCupEdition>(`world-cup-${slug}.json`)
  const e = read?.data
  return (
    <StandalonePage title={editionTitle(slug)} back={{ href: '/world-cup', label: 'World Cup' }}
      trail={[{ href: '/world-cup', label: 'World Cup' }]}>
      <PageTabs value={tab} onChange={() => {}} mb={2}
        options={EDITION_TABS.map(t => ({ ...t, href: editionPath(slug, t.value) }))} />
      {!read ? <Loading /> : !e ? <NoData /> : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {tab === 'overview' && <Overview e={e} />}
          {tab === 'games' && <Games e={e} />}
          {tab === 'leaders' && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                <Typography component="h2" sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 700 }}>Leaders</Typography>
                <InfoDot label="Qualified" text="AVG and OPS: 2.4 plate appearances per team game. ERA: 2.4 outs per team game. ERA is per 7 innings." />
              </Box>
              <Leaders leaders={e.leaders} />
            </Box>
          )}
          {tab === 'teams' && <Teams e={e} />}
          <SourceLine urls={e.sources} />
        </Box>
      )}
    </StandalonePage>
  )
}

const ROSTER_BAT = ['G', 'PA', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'BB', 'SO', 'AVG', 'OBP', 'SLG', 'OPS']
const ROSTER_PIT = ['G', 'GS', 'W-L', 'SV', 'IP', 'H', 'R', 'ER', 'BB', 'SO', 'ERA']
const rate = (v: number | null) => (v == null ? '—' : v.toFixed(3).replace(/^0(?=\.)/, ''))
/** The player column reads as names, not as the dimmed date a game log leads with. */
const PLAYER_LEAD_SX = [{ color: 'text.primary', fontWeight: 600 }]

function playerLead(name: string, path: string | null) {
  return path
    ? <Box {...linkTo(path)} sx={{ ...UNSTYLED_LINK, '&:hover': { textDecoration: 'underline' } }}>{name}</Box>
    : name
}

function RosterTables({ roster }: { roster: TeamRoster }) {
  const batting: StatLogRow[] = roster.batting.map(b => {
    const obp = b.ab + b.bb + b.hbp + b.sf > 0 ? (b.h + b.bb + b.hbp) / (b.ab + b.bb + b.hbp + b.sf) : null
    const slg = b.ab > 0 ? b.tb / b.ab : null
    return {
      lead: [playerLead(b.name, b.path)],
      cells: [b.g, b.pa, b.ab, b.r, b.h, b.doubles, b.triples, b.hr, b.rbi, b.sb, b.bb, b.so,
        rate(b.ab > 0 ? b.h / b.ab : null), rate(obp), rate(slg), rate(obp != null && slg != null ? obp + slg : null)],
    }
  })
  const pitching: StatLogRow[] = roster.pitching.map(p => ({
    lead: [playerLead(p.name, p.path)],
    cells: [p.g, p.gs, `${p.w}-${p.l}`, p.sv, outsToIp(p.outs), p.h, p.r, p.er, p.bb, p.so,
      fmtTwo(p.outs > 0 ? (p.er * WBSC_LEAGUE.regulationInnings * 3) / p.outs : null)],
  }))
  // One card holding both tables, as a player's World Cup card does (WorldCupCareer.tsx).
  return (
    <SectionCard title="Players">
      <StatLogTable title="Batting" leadHeaders={['Player']} statHeaders={ROSTER_BAT} rows={batting} accent={ACCENT}
        noun={['player', 'players']} leadSx={PLAYER_LEAD_SX} />
      {pitching.length > 0 && (
        <Box sx={{ mt: 2.5 }}>
          <StatLogTable title="Pitching" leadHeaders={['Player']} statHeaders={ROSTER_PIT} rows={pitching} accent={ACCENT}
            noun={['pitcher', 'pitchers']} leadSx={PLAYER_LEAD_SX} />
        </Box>
      )}
    </SectionCard>
  )
}

/** One team at one edition: where it finished, every game it played, and its players. */
function EditionTeamPage({ slug, code }: { slug: string; code: string }) {
  const read = useSiteFile<WorldCupEdition>(`world-cup-${slug}.json`)
  const e = read?.data
  const team = code.toUpperCase()
  const known = !!e?.teams.includes(team)
  const roster = e?.rosters?.find(r => r.team === team)
  const games = e ? allGames(e).filter(g => g.away === team || g.home === team) : []
  const r = record(games, team)
  const place = e ? e.placings.indexOf(team) : -1
  const medal = e?.medals ? (['gold', 'silver', 'bronze'] as const).find(m => e.medals![m] === team) : undefined
  return (
    <StandalonePage title={known ? `${countryName(team)} · ${editionTitle(slug)}` : editionTitle(slug)}
      back={{ href: editionPath(slug, 'teams'), label: editionTitle(slug) }}
      trail={[{ href: '/world-cup', label: 'World Cup' }, { href: editionPath(slug, 'teams'), label: editionTitle(slug) }]}>
      {!read ? <Loading /> : !e || !known ? <NoData /> : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <SectionCard title="Summary">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <CountryBadge team={team} size={34} />
              <Typography sx={{ fontSize: TYPE_SCALE.body }}>
                {[
                  medal ? `${medal.charAt(0).toUpperCase()}${medal.slice(1)} medal` : place >= 0 ? `${ordinal(place + 1)} place` : null,
                  `${r.w}–${r.l}`, `${r.rs} RS`, `${r.ra} RA`,
                ].filter(Boolean).join(' · ')}
              </Typography>
            </Box>
            <Box {...linkTo(teamPath(null, team))} sx={{ display: 'inline-block', mt: 1.25, fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
              Every World Cup
            </Box>
          </SectionCard>
          <SectionCard title="Games">
            {/* One list across both years of a two-year edition, so each date says which. */}
            {games.map(g => <Result key={g.id} g={g} slug={slug} withYear={e.years.length > 1} />)}
          </SectionCard>
          {roster && <RosterTables roster={roster} />}
          <SourceLine urls={e.sources} />
        </Box>
      )}
    </StandalonePage>
  )
}

/** One team across every edition, read from the edition files themselves (four small files), so it
 *  needs nothing from the importer that the edition pages do not already have. */
function TeamHistoryPage({ code }: { code: string }) {
  const team = code.toUpperCase()
  const index = useSiteFile<WorldCupIndexEntry[]>('world-cup.json')
  const [editions, setEditions] = useState<{ team: string; list: WorldCupEdition[] } | null>(null)
  useEffect(() => {
    if (!index?.data) return
    let alive = true
    void Promise.all(index.data.map(x => fetchSite<WorldCupEdition>(`world-cup-${x.slug}.json`))).then(list => {
      if (alive) setEditions({ team, list: list.filter((x): x is WorldCupEdition => !!x?.teams.includes(team)) })
    })
    return () => { alive = false }
  }, [index, team])
  const list = editions?.team === team ? editions.list : null
  return (
    <StandalonePage title={countryName(team) || team} back={{ href: '/world-cup', label: 'World Cup' }}
      trail={[{ href: '/world-cup', label: 'World Cup' }]}>
      {!index || (index.data && !list) ? <Loading /> : !list?.length ? <NoData /> : (
        <SectionCard title="World Cups">
          <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, fontSize: TYPE_SCALE.body }}>
            {list.map((e, i) => {
              const r = record(allGames(e), team)
              const place = e.placings.indexOf(team)
              const medal = e.medals ? (['gold', 'silver', 'bronze'] as const).find(m => e.medals![m] === team) : undefined
              return (
                <Box component="li" key={e.slug} sx={{ borderTop: i ? '1px solid' : 'none', borderColor: 'divider' }}>
                  <Box {...linkTo(teamPath(e.slug, team))} sx={{
                    ...UNSTYLED_LINK, display: 'grid', gridTemplateColumns: '1fr auto auto', columnGap: 2, alignItems: 'center', py: 0.9,
                    '&:hover .edition-name': { textDecoration: 'underline' },
                  }}>
                    <Box className="edition-name" sx={{ fontWeight: 600 }}>{e.title}</Box>
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      {medal ? `${medal.charAt(0).toUpperCase()}${medal.slice(1)}` : place >= 0 ? ordinal(place + 1) : '—'}
                    </Box>
                    <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', minWidth: '2.5rem', textAlign: 'right' }}>
                      {r.w}–{r.l}
                    </Box>
                  </Box>
                </Box>
              )
            })}
          </Box>
        </SectionCard>
      )}
    </StandalonePage>
  )
}

const BAT_COLS = [
  { key: 'ab', label: 'AB' }, { key: 'r', label: 'R' }, { key: 'h', label: 'H', bold: true },
  { key: 'rbi', label: 'RBI' }, { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' },
  { key: 'hr', label: 'HR' }, { key: 'doubles', label: '2B' }, { key: 'sb', label: 'SB' },
] as const
const PIT_COLS = [
  { key: 'ip', label: 'IP', bold: true, w: 32 }, { key: 'h', label: 'H' }, { key: 'r', label: 'R' },
  { key: 'er', label: 'ER' }, { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' }, { key: 'hr', label: 'HR' },
]

function TeamBox({ g, side, dense }: { g: WorldCupGameFile; side: 'away' | 'home'; dense: boolean }) {
  const bat = g.batting[side]
  const pit = g.pitching[side]
  const sum = (k: typeof BAT_COLS[number]['key']) => bat.reduce((n, b) => n + (b[k] ?? 0), 0)
  const pitSum = (k: 'h' | 'r' | 'er' | 'bb' | 'so' | 'hr') => pit.reduce((n, p) => n + (p[k] ?? 0), 0)
  return (
    <Box>
      <BoxTeamHeading badge={<CountryBadge team={g[side]} size={24} />} name={countryName(g[side])} color={ACCENT} />
      {bat.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <BoxTable head="Batting" dense={dense} rule={ACCENT} hoverColor={ACCENT}
            cols={BAT_COLS.map(c => ({ ...c }))}
            rows={bat.map((b, i) => ({
              key: i, name: b.name, isSub: b.sub,
              nameProps: b.path ? linkTo(b.path) as Record<string, unknown> : undefined,
              suffix: b.pos ? <Typography component="span" sx={BOX_POS_SX}>{b.pos}</Typography> : null,
              cells: BAT_COLS.map(c => b[c.key] ?? 0),
            }))}
            totals={BAT_COLS.map(c => sum(c.key))} />
        </Box>
      )}
      {pit.length > 0 && (
        <BoxTable head="Pitching" dense={dense} rule={ACCENT} hoverColor={ACCENT}
          cols={PIT_COLS}
          rows={pit.map((p, i) => ({
            key: i, name: p.name,
            nameProps: p.path ? linkTo(p.path) as Record<string, unknown> : undefined,
            suffix: p.decision ? <Typography component="span" sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 700, lineHeight: 1 }}>({p.decision})</Typography> : null,
            cells: [outsToIp(p.outs), p.h, p.r, p.er, p.bb, p.so, p.hr ?? 0],
          }))}
          totals={[outsToIp(pit.reduce((n, p) => n + p.outs, 0)), pitSum('h'), pitSum('r'), pitSum('er'), pitSum('bb'), pitSum('so'), pitSum('hr')]} />
      )}
    </Box>
  )
}

function PlayByPlay({ g }: { g: WorldCupGameFile }) {
  const [closed, setClosed] = useState<Set<string>>(new Set())
  let away = 0, home = 0
  return (
    <Box>
      {g.halves.map(h => {
        const key = `${h.inning}${h.half}`
        const runs = h.plays.reduce((n, p) => n + p.runs, 0)
        if (h.half === 'top') away += runs
        else home += runs
        const open = !closed.has(key)
        const label = `${h.half === 'top' ? 'Top' : 'Bottom'} ${ordinal(h.inning)} · ${h.team}`
        return (
          <Box key={key}>
            <HalfHeading open={open} label={label} runs={runs} awayTo={away} homeTo={home}
              badge={<CountryBadge team={h.team} size={18} />}
              scoreLabel={`${countryName(g.away)} ${away}, ${countryName(g.home)} ${home} after this half-inning`}
              onToggle={() => setClosed(c => { const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n })} />
            {open && h.plays.map((p, i) => (
              <PlayRow key={i} scored={p.runs > 0}>
                <Typography sx={PLAY_TEXT_SX}>{p.text}</Typography>
              </PlayRow>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}

type Line = WorldCupGameFile['away_line']

function LineScore({ g }: { g: WorldCupGameFile }) {
  const n = Math.max(g.away_line.length, g.home_line.length, g.innings)
  const cols = Array.from({ length: n }, (_, i) => i + 1)
  // A half the home side never batted is -1 in WBSC's line (game.ts), drawn as the box score's x.
  const runs = (line: Line, i: number) => {
    const e = line.find(x => x.inning === i)
    return e == null || e.runs < 0 ? 'x' : e.runs
  }
  const row = (team: string, line: Line, r: number, h: number, e: number) => (
    <Box component="tr" sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
      <Box component="td" sx={{ py: 0.6, pr: 1, fontWeight: 600 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}><CountryBadge team={team} size={18} />{team}</Box>
      </Box>
      {cols.map(i => <Box component="td" key={i} sx={{ ...NUM, width: '1.5rem' }}>{runs(line, i)}</Box>)}
      {[r, h, e].map((v, i) => <Box component="td" key={`t${i}`} sx={{ ...NUM, width: '1.75rem', fontWeight: i ? 400 : 700 }}>{v}</Box>)}
    </Box>
  )
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: TYPE_SCALE.body }}>
        <thead>
          <Box component="tr" sx={{ color: 'text.secondary', fontSize: TYPE_SCALE.meta }}>
            <Box component="th"><Box component="span" sx={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>Team</Box></Box>
            {cols.map(i => <Box component="th" key={i} sx={{ ...NUM, width: '1.5rem', fontWeight: 600 }}>{i}</Box>)}
            {['R', 'H', 'E'].map(h => <Box component="th" key={h} sx={{ ...NUM, width: '1.75rem', fontWeight: 600 }}>{h}</Box>)}
          </Box>
        </thead>
        <tbody>
          {row(g.away, g.away_line, g.away_score, g.away_hits, g.away_errors)}
          {row(g.home, g.home_line, g.home_score, g.home_hits, g.home_errors)}
        </tbody>
      </Box>
    </Box>
  )
}

function ordinal(n: number): string {
  return `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`
}

function NeighborGame({ g, slug, label, alignEnd }: { g: WorldCupGame; slug: string; label: string; alignEnd?: boolean }) {
  return (
    <Box {...linkTo(`/world-cup/${slug}/games/${g.wbsc_game_id}`)} sx={{
      ...UNSTYLED_LINK, display: 'flex', flexDirection: 'column', alignItems: alignEnd ? 'flex-end' : 'flex-start', gap: 0.5,
      p: 1.5, border: '1px solid', borderColor: 'outline', borderRadius: 2, minWidth: 0,
      '&:hover': { borderColor: 'text.secondary' },
    }}>
      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{alignEnd ? `${shortDate(g.date)} · ${label} ›` : `‹ ${label} · ${shortDate(g.date)}`}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: TYPE_SCALE.body, fontWeight: 600, flexWrap: 'wrap', justifyContent: alignEnd ? 'flex-end' : 'flex-start' }}>
        <CountryBadge team={g.away} size={16} />{g.away} {g.away_score}
        <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>@</Box>
        <CountryBadge team={g.home} size={16} />{g.home} {g.home_score}
      </Box>
    </Box>
  )
}

/** A game's round as a reader names it: which medal it decided, else its group ("Group A") or stage
 *  ("Finals"), from the edition file. WBSC's own string ("Group Stage Games") is the last resort. */
function roundOf(g: WorldCupGameFile, e: WorldCupEdition | null | undefined): string | null {
  // 2012 and 2014 write "Gold", "Bronze" and "5th Place Game".
  if (g.round === 'World Championship Final' || g.round === 'Gold') return 'Gold medal game'
  if (g.round === 'Bronze Medal Game' || g.round === 'Bronze') return 'Bronze medal game'
  if (g.round === '5th Place Game' || g.round === '7th Place Game') return `${g.round.slice(0, 3)} place game`
  for (const s of e?.stages ?? []) {
    for (const grp of s.groups) if (grp.games.some(x => x.wbsc_game_id === g.wbsc_game_id)) return grp.label ?? s.label
  }
  return g.round
}

/** Both teams with their flags and the score, as WPBL's game header reads: the winner in full ink. */
function ScoreHeader({ g, round }: { g: WorldCupGameFile; round: string | null }) {
  const awayWon = g.away_score > g.home_score
  // The name sits under the flag, not beside it: beside it "Hong Kong, China" took three lines on a phone.
  const side = (team: string, score: number, won: boolean, end: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexDirection: end ? 'row-reverse' : 'row', minWidth: 0 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, minWidth: 0, flex: '0 1 auto' }}>
        <CountryBadge team={team} size={44} />
        <Typography sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: won ? 'text.primary' : 'text.secondary', lineHeight: 1.2, textAlign: 'center' }}>
          {countryName(team)}
        </Typography>
      </Box>
      <Typography sx={{
        fontSize: TYPE_SCALE.page, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1,
        color: won ? 'text.primary' : 'text.secondary', ml: end ? 0 : 'auto', mr: end ? 'auto' : 0,
      }}>{score}</Typography>
    </Box>
  )
  return (
    <SectionCard title={round ?? 'Final'}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', columnGap: { xs: 1.5, sm: 3 } }}>
        {side(g.away, g.away_score, awayWon, false)}
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', fontWeight: 700, textAlign: 'center' }}>
          {g.innings === 7 ? 'Final' : `F/${g.innings}`}
        </Typography>
        {side(g.home, g.home_score, !awayWon, true)}
      </Box>
      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mt: 1.5 }}>
        {[`${shortDate(g.date)}, ${g.date.slice(0, 4)}`, g.venue, g.city, g.attendance ? `Attendance ${g.attendance.toLocaleString('en-US')}` : null]
          .filter(Boolean).join(' · ')}
      </Typography>
    </SectionCard>
  )
}

function GamePage({ slug, id }: { slug: string; id: string }) {
  const dense = usePhoneLayout()
  const read = useSiteFile<WorldCupGameFile>(`world-cup-game-${id}.json`)
  const edition = useSiteFile<WorldCupEdition>(`world-cup-${slug}.json`)
  const g = read?.data
  // The matchup, as a schedule names a game; the score is the header card's.
  const title = g ? `${countryName(g.away)} at ${countryName(g.home)}` : 'Game'
  // The games either side in the order played, skipping forfeits, which have no page.
  const played = edition?.data ? allGames(edition.data).filter(x => !x.forfeit) : []
  const at = played.findIndex(x => String(x.wbsc_game_id) === id)
  const prev = at > 0 ? played[at - 1] : null
  const next = at >= 0 && at < played.length - 1 ? played[at + 1] : null
  return (
    <StandalonePage title={title} back={{ href: editionPath(slug, 'games'), label: editionTitle(slug) }}
      trail={[{ href: '/world-cup', label: 'World Cup' }, { href: editionPath(slug, 'games'), label: editionTitle(slug) }]}>
      {!read ? <Loading /> : !g ? <NoData /> : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <ScoreHeader g={g} round={roundOf(g, edition?.data)} />
          <SectionCard title="Line score">
            <LineScore g={g} />
          </SectionCard>
          <SectionCard title="Box score">
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
              <TeamBox g={g} side="away" dense={dense} />
              <TeamBox g={g} side="home" dense={dense} />
            </Box>
          </SectionCard>
          {g.halves.length > 0 && (
            <SectionCard title="Play by play">
              <PlayByPlay g={g} />
            </SectionCard>
          )}
          {(prev || next) && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              {prev ? <NeighborGame g={prev} slug={slug} label="Previous game" /> : <Box />}
              {next ? <NeighborGame g={next} slug={slug} label="Next game" alignEnd /> : <Box />}
            </Box>
          )}
          <Box sx={{ px: 0.5, pt: 0.5, borderTop: '1px solid', borderColor: CARD_BORDER }}>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
              Source: <Box component="a" href={g.url} target="_blank" rel="noopener" sx={{ color: 'inherit' }}>{publisher(g.url)} box score</Box>
            </Typography>
          </Box>
        </Box>
      )}
    </StandalonePage>
  )
}

const fmtTwo = (v: number | null) => (v == null ? '—' : v.toFixed(2))

const MEDAL_WORD: Record<Medal, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' }
const MEDAL_VAR: Record<Medal, string> = { gold: 'var(--wpbl-medal-1)', silver: 'var(--wpbl-medal-2)', bronze: 'var(--wpbl-medal-3)' }

function MedalWord({ medal }: { medal: Medal }) {
  return <Box component="span" sx={{ fontSize: TYPE_SCALE.meta, fontWeight: 700, color: MEDAL_VAR[medal] }}>{MEDAL_WORD[medal]}</Box>
}

/** An edition's medal goes on the person's last event of it (the Finals, where it was won), so a
 *  group stage and its Finals do not both carry it. */
function medalMark(p: WorldCupPersonFile, e: InternationalEvent) {
  const ev = p.events.find(x => x.event_key === e.event_key)
  const m = ev?.edition ? p.medals?.find(x => x.edition === ev.edition) : undefined
  if (!m || !ev) return null
  const last = [...p.events].reverse().find(x => x.edition === ev.edition)
  return last?.event_key === e.event_key ? <MedalWord medal={m.medal} /> : null
}

/** Country, position, how many World Cups, and the medals won: the facts a reader scans first. */
function PersonHeader({ p }: { p: WorldCupPersonFile }) {
  const editions = new Set(p.events.flatMap(e => (e.edition ? [e.edition] : [])))
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
      {p.country && <CountryBadge team={p.country} size={40} />}
      <Box>
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>
          {[
            p.country ? (
              <Box key="c" {...linkTo(teamPath(null, p.country))} sx={{ ...UNSTYLED_LINK, color: 'text.primary', fontWeight: 600, '&:hover': { textDecoration: 'underline' } }}>
                {countryName(p.country)}
              </Box>
            ) : null,
            p.position,
            `${editions.size} ${editions.size === 1 ? 'World Cup' : 'World Cups'}`,
          ].filter(Boolean).map((x, i) => <Fragment key={i}>{i > 0 && ' · '}{x}</Fragment>)}
        </Typography>
        {(p.medals?.length ?? 0) > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, mt: 0.25 }}>
            {p.medals.map(m => (
              <Box key={m.edition} sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'baseline' }}>
                <MedalWord medal={m.medal} />
                <Box component="span" sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{m.edition}</Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  )
}

/** Every game, newest first, one table for what the person did at the plate and one on the mound.
 *  A row opens the game's page. */
function PersonGameLog({ p }: { p: WorldCupPersonFile }) {
  const games = p.events.flatMap(e => (e.log ?? []).map(g => ({ g, edition: e.edition })))
    .sort((a, b) => cmp(b.g.game_date, a.g.game_date) || b.g.wbsc_game_id - a.g.wbsc_game_id)
  const lead = (g: PersonGameLine) => [
    `${shortDate(g.game_date)}, ${g.game_date.slice(0, 4)}`,
    `${g.home ? 'vs' : '@'} ${g.opponent_id}`,
    `${g.team_score > g.opponent_score ? 'W' : 'L'} ${g.team_score}–${g.opponent_score}`,
  ]
  const opener = (g: PersonGameLine, edition: string | null) => (edition ? () => navigate(`/world-cup/${edition}/games/${g.wbsc_game_id}`) : undefined)
  const batting: StatLogRow[] = games.flatMap(({ g, edition }) => (g.batting ? [{
    lead: lead(g), onOpen: opener(g, edition),
    cells: [g.batting.ab, g.batting.r, g.batting.h, g.batting.hr, g.batting.rbi, g.batting.bb, g.batting.so, g.batting.sb],
  }] : []))
  const pitching: StatLogRow[] = games.flatMap(({ g, edition }) => (g.pitching ? [{
    lead: lead(g), onOpen: opener(g, edition),
    cells: [outsToIp(g.pitching.outs), g.pitching.h, g.pitching.er, g.pitching.bb, g.pitching.so, g.pitching.decision ?? ''],
  }] : []))
  return (
    <>
      {batting.length > 0 && (
        <StatLogTable title="Batting" leadHeaders={['Date', 'Opp', 'Result']} statHeaders={['AB', 'R', 'H', 'HR', 'RBI', 'BB', 'SO', 'SB']}
          rows={batting} accent={ACCENT} />
      )}
      {pitching.length > 0 && (
        <Box sx={{ mt: batting.length > 0 ? 2.5 : 0 }}>
          <StatLogTable title="Pitching" leadHeaders={['Date', 'Opp', 'Result']} statHeaders={['IP', 'H', 'ER', 'BB', 'SO', 'Dec']}
            rows={pitching} accent={ACCENT} />
        </Box>
      )}
    </>
  )
}

function PersonPage({ slug }: { slug: string }) {
  const read = useSiteFile<WorldCupPersonFile>(`world-cup-player-${slug}.json`)
  const p = read?.data
  // A row opens its edition, as the WPBL page's World Cup rows do.
  const openEvent = (e: WorldCupPersonFile['events'][number]) => () => {
    if (e.edition) navigate(`/world-cup/${e.edition}`)
    else window.open(e.url, '_blank', 'noopener')
  }
  return (
    <StandalonePage title={p?.name ?? 'Player'} back={{ href: '/world-cup', label: 'World Cup' }}
      trail={[{ href: '/world-cup', label: 'World Cup' }]}>
      {!read ? <Loading /> : !p ? <NoData /> : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <PersonHeader p={p} />
          <SectionCard title="World Cup">
            {/* The World Cup's own seven-inning basis: there is no league setting to follow here. */}
            <WorldCupCareerTables events={p.events} accent={ACCENT} eraBasis={WBSC_LEAGUE.regulationInnings} fmtEra={fmtTwo} onOpen={openEvent}
              hrefOf={e => { const ed = editionSlugOf(e.event_key); return ed ? `/world-cup/${ed}` : null }}
              markOf={e => medalMark(p, e)} total />
          </SectionCard>
          {p.events.some(e => e.log?.length) && (
            <SectionCard title="Games">
              <PersonGameLog p={p} />
            </SectionCard>
          )}
          <Box sx={{ px: 0.5, pt: 0.5, borderTop: '1px solid', borderColor: CARD_BORDER }}>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
              <SourceLinks links={p.events.map(e => ({ key: e.event_key, url: e.url }))} />
            </Typography>
          </Box>
        </Box>
      )}
    </StandalonePage>
  )
}

export default function WorldCupPage({ path }: { path: string }) {
  const [, , slug, part, id] = path.split('/')
  if (slug === 'players' && part) return <PersonPage slug={part} />
  if (slug === 'teams' && part) return <TeamHistoryPage code={part} />
  if (slug && part === 'games' && id) return <GamePage slug={slug} id={id} />
  if (slug && part === 'teams' && id) return <EditionTeamPage slug={slug} code={id} />
  if (!slug) return <Index />
  return <Edition slug={slug} tab={(EDITION_TABS.find(t => t.value === part)?.value) ?? 'overview'} />
}
