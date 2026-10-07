import { describe, expect, it } from 'vitest'
import {
  buildTradingDashboardViewModel,
  calculateRelativePriceChangePercent,
  deriveMarketIdentity,
  formatDashboardPriceChangePercent,
} from './trading-dashboard'
import { MARKET_DEFINITIONS, SLOT_DURATION_SECONDS } from '../constants'
import type { Address } from '@solana/kit'
import type { TradingViewAggregatedCandle } from '../lib/market'

describe('deriveMarketIdentity', () => {
  it('normalizes tickers from market config', () => {
    const identity = deriveMarketIdentity({
      base_decimals: 9,
      base_mint: 'BaseMint1111111111111111111111111111111111',
      base_ticker: 'sol',
      created_at: '2026-03-20T00:00:00Z',
      id: 1,
      market_address: 'FUDH6hiwDNjdQKbH7fveFFPoEE3mXk9i1g2WbgnSqob3',
      quote_decimals: 6,
      quote_mint: 'QuoteMint111111111111111111111111111111111',
      quote_ticker: 'usdc',
    })

    expect(identity.baseTicker).toBe('SOL')
    expect(identity.quoteTicker).toBe('USDC')
  })
})

function dashboardInputs(): Parameters<
  typeof buildTradingDashboardViewModel
>[0] {
  return {
    amountAtoms: 1_000_000n,
    amountUiValue: 1,
    baseDecimals: 9,
    baseTicker: 'SOL',
    durationSeconds: 60,
    quoteDecimals: 6,
    quoteTicker: 'USDC',
    referencePricing: {
      baseDecimals: 9,
      chartCandles: [
        {
          close: 149,
          high: 150,
          low: 148,
          open: 148,
          time: 1_742_428_800,
          volume: 20,
        },
      ],
      crosshairData: null,
      marketPrice: { eventTimeMs: 1_742_428_800_000, price: 150, slot: 11 },
      marketUpdates: [
        {
          base_flow: 1_000_000_000n,
          created_at: '2026-03-20T00:00:00Z',
          id: 2,
          market_address: 'FUDH6hiwDNjdQKbH7fveFFPoEE3mXk9i1g2WbgnSqob3',
          quote_flow: 149_000_000n,
          signature: 'newer',
          slot: 11,
        },
        {
          base_flow: 1_000_000_000n,
          created_at: '2026-03-19T23:59:00Z',
          id: 1,
          market_address: 'FUDH6hiwDNjdQKbH7fveFFPoEE3mXk9i1g2WbgnSqob3',
          quote_flow: 148_000_000n,
          signature: 'older',
          slot: 10,
        },
      ],
      priceChangeHistory: [
        {
          close: 120,
          high: 120,
          low: 120,
          open: 120,
          time: 1_742_342_400,
          volume: 10,
        },
      ],
      quoteDecimals: 6,
    },
    side: 'buy',
    streamingState: {
      baseMint: 'So11111111111111111111111111111111111111112' as Address,
      bookkeepingBasePerQuote: 0n,
      bookkeepingLastUpdateSlot: 11,
      bookkeepingSlotsWithoutTrades: 0,
      bookkeepingQuotePerBase: 0n,
      currentSlot: 11,
      endSlotInterval: 7,
      isPaused: false,
      marketBaseFlow: 1_000_000_000_000_000_000n,
      marketId: 1,
      marketQuoteFlow: 2_500_000_000_000_000n,
      minimumBaseDepositAtoms: 1n,
      minimumQuoteDepositAtoms: 1n,
      quoteMint: '11111111111111111111111111111111' as Address,
    },
    tradePositions: [],
  }
}

