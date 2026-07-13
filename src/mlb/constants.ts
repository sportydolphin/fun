import { StatDef, Palette } from './types'
import { fmt, fmtDecimal } from './utils'

// ─── Design token ─────────────────────────────────────────────────────────────

export const ACCENT = '#60a5fa'

// MLB StatsAPI numeric team IDs, named for readability — mirrors TEAM_ABBR below.
// Plain constants (not an enum) so call sites can write the bare name, e.g.
// `[BOS]: ...` as a computed object key.
export const LAA = 108, ARI = 109, BAL = 110, BOS = 111, CHC = 112
export const CIN = 113, CLE = 114, COL = 115, DET = 116, HOU = 117
export const KC  = 118, LAD = 119, WSH = 120, NYM = 121, OAK = 133
export const PIT = 134, SD  = 135, SEA = 136, SF  = 137, STL = 138
export const TB  = 139, TEX = 140, TOR = 141, MIN = 142, PHI = 143
export const ATL = 144, CWS = 145, MIA = 146, NYY = 147, MIL = 158

// ─── Player stat definitions ──────────────────────────────────────────────────

export const HITTING_STAT_DEFS: StatDef[] = [
  { key: 'ab',   label: 'AB',   getValue: s => s.atBats,        format: fmt,  leaderCategory: '',                    defaultSelected: false },
  { key: 'h',    label: 'H',    leaderLabel: 'Hits',            getValue: s => s.hits,          format: fmt,  leaderCategory: 'hits',                defaultSelected: false },
  { key: 'avg',  label: 'AVG',  leaderLabel: 'Batting Average', getValue: s => s.avg,           format: fmt,  leaderCategory: 'battingAverage',      defaultSelected: true,  isRate: true },
  { key: '1b',   label: '1B',   getValue: s => s.hits != null ? s.hits - (s.doubles ?? 0) - (s.triples ?? 0) - (s.homeRuns ?? 0) : null, format: fmt, leaderCategory: '', defaultSelected: false },
  { key: '2b',   label: '2B',   leaderLabel: 'Doubles',         getValue: s => s.doubles,       format: fmt,  leaderCategory: 'doubles',             defaultSelected: false },
  { key: '3b',   label: '3B',   leaderLabel: 'Triples',         getValue: s => s.triples,       format: fmt,  leaderCategory: 'triples',             defaultSelected: false },
  { key: 'hr',   label: 'HR',   leaderLabel: 'Home Runs',       getValue: s => s.homeRuns,      format: fmt,  leaderCategory: 'homeRuns',            defaultSelected: true  },
  { key: 'rbi',  label: 'RBI',  leaderLabel: 'RBIs',            getValue: s => s.rbi,           format: fmt,  leaderCategory: 'runsBattedIn',        defaultSelected: true  },
  { key: 'obp',  label: 'OBP',  leaderLabel: 'On-Base %',       getValue: s => s.obp,           format: fmt,  leaderCategory: 'onBasePercentage',    defaultSelected: false, isRate: true },
  { key: 'slg',  label: 'SLG',  leaderLabel: 'Slugging %',      getValue: s => s.slg,           format: fmt,  leaderCategory: 'sluggingPercentage',  defaultSelected: false, isRate: true },
  { key: 'ops',  label: 'OPS',  getValue: s => s.ops,           format: fmt,  leaderCategory: 'onBasePlusSlugging',  defaultSelected: true,  isRate: true },
  { key: 'k',    label: 'K',    leaderLabel: 'Strikeouts',      getValue: s => s.strikeOuts,    format: fmt,  leaderCategory: 'strikeouts',          defaultSelected: false, poop: true },
  { key: 'bb',   label: 'BB',   leaderLabel: 'Walks',           getValue: s => s.baseOnBalls,   format: fmt,  leaderCategory: 'walks',               defaultSelected: false },
  { key: 'sb',   label: 'SB',   leaderLabel: 'Stolen Bases',    getValue: s => s.stolenBases,   format: fmt,  leaderCategory: 'stolenBases',         defaultSelected: false },
  { key: 'cs',   label: 'CS',   getValue: s => s.caughtStealing, format: fmt, leaderCategory: '',                    defaultSelected: false, poop: true },
]

