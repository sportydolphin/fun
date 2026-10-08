import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Typography, TextField, CircularProgress, MenuItem, Select } from '@mui/material'
import { ChipRow, FilterChip } from './FilterChips'
import { ModalShell, CARD_BORDER, CARD_FILL, TYPE_SCALE, TeamBadge, FOCUS_RING, hoverOnly } from './ui'
import {
  fetchWpblVideos, fetchWpblVideoTags, fetchWpblSchedule, fetchWpblTeams, fetchWpblAllPlayers,
  fetchWpblGamePlays, fetchWpblGameLines, saveWpblVideoTag, deleteWpblVideoTag,
} from './api'
import { gameStartMs } from './constants'
import { clipLabel, ClipCaption, inningLabel } from './Watch'
import { HighlightLightbox, VideoThumb, PLAYABLE_HOVER } from './Highlights'
import type { WpblGame, WpblGamePlay, WpblPlayer, WpblTeam, WpblVideo, WpblVideoTag } from './types'

// /admin → Clips: correct what the clip matcher (scripts/wpbl-clip-tags.mjs) got wrong or could not
// place. Every save is method 'manual', which the sync never overwrites or deletes, so a fix
// outlives every later --relink.
//
// THE QUEUE IS "IN-SEASON AND NO GAME". The matcher pins about 115 of the season's Shorts to a game
// and cannot place the rest: a catch ("Diana Ibarra diving catch") names a fielder, and play-by-play
// names fielders only by position; a clip posted the next morning is outside its time window. Those
// are the ones a person can place in a few seconds with the video in front of them. Pre-season
// clips are left out of the queue because they are from no game at all.
//
// "FROM NO GAME" IS A TAG TOO. Saving with nothing chosen stores an empty manual row, which is what
// stops the matcher putting a wrong tag back. Deleting a tag hands the clip back to the matcher.

type Filter = 'needs' | 'auto' | 'manual' | 'all'

const METHOD_LABEL: Record<string, string> = {
  play: 'At-bat', game: 'Game', player: 'Player', team: 'Club', manual: 'Manual',
}

