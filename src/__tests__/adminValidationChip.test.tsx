import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WpblValidationChip } from '../AdminPanel'

// The chip is the whole point of the nightly validation job: it never fails the workflow, so
// this indicator is the only place the state is visible. The thresholds are the logic, and
// getting "Stale" wrong would mean a job that quietly stopped still looking healthy.

const run = (over: Partial<Parameters<typeof WpblValidationChip>[0]['run']> = {}) => ({
  ran_at: new Date().toISOString(), ok: true, new_findings: 0, total_findings: 57, ...over,
})
const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60_000).toISOString()

describe('WpblValidationChip', () => {
  it('reads Clean when the run is recent with nothing new', () => {
    render(<WpblValidationChip run={run()} />)
    expect(screen.getByText('Clean')).toBeInTheDocument()
  })

  it('counts new findings rather than just saying something is wrong', () => {
    render(<WpblValidationChip run={run({ new_findings: 3 })} />)
    expect(screen.getByText('3 new')).toBeInTheDocument()
  })

  // The failure that actually needs attention: the job stopped running at all.
  it('goes Stale once a nightly run has been missed', () => {
    render(<WpblValidationChip run={run({ ran_at: hoursAgo(30) })} />)
    expect(screen.getByText('Stale')).toBeInTheDocument()
  })

  // GitHub's cron is best-effort, so a run slipping an hour is not worth an amber chip.
  it('tolerates a run that slipped a couple of hours', () => {
    render(<WpblValidationChip run={run({ ran_at: hoursAgo(25) })} />)
    expect(screen.getByText('Clean')).toBeInTheDocument()
  })

  it('shows Failed ahead of anything else when the run itself errored', () => {
    render(<WpblValidationChip run={run({ ok: false, new_findings: 9 })} />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })
})
