import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { computeStandings } from './api'
import { wpblAccent, wpblFullName, formatGameTime, relativeDayShort } from './constants'
import { SectionCard, TeamBadge, pressable, FOCUS_RING, CARD_BORDER, useWpblDark } from './ui'
import { fmtSigned } from './stats'
import { headToHead } from './derive/matchups'
import type { WpblTeam, WpblGame, WpblStandingRow } from './types'

/**
 * The Teams tab's landing screen: one card per club, in standings order.
 *
 * It used to be four cards holding a badge, a name and an abbreviation: a menu, and a
 * near-duplicate of the Teams card already on Home, so a whole nav slot bought nothing you
 * couldn't get by scrolling. Everything below is derived from `teams` + `games`, both of
 * which the section already has in memory, so the upgrade costs no request.
 *
 * What each card says that the Standings table can't: the SHAPE of the record (five form
 * dots, where the table can only count them), and what's next. What it deliberately leaves
 * to the table: GB, L10 and the season run totals. Two views of four teams only justify
 * themselves if they answer different questions.
 */

// Green/red for a result, from the section's themed positive/negative tokens (styles.css).
// Literals here would fail contrast in one mode or the other (the dark-mode pair measures
// 2.28 and 3.76 against a light background) and these have to read as a 9px shape in both.
const WIN = 'var(--wpbl-pos)'
const LOSS = 'var(--wpbl-neg)'

const DOT = 9
const DOT_GAP = 4
const RING = 2

/**
 * Last-five results as dots, oldest first: the same left-to-right order a schedule reads,
 * and the same order every form guide in sport uses.
 *
 * A win is SOLID and a loss is a RING. Colour alone would have been the only thing telling
 * the two apart, and red/green is precisely the pair that around one man in twelve cannot
 * separate. Everywhere else in the section the colour is redundant ("+26", "W4", "4–3" all
 * say it in text as well), and this strip must not be the exception. Filled-versus-hollow
 * survives greyscale, deuteranopia and a glance from arm's length.
 *
 * No opacity ramp for recency, either. It was competing with the fill/ring distinction for
 * the same few pixels and left the older rings too faint to read as rings at all.
 *
 * Only as many dots as there are games: five grey placeholders on opening week would suggest
 * a team had lost five, which is the one thing the strip must never imply.
 */
function FormDots({ recent }: { recent: ('W' | 'L')[] }) {
  if (recent.length === 0) return null
  return (
    <Box
      role="img"
      aria-label={`Last ${recent.length}, oldest first: ${recent.join(' ')}`}
      sx={{ display: 'flex', alignItems: 'center', gap: `${DOT_GAP}px`, flexShrink: 0 }}
    >
      {recent.map((r, i) => (
        <Box key={i} sx={{
          width: DOT, height: DOT, borderRadius: '50%', boxSizing: 'border-box',
          ...(r === 'W'
            ? { bgcolor: WIN }
            : { border: `${RING}px solid ${LOSS}` }),
        }} />
      ))}
    </Box>
  )
}

/** Chronological order for a team's games: date, then wall-clock start so a doubleheader's
 *  two games don't swap. Mirrors the ordering `computeStandings` uses, kept local because
 *  this is a display concern: the standings derivation owns its own copy and should. */
function startMin(t: string | null | undefined): number {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec((t ?? '').trim())
  if (!m) return 0
  let h = Number(m[1]) % 12
  if (/pm/i.test(m[3])) h += 12
  return h * 60 + Number(m[2])
}
const byStart = (a: WpblGame, b: WpblGame) =>
  a.game_date !== b.game_date ? (a.game_date < b.game_date ? -1 : 1) : startMin(a.start_time) - startMin(b.start_time)

/** What the card's footer is about: the game in progress if there is one, else the next
 *  one scheduled, else the last one played. Every team has one of the three from the moment
 *  the schedule exists, so the footer is never an empty row holding space. */
