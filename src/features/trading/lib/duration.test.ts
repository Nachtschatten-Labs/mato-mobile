import { describe, expect, it } from 'vitest'
import {
  MAX_DURATION_SLOTS,
  MIN_DURATION_SLOTS,
  recommendDurationSlots,
  SLOTS_PER_MINUTE,
} from './duration'
import { computePriceImpactPercent } from './price-impact'
import { SLOT_DURATION_SECONDS } from '../constants'
import type { Address } from '@solana/kit'
import type { StreamingMarketState } from '../domain/models'

function marketState(
  overrides: Partial<StreamingMarketState> = {},
): StreamingMarketState {
  return {
    baseMint: 'So11111111111111111111111111111111111111112' as Address,
    quoteMint: '11111111111111111111111111111111' as Address,
    marketId: 1,
    minimumBaseDepositAtoms: 1n,
    minimumQuoteDepositAtoms: 1n,
    isPaused: false,
    currentSlot: 100,
    endSlotInterval: 10,
    marketBaseFlow: 10_000_000_000_000_000n,
    marketQuoteFlow: 10_000_000_000_000_000n,
    bookkeepingBasePerQuote: 0n,
    bookkeepingQuotePerBase: 0n,
    bookkeepingLastUpdateSlot: 100,
    bookkeepingSlotsWithoutTrades: 0,
    ...overrides,
  }
}

