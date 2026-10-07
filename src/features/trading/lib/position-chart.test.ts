import { describe, expect, it } from 'vitest'
import {
  buildPositionChartPoints,
  formatStreamDuration,
} from './position-chart'
import type { MarketUpdateEvent } from '@/integrations/read-api'

export function chartEvent(
  slot: number,
  price: number,
  eventIndex = 0,
): MarketUpdateEvent {
  return {
    id: slot * 10 + eventIndex,
    event_index: eventIndex,
    signature: `tx-${slot}`,
    slot,
    market_address: 'market',
    base_flow: 1_000n,
    quote_flow: BigInt(price * 1000),
    created_at: '2026-10-07T12:00:00Z',
  }
}

const options = {
  startSlot: 1000,
  endSlot: 1010,
  includeEndSlot: false,
  baseDecimals: 0,
  quoteDecimals: 0,
  livePrices: [],
}

describe('position price history', () => {
  it('starts after submission and stops before the end-slot price change', () => {
    expect(
      buildPositionChartPoints({
        ...options,
        events: [
          chartEvent(999, 100),
          chartEvent(1000, 100),
          chartEvent(1000, 120, 1),
          chartEvent(1005, 125),
          chartEvent(1010, 90),
          chartEvent(1020, 80),
        ],
      }),
    ).toEqual([
      { slot: 1000, price: 120 },
      { slot: 1005, price: 125 },
      { slot: 1010, price: 125 },
    ])
  })

  it('keeps a short completed path when live prices advance beyond its end', () => {
    expect(
      buildPositionChartPoints({
        ...options,
        events: [chartEvent(1000, 120)],
        livePrices: [
          { slot: 1004, price: 123, eventTimeMs: 1 },
          { slot: 1010, price: 90, eventTimeMs: 1 },
          { slot: 1020, price: 80, eventTimeMs: 1 },
        ],
      }),
    ).toEqual([
      { slot: 1000, price: 120 },
      { slot: 1004, price: 123 },
      { slot: 1010, price: 123 },
    ])
  })

  it('includes the latest slot while still active and trusts indexed same-slot prices', () => {
    expect(
      buildPositionChartPoints({
        ...options,
        endSlot: 1004,
        includeEndSlot: true,
        events: [chartEvent(1000, 120)],
        livePrices: [
          { slot: 1000, price: 99, eventTimeMs: 1 },
          { slot: 1004, price: 123, eventTimeMs: 1 },
        ],
      }),
    ).toEqual([
      { slot: 1000, price: 120 },
      { slot: 1004, price: 123 },
    ])
  })

  it('formats seconds, minutes, and paused durations without negative time', () => {
    expect(formatStreamDuration(-1)).toBe('0s')
    expect(formatStreamDuration(55)).toBe('55s')
    expect(formatStreamDuration(61)).toBe('2m')
    expect(formatStreamDuration(3660)).toBe('1h 1m')
  })
})
