import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Button, TextField, Typography } from '@mui/material'
import { ChipRow, FilterChip } from '../ui/FilterChip'
import { pressable } from '../ui/interaction'
import { CARD_BORDER, TYPE_SCALE } from './ui'
import {
  LIVE_POLL_MS, fetchWpblAllLines, fetchWpblAllPlayers, fetchWpblGameLive, fetchWpblGamePlays, fetchWpblPlayLog,
  fetchWpblSchedule, fetchWpblTeams, fetchWpblNotePosts, saveWpblNotePost, deleteWpblNotePost, type WpblNotePost,
} from './api'
import { settleGame } from './gameOver'
import { wpblGamePath } from './routes'
import { notePostText, postedButGone, wpblLiveNotes } from './derive/liveNotes'
import type { LiveNote, NoteCategory, NoteLens, NotePlace } from '../league/liveNotes'
import type { WpblGame, WpblRunValuePlay, WpblTeam } from './types'

// /admin → Notes: every live note of a game (src/league/liveNotes.ts), the owner's side of them.
// Readers will see the starred few in Game Center; this is the whole list, for finding what to post.
//
// EVERY SEASON IS READ, ON PURPOSE. A note's history is everything before it ("first in WPBL
// history" in 2027 needs 2026), so nothing here is cut to a season, and nothing here sums lines: they
// only say who stood where (seasonOnScreen.test.tsx lists the file as exempt for that reason).
//
// A LIVE GAME IS POLLED, and the whole walk reruns on each poll (about 150ms for a season). That is
// what makes a correction take a note away: the engine simply stops producing it, and a note already
// posted then shows under "No longer true", since a post cannot be edited.

const SITE = 'https://sportydolphin.fun'

const CATEGORY_LABEL: Record<NoteCategory, string> = {
  first: 'First', rare: 'Rare', milestone: 'Milestone', record: 'Record', streak: 'Streak', watch: 'Watch',
  situation: 'Situation', matchup: 'Matchup', leader: 'Leader',
}
const LENS_LABEL: Record<NoteLens, string> = {
  league: 'League', postseason: 'Postseason', season: 'Season', club: 'Club', 'club-season': 'Club season',
  player: 'Career', 'player-season': 'Player season', against: 'Pitcher', pair: 'Matchup', crew: 'Crew', game: 'Game',
}

type Order = 'score' | 'play'

const inningMark = (n: LiveNote) => (n.inning == null ? '' : `${n.half === 'top' ? '▲' : '▼'}${n.inning}`)

interface Data {
  games: WpblGame[]
  plays: WpblRunValuePlay[]
  lines: { game_id: string; player_id: string; team_id: string | null; position?: string | null }[]
  players: { id: string; name: string }[]
  teams: WpblTeam[]
}

