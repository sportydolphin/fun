import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { Box, Typography, Skeleton } from '@mui/material'
import { ChevronRight } from '@mui/icons-material'
import { HEADSHOT, TEAM_BG, TEAM_NICKNAME, TONE, isRealClub } from '../constants'
import { LogoBubble, LiveDot, SectionLabel } from '../components/boxScore'
import { ModalShell } from '../../ui/ModalShell'
import { hoverOnly, pressable, FOCUS_RING } from '../../ui/interaction'
import { useSheetHistory } from '../state/sheetHistory'
import { chromePx, typePx } from '../../ui/scale'
import { teamLink, playerLink, gameLink, LINK_SX } from '../lib/links'
import { useIsDark, photoBorderAlpha } from '../lib/colorUtils'
import { winsNeeded, seriesName, liveGameScore } from '../postseason'
import type { Bracket, PsSeries, PsGame, PsTeam } from '../postseason'
import {
  fetchSeriesGames, fetchSeriesLeaders, fetchRegularSeasonMeeting, fetchRegularSeasonRecords, fetchPitcherLines,
  nextRound,
} from '../seriesDetail'
import type { SeriesGameDetail, SeriesLeaders, Meeting, ClubRecord, PitcherLine, HitterTotals, PitcherTotals } from '../seriesDetail'
import { shortName } from './scheduleData'
import type { FinalGameSummary } from './FinalGames'
import { GamePreviewModal, TeamComparison } from './GamePreview'
import { MlbHiddenH1 } from '../components/PageHeading'
import { MlbCopyLink } from '../components/CopyLink'
import { mlbClubById, mlbSeriesPath } from '../routes'
import { getDynamicSeo, setDynamicSeo } from '../../seo'

const GameCenterModal = lazy(() => import('./LiveGameCenter').then(m => ({ default: m.GameCenterModal })))

// ─── One postseason series ────────────────────────────────────────────────────
//
// Opened from a series card on Home or Standings. It used to be the two clubs and a list of games
// reading "NYY 0, TB 1 · Final", centred in a 480px dialog: everything it said was already on the
// card, so the only reason to open it was to reach a game. It now answers what a fan opening a
// series wants next: who won and lost each game, who starts the next one and where it is on TV, who
// has carried the series, how the clubs met over the summer, and who the winner plays. Below `md`
// it is one column with the next game first; from `md` the games run down the left beside the rest.
// The data is seriesDetail.ts, read on open; each section fails on its own.

const timeFmt = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const dayFmt = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
const isToday = (ms: number) => new Date(ms).toDateString() === new Date().toDateString()
const whenFmt = (g: PsGame) => {
  const day = isToday(g.startMs) ? 'Today' : dayFmt(g.startMs)
  return g.timeSet ? `${day}, ${timeFmt(g.startMs)}` : `${day}, time TBD`
}

/** "Rasmussen", dropping a suffix that would otherwise be the whole name ("Jr."). */
function lastName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(p => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(p))
  return parts[parts.length - 1] ?? full
}

const clubName = (t: PsTeam) => t.real ? (TEAM_NICKNAME[t.id] ?? t.abbr) : t.abbr

// Three sizes below the headline and nothing between them. The first build had fourteen, from
// 0.56rem to 0.9rem, each picked on its own line, and the sheet read as a collage of near-misses.
// META is every secondary line, BODY every primary one (names, sentences, the game's numbers),
// and the small caps are SectionLabel's size so a label anywhere in the sheet is the same label.
const META = '0.7rem'
const BODY = '0.8rem'
const CAPS = '0.58rem'
// One gutter for every section, so the columns' text lines up with the header above them.
const PX = { xs: 2, md: 2.5 }

// Game Center and the preview take the scoreboard's game shape. A series game has what they need
// for a header, the decisions included now that they are read, and each loads the rest itself.
function toSummary(g: PsGame, d: SeriesGameDetail | undefined): FinalGameSummary {
  const team = (t: PsGame['home'], won: boolean) => ({ teamId: t.id, abbr: t.abbr, name: '', runs: t.score ?? 0, hits: 0, errors: 0, isWinner: won })
  return {
    gamePk: g.gamePk, state: g.state, startMs: g.startMs,
    statusText: g.state === 'final' ? 'Final' : g.state === 'live' ? (g.inning ?? (g.detail || 'Live'))
      : g.state === 'postponed' ? g.detail : g.timeSet ? timeFmt(g.startMs) : 'TBD',
    home: team(g.home, g.winnerId === g.home.id), away: team(g.away, g.winnerId === g.away.id),
    winPitcher: d?.winner?.name ?? null, losePitcher: d?.loser?.name ?? null, savePitcher: d?.save?.name ?? null,
  }
}

