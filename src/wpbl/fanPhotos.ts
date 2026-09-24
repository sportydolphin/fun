// Fan photos: joining the three flat reads into the lookups every surface asks for.
//
// The fetchers in api.ts return three parallel arrays (photos, their subject tags, the figure
// dictionary). This module joins them in memory, the same shape the section uses for league-wide
// data, and is deliberately pure: types-only imports, no supabase client, so it unit-tests as a
// plain function. See docs/FAN_PHOTOS.md.
//
// A club is NOT derived here. A photo's club comes from `game_id`'s box score or from `taken_on`,
// never from a subject's roster row, so this module only ever answers "who is in this photo" and
// "which photos is this subject in". Names for the tags come from fetchWpblAllPlayers at the
// surface (trap: a traded player is absent from either club's current roster; build the name map
// from the full player list, per CLAUDE.md), and from `figures` here for the non-players.

import type { WpblFanPhoto, WpblPhotoSubject, WpblPhotoFigure, WpblTeam, WpblPhotoCategory } from './types'

/** A photo with its subject tags folded in. `playerIds`, `figureKeys` and `teamIds` are disjoint
 *  by the table's check constraint (exactly one column set per tag row). */
export interface FanPhotoWithSubjects extends WpblFanPhoto {
  playerIds: string[]
  figureKeys: string[]
  /** Clubs tagged as a whole: a team photo, rather than one of its players. */
  teamIds: string[]
  /** The category's display name, for a caption when nothing else names the photo. */
  categoryName?: string | null
}

/** How a tagged club reads in a caption and a filter chip: "Boston Hunters". */
export function fanPhotoTeamName(team: WpblTeam | undefined): string {
  return team ? `${team.city} ${team.name}` : '—'
}

export interface FanPhotoIndex {
  /** Every approved photo, in the curated order the fetcher returned. */
  photos: FanPhotoWithSubjects[]
  /** Every photo a player is tagged in, newest-curated first per that same order. This is the
   *  player-page strip and the gallery's per-subject filter. */
  byPlayer: Map<string, FanPhotoWithSubjects[]>
  /** Every photo a non-player figure is tagged in, keyed on the figure's `key`. */
  byFigure: Map<string, FanPhotoWithSubjects[]>
  /** Every photo from a given game, for Game Center's "from this game". */
  byGame: Map<string, FanPhotoWithSubjects[]>
  /** Every photo a club is tagged in as a whole (team photos). */
  byTeam: Map<string, FanPhotoWithSubjects[]>
  /** The figure dictionary, for turning a tagged `figure_key` into a name and kind. */
  figures: Map<string, WpblPhotoFigure>
  /** The clubs, for turning a tagged `team_id` into a name. */
  teams: Map<string, WpblTeam>
  /** Every photo filed under a category, keyed on its `key`. Uncategorised photos are in no bucket. */
  byCategory: Map<string, FanPhotoWithSubjects[]>
  /** The categories in the curator's order, for the gallery's chips. */
  categories: WpblPhotoCategory[]
}

function push<K>(map: Map<K, FanPhotoWithSubjects[]>, key: K, photo: FanPhotoWithSubjects): void {
  const bucket = map.get(key)
  if (bucket) bucket.push(photo)
  else map.set(key, [photo])
}

/**
 * Join photos, their tags and the figure dictionary into per-subject and per-game lookups.
 *
 * Order is carried straight through from `photos`: the buckets are filled by walking that array
 * once, so every list stays in the curator's sequence rather than in tag-insertion order. A tag
 * whose `photo_id` names no photo in `photos` is dropped rather than materialising an empty entry:
 * with RLS gating a tag's visibility on its photo being approved, that only happens on a partial
 * read, and a phantom subject is worse than a missing one.
 */
export function buildFanPhotoIndex(
  photos: WpblFanPhoto[],
  subjects: WpblPhotoSubject[],
  figures: WpblPhotoFigure[],
  teams: WpblTeam[] = [],
  categories: WpblPhotoCategory[] = [],
): FanPhotoIndex {
  const figureMap = new Map<string, WpblPhotoFigure>()
  for (const f of figures) figureMap.set(f.key, f)
  const teamMap = new Map<string, WpblTeam>()
  for (const t of teams) teamMap.set(t.id, t)
  const categoryNames = new Map(categories.map(c => [c.key, c.name]))

  // Group tags by photo so each photo carries its own subjects, ready to fold in below.
  const playerTags = new Map<string, string[]>()
  const figureTags = new Map<string, string[]>()
  const teamTags = new Map<string, string[]>()
  for (const s of subjects) {
    if (s.player_id) {
      const list = playerTags.get(s.photo_id)
      if (list) list.push(s.player_id)
      else playerTags.set(s.photo_id, [s.player_id])
    } else if (s.figure_key) {
      const list = figureTags.get(s.photo_id)
      if (list) list.push(s.figure_key)
      else figureTags.set(s.photo_id, [s.figure_key])
    } else if (s.team_id) {
      const list = teamTags.get(s.photo_id)
      if (list) list.push(s.team_id)
      else teamTags.set(s.photo_id, [s.team_id])
    }
  }

  const withSubjects: FanPhotoWithSubjects[] = []
  const byPlayer = new Map<string, FanPhotoWithSubjects[]>()
  const byFigure = new Map<string, FanPhotoWithSubjects[]>()
  const byTeam = new Map<string, FanPhotoWithSubjects[]>()
  const byGame = new Map<string, FanPhotoWithSubjects[]>()
  const byCategory = new Map<string, FanPhotoWithSubjects[]>()

  for (const p of photos) {
    // Only published photos reach an audience surface. For a reader RLS already guarantees it;
    // for the owner, whose read includes the backlog, this is what enforces it (see api.ts).
    if (p.approved === false) continue
    const playerIds = playerTags.get(p.id) ?? []
    const figureKeys = figureTags.get(p.id) ?? []
    const teamIds = teamTags.get(p.id) ?? []
    const categoryName = p.category_key ? (categoryNames.get(p.category_key) ?? null) : null
    const photo: FanPhotoWithSubjects = { ...p, playerIds, figureKeys, teamIds, categoryName }
    withSubjects.push(photo)
    for (const pid of playerIds) push(byPlayer, pid, photo)
    for (const key of figureKeys) push(byFigure, key, photo)
    for (const tid of teamIds) push(byTeam, tid, photo)
    if (p.game_id) push(byGame, p.game_id, photo)
    if (p.category_key) push(byCategory, p.category_key, photo)
  }

  return { photos: withSubjects, byPlayer, byFigure, byTeam, byGame, figures: figureMap, teams: teamMap, byCategory, categories }
}