export const PITCHING_STAT_DEFS: StatDef[] = [
  { key: 'wl',   label: 'W-L',  leaderLabel: 'Wins',              getValue: s => s.wins != null ? `${s.wins}-${s.losses ?? 0}` : null, leaderValue: s => s.wins != null ? Number(s.wins) : null, format: v => v ?? '—', leaderCategory: 'wins', defaultSelected: true  },
  { key: 'era',  label: 'ERA',  leaderLabel: 'ERA',               getValue: s => s.era,              format: fmt,                   leaderCategory: 'earnedRunAverage',             defaultSelected: true,  lowerIsBetter: true, isRate: true },
  { key: 'g',    label: 'G',    getValue: s => s.gamesPlayed,      format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'gs',   label: 'GS',   getValue: s => s.gamesStarted,     format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'ip',   label: 'IP',   leaderLabel: 'Innings Pitched',   getValue: s => s.inningsPitched,   format: fmt,                   leaderCategory: 'inningsPitched',               defaultSelected: true  },
  { key: 'whip', label: 'WHIP', leaderLabel: 'WHIP',              getValue: s => s.whip,             format: fmt,                   leaderCategory: 'walksAndHitsPerInningPitched',  defaultSelected: true,  lowerIsBetter: true, isRate: true },
  { key: 'sv',   label: 'SV',   leaderLabel: 'Saves',             getValue: s => s.saves,            format: fmt,                   leaderCategory: 'saves',                        defaultSelected: false },
  { key: 'h',    label: 'H',    getValue: s => s.hits,             format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'r',    label: 'R',    getValue: s => s.runs,             format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'er',   label: 'ER',   getValue: s => s.earnedRuns,       format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'hr',   label: 'HR',   getValue: s => s.homeRuns,         format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'bb',   label: 'BB',   getValue: s => s.baseOnBalls,      format: fmt,                   leaderCategory: '',                             defaultSelected: false },
  { key: 'k',    label: 'K',    leaderLabel: 'Strikeouts',        getValue: s => s.strikeOuts,       format: fmt,                   leaderCategory: 'strikeouts',                   defaultSelected: true  },
  { key: 'so9',  label: 'SO/9', leaderLabel: 'K per 9',          getValue: s => s.strikeoutsPer9Inn, format: v => fmtDecimal(v, 2), leaderCategory: 'strikeoutsPer9Inn',            defaultSelected: false, isRate: true },
]

// ─── Team stat definitions ────────────────────────────────────────────────────

export const TEAM_HITTING_DEFS: StatDef[] = [
  { key: 'avg', label: 'AVG', getValue: s => s.avg,          format: fmt, leaderCategory: 'avg', defaultSelected: true  },
  { key: 'obp', label: 'OBP', getValue: s => s.obp,          format: fmt, leaderCategory: 'obp', defaultSelected: true  },
  { key: 'slg', label: 'SLG', getValue: s => s.slg,          format: fmt, leaderCategory: 'slg', defaultSelected: false },
  { key: 'ops', label: 'OPS', getValue: s => s.ops,          format: fmt, leaderCategory: 'ops', defaultSelected: true  },
  { key: 'r',   label: 'R',   getValue: s => s.runs,         format: fmt, leaderCategory: 'r',   defaultSelected: true  },
  { key: 'hr',  label: 'HR',  getValue: s => s.homeRuns,     format: fmt, leaderCategory: 'hr',  defaultSelected: true  },
  { key: 'h',   label: 'H',   getValue: s => s.hits,         format: fmt, leaderCategory: 'h',   defaultSelected: false },
  { key: 'sb',  label: 'SB',  getValue: s => s.stolenBases,  format: fmt, leaderCategory: 'sb',  defaultSelected: false },
  { key: 'bb',  label: 'BB',  getValue: s => s.baseOnBalls,  format: fmt, leaderCategory: 'bb',  defaultSelected: false },
  { key: 'k',   label: 'K',   getValue: s => s.strikeOuts,   format: fmt, leaderCategory: 'k',   defaultSelected: false, poop: true },
]

