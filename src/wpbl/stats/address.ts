import { type FinderVenue,
} from '../derive/finder'
import type { Side, Source, Mode } from './axes'
import { sideOn, sideOfSort } from './axes'

// ─── the view in the address bar ──────────────────────────────────────────────

/**
 * Which board, which side and which column, mirrored into the query string.
 *
 * WHY THE QUERY AND NOT THE PATH. `urlFor` in WpblApp sets the rule the section follows: the
 * tab is the PATH, because it is a page worth indexing under its own title, and anything laid
 * OVER that page is a query param. A sorted column is the second kind. It also means this costs
 * nothing in the three places a new route would: `/wpbl/stats` is already in `_redirects`, the
 * sitemap is unchanged, and `seo.ts` builds its canonical from `path.split('?')[0]`, so every
 * permutation of these four params canonicalizes back to `/wpbl/stats` and none of them can
 * reach the index as a near-duplicate.
 *
 * ONLY NON-DEFAULTS ARE WRITTEN, so the ordinary reader who never touches a control keeps a
 * clean `/wpbl/stats` in the address bar and a link they paste says only what they changed.
 *
 * `board` IS THE TAB ROW AS DRAWN, not the internal pair behind it: a reader looking at Teams
 * sees one tab called Teams, where the code sees `source: 'season'` plus `mode: 'teams'`. The
 * URL is read by people, so it spells the thing on screen.
 */
type BoardParam = 'leaders' | 'players' | 'teams' | 'fielding' | 'bests' | 'find' | 'pitches' | 'runs' | 'tracked' | 'draft' | 'charts'

export const STATS_PATH = '/wpbl/stats'

/**
 * The query params this board owns, named so WpblApp can carry them.
 *
 * WHY WpblApp HAS TO KNOW. `urlFor` builds a URL out of the navigation snapshot and nothing
 * else, and the effect that stamps the section's first history entry calls it on mount. So on a
 * COLD LOAD every param on the address it was opened at would be discarded in the first tick,
 * before this component has rendered once: `/wpbl/stats?board=runs` would open on Players with
 * the query gone. That is the expensive kind of failure, because switching boards writes the
 * param correctly, so a link a reader copies is right and the same link pasted back quietly lands
 * them somewhere else.
 *
 * These are not snapshot state: they are a board's own view of itself, owned and written here,
 * so the list is exported instead and `urlFor` carries whatever it finds under these names when
 * the target is this tab. See `playFragmentFor` in entryUrl.ts for the related case of the URL
 * fragment, which needs capturing rather than carrying.
 */
export const STATS_URL_PARAMS = ['board', 'side', 'sort', 'dir', 'q', 'team', 'opp', 'venue', 'pos'] as const


/** Copy this board's params from one query onto another, leaving everything else alone.
 *
 *  ONE DEFINITION, used by the writer effect below and by `urlFor` in WpblApp, so a param added
 *  here cannot be carried by one and dropped by the other, which is the asymmetry that loses a
 *  board's state on a pasted link. */
export function carryStatsParams(from: URLSearchParams, to: URLSearchParams): void {
  for (const k of STATS_URL_PARAMS) {
    const v = from.get(k)
    if (v != null) to.set(k, v)
  }
}

// `side` is written as its own param now that Fielding is a side of every season board rather than a
// board: `?board=players&side=fielding`. `board=fielding` is still READ (boardAxes), so the links
// written before Oct 2026 open the same table.
export function boardParam(source: Source, mode: Mode): BoardParam {
  if (source !== 'season') return source as BoardParam
  return mode === 'teams' ? 'teams' : 'players'
}

function boardAxes(board: string | null): { source: Source; mode: Mode; side?: Side } | null {
  switch (board) {
    case 'leaders': return { source: 'leaders', mode: 'players' }
    case 'players': return { source: 'season', mode: 'players' }
    case 'fielding': return { source: 'season', mode: 'players', side: 'fielding' }
    case 'teams':   return { source: 'season', mode: 'teams' }
    case 'bests':   return { source: 'bests', mode: 'players' }
    case 'find':    return { source: 'find', mode: 'players' }
    case 'pitches': return { source: 'pitches', mode: 'players' }
    case 'runs':    return { source: 'runs', mode: 'players' }
    case 'draft':   return { source: 'draft', mode: 'players' }
    case 'charts':  return { source: 'charts', mode: 'players' }
    case 'tracked': return { source: 'tracked', mode: 'players' }
    // Anything else is a hand-edited or stale link, and the honest answer to one of those is
    // the default board rather than a blank screen.
    default: return null
  }
}

/** What the address bar is asking for, or nulls. Read once at mount: after that the reader's
 *  own controls are the truth and this module writes the URL rather than reading it. */
export function axesFromQuery(): {
  source?: Source; mode?: Mode; side?: Side; sortKey?: string; sortAsc?: boolean
  find?: string | null; findTeam?: string | null; findOpp?: string | null; findVenue?: FinderVenue
  pos?: string | null
} {
  if (typeof window === 'undefined') return {}
  // Only on the stats tab. A player modal opened from here owns the path, and the axes on it
  // belong to the entry underneath rather than to the page being shown.
  if (window.location.pathname.replace(/\/+$/, '') !== STATS_PATH) return {}
  const q = new URLSearchParams(window.location.search)
  // A sort with no board is a link from before Leaders opened the tab, when a bare /wpbl/stats was
  // the Players table: `?sort=ops` asks for a column, and only Players has columns.
  const board = boardAxes(q.get('board')) ?? (q.get('sort') || q.get('dir') ? boardAxes('players') : null)
  const side = q.get('side')
  const dir = q.get('dir')
  const venue = q.get('venue')
  return {
    ...(board ?? {}),
    // Fielding only where a board answers it; anywhere else the param is a hand-edited link, and the
    // board's own default side is the honest reading of it.
    side: board?.side ?? (side === 'hitting' || side === 'pitching' ? side
      : (side === 'fielding' || side === 'overall') && sideOn(side, board?.source ?? 'leaders', board?.mode) ? side
      // No side named. A column names one, so `?sort=ops` is still the Hitting table it always was.
      : side == null && q.get('sort') ? sideOfSort(q.get('sort')!) : undefined),
    sortKey: q.get('sort') ?? undefined,
    sortAsc: dir === 'asc' ? true : dir === 'desc' ? false : undefined,
    // The Find board's question. Decoded against the side the URL names, since the fields
    // differ between the two and a hitting condition means nothing on a pitching board.
    find: q.get('q'),
    findTeam: q.get('team'),
    findOpp: q.get('opp'),
    findVenue: venue === 'home' || venue === 'away' ? (venue as FinderVenue) : undefined,
    // A position or role on the players board ("best catcher" in the search).
    pos: q.get('pos'),
  }
}
