// What we require of a NEW password, in one place.
//
// WHY THESE RULES AND NOT THE FAMILIAR ONES. The rules everybody recognises, one uppercase,
// one number, one symbol, are the ones current guidance explicitly tells you not to impose
// (NIST SP 800-63B: verifiers "SHALL NOT impose other composition rules"). They were dropped
// because they measurably backfire: told to add a digit and a capital, people produce
// `Password1!`, which satisfies every rule and is among the first things any attacker tries,
// while a genuinely strong passphrase gets rejected for having no punctuation. Composition
// rules move passwords toward a small set of predictable shapes, which is the opposite of what
// they are for.
//
// What the same guidance asks for instead, and what this implements:
//
//   LENGTH is the requirement that actually buys entropy. Eight characters is the floor.
//   A MAXIMUM high enough to never obstruct a passphrase, but see PASSWORD_MAX: ours is a
//   hard technical limit, not a policy choice.
//   A BLOCKLIST, so the passwords that are guessed first are refused however well-formed they
//   look. This is the check that `Password1!` fails and `correct horse battery staple` passes.
//   CONTEXT-SPECIFIC words: an account's own email or username is public, so a password built
//   from one is already half known.
//
// Applied to passwords being CREATED (sign-up, reset, change) and never to one being used to
// sign in. Existing accounts are not held to it: a password set under the old six-character
// minimum keeps working, and its owner is never locked out of their own account by a rule that
// arrived after they chose it.

export const PASSWORD_MIN = 8

/**
 * 72 bytes, and this one is not a policy decision to argue with.
 *
 * Supabase hashes with bcrypt, which reads at most 72 bytes of input. Anything past that is
 * either silently ignored (so a 100-character password is really its first 72, and the
 * remainder is security theatre) or rejected outright, depending on the version. Refusing it
 * here means the reader is told, rather than discovering later that a chunk of what they typed
 * was never part of their password. Counted in BYTES because it is a byte limit: an emoji or
 * an accented character costs more than one.
 */
export const PASSWORD_MAX = 72

/** Bytes, not characters, for the reason given on PASSWORD_MAX. */
export function passwordBytes(pw: string): number {
  return new TextEncoder().encode(pw).length
}

// The passwords guessed first, plus the ones this site invites. A full breach corpus is
// millions of entries and belongs behind an API; this is the head of the distribution, which is
// where the overwhelming majority of real guesses land, and it costs about 2 KB.
//
// Entries are stored bare. `normalForms` below strips the decoration people add to get past
// composition rules, so `password` here also catches `Password1!`, `p@ssw0rd` and `password123`.
const COMMON = new Set([
  'password', 'passwd', 'pass', 'secret', 'letmein', 'welcome', 'admin', 'root', 'login',
  'qwerty', 'qwertyuiop', 'azerty', 'asdf', 'asdfgh', 'asdfghjkl', 'zxcvbn', 'zxcvbnm',
  'abc', 'abcd', 'abcde', 'abcdef', 'abcdefg', 'abcdefgh',
  'iloveyou', 'princess', 'sunshine', 'shadow', 'master', 'monkey', 'dragon', 'football',
  'baseball', 'basketball', 'soccer', 'hockey', 'jordan', 'superman', 'batman', 'pokemon',
  'trustno', 'whatever', 'freedom', 'starwars', 'computer', 'internet', 'samsung', 'google',
  'michael', 'jennifer', 'jessica', 'ashley', 'daniel', 'charlie', 'thomas', 'hunter',
  'summer', 'winter', 'autumn', 'spring', 'flower', 'butterfly', 'chocolate', 'cookie',
  'love', 'lovely', 'family', 'friends', 'forever', 'happy', 'money', 'ninja', 'hello',
  'guest', 'test', 'testing', 'temp', 'changeme', 'default', 'system', 'access', 'private',
  'iloveu', 'nothing', 'purple', 'orange', 'yellow', 'silver', 'golden', 'diamond',
  'liverpool', 'arsenal', 'chelsea', 'barcelona', 'realmadrid', 'juventus',
  // What this particular site puts in people's heads while they are choosing one.
  'sportydolphin', 'dolphin', 'dolphins', 'wpbl', 'mlb', 'stats', 'firebells', 'queens',
  'heights', 'hunters', 'boston', 'losangeles', 'newyork', 'sanfrancisco', 'springfield',
  'homerun', 'strikeout', 'shortstop', 'pitcher', 'catcher', 'ballpark', 'baseballs',
])

const leet = (s: string) => s
  .replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i')
  .replace(/0/g, 'o').replace(/[$5]/g, 's').replace(/7/g, 't')

