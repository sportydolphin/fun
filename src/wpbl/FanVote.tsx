import { NameText } from '../ui/NameText'
import { useEffect, useMemo, useState } from 'react'
import { Box, Typography, useMediaQuery, type Theme } from '@mui/material'
import { EmojiEvents } from '@mui/icons-material'
import {
  SectionCard, TeamBadge, PlayerPortrait, linkPress, FOCUS_RING, TAPPABLE, hoverOnly, TYPE_SCALE, chromePx, CARD_INK,
} from './ui'
import { wpblManagerPortraitSet } from './portraits'
import { fanVoteAwards, AWARDS_SEASON, FAN_VOTE_IDS, AWARDS_CLOSE_LABEL } from './awards'
import { WPBL_AWARDS_PATH } from './routes'
import { buildAwardBallot, withWriteIns } from './derive/awards'
import type { AwardBallotEntry, AwardCandidate } from './derive/awards'
import { fetchWpblAwardVoterCount } from './awardVotes'
import { fetchWpblAllFielding, getCachedWpblAllFielding } from './api'
import { track, trackImpression, EVENTS } from '../lib/analytics'
import { useIsTester } from '../lib/roles'
import type { MvpRace } from './derive/mvpRace'
import type {
  WpblBattingLine, WpblFieldingLine, WpblGame, WpblPitchingLine, WpblPlayer, WpblRunValuePlay, WpblTeam,
} from './types'
import { useWpblSeason } from './SeasonContext'
import { inSeason } from './season'
import { ICON_SIZE } from '../ui/card'
import { markFanAwardsEngaged, useFanAwardsEngaged } from './fanVote/engaged'
import { useFanVote } from './fanVote/useFanVote'
import { FanVoteSheet } from './fanVote/FanVoteSheet'
// The ballot's pieces live in fanVote/; this file is the card, and keeps the one import path.
export { markFanAwardsEngaged } from './fanVote/engaged'

/**
 * The fan awards: five questions, one card on Home, one sheet to answer them in.
 *
 * WHY IT IS HERE. An MVP race card would answer a question the site already answers on the Stats
 * tab and on the player pages. This asks something the section cannot answer on its own, which is
 * what the people reading it think, and it is the one surface on `/wpbl` a reader can put
 * something INTO, which keeps it worth opening after the feed stops and every other card on Home
 * freezes.
 *
 * NO BASEBALL ARITHMETIC IN THIS FILE. `awards.ts` is the catalog, and `derive/awards.ts` builds
 * every shortlist from figures the section already publishes: the MVP race for value, the
 * run-expectancy table for runs saved, the qualifier bar for who counts as a regular. Both are
 * tested; this file renders them and takes the answer.
 *
 * A SHORTLIST IS A STARTING POINT, NOT A BALLOT PAPER. Every category takes a vote for anybody
 * in the league through the search below the names, and every seeded category prints where its
 * names came from. That distinction is the whole reason the search is not hidden behind a "more"
 * link: an award whose winner can only be one of six names the site chose is the site's award.
 *
 * SIGNED IN TO VOTE. Answering needs an account (`cast` sends a signed-out reader to sign in; see
 * the wall in the sheet), while a signed-out reader still sees the whole ballot and the tally on
 * anything already decided.
 *
 * THE TALLY IS HIDDEN UNTIL YOU ANSWER, per category, same rule the pick'em uses: a poll that
 * shows its results first stops measuring what people think and starts measuring what the first
 * fifty people thought.
 */

// ─── the card ────────────────────────────────────────────────────────────────────

/** Whether there is a ballot worth drawing. Every category needs candidates, or the card is a
 *  list of questions with nothing under them. */
export function fanVoteIsWorthDrawing(entries: AwardBallotEntry[]): boolean {
  return entries.length > 0 && entries.every(e => e.candidates.length > 0)
}

