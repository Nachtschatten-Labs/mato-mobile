import { describe, expect, it } from 'vitest'
import { requiresNewImpactReview, validateOrder } from './validation'

const input = {
  amount: 1_000_000n,
  minimum: 100_000n,
  available: 2_000_000n,
  lamports: 30_000_000n,
  durationSlots: 300,
  marketPaused: false,
  hasLiquidity: true,
}
describe('order validation', () => {
  it('allows a funded order', () => expect(validateOrder(input)).toBeNull())
  it('blocks unknown balance rather than treating it as zero', () =>
    expect(validateOrder({ ...input, available: null })).toContain('Waiting'))
  it('reserves SOL for network fees', () =>
    expect(validateOrder({ ...input, lamports: 1n })).toContain('0.02 SOL'))
  it('rejects missing liquidity and paused markets', () => {
    expect(validateOrder({ ...input, hasLiquidity: false })).toContain(
      'liquidity',
    )
    expect(validateOrder({ ...input, marketPaused: true })).toContain('paused')
  })
  it('respects rounded slot minimum funding', () =>
    expect(validateOrder({ ...input, durationSlots: 1_000_000 })).toContain(
      'too small',
    ))
  it('rejects atom values outside the program u64 range', () =>
    expect(validateOrder({ ...input, amount: 1n << 64n })).toContain('maximum'))
  it('requires renewed review when crossing the high impact threshold', () => {
    expect(requiresNewImpactReview(0.99, 1.05)).toBe(true)
    expect(requiresNewImpactReview(0.5, 0.8)).toBe(true)
    expect(requiresNewImpactReview(0.5, 0.51)).toBe(false)
    expect(requiresNewImpactReview(0.5, null)).toBe(true)
  })
})