describe('recommendDurationSlots', () => {
  it('starts at 25 slots when the minimum is below the impact target', () => {
    expect(
      recommendDurationSlots({
        amountAtoms: 30n,
        side: 'buy',
        streamingState: marketState(),
      }),
    ).toBe(MIN_DURATION_SLOTS)
  })

  it.each([
    [25_000n, 31],
    [(BigInt(SLOTS_PER_MINUTE) - 6n) * 1_000n, SLOTS_PER_MINUTE],
    [(BigInt(SLOTS_PER_MINUTE) - 5n) * 1_000n, 2 * SLOTS_PER_MINUTE],
    [(BigInt(2 * SLOTS_PER_MINUTE) - 6n) * 1_000n, 2 * SLOTS_PER_MINUTE],
    [(BigInt(2 * SLOTS_PER_MINUTE) - 5n) * 1_000n, 3 * SLOTS_PER_MINUTE],
  ] as const)(
    'chooses the shortest eligible duration for %s atoms',
    (amountAtoms, expected) => {
      const inputs = {
        amountAtoms,
        side: 'buy' as const,
        streamingState: marketState(),
      }
      const durationSlots = recommendDurationSlots(inputs)!
      const previousDuration =
        durationSlots <= SLOTS_PER_MINUTE
          ? durationSlots - 1
          : durationSlots - SLOTS_PER_MINUTE

      expect(durationSlots).toBe(expected)
      expect(
        computePriceImpactPercent({ ...inputs, durationSlots }),
      ).toBeLessThan(0.01)
      expect(
        computePriceImpactPercent({
          ...inputs,
          durationSlots: previousDuration,
        }),
      ).toBeGreaterThanOrEqual(0.01)
    },
  )

  it('accounts for the full half interval when the interval is odd', () => {
    expect(
      recommendDurationSlots({
        amountAtoms: 30_000n,
        side: 'buy',
        streamingState: marketState({ endSlotInterval: 11 }),
      }),
    ).toBe(36)
  })

  it('uses the sell impact denominator and rejects exact equality', () => {
    const inputs = {
      amountAtoms: 25_000n,
      side: 'sell' as const,
      streamingState: marketState({ marketBaseFlow: 9_999_000_000_000_000n }),
    }

    expect(computePriceImpactPercent({ ...inputs, durationSlots: 30 })).toBe(
      0.01,
    )
    expect(recommendDurationSlots(inputs)).toBe(31)
  })

  it('keeps threshold decisions exact for amounts beyond number precision', () => {
    const factor = 9_007_199_254_741_001n
    const inputs = {
      side: 'buy' as const,
      streamingState: marketState({
        marketQuoteFlow: factor * 10_000_000_000_000n,
      }),
    }

    expect(
      recommendDurationSlots({ ...inputs, amountAtoms: factor * 25n - 1n }),
    ).toBe(30)
    expect(
      recommendDurationSlots({ ...inputs, amountAtoms: factor * 25n }),
    ).toBe(31)
  })

  it('increases the recommendation with order size and decreases it with liquidity', () => {
    const inputs = {
      amountAtoms: 100_000n,
      side: 'buy' as const,
      streamingState: marketState(),
    }

    expect(recommendDurationSlots(inputs)).toBe(106)
    expect(recommendDurationSlots({ ...inputs, amountAtoms: 200_000n })).toBe(
      206,
    )
    expect(
      recommendDurationSlots({
        ...inputs,
        streamingState: marketState({
          marketQuoteFlow: 20_000_000_000_000_000n,
        }),
      }),
    ).toBe(56)
  })

  it('allows exactly one year on the minute-aligned duration grid', () => {
    expect(MAX_DURATION_SLOTS * SLOT_DURATION_SECONDS).toBe(365 * 24 * 60 * 60)
    expect(MAX_DURATION_SLOTS % SLOTS_PER_MINUTE).toBe(0)
    expect(MAX_DURATION_SLOTS).toBeLessThanOrEqual(160_000_000)
    expect(
      recommendDurationSlots({
        amountAtoms: (BigInt(MAX_DURATION_SLOTS) - 6n) * 1_000n,
        side: 'buy',
        streamingState: marketState(),
      }),
    ).toBe(MAX_DURATION_SLOTS)
  })

  it('keeps one year when meeting the strict target would require one more minute', () => {
    expect(
      recommendDurationSlots({
        amountAtoms: (BigInt(MAX_DURATION_SLOTS) - 5n) * 1_000n,
        side: 'buy',
        streamingState: marketState(),
      }),
    ).toBe(MAX_DURATION_SLOTS)
  })

  it.each(['buy', 'sell'] as const)(
    'caps %s recommendations at one year while impact increases with order size',
    (side) => {
      const inputs = {
        amountAtoms: BigInt(MAX_DURATION_SLOTS) * 2_000n,
        side,
        streamingState: marketState(),
      }
      const durationSlots = recommendDurationSlots(inputs)!
      const impact = computePriceImpactPercent({ ...inputs, durationSlots })!
      const largerOrder = { ...inputs, amountAtoms: inputs.amountAtoms * 2n }

      expect(durationSlots).toBe(MAX_DURATION_SLOTS)
      expect(impact).toBeGreaterThan(0.01)
      expect(recommendDurationSlots(largerOrder)).toBe(MAX_DURATION_SLOTS)
      expect(
        computePriceImpactPercent({ ...largerOrder, durationSlots }),
      ).toBeGreaterThan(impact)
    },
  )

  it.each([10, 11])(
    'requires one input atom per slot at the longest endpoint for interval %s',
    (endSlotInterval) => {
      const inputs = {
        side: 'buy' as const,
        streamingState: marketState({ endSlotInterval }),
      }

      expect(recommendDurationSlots({ ...inputs, amountAtoms: 29n })).toBeNull()
      expect(recommendDurationSlots({ ...inputs, amountAtoms: 30n })).toBe(25)
    },
  )

  it('returns no recommendation when the impact target requires less than one atom per slot', () => {
    expect(
      recommendDurationSlots({
        amountAtoms: 1_000_000n,
        side: 'buy',
        streamingState: marketState({ marketQuoteFlow: 10_000_000_000_000n }),
      }),
    ).toBeNull()
  })

  it.each([null, 0n, -1n])(
    'requires a positive order size (%s)',
    (amountAtoms) => {
      expect(
        recommendDurationSlots({
          amountAtoms,
          side: 'buy',
          streamingState: marketState(),
        }),
      ).toBeNull()
    },
  )

  it.each([
    null,
    undefined,
    marketState({ marketBaseFlow: 0n }),
    marketState({ marketQuoteFlow: 0n }),
    marketState({ marketQuoteFlow: -1n }),
    marketState({ endSlotInterval: 0 }),
    marketState({ endSlotInterval: 1.5 }),
    marketState({ endSlotInterval: Number.NaN }),
  ])(
    'requires complete valid market liquidity and timing',
    (streamingState) => {
      expect(
        recommendDurationSlots({
          amountAtoms: 100_000n,
          side: 'buy',
          streamingState,
        }),
      ).toBeNull()
    },
  )
})
