// /mlb/compare: two MLB players, side by side. WPBL's compare page for this section (the second
// alignment pass in ROADMAP.md): the same three states on one route, the same frame
// (src/ui/compare.tsx), the same rules about what a comparison may claim (compare.ts).
//
// WHAT IS DIFFERENT, AND WHY. WPBL holds its whole league in four cached reads, so its page reads
// everything and derives the rest. MLB has 1,500 players a season, so this reads per player: each
// one's bio and season bundle (the player card's own two reads, the bio already cached from the
// card a reader came from), the head-to-head from StatsAPI's `vsPlayer` record, and the two season pools only while
// the picker is on screen, since those are the Stats boards' 1.5 MB and a pair page has no use for
// them. Regular season only, as WPBL's is.
//
// THE SEASON IS THE URL'S: `?season=` when the reader came from a player card showing another year,
// else the one the section shows (CURRENT_SEASON). See withMlbCompareSeason in routes.ts for why
// it is a query string when nothing else in the section is.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Box, Typography } from '@mui/material'
import StandalonePage from '../ui/StandalonePage'
import { SectionCard, TextGhost } from '../ui/card'
import { chromePx } from '../ui/scale'
import {
  CompareHead, CompareHeadSkeleton, CompareBlocksCard, CompareBlocksSkeleton, HeadToHeadCard, HeadToHeadSkeleton,
  ComparePicker, CompareAgainLink, duelLine, HEAD_CARD, VS_SX, PICK_SLOT, GHOST_HEAD_NAME,
  type ComparePick, type HeadToHeadView,
} from '../ui/compare'
import { fetchMlbBio, peekMlbBio, fetchSeasonBundle, fetchCareer, type MlbBio, type SeasonBundle } from './playerProfile'
import { fetchSeasonPlayerStats } from './apiSeasonStats'
import {
  buildMlbComparison, duelFromVsPlayer, canBat, canPitch, rankMlbCompareCandidates, mlbPairShape,
  type MlbCompareLines, type MlbCompareSide, type MlbDuel, type MlbCompareCandidate,
} from './compare'
import {
  MLB_COMPARE_BASE, mlbCompareTargetFromPath, mlbComparePath, mlbCompareCanonicalPath, mlbCompareStartPath, mlbPlayerPath,
  mlbCompareSeasonFromSearch, withMlbCompareSeason,
} from './routes'
import { CURRENT_SEASON, HEADSHOT, TEAM_BG, TEAM_ABBR, TEAM_NICKNAME } from './constants'
import { TeamLogo } from './components/TeamLogo'
import { setDynamicSeo } from '../seo'
import { track, EVENTS } from '../lib/analytics'

const API = 'https://statsapi.mlb.com/api/v1'

/** How many rows the picker draws with no query. The list scrolls in a fixed box, so the cap is
 *  not about height; it is that 1,500 buttons are a slow render for a list nobody scrolls to the
 *  end of, when the search box finds anyone in one word. */
const PICK_LIMIT = 60

// ─── Reads ──────────────────────────────────────────────────────────────────────

/** `teamId` is the club the season was played for, which for any season but this one need not be
 *  the club the bio says they are on now. */
interface Side { bio: MlbBio | null; lines: MlbCompareLines; teamId: number | null }

const toLines = (b: SeasonBundle): MlbCompareLines => ({ hitting: b.hitting, pitching: b.pitching, saber: b.saber })

/** One player's half: the card's own reads, so a player opened from a card is already in hand. A
 *  failed bundle is no season rather than a broken page; a failed bio is a page with no name. */
async function readSide(id: number, season: number): Promise<Side> {
  const [bio, bundle, pastClub] = await Promise.all([
    fetchMlbBio(id).catch(() => null),
    fetchSeasonBundle(id, season).catch(() => null),
    // A past season's club is the card's: off the year-by-year, the last club of a traded season.
    // Read only for a past season, and cached under the card's own reads.
    season === CURRENT_SEASON ? null
      : fetchCareer(id).then(c => [...c.hitting, ...c.pitching].find(r => r.season === season)?.lastTeamId ?? null).catch(() => null),
  ])
  return {
    bio,
    lines: bundle ? toLines(bundle) : { hitting: null, pitching: null, saber: { hitting: null, pitching: null } },
    teamId: season === CURRENT_SEASON ? bio?.currentTeam?.id ?? null : pastClub,
  }
}

