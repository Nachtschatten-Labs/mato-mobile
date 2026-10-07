import { describe, expect, it } from 'vitest'
import {
  buildClosedPositionMiniChart,
  buildPositionPricePath,
  normalizeMarketPricePoints,
} from './mini-chart'
import type { MarketUpdateEvent } from '@/integrations/read-api'

function event(slot: number, price: number, eventIndex = 0): MarketUpdateEvent {
  return {
    id: slot * 10 + eventIndex,
    event_index: eventIndex,
    slot,
    signature: `signature-${slot}`,
    market_address: 'market',
    base_flow: 1_000_000_000n,
    quote_flow: BigInt(price * 1_000_000),
    created_at: '2026-10-07T12:00:00Z',
  }
}

describe('normalizeMarketPricePoints', () => {
  it('keeps the final event in the submission slot, even in reverse order', () => {
    const points = normalizeMarketPricePoints(
      [event(1000, 120, 2), event(1000, 100, 0), event(999, 100)],
      9,
      6,
    )

    expect(points).toEqual([
      { slot: 999, price: 100 },
      { slot: 1000, price: 120 },
    ])
  })

  it('does not compare transaction-local event indexes across transactions', () => {
    expect(
      normalizeMarketPricePoints(
        [
          event(1000, 100, 5),
          { ...event(1000, 120, 0), signature: 'later-tx' },
        ],
        9,
        6,
      ),
    ).toEqual([{ slot: 1000, price: 120 }])
  })
})

describe('buildClosedPositionMiniChart', () => {
  it.each([80, 120])(
    'starts at the post-submission price %s and excludes the post-exit jump',
    (price) => {
      const chart = buildClosedPositionMiniChart(
        [
          { slot: 999, price: 100 },
          { slot: 1000, price },
          { slot: 1010, price: 100 },
          { slot: 1020, price: 200 },
        ],
        1000,
        1010,
      )

      expect(chart).toEqual([
        { slot: 1000, price },
        { slot: 1010, price },
      ])
    },
  )

  it('carries an earlier price to the start without plotting the earlier slot', () => {
    expect(
      buildClosedPositionMiniChart(
        [
          { slot: 990, price: 100 },
          { slot: 1005, price: 120 },
        ],
        1000,
        1010,
      ),
    ).toEqual([
      { slot: 1000, price: 100 },
      { slot: 1005, price: 120 },
      { slot: 1010, price: 120 },
    ])
  })

  it('does not backfill a missing start price from a later observation', () => {
    expect(
      buildClosedPositionMiniChart([{ slot: 1005, price: 120 }], 1000, 1010),
    ).toBeNull()
  })

  it('retains actual observed extrema when downsampling dense history', () => {
    const points = Array.from({ length: 1000 }, (_, slot) => ({
      slot,
      price: 100 + (slot % 3),
    }))
    points[250].price = 50
    points[750].price = 150
    const chart = buildClosedPositionMiniChart(points, 0, 1000, 24)!

    expect(chart.length).toBeLessThanOrEqual(24)
    expect(chart[0]).toEqual({ slot: 0, price: 100 })
    expect(chart.at(-1)).toEqual({ slot: 1000, price: 100 })
    expect(chart).toContainEqual(points[250])
    expect(chart).toContainEqual(points[750])
    expect(
      chart
        .slice(0, -1)
        .every((point) => points.includes(point) || point.slot === 0),
    ).toBe(true)
  })
})

describe('buildPositionPricePath', () => {
  it('can include the current slot for an order that is still running', () => {
    expect(
      buildPositionPricePath(
        [
          { slot: 1000, price: 100 },
          { slot: 1005, price: 120 },
        ],
        1000,
        1005,
        { includeEndSlot: true },
      ),
    ).toEqual([
      { slot: 1000, price: 100 },
      { slot: 1005, price: 120 },
    ])
  })

  it('preserves the inclusive current-slot price when dense history is sampled', () => {
    const points = Array.from({ length: 20 }, (_, index) => ({
      slot: 1000 + index,
      price: 100 + index,
    }))
    expect(
      buildPositionPricePath(points, 1000, 1019, {
        includeEndSlot: true,
        maxPoints: 6,
      })?.at(-1),
    ).toEqual({ slot: 1019, price: 119 })
  })
})
