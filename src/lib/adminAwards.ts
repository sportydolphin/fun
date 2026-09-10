import { supabase } from './supabase'
import { WPBL_AWARDS, WPBL_MANAGERS, FAN_VOTE_IDS } from '../wpbl/awards'
import { parsePickChoice, seriesPickCategory } from '../wpbl/derive/seriesPicks'
import { WPBL_TEAMS } from '../wpbl/constants'
import type { WpblPlayer } from '../wpbl/types'

/**
 * The owner's view of the fan-award ballot, and of the pick'em that shares its table.
 *
 * WHY THIS IS NOT THE PUBLIC TALLY WITH A NICER FONT. `wpbl_award_results` aggregates, which
 * is the right thing to publish and cannot answer the questions an owner has: how many PEOPLE
 * have voted (a tally counts answers, and one person answering five categories is five of
 * them), how many finished the sheet, when the answers arrived, and what the write-ins say.
 * `admin_wpbl_award_votes` returns one row per vote for that, owner-guarded, and deliberately
 * without the voter keys: see the migration for why a panel must never hold those.
 *
 * PURE BELOW THE FETCH. Everything that turns rows into a report takes its inputs and returns
 * plain shapes, so the labelling rules (which are the part that rots, since a choice is a uuid
 * or a `mgr:` key or a `TEAM:2-1`) are testable without a database or a screen.
 */

/** One vote, as the RPC hands it over. `voter` is a stable hash, never the key itself. */
export interface AdminAwardVote {
  category: string
  choice: string
  voter: string
  voted_at: string
}

export async function fetchAdminAwardVotes(): Promise<AdminAwardVote[]> {
  const { data, error } = await supabase.rpc('admin_wpbl_award_votes')
  if (error) throw new Error(error.message)
  return (data ?? []) as AdminAwardVote[]
}

// ─── What a stored choice is called ─────────────────────────────────────────────

/**
 * A choice key as something a person can read.
 *
 * FOUR SHAPES SHARE THIS COLUMN, because two features share the table: a player id (a uuid), a
 * manager's permanent `mgr:<slug>`, a pick'em's `TEAM:wins-losses`, and a play's
 * `<gameId>:<sequence>`. Nothing in the row says which, so this asks in the order that cannot
 * collide: the two prefixed forms first, then the roster, and whatever is left is printed raw
 * rather than guessed at. An unrecognised key is a real answer somebody gave and belongs on
 * screen: hiding it would make the panel disagree with its own totals.
 */
export function awardChoiceLabel(choice: string, players: readonly WpblPlayer[]): string {
  const manager = WPBL_MANAGERS.find(m => m.key === choice)
  if (manager) return manager.fullName ?? manager.name

  const pick = parsePickChoice(choice)
  if (pick) {
    const team = WPBL_TEAMS[pick.teamId]
    return `${team ? team.name : pick.teamId} in ${pick.wins + pick.losses}`
  }

  const player = players.find(p => p.id === choice)
  if (player) return player.name

  return choice
}

/** The club to badge a choice with, where it has one. Null for a play, a game, or a name the
 *  roster no longer carries. */
export function awardChoiceTeam(choice: string, players: readonly WpblPlayer[]): string | null {
  const manager = WPBL_MANAGERS.find(m => m.key === choice)
  if (manager) return manager.teamId
  const pick = parsePickChoice(choice)
  if (pick) return WPBL_TEAMS[pick.teamId] ? pick.teamId : null
  return players.find(p => p.id === choice)?.team_id ?? null
}

/** A category id as its question. The pick'em's three are built rather than listed, so a round
 *  the bracket adds is named here without anything being edited. */
export function awardCategoryLabel(category: string): string {
  const award = WPBL_AWARDS.find(a => a.id === category)
  if (award) return award.title
  if (category === seriesPickCategory('championship', null)) return "Pick'em: the final"
  for (const key of ['A', 'B']) {
    if (category === seriesPickCategory('semifinal', key)) return `Pick'em: semifinal ${key}`
  }
  return category
}

// ─── The report ─────────────────────────────────────────────────────────────────

export interface AdminAwardChoice {
  choice: string
  votes: number
  /** Of this category's votes, not of all voters. */
  share: number
}

export interface AdminAwardCategory {
  category: string
  label: string
  votes: number
  choices: AdminAwardChoice[]
}

/**
 * The table holds two features, and mixing them made the headline lie.
 *
 * The first version of this panel counted every row in `wpbl_award_votes` and reported "72
 * voters, 209 votes cast" over a fan-award ballot that had been open for an afternoon. Both
 * numbers were true and neither was about the awards: 185 of those votes were bracket picks,
 * which have lived in this table since the pick'em shipped and outnumber the ballot roughly
 * six to one. A panel titled Fan awards that answers with the pick'em's traffic is worse than
 * one that answers with nothing.
 *
 * SO THE GROUPS ARE THE STRUCTURE, and the headline belongs to exactly one of them. The
 * pick'em is still here, because it is the same reader answering a related question and an
 * owner may well want it, but it is counted on its own line and never folded into the ballot's.
 */
