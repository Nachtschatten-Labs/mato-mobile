import {
  MAX_DURATION_SLOTS,
  MIN_DURATION_SLOTS,
} from '@/features/trading/lib/duration'
import { NATIVE_FEE_BUFFER_ATOMS } from '@/features/trading/constants'

export function validateOrder({
  amount,
  minimum,
  available,
  lamports,
  durationSlots,
  marketPaused,
  hasLiquidity,
}: {
  amount: bigint | null
  minimum: bigint
  available: bigint | null
  lamports: bigint | null
  durationSlots: number | null
  marketPaused: boolean
  hasLiquidity: boolean
}): string | null {
  if (marketPaused) return 'This market is paused.'
  if (!hasLiquidity) return 'Waiting for liquidity on both sides of the market.'
  if (amount === null || amount <= 0n) return 'Enter an amount to trade.'
  if (amount > 0xffffffffffffffffn)
    return 'This amount exceeds the maximum supported order size.'
  if (amount < minimum) return 'The amount is below the market minimum.'
  if (available === null || lamports === null)
    return 'Waiting for your wallet balances.'
  if (amount > available) return 'This amount exceeds your available balance.'
  if (lamports < NATIVE_FEE_BUFFER_ATOMS)
    return 'Keep at least 0.02 SOL for network fees and account rent.'
  if (durationSlots === null)
    return 'Choose a duration or use a smaller amount for Smart fill.'
  if (
    !Number.isSafeInteger(durationSlots) ||
    durationSlots < MIN_DURATION_SLOTS ||
    durationSlots > MAX_DURATION_SLOTS
  )
    return 'Choose a duration between 5 seconds and 1 year.'
  if (amount < BigInt(durationSlots + 5))
    return 'The amount is too small for this duration.'
  return null
}

export function requiresNewImpactReview(
  previous: number | null,
  current: number | null,
) {
  return (
    current === null ||
    previous === null ||
    (previous <= 1 && current > 1) ||
    current > previous + 0.1
  )
}
