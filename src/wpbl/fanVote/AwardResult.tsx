import { useDark } from '../../ui/useDark'
import { NameText } from '../../ui/NameText'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, Typography, Menu, MenuItem, ListItemIcon, Skeleton } from '@mui/material'
import { EmojiEvents, IosShare, ContentCopy, Download } from '@mui/icons-material'
import {
  TeamBadge, PlayerPortrait, pressable, FOCUS_RING, TAPPABLE, hoverOnly, TYPE_SCALE, chromePx,
} from '../ui'
import { useWpblPlayerLink, useWpblTeamLink } from '../LinkContext'
import {
  WinnerShareLauncher, canCopyImage, canNativeShareFiles, preloadCapture, type ShareAction, type ShareCardData,
} from '../awardShareCard'
import { wpblManagerPortraitSet, wpblPortrait, wpblManagerPortrait } from '../portraits'
import { wpblAccent, wpblLogo, wpblFullName } from '../constants'
import { useEraBasis } from '../EraBasisContext'
import { useReducedMotion } from '../../AccessibilityContext'
import type { WpblAward } from '../awards'
import { withWriteIns } from '../derive/awards'
import type { AwardBallotEntry, AwardCandidate } from '../derive/awards'
import { awardVoteCount } from '../awardVotes'
import type { WpblPlayer, WpblTeam } from '../types'
import { typePx } from '../../ui/scale'
import { NO_VOTES } from './useFanVote'
import type { FanVoteState } from './useFanVote'

// ─── the winner's confetti ─────────────────────────────────────────────────────────

/**
 * A one-shot confetti pop over a winner's portrait, fired when the results sheet opens.
 *
 * THE SAME NOD AS THE LEAGUE SWITCHER'S BURST (ConfettiBurst in App.tsx), rebuilt for this
 * surface: that one portals to <body> at fixed viewport coords because it fires from a bar that
 * scrolls under sticky chrome. This is placed by `x`/`y` inside AwardResult's OUTER box, which is
 * NOT overflow-clipped, so the burst flies free of the results card's rounded corners rather than
 * being cut off at the card's top edge (the card clips its own wash and bars). The caller measures
 * the portrait so the origin and the rim radius `r` are exact at any chrome scale. Purely
 * cosmetic, `pointer-events: none`, radial because a portrait has room on every side, and it
 * animates once on mount: each winner row remounts every time the sheet opens.
 *
 * HONORS reduced motion: a reader who has asked the OS for less movement gets the trophy and the
 * result and no burst.
 */
const WINNER_CONFETTI_COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#5856d6', '#af52de']

function WinnerConfetti({ x, y, r }: { x: number; y: number; r: number }) {
  // The Settings toggle as well as the OS: the media query alone ignored a reader who asked here.
  const reduce = useReducedMotion()
  // Each piece LAUNCHES FROM THE RIM (radius `r`, the measured portrait) rather than the center,
  // so the burst reads as coming off the edge of the circle.
  const pieces = useMemo(() => Array.from({ length: 26 }, (_, i) => {
    // Radial: a portrait has space all around it, unlike the switcher at the top of the page.
    const angle = Math.random() * Math.PI * 2
    // Farther and more varied than before, so the burst carries well past the portrait: a fuller,
    // more prominent pop now that nothing clips it.
    const dist = 30 + Math.random() * 60
    const cos = Math.cos(angle), sin = Math.sin(angle)
    return {
      id: i,
      // Start on the circle's edge, travel outward from there along the same ray.
      sx: cos * r, sy: sin * r,
      ex: cos * (r + dist), ey: sin * (r + dist),
      rot: (Math.random() * 2 - 1) * 300,
      delay: Math.random() * 90,
      color: WINNER_CONFETTI_COLORS[i % WINNER_CONFETTI_COLORS.length],
      size: 5 + Math.random() * 5,
      round: Math.random() < 0.4,
    }
  }), [r])
  if (reduce) return null
  return (
    <Box aria-hidden sx={{
      // Placed on the portrait's center within the un-clipped outer box; pieces start at the rim.
      position: 'absolute', left: x, top: y, width: 0, height: 0, pointerEvents: 'none', zIndex: 3,
      '@keyframes winnerConfetti': {
        '0%':   { transform: 'translate(calc(-50% + var(--sx)), calc(-50% + var(--sy))) rotate(0deg)', opacity: 1 },
        '100%': { transform: 'translate(calc(-50% + var(--ex)), calc(-50% + var(--ey))) rotate(var(--rot))', opacity: 0 },
      },
    }}>
      {pieces.map(p => (
        <Box
          key={p.id}
          style={{
            '--sx': `${p.sx}px`, '--sy': `${p.sy}px`,
            '--ex': `${p.ex}px`, '--ey': `${p.ey}px`, '--rot': `${p.rot}deg`,
            width: p.size, height: p.size, background: p.color,
            borderRadius: p.round ? '50%' : '1px', animationDelay: `${p.delay}ms`,
          } as React.CSSProperties}
          sx={{ position: 'absolute', left: 0, top: 0, animation: 'winnerConfetti 1.6s cubic-bezier(0.2, 0.6, 0.35, 1) forwards' }}
        />
      ))}
    </Box>
  )
}