export type AdminAwardGroupKey = 'card' | 'pickem' | 'other'

export interface AdminAwardGroup {
  key: AdminAwardGroupKey
  label: string
  /** People who answered at least one question in this group. */
  voters: number
  votes: number
  categories: AdminAwardCategory[]
}

/** The fan-award ballot itself: the five the card asks and nothing else. Every number in the
 *  panel's headline comes from here. */
export interface AdminAwardHeadline {
  voters: number
  votes: number
  /** Answered all five. */
  completed: number
  latest: string | null
  /** Voters by how many of the five they answered, index 0 unused. */
  byAnswered: number[]
}

export interface AdminAwardReport {
  headline: AdminAwardHeadline
  groups: AdminAwardGroup[]
}

const groupOf = (category: string): AdminAwardGroupKey =>
  (FAN_VOTE_IDS as readonly string[]).includes(category) ? 'card'
    : category.startsWith('pickem:') ? 'pickem'
      : 'other'

const GROUP_LABEL: Record<AdminAwardGroupKey, string> = {
  card: 'The ballot',
  // Named for what it is rather than hidden: these are real answers from the same readers, they
  // simply are not the awards. See the note above.
  pickem: "Postseason pick'em",
  // The eight categories that are defined and unasked. Normally empty, and worth a heading the
  // day it is not: a vote here means somebody reached an id the card does not offer.
  other: 'Other categories',
}

export function buildAdminAwardReport(votes: readonly AdminAwardVote[]): AdminAwardReport {
  const byCategory = new Map<string, Map<string, number>>()
  const votersByGroup = new Map<AdminAwardGroupKey, Set<string>>()
  const votesByGroup = new Map<AdminAwardGroupKey, number>()
  const answeredOnCard = new Map<string, number>()
  const card = new Set<string>(FAN_VOTE_IDS)
  let cardVotes = 0
  let latest: string | null = null

  for (const v of votes) {
    const bucket = byCategory.get(v.category) ?? new Map<string, number>()
    bucket.set(v.choice, (bucket.get(v.choice) ?? 0) + 1)
    byCategory.set(v.category, bucket)

    const group = groupOf(v.category)
    const seen = votersByGroup.get(group) ?? new Set<string>()
    seen.add(v.voter)
    votersByGroup.set(group, seen)
    votesByGroup.set(group, (votesByGroup.get(group) ?? 0) + 1)

    if (card.has(v.category)) {
      answeredOnCard.set(v.voter, (answeredOnCard.get(v.voter) ?? 0) + 1)
      cardVotes += 1
      // The freshest BALLOT vote, not the freshest row: a pick'em answer arriving after the
      // ballot went quiet would otherwise read as the ballot still being live.
      if (!latest || v.voted_at > latest) latest = v.voted_at
    }
  }

  const category = (name: string): AdminAwardCategory => {
    const bucket = byCategory.get(name)!
    const total = [...bucket.values()].reduce((x, y) => x + y, 0)
    return {
      category: name,
      label: awardCategoryLabel(name),
      votes: total,
      choices: [...bucket.entries()]
        .map(([choice, count]) => ({ choice, votes: count, share: total ? count / total : 0 }))
        // Most-voted first, ties broken by the key so the list does not reshuffle between reads
        // of the same data.
        .sort((x, y) => y.votes - x.votes || x.choice.localeCompare(y.choice)),
    }
  }

  const cardOrder = (id: string) => FAN_VOTE_IDS.indexOf(id as typeof FAN_VOTE_IDS[number])
  const groups: AdminAwardGroup[] = (['card', 'pickem', 'other'] as AdminAwardGroupKey[])
    .map(key => {
      const names = [...byCategory.keys()].filter(n => groupOf(n) === key)
      // The card asks its five in an order, and that order is the sheet a reader saw. Everything
      // else sorts by size, since nothing about it is a sequence.
      names.sort((x, y) => key === 'card'
        ? cardOrder(x) - cardOrder(y)
        : (byCategory.get(y)!.size - byCategory.get(x)!.size) || x.localeCompare(y))
      return {
        key,
        label: GROUP_LABEL[key],
        voters: votersByGroup.get(key)?.size ?? 0,
        votes: votesByGroup.get(key) ?? 0,
        categories: names.map(category),
      }
    })
    .filter(g => g.categories.length > 0)

  const byAnswered = Array(card.size + 1).fill(0) as number[]
  for (const n of answeredOnCard.values()) byAnswered[Math.min(n, card.size)] += 1

  return {
    headline: {
      voters: answeredOnCard.size,
      votes: cardVotes,
      completed: byAnswered[card.size] ?? 0,
      latest,
      byAnswered,
    },
    groups,
  }
}
