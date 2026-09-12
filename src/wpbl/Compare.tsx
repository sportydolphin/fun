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
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, CircularProgress, TextField, InputAdornment } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import {
  fetchWpblTeams, fetchWpblAllPlayers, fetchWpblSchedule, fetchWpblAllLines,
  fetchWpblAllRunValuePlays, getCachedWpblAllRunValuePlays,
  getCachedWpblAllPlayers, getCachedWpblAllLines,
} from './api'
import {
  buildWpblComparison, rankCompareCandidates,
  type WpblCompareGroup, type WpblCompareRow, type WpblCompareSide, type WpblCompareCandidate,
} from './derive/compare'
import {
  CARD_BORDER, SectionCard, TYPE_SCALE, TeamBadge, PlayerPortrait, chromePx, hoverOnly,
  MICRO_TEXT, FOCUS_RING,
} from './ui'
import { buildPositionIndex, displayPositionFromIndex } from './positions'
import { useWpblHeadingTag } from './PageHeading'
import { useEraBasis } from './EraBasisContext'
import {
  WPBL_COMPARE_BASE, wpblComparePath, wpblCompareStartPath, wpblCompareSlugFromPath,
  findWpblComparePair, findWpblPlayerBySlug, wpblPlayerPath,
} from './routes'
import { setDynamicSeo } from '../seo'
import { navBack } from '../nav'
import { track, EVENTS } from '../lib/analytics'
import type { WpblPlayer, WpblTeam, WpblGame } from './types'

/** Modified clicks are left to the browser, so open-in-new-tab works on an internal link the
 *  way it does on any other. Same rule as SourcesPage and LeaguePage. */
const isModified = (e: React.MouseEvent) =>
  e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

// ─── The two names at the top ─────────────────────────────────────────────────

/**
 * One player's identity column.
 *
 * THE NAME IS A REAL LINK to her own page, not an onClick. Googlebot does not fire click
 * handlers (CLAUDE.md, and /mlb sat undiscovered for months over exactly this), and these two
 * anchors are the whole reason a comparison page passes any value back to the pages it is
 * built out of.
 */
function CompareHead({ player, team, roster, position, onNavigate, onClear }: {
  player: WpblPlayer
  team: WpblTeam | undefined
  /** The WHOLE roster, because uniqueness cannot be judged from one row: a name two players
   *  share takes the id-suffixed slug, and a one-element roster would happily mint the bare
   *  one and link to nobody. routes.ts states the rule; this is the call site that would
   *  quietly break it. */
  roster: WpblPlayer[]
  /** Where she has actually played, which is not always what the roster filed. See
   *  positions.ts: Kelsie Whitmore is listed RHP and plays centre field. */
  position: string | null
  onNavigate: (to: string) => void
  onClear?: () => void
}) {
  const href = wpblPlayerPath(player, roster)
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75, minWidth: 0, flex: 1 }}>
      <PlayerPortrait name={player.name} teamId={player.team_id} size={64} />
      <Box
        component="a"
        href={href}
        onClick={e => { if (!isModified(e)) { e.preventDefault(); onNavigate(href) } }}
        sx={{
          textDecoration: 'none', color: 'inherit', textAlign: 'center', minWidth: 0,
          ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
        }}
      >
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, lineHeight: 1.2 }}>
          {player.name}
        </Typography>
      </Box>
      {/* THE NICKNAME, NOT THE FULL CLUB NAME, and the badge is why it can be. "San Francisco
          Firebells · C" wraps onto two lines in a half-width column on any phone, which left
          the two heads different heights and the line itself reading as two facts instead of
          one. The city is the part the badge beside it already says. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: '100%' }}>
        {team && <TeamBadge team={team} size={18} />}
        <Typography noWrap sx={{ fontSize: MICRO_TEXT, color: 'text.secondary', minWidth: 0 }}>
          {team ? team.name : 'Free agent'}{position ? ` · ${position}` : ''}
        </Typography>
      </Box>
      {/* NO CROSS ON IT. A ✕ means remove, and this does not remove: it keeps the OTHER
          player and goes back to the picker to replace this one. The word alone is the
          accurate control, and it stops the header reading as two delete buttons. */}
      {onClear && (
        <Box
          component="button"
          onClick={onClear}
          aria-label={`Replace ${player.name} with another player`}
          sx={{
            // Pushed to the bottom so the two columns line up whatever each name costs.
            mt: 'auto', pt: 0.5,
            border: 'none', background: 'none', cursor: 'pointer', px: 0.75, py: 0.25,
            borderRadius: 999, color: 'text.disabled', fontSize: MICRO_TEXT,
            fontWeight: 700, letterSpacing: 0.3, fontFamily: 'inherit',
            ...hoverOnly({ color: 'text.primary', bgcolor: 'action.hover' }), ...FOCUS_RING,
          }}
        >
          Change
        </Box>
      )}
    </Box>
  )
}

