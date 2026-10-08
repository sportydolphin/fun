// The MLB player page, rebuilt in Oct 2026 on WPBL's card (src/ui/playerCard.tsx).
//
// It replaces a customizable "share card" (four auto-picked stats on a club-coloured tile, a
// palette shuffle, a PNG export) with a stat page: the club band, the whole season line with its
// league ranks, the game log, and what only MLB's feed can say (advanced metrics, splits, the
// pitch mix, a career, a contract). The card was a picture of a player; a reader who wanted an
// OBP had to open a menu to find it.
//
// IT FETCHES ITS OWN DATA (mlb/playerProfile.ts) instead of being fed seventy props by useMlbState,
// for the same reason WPBL's card does: so it can open as a page today and as the desktop side
// panel next (ROADMAP item 11) without the section's state having to know which.
//
// THE SHAPE IS WPBL'S, ROLE BY ROLE. A hitter sees hitting, a pitcher pitching. A genuine two-way
// season gets a role per tab on a phone and both roles stacked on a desktop; a cameo (a pitcher's
// handful of at-bats) is one line in the main role. Below the roles: the trend, fielding, the
// contract and the outside links, which belong to the player rather than to a role.

import React, { lazy, startTransition, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography, CircularProgress, useMediaQuery, useTheme } from '@mui/material'
import { EmojiEvents, Star, StarBorder } from '@mui/icons-material'
import {
  CARD_TYPE as TYPE, StatCardContext, SeasonPicker, LineCaption, SeasonLine, RateStrip, CameoBlock, StatLogTable,
  PlayerBand, BandBadge, BandChips, BAND_CHIP_SX, SectionHead, BATTING_BEST, PITCHING_BEST,
  type LineCol, type StatCardEnv,
} from '../../ui/playerCard'
import { DetailPageBar } from '../../ui/DetailPageBar'
import { ModalShell } from '../../ui/ModalShell'
import { ExpandButton } from '../../ui/ExpandButton'
import { HeaderChipLabel, HEADER_ICON_SX, headerChipSx } from '../../ui/headerBar'
import { PillGroup } from '../../ui/PillGroup'
import { hoverOnly, pressable } from '../../ui/interaction'
import { chromePx } from '../../ui/scale'
import { CopyLinkButton } from '../../ui/CopyLinkButton'
import { SegControl, linkPillSx } from '../components/ui'
import { ContractPanel } from '../components/ContractPanel'
import { MlbPageH1, MlbHiddenH1 } from '../components/PageHeading'
import { mlbShareUrl, trackMlbShare } from '../components/CopyLink'
import { ACCENT_TEXT, CURRENT_SEASON, HEADSHOT_SQUARE, TEAM_NICKNAME, TEAM_SECONDARY, teamPalette } from '../constants'
import { fetchPlayerContract } from '../api'
import { careerSpan } from '../lib/utils'
import { mlbClubById } from '../routes'
import { mlbStatFull, mlbStatPlain } from '../statGlossary'
import {
  fetchMlbBio, fetchCareer, fetchSeasonBundle, fetchPostseasonLines, fetchSeasonLog, fetchSeasonRanks,
  fetchPitchMix, fetchAwards, careerTrendSplits, planRoles, scopedLine, scopedLog, cameToPlate, decision,
  ipToOuts, birthplace, draftLine,
  type Role, type CardScope, type MlbBio, type Career, type SeasonBundle, type LogGame, type SeasonRanks,
  type PitchUsage, type AwardTally, type FieldingLine,
} from '../playerProfile'
import type { Player, PlayerContract } from '../types'
import type { PlayerSeason } from '../state/useMlbState'
import { combineStatLines } from '../lib/gameScope'

// ~640-line chart module, lazy so it loads with the trend section rather than the page.
const PlayerTrendsChart = lazy(() => import('../components/PlayerTrendsChart').then(m => ({ default: m.PlayerTrendsChart })))

// ─── What the shared parts need from MLB ─────────────────────────────────────────

const statTip = (k: string): React.ReactNode => {
  const full = mlbStatFull(k)
  if (!full) return null
  const plain = mlbStatPlain(k)
  return plain ? <><Box sx={{ fontWeight: 700 }}>{full}</Box><Box sx={{ mt: 0.25 }}>{plain}</Box></> : full
}

/**
 * Top ten, not WPBL's top five. A counting rank is printed and a rate lit only at or above it, and
 * the bar is about the size of the field: fifth of thirty-odd qualified WPBL hitters is roughly
 * where tenth of a hundred and forty MLB ones is. At five, an MLB card lights almost nothing.
 */
const MLB_RANK_BAR = 10
/** A counting rank needs a field this big to mean anything. */
const MIN_FIELD = 10

/** The leaderboard stat each ranked column opens, so a rank on the card goes to the table it was
 *  taken from with the player picked out (useMlbState's handleStatCardClick). */
const BOARD_KEY: Record<Role, Record<string, string>> = {
  hitting: { AVG: 'avg', OBP: 'obp', SLG: 'slg', OPS: 'ops', H: 'h', '2B': '2b', '3B': '3b', HR: 'hr', RBI: 'rbi', SB: 'sb', BB: 'bb' },
  pitching: { ERA: 'era', WHIP: 'whip', 'K/9': 'so9', SO: 'k', IP: 'ip', SV: 'sv' },
}

// ─── Formatting ──────────────────────────────────────────────────────────────────