/**
 * THE INVITATION, for the top of a phone.
 *
 * THE CARD IS NOT ENOUGH ON A PHONE, which is the whole reason this exists. Home's two columns
 * stack below md and the ballot sits in the second one, so on a 375px handset it is the third
 * card down, past the scoreboard, Next game and Last game: about two screens of scrolling for
 * the one thing on this page that ASKS the reader for something. Everything else on Home
 * reports. A reader who does not scroll that far never learns the ballot is open at all.
 *
 * A LINK AND NOT A SECOND BALLOT. It reads no vote state and runs no hooks: a second
 * `useFanVote` would mean a second tally read and a second `wpbl_award_shown` on every load,
 * and the card below is still the thing that shows what you answered. This says the ballot is
 * open and gets you there in one tap.
 *
 * IT DISAPPEARS ON ITS OWN, on the deadline the card below prints: first pitch of the final,
 * see AWARDS_CLOSE_AT. Nobody has to remember to take it down.
 *
 * ON THE CLOSING DATE AND NOT ON `anyAwardOpen`, which is the same question asked worse here.
 * That helper also decides whether voting has STARTED, from the last regular-season date on the
 * schedule, and the feed sends `counts_in_standings: true` on postseason rows (CLAUDE.md), so
 * it reads the bracket as regular season and puts the opening day after the last playoff game.
 * The ballot is plainly open: it is rendering on this page, taking votes. A strip advertising
 * it must not be able to disagree with the card it points at.
 */
export function FanAwardsCta({ onOpen, now = () => Date.now() }: {
  onOpen?: () => void
  /** Injectable clock, so the closed state is testable without waiting for September. */
  now?: () => number
}) {
  const engaged = useFanAwardsEngaged()
  const t = now()
  if (!fanVoteAwards().some(a => t < Date.parse(a.closesAt))) return null
  // Already been in. See markFanAwardsEngaged: an invitation you have accepted is nagging.
  if (engaged) return null
  return (
    <Box
      {...linkPress(WPBL_AWARDS_PATH, () => {
        markFanAwardsEngaged()
        onOpen?.()
        track(EVENTS.WPBL_AWARD_OPEN, { answered: 0, from: 'cta' })
      })}
      aria-label="Vote in the WPBL fan awards"
      sx={{
        ...TAPPABLE, ...FOCUS_RING,
        display: { xs: 'flex', md: 'none' }, alignItems: 'center', gap: 1,
        textDecoration: 'none', cursor: 'pointer', userSelect: 'none',
        mb: 1.5, px: 1.5, py: 1.15, borderRadius: 2,
        // The section accent as a FILL, which nothing else on Home is. Home is a page of
        // bordered cards on a plain ground, so the one control on it that wants a tap cannot
        // be another one of those: the point of the strip is that a reader scanning past stops.
        bgcolor: 'var(--wpbl-accent-solid)', color: '#fff',
        transition: 'transform 120ms ease',
        '&:active': { transform: 'scale(0.99)' },
      }}
    >
      <Typography aria-hidden sx={{ fontSize: ICON_SIZE.md, lineHeight: 1, flexShrink: 0 }}>&#127942;</Typography>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 900, lineHeight: 1.25 }}>
          Fan awards are open
        </Typography>
        {/* The deadline, because it is the only thing here that makes it worth doing NOW: a
            poll with no visible one is a poll people mean to come back to. */}
        <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 600, lineHeight: 1.25 }}>
          Closes {AWARDS_CLOSE_LABEL}.
        </Typography>
      </Box>
      <Typography sx={{
        fontSize: TYPE_SCALE.caption, fontWeight: 900, flexShrink: 0,
        px: 1.1, py: 0.4, borderRadius: 999, bgcolor: 'rgba(255,255,255,0.22)',
      }}>Vote</Typography>
    </Box>
  )
}