// ─── The rows ─────────────────────────────────────────────────────────────────

/**
 * One stat, both columns, with a tick on whoever leads.
 *
 * THE GEOMETRY IS THE HONESTY. The two value columns are identical in width, weight and
 * position, and the only thing that separates the leader is a colour and a dot. An earlier
 * draft drew the leading number larger, which turns a .312 against a .308 into a picture of
 * one player towering over another over four thousandths of a batting average.
 *
 * The columns reserve their room in `rem`, not px: they hold numbers, they sit next to type
 * sized in rem, and at a reader's Large text setting a px-sized column clips its own contents.
 * See CLAUDE.md on the three kinds of fixed size in this section.
 */
/**
 * The geometry every row in a group shares: the sample band and the stat rows alike.
 *
 * CAPPED AND CENTRED RATHER THAN FULL-WIDTH, which is a fix for the desktop and costs the
 * phone nothing (it is already narrower than the cap). Left to fill the card, the two numbers
 * sat in a 15rem huddle in the middle of a 45rem rule, so every hairline ran a long way past
 * anything it was separating and the figures read as lost rather than as a table.
 *
 * `chromePx`, because this is STRUCTURE: raw px here shrinks 40% against the type inside it
 * (CLAUDE.md on the three kinds of fixed size). The value columns are `rem` for the opposite
 * reason: they reserve room for a number and must grow with the text.
 */
/**
 * A comparison table, with its heading centred over it.
 *
 * NOT `SectionCard`, which is what the rest of the section uses and what this used first. Its
 * title sits at the left, which is right for a card whose body is prose or a list running left
 * to right, and wrong for this one: the body is a symmetrical three-column table centred on the
 * page, so a left-aligned heading was the only thing on the card off its own axis.
 *
 * The band is the shape a stats table has had since long before the web (Stathead draws the
 * same thing across the top of its comparison, and Baseball-Reference before it): a caption
 * spanning the full width, centred, in a recessed strip, saying what the block underneath is.
 * It reads as the table's own header rather than as a card that happens to contain one.
 *
 * `action.hover` for the strip, because it is MUI's theme-aware overlay and lands as a lift in
 * dark and a wash in light without this file deciding which theme it is in.
 */