const subscribeHistory = (cb: () => void) => {
  window.addEventListener('popstate', cb)
  return () => window.removeEventListener('popstate', cb)
}
const readSearch = () => window.location.search

/** The season the address asks for. The shell routes on the pathname alone, so a move that changes
 *  only the query would not reach this page through `path`. */
function useCompareSeason(): number {
  return mlbCompareSeasonFromSearch(useSyncExternalStore(subscribeHistory, readSearch, () => ''), CURRENT_SEASON)
}

const duelCache = new Map<string, Promise<any>>()

/** Every meeting of this batter with this pitcher, every season and game type, one request. Kept
 *  for the session: a career record moves by a plate appearance a night at most. */
function readVsPlayer(batter: number, pitcher: number): Promise<any> {
  const key = `${batter}-${pitcher}`
  let p = duelCache.get(key)
  if (!p) {
    p = fetch(`${API}/people/${batter}/stats?stats=vsPlayer&group=hitting&opposingPlayerId=${pitcher}&sportId=1&gameType=R,F,D,L,W`)
      .then(r => { if (!r.ok) throw new Error(`statsapi ${r.status}`); return r.json() })
    duelCache.set(key, p)
    p.catch(() => duelCache.delete(key))
  }
  return p
}

// ─── Parts ──────────────────────────────────────────────────────────────────────

/** The club's nickname and the position, which fit half a phone's width where "Pittsburgh Pirates
 *  · RF" does not; the badge beside it says the city. */
const subline = (side: Side, current: boolean) => {
  // No club this season is a free agent now, and in a past season simply no line that year.
  const club = side.teamId != null
    ? TEAM_NICKNAME[side.teamId] ?? (side.bio?.currentTeam?.id === side.teamId ? side.bio.currentTeam.name : null)
    : current ? 'Free agent' : null
  const pos = side.bio?.primaryPosition?.abbreviation
  return [club, pos].filter(Boolean).join(' · ')
}

function Portrait({ id, name, teamId }: { id: number; name: string; teamId?: number }) {
  return (
    <Box component="img" src={HEADSHOT(id)} alt={name} sx={{
      width: chromePx(64), height: chromePx(64), borderRadius: '50%', objectFit: 'cover', objectPosition: 'center 20%',
      flexShrink: 0, bgcolor: 'action.hover',
      boxShadow: `0 0 0 2px ${teamId ? TEAM_BG[teamId] ?? 'rgba(128,128,128,0.4)' : 'rgba(128,128,128,0.4)'}`,
    }} />
  )
}

function Head({ id, side, current, onNavigate, onClear }: {
  id: number; side: Side; current: boolean; onNavigate: (to: string) => void; onClear?: () => void
}) {
  const name = side.bio?.fullName ?? 'Unknown player'
  const teamId = side.teamId ?? undefined
  return (
    <CompareHead
      name={name}
      href={mlbPlayerPath({ id, fullName: side.bio?.fullName })}
      portrait={<Portrait id={id} name={name} teamId={teamId} />}
      badge={teamId && TEAM_ABBR[teamId] ? <TeamLogo teamId={teamId} abbr={TEAM_ABBR[teamId]} size={18} /> : undefined}
      subline={subline(side, current)}
      onNavigate={onNavigate}
      onClear={onClear}
    />
  )
}

/** The duel's slices, in the order a reader asks: this year, then all of it, then October. */
function duelViews(duels: MlbDuel[], season: number, name: (s: MlbCompareSide) => string): HeadToHeadView[] {
  return duels.map(d => ({
    key: d.batter,
    heading: `${name(d.batter)} batting against ${name(d.batter === 'a' ? 'b' : 'a')}`,
    slices: ([
      [`${season} regular season`, d.season],
      ['Career regular season', d.career],
      ['Career postseason', d.postseason],
    ] as const).flatMap(([label, c]) => (c ? [{ label, line: duelLine(c) }] : [])),
  }))
}

/** The likeliest duel's slices, for its skeleton: two players who have met mostly have the season
 *  and the career between them. */