export const TEAM_PITCHING_DEFS: StatDef[] = [
  { key: 'era',  label: 'ERA',  getValue: s => s.era,               format: fmt,                    leaderCategory: 'era',  defaultSelected: true,  lowerIsBetter: true  },
  { key: 'whip', label: 'WHIP', getValue: s => s.whip,              format: fmt,                    leaderCategory: 'whip', defaultSelected: true,  lowerIsBetter: true  },
  { key: 'k',    label: 'K',    getValue: s => s.strikeOuts,        format: fmt,                    leaderCategory: 'pk',   defaultSelected: true   },
  { key: 'bb',   label: 'BB',   getValue: s => s.baseOnBalls,       format: fmt,                    leaderCategory: 'pbb',  defaultSelected: false, lowerIsBetter: true  },
  { key: 'hr',   label: 'HR',   getValue: s => s.homeRuns,          format: fmt,                    leaderCategory: 'phr',  defaultSelected: false, lowerIsBetter: true  },
  { key: 'sv',   label: 'SV',   getValue: s => s.saves,             format: fmt,                    leaderCategory: 'sv',   defaultSelected: false  },
  { key: 'h',    label: 'H',    getValue: s => s.hits,              format: fmt,                    leaderCategory: 'ph',   defaultSelected: false, lowerIsBetter: true  },
  { key: 'k9',   label: 'K/9',  getValue: s => s.strikeoutsPer9Inn, format: v => fmtDecimal(v, 2),  leaderCategory: 'k9',   defaultSelected: false  },
]

export const DEFAULT_HIT_STATS = HITTING_STAT_DEFS.filter(d => d.defaultSelected).map(d => d.key)
export const DEFAULT_PIT_STATS = PITCHING_STAT_DEFS.filter(d => d.defaultSelected).map(d => d.key)
export const DEFAULT_TEAM_HIT_STATS = TEAM_HITTING_DEFS.filter(d => d.defaultSelected).map(d => d.key)
export const DEFAULT_TEAM_PIT_STATS = TEAM_PITCHING_DEFS.filter(d => d.defaultSelected).map(d => d.key)

// ─── Constants ───────────────────────────────────────────────────────────────

export const CURRENT_SEASON = new Date().getFullYear()
export const TEAM_SEASONS = Array.from({ length: CURRENT_SEASON - 2000 + 1 }, (_, i) => CURRENT_SEASON - i)

// Featured leaderboard stat keys shown by default (fewer = less overwhelming)
export const LB_FEATURED: Record<'hitting' | 'pitching', string[]> = {
  hitting:  ['ops', 'hr', 'sb'],
  pitching: ['era', 'whip', 'so9'],
}

// Curated list of notable active players for random auto-load on Search tab
export const FEATURED_PLAYER_IDS = [
  660271,  // Shohei Ohtani
  518692,  // Freddie Freeman
  605141,  // Mookie Betts
  665742,  // Juan Soto
  665487,  // Fernando Tatis Jr.
  670541,  // Yordan Alvarez
  624413,  // Pete Alonso
  665489,  // Vladimir Guerrero Jr.
  660670,  // Ronald Acuña Jr.
  677594,  // Julio Rodríguez
  675911,  // Spencer Strider
  694497,  // Paul Skenes
  668939,  // Gunnar Henderson
  682998,  // Bobby Witt Jr.
  673357,  // Corbin Carroll
  676801,  // Elly De La Cruz
  592518,  // Corey Seager
  663728,  // Kyle Tucker
  666971,  // Dylan Cease
  641154,  // Gerrit Cole
]

export const HEADSHOT = (id: number) =>
  `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_426,q_auto:best/v1/people/${id}/headshot/67/current`

export const TEAM_ABBR: Record<number, string> = {
  [LAA]: 'LAA', [ARI]: 'ARI', [BAL]: 'BAL', [BOS]: 'BOS', [CHC]: 'CHC',
  [CIN]: 'CIN', [CLE]: 'CLE', [COL]: 'COL', [DET]: 'DET', [HOU]: 'HOU',
  [KC]:  'KC',  [LAD]: 'LAD', [WSH]: 'WSH', [NYM]: 'NYM', [OAK]: 'OAK',
  [PIT]: 'PIT', [SD]:  'SD',  [SEA]: 'SEA', [SF]:  'SF',  [STL]: 'STL',
  [TB]:  'TB',  [TEX]: 'TEX', [TOR]: 'TOR', [MIN]: 'MIN', [PHI]: 'PHI',
  [ATL]: 'ATL', [CWS]: 'CWS', [MIA]: 'MIA', [NYY]: 'NYY', [MIL]: 'MIL',
}

