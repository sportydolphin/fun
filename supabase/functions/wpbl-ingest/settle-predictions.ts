// Settles the Discord predictions game on the ingest's own pass.
//
// This is what makes the game run itself. The ingest already pulls the feed every two minutes,
// which means it is holding the play-by-play that answers every open round moments after the
// league publishes it: locking a round whose half-inning has started, revealing the answer once
// the frame is over, and crowning one winner when the game goes final. Nobody has to sit at a
// keyboard for the game to work, and the mod commands stay a way to run it rather than a
// requirement for it to finish.
//
// The same three properties announce-final.ts is built around apply here, for the same reasons:
//   1. It can never break an ingest. Every path is inside its own try/catch, and settleGame
//      swallows its own failures too; the worst outcome is a round that settles on the next
//      pass instead of this one.
//   2. It is off until it is switched on. Without SUPABASE_SERVICE_ROLE_KEY (auto-injected) it
//      returns immediately, and with no rounds in the table it costs one cheap query.
//   3. The rules live elsewhere. Everything below is wiring: the grading is the same pure code
//      the Cloudflare function runs when a mod asks for the board, so the two can never
//      disagree about who was right.
import { createPredictStore } from '../../../src/wpbl/predictStore.ts'
import { settleGame, settleOpenRounds } from '../../../src/wpbl/predictEngine.ts'

function store() {
  return createPredictStore({
    url: Deno.env.get('SUPABASE_URL'),
    serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  })
}

// Optional, and only the Discord side of the job needs it: without it a round still grades and
// scores, but its card in the channel keeps looking open past the fifteen minutes its own
// interaction token lasts, and the winner cannot be announced automatically.
const botToken = () => Deno.env.get('DISCORD_BOT_TOKEN') ?? null

/** Lock and grade every round still live, on every pass. */
export async function settlePredictions(): Promise<void> {
  const db = store()
  if (!db) return
  try {
    const r = await settleOpenRounds(db, { botToken: botToken() })
    if (r.locked || r.graded || r.voided || r.crowned) {
      console.log(`[wpbl-ingest] predictions: ${r.locked} locked, ${r.graded} graded, ${r.voided} void${r.crowned ? ', winner crowned' : ''}`)
    }
  } catch (e) {
    console.warn('[wpbl-ingest] settlePredictions threw:', e instanceof Error ? e.message : e)
  }
}

/**
 * Crown the winner of a game that has just gone final.
 *
 * Separate from the pass above because that one starts from rounds that are still open, and a
 * game whose last round graded an inning before the final has none. The caller only invokes
 * this on a genuine not-final to final transition, the same gate announceFinal sits behind, so
 * a backfill meeting a season of finished games stays silent.
 */
export async function crownPredictions(gameUuid: string): Promise<void> {
  const db = store()
  if (!db) return
  try {
    const r = await settleGame(db, gameUuid, { botToken: botToken() })
    if (r.crowned) console.log(`[wpbl-ingest] predictions: crowned a winner for ${gameUuid}`)
  } catch (e) {
    console.warn('[wpbl-ingest] crownPredictions threw:', e instanceof Error ? e.message : e)
  }
}