const duelSkeleton = (season: number) => [`${season} regular season`, 'Career regular season']
/** Each card's row counts, block by block, as compare.ts builds them. */
const SKELETON_BLOCKS = { batting: [2, 9, 5, 2], pitching: [3, 4, 4, 2] } as const
const SKELETON_TITLES = { batting: 'Batting', pitching: 'Pitching' } as const

function Picker({ candidates, season, onPick, skeleton }: {
  candidates: MlbCompareCandidate[]; season: number; onPick: (c: MlbCompareCandidate) => void; skeleton?: boolean
}) {
  const byId = useMemo(() => new Map(candidates.map(c => [String(c.id), c])), [candidates])
  const picks: ComparePick[] = useMemo(() => candidates.map(c => ({
    key: String(c.id), name: c.name, position: c.position, playedText: c.playedText,
    badge: c.teamId && TEAM_ABBR[c.teamId] ? <TeamLogo teamId={c.teamId} abbr={TEAM_ABBR[c.teamId]} size={20} /> : undefined,
  })), [candidates])
  return (
    <ComparePicker
      candidates={picks}
      skeleton={skeleton}
      limit={PICK_LIMIT}
      limitNote={`The first ${PICK_LIMIT} by playing time. Search to find anyone else with a ${season} line.`}
      emptyText={`Nobody by that name with a ${season} line.`}
      onPick={key => { const c = byId.get(key); if (c) onPick(c) }}
    />
  )
}

// ─── The page ───────────────────────────────────────────────────────────────────

