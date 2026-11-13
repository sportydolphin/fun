import { useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { ChipRow, FilterChip } from '../ui/FilterChip'
import { NameText } from '../ui/NameText'
import { PlayerPortrait, TeamBadge, TYPE_SCALE, FOCUS_RING, hoverOnly } from './ui'
import { searchPlayers } from './playerSearch'
import { fanPhotoTeamName } from './fanPhotos'
import { chromePx } from '../ui/scale'
import type { TagSubject } from './api'
import type { WpblPlayer, WpblPhotoFigure, WpblTeam } from './types'

// Saying who is in a fan photo, from a closed list: the full roster (never a club's current sheet,
// which drops a traded player), the figures the owner keeps, and the clubs for a team photo. No
// free text, so there is nothing to moderate and nothing a stranger can make a page render.
// Shared by the tagging queue (PhotoTagPage) and the submit page (PhotoSubmitPage).

/** One thing that can be picked: a player, a figure (a mascot, a manager) or a whole club. */
export type SubjectOption =
  | { kind: 'player'; key: string; subject: TagSubject; label: string; player: WpblPlayer }
  | { kind: 'figure'; key: string; subject: TagSubject; label: string; figure: WpblPhotoFigure }
  | { kind: 'team'; key: string; subject: TagSubject; label: string; team: WpblTeam }

/** The key an option is known by, from the subject shape the database speaks. */
export const subjectKey = (s: TagSubject): string =>
  'player' in s ? `p:${s.player}` : 'team' in s ? `t:${s.team}` : `f:${s.figure}`

export function useSubjectOptions(players: WpblPlayer[] | null, figures: WpblPhotoFigure[], teams: WpblTeam[]) {
  const options = useMemo<SubjectOption[]>(() => [
    ...(players ?? []).map(p => ({ kind: 'player' as const, key: `p:${p.id}`, subject: { player: p.id }, label: p.name, player: p })),
    ...figures.map(f => ({ kind: 'figure' as const, key: `f:${f.key}`, subject: { figure: f.key }, label: f.name, figure: f })),
    ...teams.map(t => ({ kind: 'team' as const, key: `t:${t.id}`, subject: { team: t.id }, label: fanPhotoTeamName(t), team: t })),
  ], [players, figures, teams])
  const optionByKey = useMemo(() => new Map(options.map(o => [o.key, o])), [options])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  return { options, optionByKey, teamById }
}

/**
 * What the list under the search shows. A name or a number searches everyone (a number is how a
 * fan recognizes a player in a photo); with nothing typed, a club chip lists that club, and with
 * neither, nothing, so the list does not open on a wall of 118 names.
 */
export function matchSubjects(
  query: string, club: string | null, players: WpblPlayer[] | null, options: SubjectOption[],
  optionByKey: Map<string, SubjectOption>, exclude: Set<string>,
): SubjectOption[] {
  const q = query.trim()
  if (q.length >= 1) {
    const people = searchPlayers(q, players ?? []).map(h => optionByKey.get(`p:${h.player.id}`)!).filter(Boolean)
    const lower = q.toLowerCase()
    const others = options.filter(o => o.kind !== 'player' && o.label.toLowerCase().includes(lower))
    return [...people, ...others].filter(o => !exclude.has(o.key)).slice(0, 8)
  }
  if (club) {
    const roster = (players ?? []).filter(p => p.team_id === club && p.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(p => optionByKey.get(`p:${p.id}`)!)
    const whole = optionByKey.get(`t:${club}`)
    return [...(whole ? [whole] : []), ...roster].filter(o => o && !exclude.has(o.key))
  }
  return []
}

/** One name the reader can pick, as a row: who, and what tells them apart (number, club, role). */
export function OptionRow({ option, teams, onPick, disabled }: {
  option: SubjectOption; teams: Map<string, WpblTeam>; onPick: () => void; disabled?: boolean
}) {
  const sub = option.kind === 'player'
    ? [option.player.jersey_number ? `#${option.player.jersey_number}` : null,
       option.player.team_id ? teams.get(option.player.team_id)?.abbr : null,
       option.player.position].filter(Boolean).join(' · ')
    : option.kind === 'figure' ? option.figure.kind[0].toUpperCase() + option.figure.kind.slice(1)
    : 'Team photo: the whole club'
  return (
    <Box component="button" type="button" onClick={onPick} disabled={disabled}
      sx={{
        font: 'inherit', textAlign: 'left', width: '100%', minWidth: 0, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.75, minHeight: chromePx(48),
        borderRadius: 2, border: '1px solid', borderColor: 'outline', bgcolor: 'background.paper',
        color: 'text.primary', ...hoverOnly({ bgcolor: 'action.hover' }), ...FOCUS_RING,
      }}>
      {option.kind === 'player' ? <PlayerPortrait name={option.player.name} teamId={option.player.team_id} size={32} />
        : option.kind === 'team' ? <TeamBadge team={option.team} size={32} />
        : <Box aria-hidden sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: 'action.hover', flexShrink: 0 }} />}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <NameText name={option.label} sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700 }} />
        <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }} noWrap>{sub}</Typography>
      </Box>
      <Typography aria-hidden sx={{ fontSize: TYPE_SCALE.title, fontWeight: 800, color: 'var(--wpbl-accent-fg)', px: 0.5 }}>+</Typography>
    </Box>
  )
}