// Team nickname only (no city/location) — e.g. "Yankees", not "New York Yankees".
export const TEAM_NICKNAME: Record<number, string> = {
  [LAA]: 'Angels',      [ARI]: 'Diamondbacks', [BAL]: 'Orioles',    [BOS]: 'Red Sox',   [CHC]: 'Cubs',
  [CIN]: 'Reds',        [CLE]: 'Guardians',    [COL]: 'Rockies',    [DET]: 'Tigers',    [HOU]: 'Astros',
  [KC]:  'Royals',      [LAD]: 'Dodgers',      [WSH]: 'Nationals',  [NYM]: 'Mets',      [OAK]: 'Athletics',
  [PIT]: 'Pirates',     [SD]:  'Padres',       [SEA]: 'Mariners',   [SF]:  'Giants',    [STL]: 'Cardinals',
  [TB]:  'Rays',        [TEX]: 'Rangers',      [TOR]: 'Blue Jays',  [MIN]: 'Twins',     [PHI]: 'Phillies',
  [ATL]: 'Braves',      [CWS]: 'White Sox',    [MIA]: 'Marlins',    [NYY]: 'Yankees',   [MIL]: 'Brewers',
}

// BBRef uses different codes for some franchises
export const BBREF_ABBR: Record<string, string> = {
  CWS: 'CHW', WSH: 'WSN', SF: 'SFG', KC: 'KCR', SD: 'SDP', TB: 'TBR',
}

// Team id → division code ('AL'/'NL' + 'E'/'C'/'W'). League = first two chars.
// Used to order the scoreboard around the followed team (division rivals → same
// league → other league).
export const TEAM_DIVISION: Record<number, string> = {
  // AL East
  [BAL]: 'ALE', [BOS]: 'ALE', [NYY]: 'ALE', [TB]: 'ALE', [TOR]: 'ALE',
  // AL Central
  [CWS]: 'ALC', [CLE]: 'ALC', [DET]: 'ALC', [KC]: 'ALC', [MIN]: 'ALC',
  // AL West
  [HOU]: 'ALW', [LAA]: 'ALW', [OAK]: 'ALW', [SEA]: 'ALW', [TEX]: 'ALW',
  // NL East
  [ATL]: 'NLE', [MIA]: 'NLE', [NYM]: 'NLE', [PHI]: 'NLE', [WSH]: 'NLE',
  // NL Central
  [CHC]: 'NLC', [CIN]: 'NLC', [MIL]: 'NLC', [PIT]: 'NLC', [STL]: 'NLC',
  // NL West
  [ARI]: 'NLW', [COL]: 'NLW', [LAD]: 'NLW', [SD]: 'NLW', [SF]: 'NLW',
}

// ─── Palette ─────────────────────────────────────────────────────────────────

export const TEAM_BG: Record<number, string> = {
  [LAA]: '#BA0021',
  [ARI]: '#A71930',
  [BAL]: '#DF4601',
  [BOS]: '#BD3039',
  [CHC]: '#0E3386',
  [CIN]: '#C6011F',
  [CLE]: '#00385D',
  [COL]: '#33006F',
  [DET]: '#0C2340',
  [HOU]: '#002D62',
  [KC]:  '#004687',
  [LAD]: '#005A9C',
  [WSH]: '#AB0003',
  [NYM]: '#002D72',
  [OAK]: '#003831',
  [PIT]: '#27251F',
  [SD]:  '#2F241D',
  [SEA]: '#005C5C',
  [SF]:  '#27251F',
  [STL]: '#C41E3A',
  [TB]:  '#092C5C',
  [TEX]: '#003278',
  [TOR]: '#134A8E',
  [MIN]: '#002B5C',
  [PHI]: '#E81828',
  [ATL]: '#CE1141',
  [CWS]: '#27251F',
  [MIA]: '#272525',
  [NYY]: '#132448',
  [MIL]: '#12284B',
}

