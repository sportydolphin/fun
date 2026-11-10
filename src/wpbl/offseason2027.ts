// The road to the 2027 rosters, as the league laid it out on Nov 9, 2026 in its "2027 WPBL Roster
// Composition Explainer". Everything here is what that post says; nothing is inferred.
//
// THE 2026 ROSTERS ARE THE LEAGUE'S LIST, NOT OURS. A club may re-sign only from its 2026 roster, and
// the post names all 70 players. Our own `wpbl_players` cannot stand in for it: its `status` column
// says "Signed" for 60 of them and "Drafted" for players the league counts as rostered, and its
// `team_id` is "now", which the first re-signing elsewhere would move. So the list is pinned here by
// player id, matched by name on Nov 9 (three under their full first names: Gabrielle Haas, Valerie
// Perez and Caitlin Eynon, listed by the league as Gabbie, Val and Caitlyn). It never changes: it is
// the 2026 roster as it stood when the window opened.
//
// No date beyond the window's is here, because none is published: the draft, the combine and free
// agency have no dates yet (memory: next season, confirmed only).

import type { WpblRosterMove } from './types'

export const ROSTER_SEASON = 2027

/** How many of its 2026 players a club may keep. */
export const MAX_RESIGNED = 10

/** The 2027 roster size: up to 10 re-signed, 10 drafted, the rest from free agency. */
export const ROSTER_SIZE = 20

/** Nov 9, 9:00 a.m. ET to Nov 20, 11:59 p.m. ET (both EST, UTC-5). */
export const RESIGN_WINDOW = {
  opens: Date.parse('2026-11-09T14:00:00Z'),
  closes: Date.parse('2026-11-21T04:59:59Z'),
} as const

export const ROSTER_EXPLAINER_URL =
  'https://www.womensprobaseballleague.com/2026/11/09/2027-wpbl-roster-composition-explainer/'

/** The 2027 draft order, every round (a linear draft): Boston, New York, San Francisco, Los Angeles. */
export const DRAFT_ORDER_2027 = ['BOS', 'NY', 'SF', 'LA'] as const

/** The four clubs as the explainer names them: the card titles from the first paint, before the
 *  clubs read lands, so a title never changes under the reader. */
export const CLUB_NAMES_2026: Readonly<Record<string, string>> = {
  BOS: 'Boston Hunters', NY: 'New York Heights', SF: 'San Francisco Firebells', LA: 'Los Angeles Queens',
}