function CompareCard({ title, subtitle, children }: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <Box sx={{
      border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2,
      // So the band's top corners clip to the card's radius instead of squaring it off.
      overflow: 'hidden',
    }}>
      <Box sx={{
        px: 2, py: 0.6, textAlign: 'center',
        bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: CARD_BORDER,
      }}>
        <Typography component="h2" sx={{
          fontSize: '0.78rem', fontWeight: 800, letterSpacing: 0.8,
          textTransform: 'uppercase', lineHeight: 1.3,
        }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography sx={{ fontSize: MICRO_TEXT, color: 'text.disabled', lineHeight: 1.3 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      <Box sx={{ p: 1.25 }}>{children}</Box>
    </Box>
  )
}

const STAT_ROW = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
  maxWidth: chromePx(400), mx: 'auto',
} as const

function CompareStatRow({ row }: { row: WpblCompareRow }) {
  const cell = (side: WpblCompareSide, text: string) => {
    const leads = row.leader === side
    return (
      // THE WHOLE CELL IS THE HIGHLIGHT, the way Stathead shades a winner's column rather than
      // ringing the glyph. A pill around a single digit is a dot nobody sees; on the counting
      // rows, where most figures are one or two characters, it was doing nothing. The cell is
      // fixed-width and the figure centred in it, so the wash is the same block whichever side
      // leads and the number never shifts as the lead changes hands.
      <Box sx={{
        flex: '0 0 5.5rem', alignSelf: 'stretch', borderRadius: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: leads ? 'var(--wpbl-compare-lead)' : 'transparent',
      }}>
        {/* A WASH AND A WEIGHT, NOT A SIZE. The leading figure keeps the losing one's font size:
            drawing .477 larger than .400 turns seventy-seven thousandths of a batting average
            into a picture of one player towering over another. Full-strength ink both sides so
            the loser stays readable; the wash plus the bold is what names the winner. */}
        <Typography component="span" sx={{
          fontSize: '0.8rem', fontWeight: leads ? 800 : 600,
          fontVariantNumeric: 'tabular-nums', color: 'text.primary',
        }}>
          {text}
        </Typography>
      </Box>
    )
  }
  return (
    <Box sx={{
      ...STAT_ROW,
      py: 0.15, borderBottom: '1px solid', borderColor: 'divider',
      '&:last-of-type': { borderBottom: 'none' },
    }}>
      {cell('a', row.aText)}
      <Typography sx={{
        flex: '1 1 auto', textAlign: 'center', minWidth: 0,
        fontSize: MICRO_TEXT, fontWeight: 700, letterSpacing: 0.4,
        textTransform: 'uppercase', color: 'text.secondary',
      }}>
        {row.label}
      </Typography>
      {cell('b', row.bText)}
    </Box>
  )
}

/**
 * One group's table, in Stathead's order: playing time, then the counting line, then the rates.
 *
 * THREE BLOCKS, EACH UNDER ONE RULE. G / PA (or G / GS / IP) lead, then H / HR / RBI / SB and
 * the rest, then the slash line, which is how Stathead's own comparison reads top to bottom. The
 * rule between blocks is all the labelling they need: "Totals" over a column of plain numbers
 * tells a reader what they can already see, and the change of rule says the kind of number
 * changed. `qualified` and `barText` are still built and still tested, for a surface that wants
 * to mark the qualifying bar without writing a paragraph about it.
 *
 * NO "SHE HAS NOT REACHED 36 PA" FOOTNOTE, which this carried until it was read on a real pair:
 * three lines of small type saying in prose what the playing-time rows already say in figures.
 */
function CompareGroupCard({ group }: { group: WpblCompareGroup }) {
  // Each block wrapped so `:last-of-type` inside CompareStatRow means "the last row of THIS
  // block": flat among its siblings it meant the last row of the card, so every block but the
  // final one kept its bottom rule and met the next block's top rule with a doubled hairline.
  const rule = { borderTop: '1px solid', borderColor: CARD_BORDER, maxWidth: chromePx(400), mx: 'auto' } as const
  return (
    <CompareCard title={group.label}>
      {/* PLAYING TIME FIRST, ALWAYS, and drawn with no tick (see playedRow): every rate below
          is read against it, but more games is context, not a thing to be ahead on. */}
      <Box>{group.playingTime.map(r => <CompareStatRow key={r.key} row={r} />)}</Box>

      {/* The counting line, under one rule. NO MARGIN AND NO PADDING ON THE BREAK: the last row
          of the block above drops its own rule (`:last-of-type`) and this supplies it a shade
          stronger, so the gap either side of a break is exactly the gap between two rows. */}
      <Box sx={rule}>{group.counting.map(r => <CompareStatRow key={r.key} row={r} />)}</Box>

      {/* The rates last, the same way. */}
      <Box sx={rule}>{group.rate.map(r => <CompareStatRow key={r.key} row={r} />)}</Box>
    </CompareCard>
  )
}

/**
 * What happened when they actually faced each other.
 *
 * THE REASON THIS PAGE IS WORTH BUILDING FOR THIS LEAGUE IN PARTICULAR. Four clubs and six
 * pairings means a hitter sees the same pitcher ten to fifteen times in a season, a sample a
 * thirty-club league never produces; in the majors the equivalent line is four at-bats and
 * means nothing. It is still a small number, so the card prints the raw line and no rate
 * commentary: 3-for-11 is a fact, "owns her" is not.
 */
function MatchupCard({ comparison, a, b }: {
  comparison: ReturnType<typeof buildWpblComparison>
  a: WpblPlayer
  b: WpblPlayer
}) {
  if (comparison.matchups.length === 0) return null
  const name = (side: WpblCompareSide) => (side === 'a' ? a.name : b.name)
  return (
    <CompareCard title="Head to head" subtitle="Regular season only">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, textAlign: 'center' }}>
        {comparison.matchups.map(m => (
          <Box key={m.batter}>
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, mb: 0.25 }}>
              {name(m.batter)} batting against {name(m.batter === 'a' ? 'b' : 'a')}
            </Typography>
            <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
              {m.h}-for-{m.ab}
              {m.avg != null ? ` (${m.avg.toFixed(3).replace(/^0(?=\.)/, '')})` : ''}
              {' · '}{m.pa} PA
              {m.hr > 0 ? ` · ${m.hr} HR` : ''}
              {m.bb > 0 ? ` · ${m.bb} BB` : ''}
              {m.so > 0 ? ` · ${m.so} SO` : ''}
            </Typography>
          </Box>
        ))}
      </Box>
    </CompareCard>
  )
}

