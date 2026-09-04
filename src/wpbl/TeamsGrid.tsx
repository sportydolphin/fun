import { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { computeStandings, fetchWpblAllLines } from './api'
import { wpblAccent, wpblFullName, formatGameTime, relativeDayShort } from './constants'
import { TeamBadge, FOCUS_RING, CARD_BORDER, useWpblDark, FormDots, WPBL_WIN as WIN, WPBL_LOSS as LOSS, hoverOnly } from './ui'
import { useWpblTeamLink } from './LinkContext'
import { fmtSigned } from './stats'
import HeadToHead from './HeadToHead'
import type { WpblTeam, WpblGame, WpblStandingRow, WpblBattingLine, WpblPitchingLine } from './types'
import { TeamSpecRadar, TeamSpecPlaceholder } from './TeamSpecRadar'
import { teamSpecs, specLeagueGames, TEAM_SPEC_AXES } from './derive/teamSpec'
import { useWpblHeadingTag, HIDE_ON_PHONE } from './PageHeading'

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
  const teamLink = useWpblTeamLink()
  const isDark = useWpblDark()
  const accent = wpblAccent(row.team.id, isDark)
  const gp = row.wins + row.losses
  const diff = row.runsFor - row.runsAgainst
  // .571, dropping the leading zero the way a batting line is written.
  const pct = gp > 0 ? row.pct.toFixed(3).replace(/^0\./, '.') : null
  const link = teamLink(row.team, onOpen)

  return (
    // A REAL ANCHOR NOW, NOT A role="button" DIV. There was no href to give this until clubs
    // got their own URLs on Sep 2, 2026, and the card was honest about it. Now there is one,
    // and this is the only link on the page a crawler can follow to a club, which is the hub
    // that leads it to eighteen player pages. Same treatment, same reasons, as every player
    // name on the section: see the note at the top of LinkContext.tsx.
    <Box {...link} sx={{
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
      // On a phone a bare :hover latches on tap, so the card a reader opened stayed ringed in
      // its club colour behind them, reading as selected rather than as opened.
      ...hoverOnly({ borderColor: accent }),
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
        {ranked && (
          <Typography sx={{
            width: '0.875rem', flexShrink: 0, textAlign: 'center',
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
  const headingTag = useWpblHeadingTag()
  const isDark = useWpblDark()

  // The spec chart needs league-wide box-score lines, which this page did not previously read.
  // `fetchWpblAllLines` is cached and deduped, and the section warms it on open, so in practice
  // this resolves from memory. Nothing else on the page waits for it: the card renders when it
  // arrives and the four club cards above never blink.
  const [lines, setLines] = useState<{ batting: WpblBattingLine[]; pitching: WpblPitchingLine[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchWpblAllLines().then(l => { if (!cancelled) setLines(l) }).catch(() => { /* empty card */ })
    return () => { cancelled = true }
  }, [])
  const teamIds = useMemo(() => teams.map(t => t.id), [teams])
  const specs = useMemo(
    () => lines ? teamSpecs(teamIds, lines.batting, lines.pitching, games) : null,
    [lines, teamIds, games])
  const specGames = useMemo(() => specLeagueGames(teamIds, games), [teamIds, games])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* The page's one <h1>: /wpbl/teams. A selected team renders TeamPage instead, which
          carries the club name as its own heading. */}
      <Typography component={headingTag} sx={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.3px', lineHeight: 1.2, ...HIDE_ON_PHONE }}>
        WPBL Teams
      </Typography>
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
      {/* All four overlaid, which is the one place in the section they can be. A club's own
          page draws its shape solid against three faint outlines, because there is a subject
          there; here there is not, and the comparison IS the page. Sits with Head to head
          rather than above the cards: both answer "how do these four differ", while the cards
          answer "who is who". */}
      {ranked && (
        <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, p: 1.5 }}>
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, mb: 0.25 }}>Club profiles</Typography>
          <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled', mb: 1 }}>
            {specs
              ? `Each trait against the league average, through ${specs.minGames} games. The middle ring is average.`
              : 'How each club scores on six traits.'}
          </Typography>
          {specs ? (
            <>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 0.5 }}>
                {rows.map(r => (
                  <Box key={r.team.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: wpblAccent(r.team.id, isDark), flexShrink: 0 }} />
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary' }}>{r.team.name}</Typography>
                  </Box>
                ))}
              </Box>
              <TeamSpecRadar specs={specs} teams={teams} radius={110} />
              <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.5 }}>
                {TEAM_SPEC_AXES.map(a => `${a.label}: ${a.stat}`).join(' · ')}
              </Typography>
            </>
          ) : (
            <TeamSpecPlaceholder minGames={specGames} ready={lines != null} />
          )}
        </Box>
      )}

      {/* Only once there is a result to show. Before the first game it is sixteen dots, which
          is a worse answer than not asking the question. */}
      {ranked && <HeadToHead rows={rows} games={games} onSelect={onSelect} />}
    </Box>
  )
}