/** Each club's 2026 roster, in the order the league listed it. Keyed by `wpbl_teams.id`. */
export const ROSTERS_2026: Readonly<Record<string, readonly string[]>> = {
  BOS: [
    'bede0e76-5f3b-481f-8970-27c87100cf92', // Hyeonah Kim
    'fcd8d5a1-1c4b-4b67-9ad9-c7ba7c55b767', // Alli Schroder
    '4b51c3fa-02a9-42ad-bde9-15cb993b74d3', // Raine Padgham
    '8d2247b5-dc50-42c5-9397-0a75bb7aec94', // Lexi Hastings
    '8d6f2f81-c06b-4ba4-a567-4c6f92b1d049', // Kate Blunt
    '0804b1b9-5e38-46e3-a315-84f346728810', // Denver Bryant
    '9c5549a7-9f10-4278-a84d-81fb6e80cb86', // Ticara Geldenhuis
    'a278e279-9e77-448d-b3a1-6284930434d6', // Suzuka Yamamoto
    '92d4e669-c64f-4f91-8782-498de8167a0a', // Maïka Dumais
    'bfbf0385-a657-403a-bb55-39c621480945', // Gigi Schiano
    '4711afcf-b100-4a1b-9d61-68ea705ebb91', // Maria José Valenzuela
    '18019f8d-ab94-4907-ae5b-2b45c7aeb379', // Molly Paddison
    'f14902db-382c-4eb0-8c27-b85bcb30e083', // Beth Greenwood
    '07a2c53e-55ad-43f7-a8f2-a2348e9184e8', // Sabrina Robinson
    'a1e5b560-edad-45f1-9416-d1a9675f0253', // Gabrielle Haas
    '1cee2f7f-4db1-4972-9ffc-477954c7eab3', // Paloma Benach
    '44bab7d0-a089-4b49-ab40-cbcf3254e579', // Edith De Leija
    '9b34b6d6-ecb4-4ece-9f71-8ee14b24d8c5', // Olivia Bricker
  ],
  NY: [
    '183f0df8-1a02-46a4-84c5-90f54638cab8', // Kylee Lahners
    '1142dad3-3520-48f2-94ea-78346f4d177c', // Denae Benites
    '0d5608f1-e966-4c4d-b495-5f770792cf21', // Rakyung Kim
    '69a50af7-c4ed-4758-b2e6-cceaf9d83473', // Valerie Perez
    '0e35359f-568d-476c-958e-b064e207f98d', // Jaida Lee
    '5d6c54f5-fc55-466a-a998-6de6a71069d7', // London Studer
    '3d9e02a6-e25d-45d6-a1bb-dec4ed8ae238', // Keira Izumi
    '2f152cdb-59b0-4174-954a-33fcf0ca635e', // Emi Saiki
    'c677026f-8113-4481-becc-13995c2a56de', // Natsuki Yonetani
    'ff1f001e-32ac-442d-b3aa-6bde77fec86c', // Alyssa Zettlemoyer
    'e7e6d277-d3cc-4e63-a4b2-f1e487271cd6', // Madison Willan
    'dbc25b77-a599-4435-938a-98771be94a95', // Claire Eccles
    'c2c0093d-4394-48a7-9cca-e2fd2b82133b', // Suzu Narasaki
    'ed10bc24-6e46-4baf-a2d0-9d97f61c7c6a', // Elodie Ciamarro
    '1c2e91cc-34d5-4e55-af10-dea215382ac0', // Jacqui Reynolds
    'ea0925c9-1c81-44e5-9c86-fe0f12650161', // Claire O'Sullivan
    '0d680c54-82ac-47e9-ae0d-e7fef2947800', // Katherine Murphy
  ],
  LA: [
    '4d34311c-b7d6-44da-9614-b5ad954ddc59', // Ayami Sato
    '030a471e-8821-481c-a1e1-aa3f3789e46e', // Ashton Lansdell
    '288b2108-b1c2-4185-b108-3dc838aae072', // Mo'ne Davis
    'bcdea34a-c9f1-41c6-b9f8-66360cb33bee', // Meggie Meidlinger
    'c48feb41-9526-460a-8f4f-ae5ac4f708fe', // Thaima Maximiliana
    '4939d32c-ba47-4586-b224-e658c5ac2309', // Jamie Mackay
    '75339f9c-e932-4af0-ae61-faf032be0cc1', // Samaria Benítez
    '8b3b62b9-067c-4491-bf0a-296604f24e53', // Maggie Foxx
    'b086f8bc-b388-43fd-8fdf-a2aec9a461ed', // Michelle Roche
    '53604e8c-0c0c-4ea8-b531-a4a6035754d6', // Caitlin Eynon
    'aa131d4c-e81a-4fe5-b497-3d317b4e9200', // Sarah Edwards
    '7254031e-8d7b-4383-abac-38b93d9367db', // Diana Ibarra
    '943cf741-2671-4b65-a425-4db63511e0d8', // Brittany Apgar
    '6d7b3ded-045e-4e4e-8028-5c52f68b4e7c', // Amira Hondras
    '8e089c3d-fb97-4c6c-a67e-03007a6e4110', // Isabella Villarreal
    '47f9e26e-902a-4417-9863-8475342d8361', // Ayuri Shimano
    'e26bb4c3-b408-4780-bbe9-5a775703c063', // Adelaide Frank
    '2b20ed64-3b05-486c-b10d-d46a69d20c60', // Addisyn Baird
  ],
  SF: [
    '4e6a118d-d3ab-485c-bedf-20c6446d7aa6', // Kelsie Whitmore
    'e3fd76c1-cb78-49dd-aaa6-6539de34fb5e', // Amanda Gianelloni
    'a3e2fed6-6ce7-497e-9a75-00890c296473', // Joely Leguizamon
    '62eacc29-4f39-47a9-813a-2af511d966da', // Jill Albayati
    '714e2edf-ecb8-4093-a2bb-acd7e162a1a7', // Samantha Gutierrez
    '86d64944-a010-49ec-9d52-b6e0bce342f3', // Ayaka Yamamoto
    'e0b033fd-7a99-4f4a-bfb4-fdb08ef02fa4', // Niki Eckert
    'd7cbd347-2d86-4475-9795-e7cba7c41048', // Andréanne Leblanc
    '7c45753e-a682-4cad-b5ae-78d9321a9bc8', // Jua Park
    '9e22846e-a73a-4202-a359-1a71138c5105', // Alexia Jorge
    '8864bf37-ab58-48df-964e-3d6a5f0322d5', // Ela Day-Bédard
    'e824584c-dc60-4bff-a5f2-55592016bbe4', // Rosi del Castillo
    '5bec741f-1040-413f-845d-797eb267bda7', // Liz Gilder
    '2b5cf290-d11d-4676-8a67-38c74aa3ba52', // Skylar Kaplan
    'c506e491-dad8-4f43-b380-0140029fccfe', // Hinano Beppu
    '1d724ef6-4fab-486e-9ad8-34cef2ecf09d', // Jordan Eyster
    '0fa7be6b-989e-44fd-ad0a-ddd50845a6d0', // Peyton Coria
  ],
}

