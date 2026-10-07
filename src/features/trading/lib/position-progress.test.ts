import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Address } from '@solana/kit'
import type { TradePosition } from '@/lib/generated/twob/src/generated/accounts'
import type { StreamingMarketState } from '../domain/models'
import { Side } from '@/lib/generated/twob/src/generated/types'

function createPosition(overrides: Partial<TradePosition> = {}): TradePosition {
  return {
    amount: 100n,
    authority: 'authority1111111111111111111111111111111111' as Address,
    baseReceiver: 'baseReceiver111111111111111111111111111111' as Address,
    padding: new Uint8Array(9),
    bookkeepingSnapshot: 0n,
    bump: 0,
    discriminator: new Uint8Array(8),
    flow: 10_000_000_000n,
    id: 42,
    inactiveRefund: 0n,
    lastUpdateSlot: 0n,
    market: '11111111111111111111111111111111' as Address,
    feeBpsAtSubmission: 10,
    operator: 'operator111111111111111111111111111111111' as Address,
    pausedAtSlot: 0n,
    payer: 'payer1111111111111111111111111111111111111' as Address,
    quoteReceiver: 'quoteReceiver11111111111111111111111111111' as Address,
    remainingSlots: 10,
    side: Side.Buy,
    slotsWithoutTradesSnapshot: 0,
    startSlot: 0n,
    swappedAmountAtSnapshot: 0n,
    withdrawnAmount: 0n,
    ...overrides,
  }
}

function createStreamingState(
  currentSlot: number,
  bookkeepingBasePerQuote: bigint,
): StreamingMarketState {
  return {
    baseMint: 'So11111111111111111111111111111111111111112' as Address,
    bookkeepingBasePerQuote,
    bookkeepingLastUpdateSlot: currentSlot,
    bookkeepingSlotsWithoutTrades: 0,
    bookkeepingQuotePerBase: 0n,
    currentSlot,
    endSlotInterval: 5,
    isPaused: false,
    marketBaseFlow: 1n,
    marketId: 1,
    marketQuoteFlow: 1n,
    minimumBaseDepositAtoms: 1n,
    minimumQuoteDepositAtoms: 1n,
    quoteMint: '11111111111111111111111111111111' as Address,
  }
}

