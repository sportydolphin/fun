import React, { createContext, useContext, useCallback, useMemo } from 'react'
import {
  wpblPlayerPath, wpblGamePath, wpblTeamPath,
  type WpblSluggable, type WpblSluggableGame, type WpblSluggableTeam,
} from './routes'

// Turns any Box/Typography that opens a player or a game into a real <a href>.
//
// WHY THIS EXISTS AT ALL. Every player name on the section was a div with an onClick and
// nothing else, which fails three ways at once and none of them are visible in a browser:
//
//   - Googlebot does not fire click handlers, so a name that is only an onClick is invisible
//     to it. This is the same failure that hid /mlb from Google for months (see the rule in
//     CLAUDE.md), and the exposure here is larger: 118 player URLs sit in the sitemap and the
//     only page that linked to any of them was /wpbl/players, which nothing linked to either.
//   - A div is not focusable, so every one of those names was unreachable by keyboard. The
//     Stats board had 33 player rows and 15 tab stops, all of them site chrome.
//   - No href means no open-in-new-tab, no middle-click, no copy-link, no status bar preview.
//
// WHY A CONTEXT rather than a prop. The href is a SLUG, and both slug rules need the whole
// list to decide whether one is ambiguous (see routes.ts). Threading the full roster to every
// board that lists a player would mean a team page linking with its own 30-name roster, which
// would happily mint a bare slug for a name that a player on ANOTHER club also holds: exactly
// the silent wrong-player URL the slug rules exist to prevent. A game slug has the same shape
// of hazard and the same answer. One provider holding the one roster and the one schedule is
// what keeps both impossible.
//
// Modified clicks (cmd/ctrl/shift/alt, middle button) fall through to the browser untouched,
// so open-in-new-tab behaves the way it does everywhere else.

/** Props to spread onto whatever element opens a player or a game. */
export interface WpblPlayerLinkProps {
  component?: 'a'
  href?: string
  onClick?: (e: React.MouseEvent) => void
  /** Anchors carry a default underline and link colour; every call site here paints its own.
   *  Inline rather than in `sx`, so a call site's own `sx` cannot silently drop it. */
  style?: React.CSSProperties
}

type LinkFor<T> = (subject: T | null | undefined, onOpen?: (p: never) => void) => WpblPlayerLinkProps

interface LinkContextValue {
  playerLink: LinkFor<WpblSluggable>
  gameLink: LinkFor<WpblSluggableGame>
  teamLink: LinkFor<WpblSluggableTeam>
}

const LinkContext = createContext<LinkContextValue | null>(null)

export function WpblLinkProvider({ roster, schedule, teams, children }: {
  roster: readonly WpblSluggable[]
  schedule: readonly WpblSluggableGame[]
  teams: readonly WpblSluggableTeam[]
  children: React.ReactNode
}) {
  // Before the data lands there is no honest slug to point at, so the element stays a plain
  // onClick for those few hundred milliseconds rather than shipping an href that might name
  // the wrong subject. A crawler waits for the render; a reader clicking that fast still
  // gets the modal.
  const build = useCallback(<T,>(subject: T | null | undefined, href: string | undefined, onOpen?: (p: never) => void): WpblPlayerLinkProps => {
    if (!subject) return {}
    const open = onOpen as ((p: T) => void) | undefined
    if (!href) return open ? { onClick: () => open(subject) } : {}
    return {
      component: 'a',
      href,
      style: { textDecoration: 'none', color: 'inherit' },
      onClick: (e: React.MouseEvent) => {
        // Stopped first, and for modified clicks too. Some of these anchors sit inside a row
        // that ALSO opens the player, so without this a plain click opens her twice (two
        // history entries, one of them a dead Back) and a cmd-click opens a new tab AND the
        // modal in the tab you were reading.
        e.stopPropagation()
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        open?.(subject)
      },
    }
  }, [])

  const playerLink = useCallback<LinkFor<WpblSluggable>>((player, onOpen) => build(
    player, player && roster.length > 0 ? wpblPlayerPath(player, roster) : undefined, onOpen,
  ), [build, roster])

  const gameLink = useCallback<LinkFor<WpblSluggableGame>>((game, onOpen) => build(
    game,
    game && schedule.length > 0 && teams.length > 0 ? wpblGamePath(game, teams, schedule) : undefined,
    onOpen,
  ), [build, schedule, teams])

  // A club needs the whole list for the same reason the other two do, though for a weaker
  // reason: `teamSlug` falls back to the abbreviation for a club the list does not carry, and
  // a card linking with its own club alone would mint '/wpbl/teams/sf' where every other link
  // on the site says '/wpbl/teams/firebells'.
  const teamLink = useCallback<LinkFor<WpblSluggableTeam>>((team, onOpen) => build(
    team, team && teams.length > 0 ? wpblTeamPath(team, teams) : undefined, onOpen,
  ), [build, teams])

  const value = useMemo(() => ({ playerLink, gameLink, teamLink }), [playerLink, gameLink, teamLink])
  return <LinkContext.Provider value={value}>{children}</LinkContext.Provider>
}

/**
 * `playerLink(player, onOpen)` / `gameLink(game, onOpen)` → props to spread. Outside a
 * provider both return a plain onClick, so a board rendered in a test or in isolation still
 * works; it just is not a link.
 */
function useLinkFor<T>(pick: (v: LinkContextValue) => LinkFor<T>): LinkFor<T> {
  const ctx = useContext(LinkContext)
  const fallback = useMemo<LinkFor<T>>(() => (subject, onOpen) => (
    subject && onOpen ? { onClick: () => (onOpen as (p: T) => void)(subject) } : {}
  ), [])
  return ctx ? pick(ctx) : fallback
}

/**
 * Recolour a spread from `gameLink` / `playerLink` / `teamLink`.
 *
 * WHY THIS EXISTS AND `sx` DOES NOT WORK. `build` hands back an inline `style` carrying
 * `color: 'inherit'`, and it has to: the props make a real `<a>`, and the UA stylesheet's
 * link colour beats an inherited one, so without it every crawlable link in the section
 * would come out browser-blue. But an inline style also beats the class `sx` compiles to,
 * so a call site that spreads the link props and then asks for a colour in `sx` is silently
 * overruled. Last Game's "Full recap" did exactly that for as long as it has been an anchor:
 * it rendered in body text beside "Full board" and "View all" in the accent, same header
 * slot, same size, same weight. Nothing warns, and the `sx` reads as if it worked.
 *
 * Props with no `style` are the pre-data case, where the element is a plain onClick and not
 * a link at all. Those are returned untouched so the call site's own `sx` colour still
 * applies, which is why every caller should keep it as well as passing a colour here.
 */
export function linkColor(props: WpblPlayerLinkProps, color: string): WpblPlayerLinkProps {
  return props.style ? { ...props, style: { ...props.style, color } } : props
}

export const useWpblPlayerLink = (): LinkFor<WpblSluggable> => useLinkFor(v => v.playerLink)
export const useWpblGameLink = (): LinkFor<WpblSluggableGame> => useLinkFor(v => v.gameLink)
export const useWpblTeamLink = (): LinkFor<WpblSluggableTeam> => useLinkFor(v => v.teamLink)