// Secondary / accent colors — used as the contrasting foreground on team-color backgrounds
export const TEAM_SECONDARY: Record<number, string> = {
  [LAA]: '#B8CBE4',  // light blue
  [ARI]: '#E3D4AD',  // sand
  [BAL]: '#000000',  // black
  [BOS]: '#0C2340',  // navy
  [CHC]: '#CC3433',  // red
  [CIN]: '#000000',  // black
  [CLE]: '#E31937',  // red
  [COL]: '#C4CED4',  // silver
  [DET]: '#FA4616',  // orange
  [HOU]: '#EB6E1F',  // orange
  [KC]:  '#BD9B60',  // gold
  [LAD]: '#EF3E42',  // red
  [WSH]: '#14225A',  // navy
  [NYM]: '#FF5910',  // orange
  [OAK]: '#EFB21E',  // gold
  [PIT]: '#FDB827',  // gold
  [SD]:  '#FFC425',  // gold
  [SEA]: '#C4CED4',  // silver
  [SF]:  '#FD5A1E',  // orange
  [STL]: '#0C2340',  // navy
  [TB]:  '#8FBCE6',  // sky blue
  [TEX]: '#C0111F',  // red
  [TOR]: '#E8291C',  // red
  [MIN]: '#D31145',  // red
  [PHI]: '#002D72',  // blue
  [ATL]: '#13274F',  // navy
  [CWS]: '#C4CED4',  // silver
  [MIA]: '#00A3E0',  // blue
  [NYY]: '#C4CED3',  // silver
  [MIL]: '#B6922E',  // gold
}

// ─── Icon styling ─────────────────────────────────────────────────────────────
// The four values that define a team's logo icon: bubble background, ring color,
// standings-row highlight (left border), and which logo art to use. Tuned
// visually in the dev-only Icon Studio, then hardcoded per mode in
// TEAM_ICON_STYLE (dark) and TEAM_ICON_STYLE_LIGHT (light) below.

// Fallback bubble background when a team has no TEAM_ICON_STYLE entry.
export const DEFAULT_ICON_BG_DARK = '#2e2e2e'

// Logo art variants MLB serves — verified to exist for all 30 clubs.
export type LogoVariantKey = 'primary' | 'capDark' | 'capLight' | 'primDark' | 'primLight'
export const LOGO_VARIANTS: { key: LogoVariantKey; label: string; url: (id: number) => string }[] = [
  { key: 'primary',   label: 'Primary',          url: id => `https://www.mlbstatic.com/team-logos/${id}.svg` },
  { key: 'capDark',   label: 'Cap · dark bg',    url: id => `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${id}.svg` },
  { key: 'capLight',  label: 'Cap · light bg',   url: id => `https://www.mlbstatic.com/team-logos/team-cap-on-light/${id}.svg` },
  { key: 'primDark',  label: 'Primary · dark bg',  url: id => `https://www.mlbstatic.com/team-logos/team-primary-on-dark/${id}.svg` },
  { key: 'primLight', label: 'Primary · light bg', url: id => `https://www.mlbstatic.com/team-logos/team-primary-on-light/${id}.svg` },
]
export function teamLogoUrl(id: number, key: LogoVariantKey): string {
  return (LOGO_VARIANTS.find(v => v.key === key) ?? LOGO_VARIANTS[0]).url(id)
}

export interface TeamIconStyle {
  bg:        string          // logo bubble background
  ring:      string          // logo bubble ring/border
  highlight: string          // standings-row left border accent
  logo:      LogoVariantKey  // which logo art to render
  ox?:       number          // horizontal logo nudge, % of image box (default 0)
  oy?:       number          // vertical logo nudge, % of image box (default 0)
  zoom?:     number          // logo scale multiplier (default 1)
}

// CSS transform that applies a team's logo crop (nudge + zoom). Identity when
// no crop is set. transform-origin should be center at the call site.
export function teamLogoTransform(s?: TeamIconStyle): string {
  if (!s) return 'none'
  const ox = s.ox ?? 0, oy = s.oy ?? 0, zoom = s.zoom ?? 1
  if (!ox && !oy && zoom === 1) return 'none'
  return `translate(${ox}%, ${oy}%) scale(${zoom})`
}