/** Which club a player was on in 2026, by the league's list. */
export function club2026(playerId: string): string | null {
  for (const [team, ids] of Object.entries(ROSTERS_2026)) if (ids.includes(playerId)) return team
  return null
}

export type WindowPhase = 'before' | 'open' | 'closed'

export function resignPhase(now: number): WindowPhase {
  if (now < RESIGN_WINDOW.opens) return 'before'
  return now <= RESIGN_WINDOW.closes ? 'open' : 'closed'
}

/** "Nov 20", in the league's own time zone for the window (ET). */
function windowDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
}

/** The window as one label, for the rosters page and Home's card. Here rather than in RostersPage so
 *  Home can say it without pulling in that page's chunk. */
export function windowLine(now: number): string {
  const phase = resignPhase(now)
  const span = `${windowDate(RESIGN_WINDOW.opens)} to ${windowDate(RESIGN_WINDOW.closes)}`
  if (phase === 'before') return `Re-signing window: ${span}`
  if (phase === 'open') return `Re-signing window open: ${span}`
  return `Re-signing window closed ${windowDate(RESIGN_WINDOW.closes)}`
}

export interface ClubBoard {
  teamId: string
  /** Re-signed, newest announcement first. */
  resigned: { playerId: string; move: WpblRosterMove }[]
  /** The rest of the 2026 roster, in the league's order. After the window these are draft-eligible. */
  unsigned: string[]
}

/**
 * Each club's re-signings against its 2026 roster. A move for a player not on that club's 2026 list
 * is ignored here rather than shown: a re-signing can only be of the club's own player, so one that
 * is not is a data-entry slip, and the admin form is where it shows.
 */
export function rosterBoards(moves: readonly WpblRosterMove[]): ClubBoard[] {
  const resignings = moves.filter(m => m.season === ROSTER_SEASON && m.kind === 're-signed' && m.player_id)
  return DRAFT_ORDER_2027.map(teamId => {
    const roster = ROSTERS_2026[teamId] ?? []
    const mine = resignings
      .filter(m => m.team_id === teamId && roster.includes(m.player_id!))
      .sort((a, b) => b.announced_on.localeCompare(a.announced_on) || b.id - a.id)
    const kept = new Set(mine.map(m => m.player_id!))
    return {
      teamId,
      resigned: mine.map(m => ({ playerId: m.player_id!, move: m })),
      unsigned: roster.filter(id => !kept.has(id)),
    }
  })
}

/** A player's 2027 status line, for the player page: null when there is nothing to say. */
export function rosterStatus(playerId: string, moves: readonly WpblRosterMove[], now: number):
  { kind: 're-signed'; teamId: string; move: WpblRosterMove } | { kind: 'unsigned' | 'draft-eligible'; teamId: string } | null {
  const team = club2026(playerId)
  if (!team) return null
  const move = moves.find(m => m.season === ROSTER_SEASON && m.kind === 're-signed' && m.player_id === playerId && m.team_id === team)
  if (move) return { kind: 're-signed', teamId: team, move }
  const phase = resignPhase(now)
  if (phase === 'before') return null
  return { kind: phase === 'open' ? 'unsigned' : 'draft-eligible', teamId: team }
}
