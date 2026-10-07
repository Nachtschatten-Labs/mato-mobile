import { describe, expect, it } from 'vitest'
import { computePriceImpactPercent, isHighPriceImpact } from './price-impact'
import type { Address } from '@solana/kit'
import type { StreamingMarketState } from '../domain/models'

function marketState(): StreamingMarketState {
  return {
    baseMint: 'So11111111111111111111111111111111111111112' as Address,
    quoteMint: '11111111111111111111111111111111' as Address,
    marketId: 1,
    minimumBaseDepositAtoms: 1n,
    minimumQuoteDepositAtoms: 1n,
    isPaused: false,
    currentSlot: 100,
    endSlotInterval: 11,
    marketBaseFlow: 1_000_000_000_000n,
    marketQuoteFlow: 2_000_000_000_000n,
    bookkeepingBasePerQuote: 0n,
    bookkeepingQuotePerBase: 0n,
    bookkeepingLastUpdateSlot: 100,
    bookkeepingSlotsWithoutTrades: 0,
  }
}

describe('computePriceImpactPercent', () => {
  it('uses conservative fractional flow for buys without losing sub-atom flow', () => {
    expect(
      computePriceImpactPercent({
        amountAtoms: 1n,
        durationSlots: 25,
        side: 'buy',
        streamingState: marketState(),
      }),
    ).toBeCloseTo((1 / (25 - 11 / 2) / 2_000) * 100, 12)
  })

  it('includes the added user flow in the sell denominator', () => {
    const flow = 2_000 / (25 - 11 / 2)
    expect(
      computePriceImpactPercent({
        amountAtoms: 2_000n,
        durationSlots: 25,
        side: 'sell',
        streamingState: marketState(),
      }),
    ).toBeCloseTo((flow / (1_000 + flow)) * 100, 12)
  })

  it.each([0, 5, -25, 25.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid or nonpositive conservative duration (%s)',
    (durationSlots) => {
      expect(
        computePriceImpactPercent({
          amountAtoms: 100n,
          durationSlots,
          side: 'buy',
          streamingState: marketState(),
        }),
      ).toBeNull()
    },
  )

  it.each([null, 0n, -1n])(
    'requires positive order size (%s)',
    (amountAtoms) => {
      expect(
        computePriceImpactPercent({
          amountAtoms,
          durationSlots: 25,
          side: 'buy',
          streamingState: marketState(),
        }),
      ).toBeNull()
    },
  )

  it.each(['buy', 'sell'] as const)(
    'requires liquidity for the %s side',
    (side) => {
      expect(
        computePriceImpactPercent({
          amountAtoms: 100n,
          durationSlots: 25,
          side,
          streamingState: {
            ...marketState(),
            marketBaseFlow: 0n,
            marketQuoteFlow: 0n,
          },
        }),
      ).toBeNull()
    },
  )
})

describe('price impact warnings', () => {
  it('warns only above the high-impact threshold', () => {
    expect(isHighPriceImpact(null)).toBe(false)
    expect(isHighPriceImpact(1)).toBe(false)
    expect(isHighPriceImpact(1.001)).toBe(true)
  })
})