export function SearchBox({ id, inputRef, value, onChange, onEnter, disabled }: {
  id: string; inputRef?: React.Ref<HTMLInputElement>; value: string; onChange?: (v: string) => void
  onEnter?: () => void; disabled?: boolean
}) {
  return (
    <Box component="input" id={id} ref={inputRef} value={value} autoComplete="off" type="search"
      aria-label="Search by name or number" placeholder="Search a name, or #7"
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange?.(e.target.value)}
      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.() } }}
      disabled={disabled} readOnly={!onChange}
      sx={{
        width: '100%', boxSizing: 'border-box', fontSize: TYPE_SCALE.body, fontFamily: 'inherit',
        minHeight: chromePx(44), borderRadius: 999, border: '1px solid', borderColor: 'outline', bgcolor: 'transparent', color: 'text.primary',
        px: 1.75, outline: 'none',
        '&:focus': { borderColor: 'var(--wpbl-accent-fg)' }, '&::placeholder': { color: 'text.disabled' },
      }} />
  )
}

/** The whole picker in one block: search, club chips, and the matching rows. The submit page puts
 *  one under each photo; the tagging page lays the same pieces out around its own actions. */
export function SubjectPicker({ id, players, teams, options, optionByKey, teamById, exclude, onPick, disabled }: {
  id: string
  players: WpblPlayer[] | null
  teams: WpblTeam[]
  options: SubjectOption[]
  optionByKey: Map<string, SubjectOption>
  teamById: Map<string, WpblTeam>
  exclude: Set<string>
  onPick: (o: SubjectOption) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [club, setClub] = useState<string | null>(null)
  const matches = useMemo(() => matchSubjects(query, club, players, options, optionByKey, exclude),
    [query, club, players, options, optionByKey, exclude])
  const pick = (o: SubjectOption) => { onPick(o); setQuery('') }
  return (
    <Box>
      <SearchBox id={id} value={query} disabled={disabled} onChange={setQuery}
        onEnter={() => { if (matches[0]) pick(matches[0]) }} />
      <Box sx={{ mt: 1 }}>
        <ChipRow mb={0}>
          {teams.map(t => (
            <FilterChip key={t.id} active={club === t.id}
              onClick={() => { setClub(c => (c === t.id ? null : t.id)); setQuery('') }}>{fanPhotoTeamName(t)}</FilterChip>
          ))}
        </ChipRow>
      </Box>
      {matches.length > 0 && (
        <Box role="list" aria-label="People to tag" sx={{ display: 'grid', gap: 0.75, mt: 1.25, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
          {matches.map(o => (
            <Box role="listitem" key={o.key} sx={{ minWidth: 0 }}>
              <OptionRow option={o} teams={teamById} onPick={() => pick(o)} disabled={disabled} />
            </Box>
          ))}
        </Box>
      )}
      {query.trim() && matches.length === 0 && (
        <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', mt: 1.25 }}>
          No one on our list matches that. Names come from the league's rosters only.
        </Typography>
      )}
    </Box>
  )
}