export default function AdminLiveNotes() {
  const [data, setData] = useState<Data | null>(null)
  const [posts, setPosts] = useState<WpblNotePost[]>([])
  const [gameId, setGameId] = useState<string | null>(null)
  const [category, setCategory] = useState<NoteCategory | null>(null)
  const [lens, setLens] = useState<NoteLens | null>(null)
  const [publicOnly, setPublicOnly] = useState(false)
  const [showReplaced, setShowReplaced] = useState(false)
  const [order, setOrder] = useState<Order>('score')
  const [open, setOpen] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchWpblSchedule(), fetchWpblPlayLog(null), fetchWpblAllLines(), fetchWpblAllPlayers(), fetchWpblTeams()])
      .then(([games, plays, lines, players, teams]) => {
        setData({ games, plays, lines: [...lines.batting, ...lines.pitching], players, teams })
      })
    void fetchWpblNotePosts().then(setPosts)
  }, [])

  const played = useMemo(() => (data?.games ?? [])
    .filter(g => g.status !== 'scheduled')
    .sort((a, b) => (`${b.game_date} ${b.start_time ?? ''}` < `${a.game_date} ${a.start_time ?? ''}` ? -1 : 1)), [data])
  // A live game first, else the newest one played.
  const chosen = gameId ?? played.find(g => g.status === 'live')?.id ?? played[0]?.id ?? null
  const game = played.find(g => g.id === chosen) ?? null
  const live = game?.status === 'live'

  // While the game is live, its own rows and its score row are read again on the poll and laid
  // over the log, the same reads Game Center makes.
  const refresh = useCallback(async (id: string) => {
    const [rows, delta] = await Promise.all([fetchWpblGamePlays(id), fetchWpblGameLive(id)])
    setData(d => d && {
      ...d,
      plays: [...d.plays.filter(p => p.game_id !== id), ...rows],
      games: d.games.map(g => (g.id === id && delta ? settleGame({ ...g, ...delta }) : g)),
    })
  }, [])
  useEffect(() => {
    if (!live || !chosen) return
    void refresh(chosen)
    const t = setInterval(() => void refresh(chosen), LIVE_POLL_MS)
    return () => clearInterval(t)
  }, [live, chosen, refresh])

  const byGame = useMemo(() => (data ? wpblLiveNotes(data) : new Map<string, LiveNote[]>()), [data])
  const notes = useMemo(() => (chosen ? byGame.get(chosen) ?? [] : []), [byGame, chosen])
  const gameById = useMemo(() => new Map((data?.games ?? []).map(g => [g.id, g])), [data])
  const teamName = (id: string) => data?.teams.find(t => t.id === id)?.city ?? id

  const shown = useMemo(() => {
    const list = notes.filter(n => (showReplaced || !n.superseded) && (!publicOnly || n.public)
      && (!category || n.category === category) && (!lens || n.lens === lens))
    return order === 'score'
      ? [...list].sort((a, b) => b.score - a.score || (a.sequence ?? -1) - (b.sequence ?? -1))
      : list
  }, [notes, showReplaced, publicOnly, category, lens, order])

  const present = <K extends string>(pick: (n: LiveNote) => K) => {
    const counts = new Map<K, number>()
    for (const n of notes) if (showReplaced || !n.superseded) counts.set(pick(n), (counts.get(pick(n)) ?? 0) + 1)
    return counts
  }
  const categories = present(n => n.category)
  const lenses = present(n => n.lens)

  const playUrl = (place: { game_id: string; sequence: number | null }) => {
    const g = gameById.get(place.game_id)
    if (!g || !data) return null
    const path = wpblGamePath(g, data.teams, data.games)
    return `${SITE}${path}${place.sequence == null ? '' : `#play-${place.sequence}`}`
  }
  const posted = new Map(posts.map(p => [p.note_key, p]))
  const gone = chosen ? postedButGone(posts, chosen, notes) : []

  const copy = async (n: LiveNote) => {
    const url = playUrl(n)
    if (!url) return
    try {
      await navigator.clipboard.writeText(notePostText(n, url))
      setMessage('Copied')
    } catch {
      setMessage('Not copied. The browser refused the clipboard.')
    }
  }
  const mark = async (n: LiveNote) => {
    const url = playUrl(n)
    const ok = await saveWpblNotePost({ note_key: n.key, game_id: n.game_id, text: url ? notePostText(n, url) : n.text })
    if (ok) setPosts(await fetchWpblNotePosts())
    else setMessage('Not saved. The console has the reason.')
  }
  const unmark = async (key: string) => {
    const ok = await deleteWpblNotePost(key)
    if (ok) setPosts(ps => ps.filter(p => p.note_key !== key))
    else setMessage('Not removed. The console has the reason.')
  }

  if (!data) return <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>Loading</Typography>
  if (!game) return <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>No games played</Typography>

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField select size="small" label="Game" value={chosen ?? ''} onChange={e => { setGameId(e.target.value); setOpen(null) }}
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
        {played.map(g => (
          <option key={g.id} value={g.id}>
            {g.game_date} {teamName(g.away_team_id)} {g.away_score ?? ''}, {teamName(g.home_team_id)} {g.home_score ?? ''}
            {g.status === 'live' ? ' (live)' : ''}
          </option>
        ))}
      </TextField>

      <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
        {notes.filter(n => !n.superseded).length} notes · {notes.filter(n => n.public).length} public
        {live ? ` · live, every ${LIVE_POLL_MS / 1000}s` : ''}
      </Typography>

      <ChipRow mb={0}>
        <FilterChip active={publicOnly} onClick={() => setPublicOnly(v => !v)}>Public</FilterChip>
        <FilterChip active={showReplaced} onClick={() => setShowReplaced(v => !v)}>Replaced</FilterChip>
        <FilterChip active={order === 'score'} onClick={() => setOrder('score')}>By score</FilterChip>
        <FilterChip active={order === 'play'} onClick={() => setOrder('play')}>By play</FilterChip>
      </ChipRow>
      <ChipRow mb={0}>
        <FilterChip active={category == null} onClick={() => setCategory(null)}>All</FilterChip>
        {(Object.keys(CATEGORY_LABEL) as NoteCategory[]).filter(c => categories.has(c)).map(c => (
          <FilterChip key={c} active={category === c} onClick={() => setCategory(category === c ? null : c)}>
            {CATEGORY_LABEL[c]} {categories.get(c)}
          </FilterChip>
        ))}
      </ChipRow>
      <ChipRow mb={0}>
        <FilterChip active={lens == null} onClick={() => setLens(null)}>Every lens</FilterChip>
        {(Object.keys(LENS_LABEL) as NoteLens[]).filter(l => lenses.has(l)).map(l => (
          <FilterChip key={l} active={lens === l} onClick={() => setLens(lens === l ? null : l)}>
            {LENS_LABEL[l]} {lenses.get(l)}
          </FilterChip>
        ))}
      </ChipRow>
      {message && <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary' }}>{message}</Typography>}

      {gone.length > 0 && (
        <Box sx={{ border: '1px solid', borderColor: 'error.main', borderRadius: 2, p: 1 }}>
          <Typography sx={{ fontSize: TYPE_SCALE.title, fontWeight: 700, px: 0.75, pb: 1 }}>No longer true</Typography>
          {gone.map(p => (
            <Box key={p.note_key} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.75, py: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
              <Typography sx={{ flex: 1, minWidth: 0, fontSize: TYPE_SCALE.body, whiteSpace: 'pre-line' }}>{p.text}</Typography>
              <Button size="small" onClick={() => unmark(p.note_key)}>Clear</Button>
            </Box>
          ))}
        </Box>
      )}

      <Box sx={{ border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, py: 0.5 }}>
        {shown.length === 0 && (
          <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', px: 1.75, py: 1 }}>No notes</Typography>
        )}
        {shown.map((n, i) => {
          const isOpen = open === n.key
          const post = posted.get(n.key)
          return (
            <Box key={n.key} sx={{ borderTop: i ? '1px solid' : 'none', borderColor: 'divider' }}>
              <Box {...pressable(() => setOpen(isOpen ? null : n.key))}
                sx={{ display: 'flex', gap: 1.25, px: 1.75, py: 0.75, cursor: 'pointer', alignItems: 'baseline' }}>
                <Typography sx={{ width: '2rem', flexShrink: 0, textAlign: 'right', fontSize: TYPE_SCALE.meta, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {n.score}
                </Typography>
                <Typography sx={{ width: '1.6rem', flexShrink: 0, fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{inningMark(n)}</Typography>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: n.public ? 700 : 500, color: n.superseded ? 'text.secondary' : 'text.primary' }}>
                    {n.public ? '★ ' : ''}{n.text}
                  </Typography>
                  {n.detail && <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{n.detail}</Typography>}
                </Box>
                <Typography sx={{ flexShrink: 0, fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>
                  {post ? 'Posted · ' : ''}{CATEGORY_LABEL[n.category]} · {LENS_LABEL[n.lens]}
                </Typography>
              </Box>
              {isOpen && (
                <Box sx={{ px: 1.75, pb: 1, pl: 6.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  <Evidence note={n} url={playUrl} />
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button size="small" variant="outlined" onClick={() => void copy(n)}>Copy post</Button>
                    {post
                      ? <Button size="small" onClick={() => void unmark(n.key)}>Unmark posted</Button>
                      : <Button size="small" onClick={() => void mark(n)}>Mark posted</Button>}
                  </Box>
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/** The plays that prove a note: its own, then the earlier times, newest first. */
function Evidence({ note, url }: { note: LiveNote; url: (p: NotePlace | LiveNote) => string | null }) {
  const own = url(note)
  const earlier = [...note.before].reverse()
  const more = note.beforeTotal - note.before.length
  const link = (href: string | null, label: string) => (href
    ? <Box component="a" href={href} target="_blank" rel="noopener noreferrer" sx={{ fontSize: TYPE_SCALE.meta }}>{label}</Box>
    : <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta }}>{label}</Typography>)
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25, alignItems: 'baseline' }}>
      {link(own, note.sequence == null ? 'This game' : 'This play')}
      {earlier.length > 0 && <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>Before:</Typography>}
      {earlier.map((b, i) => <Box key={`${b.game_id}|${b.sequence}|${i}`} component="span">{link(url(b), b.date)}</Box>)}
      {more > 0 && <Typography component="span" sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>and {more} more</Typography>}
    </Box>
  )
}