export default function FanVoteCard({
  players, teams, games, batting, pitching, race, plays = [], onOpenPlayer, onOpenTeam,
  fill, now = () => Date.now(),
  open: openProp, onOpen, onClose, sheetOnly, settled = true,
}: {
  players: WpblPlayer[]
  teams: WpblTeam[]
  games: WpblGame[]
  batting: WpblBattingLine[]
  pitching: WpblPitchingLine[]
  /** The MVP race, which seeds the MVP and Pitcher shortlists. Absent until the play log lands,
   *  which is a deferred read on Home; the card simply does not draw until it does. */
  race?: MvpRace | null
  /** The play log, for the one figure a fielding row cannot hold: whether a catcher threw
   *  anybody out. Arrives with the race and is empty until it does, which the card shows as
   *  "—" on that line rather than as a zero nobody earned. */
  plays?: readonly WpblRunValuePlay[]
  onOpenPlayer?: (p: WpblPlayer) => void
  /** Manager of the Year's way out: her club's page, since she has no page of her own. */
  onOpenTeam?: (t: WpblTeam) => void
  fill?: boolean
  /** Injectable clock, so the closed state is testable without waiting for September. */
  now?: () => number
  /**
   * CONTROLLED WHEN THE SECTION IS DRIVING, uncontrolled otherwise.
   *
   * The ballot has a URL (`/wpbl/awards`), and a URL cannot open a sheet whose only record of
   * being open is a `useState` in here. So WpblApp holds it on the history entry and passes it
   * down, the same arrangement the player and game modals already have. `open` left undefined
   * falls back to the local state, which is what keeps this card renderable on its own: the
   * tests mount it directly, and a caller with no router still gets a working sheet.
   */
  open?: boolean
  onOpen?: () => void
  onClose?: () => void
  /** The sheet without the card, for /wpbl/awards once Home has stopped drawing the card (see
   *  FanAwardsSheet). Same component rather than a second one so the ballot, the results and
   *  `drawable` stay one definition. */
  sheetOnly?: boolean
  /** Whether the caller's reads (players, lines, the play log) have all answered, for the
   *  sheet-only mount: it opens before they do, and this is how it tells "still loading" from
   *  "loaded and there is nothing to draw". */
  settled?: boolean
}) {
  const [openLocal, setOpenLocal] = useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : openLocal
  const setOpen = (v: boolean) => {
    if (!controlled) setOpenLocal(v)
    if (v) onOpen?.(); else onClose?.()
  }
  // EVERY WAY INTO THE SHEET, IN ONE PLACE. The strip's own tap is marked at the tap, but the
  // card's rows and a cold load of /wpbl/awards both arrive here as `open` with nothing having
  // been pressed on this page, and a reader who read the whole ballot has plainly dealt with
  // the invitation whether or not they answered anything.
  useEffect(() => { if (open) markFanAwardsEngaged() }, [open])

  // Fielding is read here and nowhere else in the section: only the Defensive Wizard shortlist
  // wants it, and only once this card is on screen. Seeded from the cache so a second visit
  // draws the full ballot on first paint.
  // The section's short-name rule (12 chars on a phone, 20 on a desktop), so a long winner
  // shortens instead of pushing the QUESTION into an ellipsis. The question is what this row
  // exists to ask; which of your five picks it was is recoverable from the sheet.
  const [allFielding, setFielding] = useState<WpblFieldingLine[]>(() => getCachedWpblAllFielding() ?? [])
  // Every season's fielding, cut to the ballot's year through the whole schedule (the `games` this
  // card is handed are that one year's, which cannot place another year's lines).
  const schedule = useWpblSeason(games).schedule
  const fielding = useMemo(() => inSeason(allFielding, schedule, AWARDS_SEASON), [allFielding, schedule])
  // Whether that read has answered, empty or not: the sheet-only mount's `settled` covers the
  // caller's reads and cannot see this one.
  const [fieldingSettled, setFieldingSettled] = useState(() => getCachedWpblAllFielding() != null)
  useEffect(() => {
    if (allFielding.length > 0) return
    let cancelled = false
    fetchWpblAllFielding().then(rows => { if (!cancelled) { setFielding(rows); setFieldingSettled(true) } })
    return () => { cancelled = true }
  }, [allFielding.length])

  const entries = useMemo(() => {
    const awards = fanVoteAwards()
    return buildAwardBallot({ players, teams, games, batting, pitching, fielding, mvp: race, plays })
      .filter(e => awards.some(a => a.id === e.award.id))
      .sort((a, b) => awards.findIndex(x => x.id === a.award.id) - awards.findIndex(x => x.id === b.award.id))
  }, [players, teams, games, batting, pitching, fielding, race, plays])

  // `drawable` asks only whether there is a ballot worth drawing. The ballot is open to
  // everybody, so there is no audience gate here: this stays exactly one call so the "gated by
  // nothing" invariant in routes.test.ts holds, and nothing below hides the ballot from anyone.
  const drawable = fanVoteIsWorthDrawing(entries)
  // The sheet-only mount reads the tally at once rather than after the shortlists: it is on
  // screen already, and the tally does not depend on them.
  const state = useFanVote(drawable || !!sheetOnly)
  // Read off the award list itself until the entries exist, which is only ever the sheet-only
  // mount: there the sheet opens before the data does, and has to know it is a results sheet
  // (its width, its wording, the voter count) before there is a single entry to ask.
  const clockClosed = useMemo(() => {
    const awards = entries.length > 0 ? entries.map(e => e.award) : sheetOnly ? fanVoteAwards() : []
    return awards.length > 0 && awards.every(a => now() > Date.parse(a.closesAt))
  }, [entries, now, sheetOnly])

  // A TESTER PREVIEW OF THE LOCKED BALLOT, and NOT a gate. Everyone still gets the full,
  // votable ballot (drawable is untouched, and this never suppresses a render); a tester sees
  // the closed rendering ahead of the real deadline so the locked state can be checked before
  // the one evening it is ever live. It changes presentation only: voting still goes through
  // wpbl_cast_award_vote, which has no clock, so for a tester the ballot is in fact still open
  // underneath the preview. clockClosed remains the real answer for every other reader.
  const isTester = useIsTester()
  const testerPreview = isTester && !clockClosed && entries.length > 0
  const closed = clockClosed || testerPreview

  // HOW MANY PEOPLE VOTED, fetched only for the results view, where it is the one honest headline
  // the per-category tallies cannot give (a category count is answers, not people). It is the same
  // distinct-voter number the admin panel reports; see fetchWpblAwardVoterCount. Only when closed,
  // so the open ballot pays nothing for it.
  const [voterCount, setVoterCount] = useState<number | null>(null)
  useEffect(() => {
    if (!closed) return
    let cancelled = false
    fetchWpblAwardVoterCount(FAN_VOTE_IDS).then(n => { if (!cancelled) setVoterCount(n) })
    return () => { cancelled = true }
  }, [closed])

  const answered = entries.filter(e => state.ballot[e.award.id]).length

  // A STEP UP IN SIZE WHEN THE CARD IS STRETCHED, which is the desktop pairing only (below md
  // there is no stretch; see the note on the rows). The rows already grow to share the height the
  // card beside them sets, and since the season card gained its game buttons and recap button that
  // is enough height that body-size rows at 26px faces read as a short list floating in a tall
  // card. The text takes the next step of the type scale and the faces grow with it, so the card
  // spends its height on being readable rather than on padding.
  const roomy = useMediaQuery((t: Theme) => t.breakpoints.up('md')) && !!fill
  const rowText = roomy ? TYPE_SCALE.title : TYPE_SCALE.body
  const face = roomy ? 32 : 26

  useEffect(() => {
    // The impression counts the CARD being seen; the bare sheet is a visit to the URL, not that.
    if (sheetOnly) return
    if (drawable && state.loaded) trackImpression(EVENTS.WPBL_AWARD_SHOWN, { answered, categories: entries.length })
    // Once per load, not once per vote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawable, state.loaded])

  // THE SHEET OPENS WITH THE ADDRESS, NOT WITH THE DATA. Its shortlists wait on the play log, the
  // heaviest read in the section, so waiting for them meant a second or two of plain Home under a
  // URL that had promised the results. The results are drawn empty until then. Only the closed
  // ballot has an empty shape; an open one (unreachable here today, since this mount only exists
  // past the results date) still waits, as the card does.
  if (sheetOnly) {
    if (!open) return null
    // EVERY READ, NOT THE FIRST CATEGORY. `drawable` turns true as soon as any one category has
    // nominees, and Defensive Wizard and Most Aura get theirs before the stat lines and the play
    // log land, so on a slow phone the results went from five skeleton categories to two real
    // ones, then back to five: the dialog halved and re-centered, then grew again. Found by the
    // layout sweep on CI's runner, never on a desktop.
    const pending = !drawable || !state.loaded || !settled || !fieldingSettled
    if (pending && !closed) return null
    return (
      <FanVoteSheet entries={entries} players={players} teams={teams} state={state} closed={closed}
        testerPreview={testerPreview} voterCount={voterCount}
        loading={pending && !(settled && !drawable)} failed={settled && !drawable}
        onClose={() => setOpen(false)} onOpenPlayer={onOpenPlayer} onOpenTeam={onOpenTeam} />
    )
  }

  if (!drawable) return null

  const sheet = open && (
    <FanVoteSheet entries={entries} players={players} teams={teams} state={state} closed={closed}
      testerPreview={testerPreview} voterCount={voterCount}
      onClose={() => setOpen(false)} onOpenPlayer={onOpenPlayer} onOpenTeam={onOpenTeam} />
  )

  return (
    <SectionCard
      title="Fan awards"
      // NO SUBTITLE BEFORE THE FIRST ANSWER. The rows under the header are the five questions
      // and the nominees, so a line describing them said the same thing twice, above the thing
      // it was describing. What a reader who has answered nothing needs is to see the names.
      // A tester sees the locked rendering before the deadline, so the subtitle says so plainly:
      // without it a tester reads the closed ballot as voting having shut early and files a bug.
      subtitle={testerPreview ? 'Tester preview of the locked ballot. Voting is still open.'
        : closed ? 'Final results'
          : answered === 0 ? undefined
            : answered < entries.length ? `${answered} of ${entries.length} answered`
              : 'All answered'}
      fill={fill}
      action={
        <Box
          {...linkPress(WPBL_AWARDS_PATH, () => { setOpen(true); track(EVENTS.WPBL_AWARD_OPEN, { answered }) })}
          // The visible word is one or two, which is right on a card header and thin on its own
          // in a screen reader's list of links. The label says which ballot and what pressing it
          // does; the text stays short.
          aria-label={closed ? 'See the fan award results' : answered === 0 ? 'Vote in the fan awards' : 'Open your fan award ballot'}
          sx={{
            ...TAPPABLE, ...FOCUS_RING,
            display: 'flex', alignItems: 'center', gap: 0.4,
            borderRadius: 999, px: { xs: 1.25, sm: 1.75 }, py: { xs: 0.5, sm: 0.65 },
            cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', flexShrink: 0,
            textDecoration: 'none',
            // LIFT AND BRIGHTEN, NOT A SECOND COLOR. The unanswered state is already the accent
            // at full strength, so there is no darker version of it to hover to that does not
            // read as disabled, and the answered state is a quiet outline that should stay
            // quiet. `hoverOnly` guards both, so a phone does not keep the hover state painted
            // on after the tap that navigated away.
            transition: 'transform 120ms ease, filter 120ms ease, box-shadow 120ms ease',
            '&:active': { transform: 'scale(0.97)' },
            ...(answered > 0
              ? {
                border: '1px solid', borderColor: 'outline', color: 'text.secondary',
                ...hoverOnly({ borderColor: 'var(--wpbl-accent-fg)', color: 'var(--wpbl-accent-fg)' }),
              }
              : {
                bgcolor: 'var(--wpbl-accent-solid)', color: '#fff',
                // A shadow in the button's own hue rather than a grey one, so it reads as the
                // color glowing rather than as a piece of paper lifting off the card.
                boxShadow: '0 1px 6px -1px color-mix(in srgb, var(--wpbl-accent-solid) 55%, transparent)',
                ...hoverOnly({ filter: 'brightness(1.08)', transform: 'translateY(-1px)' }),
              }),
          }}
        >
          <Typography sx={{ fontSize: { xs: TYPE_SCALE.caption, sm: TYPE_SCALE.body }, fontWeight: 900 }}>
            {closed ? 'Results' : answered === 0 ? 'Vote' : 'Your ballot'}
          </Typography>
          {/* Ornament, and hidden from the accessibility tree: the label above already says this
              goes somewhere. Raw px because a chevron is neither type nor structure. */}
          <Box aria-hidden sx={{ fontSize: '11px', lineHeight: 1, opacity: 0.85, mt: '1px' }}>&#8250;</Box>
        </Box>
      }
    >
      {/* THE CARD IS THE BALLOT AT A GLANCE, not a teaser for it. One row per category, showing
          your answer where you have given one and the question where you have not, so a reader
          who never opens the sheet still learns what is being asked and a reader who has voted
          can see all five of their calls without a tap.

          FACES, because a nominee's face is what makes an award read as a contest rather than
          as a form; without them the card is a column of titles, the word "Vote" and a wide
          empty middle on a desktop. Every candidate already carries a portrait and a club.

          THE PILE IS THE SEEDED SHORTLIST, IN SEEDED ORDER, which is what keeps it clear of the
          hidden-until-you-answer rule. It is the same list the sheet opens with and leaks
          nothing about how anyone voted; deliberately NOT `withWriteIns`, which sorts by votes
          once the tally is out and would turn this row into a running result. */}
      {/* FILLS THE CARD, on the desktop pairing where it is stretched to match the taller card
          beside it (Next game, with its season stats). Rather than let 70-odd pixels pool as a
          gap under the last row, the rows GROW EQUALLY into it (`flex: 1 0 auto` each), so every
          row gains the same few pixels with its faces centered and the dividers stay snug between
          them. Spreading with a gap instead opens canyons between rows, which reads as a list
          coming apart. Below md there is no stretch, so the rows sit at their content height. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
        {entries.map((e, i) => {
          const picked = state.ballot[e.award.id]
          const mineC = picked
            ? (e.candidates.find(c => c.key === picked)
              ?? (() => { const p = players.find(x => x.id === picked)
                return p ? { key: p.id, name: p.name, teamId: p.team_id, playerId: p.id, line: '' } as AwardCandidate : null })())
            : null
          // ONCE LOCKED, THE ROW IS THE WINNER, NOT YOUR VOTE. The card is a glance at the ballot;
          // while it is open that glance is your own five picks, but after it closes the answer is
          // the crowd's, so the row shows who won (write-ins included, the same resolution the
          // results sheet uses) with a trophy in place of your pick. Null only if nobody voted the
          // category, which the row then shows as a dash.
          const bucket = state.results[e.award.id] ?? {}
          const winnerC = closed
            ? (withWriteIns(e.candidates, { bucket, players, picked: picked ?? null, reveal: true, closed: true })
                .find(c => (bucket[c.key] ?? 0) > 0) ?? null)
            : null
          // Three faces: enough to read as a field, few enough to leave the question room on a
          // 375px phone. Your own pick (or, once locked, the winner) replaces the pile entirely,
          // because the one name on this row that matters is the one that should be on it.
          const faces = closed
            ? (winnerC ? [winnerC] : e.candidates.slice(0, 3))
            : (mineC ? [mineC] : e.candidates.slice(0, 3))
          return (
            <Box key={e.award.id}
              {...linkPress(WPBL_AWARDS_PATH, () => { setOpen(true); track(EVENTS.WPBL_AWARD_OPEN, { answered, from: e.award.id }) })}
              sx={{
                ...TAPPABLE, ...FOCUS_RING, cursor: 'pointer',
                textDecoration: 'none', color: 'text.primary',
                // Grow to share the card's slack (see the note on the column above); `0 auto` so a
                // row never shrinks below its own content and its natural height is the floor.
                flex: '1 0 auto',
                display: 'flex', alignItems: 'center', gap: 1, minWidth: 0,
                py: 0.85, borderTop: i === 0 ? 'none' : '1px solid', borderColor: 'divider',
              }}
            >
              <Typography sx={{
                fontSize: rowText, fontWeight: 700, minWidth: 0,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{e.award.title}</Typography>
              <Box sx={{ flex: 1, minWidth: chromePx(8) }} />
              {/* Overlapped, with a ring in the card's own color so the edges stay separate against a
                  portrait behind them. `chromePx` on the overlap because it is structure: left raw it
                  would not shrink with the art it is overlapping.

                  `isolation` IS LOAD-BEARING: WITHOUT IT THE PILE DRAWS OVER THE TOOLBAR. The faces
                  below order themselves with `zIndex`, and a FLEX ITEM honors z-index with no
                  `position` at all, which is the part that surprises: each face becomes a stacking
                  context in the page's own order rather than in this pile's. Their nearest such
                  ancestor is then the swipe pager, three components up, whose `transform` makes one.
                  So as Home scrolls, these portraits carry their own compositing past the sticky
                  toolbar and draw ON TOP of it, while the award's name beside them slides under it
                  correctly. It reads as a rendering glitch rather than a z-index bug precisely because
                  the rest of the row behaves.

                  One line confines them: the three indexes compete only with each other, which is all
                  they were ever meant to do. Ordering siblings inside a pile is what this property is
                  for, and any pile of overlapping art that reaches for z-index wants it. */}
              <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, isolation: 'isolate' }}>
                {faces.map((c, j) => (
                  <Box key={c.key} sx={{
                    display: 'flex', borderRadius: '50%',
                    ml: j === 0 ? 0 : `calc(-1 * ${chromePx(9)})`,
                    boxShadow: t => `0 0 0 2px ${CARD_INK(t)}`,
                    // Later faces sit UNDER earlier ones, so the pile reads left to right in
                    // seeded order rather than the last one covering the seed.
                    zIndex: faces.length - j,
                  }}>
                    {(() => {
                      // A manager has no playerId but a bundled headshot keyed on her `mgr:` key,
                      // the same one the results sheet's portrait helper uses; without this the
                      // card fell back to the club badge for Manager of the Year while the sheet
                      // showed her face.
                      const headshot = wpblManagerPortraitSet(c.key)
                      if (c.playerId || headshot) return <PlayerPortrait name={c.name} teamId={c.teamId} size={face} src={headshot} />
                      const t = teams.find(x => x.id === c.teamId)
                      return t ? <TeamBadge team={t} size={face} /> : null
                    })()}
                  </Box>
                ))}
              </Box>
              {closed ? (
                winnerC ? (
                  // The winner, with a trophy in place of your pick. Gold, and after the name, the
                  // same treatment the results sheet gives its heroes.
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: chromePx(4), minWidth: 0 }}>
                    <NameText name={winnerC.name} sx={{ fontSize: rowText, fontWeight: 800, color: 'text.primary', minWidth: 0 }} />
                    <EmojiEvents titleAccess="Winner" sx={{ fontSize: rowText, color: '#eab308' }} />
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: rowText, fontWeight: 700, color: 'text.disabled', flexShrink: 0 }}>&#8212;</Typography>
                )
              ) : (
                mineC
                  ? <NameText name={mineC.name} sx={{ fontSize: rowText, fontWeight: 800, minWidth: 0, color: 'text.primary' }} />
                  : <Typography sx={{
                      fontSize: rowText, fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap',
                      color: 'var(--wpbl-accent-solid)',
                    }}>Vote</Typography>
              )}
            </Box>
          )
        })}
      </Box>
      {sheet}
    </SectionCard>
  )
}
