import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { ModalShell } from '../ModalShell'

// Every sheet and dialog on the site is this shell. It was a plain box: a screen reader heard
// more page, and focus stayed on the row behind the dim.

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Sort</button>
      {open && (
        <ModalShell eyebrow="Rank pitchers by" onClose={() => setOpen(false)}>
          <button>ERA</button>
        </ModalShell>
      )}
    </>
  )
}

describe('the modal shell', () => {
  it('is a modal dialog named by its heading, focused as it opens', () => {
    render(<Harness />)
    const opener = screen.getByText('Sort')
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Rank pitchers by' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(dialog)
  })

  it('gives focus back to what opened it when it closes', () => {
    render(<Harness />)
    const opener = screen.getByText('Sort')
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})