describe('buildTradingDashboardViewModel', () => {
  it('uses the conservative effective duration for impact and execution estimates', () => {
    const viewModel = buildTradingDashboardViewModel(dashboardInputs())
    const expectedImpact =
      (1_000_000 / (60 / SLOT_DURATION_SECONDS - 7 / 2) / 2_500_000) * 100

    expect(viewModel.priceImpactPercent).toBeCloseTo(expectedImpact, 12)
    expect(viewModel.executionPrice).toBeCloseTo(
      2.5 * (1 + expectedImpact / 100),
      12,
    )
  })

  it('leaves impact unavailable until a duration is selected', () => {
    const inputs = dashboardInputs()
    inputs.durationSeconds = null
    const viewModel = buildTradingDashboardViewModel(inputs)

    expect(viewModel.priceImpactPercent).toBeNull()
    expect(viewModel.priceImpactDisplay).toBe('—')
    expect(viewModel.executionPrice).toBeNull()
    expect(viewModel.estimatedConversionText).toBe('— SOL')
  })

  it.each(MARKET_DEFINITIONS)(
    'keeps historical prices separate from live execution estimates for market $id ($baseSymbol)',
    (market) => {
      const inputs = dashboardInputs()
      inputs.baseDecimals = market.baseDecimals
      inputs.baseTicker = market.baseSymbol
      inputs.streamingState = {
        ...inputs.streamingState!,
        baseMint: market.baseMint,
        marketBaseFlow: 10n ** BigInt(market.baseDecimals) * 1_000_000_000n,
        marketId: market.id,
        quoteMint: market.quoteMint,
      }
      const viewModel = buildTradingDashboardViewModel(inputs)

      expect(viewModel.displayPrice).toBe(150)
      expect(viewModel.chartCandles).toEqual(
        inputs.referencePricing.chartCandles,
      )
      expect(viewModel.priceDelta).toBe(1)
      expect(viewModel.priceChange24hPercent).toBe(25)
      expect(viewModel.priceChange24hDisplay).toBe('+25.00% 24h')
      expect(viewModel.onChainIndicativePrice).toBe(2.5)
      expect(viewModel.executionPrice).toBeGreaterThan(2.5)
      expect(viewModel.executionPrice).toBeLessThan(3)
      expect(viewModel.estimatedConversionText).toMatch(
        new RegExp(`^~0\\.\\d+ ${market.baseSymbol}$`),
      )
    },
  )

  it('uses reference token decimals for the mainnet tick fallback on custom markets', () => {
    const inputs = dashboardInputs()
    inputs.baseDecimals = 6
    inputs.baseTicker = 'MATO'
    inputs.referencePricing.marketPrice = undefined

    const viewModel = buildTradingDashboardViewModel(inputs)

    expect(viewModel.displayPrice).toBe(149)
    expect(viewModel.priceDelta).toBe(1)
  })

  it.each(['missing', 'zero'] as const)(
    'leaves estimates unavailable when selected-market flows are %s',
    (condition) => {
      const inputs = dashboardInputs()
      inputs.streamingState =
        condition === 'missing'
          ? null
          : {
              ...inputs.streamingState!,
              marketBaseFlow: 0n,
              marketQuoteFlow: 0n,
            }

      const viewModel = buildTradingDashboardViewModel(inputs)

      expect(viewModel.displayPrice).toBe(150)
      expect(viewModel.executionPrice).toBeNull()
      expect(viewModel.executionPriceDisplay).toBe('—')
      expect(viewModel.estimatedConversionText).toBe('— SOL')
      expect(viewModel.priceImpactPercent).toBeNull()
      expect(viewModel.priceImpactDisplay).toBe('—')
    },
  )

  it('keeps history unavailable when only an execution estimate exists', () => {
    const inputs = dashboardInputs()
    inputs.referencePricing = {
      baseDecimals: 9,
      chartCandles: [],
      crosshairData: null,
      marketUpdates: [],
      priceChangeHistory: [],
      quoteDecimals: 6,
    }

    const viewModel = buildTradingDashboardViewModel(inputs)

    expect(viewModel.displayPrice).toBeNull()
    expect(viewModel.priceChange24hDisplay).toBe('24h —')
    expect(viewModel.executionPrice).toBeGreaterThan(2.5)
    expect(viewModel.executionPrice).toBeLessThan(3)
  })
})

describe('calculateRelativePriceChangePercent', () => {
  it('compares current price to the latest candle at or before 24h ago', () => {
    const referenceTime = 1_742_428_800
    const priceHistory: Array<TradingViewAggregatedCandle> = [
      {
        close: 98,
        endSlot: 1,
        high: 98,
        low: 98,
        open: 98,
        startSlot: 1,
        time: referenceTime - 24 * 60 * 60 - 300,
        volume: 1,
      },
      {
        close: 100,
        endSlot: 2,
        high: 100,
        low: 100,
        open: 100,
        startSlot: 2,
        time: referenceTime - 24 * 60 * 60,
        volume: 1,
      },
      {
        close: 102,
        endSlot: 3,
        high: 102,
        low: 102,
        open: 102,
        startSlot: 3,
        time: referenceTime - 24 * 60 * 60 + 300,
        volume: 1,
      },
    ]

    expect(
      calculateRelativePriceChangePercent({
        currentPrice: 110,
        priceHistory,
        referenceTime,
      }),
    ).toBe(10)
  })

  it('returns null without a valid 24h reference price', () => {
    expect(
      calculateRelativePriceChangePercent({
        currentPrice: 110,
        priceHistory: [],
        referenceTime: 1_742_428_800,
      }),
    ).toBeNull()
  })
})

describe('formatDashboardPriceChangePercent', () => {
  it('formats signed 24h percentages', () => {
    expect(formatDashboardPriceChangePercent(1.234)).toBe('+1.23% 24h')
    expect(formatDashboardPriceChangePercent(-0.004)).toBe('-<0.01% 24h')
    expect(formatDashboardPriceChangePercent(0)).toBe('0.00% 24h')
    expect(formatDashboardPriceChangePercent(null)).toBe('24h —')
  })
})