// ─── The matchup ──────────────────────────────────────────────────────────────

function WinPips({ wins, need, align }: { wins: number; need: number; align: 'left' | 'right' }) {
  return (
    <Box role="img" aria-label={`${wins} of ${need} wins`} sx={{ display: 'flex', gap: chromePx(4), justifyContent: { xs: 'center', sm: align === 'left' ? 'flex-start' : 'flex-end' } }}>
      {Array.from({ length: need }, (_, i) => (
        <Box key={i} sx={{
          width: chromePx(8), height: chromePx(8), borderRadius: '50%', boxSizing: 'border-box',
          ...(i < wins ? { bgcolor: 'text.primary' } : { border: '1.5px solid', borderColor: 'text.disabled' }),
        }} />
      ))}
    </Box>
  )
}

function Club({ t, wins, need, won, lost, record, align, toTeam }: {
  t: PsTeam; wins: number; need: number; won: boolean; lost: boolean
  record: ClubRecord | undefined; align: 'left' | 'right'; toTeam?: (id: number) => void
}) {
  const sub = [t.seed != null ? `${t.seed} seed` : null, record ? `${record.wins}-${record.losses}` : null].filter(Boolean).join(' · ')
  return (
    // Stacked and centred on a phone, where a logo, a nickname and a record beside it left the
    // series score no room between the two clubs.
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: { xs: 0.75, sm: 1.25 }, minWidth: 0, opacity: lost ? 0.5 : 1,
      flexDirection: { xs: 'column', sm: align === 'left' ? 'row' : 'row-reverse' }, textAlign: { xs: 'center', sm: align },
    }}>
      {t.real
        ? <LogoBubble teamId={t.id} abbr={t.abbr} size={48} ring={2} />
        : <Box sx={{ width: chromePx(48), height: chromePx(48), borderRadius: '50%', border: '1.5px dashed', borderColor: 'divider', flexShrink: 0 }} />}
      <Box sx={{ minWidth: 0, maxWidth: '100%' }}>
        <Typography {...(t.real ? teamLink(t.id, toTeam) : {})} sx={{
          ...LINK_SX, display: 'block', fontSize: '1.05rem', fontWeight: won ? 900 : 800, lineHeight: 1.15,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          ...(t.real && toTeam ? { cursor: 'pointer', ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING } : {}),
        }}>
          {clubName(t)}
        </Typography>
        <Typography sx={{ fontSize: META, color: 'text.secondary', fontWeight: 600, mt: 0.25, mb: 0.6, whiteSpace: 'nowrap' }}>
          {sub || ' '}
        </Typography>
        {t.real && <WinPips wins={wins} need={need} align={align} />}
      </Box>
    </Box>
  )
}

/** The two clubs facing each other, the lower seed on the left as the visitor in game 1, with the
 *  series score between them. In the card this is pips only, because a pair of numbers under the
 *  scoreboard read as a game score; here it is the whole subject of the sheet, and labelled. */
