import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePoopGame } from '../hooks/usePoopGame'

// Mock the hook
vi.mock('../hooks/usePoopGame', () => ({
  usePoopGame: vi.fn(),
}))

const mockUsePoopGame = vi.mocked(usePoopGame)

describe('PoopGame', () => {
  let PoopGame: any

  beforeAll(async () => {
    const mod = await import('../PoopGame')
    PoopGame = mod.default
  })

  beforeEach(() => {
    mockUsePoopGame.mockClear()
    mockUsePoopGame.mockReturnValue({
      count: 0,
      critChance: 0,
      critCost: 10,
      diarrheaBoys: 0,
      diarrheaCost: 50,
      holdEnabled: false,
      holdSpeed: 1,
      bowelTier: 0,
      lastGain: null,
      lastWasCrit: false,
      flyingPoops: [],
      pile: [],
      addPoop: vi.fn(),
      reset: vi.fn(),
      buyCrit: vi.fn(),
      buyDiarrheaBoy: vi.fn(),
      buyHold: vi.fn(),
      buyHoldSpeed: vi.fn(),
      buyBowelTier: vi.fn(),
      nextTierCostFor: vi.fn((tier) => 1000 * Math.pow(10, tier)),
      holdSpeedCostFor: vi.fn(),
      holdCost: 100,
      BOWEL_TIERS: [
        { name: 'Paper Bowels', color: '#e6e6e6', emoji: '🧻' },
        { name: 'Wood Bowels', color: '#c18f5d', emoji: '🪵' },
      ],
    })
  })

  it('renders the game title', () => {
    render(<PoopGame />)
    expect(screen.getByText('Poop Pile')).toBeInTheDocument()
  })

  it('displays the current count', () => {
    mockUsePoopGame.mockReturnValue({
      ...mockUsePoopGame(),
      count: 42,
    })
    render(<PoopGame />)
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('shows crit chance and diarrhea boys', () => {
    mockUsePoopGame.mockReturnValue({
      ...mockUsePoopGame(),
      critChance: 5,
      diarrheaBoys: 2,
    })
    render(<PoopGame />)
    expect(screen.getByText('5% · 2')).toBeInTheDocument()
  })

  it('calls addPoop when poop button is clicked', async () => {
    const mockAddPoop = vi.fn()
    mockUsePoopGame.mockReturnValue({
      ...mockUsePoopGame(),
      addPoop: mockAddPoop,
    })
    render(<PoopGame />)

    const button = screen.getByRole('button', { name: /💩/ })
    await userEvent.click(button)

    expect(mockAddPoop).toHaveBeenCalledTimes(1)
  })

  it('shows crit upgrade button when count >= 10', () => {
    mockUsePoopGame.mockReturnValue({
      ...mockUsePoopGame(),
      count: 15,
    })
    render(<PoopGame />)

    expect(screen.getByText('+1% crit (10)')).toBeInTheDocument()
  })

  it('does not show crit upgrade button when count < 10 and critChance = 0', () => {
    render(<PoopGame />)

    expect(screen.queryByText('+1% crit')).not.toBeInTheDocument()
  })

  it('shows diarrhea boy upgrade when count >= 50', () => {
    mockUsePoopGame.mockReturnValue({
      ...mockUsePoopGame(),
      count: 60,
    })
    render(<PoopGame />)

    expect(screen.getByText('Diarrhea boy')).toBeInTheDocument()
    expect(screen.getByText('+1 boy (50)')).toBeInTheDocument()
  })

  it('shows hold unlock when count >= 10', () => {
    mockUsePoopGame.mockReturnValue({
      ...mockUsePoopGame(),
      count: 15,
    })
    render(<PoopGame />)

    expect(screen.getByText('Hold unlock (100)')).toBeInTheDocument()
  })

  it('shows bowel tier upgrade info', () => {
    render(<PoopGame />)

    expect(screen.getByText('Your bowels:')).toBeInTheDocument()
    expect(screen.getByText('Paper Bowels')).toBeInTheDocument()
    expect(screen.getByText(content => content.includes('Upgrade to: Wood Bowels at 1,000 poops'))).toBeInTheDocument()
  })

  it('calls buyCrit when crit button is clicked', async () => {
    const mockBuyCrit = vi.fn()
    mockUsePoopGame.mockReturnValue({
      ...mockUsePoopGame(),
      count: 15,
      buyCrit: mockBuyCrit,
    })
    render(<PoopGame />)

    const button = screen.getByText('+1% crit (10)')
    await userEvent.click(button)

    expect(mockBuyCrit).toHaveBeenCalledTimes(1)
  })

  it('calls buyDiarrheaBoy when diarrhea button is clicked', async () => {
    const mockBuyDiarrheaBoy = vi.fn()
    mockUsePoopGame.mockReturnValue({
      ...mockUsePoopGame(),
      count: 60,
      buyDiarrheaBoy: mockBuyDiarrheaBoy,
    })
    render(<PoopGame />)

    const button = screen.getByText('+1 boy (50)')
    await userEvent.click(button)

    expect(mockBuyDiarrheaBoy).toHaveBeenCalledTimes(1)
  })

  it('calls reset when reset button is clicked', async () => {
    const mockReset = vi.fn()
    mockUsePoopGame.mockReturnValue({
      ...mockUsePoopGame(),
      reset: mockReset,
    })
    render(<PoopGame />)

    // Open details
    const summary = screen.getByText('Options')
    fireEvent.click(summary)

    const resetButton = screen.getByText('Reset Game')
    await userEvent.click(resetButton)

    expect(mockReset).toHaveBeenCalledTimes(1)
  })

  it('displays flying poops', () => {
    mockUsePoopGame.mockReturnValue({
      count: 0,
      critChance: 0,
      critCost: 10,
      diarrheaBoys: 0,
      diarrheaCost: 50,
      holdEnabled: false,
      holdSpeed: 1,
      bowelTier: 0,
      lastGain: null,
      lastWasCrit: false,
      flyingPoops: [
        { id: 1, left: 10, delay: 0 },
        { id: 2, left: -5, delay: 100 },
      ],
      pile: [],
      addPoop: vi.fn(),
      reset: vi.fn(),
      buyCrit: vi.fn(),
      buyDiarrheaBoy: vi.fn(),
      buyHold: vi.fn(),
      buyHoldSpeed: vi.fn(),
      buyBowelTier: vi.fn(),
      nextTierCostFor: vi.fn((tier) => 1000 * Math.pow(10, tier)),
      holdSpeedCostFor: vi.fn(),
      holdCost: 100,
      BOWEL_TIERS: [
        { name: 'Paper Bowels', color: '#e6e6e6', emoji: '🧻' },
        { name: 'Wood Bowels', color: '#c18f5d', emoji: '🪵' },
      ],
    })
    render(<PoopGame />)

    const flyingPoops = screen.getAllByText('💩')
    // First is the button, then flying ones
    expect(flyingPoops).toHaveLength(3) // button + 2 flying
  })

  it('shows last gain when present', () => {
    mockUsePoopGame.mockReturnValue({
      count: 0,
      critChance: 0,
      critCost: 10,
      diarrheaBoys: 0,
      diarrheaCost: 50,
      holdEnabled: false,
      holdSpeed: 1,
      bowelTier: 0,
      lastGain: 5,
      lastWasCrit: true,
      flyingPoops: [],
      pile: [],
      addPoop: vi.fn(),
      reset: vi.fn(),
      buyCrit: vi.fn(),
      buyDiarrheaBoy: vi.fn(),
      buyHold: vi.fn(),
      buyHoldSpeed: vi.fn(),
      buyBowelTier: vi.fn(),
      nextTierCostFor: vi.fn((tier) => 1000 * Math.pow(10, tier)),
      holdSpeedCostFor: vi.fn(),
      holdCost: 100,
      BOWEL_TIERS: [
        { name: 'Paper Bowels', color: '#e6e6e6', emoji: '🧻' },
        { name: 'Wood Bowels', color: '#c18f5d', emoji: '🪵' },
      ],
    })
    render(<PoopGame />)

    expect(screen.getByText('+5 CRIT!')).toBeInTheDocument()
  })

  it('displays pile emojis', () => {
    mockUsePoopGame.mockReturnValue({
      count: 0,
      critChance: 0,
      critCost: 10,
      diarrheaBoys: 0,
      diarrheaCost: 50,
      holdEnabled: false,
      holdSpeed: 1,
      bowelTier: 0,
      lastGain: null,
      lastWasCrit: false,
      flyingPoops: [],
      pile: [
        <span key={1}>💩</span>,
        <span key={2}>💩</span>,
      ],
      addPoop: vi.fn(),
      reset: vi.fn(),
      buyCrit: vi.fn(),
      buyDiarrheaBoy: vi.fn(),
      buyHold: vi.fn(),
      buyHoldSpeed: vi.fn(),
      buyBowelTier: vi.fn(),
      nextTierCostFor: vi.fn((tier) => 1000 * Math.pow(10, tier)),
      holdSpeedCostFor: vi.fn(),
      holdCost: 100,
      BOWEL_TIERS: [
        { name: 'Paper Bowels', color: '#e6e6e6', emoji: '🧻' },
        { name: 'Wood Bowels', color: '#c18f5d', emoji: '🪵' },
      ],
    })
    render(<PoopGame />)

    const pileEmojis = screen.getAllByText('💩')
    expect(pileEmojis).toHaveLength(3) // button + 2 in pile
  })

  it('shows progress bar for bowel tier', () => {
    mockUsePoopGame.mockReturnValue({
      count: 500,
      critChance: 0,
      critCost: 10,
      diarrheaBoys: 0,
      diarrheaCost: 50,
      holdEnabled: false,
      holdSpeed: 1,
      bowelTier: 0,
      lastGain: null,
      lastWasCrit: false,
      flyingPoops: [],
      pile: [],
      addPoop: vi.fn(),
      reset: vi.fn(),
      buyCrit: vi.fn(),
      buyDiarrheaBoy: vi.fn(),
      buyHold: vi.fn(),
      buyHoldSpeed: vi.fn(),
      buyBowelTier: vi.fn(),
      nextTierCostFor: vi.fn((tier) => 1000 * Math.pow(10, tier)),
      holdSpeedCostFor: vi.fn(),
      holdCost: 100,
      BOWEL_TIERS: [
        { name: 'Paper Bowels', color: '#e6e6e6', emoji: '🧻' },
        { name: 'Wood Bowels', color: '#c18f5d', emoji: '🪵' },
      ],
    })
    render(<PoopGame />)

    // Should show upgrade text
    expect(screen.getByText(content => content.includes('Upgrade to: Wood Bowels at 1,000 poops'))).toBeInTheDocument()
  })

  it('disables buttons when insufficient poops', async () => {
    mockUsePoopGame.mockReturnValue({
      count: 5,
      critChance: 0,
      critCost: 10,
      diarrheaBoys: 0,
      diarrheaCost: 50,
      holdEnabled: false,
      holdSpeed: 1,
      bowelTier: 0,
      lastGain: null,
      lastWasCrit: false,
      flyingPoops: [],
      pile: [],
      addPoop: vi.fn(),
      reset: vi.fn(),
      buyCrit: vi.fn(),
      buyDiarrheaBoy: vi.fn(),
      buyHold: vi.fn(),
      buyHoldSpeed: vi.fn(),
      buyBowelTier: vi.fn(),
      nextTierCostFor: vi.fn((tier) => 1000 * Math.pow(10, tier)),
      holdSpeedCostFor: vi.fn(),
      holdCost: 100,
      BOWEL_TIERS: [
        { name: 'Paper Bowels', color: '#e6e6e6', emoji: '🧻' },
        { name: 'Wood Bowels', color: '#c18f5d', emoji: '🪵' },
      ],
    })
    render(<PoopGame />)

    const optionsSummary = screen.getByText('Options')
    await userEvent.click(optionsSummary)

    const critButton = screen.getByText('+1% crit (10)')
    expect(critButton).toBeDisabled()
  })

  it('shows hold speed upgrade when hold enabled and conditions met', () => {
    mockUsePoopGame.mockReturnValue({
      count: 0,
      critChance: 0,
      critCost: 10,
      diarrheaBoys: 0,
      diarrheaCost: 50,
      holdEnabled: true,
      holdSpeed: 1,
      bowelTier: 1,
      lastGain: null,
      lastWasCrit: false,
      flyingPoops: [],
      pile: [],
      addPoop: vi.fn(),
      reset: vi.fn(),
      buyCrit: vi.fn(),
      buyDiarrheaBoy: vi.fn(),
      buyHold: vi.fn(),
      buyHoldSpeed: vi.fn(),
      buyBowelTier: vi.fn(),
      nextTierCostFor: vi.fn((tier) => 1000 * Math.pow(10, tier)),
      holdSpeedCostFor: vi.fn(),
      holdCost: 100,
      BOWEL_TIERS: [
        { name: 'Paper Bowels', color: '#e6e6e6', emoji: '🧻' },
        { name: 'Wood Bowels', color: '#c18f5d', emoji: '🪵' },
      ],
    })
    render(<PoopGame />)

    expect(screen.getByText('Hold speed')).toBeInTheDocument()
    expect(screen.getByText('1x/sec')).toBeInTheDocument()
  })
})