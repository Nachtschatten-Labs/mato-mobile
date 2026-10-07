import { describe, expect, it } from 'vitest'
import type { Address } from '@solana/kit'
import { assertCloseReview, type ReviewPosition } from './close-review'
import type { ClosePositionPreview } from '../../features/trading/lib/close-position-preview'

const owner = 'owner' as Address
const market = 'market' as Address
const position: ReviewPosition = {
  address: 'position' as Address,
  data: {
    authority: owner,
    market,
    baseReceiver: 'base' as Address,
    quoteReceiver: 'quote' as Address,
    payer: owner,
  },
}
const preview: ClosePositionPreview = {
  receivedAtoms: 10n,
  remainingDepositAtoms: 30n,
  feeAtoms: 1n,
  positionRentLamports: 5n,
  baseReceiver: position.data.baseReceiver,
  quoteReceiver: position.data.quoteReceiver,
  rentReceiver: owner,
  simulatedAtMs: 100_000,
}
const request = {
  owner,
  reviewOwner: owner,
  market,
  reviewed: [position],
  selected: [position],
  previews: [preview],
  now: 101_000,
}

describe('close review consistency', () => {
  it('accepts a fresh quote, including a zero fill and full refund', () => {
    expect(() => assertCloseReview(request)).not.toThrow()
    expect(() =>
      assertCloseReview({
        ...request,
        previews: [{ ...preview, receivedAtoms: 0n, feeAtoms: 0n }],
      }),
    ).not.toThrow()
  })
  it('rejects a disconnected or changed wallet', () => {
    expect(() => assertCloseReview({ ...request, owner: null })).toThrow(
      'wallet changed',
    )
    expect(() =>
      assertCloseReview({ ...request, owner: 'other' as Address }),
    ).toThrow('wallet changed')
  })
  it('rejects stale, invalid or future simulation timestamps', () => {
    for (const simulatedAtMs of [0, Number.NaN, 105_000]) {
      expect(() =>
        assertCloseReview({
          ...request,
          previews: [{ ...preview, simulatedAtMs }],
        }),
      ).toThrow('Refresh')
    }
  })
  it('rejects position substitution, changed recipients and another market', () => {
    expect(() =>
      assertCloseReview({
        ...request,
        reviewed: [{ ...position, address: 'other' as Address }],
      }),
    ).toThrow('position or recipient changed')
    expect(() =>
      assertCloseReview({
        ...request,
        previews: [{ ...preview, baseReceiver: 'other' as Address }],
      }),
    ).toThrow('position or recipient changed')
    expect(() =>
      assertCloseReview({ ...request, market: 'other' as Address }),
    ).toThrow('position or recipient changed')
  })
  it('rejects partial previews and negative amounts', () => {
    expect(() => assertCloseReview({ ...request, previews: [] })).toThrow(
      'Refresh',
    )
    expect(() =>
      assertCloseReview({
        ...request,
        previews: [{ ...preview, receivedAtoms: -1n }],
      }),
    ).toThrow('Refresh')
  })
})
