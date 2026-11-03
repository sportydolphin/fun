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
// every app route needs.
//
// EVERY PAGE CREDITS WBSC, with a link to its own page for what this one shows.
import { useEffect, useState } from 'react'
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
import { outsToIp } from '../league/innings'
import { WorldCupCareerTables } from './WorldCupCareer'
import { WBSC_LEAGUE } from './league'
import { fetchSite } from './siteFile'
import type { WorldCupPersonFile } from './wbsc/personFile'
import type { EditionLeaders, WpblInField } from './wbsc/editionLeaders'
import type { WorldCupGameFile } from './wbsc/gameFile'
import type { Medals, StandingRow, WorldCupEdition, WorldCupGame, WorldCupGroup, WorldCupIndexEntry } from './wbsc/editions'


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
 *  reads '2023 Group A', the Finals '2024 Finals', a one-event edition its year. */
function sourceLabel(url: string): string {
  const key = url.split('/events/')[1]?.split('/')[0] ?? ''
  const tail = (key.split('world-cup')[1] ?? '').replace(/^-/, '').replace('group-stage-', '')
  const words = tail.split('-').filter(Boolean).map(w => (w.length === 1 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
  return [key.slice(0, 4), ...words].join(' ')
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
          Source: WBSC · Flags: <Box component="a" href="https://github.com/lipis/flag-icons" target="_blank" rel="noopener" sx={{ color: 'inherit' }}>flag-icons</Box> (MIT)
        </Typography>
      </Box>
    </StandalonePage>
  )
}

const NUM = { textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums', width: '2.5rem' }

function Standings({ rows }: { rows: StandingRow[] }) {
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
            <Box component="td" sx={{ py: 0.75 }}><TeamName team={r.team} /></Box>
            {[r.w, r.l, r.rs, r.ra].map((v, i) => <Box component="td" key={i} sx={NUM}>{v}</Box>)}
          </Box>
        ))}
      </tbody>
    </Box>
  )
}

function Result({ g, slug }: { g: WorldCupGame; slug: string }) {
  const awayWon = g.away_score > g.home_score
  return (
    // A forfeit has no box score, so no page to open.
    <Box {...(g.forfeit ? {} : linkTo(`/world-cup/${slug}/games/${g.wbsc_game_id}`))} sx={{
      ...UNSTYLED_LINK, display: 'grid', gridTemplateColumns: '3.5rem 1fr auto', alignItems: 'center', columnGap: 1,
      py: 0.75, borderTop: '1px solid', borderColor: 'divider', fontSize: TYPE_SCALE.body,
    }}>
      <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{shortDate(g.date)}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
        <Box sx={{ fontWeight: awayWon ? 700 : 400 }}><TeamName team={g.away} /> {g.away_score}</Box>
        <Box component="span" sx={{ color: 'text.secondary', mx: 0.75 }}>@</Box>
        <Box sx={{ fontWeight: awayWon ? 400 : 700 }}><TeamName team={g.home} /> {g.home_score}</Box>
      </Box>
      <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
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
      {standings && <Standings rows={group.standings} />}
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

function Edition({ slug }: { slug: string }) {
  const read = useSiteFile<WorldCupEdition>(`world-cup-${slug}.json`)
  const e = read?.data
  return (
    <StandalonePage title={`${slug} World Cup`} back={{ href: '/world-cup', label: 'World Cup' }}>
      {!read ? <Loading /> : !e ? <NoData /> : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <SectionCard title="Summary">
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mb: 1 }}>
              {[years(e.years), e.hosts.join(' · '), `${e.teams.length} teams`].join(' · ')}
            </Typography>
            {e.medals ? <MedalLine medals={e.medals} /> : (
              <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>In progress</Typography>
            )}
          </SectionCard>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
              <Typography component="h2" sx={{ fontSize: TYPE_SCALE.heading, fontWeight: 700 }}>Leaders</Typography>
              <InfoDot label="Qualified" text="Batting average and OPS: 2.4 plate appearances per team game. ERA: 2.4 outs per team game, per 7 innings." />
            </Box>
            <Leaders leaders={e.leaders} />
          </Box>
          {e.wpbl.length > 0 && (
            <SectionCard title="WPBL players">
              <WpblPlayers teams={e.wpbl} />
            </SectionCard>
          )}
          {e.stages.map(s => (
            <SectionCard key={s.label} title={s.label}>
              {s.groups.map((g, i) => <Group key={g.label ?? i} group={g} standings={s.kind === 'round-robin'} slug={slug} />)}
            </SectionCard>
          ))}
          <Box sx={{ px: 0.5, pt: 0.5, borderTop: '1px solid', borderColor: CARD_BORDER }}>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
              Source: WBSC{e.sources.map(u => (
                <Box component="a" key={u} href={u} target="_blank" rel="noopener" sx={{ color: 'inherit', ml: 1 }}>
                  {sourceLabel(u)}
                </Box>
              ))}
            </Typography>
          </Box>
        </Box>
      )}
    </StandalonePage>
  )
}