// Official brand color palettes per team (primary first). Feeds the Icon Studio's
// per-team swatch choices for background / ring / highlight.
export const TEAM_COLOR_PALETTE: Record<number, string[]> = {
  [LAA]: ['#BA0021', '#003263', '#C4CED4'],
  [ARI]: ['#A71930', '#E3D4AD', '#000000', '#30CED8'],
  [BAL]: ['#DF4601', '#000000'],
  [BOS]: ['#BD3039', '#0C2340'],
  [CHC]: ['#0E3386', '#CC3433'],
  [CIN]: ['#C6011F', '#000000'],
  [CLE]: ['#00385D', '#E31937'],
  [COL]: ['#33006F', '#C4CED4', '#000000'],
  [DET]: ['#0C2340', '#FA4616'],
  [HOU]: ['#002D62', '#EB6E1F'],
  [KC]:  ['#004687', '#BD9B60'],
  [LAD]: ['#005A9C', '#EF3E42'],
  [WSH]: ['#AB0003', '#14225A'],
  [NYM]: ['#002D72', '#FF5910'],
  [OAK]: ['#003831', '#EFB21E'],
  [PIT]: ['#27251F', '#FDB827'],
  [SD]:  ['#2F241D', '#FFC425'],
  [SEA]: ['#0C2C56', '#005C5C', '#C4CED4'],
  [SF]:  ['#FD5A1E', '#27251F', '#AE8F6F'],
  [STL]: ['#C41E3A', '#0C2340', '#FEDB00'],
  [TB]:  ['#092C5C', '#8FBCE6', '#F5D130'],
  [TEX]: ['#003278', '#C0111F'],
  [TOR]: ['#134A8E', '#1D2D5C', '#E8291C'],
  [MIN]: ['#002B5C', '#D31145', '#B9975B'],
  [PHI]: ['#E81828', '#002D72'],
  [ATL]: ['#13274F', '#CE1141'],
  [CWS]: ['#27251F', '#C4CED4'],
  [MIA]: ['#00A3E0', '#EF3340', '#000000', '#FFD100'],
  [NYY]: ['#003087', '#C4CED3'],
  [MIL]: ['#12284B', '#FFC52F', '#B6922E'],
}

// Locked-in DARK-MODE icon styling per team (from the Icon Studio). Consumed by
// ringColor / teamLogoBg / teamLogoSrc / highlightColor in colorUtils.
export const TEAM_ICON_STYLE: Record<number, TeamIconStyle> = {
  [LAA]: { bg: '#000000', ring: '#BA0021', highlight: '#C4CED4', logo: 'primLight' },
  [ARI]: { bg: '#000000', ring: '#A71930', highlight: '#30CED8', logo: 'primDark' },
  [BAL]: { bg: '#000000', ring: '#DF4601', highlight: '#DF4601', logo: 'primDark' },
  [BOS]: { bg: '#0C2340', ring: '#BD3039', highlight: '#BD3039', logo: 'primDark' },
  [CHC]: { bg: '#0E3386', ring: '#CC3433', highlight: '#0E3386', logo: 'primary' },
  [CIN]: { bg: '#C6011F', ring: '#C6011F', highlight: '#C6011F', logo: 'primLight' },
  [CLE]: { bg: '#00385D', ring: '#E50022', highlight: '#E31937', logo: 'primDark' },
  [COL]: { bg: '#33006F', ring: '#C4CED4', highlight: '#C4CED4', logo: 'primDark' },
  [DET]: { bg: '#0C2340', ring: '#FFFFFF', highlight: '#FA4616', logo: 'capDark' },
  [HOU]: { bg: '#002D62', ring: '#EB6E1F', highlight: '#EB6E1F', logo: 'primary' },
  [KC]:  { bg: '#004687', ring: '#BD9B60', highlight: '#004687', logo: 'capDark' },
  [LAD]: { bg: '#005A9C', ring: '#FFFFFF', highlight: '#005A9C', logo: 'capDark' },
  [WSH]: { bg: '#14225A', ring: '#AB0003', highlight: '#AB0003', logo: 'primDark' },
  [NYM]: { bg: '#002D72', ring: '#FF5910', highlight: '#FF5910', logo: 'capLight' },
  [OAK]: { bg: '#003831', ring: '#EFB21E', highlight: '#EFB21E', logo: 'capDark' },
  [PIT]: { bg: '#27251F', ring: '#FDB827', highlight: '#FDB827', logo: 'capDark' },
  [SD]:  { bg: '#2F241D', ring: '#FFC425', highlight: '#FFC425', logo: 'capDark' },
  [SEA]: { bg: '#000000', ring: '#005C5C', highlight: '#005C5C', logo: 'primLight' },
  [SF]:  { bg: '#27251F', ring: '#FD5A1E', highlight: '#FD5A1E', logo: 'primDark' },
  [STL]: { bg: '#0C2340', ring: '#C41E3A', highlight: '#C41E3A', logo: 'primLight' },
  [TB]:  { bg: '#092C5C', ring: '#8FBCE6', highlight: '#092C5C', logo: 'capDark' },
  [TEX]: { bg: '#003278', ring: '#C0111F', highlight: '#C0111F', logo: 'capDark' },
  [TOR]: { bg: '#1D2D5C', ring: '#E8291C', highlight: '#134A8E', logo: 'primary' },
  [MIN]: { bg: '#002B5C', ring: '#D31145', highlight: '#D31145', logo: 'capDark' },
  [PHI]: { bg: '#002D72', ring: '#E81828', highlight: '#E81828', logo: 'primary' },
  [ATL]: { bg: '#13274F', ring: '#CE1141', highlight: '#CE1141', logo: 'capDark' },
  [CWS]: { bg: '#000000', ring: '#C4CED4', highlight: '#C4CED4', logo: 'primDark' },
  [MIA]: { bg: '#000000', ring: '#00A3E0', highlight: '#00A3E0', logo: 'capDark' },
  [NYY]: { bg: '#000000', ring: '#FFFFFF', highlight: '#C4CED3', logo: 'capDark' },
  [MIL]: { bg: '#12284B', ring: '#FFC52F', highlight: '#FFC52F', logo: 'primary' },
}

