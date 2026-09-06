import { describe, it, expect } from 'vitest'
import { normName, isDamaged, replacementMatch, editDistance, tradeMatch, teamMoveWins, usableEvidence, contestedNames, anonymous } from '../../../supabase/functions/wpbl-ingest/names'

// Player-name reconciliation for the WPBL ingest. The module under test lives with the
// Supabase edge function (which only Deno can load, so it can't be imported here), but the
// matching rules themselves are plain string logic — and they have already cost real data:
// in August 2026 a bad decode upstream forked duplicate roster rows for the two players
// whose names carry an accent.

// What a UTF-8 decoder produces from the feed when the bytes for one accented letter
// arrive damaged: one replacement character per unreadable byte, so two for "ï".
const damage = (name: string, letter: string) => name.replace(letter, '��')

describe('normName', () => {
  it('strips accents and case so the feed spelling matches the roster', () => {
    expect(normName('Maïka Dumais')).toBe('maika dumais')
    expect(normName('Ela Day-Bédard')).toBe('ela day-bedard')
  })

  it('collapses a run of replacement characters to one, however many bytes were lost', () => {
    expect(normName(damage('Maïka Dumais', 'ï'))).toBe('ma�ka dumais')
    expect(normName('Ma���ka Dumais')).toBe('ma�ka dumais')
  })

  it('reports damage only when the name actually carries it', () => {
    expect(isDamaged(normName('Maïka Dumais'))).toBe(false)
    expect(isDamaged(normName(damage('Maïka Dumais', 'ï')))).toBe(true)
  })
})

describe('replacementMatch', () => {
  it('recovers the roster player behind a damaged name', () => {
    expect(replacementMatch(normName(damage('Maïka Dumais', 'ï')), normName('Maïka Dumais'))).toBe(true)
    expect(replacementMatch(normName(damage('Ela Day-Bédard', 'é')), normName('Ela Day-Bédard'))).toBe(true)
  })

  it('will not match two different players', () => {
    // Same team, same first letter, one damaged character — still clearly not them.
    expect(replacementMatch(normName(damage('Maïka Dumais', 'ï')), normName('Maika Dumont'))).toBe(false)
    expect(replacementMatch('ka�e blunt', 'kate bluntson')).toBe(false)
  })

  it('will not match when the damage hid a different number of letters', () => {
    // Length has to line up: one damaged letter, one surviving character on the other side.
    expect(replacementMatch('ma�ka dumais', 'maiika dumais')).toBe(false)
  })

  it('leaves undamaged names to plain equality', () => {
    expect(replacementMatch('maika dumais', 'maika dumais')).toBe(false)
  })
})

describe('editDistance', () => {
  it('still resolves the feed spelling variants it was added for', () => {
    expect(editDistance('villareal', 'villarreal')).toBe(1)
    expect(editDistance('gabriella haas', 'gabrielle haas')).toBe(1)
  })

  it('gives up past the cap instead of merging distant names', () => {
    expect(editDistance('kate blunt', 'katherine blunt')).toBeGreaterThan(1)
  })
})

// ─── trades ───────────────────────────────────────────────────────────────────
// The league feed mints a NEW player_id when a player changes club, and says nothing that
// links the two. On Aug 21, 2026 that turned Diana Ibarra into two players: eight games on
// New York, one on Los Angeles, her name suddenly ambiguous enough that the canonical
// /wpbl/players/diana-ibarra started 404ing and the Discord bot offered a "did you mean"
// list for someone who exists once.
const entry = (id: string, name: string, teamId: string) => ({ id, norm: normName(name), teamId })

describe('tradeMatch', () => {
  const roster = [
    entry('ibarra', 'Diana Ibarra', 'NY'),
    entry('whitmore', 'Kelsie Whitmore', 'SF'),
    entry('dumais', 'Maïka Dumais', 'BOS'),
  ]

  // The id the feed mints for the club she has moved to. A real trade always carries one,
  // which is the whole basis of this rule; see `anonymous`.
  const NEW_ID = '27svefz41ds4k58k'

  it('recognises a player who turns up in another club’s box score', () => {
    expect(tradeMatch(normName('Diana Ibarra'), 'LA', roster, NEW_ID)).toBe('ibarra')
  })

  it('folds accents, so the feed spelling still finds her', () => {
    expect(tradeMatch(normName('Maika Dumais'), 'LA', roster, NEW_ID)).toBe('dumais')
  })

  it('says nothing about a player already on that club — the same-team matchers own that', () => {
    expect(tradeMatch(normName('Diana Ibarra'), 'NY', roster, NEW_ID)).toBeNull()
  })

  it('refuses a shared name rather than guessing which one moved', () => {
    // A wrong merge is silent and permanent; a duplicate is visible in the next roster list.
    const twins = [...roster, entry('ibarra2', 'Diana Ibarra', 'BOS')]
    expect(tradeMatch(normName('Diana Ibarra'), 'LA', twins, NEW_ID)).toBeNull()
  })

  it('refuses a bare surname, which is not evidence of anything', () => {
    expect(tradeMatch(normName('Ibarra'), 'LA', roster, NEW_ID)).toBeNull()
  })

  it('will not reach for a near miss the way the same-team matchers do', () => {
    expect(tradeMatch(normName('Diana Ybarra'), 'LA', roster, NEW_ID)).toBeNull()
    expect(tradeMatch(normName('Diane Ibarra'), 'LA', roster, NEW_ID)).toBeNull()
  })

  it('does nothing without a club, so play-by-play cannot move anyone', () => {
    expect(tradeMatch(normName('Diana Ibarra'), '', roster, NEW_ID)).toBeNull()
  })

  // The rule this whole matcher rests on is that the feed mints a NEW id when somebody changes
  // club. An entry with no id therefore cannot be a trade, and reading it as one is what put
  // Emi Saiki on Los Angeles, a club she has never played a game for, for a day.
  it('refuses an entry the feed gave no id, which cannot be a trade', () => {
    expect(tradeMatch(normName('Diana Ibarra'), 'LA', roster, '')).toBeNull()
    expect(tradeMatch(normName('Diana Ibarra'), 'LA', roster, '   ')).toBeNull()
  })
})