// ─── sharing a result ────────────────────────────────────────────────────────────
//
// The card, the capture and the browser probes live in awardShareCard.ts, so the admin-only
// all-winners export can reuse them without dragging its owner-only role gate into this file (see
// AwardsWinnersExport and the routes.test pin that keeps every role check out of here). What stays
// here is the one thing that needs this file's data: turning a category's votes into a ShareCardData.

/**
 * The winner of one category as a share card's worth of data, or null if nobody has a vote in it
 * yet. Resolved through `withWriteIns` closed and revealed, exactly as the results row is, so the
 * name on the card is the same name the sheet crowns, write-ins included. Shared by the per-result
 * Share button and the all-winners poster, so the two can never disagree about who won.
 */
export function winnerShareData(
  entry: AwardBallotEntry,
  state: FanVoteState,
  players: WpblPlayer[],
  teams: WpblTeam[],
  fmtEra: (v: number) => string,
): ShareCardData | null {
  const { award, candidates } = entry
  const bucket = state.results[award.id] ?? NO_VOTES
  const total = awardVoteCount(state.results, award.id)
  const votesOf = (key: string) => bucket[key] ?? 0
  const winner = withWriteIns(candidates, {
    bucket, players, picked: state.ballot[award.id] ?? null, reveal: true, closed: true,
  }).filter(c => votesOf(c.key) > 0)[0]
  if (!winner) return null

  const team = winner.teamId ? teams.find(t => t.id === winner.teamId) ?? null : null
  const full = team ? wpblFullName(team) : null
  return {
    category: award.title,
    name: winner.name,
    // The FULL 512 file, not the thumbnail `.src` a set hands out, so the capture is sharp:
    // manager headshot, else the player's bundled portrait, else the club logo.
    portraitSrc: wpblManagerPortrait(winner.key)
      ?? (winner.playerId ? wpblPortrait(winner.name) : null)
      ?? (winner.teamId ? wpblLogo(winner.teamId) : null),
    teamId: winner.teamId,
    initials: winner.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join(''),
    // The FULL club name ("San Francisco Firebells") in the subtitle, not the nickname the compact
    // rows use: a non-player winner (Manager of the Year) carries the nickname in `sub`, so prefer
    // the full name here and keep `sub` only as the write-in fallback for a winner with no club.
    detail: winner.playerId ? [full, winner.sub].filter(Boolean).join(' · ') : (full ?? winner.sub ?? ''),
    stats: (winner.stats ?? []).filter(s => s.label !== 'Team').slice(0, 3).map(s => ({
      // ERA is stored on the league's basis and rescaled at DISPLAY time, so price it through the
      // same formatter as everywhere else or the card would disagree with the player page.
      value: s.eraBasisValue !== undefined ? fmtEra(s.eraBasisValue) : s.value, label: s.label,
    })),
    pct: total > 0 ? Math.round((votesOf(winner.key) / total) * 100) : 0,
  }
}

