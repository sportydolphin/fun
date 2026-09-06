import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { deriveSituation, shortName, type Situation } from './Live'
import { LazyWinProbCard } from './RecapCard'
import { normalizeName } from './playerSearch'
import { parsePlay, runsOnPlay } from './derive/playByPlay'
import { battingStatline, pitchingStatline } from './derive/recap'
import { wpblAccent } from './constants'
import { CARD_BORDER, FOCUS_RING, PlayerPortrait, chromePx, pressable, useWpblDark, useWpblName } from './ui'
import { useWpblPlayerLink, linkColor } from './LinkContext'
import type {
  WpblBattingLine, WpblGame, WpblGamePlay, WpblPitchingLine, WpblPlayer, WpblTeam,
} from './types'

/**
 * The Live tab: what is happening right now, then the shape of how it got here.
 *
 * This shipped for a day as a chart on its own, and the chart was the wrong headline. Somebody
 * who opens a game that is being played wants the at-bat first; the win-probability line says
 * what that at-bat MEANS, which is a second question and not the first one. So the tab leads
 * with the situation, expanded to the size the feed can actually fill, and the chart sits under
 * it.
 *
 * WHAT THE FEED GIVES, AND WHAT IT DOES NOT. Both shaped this, and the second half is the part
 * worth writing down.
 *
 * It gives one situation object per poll, and the bases in it are RUNNER NAMES rather than
 * flags: `first_base` is "Val Perez", empty string when the base is empty. The compact strip in
 * the header throws those away with a `!!`, which is right for a 34px glyph and is the single
 * thing this pane exists to show.
 *
 * It gives NO id for the batter or the pitcher, and the `away_pitcher_id` / `runner_first` /
 * `away_batting_order` columns on the game row are not a second source: they are the leftovers
 * of a hand-scoring feature that never shipped, and on the live game of Sep 5, 2026 they read
 * null, null and 1. So the two players are matched by NAME against the rosters this modal
 * already holds, and the match is built to fail rather than guess (see `lineFor`).
 *
 * It gives no pitch-by-pitch. TrackMan lands days after a game rather than during one, so there
 * is no pitch plot here and there cannot be one.
 *
 * And it gives leftovers, twice over. Between half-innings the batter, the count and the
 * runners all describe an at-bat that has already finished, which `betweenInnings` catches and
 * this pane obeys by dropping every one of them. Within an at-bat the count itself can arrive
 * impossible: watched on Sep 5, 2026 it published balls 3, strikes 3 on a batter with nobody
 * out, then dropped to 0-1, which is the previous strikeout's full count sitting on the next
 * batter's name. The strip printed "3-3" and got away with it because it is four characters.
 * Drawn as pips it is four balls and three strikes, so the pips CLAMP.
 */
