import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../lib/admin', () => ({ useIsAdmin: () => false }))

import ChangelogDialogs from '../ChangelogDialogs'
import { ENTRIES as OLDEST } from '../changelog/v1.000-1.049'

// The two older archives load only when a reader asks for earlier updates (see changelog.ts), so
// the button has to stay up while they are unloaded, even once the eager releases are all shown.
describe('What\'s new', () => {
  it('fetches the older releases on "Show earlier updates"', async () => {
    render(<ChangelogDialogs open onClose={() => {}} />)
    const first = OLDEST[OLDEST.length - 1].changes[0].short
    expect(screen.queryByText(first)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show earlier updates' }))
    await waitFor(() => expect(screen.getByText(first)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /earlier updates/ })).toBeNull()
  })
})
