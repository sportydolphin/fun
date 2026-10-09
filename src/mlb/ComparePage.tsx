// /mlb/compare: two MLB players, side by side. WPBL's compare page for this section (the second
// alignment pass in ROADMAP.md): the same three states on one route, the same frame
// (src/ui/compare.tsx), the same rules about what a comparison may claim (compare.ts).
//
// WHAT IS DIFFERENT, AND WHY. WPBL holds its whole league in four cached reads, so its page reads
// everything and derives the rest. MLB has 1,500 players a season, so this reads per player: each
// one's bio and season bundle (the player card's own two reads, the bio already cached from the
// card a reader came from), the head-to-head from StatsAPI's `vsPlayer` record, and the two season pools only while
// the picker is on screen, since those are the Stats boards' 1.5 MB and a pair page has no use for
// them. The season is the one the section shows (CURRENT_SEASON), regular season only, as WPBL's is.
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import StandalonePage from '../ui/StandalonePage'
import { SectionCard, TextGhost } from '../ui/card'
import { chromePx } from '../ui/scale'
import {
  CompareHead, CompareHeadSkeleton, CompareBlocksCard, CompareBlocksSkeleton, HeadToHeadCard, HeadToHeadSkeleton,
  ComparePicker, CompareAgainLink, duelLine, HEAD_CARD, VS_SX, PICK_SLOT, GHOST_HEAD_NAME,
  type ComparePick, type HeadToHeadView,
} from '../ui/compare'
import { fetchMlbBio, fetchSeasonBundle, type MlbBio, type SeasonBundle } from './playerProfile'
import { fetchSeasonPlayerStats } from './apiSeasonStats'
import {
  buildMlbComparison, duelFromVsPlayer, canBat, canPitch, rankMlbCompareCandidates,
  type MlbCompareLines, type MlbCompareSide, type MlbDuel, type MlbCompareCandidate,
} from './compare'
import {
  MLB_COMPARE_BASE, mlbCompareTargetFromPath, mlbComparePath, mlbCompareCanonicalPath, mlbCompareStartPath, mlbPlayerPath,
} from './routes'
import { CURRENT_SEASON, HEADSHOT, TEAM_BG, TEAM_ABBR, TEAM_NICKNAME } from './constants'
import { TeamLogo } from './components/TeamLogo'
import { setDynamicSeo } from '../seo'
import { track, EVENTS } from '../lib/analytics'

const SEASON = CURRENT_SEASON
const API = 'https://statsapi.mlb.com/api/v1'

/** How many rows the picker draws with no query. The list scrolls in a fixed box, so the cap is
 *  not about height; it is that 1,500 buttons are a slow render for a list nobody scrolls to the
 *  end of, when the search box finds anyone in one word. */
const PICK_LIMIT = 60

// ─── Reads ──────────────────────────────────────────────────────────────────────

interface Side { bio: MlbBio | null; lines: MlbCompareLines }

const toLines = (b: SeasonBundle): MlbCompareLines => ({ hitting: b.hitting, pitching: b.pitching, saber: b.saber })

/** One player's half: the card's own reads, so a player opened from a card is already in hand. A
 *  failed bundle is no season rather than a broken page; a failed bio is a page with no name. */