describe('getActivePositionMetrics', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('freezes a paused position and keeps its snapshotted funds withdrawable', async () => {
    const { getActivePositionMetrics } = await import('./position-progress')
    const position = createPosition({
      lastUpdateSlot: 5n,
      pausedAtSlot: 5n,
      remainingSlots: 5,
      swappedAmountAtSnapshot: 40n,
      withdrawnAmount: 10n,
    })
    const input = {
      baseDecimals: 0,
      baseTicker: 'SOL',
      endSlotBookkeepingSnapshot: null,
      market: 'market111111111111111111111111111111111111' as Address,
      position,
      quoteDecimals: 0,
      quoteTicker: 'USDC',
    }

    const first = getActivePositionMetrics({
      ...input,
      streamingState: createStreamingState(20, 20_000_000_000_000_000n),
    })
    const later = getActivePositionMetrics({
      ...input,
      streamingState: createStreamingState(100, 100_000_000_000_000_000n),
    })

    expect(first).toMatchObject({
      claimableSwappedAtoms: 30n,
      hasPositionEnded: false,
      isPaused: true,
      progressPercent: 50,
      remainingAtoms: 50n,
      swappedAtoms: 40n,
    })
    expect(later).toMatchObject({
      claimableSwappedAtoms: 30n,
      hasPositionEnded: false,
      progressPercent: 50,
      remainingAtoms: 50n,
      swappedAtoms: 40n,
    })
  })

  it('adds live accrual to the snapshotted swapped total', async () => {
    const { getActivePositionMetrics } = await import('./position-progress')
    const metrics = getActivePositionMetrics({
      baseDecimals: 0,
      baseTicker: 'SOL',
      endSlotBookkeepingSnapshot: null,
      market: 'market111111111111111111111111111111111111' as Address,
      position: createPosition({
        swappedAmountAtSnapshot: 20n,
        withdrawnAmount: 15n,
      }),
      quoteDecimals: 0,
      quoteTicker: 'USDC',
      streamingState: createStreamingState(2, 2_000_000_000_000_000n),
    })

    expect(metrics.swappedAtoms).toBe(40n)
    expect(metrics.claimableSwappedAtoms).toBe(25n)
  })

  it('makes only newly accrued funds claimable after a withdrawal', async () => {
    const { getActivePositionMetrics } = await import('./position-progress')
    const metrics = getActivePositionMetrics({
      baseDecimals: 0,
      baseTicker: 'SOL',
      endSlotBookkeepingSnapshot: null,
      market: 'market111111111111111111111111111111111111' as Address,
      position: createPosition({
        padding: new Uint8Array(9),
        bookkeepingSnapshot: 2_000_000_000_000_000n,
        swappedAmountAtSnapshot: 20n,
        withdrawnAmount: 20n,
      }),
      quoteDecimals: 0,
      quoteTicker: 'USDC',
      streamingState: createStreamingState(3, 3_000_000_000_000_000n),
    })

    expect(metrics.swappedAtoms).toBe(30n)
    expect(metrics.claimableSwappedAtoms).toBe(10n)
  })

  it('does not carry a pre-withdraw estimate into the updated snapshot', async () => {
    const { getActivePositionMetrics } = await import('./position-progress')
    const input = {
      baseDecimals: 0,
      baseTicker: 'SOL',
      endSlotBookkeepingSnapshot: null,
      market: 'market111111111111111111111111111111111111' as Address,
      quoteDecimals: 0,
      quoteTicker: 'USDC',
    }

    const beforeWithdrawal = getActivePositionMetrics({
      ...input,
      position: createPosition(),
      streamingState: createStreamingState(9, 10_000_000_000_000_000n),
    })
    const afterWithdrawal = getActivePositionMetrics({
      ...input,
      position: createPosition({
        padding: new Uint8Array(9),
        bookkeepingSnapshot: 9_000_000_000_000_000n,
        swappedAmountAtSnapshot: 90n,
        withdrawnAmount: 90n,
      }),
      streamingState: createStreamingState(9, 9_000_000_000_000_000n),
    })

    expect(beforeWithdrawal.claimableSwappedAtoms).toBe(100n)
    expect(afterWithdrawal.claimableSwappedAtoms).toBe(0n)
  })

  it('keeps estimates isolated between markets', async () => {
    const { getActivePositionMetrics } = await import('./position-progress')
    const position = createPosition()
    const sharedInput = {
      baseDecimals: 0,
      baseTicker: 'SOL',
      endSlotBookkeepingSnapshot: null,
      position,
      quoteDecimals: 0,
      quoteTicker: 'USDC',
    }

    getActivePositionMetrics({
      ...sharedInput,
      market: 'marketA11111111111111111111111111111111111' as Address,
      streamingState: createStreamingState(9, 10_000_000_000_000_000n),
    })
    const secondMarket = getActivePositionMetrics({
      ...sharedInput,
      market: 'marketB11111111111111111111111111111111111' as Address,
      streamingState: createStreamingState(1, 1_000_000_000_000_000n),
    })

    expect(secondMarket.positionKey).toContain(
      'marketB11111111111111111111111111111111111',
    )
    expect(secondMarket.swappedAtoms).toBe(10n)
  })

  it('matches the program truncation order for small fractional flows', async () => {
    const { getActivePositionMetrics } = await import('./position-progress')
    const metrics = getActivePositionMetrics({
      baseDecimals: 0,
      baseTicker: 'SOL',
      endSlotBookkeepingSnapshot: null,
      market: 'market111111111111111111111111111111111111' as Address,
      position: createPosition({ flow: 19_999n }),
      quoteDecimals: 0,
      quoteTicker: 'USDC',
      streamingState: createStreamingState(1, 60_000_000_000_000_000_000n),
    })

    expect(metrics.swappedAtoms).toBe(0n)
  })
})

// Accounting values from the 200 USDC order at slots 454047222–454047374.
// The maker stopped for 14 + 16 + 1 slots; the remaining 121 slots traded.
const incidentPosition = createPosition({
  amount: 200_000_000n,
  flow: 1_315_789_473_684_210n,
  bookkeepingSnapshot: 177_046_755_476_474_378_541n,
  startSlot: 454_047_222n,
  lastUpdateSlot: 454_047_222n,
  remainingSlots: 152,
  slotsWithoutTradesSnapshot: 163_093,
})
const incidentSnapshot = {
  slot: 454_047_374,
  bookkeeping: 178_048_803_853_655_046_724n,
  slotsWithoutTrades: 163_124,
}

