import { rosterBoards, heldPlayers, CLUB_CITIES } from './offseason2027'
import type { WpblPlayer, WpblRosterMove } from './types'

// Who /admin's move form offers, apart from the form so the rule is tested without drawing it.

export type Kind = 'drafted' | 'signed' | 'released'

export interface Choice { key: string; playerId: string | null; name: string; label: string }

/** Who a club can make this move with. A club's own unsigned picks lead its signings. */
export function moveChoices(
  kind: Kind, club: string, moves: readonly WpblRosterMove[], players: readonly WpblPlayer[],
): Choice[] {
  const boards = rosterBoards(moves)
  const byId = new Map(players.map(p => [p.id, p]))
  const draftedBy = new Map(boards.flatMap(b => b.drafted.map(p => [p.key, b.teamId] as const)))
  const all = new Map<string, Choice>()
  const add = (key: string, playerId: string | null, name: string) => {
    const by = draftedBy.get(key)
    all.set(key, { key, playerId, name, label: by ? `${name} (drafted by ${CLUB_CITIES[by] ?? by})` : name })
  }
  for (const p of players) add(p.id, p.id, p.name)
  for (const b of boards) {
    for (const p of [...b.kept, ...b.drafted, ...b.signed, ...b.released]) {
      add(p.key, p.playerId, (p.playerId ? byId.get(p.playerId)?.name : p.name) ?? p.key)
    }
  }
  const held = heldPlayers(moves)
  const allowed = [...all.values()].filter(c => kind === 'released' ? held.get(c.key) === club
    : kind === 'signed' ? !held.has(c.key) || draftedBy.has(c.key)
      : !held.has(c.key))
  const first = (c: Choice) => (kind === 'signed' && draftedBy.get(c.key) === club ? 0 : 1)
  return allowed.sort((a, b) => first(a) - first(b) || a.name.localeCompare(b.name))
}