async function readSide(id: number): Promise<Side> {
  const [bio, bundle] = await Promise.all([
    fetchMlbBio(id).catch(() => null),
    fetchSeasonBundle(id, SEASON).catch(() => null),
  ])
  return { bio, lines: bundle ? toLines(bundle) : { hitting: null, pitching: null, saber: { hitting: null, pitching: null } } }
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
const subline = (bio: MlbBio | null) => {
  const club = bio?.currentTeam?.id ? TEAM_NICKNAME[bio.currentTeam.id] ?? bio.currentTeam.name : 'Free agent'
  const pos = bio?.primaryPosition?.abbreviation
  return `${club}${pos ? ` · ${pos}` : ''}`
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

function Head({ id, side, onNavigate, onClear }: {
  id: number; side: Side; onNavigate: (to: string) => void; onClear?: () => void
}) {
  const name = side.bio?.fullName ?? 'Unknown player'
  const teamId = side.bio?.currentTeam?.id
  return (
    <CompareHead
      name={name}
      href={mlbPlayerPath({ id, fullName: side.bio?.fullName })}
      portrait={<Portrait id={id} name={name} teamId={teamId} />}
      badge={teamId && TEAM_ABBR[teamId] ? <TeamLogo teamId={teamId} abbr={TEAM_ABBR[teamId]} size={18} /> : undefined}
      subline={subline(side.bio)}
      onNavigate={onNavigate}
      onClear={onClear}
    />
  )
}

/** The duel's slices, in the order a reader asks: this year, then all of it, then October. */
function duelViews(duels: MlbDuel[], name: (s: MlbCompareSide) => string): HeadToHeadView[] {
  return duels.map(d => ({
    key: d.batter,
    heading: `${name(d.batter)} batting against ${name(d.batter === 'a' ? 'b' : 'a')}`,
    slices: ([
      [`${SEASON} regular season`, d.season],
      ['Career regular season', d.career],
      ['Career postseason', d.postseason],
    ] as const).flatMap(([label, c]) => (c ? [{ label, line: duelLine(c) }] : [])),
  }))
}

/** The likeliest duel's slices, for its skeleton: two players who have met mostly have this year
 *  and the career between them. */
const DUEL_SKELETON = [`${SEASON} regular season`, 'Career regular season']
/** The batting card's row counts, block by block: what a pair URL most often names is two hitters. */
const BATTING_BLOCKS = [2, 9, 5, 2]

function Picker({ candidates, onPick, skeleton }: {
  candidates: MlbCompareCandidate[]; onPick: (c: MlbCompareCandidate) => void; skeleton?: boolean
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
      limitNote={`The first ${PICK_LIMIT} by playing time. Search to find anyone else with a ${SEASON} line.`}
      emptyText={`Nobody by that name with a ${SEASON} line.`}
      onPick={key => { const c = byId.get(key); if (c) onPick(c) }}
    />
  )
}

// ─── The page ───────────────────────────────────────────────────────────────────

export default function MlbComparePage({ path, onNavigate }: { path: string; onNavigate: (to: string) => void }) {
  const target = mlbCompareTargetFromPath(path) ?? { kind: 'picker' as const }
  const ids = target.kind === 'pair' ? [target.a, target.b] : target.kind === 'single' ? [target.id] : []
  const idsKey = ids.join(',')

  // Keyed by the ids they belong to, so a pair changed in place never draws the last pair's
  // columns for a frame.
  const [sides, setSides] = useState<{ key: string; list: Side[] } | null>(null)
  useEffect(() => {
    if (!idsKey) return
    let cancelled = false
    Promise.all(idsKey.split(',').map(n => readSide(Number(n))))
      .then(list => { if (!cancelled) setSides({ key: idsKey, list }) })
    return () => { cancelled = true }
  }, [idsKey])
  const ready = !idsKey || sides?.key === idsKey
  const list = ready && idsKey ? sides!.list : []

  // The pools, only while there is a slot to fill.
  const picking = target.kind !== 'pair'
  const [pools, setPools] = useState<{ hitting: any[]; pitching: any[] } | null>(null)
  useEffect(() => {
    if (!picking || pools) return
    let cancelled = false
    Promise.all([fetchSeasonPlayerStats('hitting', SEASON), fetchSeasonPlayerStats('pitching', SEASON)])
      .then(([hitting, pitching]) => { if (!cancelled) setPools({ hitting, pitching }) })
    return () => { cancelled = true }
  }, [picking, pools])
  const subjectId = target.kind === 'single' ? target.id : null
  const candidates = useMemo(
    () => (pools ? rankMlbCompareCandidates(subjectId, pools.hitting, pools.pitching) : []),
    [pools, subjectId])

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
      .then(json => duelFromVsPlayer(json, SEASON, d.batter))
      .catch(() => null)))
      .then(found => { if (!cancelled) setDuels({ key: idsKey, list: found.filter((x): x is MlbDuel => x != null) }) })
    return () => { cancelled = true }
  }, [directions, idsKey])
  const duelsReady = directions.length === 0 || duels?.key === idsKey

  const groups = useMemo(() => (pairSides ? buildMlbComparison(pairSides[0].lines, pairSides[1].lines) : []), [pairSides])

  const nameOf = (s: Side | undefined) => s?.bio?.fullName ?? null
  const aName = nameOf(list[0]), bName = nameOf(list[1])

  // The tags for what ROUTES cannot describe: a pair is titled from two names that arrive with
  // their bios, and the half-picked state is noindex, a state rather than a page.
  useEffect(() => {
    const here = path.replace(/\/+$/, '')
    if (target.kind === 'single' && aName) {
      setDynamicSeo({ path: here, seo: {
        title: `Compare ${aName} with another MLB player | sportydolphin.fun`,
        description: `Pick an MLB player to put next to ${aName} and compare their ${SEASON} seasons.`,
        noindex: true,
      } })
      return () => setDynamicSeo(null)
    }
    if (target.kind === 'pair' && aName && bName) {
      setDynamicSeo({ path: here, seo: {
        title: `${aName} vs ${bName}: ${SEASON} MLB stats compared | sportydolphin.fun`,
        description: `${aName} and ${bName} side by side in ${SEASON}: batting, pitching, WAR, `
          + 'and every time they have faced each other.',
        canonical: mlbCompareCanonicalPath({ id: target.a, fullName: aName }, { id: target.b, fullName: bName }),
      } })
      return () => setDynamicSeo(null)
    }
  // `target` is rebuilt from `path` each render; its contents are all in the deps through it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, aName, bName])

  useEffect(() => {
    if (target.kind === 'pair' && ready) track(EVENTS.MLB_COMPARE_VIEWED, { a: target.a, b: target.b })
  // Once per pair, when it has drawn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, ready])

  const pick = (c: MlbCompareCandidate) => {
    const chosen = { id: c.id, fullName: c.name }
    if (target.kind === 'single') onNavigate(mlbComparePath({ id: target.id, fullName: aName }, chosen))
    else onNavigate(mlbCompareStartPath(chosen))
  }

  const standfirstNone = `Pick two players to put their ${SEASON} seasons side by side.`
  const back = { href: '/mlb', label: 'Back to MLB' }

  // LOADING IS THE PAGE THE URL WILL OPEN, drawn empty, as WPBL's is: which of the three shapes is
  // readable off the path before anything has arrived.
  if (!ready) {
    return (
      <StandalonePage
        maxWidth={chromePx(560)}
        back={back}
        title={target.kind === 'pair' ? <TextGhost>{GHOST_HEAD_NAME} vs {GHOST_HEAD_NAME}</TextGhost> : 'Compare players'}
        standfirst={target.kind === 'pair' ? undefined : <>Pick somebody to put next to <TextGhost>{GHOST_HEAD_NAME}</TextGhost>.</>}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
          <Box sx={HEAD_CARD}>
            <CompareHeadSkeleton withChange={target.kind === 'pair'} />
            <Typography aria-hidden sx={VS_SX}>vs</Typography>
            {target.kind === 'pair' ? <CompareHeadSkeleton withChange /> : <Box sx={PICK_SLOT}>Pick somebody below</Box>}
          </Box>
          {target.kind === 'pair'
            ? <CompareBlocksSkeleton title="Batting" blocks={BATTING_BLOCKS} />
            : (
              <SectionCard title="And who else">
                <Picker candidates={[]} onPick={() => {}} skeleton />
              </SectionCard>
            )}
        </Box>
      </StandalonePage>
    )
  }

  const [a, b] = list
  const title = target.kind === 'pair' ? `${aName ?? 'Unknown player'} vs ${bName ?? 'Unknown player'}` : 'Compare players'
  const standfirst = target.kind === 'pair' ? undefined
    : target.kind === 'single' ? `Pick somebody to put next to ${aName ?? 'this player'}.` : standfirstNone

  return (
    <StandalonePage maxWidth={chromePx(560)} back={back} title={title} standfirst={standfirst}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
        {target.kind !== 'picker' && (
          <Box sx={HEAD_CARD}>
            <Head id={ids[0]} side={a} onNavigate={onNavigate}
              onClear={target.kind === 'pair' ? () => onNavigate(mlbCompareStartPath({ id: target.b, fullName: bName })) : undefined} />
            <Typography aria-hidden sx={VS_SX}>vs</Typography>
            {target.kind === 'pair'
              ? <Head id={target.b} side={b} onNavigate={onNavigate}
                  onClear={() => onNavigate(mlbCompareStartPath({ id: target.a, fullName: aName }))} />
              : <Box sx={PICK_SLOT}>Pick somebody below</Box>}
          </Box>
        )}

        {picking && (
          <SectionCard title={target.kind === 'single' ? 'And who else' : 'Choose a player'}>
            <Picker candidates={candidates} onPick={pick} skeleton={!pools} />
          </SectionCard>
        )}

        {target.kind === 'pair' && (
          <>
            {/* The duel leads when there is one: it is the card no season table can draw. Its
                slot is held while the record is on its way, so the page does not jump by a card. */}
            {directions.length > 0 && (duelsReady
              ? <HeadToHeadCard duels={duelViews(duels?.list ?? [], s => (s === 'a' ? aName : bName) ?? 'Unknown player')} />
              : <HeadToHeadSkeleton labels={DUEL_SKELETON} />)}
            {groups.map(g => <CompareBlocksCard key={g.key} title={g.label} blocks={g.blocks} />)}
            {groups.length === 0 && (
              <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled' }}>
                Neither has a regular-season line in {SEASON}, so there is nothing to compare yet.
              </Typography>
            )}
            <CompareAgainLink href={MLB_COMPARE_BASE} onNavigate={onNavigate} />
          </>
        )}
      </Box>
    </StandalonePage>
  )
}