function Matchup({ s, bracket, records, toTeam }: {
  s: PsSeries; bracket: Bracket; records: Map<number, ClubRecord> | null; toTeam?: (id: number) => void
}) {
  const need = winsNeeded(s)
  const left = s.bottom, right = s.top
  const wl = s.winsBottom, wr = s.winsTop
  const leader = s.winnerId != null ? (s.winnerId === left.id ? left : right) : wl > wr ? left : wr > wl ? right : null
  const caption = s.winnerId != null ? `${leader!.abbr} wins the series`
    : leader ? `${leader.abbr} leads`
    : wl + wr > 0 ? 'Series tied'
    : s.games[0] ? `Starts ${isToday(s.games[0].startMs) ? 'today' : dayFmt(s.games[0].startMs)}` : ''
  const next = nextRound(bracket, s)
  let ahead: React.ReactNode = null
  if (next) {
    const name = next.name
    const opp = next.opponent
    if (s.winnerId != null) {
      const w = s.winnerId === s.top.id ? s.top : s.bottom
      ahead = <>The {clubName(w)} advance to the {name}{opp ? <> to face the <b>{clubName(opp)}</b></> : null}.</>
    } else if (opp) {
      ahead = <>The winner faces the <b>{clubName(opp)}</b> in the {name}.</>
    } else if (next.pending) {
      ahead = <>The winner meets <b>{next.pending[0].abbr}</b> or <b>{next.pending[1].abbr}</b> in the {name}.</>
    } else {
      ahead = <>The winner goes on to the {name}.</>
    }
  } else if (s.winnerId != null) {
    const w = s.winnerId === s.top.id ? s.top : s.bottom
    ahead = <>The {clubName(w)} are the {bracket.season} World Series champions.</>
  }
  return (
    <Box sx={{ px: PX, pt: 2, pb: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', alignItems: 'center', gap: { xs: 1, md: 3 } }}>
        <Club t={left} wins={wl} need={need} won={s.winnerId === left.id} lost={s.winnerId != null && s.winnerId !== left.id}
          record={records?.get(left.id)} align="left" toTeam={toTeam} />
        <Box sx={{ textAlign: 'center', px: { xs: 0, md: 1 } }}>
          <SectionLabel>Series</SectionLabel>
          <Typography sx={{ fontSize: { xs: '1.9rem', md: '2.4rem' }, fontWeight: 900, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {wl}<Box component="span" sx={{ color: 'text.disabled', fontWeight: 400, mx: 0.5 }}>–</Box>{wr}
          </Typography>
          <Typography sx={{ fontSize: META, fontWeight: 700, color: s.live ? TONE.red : 'text.secondary', whiteSpace: 'nowrap' }}>
            {caption}
          </Typography>
        </Box>
        <Club t={right} wins={wr} need={need} won={s.winnerId === right.id} lost={s.winnerId != null && s.winnerId !== right.id}
          record={records?.get(right.id)} align="right" toTeam={toTeam} />
      </Box>
      {ahead && (
        <Typography sx={{ mt: 1.5, fontSize: META, color: 'text.secondary', textAlign: 'center', '& b': { color: 'text.primary', fontWeight: 800 } }}>
          {ahead}
        </Typography>
      )}
    </Box>
  )
}

// ─── The games ────────────────────────────────────────────────────────────────

/** One club's line inside a game row: logo, abbreviation, and the runs once there are any, or the
 *  named starter's surname before, which is the one thing a future game has to say about a club. */
function GameSide({ team, score, won, dim, starter }: {
  team: PsGame['home']; score: number | null; won: boolean; dim: boolean; starter: string | null
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      {isRealClub(team.id)
        ? <LogoBubble teamId={team.id} abbr={team.abbr} size={20} ring={1} />
        : <Box sx={{ width: chromePx(20), height: chromePx(20), borderRadius: '50%', border: '1px dashed', borderColor: 'divider', flexShrink: 0 }} />}
      <Typography sx={{ width: '2.4rem', flexShrink: 0, fontSize: BODY, fontWeight: won ? 900 : 700, color: dim ? 'text.secondary' : 'text.primary' }}>
        {team.abbr}
      </Typography>
      {score != null
        ? <Typography sx={{ ml: 'auto', fontSize: BODY, fontWeight: won ? 900 : 600, color: dim ? 'text.secondary' : 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{score}</Typography>
        : <Typography sx={{ ml: 'auto', minWidth: 0, fontSize: META, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{starter ?? ''}</Typography>}
    </Box>
  )
}

function GameRow({ g, d, onOpen }: { g: PsGame; d: SeriesGameDetail | undefined; onOpen: () => void }) {
  const played = g.state === 'final' || g.state === 'live'
  const lines: React.ReactNode[] = []
  if (g.state === 'final' && d) {
    if (d.winner) lines.push(<><b>W</b> {lastName(d.winner.name)}</>)
    if (d.loser) lines.push(<><b>L</b> {lastName(d.loser.name)}</>)
    if (d.save) lines.push(<><b>S</b> {lastName(d.save.name)}</>)
  } else if (g.state === 'live') {
    lines.push(<Box component="span" sx={{ color: TONE.red, fontWeight: 800 }}>{g.inning ?? (g.detail || 'Live')}</Box>)
    lines.push(<>{liveGameScore(g)}</>)
  } else if (g.state === 'postponed') {
    lines.push(<>{g.detail}</>)
  } else {
    // TV stays on the next game's card: it is the same networks for every game of a round, and
    // repeated down five rows it was the longest thing in each and said nothing new.
    lines.push(<>{g.timeSet ? timeFmt(g.startMs) : 'Time TBD'}</>)
    if (g.ifNecessary) lines.push(<Box component="span" sx={{ fontStyle: 'italic' }}>If necessary</Box>)
  }
  const starter = (side: 'away' | 'home') => {
    const p = d?.probable[side]
    return p ? lastName(p.name) : null
  }
  return (
    <Box {...gameLink(g.gamePk, onOpen)} sx={{
      ...LINK_SX, display: 'grid', alignItems: 'center', gap: { xs: 1.25, md: 1.5 },
      gridTemplateColumns: '3.6rem minmax(0, 8.5rem) minmax(0, 1fr) auto',
      px: PX, py: 1.1, cursor: 'pointer', borderBottom: '1px solid', borderColor: 'divider',
      opacity: g.ifNecessary && !played ? 0.75 : 1,
      ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING,
    }}>
      <Box>
        <Typography sx={{ fontSize: BODY, fontWeight: 800, lineHeight: 1.2 }}>Game {g.number}</Typography>
        <Typography sx={{ fontSize: META, color: 'text.secondary', lineHeight: 1.3 }}>
          {isToday(g.startMs) ? 'Today' : new Date(g.startMs).toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' })}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4, minWidth: 0 }}>
        <GameSide team={g.away} score={played ? g.away.score ?? 0 : null} won={g.winnerId === g.away.id}
          dim={g.winnerId != null && g.winnerId !== g.away.id} starter={starter('away')} />
        <GameSide team={g.home} score={played ? g.home.score ?? 0 : null} won={g.winnerId === g.home.id}
          dim={g.winnerId != null && g.winnerId !== g.home.id} starter={starter('home')} />
      </Box>
      <Box sx={{ minWidth: 0, fontSize: META, color: 'text.secondary', lineHeight: 1.45, '& b': { color: 'text.primary', fontWeight: 800 } }}>
        {lines.map((l, i) => (
          <Box key={i} sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l}</Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {g.state === 'live' && <LiveDot size={6} />}
        <ChevronRight sx={{ fontSize: '1.1rem', color: 'text.disabled' }} />
      </Box>
    </Box>
  )
}

// ─── The next game ────────────────────────────────────────────────────────────

function Starter({ p, line, teamId, teamAbbr, align, toPlayer }: {
  p: { id: number; name: string } | null; line: PitcherLine | undefined; teamId: number; teamAbbr: string; align: 'left' | 'right'
  toPlayer?: (id: number) => void
}) {
  const isDark = useIsDark()
  const sub = !p ? 'Not announced'
    : line ? [line.hand ? `${line.hand}HP` : null, `${line.wins}-${line.losses}`, line.era ? `${line.era} ERA` : null].filter(Boolean).join(' · ')
    : ' '
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexDirection: align === 'left' ? 'row' : 'row-reverse', textAlign: align }}>
      <Box sx={{
        width: chromePx(40), height: chromePx(40), borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
        bgcolor: 'action.hover', border: '1.5px solid', borderColor: photoBorderAlpha(TEAM_BG[teamId] ?? '#888888', isDark),
      }}>
        {p && <Box component="img" src={HEADSHOT(p.id)} alt="" loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: CAPS, fontWeight: 800, color: 'text.disabled', letterSpacing: typePx(0.6), lineHeight: 1.2 }}>{teamAbbr}</Typography>
        <Typography {...(p ? playerLink(p.id, p.name, toPlayer) : {})} sx={{
          ...LINK_SX, display: 'block', fontSize: BODY, fontWeight: 800, lineHeight: 1.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          ...(p && toPlayer ? { cursor: 'pointer', ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING } : {}),
        }}>
          {p ? shortName(p.name) : 'TBD'}
        </Typography>
        <Typography sx={{ fontSize: META, color: 'text.secondary', whiteSpace: 'nowrap' }}>{sub}</Typography>
      </Box>
    </Box>
  )
}

function NextGame({ g, d, lines, onOpen, toPlayer }: {
  g: PsGame; d: SeriesGameDetail | undefined; lines: Map<number, PitcherLine> | null
  onOpen: () => void; toPlayer?: (id: number) => void
}) {
  const live = g.state === 'live'
  const meta = live ? null : [whenFmt(g), d?.venue || null].filter(Boolean).join(' · ')
  return (
    <Box sx={{ px: PX, py: 1.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
        {live && <LiveDot size={6} />}
        <SectionLabel>{live ? `Game ${g.number} · Live` : `Next · Game ${g.number}${g.ifNecessary ? ' (if necessary)' : ''}`}</SectionLabel>
      </Box>
      {live ? (
        <Typography sx={{ fontSize: '1rem', fontWeight: 900, mb: 0.25 }}>
          {g.away.abbr} {g.away.score ?? 0}, {g.home.abbr} {g.home.score ?? 0}
          <Box component="span" sx={{ ml: 1, fontSize: META, fontWeight: 800, color: TONE.red }}>{g.inning ?? (g.detail || 'Live')}</Box>
        </Typography>
      ) : (
        <>
          <Typography sx={{ fontSize: BODY, fontWeight: 700 }}>{meta}</Typography>
          {!!d?.tv.length && (
            <Typography sx={{ fontSize: META, color: 'text.secondary', mt: 0.25 }}>On {d.tv.join(', ')}</Typography>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', alignItems: 'center', gap: 1, mt: 1.5 }}>
            <Starter p={d?.probable.away ?? null} line={d?.probable.away ? lines?.get(d.probable.away.id) : undefined} teamId={g.away.id} teamAbbr={g.away.abbr} align="left" toPlayer={toPlayer} />
            <Typography sx={{ fontSize: CAPS, fontWeight: 800, color: 'text.disabled' }}>VS</Typography>
            <Starter p={d?.probable.home ?? null} line={d?.probable.home ? lines?.get(d.probable.home.id) : undefined} teamId={g.home.id} teamAbbr={g.home.abbr} align="right" toPlayer={toPlayer} />
          </Box>
        </>
      )}
      <Box {...pressable(onOpen)} sx={{
        mt: 1.5, display: 'inline-flex', alignItems: 'center', gap: 0.25, cursor: 'pointer',
        fontSize: META, fontWeight: 800, color: 'text.secondary', px: 1.25, py: 0.5, borderRadius: 999,
        border: '1px solid', borderColor: 'divider', ...hoverOnly({ bgcolor: 'action.hover', color: 'text.primary' }), ...FOCUS_RING,
      }}>
        {live ? 'Game Center' : 'Full preview'} <ChevronRight sx={{ fontSize: '0.95rem' }} />
      </Box>
    </Box>
  )
}

// ─── Series leaders ───────────────────────────────────────────────────────────

const count = (n: number, label: string) => n > 1 ? `${n} ${label}` : n === 1 ? label : null
const ipFmt = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`

function hitterLine(t: HitterTotals): string {
  return [`${t.h}-for-${t.ab}`, count(t.hr, 'HR'), count(t.doubles, '2B'), count(t.triples, '3B'), count(t.rbi, 'RBI'), count(t.bb, 'BB'), count(t.sb, 'SB')]
    .filter(Boolean).slice(0, 4).join(' · ')
}
function pitcherLine(t: PitcherTotals): string {
  const dec = [count(t.w, 'W'), count(t.sv, 'SV')].filter(Boolean).join(', ')
  return [`${ipFmt(t.outs)} IP`, `${t.er} ER`, `${t.k} K`, dec || null].filter(Boolean).join(' · ')
}

function LeaderRow({ id, name, teamId, abbr, line, toPlayer }: {
  id: number; name: string; teamId: number; abbr: string; line: string; toPlayer?: (id: number) => void
}) {
  const isDark = useIsDark()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.6 }}>
      <Box sx={{ position: 'relative', flexShrink: 0 }}>
        <Box component="img" src={HEADSHOT(id)} alt="" loading="lazy" sx={{
          width: chromePx(34), height: chromePx(34), borderRadius: '50%', objectFit: 'cover', display: 'block',
          bgcolor: 'action.hover', border: '1.5px solid', borderColor: photoBorderAlpha(TEAM_BG[teamId] ?? '#888888', isDark),
        }} />
        <Box sx={{ position: 'absolute', right: chromePx(-4), bottom: chromePx(-3) }}>
          <LogoBubble teamId={teamId} abbr={abbr} size={16} ring={1} />
        </Box>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography {...playerLink(id, name, toPlayer)} sx={{
          ...LINK_SX, display: 'block', fontSize: BODY, fontWeight: 800, lineHeight: 1.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          ...(toPlayer ? { cursor: 'pointer', ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING } : {}),
        }}>
          {name}
        </Typography>
        <Typography sx={{ fontSize: META, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line}</Typography>
      </Box>
    </Box>
  )
}

function Leaders({ s, leaders, loading, toPlayer }: {
  s: PsSeries; leaders: SeriesLeaders | null; loading: boolean; toPlayer?: (id: number) => void
}) {
  const abbr = (teamId: number) => teamId === s.top.id ? s.top.abbr : s.bottom.abbr
  const n = leaders?.games ?? 0
  return (
    <Box sx={{ px: PX, py: 1.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75 }}>
        <SectionLabel>Series leaders</SectionLabel>
        {n > 0 && <Typography sx={{ fontSize: CAPS, color: 'text.disabled' }}>{n === 1 ? 'Game 1' : `${n} games`}</Typography>}
      </Box>
      {loading && !leaders ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2 }}>
          {[0, 1, 2, 3].map(i => <Skeleton key={i} variant="rounded" sx={{ height: chromePx(34), my: 0.6, borderRadius: 2 }} />)}
        </Box>
      ) : leaders && (leaders.hitters.length || leaders.pitchers.length) ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: CAPS, fontWeight: 700, color: 'text.secondary', mb: 0.25 }}>At the plate</Typography>
            {leaders.hitters.slice(0, 3).map(t => <LeaderRow key={t.id} id={t.id} name={t.name} teamId={t.teamId} abbr={abbr(t.teamId)} line={hitterLine(t)} toPlayer={toPlayer} />)}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: CAPS, fontWeight: 700, color: 'text.secondary', mb: 0.25, mt: { xs: 1, sm: 0 } }}>On the mound</Typography>
            {leaders.pitchers.slice(0, 3).map(t => <LeaderRow key={t.id} id={t.id} name={t.name} teamId={t.teamId} abbr={abbr(t.teamId)} line={pitcherLine(t)} toPlayer={toPlayer} />)}
          </Box>
        </Box>
      ) : (
        <Typography sx={{ fontSize: META, color: 'text.secondary' }}>Box scores are not in yet.</Typography>
      )}
    </Box>
  )
}

// ─── The regular season ───────────────────────────────────────────────────────

function meetingLine(m: Meeting | null, left: PsTeam, right: PsTeam, season: number): string {
  if (!m) return `They did not meet in the ${season} regular season.`
  const a = m.wins[left.id] ?? 0, b = m.wins[right.id] ?? 0
  if (a === b) return `They split ${m.games} regular-season games, ${a}-${b}.`
  const w = a > b ? left : right
  return `The ${clubName(w)} won the regular-season series ${Math.max(a, b)}-${Math.min(a, b)}.`
}

function RegularSeason({ s, bracket, meeting, records }: {
  s: PsSeries; bracket: Bracket; meeting: Meeting | null | undefined; records: Map<number, ClubRecord> | null
}) {
  const left = s.bottom, right = s.top
  const rd = (id: number) => {
    const r = records?.get(id)
    return r ? `${r.runDiff > 0 ? '+' : ''}${r.runDiff}` : null
  }
  return (
    <Box>
      <Box sx={{ px: PX, pt: 1.75 }}>
        <SectionLabel>Head to head</SectionLabel>
        <Typography sx={{ fontSize: BODY, fontWeight: 600, mt: 0.75 }}>
          {meeting === undefined ? ' ' : meetingLine(meeting, left, right, bracket.season)}
        </Typography>
        {rd(left.id) && rd(right.id) && (
          <Typography sx={{ fontSize: META, color: 'text.secondary', mt: 0.25 }}>
            Run differential: {left.abbr} {rd(left.id)}, {right.abbr} {rd(right.id)}
          </Typography>
        )}
      </Box>
      <TeamComparison away={{ teamId: left.id, abbr: left.abbr }} home={{ teamId: right.id, abbr: right.abbr }}
        sx={{ borderTop: 0, px: PX, pt: 2, pb: 2 }} />
    </Box>
  )
}

// ─── The address's title ──────────────────────────────────────────────────────

/** The series' title and description while its sheet is up, as useGameSeo does for a game: the
 *  path names only a bracket slot, and the clubs in it arrive with the bracket. Returns the h1. */
function useSeriesSeo(s: PsSeries, season: number): string {
  const name = (t: PsTeam) => t.real ? (mlbClubById(t.id)?.name ?? t.abbr) : t.abbr
  const title = `${season} ${seriesName(s)}: ${name(s.bottom)} vs. ${name(s.top)} | sportydolphin.fun`
  const description = `The ${season} ${seriesName(s)}, ${name(s.bottom)} against ${name(s.top)}: every game, the next starters, the series leaders and how the two clubs compare.`
  const path = mlbSeriesPath(season, s.id)
  useEffect(() => {
    // Put back what the page under the sheet registered; see gameSeo.ts.
    const under = getDynamicSeo()
    setDynamicSeo({ path, seo: { title, description } })
    return () => { if (getDynamicSeo()?.path === path) setDynamicSeo(under?.path === path ? null : under) }
  }, [path, title, description])
  return title.replace(/ \| sportydolphin\.fun$/, '')
}

// ─── The sheet ────────────────────────────────────────────────────────────────

export default function SeriesSheet({ s, bracket, onClose, onTeamClick, onPlayerClick }: {
  s: PsSeries; bracket: Bracket; onClose: () => void
  onTeamClick?: (id: number) => void; onPlayerClick?: (id: number) => void
}) {
  // The sheet's address is the series' own, so a reader can share it; see routes.ts.
  const close = useSheetHistory(onClose, mlbSeriesPath(bracket.season, s.id))
  const heading = useSeriesSeo(s, bracket.season)
  const [open, setOpen] = useState<PsGame | null>(null)
  const [details, setDetails] = useState<Map<number, SeriesGameDetail> | null>(null)
  const [leaders, setLeaders] = useState<SeriesLeaders | null>(null)
  const [leadersLoading, setLeadersLoading] = useState(false)
  const [records, setRecords] = useState<Map<number, ClubRecord> | null>(null)
  const [meeting, setMeeting] = useState<Meeting | null | undefined>(undefined)
  const [lines, setLines] = useState<Map<number, PitcherLine> | null>(null)

  // Leaving for a club or a player closes the sheet first, so Back from that page does not reopen it.
  const toTeam = onTeamClick ? (id: number) => { onClose(); onTeamClick(id) } : undefined
  const toPlayer = onPlayerClick ? (id: number) => { onClose(); onPlayerClick(id) } : undefined

  // A game the series never reached is not a game: cancelled, or an "if necessary" left unplayed.
  const games = s.games.filter(g => !(s.winnerId != null && (g.state === 'postponed' || g.state === 'preview')))
  const pks = s.games.map(g => g.gamePk).join(',')
  const finals = s.games.filter(g => g.state === 'final').map(g => g.gamePk)
  const finalKey = finals.join(',')
  const featured = s.games.find(g => g.state === 'live') ?? s.next

  // The bracket polls while a game is on and hands a new series down; re-reading on each new final
  // picks up its decisions and the next game's starter as they are announced.
  useEffect(() => {
    let alive = true
    fetchSeriesGames(pks.split(',').map(Number)).then(m => { if (alive) setDetails(m) })
    return () => { alive = false }
  }, [pks, finalKey])

  useEffect(() => {
    let alive = true
    if (!finals.length) { setLeaders(null); return }
    setLeadersLoading(true)
    fetchSeriesLeaders(finals).then(l => { if (alive) { setLeaders(l); setLeadersLoading(false) } })
    return () => { alive = false }
  }, [finalKey])

  useEffect(() => {
    let alive = true
    fetchRegularSeasonRecords(bracket.season).then(m => { if (alive) setRecords(m) })
    if (s.top.real && s.bottom.real) fetchRegularSeasonMeeting(bracket.season, s.top.id, s.bottom.id).then(m => { if (alive) setMeeting(m) })
    return () => { alive = false }
  }, [bracket.season, s.top.id, s.bottom.id])

  const starterIds = useMemo(() => {
    const d = featured ? details?.get(featured.gamePk) : undefined
    return [d?.probable.away?.id, d?.probable.home?.id].filter((x): x is number => !!x)
  }, [details, featured?.gamePk])
  useEffect(() => {
    let alive = true
    fetchPitcherLines(starterIds, bracket.season).then(m => { if (alive) setLines(m) })
    return () => { alive = false }
  }, [starterIds.join(','), bracket.season])

  const real = s.top.real && s.bottom.real
  const openDetail = open ? details?.get(open.gamePk) : undefined

  return (
    <ModalShell onClose={close} maxWidth={{ xs: chromePx(560), md: chromePx(900) }} sheet sheetFill
      eyebrow={`${seriesName(s)} · Best of ${s.bestOf}`}
      actions={<MlbCopyLink target={{ kind: 'series', season: bracket.season, id: s.id }} title="Copy a link to this series" />}>
      <MlbHiddenH1>{heading}</MlbHiddenH1>
      <Matchup s={s} bracket={bracket} records={records} toTeam={toTeam} />
      {/* Two independent columns from `md`: what has happened (games, then who carried them) on the
          left, what comes next (the next game, then how the clubs compare) on the right. It was one
          grid whose left cell spanned every row, so the five game rows sat above half a column of
          blank while the right ran three sections long. On a phone the columns dissolve
          (`display: contents`) and `order` puts the next game first.
          Borders that change by width set only their width there. A responsive `border` shorthand
          lands in a media query after borderColor and resets it, which drew these dividers white. */}
      <Box sx={{ display: { xs: 'flex', md: 'grid' }, flexDirection: 'column', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)' }}>
        <Box sx={{ display: { xs: 'contents', md: 'block' }, minWidth: 0, borderRightStyle: 'solid', borderRightColor: 'divider', borderRightWidth: { md: '1px' } }}>
          <Box sx={{ order: 2, minWidth: 0, borderTopStyle: 'solid', borderTopColor: 'divider', borderTopWidth: { xs: featured ? '1px' : 0, md: 0 } }}>
            <Box sx={{ px: PX, pt: 1.75, pb: 0.75 }}>
              <SectionLabel>Games</SectionLabel>
            </Box>
            {games.map(g => <GameRow key={g.gamePk} g={g} d={details?.get(g.gamePk)} onOpen={() => setOpen(g)} />)}
          </Box>
          {finals.length > 0 && (
            <Box sx={{ order: 3, minWidth: 0 }}>
              <Leaders s={s} leaders={leaders} loading={leadersLoading} toPlayer={toPlayer} />
            </Box>
          )}
        </Box>
        <Box sx={{ display: { xs: 'contents', md: 'block' }, minWidth: 0 }}>
          {featured && (
            <Box sx={{ order: 1, minWidth: 0 }}>
              <NextGame g={featured} d={details?.get(featured.gamePk)} lines={lines} onOpen={() => setOpen(featured)} toPlayer={toPlayer} />
            </Box>
          )}
          {real && (
            <Box sx={{ order: 4, minWidth: 0, borderTopStyle: 'solid', borderTopColor: 'divider', borderTopWidth: { xs: '1px', md: featured ? '1px' : 0 } }}>
              <RegularSeason s={s} bracket={bracket} meeting={meeting} records={records} />
            </Box>
          )}
        </Box>
      </Box>
      {open && (open.state === 'preview' || open.state === 'postponed') && (
        <GamePreviewModal game={toSummary(open, openDetail)} onClose={() => setOpen(null)}
          onTeamClick={toTeam} onPlayerClick={onPlayerClick} />
      )}
      {open && (open.state === 'live' || open.state === 'final') && (
        <Suspense fallback={null}>
          <GameCenterModal game={toSummary(open, openDetail)} onClose={() => setOpen(null)}
            onTeamClick={toTeam} onPlayerClick={toPlayer} />
        </Suspense>
      )}
    </ModalShell>
  )
}
