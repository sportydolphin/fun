import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { track, EVENTS } from '../../lib/analytics'
import { playedInnings } from '../constants'
import { canonicalFeedName } from '../feedNames'
import { HighlightLightbox } from '../Highlights'
import { useClipTags } from '../Watch'
import { useWpblPlayerLink } from '../LinkContext'
import { OutDots } from '../../ui/BaseDiamond'
import { TapTip, TeamBadge, BaseDiamond, pressable, hoverOnly, FOCUS_RING, chromePx } from '../ui'
import { parsePlay, runsOnPlay, endsInCalledThirdStrike, stateAfter, pitchingChanges } from '../derive/playByPlay'
import { ENTRY_HASH, playHashSequence } from '../entryUrl'
import { isPitchingChangeNarrative } from '../derive/playByPlay'
import type { PitchingChange } from '../derive/playByPlay'
import { typePx } from '../../ui/scale'
import type { WpblTeam, WpblGame, WpblPlayer, WpblGamePlay, WpblVideo } from '../types'
import { EmptyBody } from './shared'
import { SourceMark, SourceNote } from './PlaySource'
import { TYPE_SCALE } from '../../ui/card'

// Whether the reader has asked for every half-inning open. Per reader and per browser, not per
// game: a fourteen-click expansion is the same nuisance on the next game as on this one.
const PBP_EXPAND_KEY = 'wpbl_pbp_expand_all'

const readPbpExpandAll = (): boolean => {
  try { return localStorage.getItem(PBP_EXPAND_KEY) === '1' } catch { return false }
}

const writePbpExpandAll = (on: boolean) => {
  try { localStorage.setItem(PBP_EXPAND_KEY, on ? '1' : '0') } catch { /* private mode / quota */ }
}

// The feed logs each plate appearance as a terse pitch string like "BBFBP", one letter
// per pitch. The letters are cryptic on their own (and the feed's own `type`/`description`
// are unreliable: it tags 'K' as "Unknown pitch code" and 'P' as "Pitchout"), so we decode
// them ourselves: color each pip and spell the full sequence out in a hover tooltip.
const PITCH_CODES: Record<string, { label: string; color: string }> = {
  B: { label: 'Ball',            color: '#16a34a' }, // green
  K: { label: 'Called strike',   color: '#dc2626' }, // red
  S: { label: 'Swinging strike', color: '#dc2626' }, // red
  F: { label: 'Foul',            color: '#d97706' }, // amber
  H: { label: 'Hit by pitch',    color: '#9333ea' }, // purple
  P: { label: 'In play',         color: '#2563eb' }, // blue
}

function PitchSequence({ seq, calledThirdStrike }: {
  seq: string
  /** Whether the last pitch was a called third strike, which is the one pitch that earns the
   *  scorekeeper's backwards K. See endsInCalledThirdStrike. */
  calledThirdStrike?: boolean
}) {
  const pitches = [...seq].map((code, i) => ({
    code, i, ...(PITCH_CODES[code] ?? { label: code, color: 'inherit' }),
  }))
  // The pitch the glyph is about says what it is, so the tooltip explains the mirroring rather
  // than leaving it as a typographic in-joke: every other K in the list reads "Called strike".
  const last = pitches[pitches.length - 1]
  if (calledThirdStrike && last?.code === 'K') last.label = 'Called third strike'
  const tip = (
    <Box sx={{ py: 0.25 }}>
      {pitches.map(p => (
        <Box key={p.i} sx={{ fontSize: TYPE_SCALE.meta, lineHeight: 1.5, whiteSpace: 'nowrap' }}>
          <Box component="span" sx={{ color: 'text.disabled', mr: 0.75 }}>{p.i + 1}.</Box>
          <Box component="span" sx={{ color: p.color, fontWeight: 700 }}>{p.label}</Box>
        </Box>
      ))}
    </Box>
  )
  return (
    <TapTip title={tip} sx={{
      display: 'flex', gap: '2px', flexShrink: 0,
      fontFamily: 'monospace', fontSize: TYPE_SCALE.micro, fontWeight: 700, lineHeight: 1.6,
    }}>
        {pitches.map(p => (
          // THE BACKWARDS K IS A STRIKEOUT LOOKING, not a called strike, so only the last pitch of one is
          // mirrored. Mirroring every K would put the notation on far more pitches than the few that earn
          // it, and a single on 0-2 would read as a strikeout.
          <Box key={p.i} component="span" sx={{
            color: p.color,
            ...(calledThirdStrike && p.i === pitches.length - 1 && p.code === 'K'
              && { display: 'inline-block', transform: 'scaleX(-1)' }),
          }}>{p.code}</Box>
      ))}
    </TapTip>
  )
}