const BAT_COLS = [
  { key: 'ab', label: 'AB' }, { key: 'r', label: 'R' }, { key: 'h', label: 'H', bold: true },
  { key: 'rbi', label: 'RBI' }, { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' },
] as const
const PIT_COLS = [
  { key: 'ip', label: 'IP', bold: true, w: 32 }, { key: 'h', label: 'H' }, { key: 'r', label: 'R' },
  { key: 'er', label: 'ER' }, { key: 'bb', label: 'BB' }, { key: 'so', label: 'SO' },
]

function TeamBox({ g, side, dense }: { g: WorldCupGameFile; side: 'away' | 'home'; dense: boolean }) {
  const bat = g.batting[side]
  const pit = g.pitching[side]
  const sum = (k: typeof BAT_COLS[number]['key']) => bat.reduce((n, b) => n + b[k], 0)
  const pitSum = (k: 'h' | 'r' | 'er' | 'bb' | 'so') => pit.reduce((n, p) => n + p[k], 0)
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
              cells: BAT_COLS.map(c => b[c.key]),
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
            cells: [outsToIp(p.outs), p.h, p.r, p.er, p.bb, p.so],
          }))}
          totals={[outsToIp(pit.reduce((n, p) => n + p.outs, 0)), pitSum('h'), pitSum('r'), pitSum('er'), pitSum('bb'), pitSum('so')]} />
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
      <Box component="td" sx={{ py: 0.6, pr: 1, fontWeight: 600 }}>{team}</Box>
      {cols.map(i => <Box component="td" key={i} sx={{ ...NUM, width: '1.5rem' }}>{runs(line, i)}</Box>)}
      {[r, h, e].map((v, i) => <Box component="td" key={`t${i}`} sx={{ ...NUM, width: '1.75rem', fontWeight: i ? 400 : 700 }}>{v}</Box>)}
    </Box>
  )
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: TYPE_SCALE.body }}>
        <thead>
          <Box component="tr" sx={{ color: 'text.secondary', fontSize: TYPE_SCALE.meta }}>
            <Box component="th"><Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Team</Box></Box>
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

function GamePage({ slug, id }: { slug: string; id: string }) {
  const dense = usePhoneLayout()
  const read = useSiteFile<WorldCupGameFile>(`world-cup-game-${id}.json`)
  const g = read?.data
  const title = g ? `${countryName(g.away)} ${g.away_score}, ${countryName(g.home)} ${g.home_score}` : 'Game'
  return (
    <StandalonePage title={title} back={{ href: `/world-cup/${slug}`, label: `${slug} World Cup` }}>
      {!read ? <Loading /> : !g ? <NoData /> : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <SectionCard title="Line score">
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', mb: 1 }}>
              {[shortDate(g.date), g.round, g.venue, g.city, g.attendance ? `Attendance ${g.attendance.toLocaleString('en-US')}` : null]
                .filter(Boolean).join(' · ')}
            </Typography>
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
          <Box sx={{ px: 0.5, pt: 0.5, borderTop: '1px solid', borderColor: CARD_BORDER }}>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
              Source: <Box component="a" href={g.url} target="_blank" rel="noopener" sx={{ color: 'inherit' }}>WBSC box score</Box>
            </Typography>
          </Box>
        </Box>
      )}
    </StandalonePage>
  )
}

const fmtTwo = (v: number | null) => (v == null ? '—' : v.toFixed(2))

function PersonPage({ slug }: { slug: string }) {
  const read = useSiteFile<WorldCupPersonFile>(`world-cup-player-${slug}.json`)
  const p = read?.data
  // A row opens its edition, as the WPBL page's World Cup rows do.
  const openEvent = (e: WorldCupPersonFile['events'][number]) => () => {
    if (e.edition) navigate(`/world-cup/${e.edition}`)
    else window.open(e.url, '_blank', 'noopener')
  }
  return (
    <StandalonePage title={p?.name ?? 'Player'} back={{ href: '/world-cup', label: 'World Cup' }}>
      {!read ? <Loading /> : !p ? <NoData /> : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {p.country && <CountryBadge team={p.country} size={34} />}
            <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>
              {[countryName(p.country), `${p.events.length} ${p.events.length === 1 ? 'event' : 'events'}`].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
          <SectionCard title="World Cup">
            {/* The World Cup's own seven-inning basis: there is no league setting to follow here. */}
            <WorldCupCareerTables events={p.events} accent={ACCENT} eraBasis={WBSC_LEAGUE.regulationInnings} fmtEra={fmtTwo} onOpen={openEvent} />
          </SectionCard>
          <Box sx={{ px: 0.5, pt: 0.5, borderTop: '1px solid', borderColor: CARD_BORDER }}>
            <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
              Source: WBSC{p.events.map(e => (
                <Box component="a" key={e.event_key} href={e.url} target="_blank" rel="noopener" sx={{ color: 'inherit', ml: 1 }}>
                  {sourceLabel(e.url)}
                </Box>
              ))}
            </Typography>
          </Box>
        </Box>
      )}
    </StandalonePage>
  )
}

export default function WorldCupPage({ path }: { path: string }) {
  const [, , slug, games, id] = path.split('/')
  if (slug === 'players' && games) return <PersonPage slug={games} />
  if (slug && games === 'games' && id) return <GamePage slug={slug} id={id} />
  return slug ? <Edition slug={slug} /> : <Index />
}