export default function MlbComparePage({ path, onNavigate }: { path: string; onNavigate: (to: string) => void }) {
  const target = mlbCompareTargetFromPath(path) ?? { kind: 'picker' as const }
  const ids = target.kind === 'pair' ? [target.a, target.b] : target.kind === 'single' ? [target.id] : []
  const idsKey = ids.join(',')
  const season = useCompareSeason()
  const current = season === CURRENT_SEASON
  // Every compare address this page builds stays in the season it is showing.
  const inSeason = (p: string) => withMlbCompareSeason(p, season, CURRENT_SEASON)
  // What the reads below are keyed on: the same pair in another season is another page.
  const readKey = idsKey ? `${idsKey}@${season}` : ''

  // Keyed by the ids they belong to, so a pair changed in place never draws the last pair's
  // columns for a frame.
  const [sides, setSides] = useState<{ key: string; list: Side[] } | null>(null)
  useEffect(() => {
    if (!readKey) return
    let cancelled = false
    Promise.all(idsKey.split(',').map(n => readSide(Number(n), season)))
      .then(list => { if (!cancelled) setSides({ key: readKey, list }) })
    return () => { cancelled = true }
  // readKey is idsKey and season together.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKey])
  const ready = !readKey || sides?.key === readKey
  const list = ready && readKey ? sides!.list : []

  // The bios on their own, ahead of the lines, for the one thing the skeleton cannot read off the
  // URL: whether this pair is two hitters. Read synchronously when the session already has them,
  // which it does for a player whose card the reader came from.
  const peeked = useMemo(() => {
    const got = ids.map(peekMlbBio)
    return got.every(Boolean) ? got as MlbBio[] : null
  // `ids` is idsKey, rebuilt every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])
  const [bios, setBios] = useState<{ key: string; list: (MlbBio | null)[] } | null>(null)
  useEffect(() => {
    if (target.kind !== 'pair' || peeked) return
    let cancelled = false
    Promise.all(idsKey.split(',').map(n => fetchMlbBio(Number(n)).catch(() => null)))
      .then(list => { if (!cancelled) setBios({ key: idsKey, list }) })
    return () => { cancelled = true }
  // target.kind is read off the same path as idsKey.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, peeked])
  const knownBios = peeked ?? (bios?.key === idsKey ? bios.list : [])
  const shape = mlbPairShape(knownBios.map(b => b?.primaryPosition?.code))

  // The pools, only while there is a slot to fill.
  const picking = target.kind !== 'pair'
  const [pools, setPools] = useState<{ season: number; hitting: any[]; pitching: any[] } | null>(null)
  const poolsReady = pools?.season === season
  useEffect(() => {
    if (!picking || poolsReady) return
    let cancelled = false
    Promise.all([fetchSeasonPlayerStats('hitting', season), fetchSeasonPlayerStats('pitching', season)])
      .then(([hitting, pitching]) => { if (!cancelled) setPools({ season, hitting, pitching }) })
    return () => { cancelled = true }
  }, [picking, poolsReady, season])
  const subjectId = target.kind === 'single' ? target.id : null
  const candidates = useMemo(
    () => (pools && poolsReady ? rankMlbCompareCandidates(subjectId, pools.hitting, pools.pitching) : []),
    [pools, poolsReady, subjectId])

  // Which ways round a duel can exist, once both bios are in: X batting against Y needs Y to pitch.
  const pairSides = target.kind === 'pair' && list.length === 2 ? list : null
  const directions = useMemo(() => {
    if (!pairSides || target.kind !== 'pair') return []
    const [a, b] = pairSides
    const out: { batter: MlbCompareSide; batterId: number; pitcherId: number }[] = []
    if (canBat(a.bio?.primaryPosition?.code, a.lines) && canPitch(b.bio?.primaryPosition?.code, b.lines)) out.push({ batter: 'a', batterId: target.a, pitcherId: target.b })
    if (canBat(b.bio?.primaryPosition?.code, b.lines) && canPitch(a.bio?.primaryPosition?.code, a.lines)) out.push({ batter: 'b', batterId: target.b, pitcherId: target.a })
    return out
  // The target's ids are idsKey; reading them off `target` keeps the closure honest without a
  // second memo on an object rebuilt every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairSides, idsKey])

  const [duels, setDuels] = useState<{ key: string; list: MlbDuel[] } | null>(null)
  useEffect(() => {
    if (directions.length === 0) return
    let cancelled = false
    // Each direction allowed to fail alone: a missing half is a card with one duel, and both
    // missing is no card, which is what the page looks like for two who never met.
    Promise.all(directions.map(d => readVsPlayer(d.batterId, d.pitcherId)
      .then(json => duelFromVsPlayer(json, season, d.batter))
      .catch(() => null)))
      .then(found => { if (!cancelled) setDuels({ key: readKey, list: found.filter((x): x is MlbDuel => x != null) }) })
    return () => { cancelled = true }
  // season is in readKey.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directions, readKey])
  const duelsReady = directions.length === 0 || duels?.key === readKey

  const groups = useMemo(() => (pairSides ? buildMlbComparison(pairSides[0].lines, pairSides[1].lines) : []), [pairSides])

  const nameOf = (s: Side | undefined) => s?.bio?.fullName ?? null
  const aName = nameOf(list[0]), bName = nameOf(list[1])

  // The tags for what ROUTES cannot describe: a pair is titled from two names that arrive with
  // their bios, and the half-picked state is noindex, a state rather than a page. Every season of a
  // pair declares the same canonical, the season-less spelling (see withMlbCompareSeason).
  useEffect(() => {
    const here = path.replace(/\/+$/, '')
    if (target.kind === 'single' && aName) {
      setDynamicSeo({ path: here, seo: {
        title: `Compare ${aName} with another MLB player | sportydolphin.fun`,
        description: `Pick an MLB player to put next to ${aName} and compare their ${season} seasons.`,
        noindex: true,
      } })
      return () => setDynamicSeo(null)
    }
    if (target.kind === 'pair' && aName && bName) {
      setDynamicSeo({ path: here, seo: {
        title: `${aName} vs ${bName}: ${season} MLB stats compared | sportydolphin.fun`,
        description: `${aName} and ${bName} side by side in ${season}: batting, pitching, WAR, `
          + 'and every time they have faced each other.',
        canonical: mlbCompareCanonicalPath({ id: target.a, fullName: aName }, { id: target.b, fullName: bName }),
      } })
      return () => setDynamicSeo(null)
    }
  // `target` is rebuilt from `path` each render; its contents are all in the deps through it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, aName, bName, season])

  useEffect(() => {
    if (target.kind === 'pair' && ready) track(EVENTS.MLB_COMPARE_VIEWED, { a: target.a, b: target.b, season })
  // Once per pair and season, when it has drawn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKey, ready])

  const pick = (c: MlbCompareCandidate) => {
    const chosen = { id: c.id, fullName: c.name }
    if (target.kind === 'single') onNavigate(inSeason(mlbComparePath({ id: target.id, fullName: aName }, chosen)))
    else onNavigate(inSeason(mlbCompareStartPath(chosen)))
  }

  const standfirstNone = `Pick two players to put their ${season} seasons side by side.`
  // A pair names its season only when it is not this one, which every other page takes as read.
  const pairStandfirst = current ? undefined : `The ${season} regular season.`
  const back = { href: '/mlb', label: 'Back to MLB' }

  // LOADING IS THE PAGE THE URL WILL OPEN, drawn empty, as WPBL's is: which of the three shapes is
  // readable off the path before anything has arrived, and which cards a pair holds off the bios,
  // which arrive first.
  if (!ready) {
    return (
      <StandalonePage
        maxWidth={chromePx(560)}
        back={back}
        title={target.kind === 'pair' ? <TextGhost>{GHOST_HEAD_NAME} vs {GHOST_HEAD_NAME}</TextGhost> : 'Compare players'}
        standfirst={target.kind === 'pair' ? pairStandfirst : <>Pick somebody to put next to <TextGhost>{GHOST_HEAD_NAME}</TextGhost>.</>}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
          <Box sx={HEAD_CARD}>
            <CompareHeadSkeleton withChange={target.kind === 'pair'} />
            <Typography aria-hidden sx={VS_SX}>vs</Typography>
            {target.kind === 'pair' ? <CompareHeadSkeleton withChange /> : <Box sx={PICK_SLOT}>Pick somebody below</Box>}
          </Box>
          {target.kind === 'pair'
            ? <>
                {shape.duel && <HeadToHeadSkeleton labels={duelSkeleton(season)} />}
                {shape.groups.map(g => <CompareBlocksSkeleton key={g} title={SKELETON_TITLES[g]} blocks={[...SKELETON_BLOCKS[g]]} />)}
              </>
            : (
              <SectionCard title="And who else">
                <Picker candidates={[]} season={season} onPick={() => {}} skeleton />
              </SectionCard>
            )}
        </Box>
      </StandalonePage>
    )
  }

  const [a, b] = list
  const title = target.kind === 'pair' ? `${aName ?? 'Unknown player'} vs ${bName ?? 'Unknown player'}` : 'Compare players'
  const standfirst = target.kind === 'pair' ? pairStandfirst
    : target.kind === 'single' ? `Pick somebody to put next to ${aName ?? 'this player'}.` : standfirstNone

  return (
    <StandalonePage maxWidth={chromePx(560)} back={back} title={title} standfirst={standfirst}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
        {target.kind !== 'picker' && (
          <Box sx={HEAD_CARD}>
            <Head id={ids[0]} side={a} current={current} onNavigate={onNavigate}
              onClear={target.kind === 'pair' ? () => onNavigate(inSeason(mlbCompareStartPath({ id: target.b, fullName: bName }))) : undefined} />
            <Typography aria-hidden sx={VS_SX}>vs</Typography>
            {target.kind === 'pair'
              ? <Head id={target.b} side={b} current={current} onNavigate={onNavigate}
                  onClear={() => onNavigate(inSeason(mlbCompareStartPath({ id: target.a, fullName: aName })))} />
              : <Box sx={PICK_SLOT}>Pick somebody below</Box>}
          </Box>
        )}

        {picking && (
          <SectionCard title={target.kind === 'single' ? 'And who else' : 'Choose a player'}>
            <Picker candidates={candidates} season={season} onPick={pick} skeleton={!poolsReady} />
          </SectionCard>
        )}

        {target.kind === 'pair' && (
          <>
            {/* The duel leads when there is one: it is the card no season table can draw. Its
                slot is held while the record is on its way, so the page does not jump by a card. */}
            {directions.length > 0 && (duelsReady
              ? <HeadToHeadCard duels={duelViews(duels?.list ?? [], season, s => (s === 'a' ? aName : bName) ?? 'Unknown player')} />
              : <HeadToHeadSkeleton labels={duelSkeleton(season)} />)}
            {groups.map(g => <CompareBlocksCard key={g.key} title={g.label} blocks={g.blocks} />)}
            {groups.length === 0 && (
              <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled' }}>
                Neither has a regular-season line in {season}, so there is nothing to compare yet.
              </Typography>
            )}
            <CompareAgainLink href={inSeason(MLB_COMPARE_BASE)} onNavigate={onNavigate} />
          </>
        )}
      </Box>
    </StandalonePage>
  )
}
