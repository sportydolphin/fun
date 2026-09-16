// A light profanity/slur filter for user-chosen public NAMES (today: usernames, which show on
// leaderboards and predictions). This is the client half: it gives immediate feedback in the
// form and keeps a casually offensive name out of the UI. The API-direct path is closed by a
// database trigger that mirrors this exactly (scripts/migrations/*_reject_profane_usernames.sql):
// if you change the list or the leet map here, change it there too, since only review keeps the
// two in step. The owner deactivating an account from /admin remains the last resort.
//
// HOW IT MATCHES. Usernames are `[A-Za-z0-9_-]` with no spaces, so there are no word boundaries to
// anchor on and the only workable test is "does a banned term appear as a substring". The input is
// first normalized to fold the usual evasions: lowercased, common leet characters mapped back to
// letters (sh1t, b!tch, f@g), and every non-letter dropped (f_u_c_k). Stretched spellings (fuuuck)
// are caught by letting each letter of a banned term repeat in the match, rather than by collapsing
// the input: collapsing would corrupt the doubled letters that distinguish a slur from an innocent
// word ("nigger" collapsed to "niger" would flag "Nigeria"). See BANNED_PATTERNS.
//
// WHAT IS ON THE LIST, AND WHAT IS NOT. Only terms offensive on their own, spelled in full. Short
// fragments and mild words are deliberately absent to avoid the Scunthorpe problem: banning "ass"
// would reject "class" and "bass", "coon" would reject "raccoon" and "tycoon", "cock" would reject
// "Peacock" and "Hancock". A few full words still overlap rare benign ones ("prick" in "prickly");
// that trade is accepted because the alternative is letting the slur through.

/** Leet and lookalike characters, mapped to the letter they stand in for. */
const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g',
  '@': 'a', '$': 's', '!': 'i', '+': 't', '(': 'c', '<': 'c', '|': 'i',
}

/** Full offensive terms only (see the header on why no fragments). Lowercase, letters only, since
 *  that is what the input is reduced to before comparison. */
const BANNED: readonly string[] = [
  'fuck', 'shit', 'bitch', 'bastard', 'cunt', 'asshole', 'dumbass', 'jackass',
  'dickhead', 'wanker', 'bollock', 'twat', 'prick', 'pussy', 'whore', 'slut',
  'nigger', 'nigga', 'faggot', 'retard', 'kike', 'chink', 'wetback', 'tranny',
]

/** Fold the usual evasions so the match sees the underlying letters. */
export function normalizeForProfanity(s: string): string {
  return s
    .toLowerCase()
    .split('')
    .map(c => LEET[c] ?? c)
    .join('')
    .replace(/[^a-z]/g, '')       // drop separators, digits that were not leet, punctuation
}

// One pattern per term, with each letter allowed to repeat, so "fuuuck" matches "fuck" while the
// doubled letters in "faggot" / "nigger" still have to be present (keeping "fagot" and "Nigeria"
// clear). Built once at module load.
const BANNED_PATTERNS: readonly RegExp[] = BANNED.map(w =>
  new RegExp(w.split('').map(c => `${c}+`).join('')))

/** Whether the value contains a banned term once its evasions are folded. */
export function containsProfanity(s: string): boolean {
  const n = normalizeForProfanity(s)
  if (!n) return false
  return BANNED_PATTERNS.some(re => re.test(n))
}
