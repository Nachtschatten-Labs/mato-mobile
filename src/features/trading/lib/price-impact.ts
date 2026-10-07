import { HIGH_PRICE_IMPACT_WARNING_THRESHOLD_PERCENT } from '../constants'
import type { OrderSide } from '../constants'
import type { StreamingMarketState } from '../domain/models'

const FLOW_PRECISION = 1_000_000_000n

export interface PriceImpactInputs {
  amountAtoms: bigint | null
  side: OrderSide
  streamingState: StreamingMarketState | null | undefined
}

export function getConservativePriceImpactInputs({
  amountAtoms,
  side,
  streamingState,
}: PriceImpactInputs) {
  if (amountAtoms === null || amountAtoms <= 0n || !streamingState) {
    return null
  }

  const { endSlotInterval } = streamingState
  const marketFlow =
    side === 'buy'
      ? streamingState.marketQuoteFlow
      : streamingState.marketBaseFlow

  if (
    !Number.isSafeInteger(endSlotInterval) ||
    endSlotInterval <= 0 ||
    marketFlow <= 0n
  ) {
    return null
  }

  return {
    amountFlowTwice: amountAtoms * FLOW_PRECISION * 2n,
    endSlotInterval: BigInt(endSlotInterval),
    marketFlow,
  }
}

export function computePriceImpactPercent({
  durationSlots,
  ...inputs
}: PriceImpactInputs & { durationSlots: number }): number | null {
  const conservativeInputs = getConservativePriceImpactInputs(inputs)
  if (!conservativeInputs || !Number.isSafeInteger(durationSlots)) {
    return null
  }

  const { amountFlowTwice, endSlotInterval, marketFlow } = conservativeInputs
  // Doubling keeps odd end-slot intervals exact, without truncating token flow.
  const effectiveDurationTwice = BigInt(durationSlots) * 2n - endSlotInterval
  if (effectiveDurationTwice <= 0n) return null

  const denominator =
    marketFlow * effectiveDurationTwice +
    (inputs.side === 'sell' ? amountFlowTwice : 0n)
  const impact = (Number(amountFlowTwice) / Number(denominator)) * 100

  return Number.isFinite(impact) ? impact : null
}

export function isHighPriceImpact(priceImpactPercent: number | null) {
  return (
    priceImpactPercent !== null &&
    priceImpactPercent > HIGH_PRICE_IMPACT_WARNING_THRESHOLD_PERCENT
  )
}