type Fixture =
  | { kind: 'live'; game: WpblGame; opp: WpblTeam | undefined; home: boolean }
  | { kind: 'next'; game: WpblGame; opp: WpblTeam | undefined; home: boolean }
  | { kind: 'last'; game: WpblGame; opp: WpblTeam | undefined; home: boolean; us: number; them: number }
  | null

function fixtureFor(teamId: string, games: WpblGame[], byId: Map<string, WpblTeam>): Fixture {
  const mine = games.filter(g => g.home_team_id === teamId || g.away_team_id === teamId).sort(byStart)
  const shape = (g: WpblGame) => {
    const home = g.home_team_id === teamId
    return { game: g, home, opp: byId.get(home ? g.away_team_id : g.home_team_id) }
  }
  const live = mine.find(g => g.status === 'live')
  if (live) return { kind: 'live', ...shape(live) }
  const next = mine.find(g => g.status === 'scheduled')
  if (next) return { kind: 'next', ...shape(next) }
  const played = mine.filter(g => g.status === 'final' && g.home_score != null && g.away_score != null)
  const last = played[played.length - 1]
  if (!last) return null
  const s = shape(last)
  return {
    kind: 'last', ...s,
    us: s.home ? last.home_score! : last.away_score!,
    them: s.home ? last.away_score! : last.home_score!,
  }
}

function FixtureLine({ fixture }: { fixture: Fixture }) {
  if (!fixture) {
    return <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>Schedule to come</Typography>
  }
  const { kind, game, opp, home } = fixture
  const label = kind === 'live' ? 'Live' : kind === 'next' ? 'Next' : 'Last'
  const time = formatGameTime(game.game_date, game.start_time)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
      <Typography sx={{
        fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4,
        color: kind === 'live' ? LOSS : 'text.disabled', flexShrink: 0,
      }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', flexShrink: 0 }}>{home ? 'vs' : '@'}</Typography>
      {opp && <TeamBadge team={opp} size={16} />}
      {/* The abbreviation as well as the badge. A 16px logo is a colour, not an identifier:
          two of the four crests are a dark disc with a monogram at that size. */}
      {opp && (
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.2, color: 'text.secondary', flexShrink: 0 }}>
          {opp.abbr}
        </Typography>
      )}
      <Typography sx={{
        fontSize: '0.72rem', fontWeight: 600, color: 'text.secondary', minWidth: 0,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {fixture.kind === 'last'
          ? `${fixture.us > fixture.them ? 'W' : fixture.us < fixture.them ? 'L' : 'T'} ${fixture.us}–${fixture.them}`
          : `${relativeDayShort(game.game_date)}${time ? ` · ${time}` : ''}`}
      </Typography>
    </Box>
  )
}