export default function LiveGameView({
  game, teams, away, home, plays, batting, pitching, names, games, onOpenPlayer,
}: {
  game: WpblGame
  teams: Map<string, WpblTeam>
  away: WpblTeam
  home: WpblTeam
  plays: WpblGamePlay[]
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  names: Map<string, WpblPlayer>
  games: WpblGame[]
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const s = game.live_state
    ? deriveSituation(game.live_state, away, home, { away: game.away_line, home: game.home_line })
    : null

  // The play the feed logged most recently. Scanned on `sequence` rather than taken off the end
  // of the array: the poll writes whatever order PostgREST returned, and the sequence is the
  // only ordering the league guarantees.
  const last = useMemo(() => {
    let best: WpblGamePlay | null = null
    for (const p of plays) if (!best || p.sequence > best.sequence) best = p
    return best
  }, [plays])

  return (
    <Box sx={{ px: 2, pb: 2, pt: 0.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* A MEASURE on the matchup, and none on the chart. The same split the play-by-play pane
          argues for: two portraits and a diamond have a natural size, and a line drawn across a
          whole game does not. */}
      <Box sx={{ width: '100%', maxWidth: chromePx(800), mx: 'auto' }}>
        {s && (
          <SituationPanel
            s={s} away={away} home={home} last={last} teams={teams}
            batting={batting} pitching={pitching} names={names} onOpenPlayer={onOpenPlayer}
          />
        )}
      </Box>
      <LazyWinProbCard game={game} teams={teams} plays={plays} games={games} />
    </Box>
  )
}

// ─── The situation, at the size the feed can fill ────────────────────────────────

/**
 * The count across the top, the matchup across the middle, the last play along the foot.
 *
 * Three cuts got here and the two it went through are worth knowing. The first stacked
 * everything: a band for the inning and the count, a band for the bases, a band for the two
 * players, and a separate bordered card for the last play. The bases band stood 130px tall to
 * hold a 76px glyph and one name with 645px of nothing beside it, and `OUT` sat seven hundred
 * pixels from the count it belongs with, so the two read as unrelated facts.
 *
 * The second made it three columns, which fixed the width and left the count buried under the
 * diamond in 8px grey dots. Balls, strikes and outs are the thing a person glances at a live
 * game to read, and they were the least visible thing on the card.
 *
 * So the count is now a band of its own at the top, in the order and the colours every
 * ballpark scoreboard uses, and the middle column is just the bases. That also balances the
 * card: the middle was 180px tall against 114px sides, and taking the label and the count out
 * of it brings the three within about 40px of each other.
 */
function SituationPanel({ s, away, home, last, teams, batting, pitching, names, onOpenPlayer }: {
  s: Situation
  away: WpblTeam
  home: WpblTeam
  last: WpblGamePlay | null
  teams: Map<string, WpblTeam>
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  names: Map<string, WpblPlayer>
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const dark = useWpblDark()
  const accent = wpblAccent(s.battingTeam.id, dark)
  // The club in the field is the other one, and therefore the pitcher's. Read off the half
  // rather than off the feed, whose situation names only the batting side.
  const fielding = s.battingTeam.id === away.id ? home : away

  // Between innings the count, the outs, the runners and both names belong to a half-inning
  // that is over, so the panel says which break it is and shows none of them. Exactly the rule
  // SituationStrip already follows, and it matters more at this size: in a 34px strip a stale
  // "AB" is a curiosity, here it is two portraits and two statlines for a matchup that is over.
  if (s.between) {
    return (
      <Panel>
        <Box sx={{ px: 1.5, py: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'text.disabled', flexShrink: 0 }} />
          <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, color: 'text.secondary' }}>{s.breakLabel}</Typography>
        </Box>
        {last && <LastPlay play={last} teams={teams} names={names} onOpenPlayer={onOpenPlayer} />}
      </Panel>
    )
  }

  return (
    <Panel>
      <CountBand s={s} accent={accent} dark={dark} />
      <Box sx={{
        display: 'grid',
        // The middle takes what the diamond and its runners need; the two players share
        // everything left, equally, so the card stays symmetrical whatever the names are.
        gridTemplateColumns: { xs: '1fr', sm: `1fr ${chromePx(290)} 1fr` },
        alignItems: 'stretch',
      }}>
        <PersonCard
          label="At bat" name={s.batterName} team={s.battingTeam} accent={accent}
          line={lineFor(s.batterName, s.battingTeam, names, batting, battingStatline)}
          onOpenPlayer={onOpenPlayer}
        />
        <Bases s={s} accent={accent} />
        <PersonCard
          label="Pitching" name={s.pitcherName} team={fielding}
          line={lineFor(s.pitcherName, fielding, names, pitching, pitchingStatline)}
          onOpenPlayer={onOpenPlayer}
          mirror
        />
      </Box>
      {last && <LastPlay play={last} teams={teams} names={names} onOpenPlayer={onOpenPlayer} />}
    </Panel>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, overflow: 'hidden' }}>
      {children}
    </Box>
  )
}

