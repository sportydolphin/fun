// /wpbl/compare: two players, side by side.
//
// WHY IT IS A PAGE AND NOT A PANEL. "Who is better, X or Y" is a thing people type, and it is
// the one question this section had no URL for. A comparison drawn inside a modal over the
// stats board cannot be linked, cannot be indexed, and cannot be sent to somebody mid-argument,
// which is the entire situation it exists to serve. routes.ts carries the URL rules, including
// why the pair is in the path and why none of these pages goes in the sitemap.
//
// THREE STATES, ONE ROUTE. /wpbl/compare is the picker with both slots empty; /wpbl/compare/<slug>
// is the picker with one filled, which is where a player page's "Compare" button lands; and
// /wpbl/compare/<a>-vs-<b> is the comparison. The middle one is a state rather than a page and
// is noindex for that reason, but it is still a real URL, so Back out of a comparison returns
// the reader to a half-made choice instead of to an empty sheet.
//
// EVERY READ HERE IS ALREADY CACHED APP-WIDE. Teams, the roster, the schedule and the league's
// batting and pitching lines are the same four reads Home and the percentile strip make, so for
// a reader arriving from anywhere in the section this page costs nothing. The play log, which
// only the head-to-head needs, is fetched separately and is allowed to never arrive: the rest
// of the page does not wait on it and renders identically without it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import {
  fetchWpblTeams, fetchWpblAllPlayers, fetchWpblSchedule, fetchWpblAllLines,
  fetchWpblPlayerMatchupPlays, getCachedWpblPlayerMatchupPlays,
  getCachedWpblAllPlayers, getCachedWpblAllLines,
} from './api'
import {
  buildWpblComparison, rankCompareCandidates,
  type WpblCompareGroup, type WpblCompareSide, type WpblCompareCandidate, type WpblMatchupCounts,
} from './derive/compare'
import type { WpblMatchupPlay } from './derive/matchups'
import { SectionCard, TeamBadge, PlayerPortrait, chromePx, TextGhost } from './ui'
import {
  CompareHead, CompareHeadSkeleton, CompareBlocksCard, CompareBlocksSkeleton, HeadToHeadCard, HeadToHeadSkeleton,
  ComparePicker, CompareAgainLink, duelLine, HEAD_CARD, VS_SX, PICK_SLOT, GHOST_HEAD_NAME,
  type ComparePick, type HeadToHeadView,
} from '../ui/compare'
import { buildPositionIndex, displayPositionFromIndex } from './positions'
import WpblPage from './WpblPage'
import { useEraBasis } from './EraBasisContext'
import {
  WPBL_COMPARE_BASE, WPBL_COMPARE_JOIN, wpblComparePath, wpblCompareCanonicalPath, wpblCompareStartPath,
  wpblCompareSlugFromPath, findWpblComparePair, findWpblPlayerBySlug, wpblPlayerPath,
} from './routes'
import { setDynamicSeo } from '../seo'
import { track, EVENTS } from '../lib/analytics'
import type { WpblPlayer, WpblTeam, WpblGame } from './types'

// The frame (heads, cards, rows, picker and their loading states) is src/ui/compare.tsx since
// Oct 9, 2026, shared with /mlb/compare. What stays here is what is WPBL's: the portrait and club
// badge, where a player has actually played, and the duel built from the league's own plays.

/**
 * One player's identity column, on the shared frame.
 *
 * `roster` is the WHOLE roster, because uniqueness cannot be judged from one row: a name two
 * players share takes the id-suffixed slug, and a one-element roster would happily mint the bare
 * one and link to nobody. `position` is where the player has actually taken the field, which is not
 * always what the roster filed (positions.ts: Kelsie Whitmore is listed RHP and plays centre field).
 *
 * THE NICKNAME, NOT THE FULL CLUB NAME, and the badge is why it can be. "San Francisco Firebells
 * · C" wraps onto two lines in a half-width column on any phone, which leaves the two heads
 * different heights.
 */
function WpblCompareHead({ player, team, roster, position, onNavigate, onClear }: {
  player: WpblPlayer
  team: WpblTeam | undefined
  roster: WpblPlayer[]
  position: string | null
  onNavigate: (to: string) => void
  onClear?: () => void
}) {
  return (
    <CompareHead
      name={player.name}
      href={wpblPlayerPath(player, roster)}
      portrait={<PlayerPortrait name={player.name} teamId={player.team_id} size={64} />}
      badge={team && <TeamBadge team={team} size={18} />}
      subline={`${team ? team.name : 'Free agent'}${position ? ` · ${position}` : ''}`}
      onNavigate={onNavigate}
      onClear={onClear}
    />
  )
}