// Locked-in LIGHT-MODE icon styling per team (from the Icon Studio).
export const TEAM_ICON_STYLE_LIGHT: Record<number, TeamIconStyle> = {
  [LAA]: { bg: '#FFFFFF', ring: '#BA0021', highlight: '#BA0021', logo: 'primary', ox: 3, oy: -3, zoom: 1.1 },
  [ARI]: { bg: '#FFFFFF', ring: '#A71930', highlight: '#A71930', logo: 'primary', oy: -9, zoom: 1.1 },
  [BAL]: { bg: '#FFFFFF', ring: '#DF4601', highlight: '#DF4601', logo: 'primary', zoom: 1.1 },
  [BOS]: { bg: '#0C2340', ring: '#0C2340', highlight: '#BD3039', logo: 'primDark', ox: 3, zoom: 1.1 },
  [CHC]: { bg: '#FFFFFF', ring: '#0E3386', highlight: '#0E3386', logo: 'primary', zoom: 1.1 },
  [CIN]: { bg: '#FFFFFF', ring: '#C6011F', highlight: '#C6011F', logo: 'primary' },
  [CLE]: { bg: '#00385D', ring: '#00385D', highlight: '#00385D', logo: 'capDark', zoom: 1.3 },
  [COL]: { bg: '#FFFFFF', ring: '#33006F', highlight: '#33006F', logo: 'primary', oy: 3 },
  [DET]: { bg: '#0C2340', ring: '#0C2340', highlight: '#0C2340', logo: 'capDark', ox: 3, zoom: 1.3 },
  [HOU]: { bg: '#002D62', ring: '#EB6E1F', highlight: '#002D62', logo: 'primary', zoom: 1.4 },
  [KC]:  { bg: '#004687', ring: '#004687', highlight: '#004687', logo: 'primDark', zoom: 0.9 },
  [LAD]: { bg: '#005A9C', ring: '#005A9C', highlight: '#005A9C', logo: 'capDark', ox: 3, zoom: 1.2 },
  [WSH]: { bg: '#AB0003', ring: '#AB0003', highlight: '#AB0003', logo: 'primDark', ox: -3 },
  [NYM]: { bg: '#002D72', ring: '#002D72', highlight: '#002D72', logo: 'primary', ox: 3, oy: 3 },
  [OAK]: { bg: '#003831', ring: '#003831', highlight: '#003831', logo: 'capDark', zoom: 1.1 },
  [PIT]: { bg: '#000000', ring: '#000000', highlight: '#27251F', logo: 'primary', zoom: 0.9 },
  [SD]:  { bg: '#2F241D', ring: '#2F241D', highlight: '#2F241D', logo: 'capDark', zoom: 1.2 },
  [SEA]: { bg: '#FFFFFF', ring: '#0C2C56', highlight: '#005C5C', logo: 'primDark', zoom: 1.6 },
  [SF]:  { bg: '#27251F', ring: '#27251F', highlight: '#27251F', logo: 'primary', ox: 3 },
  [STL]: { bg: '#FFFFFF', ring: '#C41E3A', highlight: '#C41E3A', logo: 'primary' },
  [TB]:  { bg: '#092C5C', ring: '#092C5C', highlight: '#092C5C', logo: 'capDark', zoom: 1.2 },
  [TEX]: { bg: '#FFFFFF', ring: '#003278', highlight: '#003278', logo: 'primary', oy: 3 },
  [TOR]: { bg: '#134A8E', ring: '#134A8E', highlight: '#134A8E', logo: 'primary', ox: -3, zoom: 1.2 },
  [MIN]: { bg: '#002B5C', ring: '#002B5C', highlight: '#002B5C', logo: 'capDark', ox: -6, zoom: 1.2 },
  [PHI]: { bg: '#FFFFFF', ring: '#E81828', highlight: '#E81828', logo: 'primary', zoom: 1.1 },
  [ATL]: { bg: '#CE1141', ring: '#CE1141', highlight: '#CE1141', logo: 'capDark', ox: -3, zoom: 1.3 },
  [CWS]: { bg: '#000000', ring: '#27251F', highlight: '#27251F', logo: 'capDark', oy: -3, zoom: 1.3 },
  [MIA]: { bg: '#FFFFFF', ring: '#000000', highlight: '#00A3E0', logo: 'primary', oy: -3, zoom: 1.1 },
  [NYY]: { bg: '#FFFFFF', ring: '#003087', highlight: '#132448', logo: 'primary', ox: 3, oy: -3 },
  [MIL]: { bg: '#FFC52F', ring: '#12284B', highlight: '#12284B', logo: 'primary', zoom: 1.2 },
}