/**
 * BALLS, STRIKES, OUTS, in that order and in those colours.
 *
 * THE ORDER IS THE SCOREBOARD'S, not ours to arrange. Every park in the world stacks B over S
 * over O, every broadcast graphic reads the same way, and a fan reads the three without looking
 * at the labels because they know where each one lives. The first cut led with outs, which is
 * the same three facts in an order nobody has ever seen them in.
 *
 * THE COLOURS ARE THE SCOREBOARD'S TOO: green for balls, yellow for strikes, red for outs. That
 * is worth more than decoration here, because it is the thing that lets the band be read at a
 * glance rather than counted. Both halves of each pair are defined per theme rather than once,
 * for the usual reason: a colour dark enough to carry 3:1 on white is dim on this section's
 * near-black, and vice versa.
 *
 * The inning sits on the left of the same band because it is the fourth number in that glance,
 * and because a band with one thing centred in it and nothing else looks like a mistake.
 */
function CountBand({ s, accent, dark }: { s: Situation; accent: string; dark: boolean }) {
  return (
    <Box sx={{
      px: 1.5, py: 1.25,
      // A TINT RATHER THAN A RULE, and the same for the last play at the foot. Hairlines
      // between every section plus verticals between every column drew a grid over a card that
      // is one moment of one game: five lines to separate four things that already read as
      // separate, and on a desktop the verticals boxed the diamond in like a table cell. A
      // shaded head and foot say "this is chrome, that is content" without drawing anything.
      bgcolor: 'action.hover',
      display: 'grid', alignItems: 'center', rowGap: 1,
      // Three tracks on a desktop so the count is centred in the CARD rather than in whatever
      // is left over beside the inning. One track on a phone, where it wraps underneath.
      gridTemplateColumns: { xs: '1fr', sm: '1fr auto 1fr' },
      justifyItems: { xs: 'center', sm: 'stretch' },
    }}>
      <Typography sx={{
        fontSize: '0.85rem', fontWeight: 800, color: accent, whiteSpace: 'nowrap',
        textAlign: { xs: 'center', sm: 'left' },
      }}>
        {s.half === 'top' ? '▲' : '▼'} {s.half === 'top' ? 'Top' : 'Bot'} {ordinal(s.inning)}
      </Typography>
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: { xs: 1.75, sm: 3 }, flexWrap: 'wrap', rowGap: 1,
      }}>
        {/* Clamped, and this is the one place it shows. The feed publishes counts that cannot
            exist between at-bats (balls 3, strikes 3 on a batter with nobody out, watched on
            Sep 5, 2026); drawn as bulbs that is a fourth ball and a third strike. */}
        <Pips label="Balls" unit="ball" filled={Math.min(s.balls, 3)} of={3} tint={pipTint('ball', dark)} />
        <Pips label="Strikes" unit="strike" filled={Math.min(s.strikes, 2)} of={2} tint={pipTint('strike', dark)} />
        <Pips label="Outs" unit="out" filled={Math.min(s.outs, 2)} of={2} tint={pipTint('out', dark)} />
      </Box>
    </Box>
  )
}

/** Green, yellow, red, in the shade that survives the theme it is drawn on. */
function pipTint(kind: 'ball' | 'strike' | 'out', dark: boolean): string {
  if (kind === 'ball') return dark ? '#4ade80' : '#15803d'
  if (kind === 'strike') return dark ? '#fbbf24' : '#a16207'
  return dark ? '#f87171' : '#b91c1c'
}

/**
 * One of the three counts, as a label and a row of bulbs.
 *
 * The bulbs go through `chromePx()` rather than staying raw. CLAUDE.md's ornament exemption is
 * for hairlines and the 6px live dot, and these are not that: they are the element the band
 * exists to show, sitting beside type that grows a quarter on a desktop. Left raw they would be
 * the one thing on the card that shrank as everything around them grew.
 *
 * The label carries the reading for a screen reader, which gets no meaning at all out of a row
 * of filled and empty circles, and it is spelled as a phrase rather than as "1 balls".
 */
