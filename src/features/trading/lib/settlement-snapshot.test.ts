import { describe, expect, it } from 'vitest'
import type { MarketInterval } from '@/lib/generated/twob/src/generated/accounts'
import { resolveEndSlotSettlement } from './settlement-snapshot'

const PRECISION = 1_000_000_000_000_000n

function interval(overrides: Partial<MarketInterval> = {}): MarketInterval {
  return {
    baseExits: Array<bigint>(16).fill(0n),
    quoteExits: Array<bigint>(16).fill(0n),
    basePerQuoteSnapshot: Array<bigint>(16).fill(0n),
    quotePerBaseSnapshot: Array<bigint>(16).fill(0n),
    slotsWithoutTradesSnapshot: Array<number>(16).fill(0),
    ...overrides,
  } as MarketInterval
}

function inputs(): Parameters<typeof resolveEndSlotSettlement>[0] {
  return {
    endSlot: 30,
    endSlotInterval: 10,
    intervals: new Map([[0, interval()]]),
    isBuy: true,
    market: {
      baseFlow: 100n,
      quoteFlow: 200n,
      bookkeeping: {
        lastUpdateSlot: 15n,
        basePerQuote: 3n * PRECISION,
        quotePerBase: 12n * PRECISION,
        slotsWithoutTrade: 4,
      },
    },
  }
}

describe('resolveEndSlotSettlement', () => {
  it.each([true, false])(
    'fills a short ended order before the keeper update (buy=%s)',
    (isBuy) => {
      const request = inputs()
      expect(resolveEndSlotSettlement({ ...request, isBuy })).toEqual({
        slot: 30,
        bookkeeping: isBuy ? 10_500_000_000_000_000n : 42n * PRECISION,
        slotsWithoutTrades: 4,
      })
    },
  )

  it('accrues each price through its exit boundary, excluding exits at the end', () => {
    const request = inputs()
    const exits = interval()
    exits.quoteExits[2] = 100n
    exits.baseExits[3] = 100n
    request.intervals = new Map([[0, exits]])
    expect(resolveEndSlotSettlement(request)).toEqual({
      slot: 30,
      bookkeeping: 15_500_000_000_000_000n,
      slotsWithoutTrades: 4,
    })
  })

  it('preserves inactive slots when an earlier scheduled exit stops trading', () => {
    const request = inputs()
    const exits = interval()
    exits.baseExits[2] = 100n
    request.intervals = new Map([[0, exits]])
    expect(resolveEndSlotSettlement(request)).toEqual({
      slot: 30,
      bookkeeping: 5_500_000_000_000_000n,
      slotsWithoutTrades: 14,
    })
  })

  it('handles the first exit of a new interval account', () => {
    const request = inputs()
    request.market.bookkeeping.lastUpdateSlot = 155n
    request.endSlot = 170
    const exits = interval()
    exits.quoteExits[0] = 100n
    request.intervals = new Map([
      [0, null],
      [1, exits],
    ])
    expect(resolveEndSlotSettlement(request)?.bookkeeping).toBe(
      15_500_000_000_000_000n,
    )
  })

  it('uses an authoritative zero snapshot when bookkeeping has passed the end', () => {
    const request = inputs()
    request.market.bookkeeping.lastUpdateSlot = 35n
    request.market.bookkeeping.basePerQuote = 50n * PRECISION
    const saved = interval()
    saved.slotsWithoutTradesSnapshot[3] = 30
    request.intervals = new Map([[0, saved]])
    expect(resolveEndSlotSettlement(request)).toEqual({
      slot: 30,
      bookkeeping: 0n,
      slotsWithoutTrades: 30,
    })
  })

  it('does not guess when a required interval was not read', () => {
    const request = inputs()
    request.endSlot = 170
    request.intervals = new Map([[1, interval()]])
    expect(resolveEndSlotSettlement(request)).toBeNull()
  })

  it('uses per-slot integer rounding and the program overflow branch', () => {
    const request = inputs()
    request.market.baseFlow = 1n
    request.market.quoteFlow = 3n
    expect(resolveEndSlotSettlement(request)?.bookkeeping).toBe(
      7_999_999_999_999_995n,
    )
    request.market.baseFlow = 1n << 100n
    request.market.quoteFlow = 3n << 100n
    expect(resolveEndSlotSettlement(request)?.bookkeeping).toBe(
      7_999_995_000_000_000n,
    )
  })
})