/**
 * One group's table in Stathead's order: playing time, then the counting line, then the rates.
 * PLAYING TIME FIRST, ALWAYS, and drawn with no tick (see playedRow in derive/compare.ts): every
 * rate below is read against it, but more games is context, not a thing to be ahead on.
 * `qualified` and `barText` are still built and tested, for a surface that wants to mark the bar.
 */
function CompareGroupCard({ group }: { group: WpblCompareGroup }) {
  return <CompareBlocksCard title={group.label} blocks={[group.playingTime, group.counting, group.rate]} />
}

/**
 * What happened when they actually faced each other: THE REASON THIS PAGE IS WORTH BUILDING FOR
 * THIS LEAGUE IN PARTICULAR. Four clubs means a hitter sees the same pitcher again and again, a
 * sample a thirty-club league never produces. The playoffs are their own line and NEVER summed
 * into the season: a reader who set the player card to "Both" can add them, and one who did not
 * is not handed a total the standings would not recognise.
 */
function MatchupCard({ comparison, a, b }: {
  comparison: ReturnType<typeof buildWpblComparison>
  a: WpblPlayer
  b: WpblPlayer
}) {
  const name = (side: WpblCompareSide) => (side === 'a' ? a.name : b.name)
  const duels: HeadToHeadView[] = comparison.matchups.map(m => ({
    key: m.batter,
    heading: `${name(m.batter)} batting against ${name(m.batter === 'a' ? 'b' : 'a')}`,
    slices: ([['Regular season', m.regular], ['Playoffs', m.postseason]] as [string, WpblMatchupCounts | null][])
      .flatMap(([label, c]) => (c ? [{ label, line: duelLine(c) }] : [])),
  }))
  return <HeadToHeadCard duels={duels} />
}

/**
 * Choosing the other player, in the derive layer's order (see `rankCompareCandidates`), which
 * typing only filters. Uncapped: the box scrolls, and a cap would hide the back half of the roster.
 * Each row prints its sort key, the same figure the comparison leads with once picked.
 */
function PlayerPicker({ candidates, teams, positionOf, onPick, skeleton }: {
  candidates: WpblCompareCandidate[]
  skeleton?: boolean
  teams: WpblTeam[]
  /** Where the player has played, not what the roster filed: the same answer the header gives. */
  positionOf: (p: WpblPlayer) => string | null
  onPick: (p: WpblPlayer) => void
}) {
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const byId = useMemo(() => new Map(candidates.map(c => [c.player.id, c.player])), [candidates])
  const picks: ComparePick[] = useMemo(() => candidates.map(({ player: p, playedText }) => {
    const team = p.team_id ? teamById.get(p.team_id) : undefined
    return {
      key: p.id, name: p.name, position: positionOf(p), playedText,
      badge: team && <TeamBadge team={team} size={20} />,
    }
  }), [candidates, teamById, positionOf])
  return <ComparePicker candidates={picks} skeleton={skeleton} onPick={id => { const p = byId.get(id); if (p) onPick(p) }} />
}

// ─── The page ─────────────────────────────────────────────────────────────────