const n0 = (v: any): number => Number(v ?? 0) || 0
/** A rate as StatsAPI prints it (".312"), or a dash for none. */
const rate = (v: any): string => (v == null || v === '' || v === '-.--' ? '—' : String(v))
const dec = (v: any, d: number): string => (v == null || isNaN(Number(v)) ? '—' : Number(v).toFixed(d))
/** A fraction (".322" or 0.322) as a percentage, one decimal. */
const pct = (v: any): string => (v == null || isNaN(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(1)}%`)
/** wOBA-style: three places with no leading zero. */
const r3 = (v: any): string => {
  if (v == null || isNaN(Number(v))) return '—'
  const s = Number(v).toFixed(3)
  return s.startsWith('0.') ? s.slice(1) : s
}
const outsToIp = (outs: number): string => `${Math.floor(outs / 3)}.${outs % 3}`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = (iso: string): string => {
  const [, m, d] = iso.split('-').map(Number)
  return m && d ? `${MONTHS[m - 1]} ${d}` : '—'
}
/** A postseason round, for marking October games when the log shows both. */
const ROUND: Record<string, string> = { F: 'WC', D: 'DS', L: 'CS', W: 'WS' }

const sectionSx = { ...TYPE.label, color: 'text.secondary', mb: 1 } as const

/** Ten games before "Show more", where WPBL's card opens on five: five is under a week of a
 *  162-game schedule, and the jump from there to "Show 124 more" was most of a season. */
const MLB_LOG_PREVIEW = 10

// ─── Loading ─────────────────────────────────────────────────────────────────────

/** The value `load` resolves to for `key`, or undefined until it lands. A late answer for a key the
 *  page has moved past is dropped; null as a key loads nothing.
 *
 *  Applied as a transition. The card makes nine of these reads and each answer re-renders all of
 *  it, at whatever moment it lands; as an ordinary update every one is a block of main-thread work
 *  that a sheet sliding up or a panel sliding in has to wait out. A transition lets React render it
 *  between frames, the same rule WPBL's card follows (see lateUpdate in PlayerDetail). */
function useLoaded<T>(key: string | null, load: () => Promise<T>): T | undefined {
  const [got, setGot] = useState<{ key: string; value: T } | null>(null)
  useEffect(() => {
    if (key == null) return
    let live = true
    load().then(value => { if (live) startTransition(() => setGot({ key, value })) }).catch(() => { /* the block omits itself */ })
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return got && got.key === key ? got.value : undefined
}

// ─── Pieces ──────────────────────────────────────────────────────────────────────

/** A pitcher's mix: one row per pitch, its share as a bar and its average speed. */
function PitchMix({ pitches }: { pitches: PitchUsage[] }) {
  if (pitches.length === 0) return null
  const total = pitches.reduce((t, p) => t + p.count, 0)
  // Bars against the most-thrown pitch rather than against 100%, so a mix led at 40% fills the
  // column instead of using two fifths of it.
  const top = Math.max(...pitches.map(p => p.share), 0.01)
  return (
    <Box sx={{ mt: 2.5 }}>
      <SectionHead title="Pitch mix" caption={`${total.toLocaleString()} pitches`} />
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 8.5rem) 1fr 3rem 3.75rem', columnGap: 1, rowGap: 0.6, alignItems: 'center' }}>
        {pitches.map(p => (
          <React.Fragment key={p.code}>
            <Typography sx={{ ...TYPE.body, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</Typography>
            <Box sx={{ height: 6, borderRadius: 999, bgcolor: 'action.hover', overflow: 'hidden' }}>
              <Box sx={{ width: `${Math.round((p.share / top) * 100)}%`, height: '100%', bgcolor: ACCENT_TEXT, borderRadius: 999 }} />
            </Box>
            <Typography sx={{ ...TYPE.body, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{(p.share * 100).toFixed(1)}%</Typography>
            <Typography sx={{ ...TYPE.body, color: 'text.secondary', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {p.mph != null ? `${p.mph.toFixed(1)}` : '—'}<Box component="span" sx={{ ...TYPE.micro, ml: 0.3 }}>mph</Box>
            </Typography>
          </React.Fragment>
        ))}
      </Box>
    </Box>
  )
}

/** Fielding, one line per position played, most-played first. Last among the stats, as on WPBL's
 *  card: it is the least telling number here. */
function Fielding({ lines }: { lines: FieldingLine[] }) {
  if (lines.length === 0) return null
  const join = (parts: (string | null)[]) => parts.filter(Boolean).join(' · ')
  return (
    <Box sx={{ mt: 2.5 }}>
      <SectionHead title="Fielding" />
      {lines.slice(0, 4).map(f => {
        const s = f.stat
        const catcher = f.position === 'C' && (s.stolenBases != null || s.caughtStealing != null)
        return (
          <Typography key={f.position} sx={{ ...TYPE.body, color: 'text.secondary', fontVariantNumeric: 'tabular-nums', mb: 0.25 }}>
            <Box component="span" sx={{ fontWeight: 800, color: 'text.primary', mr: 0.75 }}>{f.position}</Box>
            {join([
              `${n0(s.gamesPlayed)} G`,
              s.innings && s.innings !== '0.0' ? `${s.innings} INN` : null,
              `${rate(s.fielding)} FPCT`,
              `${n0(s.errors)} ${n0(s.errors) === 1 ? 'error' : 'errors'}`,
              n0(s.doublePlays) ? `${n0(s.doublePlays)} DP` : null,
              catcher ? `${n0(s.caughtStealing)} of ${n0(s.caughtStealing) + n0(s.stolenBases)} thrown out` : null,
              catcher && n0(s.passedBall) ? `${n0(s.passedBall)} PB` : null,
            ])}
          </Typography>
        )
      })}
    </Box>
  )
}

/** Follow / Following, beside Copy link and drawn the same way. Followed players lead Home. */
function FollowChip({ followed, onToggle, name }: { followed: boolean; onToggle: () => void; name: string }) {
  const Icon = followed ? Star : StarBorder
  return (
    <Box {...pressable(onToggle)} aria-pressed={followed}
      title={followed ? `Stop following ${name}` : `Follow ${name} on your Home page`}
      sx={{
        ...headerChipSx,
        ...(followed ? { color: ACCENT_TEXT, ...hoverOnly({ bgcolor: 'action.hover', color: ACCENT_TEXT }) } : {}),
      }}>
      <HeaderChipLabel icon={<Icon aria-hidden sx={HEADER_ICON_SX} />}>{followed ? 'Following' : 'Follow'}</HeaderChipLabel>
    </Box>
  )
}

// ─── The page ────────────────────────────────────────────────────────────────────

export interface MlbPlayerDetailProps {
  playerId: number
  /** What the section already knows (name, position, club) for the first paint, before the bio lands. */
  player: Player | null
  /** The season on screen, 'career' for the whole career, or null for the card's own choice: this
   *  season if the player has one, else the last one played. Controlled, so Back can restore it. */
  season: PlayerSeason | null
  onSeasonChange: (season: PlayerSeason) => void
  /** The page's back control. Required for the page; the panel's (see `panel`) is optional. */
  onBack?: () => void
  /** A league rank opens the leaderboard for that stat, the player picked out. */
  onOpenBoard: (statKey: string, group: Role) => void
  onOpenGame: (gamePk: number) => void
  followed: boolean
  onToggleFollow: () => void
  /** Draw as the desktop side panel (views/MlbPlayerPanel.tsx) instead of a page. `onBack` is then
   *  the panel's own back control, for a player opened over Game Center, and is optional. */
  panel?: boolean
  /** The panel's close, which every way out of it goes through. */
  onClose?: () => void
  backLabel?: string
  /** The panel's Expand, to the full page. */
  onExpand?: () => void
  /** The player's name once the bio has it, for an address and a title that need one. */
  onName?: (name: string) => void
}

export default function MlbPlayerDetail({ playerId, player, season: seasonProp, onSeasonChange, onBack, onOpenBoard, onOpenGame, followed, onToggleFollow, panel = false, onClose, backLabel, onExpand, onName }: MlbPlayerDetailProps) {
  // `&& !panel` because THIS component renders the panel's shell, so its own hooks run outside the
  // shell's theme and still see the desktop. Everything inside the card reads the panel's theme.
  const mdUp = useMediaQuery(useTheme().breakpoints.up('md'))
  const wide = mdUp && !panel
  const bio = useLoaded<MlbBio | null>(`${playerId}`, () => fetchMlbBio(playerId))
  const career = useLoaded<Career>(`${playerId}`, () => fetchCareer(playerId))
  const awards = useLoaded<AwardTally[]>(`${playerId}`, () => fetchAwards(playerId)) ?? []
  const contract = useLoaded<PlayerContract | null>(`${playerId}`, () => fetchPlayerContract(playerId))

  // Every season with a line, newest first.
  const seasons = useMemo(
    () => career ? [...new Set([...career.hitting, ...career.pitching].map(r => r.season))].sort((a, b) => b - a) : [],
    [career])
  // This season if there is one, else the last played: a retired player opens on their final year
  // rather than on an empty page, as the old card did.
  //
  // CAREER is the same page over the career totals: the line, the year-by-year and the trend, and
  // none of what only a season has (a game log, splits, ranks, a pitch mix), which it does not
  // fetch. `season` stays the default year underneath, for the band's club and the trend's label.
  const careerView = seasonProp === 'career'
  const season = typeof seasonProp === 'number' ? seasonProp
    : (career ? (seasons.includes(CURRENT_SEASON) ? CURRENT_SEASON : seasons[0] ?? CURRENT_SEASON) : null)
  const key = season != null && !careerView ? `${playerId}-${season}` : null
  const bundle = useLoaded<SeasonBundle>(key, () => fetchSeasonBundle(playerId, season!))
  const post = useLoaded(key, () => fetchPostseasonLines(playerId, season!))
  const log = useLoaded<LogGame[]>(key, () => fetchSeasonLog(playerId, season!))

  const name = bio?.fullName ?? player?.fullName ?? 'Player'
  const knownName = bio?.fullName ?? player?.fullName
  useEffect(() => { if (knownName) onName?.(knownName) }, [knownName]) // eslint-disable-line react-hooks/exhaustive-deps
  const positionCode = bio?.primaryPosition?.code ?? player?.primaryPosition?.code ?? ''

  // Regular / Playoffs / Both. Offered only for a season with a postseason line, and back to the
  // regular season whenever the season changes, since the next one may have none.
  const [scope, setScope] = useState<CardScope>('regular')
  useEffect(() => { setScope('regular') }, [playerId, seasonProp])
  const hasPost = !careerView && !!(post?.hitting || post?.pitching)
  // The career line is StatsAPI's own career total, or the seasons added up if that read failed.
  const careerLine = (r: Role): any | null =>
    career ? career.totals[r] ?? career[r].reduce((acc, row) => combineStatLines(acc, row.stat), null as any) : null
  const lines: Record<Role, any | null> = careerView
    ? { hitting: careerLine('hitting'), pitching: careerLine('pitching') }
    : {
      hitting: bundle ? scopedLine(bundle.hitting, post?.hitting ?? null, hasPost ? scope : 'regular') : null,
      pitching: bundle ? scopedLine(bundle.pitching, post?.pitching ?? null, hasPost ? scope : 'regular') : null,
    }
  const plan = planRoles(positionCode, lines.hitting, lines.pitching)
  const [roleTab, setRoleTab] = useState<Role | null>(null)
  useEffect(() => { setRoleTab(null) }, [playerId])
  const activeRole: Role = roleTab && plan.roles.includes(roleTab) ? roleTab : plan.roles[0]

  // Ranks against the regular season's pool and its qualifying bar, so they stand down in any other
  // scope (a five-game October line ranked against a 162-game field is not a rank).
  const rankHit = useLoaded<SeasonRanks>(key && lines.hitting ? `${key}-h` : null, () => fetchSeasonRanks(playerId, 'hitting', season!))
  const rankPit = useLoaded<SeasonRanks>(key && lines.pitching ? `${key}-p` : null, () => fetchSeasonRanks(playerId, 'pitching', season!))
  const ranksFor = (r: Role): SeasonRanks | undefined => (scope === 'regular' || !hasPost ? (r === 'hitting' ? rankHit : rankPit) : undefined)
  const pitchMix = useLoaded<PitchUsage[]>(key && plan.roles.includes('pitching') ? `${key}-mix` : null, () => fetchPitchMix(playerId, season!))

  // The club the season was played for: the band wears it, so a 2019 page of a player since traded
  // is in that year's colours. A traded season ends with the last club.
  const seasonTeamId = useMemo(() => {
    if (!career || season == null) return null
    const row = [...career.hitting, ...career.pitching].find(r => r.season === season)
    return row?.lastTeamId ?? null
  }, [career, season])
  const teamId = (season === CURRENT_SEASON ? (bio?.currentTeam?.id ?? player?.currentTeam?.id) : null) ?? seasonTeamId ?? bio?.currentTeam?.id ?? player?.currentTeam?.id
  const club = teamId != null ? mlbClubById(teamId) : undefined
  const palette = teamPalette(teamId ?? undefined)

  const cardEnv = useMemo<StatCardEnv>(() => ({ tip: statTip, ink: ACCENT_TEXT, rankBar: MLB_RANK_BAR }), [])

  // Back to the top of the card on a new season, which is a different page in all but address.
  const topRef = useRef<HTMLDivElement>(null)
  const pickSeason = (s: PlayerSeason) => {
    onSeasonChange(s)
    const top = topRef.current?.getBoundingClientRect().top
    // In the panel the card scrolls inside the shell, whose top is not the window's.
    if (top != null && (panel || top < 0)) topRef.current?.scrollIntoView({ block: 'start' })
  }

  // ── per role ──────────────────────────────────────────────────────────────

  const rankCell = (r: Role, label: string, value: number | null, rate = false): LineCol['rank'] => {
    const rk = ranksFor(r)?.ranks[label]
    if (!rk) return null
    if (rate) return rk
    return rk.of >= MIN_FIELD && rk.rank <= MLB_RANK_BAR && (value ?? 0) > 0 ? rk : null
  }
  const boardLink = (r: Role, label: string) => {
    const k = BOARD_KEY[r][label]
    return k && (scope === 'regular' || !hasPost) ? () => onOpenBoard(k, r) : undefined
  }
  const col = (r: Role, label: string, value: string | number, rankValue?: number | null): LineCol => ({
    label, value, rank: rankValue !== undefined ? rankCell(r, label, rankValue) : null, onRank: boardLink(r, label),
  })

  /** A reliever's line leads with the reliever's own count where a starter's leads with the record,
   *  as it does on every stat site: 2-3 says nothing about a closer, 31 SV says what the season was.
   *  Saves or holds, whichever there are more of, so a setup man with 33 holds and 4 saves leads
   *  with the 33. */
  const relieverLead = (s: any): 'SV' | 'HLD' | null => {
    if (n0(s.gamesStarted) > 0) return null
    const sv = n0(s.saves), hld = n0(s.holds)
    if (!sv && !hld) return null
    return sv >= hld ? 'SV' : 'HLD'
  }
  const isReliever = (s: any) => n0(s.gamesStarted) === 0 && n0(s.gamesPlayed ?? s.gamesPitched) > 0

  /**
   * THE HEADLINE: the four numbers every stat site leads a player with. AVG, HR, RBI and OPS for a
   * hitter; W-L (or saves), ERA, strikeouts and WHIP for a pitcher. ESPN's player header and
   * MLB.com's are these same four, so a reader arriving from either finds them where they look.
   * They carry their league rank with its field ("36th of 135"), which the line below does not.
   */
  const headline = (r: Role) => {
    const s = lines[r] ?? {}
    const rateCell = (label: string, value: string) => ({ label, value, rank: rankCell(r, label, null, true), onRank: boardLink(r, label) })
    // A count's place in the whole field, not gated to the top five as the line's are: here it is
    // the headline's own figure, as a rate's is. Nothing for a zero, which is not a place.
    const countCell = (label: string, value: number) => {
      const rk = ranksFor(r)?.ranks[label]
      return { label, value: String(value), rank: rk && value > 0 ? rk : null, onRank: boardLink(r, label) }
    }
    if (r === 'pitching') {
      return [
        relieverLead(s) === 'SV' ? countCell('SV', n0(s.saves))
          : relieverLead(s) === 'HLD' ? countCell('HLD', n0(s.holds))
            : { label: 'W-L', value: `${n0(s.wins)}-${n0(s.losses)}` },
        rateCell('ERA', rate(s.era)),
        countCell('SO', n0(s.strikeOuts)),
        rateCell('WHIP', rate(s.whip)),
      ]
    }
    return [rateCell('AVG', rate(s.avg)), countCell('HR', n0(s.homeRuns)), countCell('RBI', n0(s.rbi)), rateCell('OPS', rate(s.ops))]
  }

  /**
   * THE STANDARD LINE, in MLB.com's own column order: counting stats, then the rates at the end, as
   * every stat site's table has them. Every column always drawn, so 3B and CS sit where a reader
   * expects them even at zero. The less-read columns (HBP, SH, SF, GDP; HBP, WP, BK) follow the rates
   * only once they have happened, in Baseball-Reference's order (GDP, HBP, SH, SF), and the pitch count
   * closes a pitching line as the one figure saying how hard the innings were.
   *
   * A stat in the headline keeps its rank there and not here, so no figure is ranked twice.
   */
  const seasonCols = (r: Role): LineCol[] => {
    const s = lines[r] ?? {}
    const inHead = new Set(headline(r).map(c => c.label))
    // A rate in the line is ranked only at the counting bar: "1st" under OBP, never "36th".
    const rateCol = (label: string, value: string): LineCol => {
      const rk = ranksFor(r)?.ranks[label]
      return { label, value, rank: !inHead.has(label) && rk && rk.rank <= MLB_RANK_BAR ? rk : null, onRank: boardLink(r, label) }
    }
    const countCol = (label: string, value: number, ranked = true) =>
      col(r, label, value, ranked && !inHead.has(label) ? value : undefined)
    if (r === 'pitching') {
      return [
        countCol('W', n0(s.wins)),
        countCol('L', n0(s.losses), false),
        rateCol('ERA', rate(s.era)),
        countCol('G', n0(s.gamesPlayed ?? s.gamesPitched), false),
        countCol('GS', n0(s.gamesStarted), false),
        countCol('SV', n0(s.saves)),
        // Holds beside saves, where a reliever's line keeps them, and only once there are any: a
        // starter's line has no use for the column. It used to be a stray "18 HLD" in the caption.
        ...(n0(s.holds) ? [countCol('HLD', n0(s.holds), false)] : []),
        { ...col(r, 'IP', s.inningsPitched ?? '0.0', ipToOuts(s.inningsPitched)) },
        countCol('H', n0(s.hits), false),
        countCol('R', n0(s.runs), false),
        countCol('ER', n0(s.earnedRuns), false),
        countCol('HR', n0(s.homeRuns), false),
        countCol('BB', n0(s.baseOnBalls), false),
        countCol('SO', n0(s.strikeOuts)),
        rateCol('WHIP', rate(s.whip)),
        ...(n0(s.hitBatsmen) ? [countCol('HBP', n0(s.hitBatsmen), false)] : []),
        ...(n0(s.wildPitches) ? [countCol('WP', n0(s.wildPitches), false)] : []),
        ...(n0(s.balks) ? [countCol('BK', n0(s.balks), false)] : []),
        countCol('P', n0(s.numberOfPitches), false),
      ]
    }
    return [
      countCol('G', n0(s.gamesPlayed), false),
      countCol('AB', n0(s.atBats), false),
      countCol('R', n0(s.runs)),
      countCol('H', n0(s.hits)),
      countCol('2B', n0(s.doubles)),
      countCol('3B', n0(s.triples)),
      countCol('HR', n0(s.homeRuns)),
      countCol('RBI', n0(s.rbi)),
      countCol('BB', n0(s.baseOnBalls)),
      // Never ranked: second in the league in strikeouts is not an achievement.
      countCol('SO', n0(s.strikeOuts), false),
      countCol('SB', n0(s.stolenBases)),
      countCol('CS', n0(s.caughtStealing), false),
      { ...rateCol('AVG', rate(s.avg)), breakBefore: true },
      rateCol('OBP', rate(s.obp)),
      rateCol('SLG', rate(s.slg)),
      rateCol('OPS', rate(s.ops)),
      // The extras start a row of their own when the line folds, whichever of them is first.
      ...[
        ...(n0(s.groundIntoDoublePlay) ? [countCol('GDP', n0(s.groundIntoDoublePlay), false)] : []),
        ...(n0(s.hitByPitch) ? [countCol('HBP', n0(s.hitByPitch), false)] : []),
        ...(n0(s.sacBunts) ? [countCol('SH', n0(s.sacBunts), false)] : []),
        ...(n0(s.sacFlies) ? [countCol('SF', n0(s.sacFlies), false)] : []),
      ].map((c, i) => (i === 0 ? { ...c, breakBefore: true } : c)),
    ]
  }

  /** The season line's caption: which season (and the picker), how much of one, the scope toggle. */
  const lineCaption = (r: Role, withScope: boolean) => {
    const s = lines[r] ?? {}
    const rk = ranksFor(r)
    // The shortfall is a distance still to cover, so only for a season still being played: on a
    // finished one "496 PA from qualifying" reads as a target for a year that is over.
    const live = !careerView && season === CURRENT_SEASON
    const noun = hasPost && scope === 'post' ? 'postseason' : 'season'
    // How many seasons the career line covers, for this role: a pitcher's two years at the plate in
    // an NL park are not nine seasons of batting.
    const span = careerView ? career?.[r].length ?? 0 : 0
    // Games and the record are columns of the line now, so the caption carries only what the line
    // does not: plate appearances and how far a live season is from qualifying.
    const parts: string[] = []
    if (careerView) parts.push(`${span} ${span === 1 ? 'season' : 'seasons'}`)
    if (r === 'pitching') {
      const short = rk ? Math.max(0, rk.minOuts - ipToOuts(s.inningsPitched)) : 0
      // Not for a reliever, who is not chasing an ERA title: "9.1 IP from qualifying" under a
      // setup man's line is a target nobody in that job is aiming at.
      if (!isReliever(s) && live && rk && short > 0 && !rk.ranks.ERA) parts.push(`${outsToIp(short)} IP from qualifying`)
    } else {
      const pa = n0(s.plateAppearances)
      const short = rk ? Math.max(0, rk.minPa - pa) : 0
      parts.push(`${pa} PA`)
      if (live && rk && short > 0 && !rk.ranks.AVG) parts.push(`${short} PA from qualifying`)
    }
    return (
      <LineCaption
        picker={<SeasonPicker career label={careerView ? 'Career' : `${season} ${noun}`} season={careerView ? 'career' : season!}
          seasons={seasons} onChange={pickSeason} />}
        meta={parts.join(' · ')}
        control={withScope && hasPost ? (
          <PillGroup
            options={[{ value: 'regular', label: 'Regular' }, { value: 'post', label: 'Playoffs' }, { value: 'all', label: 'Both' }]}
            value={scope}
            onChange={v => setScope(v as CardScope)}
          />
        ) : undefined}
      />
    )
  }

  const roleLog = (r: Role): LogGame[] =>
    log ? scopedLog(log, hasPost ? scope : 'regular').filter(g => (r === 'hitting' ? cameToPlate(g.hitting) : !!g.pitching)) : []

  const logTable = (r: Role) => {
    const games = roleLog(r)
    // The totals row says which games it adds up, since the scope toggle sits a table away. Only
    // off the regular season: on it the row repeated the season line a few inches above, figure for
    // figure, and on a phone it was the most cramped row on the card.
    const withTotals = hasPost && scope !== 'regular'
    const totalsLabel = scope === 'post' ? 'Postseason' : 'Total'
    const s = lines[r] ?? {}
    const lead = (g: LogGame) => [
      ROUND[g.gameType] ? `${shortDate(g.date)} ${ROUND[g.gameType]}` : shortDate(g.date),
      `${g.isHome ? 'vs' : '@'} ${g.opponentAbbr}`,
    ]
    if (r === 'pitching') {
      return (
        <StatLogTable title="Game log" accent={ACCENT_TEXT} best={PITCHING_BEST} totalsLabel={totalsLabel} preview={MLB_LOG_PREVIEW}
          statHeaders={['DEC', 'IP', 'H', 'R', 'ER', 'HR', 'BB', 'SO', 'P']}
          totals={!withTotals ? undefined : [`${n0(s.wins)}-${n0(s.losses)}`, s.inningsPitched ?? '0.0', n0(s.hits), n0(s.runs), n0(s.earnedRuns), n0(s.homeRuns), n0(s.baseOnBalls), n0(s.strikeOuts), n0(s.numberOfPitches)]}
          rows={games.map(g => {
            const p = g.pitching
            return { lead: lead(g), onOpen: () => onOpenGame(g.gamePk), cells: [decision(p), p.inningsPitched ?? '0.0', n0(p.hits), n0(p.runs), n0(p.earnedRuns), n0(p.homeRuns), n0(p.baseOnBalls), n0(p.strikeOuts), p.numberOfPitches ?? '—'] }
          })}
        />
      )
    }
    return (
      <StatLogTable title="Game log" accent={ACCENT_TEXT} best={BATTING_BEST} totalsLabel={totalsLabel} preview={MLB_LOG_PREVIEW}
        statHeaders={['POS', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'BB', 'SO', 'TB']}
        totals={!withTotals ? undefined : ['—', n0(s.atBats), n0(s.runs), n0(s.hits), n0(s.doubles), n0(s.triples), n0(s.homeRuns), n0(s.rbi), n0(s.stolenBases), n0(s.baseOnBalls), n0(s.strikeOuts), n0(s.totalBases)]}
        rows={games.map(g => {
          const h = g.hitting
          return { lead: lead(g), onOpen: () => onOpenGame(g.gamePk), cells: [g.positions || '—', n0(h.atBats), n0(h.runs), n0(h.hits), n0(h.doubles), n0(h.triples), n0(h.homeRuns), n0(h.rbi), n0(h.stolenBases), n0(h.baseOnBalls), n0(h.strikeOuts), n0(h.totalBases)] }
        })}
      />
    )
  }

  /** The metrics only StatsAPI's sabermetric and Statcast reads carry. Regular season only, since
   *  that is all StatsAPI computes them for. */
  const advanced = (r: Role) => {
    if (!bundle || (hasPost && scope !== 'regular')) return null
    const sab = bundle.saber[r], adv = bundle.advanced[r], xs = bundle.expected[r]
    if (!sab && !adv && !xs) return null
    const cells: LineCol[] = r === 'pitching' ? [
      { label: 'WAR', value: dec(sab?.war, 1) },
      { label: 'FIP', value: dec(sab?.fip, 2) },
      { label: 'xFIP', value: dec(sab?.xfip, 2) },
      { label: 'ERA-', value: sab?.eraMinus != null ? Math.round(sab.eraMinus) : '—' },
      { label: 'K%', value: pct(adv?.strikeoutsPerPlateAppearance) },
      { label: 'BB%', value: pct(adv?.walksPerPlateAppearance) },
      { label: 'K-BB%', value: pct(adv?.strikeoutsMinusWalksPercentage) },
      { label: 'Whiff%', value: pct(adv?.whiffPercentage) },
      { label: 'BABIP', value: rate(adv?.babip) },
      { label: 'xBA', value: rate(xs?.avg) },
      { label: 'xwOBA', value: rate(xs?.woba) },
    ] : [
      { label: 'WAR', value: dec(sab?.war, 1) },
      { label: 'wRC+', value: sab?.wRcPlus != null ? Math.round(sab.wRcPlus) : '—' },
      { label: 'wOBA', value: r3(sab?.woba) },
      { label: 'xBA', value: rate(xs?.avg) },
      { label: 'xSLG', value: rate(xs?.slg) },
      { label: 'xwOBA', value: rate(xs?.woba) },
      { label: 'BABIP', value: rate(adv?.babip) },
      { label: 'ISO', value: rate(adv?.iso) },
      { label: 'K%', value: pct(adv?.strikeoutsPerPlateAppearance) },
      { label: 'BB%', value: pct(adv?.walksPerPlateAppearance) },
      { label: 'Whiff%', value: adv?.totalSwings ? pct(n0(adv.swingAndMisses) / n0(adv.totalSwings)) : '—' },
    ]
    return (
      <Box sx={{ mt: 2.5 }}>
        <SectionHead title="Advanced" caption="WAR and wRC+ by FanGraphs' method · x-stats from Statcast" />
        <SeasonLine cols={cells} />
      </Box>
    )
  }

  const splitsTable = (r: Role) => {
    if (!bundle || (hasPost && scope !== 'regular')) return null
    const rows = bundle.splits[r]
    if (rows.length === 0) return null
    const hand = r === 'pitching' ? 'B' : 'P'
    const name: Record<string, string> = { vl: `vs LH${hand}`, vr: `vs RH${hand}`, h: 'Home', a: 'Away', risp: 'RISP' }
    return (
      <StatLogTable title="Splits" caption={r === 'pitching' ? 'What batters hit against this pitcher' : undefined}
        accent={ACCENT_TEXT} leadHeaders={['Split']} preview={10}
        leadSx={[{ color: 'text.primary', fontWeight: 700 }]}
        statHeaders={[r === 'pitching' ? 'BF' : 'PA', 'AVG', 'OBP', 'SLG', 'OPS', 'HR', 'BB', 'SO']}
        rows={rows.map(sp => ({
          lead: [name[sp.code] ?? sp.code],
          cells: [n0(r === 'pitching' ? sp.stat.battersFaced : sp.stat.plateAppearances), rate(sp.stat.avg), rate(sp.stat.obp), rate(sp.stat.slg), rate(sp.stat.ops), n0(sp.stat.homeRuns), n0(sp.stat.baseOnBalls), n0(sp.stat.strikeOuts)],
        }))}
      />
    )
  }

  const careerTable = (r: Role) => {
    const rows = career?.[r] ?? []
    if (rows.length === 0) return null
    // No Career row on the career view: the line above it is that row.
    const tot = careerView ? null : career?.totals[r]
    if (r === 'pitching') {
      const cells = (s: any) => [`${n0(s.wins)}-${n0(s.losses)}`, rate(s.era), n0(s.gamesPlayed ?? s.gamesPitched), n0(s.gamesStarted), n0(s.saves), s.inningsPitched ?? '0.0', n0(s.hits), n0(s.earnedRuns), n0(s.homeRuns), n0(s.baseOnBalls), n0(s.strikeOuts), rate(s.whip)]
      return (
        <StatLogTable title="Career" caption="Regular season · tap a year to open it" accent={ACCENT_TEXT}
          leadHeaders={['Year', 'Team']} preview={10} noun={['season', 'seasons']} totalsLabel="Career"
          leadSx={[{ color: 'text.primary', fontWeight: 700 }, { fontWeight: 600, color: 'text.secondary' }]}
          statHeaders={['W-L', 'ERA', 'G', 'GS', 'SV', 'IP', 'H', 'ER', 'HR', 'BB', 'SO', 'WHIP']}
          totals={tot ? cells(tot) : undefined}
          rows={rows.map(row => ({ lead: [row.season, row.teams || '—'], cells: cells(row.stat), selected: !careerView && row.season === season, onOpen: () => pickSeason(row.season) }))}
        />
      )
    }
    const cells = (s: any) => [n0(s.gamesPlayed), n0(s.plateAppearances), n0(s.atBats), n0(s.runs), n0(s.hits), n0(s.doubles), n0(s.triples), n0(s.homeRuns), n0(s.rbi), n0(s.stolenBases), n0(s.baseOnBalls), n0(s.strikeOuts), rate(s.avg), rate(s.obp), rate(s.slg), rate(s.ops)]
    return (
      <StatLogTable title="Career" caption="Regular season · tap a year to open it" accent={ACCENT_TEXT}
        leadHeaders={['Year', 'Team']} preview={10} noun={['season', 'seasons']} totalsLabel="Career"
        leadSx={[{ color: 'text.primary', fontWeight: 700 }, { fontWeight: 600, color: 'text.secondary' }]}
        statHeaders={['G', 'PA', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'BB', 'SO', 'AVG', 'OBP', 'SLG', 'OPS']}
        totals={tot ? cells(tot) : undefined}
        rows={rows.map(row => ({ lead: [row.season, row.teams || '—'], cells: cells(row.stat), selected: !careerView && row.season === season, onOpen: () => pickSeason(row.season) }))}
      />
    )
  }

  /** The other role, in one line, when it does not earn a pane of its own. */
  const cameo = (r: Role) => {
    if (r === 'hitting' && plan.pitchingCameo) {
      const p = lines.pitching
      return <CameoBlock label="Also pitched" text={`${rate(p.era)} ERA over ${p.inningsPitched} IP, ${n0(p.strikeOuts)} K`} />
    }
    if (r === 'pitching' && plan.battingCameo) {
      const h = lines.hitting
      return <CameoBlock label="Also batted" text={`${rate(h.avg)}/${rate(h.obp)}/${rate(h.slg)}, ${n0(h.hits)}-for-${n0(h.atBats)}${n0(h.homeRuns) ? `, ${n0(h.homeRuns)} HR` : ''}`} />
    }
    return null
  }

  // The trend follows the page's own year menu: a season draws its rolling line, the career a point
  // a year. It had a "2026 / Career" switch of its own, which was the menu above it again.
  const trend = career ? (
    <Box sx={{ mt: 2.5 }}>
      <TrendSection career={career} log={log ?? []} roles={plan.roles} season={season!}
        mode={careerView ? 'career' : 'rolling'} official={bundle ?? null} onYear={pickSeason} />
    </Box>
  ) : null

  /** One role in full. `first` carries the scope toggle, so a two-way page has one of them. */
  const roleBlock = (r: Role, first: boolean) => (
    <Box key={r} sx={{ mb: 3.5, '&:last-of-type': { mb: 0 } }}>
      {wide && plan.roles.length > 1 && (
        <Typography sx={{ ...sectionSx, color: ACCENT_TEXT, mb: 1 }}>{r === 'pitching' ? 'Pitching' : 'Batting'}</Typography>
      )}
      {lineCaption(r, first || !wide)}
      <Box sx={{ mb: 1.5 }}><RateStrip cells={headline(r)} /></Box>
      <SeasonLine cols={seasonCols(r)} headline={headline(r).map(c => c.label)} />
      {cameo(r)}
      {/* On the career, the year-by-year IS the log: it is what the line above adds up.
          THE TREND SITS UNDER THE LOG, once a page. It is the one picture on the card and the shape
          of the games just listed, and it used to come after the splits, the advanced line and a
          sixteen-column career table, which on a phone put it past where anybody scrolls. */}
      {careerView ? <>
        {first && trend}
        {careerTable(r)}
      </> : <>
        {logTable(r)}
        {first && trend}
        {splitsTable(r)}
        {advanced(r)}
        {r === 'pitching' && (scope === 'regular' || !hasPost) && <PitchMix pitches={pitchMix ?? []} />}
        {careerTable(r)}
      </>}
    </Box>
  )

  // ── the band ──────────────────────────────────────────────────────────────

  const pos = bio?.primaryPosition?.abbreviation ?? player?.primaryPosition?.abbreviation
  const bt = bio?.batSide?.code || bio?.pitchHand?.code ? `B/T ${bio?.batSide?.code ?? '-'}/${bio?.pitchHand?.code ?? '-'}` : null
  const meta = [
    (bio?.primaryNumber ?? player?.primaryNumber) ? `#${bio?.primaryNumber ?? player?.primaryNumber}` : null,
    pos === 'TWP' ? 'Two-way' : pos,
    bt,
    bio?.height && bio?.weight ? `${bio.height}, ${bio.weight} lb` : null,
    (bio?.currentAge ?? player?.currentAge) != null && bio?.active !== false ? `${bio?.currentAge ?? player?.currentAge} yrs` : null,
  ].filter(Boolean).join(' · ')
  const span = bio && !bio.active ? careerSpan(bio) : null
  const bandLines = bio ? [birthplace(bio), draftLine(bio), span ? `MLB ${span}` : null].filter((l): l is string => !!l) : []
  const stripe = (teamId != null && TEAM_SECONDARY[teamId]) || palette.sub

  const band = (
    <PlayerBand
      background={{ color: palette.bg }}
      stripe={stripe}
      portrait={
        // No fill of its own: the photo is MLB's cut-out on a transparent ground, so the band's colour
        // shows straight through. It sat on a 16% white wash, which read as a near miss of the band's
        // own colour rather than as a frame.
        <Box role="img" aria-label={name} sx={{
          width: chromePx(84), height: chromePx(84), flexShrink: 0, borderRadius: 2,
          border: `2px solid ${stripe}`,
          backgroundImage: `url(${HEADSHOT_SQUARE(playerId)})`, backgroundSize: 'cover', backgroundPosition: 'center',
        }} />
      }
      name={name}
      badge={plan.roles.length > 1 ? <BandBadge>Two-way</BandBadge> : undefined}
      meta={meta || undefined}
      lines={bandLines}
      // `teamPalette` solved these whites per club, so the smallest text on the band clears 4.5:1 on
      // all thirty colours (the reason MLB's band is flat where WPBL's washes).
      ink={{ name: palette.text, meta: palette.text, line: palette.sub }}
      chips={awards.length > 0 ? (
        // One row, the biggest honours first (AWARD_RULES' order), the rest behind "+N".
        <BandChips>
          {awards.map(a => (
            <Box key={a.key} title={`${a.label}: ${a.seasons.join(', ')}`} sx={BAND_CHIP_SX}>
              <EmojiEvents aria-hidden sx={{ fontSize: '0.85rem', color: '#eab308' }} />
              {a.seasons.length > 1 ? `${a.seasons.length}× ${a.label}` : `${a.label} ${a.seasons[0]}`}
            </Box>
          ))}
        </BandChips>
      ) : undefined}
    />
  )

  // ── the page ──────────────────────────────────────────────────────────────

  const loading = !career || (!careerView && season != null && (!bundle || !log))
  const noStats = !!career && seasons.length === 0
  const shownRoles = wide ? plan.roles : [activeRole]

  const body = (
    <Box sx={{ px: 2, pt: 2, pb: 2.5 }}>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : noStats || (!lines.hitting && !lines.pitching) ? (
        <Box sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, mb: 0.5 }}>No major league stats {noStats || careerView ? 'yet' : `in ${season}`}</Typography>
          <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled' }}>Season totals appear here once this player appears in a game.</Typography>
        </Box>
      ) : (
        <>
          {!wide && plan.roles.length > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1.75 }}>
              <SegControl
                options={plan.roles.map(r => ({ value: r, label: r === 'pitching' ? 'Pitching' : 'Batting' }))}
                value={activeRole}
                onChange={v => setRoleTab(v as Role)}
              />
            </Box>
          )}
          {shownRoles.map((r, i) => roleBlock(r, i === 0))}
          <Fielding lines={hasPost && scope !== 'regular' ? [] : bundle?.fielding ?? []} />
        </>
      )}
      {contract && (
        <Box sx={{ mt: 3 }}>
          <SectionHead title="Contract" />
          <ContractPanel contract={contract} currentSeason={CURRENT_SEASON} />
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', mt: 3 }}>
        <Box component="a" href={`https://www.baseball-reference.com/search/search.fcgi?search=${encodeURIComponent(name)}`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Reference ↗</Box>
        <Box component="a" href={`https://baseballsavant.mlb.com/savant-player/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${playerId}`} target="_blank" rel="noopener noreferrer" sx={linkPillSx}>Baseball Savant ↗</Box>
      </Box>
    </Box>
  )

  const target = { kind: 'player', id: playerId } as const
  const actions = <>
    <FollowChip followed={followed} onToggle={onToggleFollow} name={name} />
    <CopyLinkButton url={mlbShareUrl(target)} title={`Copy a link to ${name}`} onCopy={() => trackMlbShare(target)} />
  </>
  const card = (
    <StatCardContext.Provider value={cardEnv}>
      <Box ref={panel ? topRef : undefined} sx={{
        bgcolor: 'background.paper', overflow: 'hidden', scrollMarginTop: 0,
        // Edge to edge on a phone, where the page's gutter would cost the tables two columns.
        ...(panel ? {} : { mx: { xs: -2, sm: 0 }, borderRadius: { xs: 0, sm: 3 }, border: { xs: 'none', sm: '1px solid' }, borderColor: { sm: 'divider' } }),
      }}>
        {band}
        {body}
      </Box>
    </StatCardContext.Provider>
  )

  // The panel is WPBL's player panel on MLB's card: the club as the eyebrow, Expand, Follow and Copy
  // link in the header, and the phone layout in a 525px column.
  if (panel) return (
    <ModalShell
      onClose={onClose ?? onBack}
      eyebrow={club?.name ?? bio?.currentTeam?.name ?? player?.currentTeam?.name ?? 'Player'}
      maxWidth={{ xs: chromePx(640), md: chromePx(880) }}
      sheet
      sheetFill
      panel
      openKey={playerId}
      onBack={onBack}
      backLabel={backLabel}
      actions={<>
        {/* Only while it IS the side panel: below md the same shell is a bottom sheet. */}
        {mdUp && onExpand && <ExpandButton onExpand={onExpand} title={`Open ${name}'s full page`} />}
        {actions}
      </>}
    >
      {/* While the panel is up its address is the player's, so it is the page's heading. */}
      <MlbHiddenH1>{`${name}: MLB stats`}</MlbHiddenH1>
      {card}
    </ModalShell>
  )

  return (
    // `width` as well as the cap: on a phone the page sits in a flex column (the footer wrapper),
    // where auto margins alone shrink it to its widest table and push the page off the screen.
    <Box component="article" ref={topRef} sx={{ width: '100%', maxWidth: chromePx(880), mx: 'auto', pb: 4, scrollMarginTop: 'var(--app-header-h, 0px)' }}>
      <MlbPageH1>{`${name}: MLB stats`}</MlbPageH1>
      <DetailPageBar
        onBack={onBack}
        // The nickname on a phone, where "Pittsburgh Pirates" beside Follow and Copy link ellipsises.
        eyebrow={club ? (<>
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{club.name}</Box>
          <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{TEAM_NICKNAME[club.id] ?? club.name}</Box>
        </>) : (bio?.currentTeam?.name ?? player?.currentTeam?.name ?? 'Player')}
        actions={actions}
      />
      {card}
    </Box>
  )
}

/**
 * The trend chart, kept from the old page: MLB's rolling line with a league-average reference is
 * the one thing the card had that WPBL's does not. A season draws the rolling window over its
 * games; the career is a point a year, and tapping a year opens it. Which one is the page's year
 * menu, not a control here. A season under five games has no window yet and shows the career.
 */
function TrendSection({ career, log, roles, season, mode, official, onYear }: {
  career: Career; log: LogGame[]; roles: Role[]; season: number
  mode: 'rolling' | 'career'
  /** The season's regular-season line, whose OPS and ERA the chart prints as the season's own. */
  official: { hitting: any | null; pitching: any | null } | null
  onYear: (s: number) => void
}) {
  const splits = useMemo(() => careerTrendSplits(career), [career])
  const regular = useMemo(() => log.filter(g => g.gameType === 'R'), [log])
  const shown = mode === 'rolling' && regular.length >= 5 ? 'rolling' : 'career'
  if (splits.length === 0) return null
  return (
    <>
      <SectionHead title="Trend" />
      <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', p: { xs: 0.75, sm: 1.5 } }}>
        <Suspense fallback={<Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={22} /></Box>}>
          <PlayerTrendsChart
            key={shown}
            splits={splits}
            isPitcher={roles[0] === 'pitching' && roles.length === 1}
            isTwoWay={roles.length > 1}
            gameLog={regular}
            season={season}
            official={official}
            chartMode={shown}
            onYearSelect={shown === 'career' ? onYear : undefined}
          />
        </Suspense>
      </Box>
    </>
  )
}