function Pips({ label, filled, of, unit, tint }: {
  label: string; filled: number; of: number; unit: string; tint: string
}) {
  return (
    <Box
      sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
      role="group"
      aria-label={filled === 0 ? `No ${unit}s` : `${filled} ${unit}${filled === 1 ? '' : 's'}`}
    >
      <Typography aria-hidden sx={{
        fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase',
        color: 'text.disabled',
      }}>{label}</Typography>
      <Box aria-hidden sx={{ display: 'flex', gap: chromePx(4) }}>
        {Array.from({ length: of }, (_, i) => (
          <Box key={i} sx={{
            width: chromePx(13), height: chromePx(13), borderRadius: '50%', flexShrink: 0,
            bgcolor: i < filled ? tint : 'transparent',
            border: '1.5px solid',
            // An unlit bulb keeps its OWN colour at a whisper rather than going grey. It says
            // what it would be, which is how a scoreboard reads, and it keeps the three groups
            // telling themselves apart on the count every plate appearance opens with, where
            // all seven bulbs are dark and a grey outline says nothing at all.
            borderColor: tint,
            opacity: i < filled ? 1 : 0.4,
          }} />
        ))}
      </Box>
    </Box>
  )
}

/**
 * The middle column: the bases, and who is standing on them.
 *
 * Diamond and names SIDE BY SIDE at every width. Stacked, the column ran 180px tall against
 * 114px sides and the card looked bottom-heavy in the middle; beside each other they fit the
 * column's width at both text scales and bring the three columns within about 40px.
 */
function Bases({ s, accent }: { s: Situation; accent: string }) {
  return (
    <Box sx={{
      // First on a phone, middle on a desktop. Behind the count, which is what somebody glances
      // at, and ahead of the two portraits, which answer the question after that one.
      order: { xs: -1, sm: 0 },
      px: 1.5, py: { xs: 2, sm: 1.5 }, minWidth: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.75,
    }}>
      <Diamond first={s.first} second={s.second} third={s.third} />
      <Runners s={s} accent={accent} />
    </Box>
  )
}

/**
 * The bases, at a size worth looking at.
 *
 * Its own component rather than the header strip's `MiniDiamond`, which is a 34px glyph sized
 * in raw px. This one is STRUCTURE, so it goes through `chromePx()` and its bases are
 * percentages of the box: left raw it would sit 40% too small against everything around it on a
 * desktop, which is the failure CLAUDE.md describes and the one nothing in the type system
 * catches.
 */
function Diamond({ first, second, third }: { first: boolean; second: boolean; third: boolean }) {
  const base = (occ: boolean, pos: object, plate = false) => (
    <Box sx={{
      position: 'absolute', ...pos,
      width: plate ? '20%' : '28%', height: plate ? '20%' : '28%',
      transform: 'translate(-50%,-50%) rotate(45deg)',
      bgcolor: occ ? '#60a5fa' : 'transparent',
      border: '1.5px solid', borderColor: occ ? '#60a5fa' : 'text.disabled',
      borderRadius: '1px',
      // Home is scenery, not a base anyone can be standing on, so it is smaller and dimmer.
      ...(plate ? { opacity: 0.45 } : {}),
    }} />
  )
  return (
    <Box aria-hidden sx={{ position: 'relative', width: chromePx(104), height: chromePx(104), flexShrink: 0 }}>
      {base(second, { left: '50%', top: '18%' })}
      {base(third, { left: '18%', top: '50%' })}
      {base(first, { left: '82%', top: '50%' })}
      {/* HOME PLATE IS DRAWN, and only at this size. The strip's 34px version has three bases
          and no home and reads as a diamond anyway, because at a glance the eye closes the
          shape. Blown up it stops doing that: three squares clustered in the top half of a
          square box with nothing under them read as three squares, which is what the first cut
          of this looked like. Home costs nothing and is the whole difference between a figure
          and a cluster. */}
      {base(false, { left: '50%', top: '82%' }, true)}
    </Box>
  )
}

/**
 * Who is on, named.
 *
 * Third down to first, the order they would score in, and only the bases that are occupied: an
 * empty base is already drawn as an empty base an inch to the left, and three rows of "2B —"
 * spend this column's best lines saying nothing. A base the feed marks occupied without naming
 * the runner falls back to the base alone, because the flag and the name come from the same
 * field and there is no reason to assume they move together.
 *
 * A FIXED-HEIGHT BLOCK, and that is the point of it. The bases change every few pitches:
 * sized to its contents, the card would grow a line taller the moment somebody reached and
 * shrink again when the side was retired, so the two players either side of it would drift up
 * and down the screen through the innings. Three rows is the worst case, and the worst case is
 * what it reserves. In REM, because what it reserves is room for three rows of type.
 */