// ─── The picker ───────────────────────────────────────────────────────────────

/**
 * Choosing the second player.
 *
 * A FLAT SEARCHABLE LIST rather than a club-by-club drill-down. The comparison a reader wants
 * is usually across clubs (that is what makes it an argument), so grouping by club puts the
 * two halves of every interesting pair on opposite ends of a scroll.
 */
function PlayerPicker({ candidates, teams, positionOf, onPick }: {
  /** Already in the order to offer them in; see `rankCompareCandidates`. */
  candidates: WpblCompareCandidate[]
  teams: WpblTeam[]
  /** Where she has played, not what the roster filed. The same answer the header gives, so a
   *  reader does not pick "Kelsie Whitmore, RHP" out of a list and land on a centre fielder. */
  positionOf: (p: WpblPlayer) => string | null
  onPick: (p: WpblPlayer) => void
}) {
  const [q, setQ] = useState('')
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  // The ranking is the derive layer's, and this only FILTERS it: typing must never reorder the
  // list under the reader beyond floating the name they are plainly typing. Uncapped, because
  // the box scrolls; a cap would silently hide the back half of the roster.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return candidates
    const hits = candidates.filter(c => c.player.name.toLowerCase().includes(needle))
    // A name that STARTS with what was typed first. Someone typing "Mo" means Molly before
    // Kelsie Whitmore's surname, however much more Whitmore has played.
    return [
      ...hits.filter(c => c.player.name.toLowerCase().startsWith(needle)),
      ...hits.filter(c => !c.player.name.toLowerCase().startsWith(needle)),
    ]
  }, [candidates, q])

  return (
    <Box>
      <TextField
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search players"
        size="small"
        fullWidth
        InputProps={{
          startAdornment: (
            <InputAdornment position="start"><SearchIcon sx={{ fontSize: '1.1rem' }} /></InputAdornment>
          ),
        }}
        sx={{ mb: 1.5 }}
      />
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
        gap: 0.5,
        maxHeight: chromePx(420),
        overflowY: 'auto',
        // Belt to the `minWidth: 0` on each row: nothing in this list is worth a sideways
        // scrollbar, and a name that cannot fit ellipsises instead.
        overflowX: 'hidden',
      }}>
        {shown.map(({ player: p, playedText }) => {
          const team = p.team_id ? teamById.get(p.team_id) : undefined
          return (
            <Box
              key={p.id}
              component="button"
              onClick={() => onPick(p)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1, width: '100%', textAlign: 'left',
                // A GRID ITEM'S `min-width` IS `auto`, so without this the button refuses to go
                // narrower than its own contents, the column stretches to fit the longest name
                // plus its figures, and the whole list grows a horizontal scrollbar. The name
                // inside is the part that should give, and it does once this lets it.
                minWidth: 0,
                p: 0.75, borderRadius: 1.5, border: '1px solid', borderColor: CARD_BORDER,
                bgcolor: 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
                ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING,
              }}
            >
              {team && <TeamBadge team={team} size={20} />}
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, minWidth: 0, flex: 1 }} noWrap>
                {p.name}
              </Typography>
              {positionOf(p) && (
                <Typography noWrap sx={{ fontSize: MICRO_TEXT, color: 'text.disabled', flexShrink: 1, minWidth: 0 }}>
                  {positionOf(p)}
                </Typography>
              )}
              {/* THE SORT KEY, PRINTED. Without it the order looks arbitrary, which is worse
                  than alphabetical: a reader can at least trust an alphabet. With it the list
                  explains itself in one column, and it is the same figure the comparison
                  leads with once they have picked. */}
              <Typography sx={{
                fontSize: MICRO_TEXT, color: 'text.disabled', fontVariantNumeric: 'tabular-nums',
                flexShrink: 0, minWidth: '3.4rem', textAlign: 'right',
              }}>
                {playedText}
              </Typography>
            </Box>
          )
        })}
        {shown.length === 0 && (
          <Typography sx={{ fontSize: '0.82rem', color: 'text.disabled', p: 1 }}>
            Nobody by that name.
          </Typography>
        )}
      </Box>
    </Box>
  )
}