async function metricsFor(
  overrides: Partial<
    Parameters<typeof import('./position-progress').getActivePositionMetrics>[0]
  > = {},
) {
  const { getActivePositionMetrics } = await import('./position-progress')
  return getActivePositionMetrics({
    baseDecimals: 0,
    baseTicker: 'SOL',
    quoteDecimals: 0,
    quoteTicker: 'USDC',
    market: 'market111111111111111111111111111111111111' as Address,
    position: createPosition(),
    endSlotBookkeepingSnapshot: null,
    streamingState: createStreamingState(5, 5_000_000_000_000_000n),
    ...overrides,
  })
}

describe('inactive-slot accounting', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('matches the real order settlement instead of displaying 200 USDC spent', async () => {
    const metrics = await metricsFor({
      position: incidentPosition,
      baseDecimals: 9,
      quoteDecimals: 6,
      endSlotBookkeepingSnapshot: incidentSnapshot,
      streamingState: {
        ...createStreamingState(
          454_048_611,
          incidentSnapshot.bookkeeping + 100n,
        ),
        // Later inactive slots must not be attributed to this ended order.
        bookkeepingSlotsWithoutTrades: 164_000,
      },
    })
    expect(metrics).toMatchObject({
      hasPositionEnded: true,
      consumedAtoms: 159_210_527n,
      remainingAtoms: 40_789_473n,
      swappedAtoms: 1_318_484_706n,
      progressPercent: 79.61,
    })
    expect(metrics.averagePrice).toBeCloseTo(120.7526536147777, 10)
  })

  it.each([Side.Buy, Side.Sell])(
    'excludes inactive slots for side %s',
    async (side) => {
      const metrics = await metricsFor({
        position: createPosition({ side, slotsWithoutTradesSnapshot: 100 }),
        streamingState: {
          ...createStreamingState(5, 3_000_000_000_000_000n),
          bookkeepingQuotePerBase: 3_000_000_000_000_000n,
          bookkeepingSlotsWithoutTrades: 102,
        },
      })
      expect(metrics).toMatchObject({
        consumedAtoms: 30n,
        remainingAtoms: 70n,
        progressPercent: 30,
        swappedAtoms: 30n,
        averagePrice: 1,
      })
    },
  )

  it.each(['marketBaseFlow', 'marketQuoteFlow'] as const)(
    'stops increasing spent while %s is zero, before the next bookkeeping update',
    async (flow) => {
      const state = {
        ...createStreamingState(5, 3_000_000_000_000_000n),
        bookkeepingLastUpdateSlot: 3,
        [flow]: 0n,
      }
      const first = await metricsFor({ streamingState: state })
      const later = await metricsFor({
        streamingState: { ...state, currentSlot: 9 },
      })
      expect(first).toMatchObject({
        consumedAtoms: 30n,
        remainingAtoms: 70n,
        swappedAtoms: 30n,
      })
      expect(later).toMatchObject({
        consumedAtoms: 30n,
        remainingAtoms: 70n,
        swappedAtoms: 30n,
      })
    },
  )

  it('continues spending after flow resumes without consuming the inactive refund', async () => {
    const state = {
      ...createStreamingState(7, 3_000_000_000_000_000n),
      bookkeepingLastUpdateSlot: 5,
      bookkeepingSlotsWithoutTrades: 2,
    }
    expect(await metricsFor({ streamingState: state })).toMatchObject({
      consumedAtoms: 50n,
      remainingAtoms: 50n,
      swappedAtoms: 50n,
    })
  })

  it('keeps refunds accumulated before a pause and after a resume', async () => {
    const position = createPosition({
      lastUpdateSlot: 5n,
      remainingSlots: 5,
      inactiveRefund: 20n,
      swappedAmountAtSnapshot: 30n,
      bookkeepingSnapshot: 3_000_000_000_000_000n,
      slotsWithoutTradesSnapshot: 100,
    })
    const paused = await metricsFor({
      position: {
        ...position,
        pausedAtSlot: 5n,
        slotsWithoutTradesSnapshot: 0xffff_ffff,
      },
      streamingState: null,
    })
    expect(paused).toMatchObject({
      consumedAtoms: 30n,
      remainingAtoms: 70n,
      swappedAtoms: 30n,
    })
    const resumed = await metricsFor({
      position,
      streamingState: {
        ...createStreamingState(8, 5_000_000_000_000_000n),
        bookkeepingSlotsWithoutTrades: 101,
      },
    })
    expect(resumed).toMatchObject({
      consumedAtoms: 50n,
      remainingAtoms: 50n,
      swappedAtoms: 50n,
    })
  })

  it('rounds unelapsed and inactive slots together, like on-chain settlement', async () => {
    const metrics = await metricsFor({
      position: createPosition({
        amount: 10n,
        flow: 1_666_666_666n,
        remainingSlots: 6,
      }),
      streamingState: {
        ...createStreamingState(5, 0n),
        bookkeepingSlotsWithoutTrades: 1,
      },
    })
    expect(metrics.remainingAtoms).toBe(3n)
    expect(metrics.consumedAtoms).toBe(7n)
  })

  it('allows a confirmed zero fill to replace an earlier optimistic estimate', async () => {
    await metricsFor({
      streamingState: createStreamingState(9, 9_000_000_000_000_000n),
    })
    const metrics = await metricsFor({
      streamingState: createStreamingState(20, 20_000_000_000_000_000n),
      endSlotBookkeepingSnapshot: {
        slot: 10,
        bookkeeping: 0n,
        slotsWithoutTrades: 10,
      },
    })
    expect(metrics).toMatchObject({
      consumedAtoms: 0n,
      remainingAtoms: 100n,
      swappedAtoms: 0n,
      progressPercent: 0,
      averagePrice: null,
    })
  })

  it('does not reuse legacy session forecasts over the final settlement', async () => {
    const getItem = vi.fn().mockReturnValue(
      JSON.stringify({
        [`market111111111111111111111111111111111111:${incidentPosition.authority}:42:${incidentPosition.bookkeepingSnapshot}:0:0`]:
          {
            projectedEndEstimate: {
              amount: '2000000000',
              consumedAtoms: '200000000',
            },
            swappedEstimate: {
              amount: '2000000000',
              consumedAtoms: '200000000',
              source: 'active',
            },
          },
      }),
    )
    vi.stubGlobal('sessionStorage', { getItem })
    const metrics = await metricsFor({
      position: incidentPosition,
      endSlotBookkeepingSnapshot: incidentSnapshot,
    })
    expect(metrics.swappedAtoms).toBe(1_318_484_706n)
    expect(metrics.consumedAtoms).toBe(159_210_527n)
    expect(getItem).not.toHaveBeenCalled()
  })

  it.each([9, 20])(
    'waits for settlement instead of using bookkeeping from slot %s for an ended order',
    async (slot) => {
      const metrics = await metricsFor({
        streamingState: {
          ...createStreamingState(20, 20_000_000_000_000_000n),
          bookkeepingLastUpdateSlot: slot,
        },
      })
      expect(metrics).toMatchObject({
        hasPositionEnded: true,
        consumedAtoms: null,
        remainingAtoms: null,
        swappedAtoms: null,
        progressPercent: null,
        averagePrice: null,
      })
    },
  )

  it('can use live bookkeeping exactly at the end boundary', async () => {
    const metrics = await metricsFor({
      streamingState: {
        ...createStreamingState(10, 8_000_000_000_000_000n),
        bookkeepingSlotsWithoutTrades: 2,
      },
    })
    expect(metrics).toMatchObject({
      hasPositionEnded: true,
      consumedAtoms: 80n,
      remainingAtoms: 20n,
      swappedAtoms: 80n,
    })
  })

  it('waits when market accounting predates the position snapshot', async () => {
    const metrics = await metricsFor({
      position: createPosition({ slotsWithoutTradesSnapshot: 100 }),
    })
    expect(metrics.consumedAtoms).toBeNull()
    expect(metrics.swappedAtoms).toBeNull()
  })
})