export function PlayByPlay({ plays, teams, game, names, swing, onOpenPlayer }: {
  plays: WpblGamePlay[]; teams: Map<string, WpblTeam>; game: WpblGame
  /** This game's two rosters, by player id, so the batter each play opens with can be opened.
   *  Resolved on `batter_id` rather than by matching the printed name: the feed fills that
   *  column on all but a couple of percent of plays, and a name match would have to survive
   *  the shortening the line has already applied to it. */
  names: Map<string, WpblPlayer>
  /** The play the game turned on, and what the win model is willing to call it. Null until the
   *  league-wide read the model needs has landed, and on a game too short to have one. */
  swing?: { sequence: number; label: string } | null
  onOpenPlayer?: (p: WpblPlayer) => void
}) {
  const playerLink = useWpblPlayerLink()
  // The league's Short of a play, where a clip has been pinned to it (wpbl_video_tags, matched on
  // (game, sequence) because a play's uuid does not survive the next ingest pass). Keyed by
  // sequence; a play with two clips shows the first posted.
  const { videos: clipVideos, tags: clipTags } = useClipTags()
  const clipBySequence = useMemo(() => {
    const out = new Map<number, WpblVideo>()
    const sorted = clipVideos.filter(v => v.is_short === true).sort((a, b) => a.published_at.localeCompare(b.published_at))
    for (const v of sorted) {
      const t = clipTags.get(v.video_id)
      if (t?.game_id === game.id && t.play_sequence != null && !out.has(t.play_sequence)) out.set(t.play_sequence, v)
    }
    return out
  }, [clipVideos, clipTags, game.id])
  const [clipPlaying, setClipPlaying] = useState<WpblVideo | null>(null)
  // The two clubs, for the running score on each half-inning header. Off the game rather than
  // off the plays: a half-inning has one batting club and the score has two.
  const awayTeam = teams.get(game.away_team_id)
  const homeTeam = teams.get(game.home_team_id)
  // Every name the feed uses in this game, mapped to the roster's own spelling of it. The two
  // disagree on seven players (see feedNames.ts), and the play log is where a reader meets the
  // feed's version: the same at-bat reads "Emi Saki" in the sentence and Emi Saiki in the box
  // score one tab across. Built from the plays rather than the roster, so a name only shortens
  // when it is genuinely a player in this game.
  const canon = useMemo(() => {
    const feed = [...new Set(plays.flatMap(p => [p.batter_name, p.pitcher_name]).filter(Boolean) as string[])]
    return new Map(feed.map(n => [n, canonicalFeedName(n, names.values())]))
  }, [plays, names])
  // Longest first so "Elodie Ciamarro" is replaced before a bare "Ciamarro" could match part
  // of it.
  const shortenNames = useMemo(() => {
    const feed = [...canon.keys()].sort((a, b) => b.length - a.length)
    if (!feed.length) return (t: string) => t
    const re = new RegExp(feed.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
    return (t: string) => t.replace(re, m => canon.get(m) ?? m)
  }, [canon])
  // Group consecutive plays into half-innings, in order.
  //
  // The half-inning's run count comes from the line score rather than from summing the plays,
  // because the line score is the number printed in the box score directly above and the two
  // must not disagree. (Summing the plays would also be right: runsOnPlay() accounts for the
  // feed's runs_scored omitting the batter on a home run.)
  const groups = useMemo(() => {
    const scored = (inning: number, half: string) =>
      (half === 'top' ? game.away_line : game.home_line)?.find(c => c.inning === inning)?.runs ?? 0
    // Drop the same phantom inning the line score drops, so the two tabs of one box score
    // can't disagree about how long the game was. Only for a finished game, and only when
    // there's a line score to trust: a live game's plays can legitimately run ahead of it.
    const played = playedInnings(game.away_line, game.home_line)
    const inGame = (p: WpblGamePlay) => game.status !== 'final' || played === 0 || p.inning <= played
    const gs: {
      key: string; label: string; teamId: string | null; runs: number
      /** The score AFTER this half-inning, away then home, matching the line score's own order. */
      awayTo: number; homeTo: number
      plays: WpblGamePlay[]
    }[] = []
    // Running totals, carried down the list. A collapsed play-by-play is fourteen rows saying
    // how many runs each half produced, which is the delta and never the state: a reader
    // scrolling to the 6th could see that two scored there and not what the score was. Summed
    // here rather than from the plays for the same reason the badge is (see above): the line
    // score is the number printed in the header directly above, and the two must not disagree.
    let awayTo = 0, homeTo = 0
    for (const p of plays) {
      if (!inGame(p)) continue
      const key = `${p.inning}-${p.half}`
      const last = gs[gs.length - 1]
      if (!last || last.key !== key) {
        const half = p.half === 'top' ? 'Top' : 'Bottom'
        const ord = p.inning === 1 ? '1st' : p.inning === 2 ? '2nd' : p.inning === 3 ? '3rd' : `${p.inning}th`
        const runs = scored(p.inning, p.half)
        if (p.half === 'top') awayTo += runs; else homeTo += runs
        gs.push({ key, label: `${half} ${ord}`, teamId: p.team_id, runs, awayTo, homeTo, plays: [p] })
      } else { last.plays.push(p) }
    }
    // Who this half was pitched by, and who came in during it. BOTH FROM `pitcher_name` AND
    // NEITHER FROM THE PROSE: the field is on every play with no gaps, and the sentence is missing
    // or wrong about the departing pitcher in a large share of mid-half changes. See
    // `pitchingChanges` for that split.
    //
    // NOT SIMPLY THE FIRST ROW'S PITCHER. An announcement row carries the pitcher being RELIEVED
    // ("Liz Gilder to p for Niki Eckert" is filed under Eckert, who is the one leaving), so a half
    // that opens with a change would be headed by a pitcher who never threw a pitch in it. Those
    // rows are skipped; the first row that is an account of something says who was throwing.
    return gs.map(g => ({
      ...g,
      pitcher: g.plays.find(p =>
        (p.pitcher_name ?? '').trim() && !isPitchingChangeNarrative(p.narrative))?.pitcher_name
        ?? null,
      changes: pitchingChanges(g.plays),
    }))
  }, [plays, game.away_line, game.home_line, game.status])

  // ONLY THE PLAYS THAT SCORED, and only the half-innings that had one. A play log is the one
  // surface where "what actually happened" and "everything that happened" are different
  // questions, and the second answer is 80 rows: a reader catching up on a game they missed
  // wants the runs. Half-innings that produced none are dropped whole rather than left as empty
  // headings, so the list becomes the scoring summary the box score does not carry.
  //
  // `runsOnPlay`, NEVER the feed's `runs_scored`, for the reason that field has caught every
  // reader: it omits the batter, so filtering on it would drop every solo home run in the game
  // from a view whose entire job is not to miss a run.
  //
  // IT HIDES ROWS RATHER THAN REMOVING THEM, and that is the whole of the implementation note.
  // Every derived thing in this list reads a play's NEIGHBOURS (the base-out state comes off
  // the next row, a pitching change off the previous one), so a filtered array would quietly
  // re-point all of it at the wrong play and draw a diamond for a moment three batters later.
  // The half-inning keeps all of its plays and carries a set of the ones not to draw.
  const [scoringOnly, setScoringOnly] = useState(false)
  const shown = useMemo(() => {
    if (!scoringOnly) return groups.map(g => ({ ...g, hidden: null as ReadonlySet<number> | null }))
    const out: (typeof groups[number] & { hidden: ReadonlySet<number> | null })[] = []
    for (const g of groups) {
      const hidden = new Set<number>()
      let kept = 0
      g.plays.forEach((p, i) => { if (runsOnPlay(p) > 0) kept++; else hidden.add(i) })
      if (kept > 0) out.push({ ...g, hidden })
    }
    return out
  }, [groups, scoringOnly])

  // Innings start collapsed so the tab opens compact (and the modal can size down to it); the
  // reader expands the half-innings they care about. Tracking what's OPEN (not what's closed)
  // means innings that arrive later on a live game default closed too, without extra bookkeeping.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  /**
   * The lens OPENS WHAT IT KEEPS, which is the whole point of it. Turned on over a collapsed log
   * without this it would leave headings and no plays: a control whose entire job is "show me the
   * runs" showing none of them.
   *
   * AND GIVES BACK WHAT IT TOOK. The reader's own expansion is put aside on the way in and
   * restored on the way out, so using the lens for a moment does not cost them the three
   * half-innings they had open. Kept in a ref rather than state: nothing renders from it, and it
   * must not be a dependency of anything.
   */
  const beforeLens = useRef<Set<string> | null>(null)
  const toggleScoringOnly = () => {
    if (!scoringOnly) {
      beforeLens.current = expanded
      setExpanded(new Set(groups.filter(g => g.plays.some(p => runsOnPlay(p) > 0)).map(g => g.key)))
    } else {
      setExpanded(beforeLens.current ?? new Set())
      beforeLens.current = null
    }
    setScoringOnly(!scoringOnly)
  }

  // What the reader can actually see, which is what the footnote has to count. Handed the whole
  // game it would say "1 play corrected" under a filtered list whose corrected play is hidden: a
  // footnote pointing at a dagger the page never drew.
  const visiblePlays = useMemo(
    () => (scoringOnly ? shown.flatMap(g => g.plays.filter((_, i) => !g.hidden?.has(i))) : plays),
    [scoringOnly, shown, plays])
  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  // Expand all, and REMEMBERED, which is the half that makes it worth having. A reader who
  // wants the whole log wants it on the next game too, and fourteen half-innings to click is
  // the complaint whether it is one game or every game. Stored per reader in localStorage like
  // the units and ERA-basis settings, defaulting off so the tab still opens compact for
  // everyone who has not asked.
  const [expandAll, setExpandAll] = useState(readPbpExpandAll)
  const allOpen = shown.length > 0 && shown.every(g => expanded.has(g.key))
  const toggleAll = () => {
    const next = !allOpen
    setExpandAll(next)
    writePbpExpandAll(next)
    setExpanded(next ? new Set(shown.map(g => g.key)) : new Set())
  }

  // A live game gains half-innings while the reader is watching, and with the preference on
  // those have to arrive open. Only the ones never seen before: reapplying it to every key
  // would reopen a half-inning the reader had just closed by hand, every two minutes.
  //
  // AND A LIVE GAME OPENS ON THE HALF-INNING BEING PLAYED, which is the moment this list is worth
  // the most: fully collapsed, a reader who came to see what just happened gets a stack of shut
  // headings and has to work out that the bottom one is live. Only the LAST fresh half, not all
  // of them, since on first paint every half is fresh; and only while it is fresh, so a reader who
  // closes it is not overruled two minutes later.
  const seenGroups = useRef<Set<string>>(new Set())
  useEffect(() => {
    const fresh = groups.map(g => g.key).filter(k => !seenGroups.current.has(k))
    if (!fresh.length) return
    for (const k of fresh) seenGroups.current.add(k)
    if (expandAll) { setExpanded(prev => new Set([...prev, ...fresh])); return }
    const current = groups[groups.length - 1]?.key
    if (game.status === 'live' && current && fresh.includes(current)) {
      setExpanded(prev => new Set([...prev, current]))
    }
  }, [groups, expandAll, game.status])

  /**
   * A link to one play, opened.
   *
   * The half-inning holding it has to be expanded before anything can be scrolled to, because a
   * collapsed one does not render its rows at all, so the browser's own fragment handling finds
   * nothing and does nothing. Runs once per hash: `groups` changes identity on every poll of a
   * live game, and without the guard a reader who had scrolled away would be yanked back to the
   * linked play every two minutes.
   */
  const [flashed, setFlashed] = useState<number | null>(null)
  // THE FRAGMENT THE READER ARRIVED ON, not the one on the address bar, and the difference is
  // load-bearing: this pane is remounted by the first refresh (the tab content is swapped for a
  // spinner for about 200ms), so a live read gets the fragment on the first mount and an empty
  // string on the second. `ENTRY_HASH` is a constant and says the same thing both times.
  // `hashchange` then follows the address bar, which is what makes the `#` beside each play work
  // as its own confirmation that the link was taken.
  const [linkHash, setLinkHash] = useState<string>(ENTRY_HASH)
  useEffect(() => {
    const onHash = () => setLinkHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const hashDone = useRef<string | null>(null)
  useEffect(() => {
    const hash = linkHash
    if (hashDone.current === hash || !groups.length) return
    const seq = playHashSequence(hash)
    if (seq == null) return
    hashDone.current = hash
    const holder = groups.find(g => g.plays.some(p => p.sequence === seq))
    if (!holder) return
    setExpanded(prev => new Set([...prev, holder.key]))
    setFlashed(seq)
    // THE ADDRESS BAR GETS THE FRAGMENT BACK. The section rewrites the URL on mount and the
    // first of those rewrites happens before the schedule has landed, so it cannot build the
    // game's own path and drops the fragment on the way past (entryUrl.ts). Re-asserting it here
    // is the one place that knows the fragment named a play in THIS game, so it cannot leak to a
    // URL it does not belong on, and it means the link a reader followed is the link they can
    // copy back out. `replaceState`, never push: arriving somewhere is not a second navigation.
    if (!window.location.hash) {
      window.history.replaceState(window.history.state, '',
        `${window.location.pathname}${window.location.search}${hash}`)
    }
    // SCROLLING UNTIL IT STAYS PUT, rather than once. Two things move underneath this. The row
    // does not exist until the half-inning `setExpanded` just queued has painted, so a single
    // frame scrolls nothing at all; and the whole pane is then REMOUNTED by the first refresh
    // (the tab content is swapped for a spinner for about 200ms), which resets the scroller to
    // the top and would throw the reader back to the 1st inning.
    //
    // So it re-scrolls whenever the row has moved and stops once it has held still for three
    // frames, with a ceiling of about a second and a half. `behavior: 'auto'`, deliberately:
    // a smooth scroll is still moving on the next frame, so it can never satisfy the test that
    // ends the loop. That ceiling is also what keeps this from fighting a reader who starts
    // scrolling for themselves.
    let raf = 0
    let frames = 0
    let held = 0
    let lastTop = NaN
    const settle = () => {
      const el = document.getElementById(`play-${seq}`)
      if (el) {
        const top = el.getBoundingClientRect().top
        if (Math.abs(top - lastTop) < 1) held++
        else { held = 0; el.scrollIntoView({ block: 'center' }) }
        lastTop = top
        if (held >= 3) return
      }
      if (frames++ < 90) raf = requestAnimationFrame(settle)
    }
    raf = requestAnimationFrame(settle)
    const off = setTimeout(() => setFlashed(null), 2600)
    return () => { cancelAnimationFrame(raf); clearTimeout(off) }
  }, [groups, linkHash])

  if (plays.length === 0) {
    return <EmptyBody title="No play-by-play" />
  }
  return (
    /* A MEASURE, because this is a list and a list has nothing to spend extra width on.
        The same rule and the same number as the section's own list pages in WpblApp: with
        the card wide enough for two box scores, a collapsed half-inning would put the inning
        at one end of a thousand pixels and "1 run" at the other. Recap and Box Score
        deliberately do NOT take a measure: a win-probability chart and two nine-column tables
        are the things that can actually use the room.

        It leaves the expanded prose better off too, at roughly 50 characters a line rather
        than 66, which is nearer the middle of a comfortable measure than the top of it. */
    <Box sx={{ p: 2, maxWidth: chromePx(720), mx: 'auto' }}>
      {/* Two controls, right-aligned above the log, in the weight of the half-inning headings
          they operate rather than as buttons competing with them. The expander says what it
          will DO, so it reads "Collapse all" only once everything actually is open, however
          that happened.

          THE LENS COMES FIRST because it decides what the expander is even operating on, and
          it goes away with the game rather than being remembered: "expand all" is a standing
          preference about effort (fourteen half-innings to click is the same nuisance every
          game, which is why it is stored), where "scoring only" HIDES most of the log, and a
          setting that silently withholds plays on the next game anybody opens is the version
          of this that reads as a page that failed to load. */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1.25, mb: 0.5 }}>
        <Box
          {...pressable(toggleScoringOnly)}
          role="switch"
          aria-checked={scoringOnly}
          aria-label="Show only the plays that scored"
          sx={{
            ...FOCUS_RING, display: 'inline-flex', alignItems: 'center', gap: 0.4,
            // A REAL TAP TARGET. The height would otherwise come from the padding and the deliberately
            // small type, leaving two fiddly controls side by side on a phone. `chromePx` because this is
            // a finger and not a letter: it must not shrink when the reader's text is small, and it must
            // not grow when it is large.
            px: 0.75, minHeight: chromePx(32), borderRadius: 1, cursor: 'pointer',
            fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.6),
            textTransform: 'uppercase', userSelect: 'none',
            color: scoringOnly ? '#16a34a' : 'text.secondary',
            '@media (hover: hover)': { '&:hover': { color: scoringOnly ? '#16a34a' : 'text.primary' } },
          }}
        >
          {/* The same green the +N badges and the scoring rail already use, so the control and
              the rows it keeps are obviously the same idea. */}
          <Box component="span" aria-hidden sx={{
            width: '0.5rem', height: '0.5rem', borderRadius: '50%', flexShrink: 0,
            border: '1.5px solid', borderColor: scoringOnly ? '#16a34a' : 'text.disabled',
            bgcolor: scoringOnly ? '#16a34a' : 'transparent',
          }} />
          Scoring only
        </Box>
        <Box
          {...pressable(toggleAll)}
          aria-label={allOpen ? 'Collapse every half-inning' : 'Expand every half-inning'}
          sx={{
            ...FOCUS_RING, display: 'inline-flex', alignItems: 'center', gap: 0.4,
            // Sized with the lens beside it: see the note there.
            px: 0.75, minHeight: chromePx(32), borderRadius: 1, cursor: 'pointer',
            fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: typePx(0.6),
            textTransform: 'uppercase', color: 'text.secondary', userSelect: 'none',
            '@media (hover: hover)': { '&:hover': { color: 'text.primary' } },
          }}
        >
          <Box component="span" aria-hidden sx={{ fontSize: TYPE_SCALE.caption, transition: 'transform 0.15s', transform: allOpen ? 'rotate(90deg)' : 'none' }}>▶</Box>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </Box>
      </Box>
      {/* A SCORELESS GAME IS AN ORDINARY STATE, not an error, and it is the state a live game
          spends its first innings in. Filtered to nothing the pane was blank below the toolbar,
          which reads as a page that failed rather than as a game where nobody has scored. */}
      {scoringOnly && shown.length === 0 && (
        <Typography sx={{ py: 4, textAlign: 'center', fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>
          No runs {game.status === 'final' ? 'in this game' : 'yet'}.
        </Typography>
      )}
      {shown.map(g => {
        const team = g.teamId ? teams.get(g.teamId) : undefined
        const open = expanded.has(g.key)
        // Keyed on where the line is DRAWN, which is the league's own announcement when it
        // wrote one and the new pitcher's first row when it did not. One map rather than a
        // search per row: a half-inning has at most a handful of these against eighty rows.
        const changeAt = new Map<number, PitchingChange>(
          g.changes.map(c => [c.announcedAt ?? c.index, c] as const))
        return (
          <Box key={g.key} sx={{ mb: 1.25 }}>
            <Box
              {...pressable(() => toggle(g.key))}
              aria-expanded={open}
              sx={{
                ...FOCUS_RING,
                display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer',
                position: 'sticky', top: 0, bgcolor: 'background.paper', py: 0.5, zIndex: 1,
                borderBottom: '1px solid', borderColor: 'divider',
                '&:hover .pbpChevron': { color: 'text.secondary' },
              }}
            >
              <Box className="pbpChevron" sx={{
                fontSize: TYPE_SCALE.caption, color: 'text.disabled', width: '0.75rem', flexShrink: 0,
                transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none',
              }}>▶</Box>
              {team && <TeamBadge team={team} size={18} />}
              {/* The label gives way, not the score. It fits at 320px today and the reader's
                  Large text setting multiplies every rem on this row, so the one thing that
                  must survive that is the number the row exists to show. */}
              <Typography noWrap sx={{ minWidth: 0, fontSize: TYPE_SCALE.micro, fontWeight: 800, textTransform: 'uppercase', letterSpacing: typePx(1), color: 'text.secondary' }}>
                {g.label}{team ? ` · ${team.abbr}` : ''}
                {/* WHO THEY BATTED AGAINST, which the league's substitution sentences are otherwise the
                    only place to find. Last in the line and inside the same noWrap, so on a phone it is
                    the part that gives way rather than the inning: a truncated name is recoverable, since
                    every change is spelled out in full in the rows below, and a truncated inning is the
                    one thing this heading exists to say.

                    "NY" AND NOT "NY BATTING", which keeps the name from truncating on a phone at all.
                    The club badge is already in this row and "vs" already says which way round the two
                    clubs are, so the word would be the one thing here two other things are saying.

                    The pitcher this half OPENED with, which is not always the only one: plenty of
                    half-innings use two or more, and those changes are their own lines in the list
                    rather than a second name crowding this one. */}
                {g.pitcher ? ` · vs ${shortenNames(g.pitcher)}` : ''}
              </Typography>
              {/* THE SCORE AFTER THIS HALF, and the runs that made it: the runs alone are the delta and
                  never the state, so a reader scrolling to the 6th would see that two scored there and
                  not what the score was. "+2" rather than "2 runs" because both share the right edge of
                  a row that is already a chevron, a badge and the inning wide on a phone. AWAY FIRST,
                  matching the line score directly above, and the club that just batted is named in the
                  same row, so the first scoring half says which number is whose. The aria-label spells
                  it out for anyone the layout cannot. */}
              <Box component="span" sx={{
                ml: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 0.6, flexShrink: 0,
              }}>
                {g.runs > 0 && (
                  <Box component="span" sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800, color: 'var(--wpbl-pos)' }}>
                    +{g.runs}
                  </Box>
                )}
                <Box
                  component="span"
                  aria-label={`${awayTeam?.abbr ?? 'Away'} ${g.awayTo}, ${homeTeam?.abbr ?? 'Home'} ${g.homeTo} after this half-inning`}
                  sx={{
                    fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.disabled',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >{g.awayTo}–{g.homeTo}</Box>
              </Box>
            </Box>
            {open && (
              <Box sx={{ mt: 0.75 }}>
                {g.plays.map((p, i) => {
                  // Hidden, not absent: `shown` keeps every play of the half so the neighbour
                  // reads below still land on the right row. See the note on that memo.
                  if (g.hidden?.has(i)) return null
                  const parsed = parsePlay(p.narrative, p.batter_name, shortenNames)
                  // THE PITCHING CHANGE WE WORKED OUT OURSELVES, drawn where the league wrote one and REPLACING
                  // its sentence rather than sitting beside it. Two lines disagreeing about one change is worse
                  // than either alone, and they would disagree: the league often announces a change as a bare
                  // "X to p" that never says who was relieved, and sometimes names the wrong pitcher leaving.
                  // `pitcher_name` is right about both ends. The fallback wording is for a change the feed never
                  // announces: it says who is throwing now and does not claim a roster move. See
                  // `pitchingChanges`.
                  const change = changeAt.get(i)
                  const replaced = change?.announcedAt === i
                  const changeLine = change ? (
                    <Box sx={{ py: 0.4, pl: 1, borderLeft: '2px solid', borderColor: 'divider' }}>
                      <Typography sx={{
                        fontSize: TYPE_SCALE.meta, fontStyle: 'italic', color: 'text.disabled', lineHeight: 1.35,
                      }}>
                        {/* Corrected to the roster spelling through the same `canon` map the
                            play-by-play name uses: `change.to`/`from` come from `pitcher_name`,
                            which is the feed's prose and wrong for the same seven players. */}
                        {change.announcedAt != null
                          ? `${shortenNames(canon.get(change.to) ?? change.to)} to p for ${shortenNames(canon.get(change.from) ?? change.from)}`
                          : `Now pitching: ${shortenNames(canon.get(change.to) ?? change.to)}`}
                        {/* THE DAGGER RIDES THE ROW, NOT THE SENTENCE. This line is drawn from `pitcher_name` and
                            needs no correction to be right, but the row underneath it is the one the overlay
                            corrected and the one the footnote counts, and a footnote must never count a dagger
                            the page did not draw. */}
                        {replaced && p.corrected_source && <SourceMark source={p.corrected_source} />}
                      </Typography>
                    </Box>
                  ) : null
                  // WHAT THE SITUATION LOOKED LIKE WHEN THIS PLAY WAS DONE, which is the one
                  // thing the sentence never says: the feed writes every runner's movement out
                  // in full and leaves the reader to add them up down a fourteen-row inning.
                  // `g.plays` is exactly one half-inning, which is what `stateAfter` requires;
                  // null there is the last play of the half, where the honest answer is nothing
                  // rather than an empty diamond reading as a cleared inning. See stateAfter.
                  const after = stateAfter(g.plays, i)
                  // The feed sends a handful of plays with no narrative at all. Drawn, they are
                  // an empty bordered row mid-inning, which reads as a play that failed to load.
                  // `replaced` is the other kind of nothing: the league's announcement of a
                  // change the line above has already made, in better words.
                  const body = parsed.kind === 'blank' || replaced ? null
                  // A substitution is roster bookkeeping between at-bats. Given the same
                  // weight as a play it reads like one, so it gets its own quieter line.
                  : parsed.kind === 'substitution' ? (
                      <Box sx={{
                        py: 0.4, pl: 1, borderLeft: '2px solid', borderColor: 'divider',
                      }}>
                        <Typography sx={{
                          fontSize: TYPE_SCALE.meta, fontStyle: 'italic', color: 'text.disabled', lineHeight: 1.35,
                        }}>
                          {parsed.what}
                          {/* A SUBSTITUTION CAN BE THE CORRECTED ROW (a change naming a pitcher who had already
                              been relieved innings earlier), so it carries the dagger too, or the footnote below
                              would count a mark the page never drew. */}
                          {p.corrected_source && <SourceMark source={p.corrected_source} />}
                        </Typography>
                      </Box>
                  ) : (
                    // `runsOnPlay`, NOT `is_scoring_play`. The feed's flag is exactly `runs_scored > 0` and
                    // `runs_scored` never counts the batter, so a SOLO HOME RUN is flagged false: it would draw as
                    // an ordinary play, without the green rail and tint, while the "+1" beside it (which reads
                    // `runsOnPlay`) said a run had scored, one row disagreeing with itself. See CLAUDE.md.
                    <Box id={`play-${p.sequence}`} sx={{
                      display: 'flex', gap: 1, py: 0.6, pl: 1, borderLeft: '2px solid',
                      borderColor: runsOnPlay(p) > 0 ? '#22c55e' : 'divider',
                      bgcolor: runsOnPlay(p) > 0 ? 'rgba(34,197,94,0.06)' : 'transparent',
                      // WHERE A LINK LANDS. Loud for a moment and then gone: a reader who
                      // followed a link to one at-bat out of eighty needs to be shown which,
                      // and a permanent highlight would still be shouting at them ten minutes
                      // later. `scrollIntoView` puts it mid-screen, which the outline then
                      // names. Respects reduced motion by only ever fading, never moving.
                      ...(flashed === p.sequence ? {
                        outline: '2px solid', outlineColor: 'primary.main', borderRadius: 1,
                        transition: 'outline-color 0.8s ease-out',
                      } : {}),
                      // The anchor is invisible until the row is pointed at, and on a touch
                      // device until it is pressed. `hoverOnly` is the section's one helper for
                      // that pair, so this reveals itself the same way every other quiet
                      // affordance in the section does.
                      ...hoverOnly({ '& .playLink': { opacity: 1 } }),
                    }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        {/* Who did what, on one line. The batter is the thing being scanned
                            for down the column, so it carries the weight; the outcome sits in
                            normal text beside it rather than as one undifferentiated sentence. */}
                        <Typography sx={{ fontSize: TYPE_SCALE.body, lineHeight: 1.35 }}>
                          {parsed.who && (() => {
                            // parsePlay only fills `who` when the narrative opens with THIS
                            // play's batter, so the id on the row is the right person; a
                            // runner-only play leaves it null and nothing here is clickable.
                            const batter = p.batter_id ? names.get(p.batter_id) : undefined
                            const open = batter && onOpenPlayer ? () => onOpenPlayer(batter) : undefined
                            const link = batter && open ? playerLink(batter, onOpenPlayer) : {}
                            return (
                              <Box component="span" {...('href' in link ? link : pressable(open))} sx={{
                                fontWeight: 700,
                                ...(open ? {
                                  ...FOCUS_RING, cursor: 'pointer', borderRadius: 0.5,
                                  '@media (hover: hover)': { '&:hover': { textDecoration: 'underline' } },
                                } : {}),
                              }}>{batter?.name ?? canon.get(parsed.who) ?? parsed.who}</Box>
                            )
                          })()}
                          {parsed.who && ' '}
                          {parsed.what}
                          {p.corrected_source && <SourceMark source={p.corrected_source} />}
                          {runsOnPlay(p) > 0 && (
                            <Box component="span" sx={{ ml: 0.5, fontSize: TYPE_SCALE.micro, fontWeight: 800, color: 'var(--wpbl-pos)' }}>
                              +{runsOnPlay(p)}
                            </Box>
                          )}
                          {/* THE ONE PLAY THE GAME TURNED ON. The chart on the Recap tab names it, and without this
                              that sentence is a dead end: it names a play and gives no way to read the inning
                              around it. The same play is marked here, in the same words, off the same `swingOfGame`.

                              INLINE AND ALLOWED TO WRAP, because it is exactly one row in a game and a chip that
                              never wraps would have to be an abbreviation of a phrase whose whole value is that it
                              is honest about itself: "Biggest moment" is not "Swing of the game", and neither is
                              "SWING". */}
                          {swing?.sequence === p.sequence && (
                            <Box component="span" sx={{
                              ml: 0.6, px: 0.5, py: '1px', borderRadius: 0.75,
                              fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: typePx(0.5),
                              textTransform: 'uppercase', whiteSpace: 'nowrap',
                              color: 'primary.main', border: '1px solid', borderColor: 'primary.main',
                            }}>{swing.label}</Box>
                          )}
                          {/* The league filmed this one. A button, not a link: it plays here, over
                              the log, and the reader lands back on the same row. */}
                          {clipBySequence.has(p.sequence) && (
                            <Box component="button" type="button"
                              onClick={() => {
                                const v = clipBySequence.get(p.sequence)!
                                track(EVENTS.WPBL_HIGHLIGHT_PLAYED, { videoId: v.video_id, kind: 'clip', from: 'pbp' })
                                setClipPlaying(v)
                              }}
                              aria-label={`Watch the clip of this play: ${clipBySequence.get(p.sequence)!.title}`}
                              sx={{
                                ml: 0.6, px: 0.6, py: '1px', borderRadius: 0.75, cursor: 'pointer', font: 'inherit',
                                fontSize: TYPE_SCALE.caption, fontWeight: 800, letterSpacing: typePx(0.4), textTransform: 'uppercase',
                                whiteSpace: 'nowrap', verticalAlign: 'baseline',
                                color: 'var(--wpbl-accent-fg)', bgcolor: 'transparent',
                                border: '1px solid', borderColor: 'var(--wpbl-accent-fg)',
                                ...FOCUS_RING, ...hoverOnly({ bgcolor: 'action.hover' }),
                              }}>▶ Clip</Box>
                          )}
                        </Typography>
                        {/* Runners, quieter and condensed: the same information in roughly half the words, not
                            competing with the batter for attention. */}
                        {parsed.detail && (
                          <Typography sx={{ fontSize: TYPE_SCALE.meta, lineHeight: 1.35, color: 'text.secondary', mt: 0.15 }}>
                            {parsed.detail}
                          </Typography>
                        )}
                      </Box>
                      {/* The count sits in the pitch column rather than mid-sentence, so it lines up down the
                          rows. ONE BASELINE, not two nudges: holding the count and the pips level with a margin
                          on one and a fitted line-height on the other is a fixed offset between two things
                          whose sizes both move with the reader's text scale. */}
                      <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                        {parsed.count && (
                          <Typography sx={{
                            fontSize: TYPE_SCALE.micro, fontWeight: 700, color: 'text.disabled',
                            fontVariantNumeric: 'tabular-nums', lineHeight: 1.6,
                          }}>
                            {parsed.count}
                          </Typography>
                        )}
                        {p.pitch_sequence && (
                          <PitchSequence
                            seq={p.pitch_sequence}
                            calledThirdStrike={endsInCalledThirdStrike(p.narrative, p.pitch_sequence)}
                          />
                        )}
                      </Box>
                      {/* The situation this play left behind: who is on, and how many are
                          away. Last in the row so the two of them form a column down the right
                          edge whatever the pitch sequence beside them did.

                          ART, SO `chrome`: they are glyphs and not numbers, and a diamond that
                          grew with the reader's Large text setting would tower over the 0.82rem
                          sentence it belongs to.

                          TOP-ALIGNED, NOT CENTERED, and no nudge either way. The glyphs follow
                          --app-chrome and the count beside them follows the reader's text scale,
                          so the two can never be locked level by a fixed offset; what they can
                          share is an edge. Centered, they drift down the row as the runners' line
                          wraps, which on a three-line play put them a clear line below the count
                          and broke the column they sit at the end of to make. */}
                      {after && (
                        <Box sx={{
                          flexShrink: 0, alignSelf: 'flex-start',
                          display: 'flex', alignItems: 'center', gap: chromePx(5),
                        }}>
                          <BaseDiamond {...after.bases} size={16} scale="chrome" context="After" />
                          <OutDots outs={after.outs} />
                        </Box>
                      )}
                      {/* A LINK TO THIS AT-BAT, so a reader wanting to point at one play does not have to send
                          the whole game and describe it. A real `href`, so copy-link, middle-click and
                          open-in-new-tab all work the way they should; the click is left to the browser, since
                          a row you can see is a row the fragment can reach, and the effect above handles the
                          other direction, where the link arrives from outside and its half-inning is shut.

                          IT RESERVES ITS SPACE ON EVERY DEVICE rather than appearing on hover, because a column
                          that widens under the pointer pushes the diamond and the pips left by ten pixels on the
                          row you are trying to read. */}
                      <Box
                        component="a"
                        href={`#play-${p.sequence}`}
                        className="playLink"
                        aria-label={parsed.who ? `Link to this play, ${parsed.who}` : 'Link to this play'}
                        sx={{
                          ...FOCUS_RING,
                          flexShrink: 0, alignSelf: 'flex-start', lineHeight: 1.6,
                          fontSize: TYPE_SCALE.micro, fontWeight: 700, textDecoration: 'none',
                          color: 'text.disabled', opacity: 0, transition: 'opacity 0.12s',
                          '&:focus-visible': { opacity: 1 },
                        }}
                      >#</Box>
                    </Box>
                  )
                  return body || changeLine ? <Box key={i}>{changeLine}{body}</Box> : null
                })}
              </Box>
            )}
          </Box>
        )
      })}
      <SourceNote plays={visiblePlays} />
      {clipPlaying && <HighlightLightbox video={clipPlaying} onClose={() => setClipPlaying(null)} />}
    </Box>
  )
}
