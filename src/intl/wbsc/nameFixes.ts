// The names the display rule gets wrong, set by hand (`displayName` in game.ts reads this first).
//
// Keyed by team and the name exactly as WBSC registers it (`full_name`: the given names as written,
// the surname through `surnameCase`), which is the same for a player in every event that writes
// it the same way. A new event that spells a player differently needs its own line.
//
// Each line says why, since nothing else will: the rule is right for everyone not listed here.

export const NAME_FIXES: ReadonlyMap<string, string> = new Map([
  // WBSC has the surname as a given name and the given name as the surname, and drops the
  // apostrophe. A Goan player, reported as "Sharol D'Mello" (Herald Goa) and "Mello Sheral" (the
  // Baseball-Reference roster); D'Mello is the Goan surname.
  ['IND|D Mello Sheral', "Sheral D'Mello"],
  // Initials, which WBSC writes in title case.
  ['USA|Aj Hamilton', 'AJ Hamilton'],
])

export const nameFixKey = (teamId: string | null, fullName: string): string => `${teamId ?? ''}|${fullName}`