function TeamCard({ row, rank, ranked, fixture, onOpen }: {
  row: WpblStandingRow
  rank: number
  /** False before the first result, when every team is 0–0 and a rank number would be
   *  inventing an order out of whatever the tiebreakers happened to do with zeroes. */
  ranked: boolean
  fixture: Fixture
  onOpen: () => void
}) {
  const isDark = useWpblDark()
  const accent = wpblAccent(row.team.id, isDark)
  const gp = row.wins + row.losses
  const diff = row.runsFor - row.runsAgainst
  // .571, dropping the leading zero the way a batting line is written.
  const pct = gp > 0 ? row.pct.toFixed(3).replace(/^0\./, '.') : null

  return (
    <Box {...pressable(onOpen)} sx={{
      ...FOCUS_RING,
      display: 'flex', flexDirection: 'column', gap: 0.9,
      p: 1.5, pl: 1.25, cursor: 'pointer',
      borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
      // The club's colour, permanently, rather than only on hover. Four cards of identical
      // chrome is what made the old grid read as a list of links. Hover still lifts the whole
      // hairline to the same colour, so the two states are one idea at two strengths.
      borderLeft: '3px solid', borderLeftColor: accent,
      bgcolor: 'background.paper',
      transition: 'border-color 0.15s',
      '&:hover': { borderColor: accent },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
        {ranked && (
          <Typography sx={{
            width: 14, flexShrink: 0, textAlign: 'center',
            fontSize: '0.78rem', fontWeight: 800, color: 'text.disabled', fontVariantNumeric: 'tabular-nums',
          }}>
            {rank}
          </Typography>
        )}
        <TeamBadge team={row.team} size={38} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{
            fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {wpblFullName(row.team)}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.4, minWidth: 0 }}>
            <FormDots recent={row.recent} />
            {/* Only once it's longer than the dot strip can show. Below three it's a fact the
                dots already carry; at three and up it's the headline about the team. */}
            {row.streak && row.streak.count >= 3 && (
              <Typography sx={{
                fontSize: '0.68rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                color: row.streak.type === 'W' ? WIN : LOSS,
              }}>
                {row.streak.type}{row.streak.count}
              </Typography>
            )}
            {gp === 0 && (
              <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>Yet to play</Typography>
            )}
          </Box>
        </Box>
        <Box sx={{ flexShrink: 0, textAlign: 'right' }}>
          <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
            {row.wins}–{row.losses}
          </Typography>
          {pct && (
            <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
              {pct}
            </Typography>
          )}
        </Box>
      </Box>

      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
        pt: 0.85, borderTop: '1px solid', borderColor: 'divider', minWidth: 0,
      }}>
        <FixtureLine fixture={fixture} />
        {gp > 0 && (
          <Typography sx={{
            fontSize: '0.7rem', fontWeight: 700, flexShrink: 0, fontVariantNumeric: 'tabular-nums',
            color: diff > 0 ? WIN : diff < 0 ? LOSS : 'text.secondary',
          }}>
            {fmtSigned(diff)}
            <Box component="span" sx={{ ml: 0.5, fontWeight: 700, fontSize: '0.58rem', letterSpacing: 0.3, color: 'text.disabled' }}>DIFF</Box>
          </Typography>
        )}
      </Box>
    </Box>
  )
}

// ─── Head-to-head ───────────────────────────────────────────────────────────────

// Washes behind a cell rather than coloured text. The record is spelled out in the cell
// already, so the tint is pure reinforcement, which is what lets it be this quiet, and what
// keeps the grid readable for anyone who can't separate the two hues.
const CELL_WIN = 'rgba(34,197,94,0.15)'
const CELL_LOSS = 'rgba(239,68,68,0.15)'

/**
 * The four-by-four matchup grid: read a row across and you get how that club has fared
 * against each of the other three.
 *
 * This is the one artifact a four-team league can have and a thirty-team league cannot. Over
 * a 15-game season every club plays every other constantly, so a bare "4–3" hides the shape
 * of a record completely: a team can be unbeaten against two opponents and swept by the
 * third, and that is the thing worth knowing before the next meeting. Sixteen cells is the
 * entire league, and at four columns it fits a phone with no sideways scrolling.
 *
 * Rows are in standings order, matching the cards above, so the eye can carry a club from one
 * to the other. Built from the shared `headToHead` derivation over the `games` already in
 * memory, so no extra read.
 *
 * Deliberately no run differential in the cells. Across the two or three meetings a given
 * pair has had by midseason it is noise, and sixteen cells carrying two numbers each is more
 * ink than a phone can spend on a card whose whole job is to be scanned.
 */