function Runners({ s, accent }: { s: Situation; accent: string }) {
  const on = [
    s.third ? { base: '3B', name: s.thirdName } : null,
    s.second ? { base: '2B', name: s.secondName } : null,
    s.first ? { base: '1B', name: s.firstName } : null,
  ].filter((r): r is { base: string; name: string | null } => r !== null)

  return (
    <Box sx={{
      height: '4rem', minWidth: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'flex-start', justifyContent: 'center', gap: 0.2, overflow: 'hidden',
    }}>
      {on.length === 0 ? (
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'text.disabled' }}>
          Bases empty
        </Typography>
      ) : on.map(r => (
        <Box key={r.base} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6, maxWidth: '100%' }}>
          {/* A box reserving room for a two-character label, so it is in REM: sized in px it
              clips the moment the reader turns Large text on. */}
          <Typography sx={{
            width: '1.5rem', flexShrink: 0, textAlign: 'right',
            fontSize: '0.66rem', fontWeight: 800, color: accent,
          }}>{r.base}</Typography>
          <Typography sx={{
            fontSize: '0.84rem', fontWeight: 600, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{r.name ? shortName(r.name) : 'Runner on'}</Typography>
        </Box>
      ))}
    </Box>
  )
}

/**
 * The batter or the pitcher: who they are, and what they have done in this game so far.
 *
 * The portrait is the biggest thing in the column on purpose. These are two people, the card is
 * about the moment between them, and at 44px they were an icon beside a label rather than a
 * face. 72px through `chromePx` is 90 on a desktop, which is what the side columns had spare.
 *
 * `mirror` turns the column around from `sm` up, portrait outward and text to the edge, so the
 * two of them frame the diamond instead of both pointing the same way. Desktop only: stacked on
 * a phone, a right-aligned column reads as a mistake rather than as symmetry.
 */