describe('anonymous', () => {
  // Three guards in the ingest read this: an anonymous entry cannot be a trade, cannot move
  // anybody's club, and cannot become a roster row. All three failures are on the record.
  it('is what the feed did not identify', () => {
    expect(anonymous('')).toBe(true)
    expect(anonymous('   ')).toBe(true)
  })

  it('is not an ordinary entry', () => {
    expect(anonymous('i7y6bj0a1i8uwwgu')).toBe(false)
  })
})

describe('teamMoveWins', () => {
  const TODAY = '2026-08-31'
  const ny = { teamId: 'NY', teamAsOf: null as string | null }
  /** A box score for a game that was actually played on `date`. */
  const played = (date: string | null) => ({ date, played: true })

  it('moves a player when a box score puts her somewhere new', () => {
    expect(teamMoveWins(ny, 'LA', played('2026-08-21'), TODAY)).toBe(true)
  })

  it('does not move a player who is already there', () => {
    expect(teamMoveWins({ teamId: 'LA', teamAsOf: '2026-08-21' }, 'LA', played('2026-08-30'), TODAY)).toBe(false)
  })

  it('ignores an older game, so re-reading the season cannot undo a trade', () => {
    // The ingest re-reads old box scores constantly: corrections via `force`, the late
    // TrackMan backfill, mode 'all'. Each one is honest evidence of where she was THEN, and
    // without this guard her club would be whichever game the loop happened to touch last.
    const traded = { teamId: 'LA', teamAsOf: '2026-08-21' }
    expect(teamMoveWins(traded, 'NY', played('2026-07-15'), TODAY)).toBe(false)
    expect(teamMoveWins(traded, 'NY', played('2026-08-21'), TODAY)).toBe(true)   // same day, a doubleheader
    expect(teamMoveWins(traded, 'NY', played('2026-08-25'), TODAY)).toBe(true)   // traded back
  })

  it('will not move anyone off a game with no date', () => {
    expect(teamMoveWins(ny, 'LA', played(null), TODAY)).toBe(false)
  })
})

describe('usableEvidence', () => {
  const TODAY = '2026-08-31'

  it('takes a played game', () => {
    expect(usableEvidence({ date: '2026-08-21', played: true }, TODAY)).toBe(true)
    expect(usableEvidence({ date: TODAY, played: true }, TODAY)).toBe(true)
  })

  it("refuses a game that has not been played, TODAY'S INCLUDED", () => {
    // The regression this is here for. The feed stages a lineup before first pitch, so the
    // one moment a plan is most likely to be read as a result is the afternoon of the game,
    // when the date test cannot tell the two apart. On Sep 3, 2026 a never-played copy of
    // that night's Los Angeles game listed seventeen Boston players and the trade matcher
    // believed all seventeen, leaving Boston's roster page showing a single name.
    expect(usableEvidence({ date: TODAY, played: false }, TODAY)).toBe(false)
    expect(usableEvidence({ date: '2026-08-21', played: false }, TODAY)).toBe(false)
  })

  it('refuses a future game even once it is somehow marked played', () => {
    // `mode: "all"` walks the whole schedule. A floor set weeks ahead blocks every real
    // trade until that date arrives.
    expect(usableEvidence({ date: '2026-09-06', played: true }, TODAY)).toBe(false)
  })

  it('refuses a game with no date', () => {
    expect(usableEvidence({ date: null, played: true }, TODAY)).toBe(false)
  })
})

describe('contestedNames', () => {
  // Sep 3, 2026: the feed listed three players on both rosters of the same game, because it
  // mints a new id per club and both of a traded player's ids stay ACTIVE.
  const bothSides = [
    { club: 'NY', name: 'Natsuki Yonetani' },
    { club: 'NY', name: 'Emi Saiki' },
    { club: 'NY', name: 'Diana Ibarra' },
    { club: 'LA', name: 'Emi Saiki' },
    { club: 'LA', name: 'Diana Ibarra' },
    { club: 'LA', name: 'Ayami Sato' },
  ]

  it('names only the players both sides claim', () => {
    expect(contestedNames(bothSides)).toEqual(new Set(['emi saiki', 'diana ibarra']))
  })

  it('is empty for an ordinary box score', () => {
    expect(contestedNames(bothSides.filter(e => e.club === 'NY')).size).toBe(0)
  })

  it('normalizes, so the two spellings of one name still collide', () => {
    // The feed drops accents on one side often enough that an exact-string check would let
    // the very case this exists for straight through.
    expect(contestedNames([
      { club: 'LA', name: 'Samaria Benitez' },
      { club: 'NY', name: 'Samaria Benítez' },
    ])).toEqual(new Set(['samaria benitez']))
  })

  it('ignores an entry with no club, so an unmapped team cannot contest anything', () => {
    expect(contestedNames([
      { club: '', name: 'Emi Saiki' },
      { club: 'LA', name: 'Emi Saiki' },
    ]).size).toBe(0)
  })

  it('does not flag a player listed twice by the SAME club', () => {
    // A duplicated entry on one roster is a feed hiccup, not a contradiction about her club.
    expect(contestedNames([
      { club: 'LA', name: 'Emi Saiki' },
      { club: 'LA', name: 'Emi Saiki' },
    ]).size).toBe(0)
  })
})
