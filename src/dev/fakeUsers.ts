import type { AdminUser, AdminUserDetail, SiteRole } from '../lib/adminUsers'

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

const ACTIONS = [
  'wpbl_tab_viewed', 'wpbl_player_opened', 'wpbl_stats_board', 'wpbl_stats_sorted',
  'game_center_opened', 'wpbl_bracket_shown', 'wpbl_mvp_shown', 'wpbl_team_opened',
  'wpbl_searched', 'board_viewed', 'wpbl_pickem_shown', 'wpbl_shelf_segment',
]
const VIEWS  = ['home', 'stats', 'schedule', 'standings', 'teams']
const NAMES  = ['Kelsie Whitmore', 'Ayami Sato', "Mo'ne Davis", 'Claire Eccles', 'Alex Hugo']
const MISSES = ['knuckleball', 'attendance', 'trade deadline', 'era leaders 2025']

/**
 * One spoofed person's detail, derived from their spoofed roster row.
 *
 * DERIVED, NOT INDEPENDENT: the window total, the active days and the WPBL/MLB split all come
 * off the row the panel is already showing, so the sheet cannot contradict the table it was
 * opened from. A generator that invented both halves separately would look fine and hide
 * exactly the bug worth catching here, which is the two disagreeing.
 */
export function makeFakeDetail(u: AdminUser, days = 30): AdminUserDetail {
  // Seeded off the account so one person's sheet is the same every time it is opened.
  const r = rng(Number(u.user_id.replace(/\D/g, '').slice(-8)) || 7)
  const now = Date.now()
  const day = 86_400_000
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString()

  // Spread the row's own event total over its own active days, so the two agree.
  const series = Array.from({ length: days }, (_, i) => ({
    date: new Date(now - (days - 1 - i) * day).toISOString().slice(0, 10),
    events: 0,
  }))
  let left = u.events
  for (let i = 0; i < u.active_days && left > 0; i++) {
    const at = Math.floor(r() * days)
    const take = i === u.active_days - 1 ? left : Math.ceil(left * (0.2 + r() * 0.5))
    series[at].events += take
    left -= take
  }

  const share = (n: number, frac: number) => Math.max(1, Math.round(n * frac))
  const nActions = u.events ? 4 + Math.floor(r() * 6) : 0

  return {
    days_back: days,
    series,
    events_window: u.events,
    active_days:   u.active_days,
    browsers:      u.events ? 1 + Math.floor(r() * 2) : 0,
    first_seen:    u.events ? u.created_at : null,
    last_seen:     u.last_seen,
    lifetime_events: u.events,
    actions: Array.from({ length: nActions }, (_, i) => ({
      event: ACTIONS[i % ACTIONS.length],
      n: share(u.events, 0.3 / (i + 1)),
      last: iso(Math.floor(r() * 12 * day)),
    })),
    views: u.wpbl_events ? VIEWS.slice(0, 2 + Math.floor(r() * 4)).map((view, i) => ({
      view, n: share(u.wpbl_events, 0.15 / (i + 1)),
    })) : [],
    paths: [
      ...(u.wpbl_events ? [{ path: '/wpbl', n: share(u.wpbl_events, 0.8) }] : []),
      ...(u.mlb_events  ? [{ path: '/mlb',  n: share(u.mlb_events, 0.9) }] : []),
    ],
    players: u.wpbl_events > 20 ? NAMES.slice(0, 2 + Math.floor(r() * 3)).map((name, i) => ({
      player_id: `fake-${i}`, name, team_id: CLUBS[i % CLUBS.length], n: 5 - i,
    })) : [],
    teams: u.wpbl_events > 20 ? CLUBS.slice(0, 1 + Math.floor(r() * 3)).map((id, i) => ({
      team_id: id, name: `Club ${id}`, n: 9 - i * 3,
    })) : [],
    misses: r() < 0.35 ? MISSES.slice(0, 1 + Math.floor(r() * 3)).map(q => ({ q, n: 1 })) : [],
    feedback: u.feedback ? Array.from({ length: u.feedback }, (_, i) => ({
      created_at: iso((3 + i * 9) * day),
      message: 'The standings table wraps on my phone in landscape, and the GB column ends up under the club name. Otherwise this is great, thank you for building it.',
      path: '/wpbl/standings',
      handled: i > 0,
    })) : [],
    picks: u.series_picks ? Array.from({ length: u.series_picks }, (_, i) => ({
      category: `pickem:2026:${['semifinal:A', 'semifinal:B', 'championship'][i % 3]}`,
      choice: `${CLUBS[i % CLUBS.length]}:2-1`,
      at: iso((1 + i) * day),
    })) : [],
    reminders: u.game_reminders ? Array.from({ length: u.game_reminders }, (_, i) => ({
      game_id: `g-${i}`,
      game_date: new Date(now + (i + 1) * day).toISOString().slice(0, 10),
      home: CLUBS[i % CLUBS.length], away: CLUBS[(i + 1) % CLUBS.length],
    })) : [],
  }
}
