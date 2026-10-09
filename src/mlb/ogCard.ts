// The preview card on a shared MLB player or game link: the words an unfurler (iMessage, Slack,
// Discord, Bluesky, X) shows, and for a player the image. WPBL's original is src/wpbl/ogCard.ts.
//
// Unfurlers fetch the HTML and never run JS, so the tags src/seo.ts sets after React mounts are
// invisible to them, and until Oct 2026 every MLB link unfurled as the site's one generic card.
// functions/mlb/index.ts rewrites the tags at the edge from StatsAPI; this file decides what they
// say. It is pure and lives under src/ so it is tested with the app rather than only by deploying.
//
// It must stay safe at the edge: no imports that pull in React, MUI, assets or the DOM.
import { teamPalette } from './constants'

export interface MlbOgCard {
  title: string            // <title>: the browser tab and the search result
  ogTitle: string          // the unfurl's bold first line
  description: string
  image: string | null     // 1200x630, or null to keep the site's default cover
  imageAlt: string | null
}

type Stat = Record<string, string | number | undefined>
interface Split { team?: unknown; stat?: Stat }

/** The slice of StatsAPI's /people/{id}?hydrate=currentTeam,stats(...) this reads. */
export interface MlbCardPerson {
  id: number
  fullName: string
  primaryPosition?: { abbreviation?: string }
  currentTeam?: { id?: number; name?: string }
  stats?: { group?: { displayName?: string }; splits?: Split[] }[]
}

/** The slice of StatsAPI's /schedule game this reads. */
export interface MlbCardGame {
  gamePk: number
  gameDate?: string
  status?: { abstractGameState?: string; detailedState?: string }
  teams?: Record<'away' | 'home', { team?: { abbreviation?: string; name?: string }; score?: number } | undefined>
  seriesDescription?: string
  seriesGameNumber?: number
  gamesInSeries?: number
}

const SUFFIX = ' | sportydolphin.fun'

/**
 * The season line to quote. A player who changed clubs gets one split per club PLUS one with no
 * club, which is the season total; the first split would quote half a season as if it were all
 * of it (Tarik Skubal's 2026 is 16 games with Detroit, 10 with Los Angeles, 26 in all).
 */
export function seasonTotal(splits: Split[] | undefined): Stat | null {
  if (!splits || splits.length === 0) return null
  return (splits.find(s => s.team == null) ?? splits[0]).stat ?? null
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? NaN))

function hittingLine(s: Stat): string | null {
  if (!(num(s.plateAppearances) > 0)) return null
  const parts = [`${s.avg}/${s.obp}/${s.slg}`, `${s.homeRuns ?? 0} HR`, `${s.rbi ?? 0} RBI`]
  if (num(s.stolenBases) >= 10) parts.push(`${s.stolenBases} SB`)
  return `${parts.join(', ')} in ${s.gamesPlayed} games`
}

function pitchingLine(s: Stat): string | null {
  if (!(num(s.gamesPlayed) > 0)) return null
  // A closer leads with saves, a starter with the record. Both carry ERA and strikeouts.
  const lead = num(s.saves) > 0 && num(s.gamesStarted) === 0 ? `${s.saves} SV` : `${s.wins ?? 0}-${s.losses ?? 0}`
  return `${lead}, ${s.era} ERA, ${s.strikeOuts ?? 0} K in ${s.inningsPitched} IP`
}

/**
 * The headshot on the club's colour, at the 1200x630 every unfurler crops to (CLAUDE.md, og:image).
 * MLB's image CDN pads it to shape itself, so there is no art to generate and keep current for
 * fifteen hundred players; it is the same headshot the section already shows. The colour is the
 * one the team card is drawn in, already deepened wherever white text would not read on it.
 */
export function mlbPlayerImage(id: number, teamId: number | undefined): string {
  const bg = teamPalette(teamId).bg
  const hex = /^#[0-9a-f]{6}$/i.test(bg) ? bg.slice(1) : '0E2340'
  return 'https://img.mlbstatic.com/mlb-photos/image/upload/'
    + `d_people:generic:headshot:silo:current.png/w_1200,h_630,c_pad,b_rgb:${hex},q_auto/v1/people/${id}/headshot/silo/current`
}

export function mlbPlayerCard(p: MlbCardPerson, season: number): MlbOgCard {
  const pos = p.primaryPosition?.abbreviation
  const team = p.currentTeam?.name
  const group = (name: string) => p.stats?.find(s => s.group?.displayName === name)?.splits
  const hitting = seasonTotal(group('hitting'))
  const pitching = seasonTotal(group('pitching'))
  // A pitcher's hitting line is a few at-bats and the pitching line is the job, so a pitcher shows
  // pitching only; a two-way player (TWP) gets both, hitting first.
  const isPitcher = pos === 'P'
  const lines = [
    isPitcher ? null : hitting && hittingLine(hitting),
    pos === 'P' || pos === 'TWP' ? pitching && pitchingLine(pitching) : null,
  ].filter((x): x is string => !!x)
  const subject = [pos === 'TWP' ? 'Two-way player' : pos, team].filter(Boolean).join(' · ')
  return {
    title: `${p.fullName} stats, game log and career${SUFFIX}`,
    ogTitle: subject ? `${p.fullName}, ${subject}` : p.fullName,
    description: lines.length > 0
      ? `${season}: ${lines.join('; ')}. Game log, splits and career on sportydolphin.fun.`
      : `Stats, game log, splits and career${team ? ` for the ${team}` : ''} on sportydolphin.fun.`,
    image: mlbPlayerImage(p.id, p.currentTeam?.id),
    imageAlt: team ? `${p.fullName}, ${team}` : p.fullName,
  }
}

/** "World Series, Game 7": the postseason context, or nothing in the regular season. */
function seriesLabel(g: MlbCardGame): string | null {
  if (!g.seriesDescription || g.seriesDescription === 'Regular Season') return null
  return g.seriesGameNumber ? `${g.seriesDescription}, Game ${g.seriesGameNumber}` : g.seriesDescription
}

/** The day the game is on, in Eastern time: the edge knows nothing about the reader's zone. */
function gameDay(iso: string | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })
}

export function mlbGameCard(g: MlbCardGame): MlbOgCard | null {
  const away = g.teams?.away, home = g.teams?.home
  const a = away?.team?.abbreviation, h = home?.team?.abbreviation
  if (!a || !h) return null
  const state = g.status?.abstractGameState
  const scored = (state === 'Final' || state === 'Live') && away?.score != null && home?.score != null
  // The score leads when there is one: it is what anybody pasting a finished game is sharing.
  const head = scored ? `${a} ${away!.score}, ${h} ${home!.score}` : `${a} at ${h}`
  const status = state === 'Final' ? 'Final' : state === 'Live' ? 'Live' : g.status?.detailedState ?? null
  const series = seriesLabel(g)
  const day = gameDay(g.gameDate)
  const names = away?.team?.name && home?.team?.name ? `${away.team.name} at ${home.team.name}` : null
  return {
    title: `${head}${series ? `: ${series}` : ''}${SUFFIX}`,
    ogTitle: [head, series].filter(Boolean).join(' · '),
    description: [[status, day].filter(Boolean).join(', '), names].filter(Boolean).join('. ')
      + '. Box score, play by play and pitch data on sportydolphin.fun.',
    image: null,
    imageAlt: null,
  }
}
