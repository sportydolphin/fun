// What fans call a club when they are not writing its name out: "Cards", "Jays", "Nats". The search
// matches a club on its name and abbreviation, which none of these are, so each typed alone used
// to find nothing. Keyed by StatsAPI team id; a club with no common short name has no entry.
//
// A nickname answers only when typed whole, or as the start of one at least three letters long, so
// two-letter ones ("A's", "O's") cannot catch a name still being typed.

export const MLB_CLUB_NICKNAMES: Record<number, string[]> = {
  108: ['halos'],
  109: ['dbacks', 'd-backs', 'snakes'],
  110: ["o's", 'os', 'birds'],
  111: ['sox', 'bosox'],
  112: ['cubbies'],
  115: ['rox'],
  117: ['stros'],
  120: ['nats'],
  121: ['amazins'],
  133: ["a's", 'as'],
  134: ['bucs'],
  135: ['friars', 'pads'],
  136: ["m's"],
  138: ['cards', 'redbirds'],
  141: ['jays'],
  143: ['phils'],
  145: ['sox', 'chisox', 'southsiders'],
  146: ['fish'],
  158: ['brew crew'],
}

const fold = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '')

/** Whether `query` is one of the club's nicknames, or the start of one (three letters or more). */
export function matchesClubNickname(teamId: number, query: string): boolean {
  const q = fold(query)
  if (!q) return false
  return (MLB_CLUB_NICKNAMES[teamId] ?? []).some(n => {
    const name = fold(n)
    return name === q || (q.length >= 3 && name.startsWith(q))
  })
}
