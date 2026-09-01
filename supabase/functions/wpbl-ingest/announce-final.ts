// Posts a game's box score to Discord the moment the ingest sees it go final.
//
// The scheduled job (scripts/post-wpbl-discord-recaps.ts) can post finals too, but it runs
// hourly — it is the backstop and the corrections pass. This is the fast path: a game that
// ends is in the channel on the ingest's own next pass, while people are still watching.
// Both write the same row in wpbl_discord_recap_posts and render through the same module,
// so whichever gets there first owns the message and the other leaves it alone — the hash
// they store is identical by construction (see recapMessageHash).
//
// Three properties this file is built around, in order:
//   1. It can never break an ingest. Every path is inside the caller's try/catch AND its
//      own; the worst outcome is a logged warning and a recap that waits for the job.
//   2. It never announces a game it didn't watch finish. The caller only calls it on a
//      genuine not-final → final transition, so a backfill (`mode: "all"`) that meets a
//      season of finished games stays silent.
//   3. It is off until it is switched on. With no DISCORD_RECAP_WEBHOOK_URL secret it
//      returns immediately, so deploying this changes nothing until you add the secret.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildRecap, leagueRecapContext } from '../../../src/wpbl/derive/recap.ts'
import { buildRecapMessage, recapMessageHash } from '../../../src/wpbl/derive/discordRecap.ts'
import { seriesContext } from '../../../src/wpbl/derive/series.ts'
// `.ts` because Deno resolves local specifiers literally. routes.ts carries the same
// extension on its own import for this reason; see the note there.
import { wpblGamePath } from '../../../src/wpbl/routes.ts'

export async function announceFinal(db: SupabaseClient, gameUuid: string): Promise<void> {
  const webhook = Deno.env.get('DISCORD_RECAP_WEBHOOK_URL') ?? ''
  if (!webhook) return   // not configured — the scheduled job remains the only poster

  try {
    // Claim the game first. An insert (not an upsert) against the primary key is what makes
    // this safe to race: if the scheduled job — or a previous pass — already has this game,
    // the insert conflicts, we stop, and nothing is double-posted. The empty hash is
    // corrected a few lines down, once there is a message to hash.
    const claim = await db.from('wpbl_discord_recap_posts')
      .insert({ game_id: gameUuid, message_id: null, content_hash: '' })
    if (claim.error) return   // already claimed (or the table is missing) — not ours to post

    const { data: game } = await db.from('wpbl_games').select('*').eq('id', gameUuid).single()
    if (!game) return
    const { data: allGames } = await db.from('wpbl_games').select('*')
    const { data: teamRows } = await db.from('wpbl_teams').select('*')
    const teams = new Map((teamRows ?? []).map((t: any) => [t.id, t]))

    const [batting, pitching, plays, players] = await Promise.all([
      db.from('wpbl_batting_lines').select('*').eq('game_id', gameUuid),
      db.from('wpbl_pitching_lines').select('*').eq('game_id', gameUuid),
      db.from('wpbl_game_plays').select('*').eq('game_id', gameUuid),
      db.from('wpbl_players').select('id, name'),
    ])
    const nameById = new Map((players.data ?? []).map((p: any) => [p.id, p.name]))

    // The series this game belongs to, so the fast path words a clincher the same way the
    // scheduled job would. It has to be worked out HERE and not left to that job: this poster
    // usually gets there first and owns the message, and a recap posted without the series
    // would be silently corrected minutes later by an edit nobody asked for. `allGames` is
    // already in hand for the URL below, and a series record needs the whole schedule for the
    // same reason a slug does.
    const recap = buildRecap(
      game as any, teams as any, (batting.data ?? []) as any, (pitching.data ?? []) as any,
      (plays.data ?? []) as any, (id: string) => nameById.get(id) ?? '—',
      leagueRecapContext((allGames ?? []) as any),
      seriesContext(game as any, (allGames ?? []) as any, teams as any),
    )
    // A tie, or a score the feed hasn't settled yet: release the claim so a later pass —
    // by either poster — can take it once the game is properly resolved.
    if (!recap) {
      await db.from('wpbl_discord_recap_posts').delete().eq('game_id', gameUuid)
      return
    }

    // The game's own page. `allGames` is already in hand above, and it has to be: a slug is
    // only unambiguous relative to the whole schedule.
    const url = `https://sportydolphin.fun${wpblGamePath(game as any, [...(teams as any).values()], (allGames ?? []) as any)}`
    const message = buildRecapMessage(game as any, recap, teams as any, url)
    const res = await fetch(`${webhook}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    })
    if (!res.ok) {
      // Hand the game back to the scheduled job rather than leaving a claim with no message.
      await db.from('wpbl_discord_recap_posts').delete().eq('game_id', gameUuid)
      console.warn(`[wpbl-ingest] Discord recap post failed (${res.status}): ${await res.text()}`)
      return
    }
    const posted = await res.json()
    await db.from('wpbl_discord_recap_posts').update({
      message_id: String(posted.id),
      content_hash: await recapMessageHash(message),
      updated_at: new Date().toISOString(),
    }).eq('game_id', gameUuid)
    console.log(`[wpbl-ingest] posted Discord recap for ${game.game_date}: ${recap.headline}`)
  } catch (e) {
    // Deliberately swallowed: a Discord outage is not an ingest failure, and the scheduled
    // job will post this game on its next pass.
    console.warn('[wpbl-ingest] announceFinal threw:', e instanceof Error ? e.message : e)
  }
}