// ─── one category, once the votes are locked ──────────────────────────────────────

/**
 * The RESULT of a category, not the ballot for it: the winner shown large, then the two names
 * behind them.
 *
 * A DIFFERENT SHAPE FROM `AwardQuestion` ON PURPOSE. The voting view is a grid of equal tiles,
 * because before the votes are in every name is a live option and the layout must not say
 * otherwise. Once it is locked that even weighting is the wrong answer: there is one winner and
 * the sheet should read like a results page, so this promotes the top name to a hero row and
 * demotes the rest to a short list under it.
 *
 * THE WINNER IS RESOLVED THROUGH `withWriteIns`, closed and revealed, so a name the crowd wrote
 * in can win: the seeded four are a seed, not the ballot paper (see derive/awards), and a
 * results view that could only ever crown one of them would be the site's award rather than the
 * fans'. An unrostered write-in with no portrait or page is the one it cannot draw, the same
 * limit the tiles have, so the top DRAWABLE name stands in that rare case.
 *
 * EMPTY IS A REAL STATE. A category nobody voted in has no winner, and a hero row built around a
 * zero-vote name would invent one; it says so plainly instead.
 */
/** How long each award waits behind the one above it before its confetti fires. */
const WINNER_CONFETTI_STAGGER_MS = 180

/** The rows a result is drawn with before there is one: a winner and two runners-up, the shape
 *  every category with votes takes. Most Aura alone has no stat line, because its one figure is
 *  the club and the result drops it as a repeat of the subtitle (see `stats` in AwardResult). The
 *  words are never shown; they only give each skeleton bar a plausible width. */
function placeholderResult(award: WpblAward): AwardCandidate[] {
  const stats = award.id === 'aura' ? [] : [
    { label: 'AVG', value: '.000' }, { label: 'HR', value: '00' }, { label: 'OPS', value: '0.000' },
  ]
  return [
    { key: 'sk1', name: 'Placeholder Name', teamId: null, playerId: null, line: '', sub: 'Placeholder club', stats },
    { key: 'sk2', name: 'Placeholder', teamId: null, playerId: null, line: '' },
    { key: 'sk3', name: 'Placeholder', teamId: null, playerId: null, line: '' },
  ]
}

