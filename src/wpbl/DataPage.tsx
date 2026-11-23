// /wpbl/data: the season as files, CSV for a spreadsheet and JSON for code.
//
// WHY A PAGE AND NOT JUST THE INDEX. /data/wpbl/index.json has been public since Nov 7, 2026, and a
// developer can start from it; nobody else can. A writer who wants the season in Excel needs a link
// that says CSV, and a dataset with a page of its own is the thing other sites cite and link to
// without being asked (ROADMAP-WPBL, ops item 8), which is what this section is short of.
//
// NO FETCH. The row counts come from each archive folder's manifest.json, bundled at build time by
// the glob below: the same files the build publishes under /data/wpbl/ (vite-plugin-wpbl-data.mjs),
// so the page cannot list a table the download lacks, and it has no loading state to shift. The glob
// names `wpbl` and `wpbl-<year>` only, never `wbsc/`, for the reason the plugin gives.
//
// THE FILES ARE THE RECORD, NOT THE PAGE. Each CSV is written from the JSON beside it, so the two
// always agree, and both are exactly what git holds; a league correction reaches them on the first
// deploy after the weekly archive commit.
import { Box, Typography } from '@mui/material'
import { SectionCard, TYPE_SCALE, hoverOnly } from './ui'
import WpblPage from './WpblPage'
import { isModified } from '../nav'
import { track, EVENTS } from '../lib/analytics'
import { WPBL_SOURCES_PAGE } from './routes'

interface Manifest { exported_at?: string; tables: { table: string; rows: number; bytes: number }[] }

const MANIFESTS = import.meta.glob<Manifest>('../../archive/wpbl*/manifest.json', { eager: true, import: 'default' })

const DATA = '/data/wpbl'

const TABLE_LABELS: Record<string, string> = {
  wpbl_games: 'Games',
  wpbl_batting_lines: 'Batting lines',
  wpbl_pitching_lines: 'Pitching lines',
  wpbl_fielding_lines: 'Fielding lines',
  wpbl_game_plays: 'Plays',
  wpbl_pitch_tracking: 'Pitch tracking',
  wpbl_game_details: 'Game details',
  wpbl_play_corrections: 'Play corrections',
  wpbl_player_team_changes: 'Club changes',
  wpbl_teams: 'Clubs',
  wpbl_players: 'Players',
  wpbl_videos: 'Videos',
  wpbl_articles: 'Articles',
  wpbl_photos: 'Photos',
}

/** A table the list above does not know yet still gets a readable name, never a blank row. */
export function tableLabel(table: string): string {
  if (TABLE_LABELS[table]) return TABLE_LABELS[table]
  const words = table.replace(/^wpbl_/, '').replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export interface DataGroup { key: string; title: string; folder: string; exportedAt?: string; tables: Manifest['tables'] }

/** Seasons newest first, then the league tables. Exported for the test, which holds the page to the
 *  same folders the download publishes. */
export function dataGroups(manifests: Record<string, Manifest> = MANIFESTS): DataGroup[] {
  const seasons: DataGroup[] = []
  let league: DataGroup | null = null
  for (const [file, m] of Object.entries(manifests)) {
    const match = /\/archive\/(wpbl|wpbl-(\d{4}))\/manifest\.json$/.exec(file)
    if (!match) continue
    if (match[2]) seasons.push({ key: match[2], title: `${match[2]} season`, folder: match[2], exportedAt: m.exported_at, tables: m.tables })
    else league = { key: 'league', title: 'Clubs, players and links', folder: 'league', exportedAt: m.exported_at, tables: m.tables }
  }
  seasons.sort((a, b) => b.key.localeCompare(a.key))
  return league ? [...seasons, league] : seasons
}

const LINK = {
  color: 'var(--wpbl-accent-fg)', fontWeight: 700, textDecoration: 'none',
  ...hoverOnly({ textDecoration: 'underline' }),
  '&:focus-visible': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: 2 },
} as const

