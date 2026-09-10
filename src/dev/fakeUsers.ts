import type { AdminUser, SiteRole } from '../lib/adminUsers'

// A spoofed roster for looking at the Users panel.
//
// WHY THIS EXISTS AT ALL. /admin is behind the owner gate, so the panel cannot be checked by
// opening a browser as an ordinary reader, and the one thing it has to get right (a table
// that stays legible at 150 rows on a desktop and collapses to something readable on a phone)
// is exactly the thing no unit test can see. The alternative was to develop it against the
// real roster, which means the real people, their real email addresses and their real
// notification settings sitting on screen through every layout tweak. This costs nothing and
// keeps them out of it.
//
// DEV ONLY, and gated twice: `import.meta.env.DEV` at the call site plus a localStorage flag
// the panel reads, so it cannot switch itself on. Nothing imports this from production code.
//
// SEEDED, NOT RANDOM. A layout bug that only appears for one unlucky name is worth being able
// to reproduce, and a panel that reshuffles on every hot reload makes "did that change?"
// unanswerable. Same seed, same 150 people, every time.

const FIRST = [
  'Ada', 'Bex', 'Cleo', 'Dana', 'Effie', 'Fran', 'Greta', 'Hana', 'Immy', 'Jules',
  'Kit', 'Lark', 'Mina', 'Nell', 'Ori', 'Pia', 'Quill', 'Rue', 'Sana', 'Tess',
  'Uma', 'Vee', 'Wren', 'Xia', 'Yuki', 'Zaid',
]
const LAST = [
  'ashby', 'brenner', 'caldwell', 'devlin', 'ellery', 'fenwick', 'gallo', 'hollis',
  'ivory', 'jarrow', 'kessler', 'lombard', 'marsh', 'nyland', 'okafor', 'pratt',
  'quinby', 'rowan', 'sable', 'thorne', 'ulrich', 'vance', 'whitlock', 'yarrow',
]
const CLUBS = ['SF', 'LA', 'NY', 'BOS']

/** Mulberry32, a small deterministic PRNG. Any seeded generator would do; this one is four lines. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * `n` fake accounts, shaped like the real ones.
 *
 * The distribution is the point, not the names: most accounts are quiet and WPBL-only, a few
 * are heavy, a handful never came back after signing up, one is deactivated and two hold
 * roles. A generator that made everyone equally busy would hide every case the panel exists
 * to show.
 */
export function makeFakeUsers(n = 150, seed = 20260909): AdminUser[] {
  const r = rng(seed)
  const now = Date.now()
  const day = 86_400_000
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString()

  return Array.from({ length: n }, (_, i) => {
    const first = FIRST[Math.floor(r() * FIRST.length)]
    const last  = LAST[Math.floor(r() * LAST.length)]
    const username = `${first.toLowerCase()}${r() < 0.4 ? '_' : ''}${last}`.slice(0, 20)

    const joinedAgo = Math.floor(r() * 40 * day)
    // A long tail: most accounts fire a handful of events, a few fire hundreds.
    const heat   = r() ** 3
    const events = Math.round(heat * 600)
    // A fifth never came back after the visit they signed up on.
    const dormant = r() < 0.2
    const wpblShare = 0.55 + r() * 0.45
    const wpbl = Math.round(events * wpblShare)

    const push = r() < 0.35 ? 1 + Math.floor(r() * 2) : 0
    const roles: Array<{ role: SiteRole; note: string | null }> =
      i === 3 ? [{ role: 'collaborator', note: 'Suggested the fan awards' }]
        : i === 17 ? [{ role: 'moderator', note: 'Discord' }] : []

    const predicts = r() < 0.25 ? 10 + Math.floor(r() * 200) : 0

    return {
      user_id:    `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      username,
      created_at: iso(joinedAgo),
      is_deleted: i === 42,
      deleted_at: i === 42 ? iso(2 * day) : null,

      email:        `${username}@example.dev`,
      provider:     r() < 0.6 ? 'google' : 'email',
      confirmed:    r() > 0.05,
      last_sign_in: iso(Math.floor(r() * joinedAgo)),

      events:      dormant ? 0 : events,
      active_days: dormant ? 0 : Math.min(30, 1 + Math.round(heat * 25)),
      wpbl_events: dormant ? 0 : wpbl,
      mlb_events:  dormant ? 0 : events - wpbl,
      last_seen:   dormant ? iso(joinedAgo) : iso(Math.floor(r() * 20 * day)),

      favorite_team:     r() < 0.45 ? CLUBS[Math.floor(r() * CLUBS.length)] : null,
      notify_wpbl_all:   push > 0 && r() < 0.5,
      notify_game_start: push > 0 && r() < 0.4,
      notify_picks:      push > 0 && r() < 0.2,
      push_devices:      push,
      game_reminders:    r() < 0.15 ? 1 + Math.floor(r() * 4) : 0,
      series_picks:      r() < 0.2 ? 1 + Math.floor(r() * 3) : 0,
      feedback:          r() < 0.08 ? 1 + Math.floor(r() * 2) : 0,

      roles,

      predictions: predicts || null,
      correct:     predicts ? Math.round(predicts * (0.4 + r() * 0.25)) : null,
      accuracy:    predicts ? Math.round((0.4 + r() * 0.25) * 100) : null,
    }
  })
}
