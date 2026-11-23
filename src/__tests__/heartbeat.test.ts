import { describe, it, expect } from 'vitest'
import { runWithHeartbeat } from '../../shared/heartbeat.js'

// Every cron job reaches /admin's Health group through this wrapper, so these are the three ways
// a run can end and what each must record.

type Row = Record<string, unknown>
const fakeSupabase = () => {
  const rows: Row[] = []
  return {
    rows,
    from: () => ({ upsert: async (row: Row) => { rows.push(row); return { error: null } } }),
  }
}

describe('runWithHeartbeat', () => {
  it('records a clean run as ok', async () => {
    const db = fakeSupabase()
    await runWithHeartbeat(db, 'job', async () => undefined)
    expect(db.rows).toMatchObject([{ job: 'job', ok: true, detail: null }])
  })

  it('records a run that finished but did not work, without failing the process', async () => {
    // The watchers exit 0 on a source outage so the workflow stays green; this is how /admin
    // still sees it.
    const db = fakeSupabase()
    const out = await runWithHeartbeat(db, 'job', async () => ({ ok: false, detail: 'every source down' }))
    expect(out).toEqual({ ok: false, detail: 'every source down' })
    expect(db.rows).toMatchObject([{ ok: false, detail: 'every source down' }])
  })

  it('records a crash and rethrows it, so the script still exits 1', async () => {
    const db = fakeSupabase()
    await expect(runWithHeartbeat(db, 'job', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(db.rows).toMatchObject([{ ok: false, detail: 'boom' }])
  })

  it('writes nothing for a dry run, a test post or a missing client', async () => {
    const db = fakeSupabase()
    await runWithHeartbeat(db, 'job', async () => undefined, { skip: true })
    await runWithHeartbeat(null, 'job', async () => undefined)
    expect(db.rows).toEqual([])
  })
})