function when(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function AdminClips() {
  const [videos, setVideos] = useState<WpblVideo[] | null>(null)
  const [tags, setTags] = useState<Map<string, WpblVideoTag>>(new Map())
  const [games, setGames] = useState<WpblGame[]>([])
  const [teams, setTeams] = useState<WpblTeam[]>([])
  const [players, setPlayers] = useState<WpblPlayer[]>([])
  const [filter, setFilter] = useState<Filter>('needs')
  const [editing, setEditing] = useState<WpblVideo | null>(null)
  const [playing, setPlaying] = useState<WpblVideo | null>(null)

  const load = useCallback(() => {
    Promise.all([fetchWpblVideos(), fetchWpblVideoTags(true), fetchWpblSchedule(), fetchWpblTeams(), fetchWpblAllPlayers()])
      .then(([v, t, g, tm, pl]) => { setVideos(v); setTags(new Map(t)); setGames(g); setTeams(tm); setPlayers(pl) })
      .catch(() => setVideos(v => v ?? []))
  }, [])
  useEffect(() => load(), [load])

  const gameById = useMemo(() => new Map(games.map(g => [g.id, g])), [games])
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const playerById = useMemo(() => new Map(players.map(p => [p.id, p])), [players])

  // The season as dates: opening day to three days past the last game, which is as late as a
  // clip of a game has ever been posted.
  const season = useMemo(() => {
    const dates = games.map(g => g.game_date).sort()
    if (!dates.length) return null
    const last = new Date(`${dates[dates.length - 1]}T12:00:00Z`); last.setUTCDate(last.getUTCDate() + 3)
    return { from: `${dates[0]}T00:00:00Z`, to: last.toISOString() }
  }, [games])

  const shorts = useMemo(() => (videos ?? []).filter(v => v.is_short === true), [videos])
  const inSeason = useCallback((v: WpblVideo) => !season || (v.published_at >= season.from && v.published_at <= season.to), [season])
  const test: Record<Filter, (v: WpblVideo) => boolean> = useMemo(() => ({
    needs: v => inSeason(v) && !tags.get(v.video_id)?.game_id && tags.get(v.video_id)?.method !== 'manual',
    auto: v => { const m = tags.get(v.video_id)?.method; return !!m && m !== 'manual' },
    manual: v => tags.get(v.video_id)?.method === 'manual',
    all: () => true,
  }), [tags, inSeason])
  const list = shorts.filter(test[filter])

  const summary = (v: WpblVideo) => {
    const t = tags.get(v.video_id)
    if (!t) return 'Untagged'
    const bits = [clipLabel(t, gameById, teamById)]
    const names = t.player_ids.map(id => playerById.get(id)?.name ?? '—')
    if (names.length) bits.push(names.join(', '))
    if (t.method === 'manual' && !t.game_id && !names.length && !t.team_id) bits.push('from no game')
    return bits.filter(Boolean).join(' · ') || '—'
  }

  if (videos == null) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>

  return (
    <Box sx={{ mt: 2 }}>
      <Typography sx={{ fontSize: TYPE_SCALE.body, color: 'text.secondary', mb: 1.5, maxWidth: '44rem' }}>
        What each Short shows, for Game Center, player pages and the Watch filters. The matcher places
        clips it can confirm against play-by-play; these are the ones it could not, or got wrong. A save
        is kept through every re-tag.
      </Typography>
      <ChipRow mb={1.5}>
        {(['needs', 'auto', 'manual', 'all'] as Filter[]).map(f => (
          <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)}
            label={`${{ needs: 'Needs a game', auto: 'Matched', manual: 'Set by hand', all: 'All Shorts' }[f]} (${shorts.filter(test[f]).length})`} />
        ))}
      </ChipRow>
      {list.length === 0 ? (
        <Typography sx={{ color: 'text.secondary', py: 3 }}>Nothing here.</Typography>
      ) : (
        <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
          {list.map(v => {
            const t = tags.get(v.video_id)
            const team = t?.team_id ? teamById.get(t.team_id) : undefined
            return (
              <Box key={v.video_id} sx={{
                display: 'flex', gap: 1.25, p: 1, border: '1px solid', borderColor: CARD_BORDER, borderRadius: 2, bgcolor: CARD_FILL,
              }}>
                <Box onClick={() => setPlaying(v)} role="button" tabIndex={0} aria-label={`Play clip: ${v.title}`}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPlaying(v) } }}
                  sx={{ width: 72, flexShrink: 0, position: 'relative', borderRadius: 1.5, overflow: 'hidden', cursor: 'pointer', ...PLAYABLE_HOVER, ...FOCUS_RING }}>
                  <VideoThumb video={v} vertical badge={24} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 0.4 }}>
                  <Typography sx={{ fontSize: TYPE_SCALE.body, fontWeight: 700, lineHeight: 1.3 }}>{v.title}</Typography>
                  <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.disabled' }}>Posted {when(v.published_at)}</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                    {t && <MethodBadge method={t.method} />}
                    {team && <TeamBadge team={team} size={18} />}
                    <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>{summary(v)}</Typography>
                  </Box>
                  <Box sx={{ mt: 'auto', pt: 0.5 }}>
                    <SmallButton onClick={() => setEditing(v)}>Edit tag</SmallButton>
                  </Box>
                </Box>
              </Box>
            )
          })}
        </Box>
      )}
      {playing && <HighlightLightbox video={playing} onClose={() => setPlaying(null)} />}
      {editing && (
        <ClipTagEditor
          video={editing} tag={tags.get(editing.video_id)} games={games} teams={teams} players={players}
          onClose={() => setEditing(null)}
          onSaved={next => {
            setTags(prev => { const m = new Map(prev); if (next) m.set(next.video_id, next); else m.delete(editing.video_id); return m })
            setEditing(null)
          }}
        />
      )}
    </Box>
  )
}

function MethodBadge({ method }: { method: string }) {
  const manual = method === 'manual'
  return (
    <Box component="span" sx={{
      px: 0.6, py: '1px', borderRadius: 0.75, fontSize: '0.6rem', fontWeight: 800, letterSpacing: 0.4,
      textTransform: 'uppercase', border: '1px solid',
      color: manual ? 'primary.main' : 'text.secondary', borderColor: manual ? 'primary.main' : 'divider',
    }}>{METHOD_LABEL[method] ?? method}</Box>
  )
}