export const DEFAULT_PALETTE: Palette = {
  bg: 'hsl(220, 70%, 15%)',
  text: '#ffffff',
  sub: 'rgba(255,255,255,0.58)',
  rank: 'rgba(255,255,255,0.42)',
  divider: 'rgba(255,255,255,0.14)',
}

export function teamPalette(teamId?: number): Palette {
  const bg = (teamId != null && TEAM_BG[teamId]) || DEFAULT_PALETTE.bg
  return { bg, text: '#ffffff', sub: 'rgba(255,255,255,0.62)', rank: 'rgba(255,255,255,0.42)', divider: 'rgba(255,255,255,0.16)' }
}

// ─── 2026 Payroll data ────────────────────────────────────────────────────────
// Source: FanGraphs Roster Resource (https://fangraphs.com/roster-resource/payroll/{slug})
// Scraped 2026-05-30. Units: millions USD. Update when significant contracts are signed.
export const TEAM_PAYROLLS_2026: Record<number, number> = {
  [LAA]: 184,
  [ARI]: 196,
  [BAL]: 166,
  [BOS]: 196,
  [CHC]: 232,
  [CIN]: 128,
  [CLE]:  86,
  [COL]: 122,
  [DET]: 217,
  [HOU]: 237,
  [KC]:  149,
  [LAD]: 400,
  [WSH]:  96,
  [NYM]: 368,
  [OAK]:  95,
  [PIT]: 108,
  [SD]:  209,
  [SEA]: 163,
  [SF]:  201,
  [STL]:  99,
  [TB]:   87,
  [TEX]: 186,
  [TOR]: 289,
  [MIN]: 107,
  [PHI]: 287,
  [ATL]: 254,
  [CWS]:  88,
  [MIA]:  74,
  [NYY]: 308,
  [MIL]: 131,
}

export function randomPalette(): Palette {
  const hue = Math.floor(Math.random() * 360)
  const sat = 65 + Math.floor(Math.random() * 30)
  const dark = Math.random() > 0.3
  const lightness = dark ? 10 + Math.floor(Math.random() * 28) : 62 + Math.floor(Math.random() * 20)
  return {
    bg: `hsl(${hue}, ${sat}%, ${lightness}%)`,
    text: dark ? '#ffffff' : '#0a0a0a',
    sub: dark ? 'rgba(255,255,255,0.58)' : 'rgba(0,0,0,0.52)',
    rank: dark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.32)',
    divider: dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)',
  }
}
