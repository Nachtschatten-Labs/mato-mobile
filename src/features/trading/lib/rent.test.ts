import { describe, expect, it } from 'vitest'
import type { Address } from '@solana/kit'
import {
  collectCloseableMarketIntervals,
  isRentAccountIndexStale,
} from './rent'
const market = 'market' as Address
const payer = 'payer' as Address
const account = (index: bigint, overrides = {}) => ({
  address: `interval-${index}` as Address,
  market,
  payer,
  index,
  lamports: 1n,
  openPositions: 0,
  ...overrides,
})
describe('interval rent eligibility', () => {
  it('waits until after the full 16 x 11 slot horizon', () => {
    expect(
      isRentAccountIndexStale({
        currentSlot: 704n,
        endSlotInterval: 11,
        index: 3n,
      }),
    ).toBe(false)
    expect(
      isRentAccountIndexStale({
        currentSlot: 705n,
        endSlotInterval: 11,
        index: 3n,
      }),
    ).toBe(true)
  })
  it('caps single interval accounts and sorts oldest first', () => {
    const result = collectCloseableMarketIntervals({
      currentSlot: 10000,
      endSlotInterval: 11,
      market,
      payer,
      maxAccounts: 2,
      intervalAccounts: [account(2n), account(0n), account(1n)],
    })
    expect(result.map((a) => a.index)).toEqual([0n, 1n])
  })
  it('excludes live intervals, referenced positions, and other markets or payers', () => {
    const result = collectCloseableMarketIntervals({
      currentSlot: 352,
      endSlotInterval: 11,
      market,
      payer,
      intervalAccounts: [
        account(0n, { openPositions: 1 }),
        account(0n, { market: 'other' }),
        account(0n, { payer: 'other' }),
        account(1n),
        account(2n),
      ],
    })
    expect(result).toEqual([])
  })
})