// ─── The page ─────────────────────────────────────────────────────────────────

export default function WpblComparePage({ path, onNavigate }: {
  path: string
  onNavigate: (to: string) => void
}) {
  const headingTag = useWpblHeadingTag()
  const { basis } = useEraBasis()

  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [players, setPlayers] = useState<WpblPlayer[]>(() => getCachedWpblAllPlayers() ?? [])
  const [games, setGames] = useState<WpblGame[]>([])
  const [lines, setLines] = useState(() => getCachedWpblAllLines())
  const [loading, setLoading] = useState(players.length === 0)
  // The play log, for the head-to-head alone. Allowed never to arrive; the card simply does
  // not render, exactly as the percentile strip is allowed to be absent on a player page.
  const [plays, setPlays] = useState(() => getCachedWpblAllRunValuePlays())

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchWpblTeams(), fetchWpblAllPlayers(), fetchWpblSchedule(), fetchWpblAllLines()])
      .then(([t, p, g, l]) => {
        if (cancelled) return
        setTeams(t); setPlayers(p); setGames(g); setLines(l)
      })
      .catch(() => { /* the empty state below is the whole error path */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    fetchWpblAllRunValuePlays()
      .then(pl => { if (!cancelled) setPlays(pl) })
      .catch(() => { /* no head-to-head card; the page is what it was without it */ })
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

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])

  // Where each of them has actually taken the field, which the roster's own listing routinely
  // gets wrong for a two-way player. Built from the whole league's batting lines rather than
  // per player, because that is the shape positions.ts offers and the lines are already here.
  const positionIndex = useMemo(
    () => buildPositionIndex(lines?.batting ?? [], games), [lines, games])
  const positionOf = (p: WpblPlayer) => displayPositionFromIndex(p, positionIndex).label

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
      plays: plays ?? undefined, basis,
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
      },
    })
    return () => setDynamicSeo(null)
  }, [pair, slug, path])

  useEffect(() => {
    if (pair) track(EVENTS.WPBL_COMPARE_VIEWED, { a: pair[0].id, b: pair[1].id })
  }, [pair])

  const pick = (chosen: WpblPlayer) => {
    if (single) onNavigate(wpblComparePath(single, chosen, players))
    else onNavigate(wpblCompareStartPath(chosen, players))
  }

  if (loading && players.length === 0) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  }

  // NARROWER THAN THE SECTION'S USUAL BOARD. This page is two columns of figures and two
  // names, not a fourteen-column log: at 720 the two portraits sat a third of a screen apart
  // and read as two separate cards rather than as one comparison.
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: chromePx(560), mx: 'auto', width: '100%' }}>
      {/* A WAY BACK TO THE SECTION. This is a standalone route, so the sticky pill nav that
          carries Home / Schedule / Standings is not on the page. `navBack` returns the reader to
          the screen they came from (usually the player page that opened this), and only falls
          back to /wpbl when there is nothing behind it, a shared link opened cold. The href
          stays /wpbl for a crawler, which has no history to go back through. */}
      <Box
        component="a"
        href="/wpbl"
        onClick={e => { if (!isModified(e)) { e.preventDefault(); navBack('/wpbl') } }}
        sx={{
          alignSelf: 'flex-start',
          textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 0.5,
          color: 'text.secondary', fontSize: '0.85rem', fontWeight: 700,
          px: 1.25, py: 0.6, borderRadius: 999, border: '1px solid', borderColor: 'divider',
          bgcolor: 'background.paper',
          ...hoverOnly({ color: 'text.primary', borderColor: 'text.secondary' }), ...FOCUS_RING,
        }}
      >← Back to WPBL</Box>

      <Typography component={headingTag} sx={{
        fontSize: TYPE_SCALE.heading, fontWeight: 800, letterSpacing: '-0.3px', lineHeight: 1.2,
      }}>
        {pair ? `${pair[0].name} vs ${pair[1].name}` : 'Compare players'}
      </Typography>

      {!pair && (
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary', lineHeight: 1.5 }}>
          {single
            ? `Pick somebody to put next to ${single.name}.`
            : 'Pick two players to put their 2026 seasons side by side.'}
        </Typography>
      )}

      {(pair || single) && (
        <Box sx={{
          display: 'flex', alignItems: 'stretch', gap: 1,
          p: 2, borderRadius: 2, border: '1px solid', borderColor: CARD_BORDER,
        }}>
          <CompareHead
            player={pair ? pair[0] : single!}
            team={(pair ? pair[0] : single!).team_id ? teamById.get((pair ? pair[0] : single!).team_id!) : undefined}
            roster={players}
            position={positionOf(pair ? pair[0] : single!)}
            onNavigate={onNavigate}
            onClear={pair ? () => onNavigate(wpblCompareStartPath(pair[1], players)) : undefined}
          />
          {/* A WORD, NOT THE SWAP ICON THAT WAS HERE. Two arrows between two names read as a
              control that swaps them, and there is nothing for it to do: the URL is the pair
              in alphabetical order (routes.ts), so which name is on the left is not the
              reader's to choose and a button offering it would either lie or mint a
              non-canonical URL. "vs" says the same thing and promises nothing. */}
          <Typography aria-hidden sx={{
            alignSelf: 'center', flexShrink: 0, px: 0.5,
            fontSize: MICRO_TEXT, fontWeight: 800, letterSpacing: 0.8,
            textTransform: 'uppercase', color: 'text.disabled',
          }}>vs</Typography>
          {pair ? (
            <CompareHead
              player={pair[1]}
              team={pair[1].team_id ? teamById.get(pair[1].team_id) : undefined}
              roster={players}
              position={positionOf(pair[1])}
              onNavigate={onNavigate}
              onClear={() => onNavigate(wpblCompareStartPath(pair[0], players))}
            />
          ) : (
            <Box sx={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              minHeight: chromePx(96), color: 'text.disabled', fontSize: '0.82rem',
            }}>
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
          {comparison.groups.map(g => (
            <CompareGroupCard key={g.key} group={g} />
          ))}
          {comparison.groups.length === 0 && (
            <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled' }}>
              Neither has a box-score line this season, so there is nothing to compare yet.
            </Typography>
          )}
          <MatchupCard comparison={comparison} a={pair[0]} b={pair[1]} />
          {/* A WAY OUT THAT IS NOT THE BACK BUTTON. Somebody who has just read one comparison
              usually wants another, and without this the only route to one is retyping a URL. */}
          <Box
            component="a"
            href={WPBL_COMPARE_BASE}
            onClick={e => { if (!isModified(e)) { e.preventDefault(); onNavigate(WPBL_COMPARE_BASE) } }}
            sx={{
              // Centred like every other thing on this page. At flex-start it was the one
              // element hanging off the left edge under a column of centred tables.
              alignSelf: 'center', fontSize: '0.8rem', fontWeight: 700,
              color: 'var(--wpbl-accent-fg)',
              textDecoration: 'none', ...hoverOnly({ textDecoration: 'underline' }), ...FOCUS_RING,
            }}
          >
            Compare two other players
          </Box>
        </>
      )}
    </Box>
  )
}
