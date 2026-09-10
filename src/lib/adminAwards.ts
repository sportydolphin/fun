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
  /** True for the five the fan-vote card actually asks, which is what an owner is looking at
   *  when they open this; everything else in the table sorts below them. */
  onTheCard: boolean
}

export interface AdminAwardReport {
  categories: AdminAwardCategory[]
  /** People, not answers. The distinction this whole RPC exists for. */
  voters: number
  votes: number
  /** How many voters have answered all five of the fan-vote categories. */
  completed: number
  /** Most recent vote, ISO, or null when nobody has voted at all. */
  latest: string | null
  /** Voters by how many of the five they answered, index 0 unused. */
  byAnswered: number[]
}

export function buildAdminAwardReport(votes: readonly AdminAwardVote[]): AdminAwardReport {
  const byCategory = new Map<string, Map<string, number>>()
  const answeredOnCard = new Map<string, number>()
  const voters = new Set<string>()
  const card = new Set<string>(FAN_VOTE_IDS)
  let latest: string | null = null

  for (const v of votes) {
    const bucket = byCategory.get(v.category) ?? new Map<string, number>()
    bucket.set(v.choice, (bucket.get(v.choice) ?? 0) + 1)
    byCategory.set(v.category, bucket)
    voters.add(v.voter)
    if (card.has(v.category)) answeredOnCard.set(v.voter, (answeredOnCard.get(v.voter) ?? 0) + 1)
    if (!latest || v.voted_at > latest) latest = v.voted_at
  }

  const categories: AdminAwardCategory[] = [...byCategory.entries()].map(([category, bucket]) => {
    const total = [...bucket.values()].reduce((a, b) => a + b, 0)
    return {
      category,
      label: awardCategoryLabel(category),
      votes: total,
      onTheCard: card.has(category),
      choices: [...bucket.entries()]
        .map(([choice, count]) => ({ choice, votes: count, share: total ? count / total : 0 }))
        // Most-voted first, and ties broken by the key so the list does not reshuffle between
        // reads of the same data.
        .sort((a, b) => b.votes - a.votes || a.choice.localeCompare(b.choice)),
    }
  })

  // The five on the card first, in the order the card asks them, then everything else by size.
  const cardOrder = (id: string) => FAN_VOTE_IDS.indexOf(id as typeof FAN_VOTE_IDS[number])
  categories.sort((a, b) =>
    (a.onTheCard ? 0 : 1) - (b.onTheCard ? 0 : 1)
    || (a.onTheCard ? cardOrder(a.category) - cardOrder(b.category) : b.votes - a.votes))

  const byAnswered = Array(card.size + 1).fill(0) as number[]
  for (const n of answeredOnCard.values()) byAnswered[Math.min(n, card.size)] += 1

  return {
    categories,
    voters: voters.size,
    votes: votes.length,
    completed: byAnswered[card.size] ?? 0,
    latest,
    byAnswered,
  }
}