export default function WpblComparePage({ path, onNavigate }: {
  path: string
  onNavigate: (to: string) => void
}) {
  const { basis } = useEraBasis()

  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [games, setGames] = useState<WpblGame[]>([])
  const [lines, setLines] = useState(() => getCachedWpblAllLines())
  const [loading, setLoading] = useState(players.length === 0)
  // The first player's own plays, for the head-to-head alone: they hold every plate appearance
  // she had against anybody, so every duel with the second player is in there, and they cost a
  // few KB where the league log costs about 280. Tagged with whose they are, so a pair changed
  // in place never draws the last pair's duel for a frame. Allowed never to arrive; the card
  // simply does not render, as the percentile strip is allowed to be absent on a player page.
  const [plays, setPlays] = useState<{ id: string; data: WpblMatchupPlay[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblTeams(), fetchWpblAllPlayers(), fetchWpblSchedule(), fetchWpblAllLines()])
      .then(([t, p, g, l]) => {
        if (cancelled) return
        setTeams(t); setPlayers(p); setGames(g); setLines(l)
      })
      .catch(() => { /* the empty state below is the whole error path */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // What the URL names. Three shapes: no slug (empty picker), one slug (one slot filled), a
  // pair (the comparison). An unresolvable slug falls through to the empty picker rather than
  // to an error, because the edge function has already answered 404 for a URL naming nobody
  // and anything reaching here is a client-side push.
  const slug = wpblCompareSlugFromPath(path)
  const pair = useMemo(
    () => (slug && players.length > 0 ? findWpblComparePair(slug, players) : null),
    [slug, players])
  const single = useMemo(
    () => (slug && !pair && players.length > 0 ? findWpblPlayerBySlug(slug, players) : null),
    [slug, pair, players])

  const lead = pair?.[0] ?? null
  useEffect(() => {
    if (!lead) return
    let cancelled = false
    const seed = getCachedWpblPlayerMatchupPlays(lead)
    if (seed) setPlays({ id: lead.id, data: seed })
    fetchWpblPlayerMatchupPlays(lead)
      .then(data => { if (!cancelled) setPlays({ id: lead.id, data }) })
      // No head-to-head card; the page is what it was without it. Settled as empty rather than
      // left unset, which would hold the card's skeleton up for ever.
      .catch(() => { if (!cancelled) setPlays({ id: lead.id, data: [] }) })
    return () => { cancelled = true }
  }, [lead])

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // Where each of them has actually taken the field, which the roster's own listing routinely
  // gets wrong for a two-way player. Built from the whole league's batting lines rather than
  // per player, because that is the shape positions.ts offers and the lines are already here.
  const positionIndex = useMemo(
    () => buildPositionIndex(lines?.batting ?? [], games), [lines, games])
  const positionOf = useCallback((p: WpblPlayer) => displayPositionFromIndex(p, positionIndex).label, [positionIndex])

  // Who to offer for the empty slot, in the order to offer them. Recomputed only when the
  // league's lines or the chosen player move, which is once per page.
  const candidates = useMemo(
    () => (lines
      ? rankCompareCandidates(single, players, {
        games, batting: lines.batting, pitching: lines.pitching,
      })
      // Before the lines land there is no playing time to rank on, so the list is the roster
      // in name order rather than in an order that will visibly reshuffle a moment later.
      : [...players].sort((x, y) => x.name.localeCompare(y.name))
        .filter(p => p.id !== single?.id)
        .map(p => ({ player: p, pitcher: false, played: 0, playedText: '' }))),
    [lines, players, single, games])

  const comparison = useMemo(() => {
    if (!pair || !lines) return null
    return buildWpblComparison(pair[0], pair[1], {
      teams, games, batting: lines.batting, pitching: lines.pitching,
      plays: plays && plays.id === pair[0].id ? plays.data : undefined, basis,
    })
  }, [pair, lines, teams, games, plays, basis])

  // The tags for a pair, which ROUTES cannot describe: the names arrive with the roster, a
  // beat after the route does. Cleared on the way out so the registration cannot leak onto
  // whatever the reader opens next.
  useEffect(() => {
    if (!pair) {
      // The half-picked state is noindex: it is a state, not a page, and there are 118 of them
      // saying nothing that /wpbl/compare does not say better.
      if (slug) {
        setDynamicSeo({
          path: path.replace(/\/+$/, ''),
          seo: {
            title: 'Compare WPBL players | sportydolphin.fun',
            description: 'Pick two Women\'s Pro Baseball League players and compare their 2026 seasons.',
            noindex: true,
          },
        })
        return () => setDynamicSeo(null)
      }
      return
    }
    const [a, b] = pair
    setDynamicSeo({
      path: path.replace(/\/+$/, ''),
      seo: {
        title: `${a.name} vs ${b.name}: 2026 WPBL stats compared | sportydolphin.fun`,
        description:
          `${a.name} and ${b.name} side by side in the 2026 Women's Pro Baseball League: `
          + 'batting, pitching, playing time, and what happened when they faced each other.',
        // The columns follow the URL's order (the reader's), but both orders declare the same
        // alphabetical canonical, so the two spellings are one page to a search engine. That is
        // why the edge does not 301 one order onto the other.
        canonical: wpblCompareCanonicalPath(a, b, players),
      },
    })
    return () => setDynamicSeo(null)
  }, [pair, slug, path, players])

  useEffect(() => {
    if (pair) track(EVENTS.WPBL_COMPARE_VIEWED, { a: pair[0].id, b: pair[1].id })
  }, [pair])

  const pick = (chosen: WpblPlayer) => {
    if (single) onNavigate(wpblComparePath(single, chosen, players))
    else onNavigate(wpblCompareStartPath(chosen, players))
  }

  // LOADING IS THE PAGE THE URL WILL OPEN, drawn empty: the picker, one head and the picker, or two
  // heads and a comparison. Which one is readable off the slug before the roster can resolve it,
  // since a pair is the only spelling with the join in it. It was a centred spinner, which left
  // the footer 300px down the screen and threw it 500px further when the picker landed.
  const skeleton = loading && players.length === 0
  const shape = !slug ? 'none' : slug.toLowerCase().includes(WPBL_COMPARE_JOIN) ? 'pair' : 'single'
  if (skeleton) {
    return (
      <WpblPage
        maxWidth={chromePx(560)}
        title={shape === 'pair' ? <TextGhost>{GHOST_HEAD_NAME} vs {GHOST_HEAD_NAME}</TextGhost> : 'Compare players'}
        standfirst={shape === 'pair' ? undefined
          : shape === 'single' ? <>Pick somebody to put next to <TextGhost>{GHOST_HEAD_NAME}</TextGhost>.</>
          : 'Pick two players to put their 2026 seasons side by side.'}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
          {shape !== 'none' && (
            <Box sx={HEAD_CARD}>
              <CompareHeadSkeleton withChange={shape === 'pair'} />
              <Typography aria-hidden sx={VS_SX}>vs</Typography>
              {shape === 'pair' ? <CompareHeadSkeleton withChange /> : <Box sx={PICK_SLOT}>Pick somebody below</Box>}
            </Box>
          )}
          {shape === 'pair' ? (
            // A batter and a pitcher, the pair the matchups board links: the head-to-head, then a
            // pitching and a batting card in their three blocks each.
            <>
              <HeadToHeadSkeleton />
              <CompareBlocksSkeleton title="Pitching" blocks={[3, 4, 4]} />
              <CompareBlocksSkeleton title="Batting" blocks={[2, 9, 5]} />
            </>
          ) : (
            <SectionCard title={shape === 'single' ? 'And who else' : 'Choose a player'}>
              <PlayerPicker candidates={[]} teams={[]} positionOf={() => null} onPick={() => {}} skeleton />
            </SectionCard>
          )}
        </Box>
      </WpblPage>
    )
  }

  // NARROWER THAN THE SECTION'S USUAL BOARD. This page is two columns of figures and two
  // names, not a fourteen-column log: at 720 the two portraits sat a third of a screen apart
  // and read as two separate cards rather than as one comparison.
  return (
    <WpblPage
      // Narrower than the standard reading column: a comparison is two heads and two stat lines,
      // and at the full width the portraits sat a third of a screen apart and read as two cards.
      maxWidth={chromePx(560)}
      title={pair ? `${pair[0].name} vs ${pair[1].name}` : 'Compare players'}
      standfirst={!pair
        ? (single ? `Pick somebody to put next to ${single.name}.` : 'Pick two players to put their 2026 seasons side by side.')
        : undefined}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
      {(pair || single) && (
        <Box sx={HEAD_CARD}>
          <WpblCompareHead
            player={pair ? pair[0] : single!}
            team={(pair ? pair[0] : single!).team_id ? teamById.get((pair ? pair[0] : single!).team_id!) : undefined}
            roster={players}
            position={positionOf(pair ? pair[0] : single!)}
            onNavigate={onNavigate}
            onClear={pair ? () => onNavigate(wpblCompareStartPath(pair[1], players)) : undefined}
          />
          {/* A WORD, NOT A SWAP ICON. Two arrows between two names read as a control that swaps
          them, and there is nothing useful for it to do: the order is the one the reader built
          (routes.ts), and a button flipping it would mint a second spelling of a page that
          already has one canonical. "vs" says the same thing and promises nothing. */}
          <Typography aria-hidden sx={VS_SX}>vs</Typography>
          {pair ? (
            <WpblCompareHead
              player={pair[1]}
              team={pair[1].team_id ? teamById.get(pair[1].team_id) : undefined}
              roster={players}
              position={positionOf(pair[1])}
              onNavigate={onNavigate}
              onClear={() => onNavigate(wpblCompareStartPath(pair[0], players))}
            />
          ) : (
            <Box sx={PICK_SLOT}>
              Pick somebody below
            </Box>
          )}
        </Box>
      )}

      {!pair && (
        <SectionCard title={single ? 'And who else' : 'Choose a player'}>
          <PlayerPicker candidates={candidates} teams={teams} positionOf={positionOf} onPick={pick} />
        </SectionCard>
      )}

      {pair && comparison && (
        <>
          {/* THE DUEL LEADS when there is one. It is the one card here nobody else can draw, and
              it is what every name in a player card's matchup table promises: those links used to
              land a reader on two season tables with the head-to-head a thousand pixels below. */}
          {/* Its slot is held until the lead's plays land, which they do after everything else on
              the page: drawn without it, the page jumped down by a whole card a beat after loading. */}
          {plays?.id === pair[0].id
            ? <MatchupCard comparison={comparison} a={pair[0]} b={pair[1]} />
            : <HeadToHeadSkeleton />}
          {comparison.groups.map(g => (
            <CompareGroupCard key={g.key} group={g} />
          ))}
          {comparison.groups.length === 0 && (
            <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled' }}>
              Neither has a box-score line this season, so there is nothing to compare yet.
            </Typography>
          )}
          {/* A WAY OUT THAT IS NOT THE BACK BUTTON. Somebody who has just read one comparison
              usually wants another, and without this the only route to one is retyping a URL. */}
          <CompareAgainLink href={WPBL_COMPARE_BASE} onNavigate={onNavigate} />
        </>
      )}
      </Box>
    </WpblPage>
  )
}