function PersonCard({ label, name, team, accent, line, onOpenPlayer, mirror }: {
  label: string
  name: string | null
  team: WpblTeam
  accent?: string
  line: { player: WpblPlayer | null; statline: string | null }
  onOpenPlayer?: (p: WpblPlayer) => void
  mirror?: boolean
}) {
  const playerLink = useWpblPlayerLink()
  // The feed drops one of the pair sometimes, and half a matchup is still worth drawing. An
  // empty cell keeps the grid, so the other half does not jump across the card.
  if (!name) return <Box />
  const props = line.player ? playerLink(line.player, onOpenPlayer) : {}
  return (
    <Box sx={{
      // Taller on a phone, where the two players stack with nothing between them any more and
      // the space is what keeps them apart.
      px: 1.5, py: { xs: 1.75, sm: 1.5 }, minWidth: 0,
      display: 'flex', alignItems: 'center', gap: 1.5,
      flexDirection: { xs: 'row', sm: mirror ? 'row-reverse' : 'row' },
      // `flex-start` in BOTH, and that is not a slip. The mirrored column is `row-reverse`, so
      // its main-start is the RIGHT edge: asking for `flex-end` there packs the pitcher against
      // the middle column instead of against the outside of the card, which is what an earlier
      // cut did and why the two halves did not look symmetrical.
      justifyContent: 'flex-start',
    }}>
      <PlayerPortrait name={name} teamId={team.id} size={72} />
      <Box sx={{ minWidth: 0, textAlign: mirror ? { xs: 'left', sm: 'right' } : 'left' }}>
        <Typography sx={{
          fontSize: '0.6rem', fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase',
          color: 'text.disabled',
        }}>{label} · {team.abbr}</Typography>
        {/* A real <a> when the name resolved to somebody, so this is a crawlable link to her
            page and not a Box with a click handler (see linkTo() in CLAUDE.md). `linkColor` is
            how the accent survives: the link props carry an inline colour that beats `sx`. */}
        <Typography
          component="span"
          {...(props.style ? linkColor(props, accent ?? 'inherit') : props)}
          sx={{
            display: 'block', fontSize: '1.05rem', fontWeight: 700, minWidth: 0, lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: accent ?? 'text.primary',
            cursor: line.player ? 'pointer' : 'default',
          }}
        >{name}</Typography>
        {/* Absent rather than blank when the name matched nobody, or when the feed has staged
            somebody the box score has not entered yet. A dash here would claim a line of 0-0,
            which is a statement about a player rather than the absence of one. */}
        {line.statline && (
          <Typography sx={{
            fontSize: '0.82rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{line.statline}</Typography>
        )}
      </Box>
    </Box>
  )
}

/**
 * What just happened, along the foot of the same card.
 *
 * BROKEN INTO ITS PARTS, not printed as the feed wrote it. The narrative is one long sentence
 * with everything in it: the batter, the outcome, the ball-strike count with the raw pitch
 * letters in brackets, and every runner's movement chained on with semicolons and spelled out
 * in full. Verbatim, that is "Isabella Villareal singled to center field (1-2 BSF); Sarah
 * Edwards advanced to third; Samaria Benitez scored, advanced on an error by cf, unearned." on
 * the most valuable line of the card, with the thing that actually happened buried mid-sentence
 * and a bracket of pitch letters landing in a different place on every play.
 *
 * `parsePlay` already splits exactly this for the play-by-play tab, so the treatment is the
 * same one and deliberately so: the batter in bold and linked, the outcome beside her, the
 * runs as a green badge, the runners condensed onto a quieter second line, and THE COUNT
 * PULLED OUT to its own column on the right where it lines up rather than floating in prose.
 * A reader who scrolls from here to Play-by-Play sees one format, not two.
 *
 * A substitution is roster bookkeeping between at-bats rather than something that happened, and
 * it reads wrongly at the weight of a play, so it keeps the quieter italic line the play-by-play
 * gives it. It can genuinely be the last thing the feed logged.
 */
function LastPlay({ play, teams, names, onOpenPlayer }: {
  play: WpblGamePlay
  teams: Map<string, WpblTeam>
  names: Map<string, WpblPlayer>
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const short = useWpblName()
  const playerLink = useWpblPlayerLink()
  const text = play.narrative?.trim()
  // Only the two names this play carries, longest first so "Elodie Ciamarro" is replaced before
  // a bare "Ciamarro" could match part of it. The play-by-play builds the same shortener from
  // every play in the game; one play is all this line has and all it needs.
  const shorten = useMemo(() => {
    const pool = [play.batter_name, play.pitcher_name].filter(Boolean) as string[]
    if (pool.length === 0) return (t: string) => t
    const re = new RegExp(pool
      .sort((a, b) => b.length - a.length)
      .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
    return (t: string) => t.replace(re, m => short(m))
  }, [play.batter_name, play.pitcher_name, short])

  const parsed = useMemo(
    () => parsePlay(text ?? '', play.batter_name, shorten),
    [text, play.batter_name, shorten])

  if (!text) return null
  const team = play.team_id ? teams.get(play.team_id) : undefined
  const runs = runsOnPlay(play)
  // `parsePlay` fills `who` only when the narrative opens with THIS play's batter, so the id on
  // the row is the right person; a runner-only play leaves it null and nothing here is a link.
  const batter = parsed.who && play.batter_id ? names.get(play.batter_id) : undefined
  const openPlayer = batter && onOpenPlayer ? () => onOpenPlayer(batter) : undefined
  const link = batter && openPlayer ? playerLink(batter, onOpenPlayer) : {}

  return (
    <Box sx={{
      px: 1.5, py: 1.25, bgcolor: 'action.hover',
      display: 'flex', alignItems: 'flex-start', gap: 1.25,
    }}>
      <Typography sx={{
        fontSize: '0.6rem', fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase',
        color: 'text.disabled', whiteSpace: 'nowrap', flexShrink: 0,
        // A box reserving room for a label, so it is in REM. Aligned to the first line of the
        // sentence beside it rather than to the top of the block.
        lineHeight: 1.75,
      }}>
        Last play{team ? ` · ${team.abbr}` : ''}
      </Typography>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        {parsed.kind === 'substitution' ? (
          <Typography sx={{
            fontSize: '0.82rem', fontStyle: 'italic', color: 'text.disabled', lineHeight: 1.45,
          }}>{parsed.what}</Typography>
        ) : (
          <>
            <Typography sx={{ fontSize: '0.88rem', lineHeight: 1.45 }}>
              {parsed.who && (
                <Box component="span" {...('href' in link ? link : pressable(openPlayer))} sx={{
                  fontWeight: 700,
                  ...(openPlayer ? {
                    ...FOCUS_RING, cursor: 'pointer', borderRadius: 0.5,
                    '@media (hover: hover)': { '&:hover': { textDecoration: 'underline' } },
                  } : {}),
                }}>{short(parsed.who)}</Box>
              )}
              {parsed.who && ' '}
              {parsed.what}
              {runs > 0 && (
                <Box component="span" sx={{ ml: 0.5, fontSize: '0.7rem', fontWeight: 800, color: '#16a34a' }}>
                  +{runs}
                </Box>
              )}
            </Typography>
            {/* The runners, condensed and quieter. Same information, roughly half the words,
                and no longer competing with the batter for the line. */}
            {parsed.detail && (
              <Typography sx={{
                fontSize: '0.76rem', lineHeight: 1.4, color: 'text.secondary', mt: 0.15,
              }}>{parsed.detail}</Typography>
            )}
          </>
        )}
      </Box>

      {/* The count, in its own column. Left in the sentence it landed in a different place on
          every play; here it is always the same place, and it is the one number on this line a
          reader might want to line up against the pips at the top of the card. */}
      {parsed.count && (
        <Typography sx={{
          flexShrink: 0, fontSize: '0.72rem', fontWeight: 700, color: 'text.disabled',
          fontVariantNumeric: 'tabular-nums', lineHeight: 1.75,
        }}>{parsed.count}</Typography>
      )}
    </Box>
  )
}

// ─── The feed's name, and the player it means ───────────────────────────────────

/**
 * Resolve one of the feed's situation names to a roster player, and to her line in this game.
 *
 * The feed's situation carries names and no ids, so this is a name match, and the one thing a
 * name match must not do is guess. Two players in one game can share a name (see the resolver
 * note in CLAUDE.md), and a wrong match here does not merely mislabel: it puts somebody else's
 * batting line under this batter's face and links her name to somebody else's page.
 *
 * So the search runs twice. Across both rosters first, which answers almost every case. If that
 * is ambiguous it narrows to the club the feed says she is playing for, which is what makes a
 * shared name resolvable in the case that actually occurs: a traded player is one person with
 * two roster rows, and only one of those clubs is batting this half-inning. Still ambiguous
 * after that and it resolves to NOBODY, and the panel prints the name the feed sent with no
 * line and no link, which is what it was always going to print anyway.
 *
 * Folded through `normalizeName` because that is what handles "Mo'ne" and "Maïka". The feed and
 * the roster agree on those today; there is no reason to be brittle about the day they do not.
 */
export function lineFor<T extends { player_id: string }>(
  name: string | null,
  team: WpblTeam,
  names: Map<string, WpblPlayer>,
  lines: T[],
  statline: (line: T) => string,
): { player: WpblPlayer | null; statline: string | null } {
  if (!name) return { player: null, statline: null }
  const key = normalizeName(name)
  const matches: WpblPlayer[] = []
  for (const p of names.values()) if (normalizeName(p.name) === key) matches.push(p)

  let found: WpblPlayer | null = null
  if (matches.length === 1) found = matches[0]
  else if (matches.length > 1) {
    const onTeam = matches.filter(p => p.team_id === team.id)
    if (onTeam.length === 1) found = onTeam[0]
  }
  if (!found) return { player: null, statline: null }

  const line = lines.find(l => l.player_id === found.id)
  return { player: found, statline: line ? statline(line) : null }
}

/** "3rd". Innings only, so the teens never come up. */
function ordinal(n: number): string {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`
}