function SmallButton({ onClick, children, disabled, tone }: {
  onClick: () => void; children: React.ReactNode; disabled?: boolean; tone?: 'primary' | 'danger'
}) {
  return (
    <Box component="button" type="button" onClick={onClick} disabled={disabled} sx={{
      px: 1.25, py: 0.5, borderRadius: 999, font: 'inherit', fontSize: TYPE_SCALE.meta, fontWeight: 800,
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, border: '1px solid',
      borderColor: tone === 'primary' ? 'primary.main' : tone === 'danger' ? 'error.main' : 'divider',
      bgcolor: tone === 'primary' ? 'primary.main' : 'background.paper',
      color: tone === 'primary' ? 'primary.contrastText' : tone === 'danger' ? 'error.main' : 'text.primary',
      '@media (pointer: coarse)': { minHeight: 38 },
      ...hoverOnly({ borderColor: 'text.secondary' }), ...FOCUS_RING,
    }}>{children}</Box>
  )
}

/**
 * One clip's tag, edited with the clip playing above it. Choosing a game loads that game's plays and
 * box score, so the at-bat list and the player chips are the ones that could possibly be right;
 * choosing an at-bat sets the club to the batting side. Anyone outside the game can still be added
 * by name (an interview about a game the player sat out).
 */
function ClipTagEditor({ video, tag, games, teams, players, onClose, onSaved }: {
  video: WpblVideo; tag: WpblVideoTag | undefined
  games: WpblGame[]; teams: WpblTeam[]; players: WpblPlayer[]
  onClose: () => void; onSaved: (next: WpblVideoTag | null) => void
}) {
  const [gameId, setGameId] = useState<string>(tag?.game_id ?? '')
  const [sequence, setSequence] = useState<number | ''>(tag?.play_sequence ?? '')
  const [playerIds, setPlayerIds] = useState<string[]>(tag?.player_ids ?? [])
  const [teamId, setTeamId] = useState<string>(tag?.team_id ?? '')
  const [allGames, setAllGames] = useState(false)
  const [plays, setPlays] = useState<WpblGamePlay[]>([])
  const [inGame, setInGame] = useState<Map<string, string>>(new Map())   // player id -> club, this game
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams])
  const playerById = useMemo(() => new Map(players.map(p => [p.id, p])), [players])
  const pub = Date.parse(video.published_at)
  const startOf = (g: WpblGame) => gameStartMs(g.game_date, g.start_time) ?? Date.parse(`${g.game_date}T17:00:00Z`)

  // Games that had started by the upload and within three days of it, nearest first: a clip is of a
  // game already played, and the league posts within a day or so. "Show every game" for the rest.
  const gameOptions = useMemo(() => {
    const sorted = [...games].sort((a, b) => Math.abs(pub - startOf(a)) - Math.abs(pub - startOf(b)))
    const near = sorted.filter(g => startOf(g) <= pub + 3600e3 && pub - startOf(g) <= 3 * 86400e3)
    const list = allGames ? sorted : near
    const chosen = games.find(g => g.id === gameId)
    return chosen && !list.includes(chosen) ? [chosen, ...list] : list
  }, [games, pub, allGames, gameId])    

  useEffect(() => {
    let live = true
    setPlays([]); setInGame(new Map())
    if (!gameId) return
    fetchWpblGamePlays(gameId).then(p => { if (live) setPlays([...p].sort((a, b) => a.sequence - b.sequence)) })
    fetchWpblGameLines(gameId).then(({ batting, pitching }) => {
      if (live) setInGame(new Map([...batting, ...pitching].map(l => [l.player_id, l.team_id])))
    })
    return () => { live = false }
  }, [gameId])

  const game = games.find(g => g.id === gameId)
  const gameLabel = (g: WpblGame) => clipLabel({ video_id: '', game_id: g.id, play_sequence: null, inning: null, half: null, team_id: null, player_ids: [], method: 'manual' },
    new Map([[g.id, g]]), teamById) ?? g.game_date
  // The at-bats worth showing first: the chosen players', else every play that did something.
  // The chosen at-bat always stays in the list, whoever batted: a filter that hid it would leave the
  // dropdown blank over a value it still holds.
  const playOptions = useMemo(() => {
    const mine = plays.filter(p => (p.batter_id && playerIds.includes(p.batter_id)) || p.sequence === sequence)
    return mine.some(p => p.sequence !== sequence) ? mine : plays
  }, [plays, playerIds, sequence])
  const chosenPlay = plays.find(p => p.sequence === sequence)
  // The stored at-bat, for the moment before this game's plays have loaded. Saving then must keep
  // the pin, not drop it because the list it would be looked up in is still empty.
  const storedPin = tag && sequence !== '' && tag.game_id === gameId && tag.play_sequence === sequence
    ? { sequence: tag.play_sequence, inning: tag.inning, half: tag.half } : null
  const pin = chosenPlay ? { sequence: chosenPlay.sequence, inning: chosenPlay.inning, half: chosenPlay.half } : storedPin

  const togglePlayer = (id: string) => setPlayerIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  const pickPlay = (seq: number | '') => {
    setSequence(seq)
    const p = plays.find(x => x.sequence === seq)
    if (!p) return
    if (p.team_id) setTeamId(p.team_id)
    if (p.batter_id && !playerIds.includes(p.batter_id)) setPlayerIds(ids => [...ids, p.batter_id!])
  }
  // Accents folded both ways, so "andreanne" finds Andréanne Leblanc.
  const fold = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const matches = fold(search).length < 2 ? [] : players
    .filter(p => fold(p.name).includes(fold(search)) && !playerIds.includes(p.id)).slice(0, 8)
  const gamePlayers = [...inGame.entries()]
    .map(([id, club]) => ({ player: playerById.get(id), club }))
    .filter((x): x is { player: WpblPlayer; club: string } => !!x.player)
    .sort((a, b) => a.club.localeCompare(b.club) || a.player.name.localeCompare(b.player.name))

  const save = async (empty = false) => {
    setBusy(true); setError(null)
    const next: Omit<WpblVideoTag, 'method'> = empty
      ? { video_id: video.video_id, game_id: null, play_sequence: null, inning: null, half: null, team_id: null, player_ids: [] }
      : {
          video_id: video.video_id, game_id: gameId || null,
          play_sequence: gameId && pin ? pin.sequence : null,
          inning: gameId && pin ? pin.inning : null,
          half: gameId && pin ? pin.half : null,
          team_id: teamId || null, player_ids: playerIds,
        }
    const ok = await saveWpblVideoTag(next)
    setBusy(false)
    if (ok) onSaved({ ...next, method: 'manual' }); else setError('Could not save. Signed in as the owner?')
  }
  const revert = async () => {
    setBusy(true); setError(null)
    const ok = await deleteWpblVideoTag(video.video_id)
    setBusy(false)
    if (ok) onSaved(null); else setError('Could not remove the tag.')
  }

  const selectSx = { fontSize: '0.8rem', '& .MuiSelect-select': { py: 0.75 } }
  // THE EDITOR IS A ModalShell, portalled at z-index 1500, and a Select's menu is portalled too, at
  // MUI's modal layer of 1300: left alone every dropdown here opens BEHIND the editor and the picker
  // looks dead. And Escape in an open menu must stop at the menu, or it also reaches ModalShell's
  // window listener and closes the editor with the choices unsaved.
  const menu = { sx: { zIndex: 1700 }, onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation() }
  return (
    <ModalShell eyebrow="Tag a clip" onClose={onClose} maxWidth={720} zIndex={1500}>
      <Box sx={{ p: 2, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '160px minmax(0, 1fr)' } }}>
        <Box sx={{ maxWidth: { xs: 160, sm: 'none' }, mx: { xs: 'auto', sm: 0 }, width: '100%' }}>
          <Box sx={{ position: 'relative', borderRadius: 2, overflow: 'hidden' }}>
            <VideoThumb video={video} vertical badge={30} />
            <ClipCaption title={video.title} lines={4} />
          </Box>
          <Box component="a" href={`https://www.youtube.com/shorts/${video.video_id}`} target="_blank" rel="noopener noreferrer"
            sx={{ display: 'block', mt: 0.75, fontSize: TYPE_SCALE.meta, color: 'text.secondary' }}>Watch on YouTube ↗</Box>
          <Typography sx={{ mt: 0.5, fontSize: TYPE_SCALE.meta, color: 'text.disabled' }}>Posted {when(video.published_at)}</Typography>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
          <Field label="Game">
            <Select value={gameId} displayEmpty size="small" sx={selectSx} MenuProps={menu}
              onChange={e => { setGameId(String(e.target.value)); setSequence('') }}>
              <MenuItem value="" sx={{ fontSize: '0.8rem' }}>No game</MenuItem>
              {gameOptions.map(g => <MenuItem key={g.id} value={g.id} sx={{ fontSize: '0.8rem' }}>{gameLabel(g)}</MenuItem>)}
            </Select>
            <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: TYPE_SCALE.meta, color: 'text.secondary', mt: 0.5 }}>
              <input type="checkbox" checked={allGames} onChange={e => setAllGames(e.target.checked)} /> Show every game
            </Box>
          </Field>

          {game && (
            <Field label="At-bat">
              <Select value={chosenPlay ? sequence : ''} displayEmpty size="small" sx={selectSx}
                onChange={e => { const v = e.target.value as number | ''; pickPlay(v === '' ? '' : Number(v)) }}
                MenuProps={{ ...menu, PaperProps: { sx: { maxHeight: 360 } } }}>
                <MenuItem value="" sx={{ fontSize: '0.8rem' }}>Not one at-bat</MenuItem>
                {playOptions.map(p => (
                  <MenuItem key={p.sequence} value={p.sequence} sx={{ fontSize: '0.78rem', whiteSpace: 'normal', maxWidth: 520 }}>
                    {inningLabel(p)} · {p.narrative}
                  </MenuItem>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Players">
            {game && gamePlayers.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.75 }}>
                {gamePlayers.map(({ player, club }) => (
                  <FilterChip key={player.id} active={playerIds.includes(player.id)} onClick={() => togglePlayer(player.id)}
                    label={`${player.name} (${teamById.get(club)?.abbr ?? club})`} />
                ))}
              </Box>
            )}
            {playerIds.filter(id => !inGame.has(id)).length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.75 }}>
                {playerIds.filter(id => !inGame.has(id)).map(id => (
                  <FilterChip key={id} active onClick={() => togglePlayer(id)} label={`${playerById.get(id)?.name ?? id} ✕`} />
                ))}
              </Box>
            )}
            <TextField value={search} onChange={e => setSearch(e.target.value)} placeholder="Add anyone else by name" size="small"
              sx={{ '& .MuiInputBase-input': { py: 0.75, fontSize: '0.8rem' } }} />
            {matches.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
                {matches.map(p => <FilterChip key={p.id} active={false} onClick={() => { togglePlayer(p.id); setSearch('') }} label={`+ ${p.name}`} />)}
              </Box>
            )}
          </Field>

          <Field label="Club">
            <Select value={teamId} displayEmpty size="small" sx={selectSx} MenuProps={menu} onChange={e => setTeamId(String(e.target.value))}>
              <MenuItem value="" sx={{ fontSize: '0.8rem' }}>No club</MenuItem>
              {teams.map(t => <MenuItem key={t.id} value={t.id} sx={{ fontSize: '0.8rem' }}>{t.city} {t.name}</MenuItem>)}
            </Select>
          </Field>

          {error && <Typography sx={{ fontSize: TYPE_SCALE.meta, color: 'error.main' }}>{error}</Typography>}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
            <SmallButton tone="primary" disabled={busy} onClick={() => save()}>Save</SmallButton>
            <SmallButton disabled={busy} onClick={() => save(true)}>From no game</SmallButton>
            {tag && <SmallButton tone="danger" disabled={busy} onClick={revert}>
              {tag.method === 'manual' ? 'Back to automatic' : 'Remove tag'}
            </SmallButton>}
            <Box sx={{ flex: 1 }} />
            <SmallButton disabled={busy} onClick={onClose}>Cancel</SmallButton>
          </Box>
          {tag && (
            <Typography sx={{ fontSize: TYPE_SCALE.micro, color: 'text.disabled' }}>
              {tag.method === 'manual' ? 'Back to automatic' : 'Remove tag'} hands the clip back to the matcher, which
              tags it again on its next pass over it: within three days of upload, or the next full relink.
            </Typography>
          )}
        </Box>
      </Box>
    </ModalShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Typography sx={{ fontSize: TYPE_SCALE.micro, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary', mb: 0.5 }}>
        {label}
      </Typography>
      {children}
    </Box>
  )
}