const trim = (s: string) => s.replace(/^[^a-z0-9]+/, '').replace(/[^a-z]+$/, '')

/**
 * Every form a password might be hiding a blocklisted word in, so one entry covers the whole
 * family it spawns.
 *
 * `Password1!`, `p@ssw0rd` and `Baseball2026` are not different passwords from an attacker's
 * point of view: every cracking tool applies exactly these transformations to a plain wordlist,
 * which is why the blocklist has to apply them too.
 *
 * The two transformations have to be tried in BOTH orders, which is the whole reason this
 * returns a set rather than one string. Substituting first turns `Password1!` into
 * `passwordii`, where the trailing junk is no longer junk and survives the trim; trimming first
 * leaves `p@ssw0rd` unsubstituted. Neither order alone catches both.
 */
function normalForms(pw: string): string[] {
  const lower = pw.toLowerCase()
  return [...new Set([lower, trim(lower), leet(lower), trim(leet(lower)), leet(trim(lower))])]
}

/** Whether the password is a blocklisted word wearing any of its usual disguises. */
function isCommon(pw: string): boolean {
  return normalForms(pw).some(f => COMMON.has(f))
}

/** One character over and over, or a straight run up or down the alphabet or the number row. */
function isTrivialRun(pw: string): boolean {
  const s = pw.toLowerCase()
  if (s.length < 3) return false
  if (/^(.)\1+$/.test(s)) return true
  let up = true, down = true
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1)
    if (d !== 1) up = false
    if (d !== -1) down = false
  }
  return up || down
}

/** The pieces of a person's own identity that must not become their password. */
export interface PasswordContext {
  email?: string | null
  username?: string | null
}

/** Words drawn from the account itself: the email's local part and its domain's name, and the
 *  username. Anything under four characters is dropped, since a three-letter fragment appears
 *  inside perfectly good passwords by chance. */
function contextWords(ctx: PasswordContext | undefined): string[] {
  if (!ctx) return []
  const out: string[] = []
  const local = ctx.email?.split('@')[0]
  const domain = ctx.email?.split('@')[1]?.split('.')[0]
  for (const raw of [local, domain, ctx.username]) {
    if (!raw) continue
    // Split on separators too: someone called `jo.smith` should not get `smith` through.
    for (const part of raw.toLowerCase().split(/[^a-z0-9]+/)) {
      if (part.length >= 4) out.push(part)
    }
  }
  return out
}

export interface PasswordCheck {
  /** Shown as a live list under the field. */
  label: string
  ok: boolean
}

/**
 * The requirements as a checklist, for showing under the input as it is typed.
 *
 * Every item is phrased as the thing that must be TRUE, so a reader can see what is left rather
 * than being told off once they submit. An empty password fails everything, which is what makes
 * the list read as instructions on first sight.
 */
export function passwordChecklist(pw: string, ctx?: PasswordContext): PasswordCheck[] {
  const words = contextWords(ctx)
  const lower = pw.toLowerCase()
  const list: PasswordCheck[] = [
    { label: `At least ${PASSWORD_MIN} characters`, ok: pw.length >= PASSWORD_MIN },
    {
      label: 'Not a common or easily guessed password',
      ok: pw.length > 0 && !isCommon(pw) && !isTrivialRun(pw),
    },
  ]
  // Only worth a line when there is something to collide with.
  if (words.length) {
    list.push({
      label: 'Does not reuse your email or username',
      ok: pw.length > 0 && !words.some(w => lower.includes(w)),
    })
  }
  return list
}

/**
 * The first thing wrong with this password, or null if it is acceptable.
 *
 * Returns ONE problem rather than all of them: the list under the field already shows the full
 * picture, and this is for the moment of submission, where a stack of complaints is harder to
 * act on than the next thing to fix.
 */
export function passwordProblem(pw: string, ctx?: PasswordContext): string | null {
  if (pw.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`
  // Checked before the blocklist so a 200-character passphrase is told the real reason.
  if (passwordBytes(pw) > PASSWORD_MAX) {
    return `Password is too long. The limit is ${PASSWORD_MAX} characters (a few less if you use emoji or accents).`
  }
  if (isTrivialRun(pw)) return 'That is a straight run of characters. Pick something less predictable.'
  if (isCommon(pw)) return 'That is one of the most commonly used passwords. Pick something else.'
  const hit = contextWords(ctx).find(w => pw.toLowerCase().includes(w))
  if (hit) return 'Your password should not contain your email address or username.'
  return null
}