function HeadToHead({ rows, games, onSelect }: {
  rows: WpblStandingRow[]
  games: WpblGame[]
  onSelect: (t: WpblTeam) => void
}) {
  const grid = useMemo(() => headToHead(games), [games])
  const teams = rows.map(r => r.team)

  const head = {
    fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 0.4,
    color: 'text.disabled', textAlign: 'center' as const, py: 0.5,
  }

  return (
    <SectionCard title="Head to head" subtitle="Each row's record against the columns">
      {/* Capped and centred on a wide screen. The grid is sized by what a phone can hold, and
          letting four cells share a 720px column just stretched each one to ~110px of mostly
          empty wash. The matrix reads as a block, so it should stay block-shaped. */}
      <Box component="table" sx={{
        width: '100%', maxWidth: { xs: 'none', sm: 560 }, mx: 'auto',
        borderCollapse: 'separate', borderSpacing: '3px', tableLayout: 'fixed',
      }}>
        <Box component="thead">
          <Box component="tr">
            {/* Corner cell. Fixed so the four matchup columns split what's left evenly and
                every cell in the grid is the same width. */}
            <Box component="th" sx={{ width: 58 }} />
            {teams.map(t => (
              <Box component="th" key={t.id} sx={head}>{t.abbr}</Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {teams.map(rowTeam => (
            <Box component="tr" key={rowTeam.id}>
              <Box component="th" scope="row" sx={{ p: 0 }}>
                {/* The row label is also the way into that club's page: the badge is right
                    there, and a reader who has just spotted a 0–3 wants to go look. */}
                <Box {...pressable(() => onSelect(rowTeam))} sx={{
                  ...FOCUS_RING,
                  display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer',
                  borderRadius: 1, py: 0.4, '&:hover': { bgcolor: 'action.hover' },
                }}>
                  <TeamBadge team={rowTeam} size={20} />
                  <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.3, color: 'text.secondary' }}>
                    {rowTeam.abbr}
                  </Typography>
                </Box>
              </Box>
              {teams.map(colTeam => {
                // The diagonal: a club has no record against itself, and leaving it blank is
                // what makes the grid read as a matrix rather than as a table with a hole.
                if (colTeam.id === rowTeam.id) {
                  return (
                    <Box component="td" key={colTeam.id} sx={{ textAlign: 'center', color: 'text.disabled', fontSize: '0.8rem', py: 0.75 }}>
                      —
                    </Box>
                  )
                }
                const c = grid.get(rowTeam.id, colTeam.id)
                const met = !!c && (c.wins + c.losses) > 0
                const ahead = met && c!.wins > c!.losses
                const behind = met && c!.wins < c!.losses
                return (
                  <Box
                    component="td"
                    key={colTeam.id}
                    sx={{
                      textAlign: 'center', py: 0.75, borderRadius: 1,
                      bgcolor: ahead ? CELL_WIN : behind ? CELL_LOSS : met ? 'action.hover' : 'transparent',
                    }}
                  >
                    <Typography sx={{
                      fontSize: '0.82rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                      color: met ? 'text.primary' : 'text.disabled',
                    }}>
                      {/* An unplayed pairing is a dot, not "0–0": the two look identical at a
                          glance and mean opposite things (nobody has won vs they split). */}
                      {met ? `${c!.wins}–${c!.losses}` : '·'}
                    </Typography>
                  </Box>
                )
              })}
            </Box>
          ))}
        </Box>
      </Box>
    </SectionCard>
  )
}

export default function TeamsGrid({ teams, games, onSelect }: {
  teams: WpblTeam[]
  games: WpblGame[]
  onSelect: (t: WpblTeam) => void
}) {
  const rows = useMemo(() => computeStandings(teams, games), [teams, games])
  const byId = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const fixtures = useMemo(
    () => new Map(teams.map(t => [t.id, fixtureFor(t.id, games, byId)])),
    [teams, games, byId])
  const ranked = rows.some(r => r.wins + r.losses > 0)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
        {rows.map((r, i) => (
          <TeamCard
            key={r.team.id}
            row={r}
            rank={i + 1}
            ranked={ranked}
            fixture={fixtures.get(r.team.id) ?? null}
            onOpen={() => onSelect(r.team)}
          />
        ))}
      </Box>
      {/* Only once there is a result to show. Before the first game it is sixteen dots, which
          is a worse answer than not asking the question. */}
      {ranked && <HeadToHead rows={rows} games={games} onSelect={onSelect} />}
    </Box>
  )
}