export function AwardResult({ entry, index, players, teams, state, onOpenPlayer, onOpenTeam, skeleton = false }: {
  entry: AwardBallotEntry
  /** This award's position in the sheet, top-first, for the staggered confetti cascade. */
  index: number
  players: WpblPlayer[]
  teams: WpblTeam[]
  state: FanVoteState
  onOpenPlayer?: (p: WpblPlayer) => void
  onOpenTeam?: (t: WpblTeam) => void
  /** The result drawn empty, for the sheet while the ballot's data is still in flight. The SAME
   *  rows rather than a lookalike, so the box each one takes cannot drift from the loaded one:
   *  the category title is real (it needs no data), and every figure is a bar over placeholder
   *  text of the size that figure will be. */
  skeleton?: boolean
}) {
  const dark = useDark()
  const playerLink = useWpblPlayerLink()
  const teamLink = useWpblTeamLink()
  // ERA is stored on the league's basis and rescaled at DISPLAY time, so the same formatter the
  // tiles and the stats board use has to price a winner's headline figure too, or a pitcher's
  // ERA on this card would disagree with her ERA everywhere else. See AwardStat in derive/awards.
  const { fmtEra } = useEraBasis()
  const { award, candidates } = entry

  const bucket = state.results[award.id] ?? NO_VOTES
  const total = awardVoteCount(state.results, award.id)
  const votesOf = (key: string) => bucket[key] ?? 0
  // Vote order, write-ins included, the same list the tiles fall back to at close. Only names
  // with real votes are winners: a slate carries four candidates whether or not anyone picked
  // them, and withWriteIns keeps the seeded four in the list at zero.
  const ranked = useMemo(() => withWriteIns(candidates, {
    bucket, players, picked: state.ballot[award.id] ?? null, reveal: true, closed: true,
  }).filter(c => (bucket[c.key] ?? 0) > 0), [candidates, bucket, players, state.ballot, award.id])

  const teamOf = (id: string | null) => (id ? teams.find(t => t.id === id) ?? null : null)
  const pct = (c: AwardCandidate) => (total > 0 ? Math.round((votesOf(c.key) / total) * 100) : 0)

  // A per-award share button, open to everyone. Tapping it opens a small menu (Share / Copy /
  // Download); the chosen action builds a picture of this one result and runs it.
  const shareBtnRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sharing, setSharing] = useState<ShareAction | null>(null)

  const placeholder = useMemo(() => (skeleton ? placeholderResult(award) : []), [skeleton, award])
  const winner = skeleton ? placeholder[0] : ranked[0] ?? null
  const runnersUp = skeleton ? placeholder.slice(1) : ranked.slice(1, 3)
  // Wraps one figure in a skeleton bar when drawing empty. MUI sizes a skeleton with children to
  // the children and hides them, which is what makes the empty row exactly as tall as the full one.
  const bar = (node: ReactNode, key?: string) => (skeleton ? <Skeleton key={key} sx={{ maxWidth: '100%', width: 'fit-content' }}>{node}</Skeleton> : node)
  // The winner as a share card, built through the shared resolver so this button and the
  // all-winners poster draw the same picture. Null until there is a winner, which is also the
  // guard the launcher renders behind.
  const shareData = useMemo(
    () => (winner && !skeleton ? winnerShareData(entry, state, players, teams, fmtEra) : null),
    [winner, skeleton, entry, state, players, teams, fmtEra],
  )
  // The share buttons are about to be on screen, so fetch what a press will need now.
  useEffect(() => { if (shareData) preloadCapture() }, [shareData])
  // The empty groove a share bar fills, faint in both themes.
  const track = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)'

  // The way out of the hero row: a player to her page, a club (manager, aura) to the club page.
  // A play or game winner has no page these two helpers reach, so it simply is not a link, the
  // same rule the tile's `exit` follows.
  const winnerPlayer = winner?.playerId ? players.find(p => p.id === winner.playerId) ?? null : null
  const winnerTeam = winner ? teamOf(winner.teamId) : null
  const exit = winner && winnerPlayer && onOpenPlayer
    ? playerLink(winnerPlayer, onOpenPlayer)
    : winner && !winnerPlayer && winnerTeam && onOpenTeam
      ? teamLink(winnerTeam, () => onOpenTeam(winnerTeam))
      : null

  // Every portrait rings in its OWN club's accent, so a card reads as one color per row: the
  // hero in the winner's, each runner-up in theirs. Overriding the default secondary ring is what
  // stops the accent from stacking outside it as a second hue (see the ring note on the hero).
  const portrait = (c: AwardCandidate, size: number) => {
    const ring = wpblAccent(c.teamId, dark)
    const headshot = wpblManagerPortraitSet(c.key)
    if (c.playerId || headshot) return <PlayerPortrait name={c.name} teamId={c.teamId} size={size} src={headshot} ring={ring} />
    const t = teamOf(c.teamId)
    return t ? <TeamBadge team={t} size={size} ring={ring} /> : null
  }

  // The confetti fires from the winner portrait but is DRAWN in this outer box, which is not
  // overflow-clipped, so the burst flies past the results card's rounded corners instead of being
  // cut off at its top edge. Measuring the portrait after layout gives an exact origin and rim at
  // any chrome/text scale; the size is fixed (56px) so the number is stable before the image loads.
  const rootRef = useRef<HTMLDivElement>(null)
  const portraitRef = useRef<HTMLDivElement>(null)
  const [origin, setOrigin] = useState<{ x: number; y: number; r: number } | null>(null)
  useLayoutEffect(() => {
    const root = rootRef.current, port = portraitRef.current
    // No confetti for a placeholder: it would celebrate nobody, and then again for the real winner.
    if (!winner || skeleton || !root || !port) { setOrigin(null); return }
    const rr = root.getBoundingClientRect(), pr = port.getBoundingClientRect()
    setOrigin({ x: pr.left - rr.left + pr.width / 2, y: pr.top - rr.top + pr.height / 2, r: pr.width / 2 })
    // On a new winner, not on every render: `winner` is rebuilt each time, and this effect sets
    // state, so following the object would measure and re-render in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winner?.key, skeleton])

  // STAGGERED, TOP TO BOTTOM. All the winners are on screen when the sheet opens, so firing them at
  // once is one flat pop; delaying each by its position turns it into a cascade that draws the eye
  // down the results the way a reader would read them. Mounts the burst only when its turn comes,
  // so each one animates from its start rather than sitting at the rim through the wait.
  const [fire, setFire] = useState(false)
  useEffect(() => {
    if (!origin) return
    const t = window.setTimeout(() => setFire(true), index * WINNER_CONFETTI_STAGGER_MS)
    return () => window.clearTimeout(t)
  }, [origin, index])

  return (
    <Box ref={rootRef} sx={{ position: 'relative' }}>
      {/* The confetti, drawn here so it flies free of the card below rather than being clipped by
          its rounded overflow. Placed on the measured winner portrait. */}
      {origin && fire && <WinnerConfetti x={origin.x} y={origin.y} r={origin.r} />}
      {/* Off-screen capture, mounted only while an action is in flight; runs whichever the menu
          chose. */}
      {sharing && shareData && (
        <WinnerShareLauncher
          action={sharing}
          data={shareData}
          onDone={() => setSharing(null)}
        />
      )}
      {/* THE CATEGORY IS THE EYEBROW, NOT THE HEADLINE. In the voting view the award's name is
          the question and takes the largest type; here the question is answered, so the winner's
          name is the thing worth reading big and the category steps back to a label above it.
          The share button sits on this row. */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.75 }}>
        <Typography sx={{
          // The category, stepped up so it reads as the section heading it is. Uppercase and
          // secondary keep it clearly below the winner's name, which is bigger still.
          fontSize: { xs: TYPE_SCALE.body, md: TYPE_SCALE.title }, fontWeight: 800, letterSpacing: typePx(0.5),
          textTransform: 'uppercase', color: 'text.secondary', lineHeight: 1.3, minWidth: 0,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{award.title}</Typography>
        {winner && (skeleton ? (
          // The Share pill's own box, hidden under a skeleton, so the heading row is the height
          // the loaded one will be. Hidden children take no clicks and no focus.
          <Skeleton variant="rounded" sx={{ borderRadius: 999, flexShrink: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: chromePx(4), px: chromePx(8), py: chromePx(4), border: '1px solid' }}>
              <IosShare sx={{ fontSize: TYPE_SCALE.body }} />
              <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800 }}>Share</Typography>
            </Box>
          </Skeleton>
        ) : (
          <Box
            ref={shareBtnRef}
            {...pressable(() => {
              if (sharing) return
              // On a phone the native share sheet already offers copy and save, so go straight to
              // it; only fall back to our own Copy/Download menu where a file share is unavailable.
              if (canNativeShareFiles()) setSharing('share')
              else setMenuOpen(true)
            })}
            aria-label={`Share the ${award.title} result`}
            aria-haspopup="menu"
            title="Share this result"
            sx={{
              ...TAPPABLE, ...FOCUS_RING, flexShrink: 0, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: chromePx(4),
              borderRadius: 999, px: chromePx(8), py: chromePx(4),
              border: '1px solid', borderColor: 'outline', color: 'text.secondary',
              ...hoverOnly({ borderColor: 'var(--wpbl-accent-fg)', color: 'var(--wpbl-accent-fg)' }),
            }}
          >
            <IosShare sx={{ fontSize: TYPE_SCALE.body }} />
            <Typography sx={{ fontSize: TYPE_SCALE.caption, fontWeight: 800 }}>
              {sharing ? '…' : 'Share'}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* The desktop fallback menu: only reached where there is no native file share (the button
          goes straight to the OS sheet otherwise). Copy where the clipboard takes an image;
          Download always, as the floor every browser can do. No "Share…" item here: it would just
          repeat the button, and this menu only exists where a native share is not possible. */}
      <Menu
        anchorEl={shareBtnRef.current}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        // Above the results sheet (ModalShell defaults to 1500), or the menu opens behind it and
        // the tap looks like it did nothing.
        sx={{ zIndex: 1700 }}
      >
        {canCopyImage() && (
          <MenuItem onClick={() => { setMenuOpen(false); setSharing('copy') }}>
            <ListItemIcon><ContentCopy fontSize="small" /></ListItemIcon>
            Copy image
          </MenuItem>
        )}
        <MenuItem onClick={() => { setMenuOpen(false); setSharing('download') }}>
          <ListItemIcon><Download fontSize="small" /></ListItemIcon>
          Download
        </MenuItem>
      </Menu>

      {!winner ? (
        // No votes at all. A hero row here would crown a zero, so say the true thing instead.
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.disabled', lineHeight: 1.4 }}>
          No votes
        </Typography>
      ) : (
        // ONE BAR SCALE FOR THE WHOLE CARD. The winner and the runners-up are the SAME row shape,
        // and every bar spans the full card width from the same left edge, filled to that name's
        // share of the vote. That is the whole fix for the bars reading oddly before: they used to
        // start at different x's and run to different maxes (the hero's flush to the card, each
        // runner's inset under its name), so two lengths a reader is meant to compare could not be.
        // Now 41% and 38% are 41% and 38% of the same line, and the winner is set apart by size,
        // weight and a color wash instead of by a bar that did not line up.
        <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'outline', overflow: 'hidden' }}>
          {[winner, ...runnersUp].map((c, idx) => {
            const isWinner = idx === 0
            const rowAccent = wpblAccent(c.teamId, dark)
            // Only the winner links out, the one name this card is really about; a runner-up is a
            // figure in a chart here, not a destination.
            const rowExit = isWinner ? exit : null
            // Drop the aura award's lone "Team" stat: the club is already in the subtitle below the
            // name, so the stat just repeats it. Leaves aura as name + subtitle, nothing else.
            const stats = (c.stats ?? []).filter(s => s.label !== 'Team').slice(0, 3)
            const club = teamOf(c.teamId)?.name
            const detail = c.playerId ? [club, c.sub].filter(Boolean).join(' · ') : (c.sub ?? club ?? '')
            return (
              <Box
                key={c.key}
                {...(rowExit ?? {})}
                aria-label={rowExit ? `Open ${c.name}` : undefined}
                sx={{
                  position: 'relative',
                  display: 'flex', alignItems: 'center', gap: chromePx(isWinner ? 12 : 10),
                  // The extra bottom padding is the room the full-width share bar sits in.
                  px: chromePx(14),
                  pt: chromePx(isWinner ? 12 : 9),
                  pb: chromePx(isWinner ? 16 : 13),
                  // The winner alone gets the color wash; the runners-up stay plain so the hero
                  // reads as the answer and they read as the field.
                  bgcolor: isWinner && !skeleton ? `${rowAccent}1f` : 'transparent',
                  textDecoration: 'none', color: 'text.primary',
                  ...(rowExit ? { cursor: 'pointer', ...TAPPABLE, ...FOCUS_RING } : null),
                }}
              >
                {/* The rank on a runner-up, so 2 and 3 read as places rather than as two more
                    winners. The hero needs none: it is the winner by every other signal here. */}
                {!isWinner && (
                  <Typography sx={{
                    fontSize: TYPE_SCALE.caption, fontWeight: 800, color: 'text.disabled',
                    width: chromePx(14), flexShrink: 0, fontVariantNumeric: 'tabular-nums',
                  }}>{idx + 1}</Typography>
                )}
                {/* One ring, in the row's own club accent (see the portrait helper): the hero and
                    each runner are keyed to their own club rather than stacking a second hue. The
                    winner's portrait is measured (ref) so the confetti above can fire from its
                    exact center and rim. */}
                <Box ref={isWinner ? portraitRef : undefined} sx={{ flexShrink: 0, display: 'flex' }}>
                  {skeleton
                    ? <Skeleton variant="circular" sx={{ width: chromePx(isWinner ? 56 : 30), height: chromePx(isWinner ? 56 : 30) }} />
                    : portrait(c, isWinner ? 56 : 30)}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  {/* The winner's FULL name behind a trophy; the runners-up abbreviate to hold one
                      line. The hero name steps up on desktop so it stays the biggest thing on the
                      card, above the enlarged category heading. */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: chromePx(6), minWidth: 0 }}>
                    {bar(!isWinner && c.playerId
                      ? <NameText name={c.name} sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.2, minWidth: 0 }} />
                      : <Typography sx={{
                          fontSize: isWinner ? { xs: TYPE_SCALE.title, md: TYPE_SCALE.heading } : TYPE_SCALE.body,
                          fontWeight: isWinner ? 800 : 700, lineHeight: 1.2, minWidth: 0,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{c.name}</Typography>)}
                    {isWinner && !skeleton && (
                      // The one place the section spends a trophy: it marks the winner and nothing
                      // else on the sheet competes for the mark. After the name so it reads as a
                      // seal on it. Gold rather than the club accent, because a trophy reads as
                      // first place in a color a green or blue one would not; sized off the name.
                      <EmojiEvents titleAccess="Winner" sx={{
                        fontSize: { xs: TYPE_SCALE.title, md: TYPE_SCALE.heading }, color: '#eab308', flexShrink: 0,
                      }} />
                    )}
                  </Box>
                  {isWinner && detail && bar(
                    <Typography sx={{
                      // A step up on desktop, where the caption size was barely legible in the
                      // wide hero; still compact on a phone.
                      fontSize: { xs: TYPE_SCALE.caption, md: TYPE_SCALE.meta },
                      color: 'text.secondary', lineHeight: 1.35, mt: '2px',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{detail}</Typography>,
                  )}
                  {/* THE HEADLINE STAT LINE, on the winner only: the same figures the tile carded
                      her on, so the result says WHY as well as who. Empty for a write-in or an
                      open-field category, which carry no figures by design.

                      THE VALUES ARE THE READABLE HALF, so they carry the weight and the size and
                      the labels stay small and quiet beside them. On desktop the values step up to
                      body, where a caption-sized stat line all but disappeared in the wide row. */}
                  {isWinner && stats.length > 0 && (
                    <Box sx={{
                      display: 'flex', flexWrap: 'wrap', alignItems: 'baseline',
                      columnGap: chromePx(10), rowGap: '2px', mt: '4px',
                    }}>
                      {stats.map(s => bar(
                        <Box key={s.label} sx={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                          <Typography component="span" sx={{
                            fontSize: { xs: TYPE_SCALE.body, md: TYPE_SCALE.title }, fontWeight: 800,
                            color: 'text.primary', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums',
                          }}>{s.eraBasisValue !== undefined ? fmtEra(s.eraBasisValue) : s.value}</Typography>
                          <Typography component="span" sx={{
                            fontSize: { xs: TYPE_SCALE.caption, md: TYPE_SCALE.meta }, fontWeight: 700,
                            letterSpacing: typePx(0.3), textTransform: 'uppercase', color: 'text.secondary', lineHeight: 1.2,
                          }}>{s.label}</Typography>
                        </Box>, s.label,
                      ))}
                    </Box>
                  )}
                </Box>
                <Box sx={{ flexShrink: 0, textAlign: 'right' }}>
                  {bar(<Typography sx={{
                    fontSize: isWinner ? TYPE_SCALE.heading : TYPE_SCALE.body,
                    fontWeight: isWinner ? 900 : 800, lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums', color: rowAccent,
                  }}>{skeleton ? '00%' : `${pct(c)}%`}</Typography>)}
                </Box>
                {/* THE SHARE BAR: full card width, same left edge and same 100% for every row, so
                    the lengths are comparable. It doubles as the divider between rows. */}
                <Box aria-hidden sx={{
                  position: 'absolute', left: 0, right: 0, bottom: 0, height: chromePx(4), bgcolor: track,
                }}>
                  <Box sx={{ height: '100%', width: `${pct(c)}%`, bgcolor: rowAccent }} />
                </Box>
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}