function FileLink({ href, label, format, table, download }: { href: string; label: string; format: string; table: string; download?: boolean }) {
  return (
    <Box component="a" href={href} download={download ? '' : undefined} aria-label={`${label}, ${format}`}
      onClick={() => track(EVENTS.WPBL_DATA_DOWNLOADED, { table, format: format.toLowerCase() })}
      sx={LINK}>{format}</Box>
  )
}

function dateLabel(iso?: string) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DataPage({ onNavigate }: { onNavigate: (to: string) => void }) {
  const groups = dataGroups()
  return (
    <WpblPage title="Open data">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {groups.map(g => {
          const updated = dateLabel(g.exportedAt)
          return (
            <SectionCard key={g.key} title={g.title}
              action={updated && <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.secondary', fontWeight: 600 }}>Updated {updated}</Typography>}>
              <Box component="table" sx={{
                width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: TYPE_SCALE.body,
                '& th': { fontSize: TYPE_SCALE.micro, color: 'text.secondary', fontWeight: 700, textAlign: 'left', pb: 0.75 },
                '& td': { py: 0.75, borderTop: '1px solid', borderColor: 'divider' },
                '& .num': { textAlign: 'right', fontVariantNumeric: 'tabular-nums', pr: 2 },
                '& .files': { textAlign: 'right', whiteSpace: 'nowrap' },
              }}>
                {/* Fixed widths, in rem because they hold text, so Rows lines up from one card to the next. */}
                <colgroup><col /><col style={{ width: '5.5rem' }} /><col style={{ width: '7rem' }} /></colgroup>
                <thead>
                  <tr><th scope="col">Table</th><th scope="col" className="num">Rows</th><th scope="col" className="files">Files</th></tr>
                </thead>
                <tbody>
                  {g.tables.map(t => {
                    const label = tableLabel(t.table)
                    const base = `${DATA}/${g.folder}/${t.table}`
                    return (
                      <tr key={t.table}>
                        <td>{label}</td>
                        <td className="num">{t.rows.toLocaleString('en-US')}</td>
                        <td className="files">
                          <FileLink href={`${base}.csv`} label={label} format="CSV" table={`${g.folder}/${t.table}`} download />
                          <Box component="span" aria-hidden sx={{ color: 'text.secondary', mx: 0.75 }}>·</Box>
                          <FileLink href={`${base}.json`} label={label} format="JSON" table={`${g.folder}/${t.table}`} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </Box>
            </SectionCard>
          )
        })}

        <SectionCard title="For code">
          <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 1.5, rowGap: 0.75, fontSize: TYPE_SCALE.meta }}>
            <Box component="dt" sx={{ color: 'text.secondary', fontWeight: 700 }}>Index</Box>
            <Box component="dd" sx={{ m: 0 }}><Box component="a" href={`${DATA}/index.json`} sx={LINK}>{DATA}/index.json</Box></Box>
            <Box component="dt" sx={{ color: 'text.secondary', fontWeight: 700 }}>Columns</Box>
            <Box component="dd" sx={{ m: 0 }}><Box component="a" href={`${DATA}/README.md`} sx={LINK}>README.md</Box></Box>
            <Box component="dt" sx={{ color: 'text.secondary', fontWeight: 700 }}>Live feed</Box>
            <Box component="dd" sx={{ m: 0 }}>
              <Box component="a" href="/wpbl/api" sx={LINK}
                onClick={e => { if (!isModified(e)) { e.preventDefault(); onNavigate('/wpbl/api') } }}>API for developers</Box>
            </Box>
          </Box>
        </SectionCard>

        <SectionCard title="Credit">
          <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.6 }}>
            Free to use, with credit to the Women&rsquo;s Pro Baseball League and sportydolphin.fun. The
            numbers are the league&rsquo;s; every source behind them is on{' '}
            <Box component="a" href={WPBL_SOURCES_PAGE} sx={{ ...LINK, color: 'inherit', textDecoration: 'underline' }}
              onClick={e => { if (!isModified(e)) { e.preventDefault(); onNavigate(WPBL_SOURCES_PAGE) } }}>Data sources</Box>.
          </Typography>
        </SectionCard>
      </Box>
    </WpblPage>
  )
}
