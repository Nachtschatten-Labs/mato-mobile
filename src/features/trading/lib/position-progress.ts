import { computeAveragePrice } from './market'
import {
  getTradePositionEndSlot,
  isBuyTradePosition,
  isPausedTradePosition,
} from './trade-position'
import type { Address } from '@solana/kit'
import type { TradePosition } from '@/lib/generated/twob/src/generated/accounts'
import type {
  StreamingMarketState,
  TradeSettlementSnapshot,
} from '../domain/models'

export interface PositionProgressMetrics {
  amountAtoms: bigint
  averagePrice: number | null
  claimableSwappedAtoms: bigint | null
  consumedAtoms: bigint | null
  depositedDecimals: number
  depositedToken: string
  flowAtomsPerSlot: bigint
  flowLabel: string
  hasPositionEnded: boolean
  isPaused: boolean
  market: Address
  position: TradePosition
  positionKey: string
  progressPercent: number | null
  remainingAtoms: bigint | null
  remainingPercent: number | null
  sideLabel: 'Buy' | 'Sell'
  swappedAtoms: bigint | null
  swappedDecimals: number
  swappedToken: string
}

const BOOKKEEPING_PRECISION_FACTOR = 1_000_000_000_000_000n
const FLOW_PRECISION_PART_ONE = 10_000n
const FLOW_PRECISION_PART_TWO = 100_000n
const FLOW_PRECISION_FACTOR = 1_000_000_000n
const MAX_U128 = (1n << 128n) - 1n

function clampToRange(value: number, min: number, max: number) {
  if (value < min) return min
  if (value > max) return max
  return value
}

function calculateSwappedAmount(flow: bigint, accumulatedPrices: bigint) {
  const scaledFlow = flow / FLOW_PRECISION_PART_ONE
  if (scaledFlow === 0n || accumulatedPrices <= MAX_U128 / scaledFlow) {
    return (
      (scaledFlow * accumulatedPrices) /
      BOOKKEEPING_PRECISION_FACTOR /
      FLOW_PRECISION_PART_TWO
    )
  }

  return (
    ((flow / FLOW_PRECISION_FACTOR) * accumulatedPrices) /
    BOOKKEEPING_PRECISION_FACTOR
  )
}

export function getActivePositionMetrics({
  market,
  position,
  baseTicker,
  quoteTicker,
  baseDecimals,
  quoteDecimals,
  streamingState,
  endSlotBookkeepingSnapshot,
}: {
  market: Address
  position: TradePosition
  baseTicker: string
  quoteTicker: string
  baseDecimals: number
  quoteDecimals: number
  streamingState: StreamingMarketState | null
  endSlotBookkeepingSnapshot: TradeSettlementSnapshot | null
}): PositionProgressMetrics {
  const isBuy = isBuyTradePosition(position)
  const depositedToken = isBuy ? quoteTicker : baseTicker
  const depositedDecimals = isBuy ? quoteDecimals : baseDecimals
  const swappedToken = isBuy ? baseTicker : quoteTicker
  const swappedDecimals = isBuy ? baseDecimals : quoteDecimals
  const sideLabel = isBuy ? 'Buy' : 'Sell'
  const flowLabel = isBuy
    ? `${quoteTicker} → ${baseTicker}`
    : `${baseTicker} → ${quoteTicker}`
  const positionKey = `${market}:${position.authority}:${position.id.toString()}`
  const isPaused = isPausedTradePosition(position)

  const amountAtoms = position.amount
  const endSlot = Number(getTradePositionEndSlot(position))
  const lastUpdateSlot = Number(position.lastUpdateSlot)
  const scaledFlowAtomsPerSlot = position.flow
  const flowAtomsPerSlot = scaledFlowAtomsPerSlot / FLOW_PRECISION_FACTOR

  const hasPositionEnded =
    !isPaused &&
    ((streamingState?.currentSlot ?? 0) >= endSlot ||
      endSlotBookkeepingSnapshot?.slot === endSlot)

  let snapshot: TradeSettlementSnapshot | null = null
  if (!isPaused) {
    if (hasPositionEnded && endSlotBookkeepingSnapshot?.slot === endSlot) {
      // The end snapshot is authoritative, including zero output. Never replace
      // it with a projected or cached fill, or with later market bookkeeping.
      snapshot = endSlotBookkeepingSnapshot
    } else if (
      streamingState &&
      streamingState.bookkeepingLastUpdateSlot >= lastUpdateSlot &&
      streamingState.bookkeepingLastUpdateSlot <= endSlot &&
      (!hasPositionEnded ||
        streamingState.bookkeepingLastUpdateSlot === endSlot)
    ) {
      const currentSlot = clampToRange(
        Math.max(
          streamingState.currentSlot,
          streamingState.bookkeepingLastUpdateSlot,
        ),
        lastUpdateSlot,
        endSlot,
      )
      const staleSlots = currentSlot - streamingState.bookkeepingLastUpdateSlot
      const hasTrades =
        streamingState.marketBaseFlow > 0n &&
        streamingState.marketQuoteFlow > 0n
      const outputFlow = isBuy
        ? streamingState.marketBaseFlow
        : streamingState.marketQuoteFlow
      const inputFlow = isBuy
        ? streamingState.marketQuoteFlow
        : streamingState.marketBaseFlow
      const liveBookkeeping = isBuy
        ? streamingState.bookkeepingBasePerQuote
        : streamingState.bookkeepingQuotePerBase
      // Match the program's per-slot truncation before multiplying by time.
      const perSlotPrice = hasTrades
        ? (BOOKKEEPING_PRECISION_FACTOR * outputFlow) / inputFlow
        : 0n
      snapshot = {
        slot: currentSlot,
        bookkeeping: liveBookkeeping + perSlotPrice * BigInt(staleSlots),
        slotsWithoutTrades:
          streamingState.bookkeepingSlotsWithoutTrades +
          (hasTrades ? 0 : staleSlots),
      }
    }
  }

  // Independent account reads can briefly return market data older than the
  // position. Wait for consistent data instead of inventing a fill.
  if (
    snapshot &&
    (snapshot.bookkeeping < position.bookkeepingSnapshot ||
      snapshot.slotsWithoutTrades < position.slotsWithoutTradesSnapshot ||
      snapshot.slotsWithoutTrades - position.slotsWithoutTradesSnapshot >
        snapshot.slot - lastUpdateSlot)
  ) {
    snapshot = null
  }

  let remainingAtoms: bigint | null = null
  let swappedAtoms: bigint | null = null
  if (isPaused || snapshot) {
    const refundableSlots = isPaused
      ? position.remainingSlots
      : endSlot -
        snapshot!.slot +
        snapshot!.slotsWithoutTrades -
        position.slotsWithoutTradesSnapshot
    // Combine unelapsed and inactive slots before rounding, as settlement does.
    const refundableAtoms =
      position.inactiveRefund +
      (scaledFlowAtomsPerSlot * BigInt(refundableSlots)) / FLOW_PRECISION_FACTOR
    remainingAtoms =
      refundableAtoms > amountAtoms ? amountAtoms : refundableAtoms
    swappedAtoms =
      position.swappedAmountAtSnapshot +
      (isPaused
        ? 0n
        : calculateSwappedAmount(
            scaledFlowAtomsPerSlot,
            snapshot!.bookkeeping - position.bookkeepingSnapshot,
          ))
  }
  const consumedAtoms =
    remainingAtoms === null ? null : amountAtoms - remainingAtoms
  const remainingPercent =
    remainingAtoms === null
      ? null
      : amountAtoms > 0n
        ? Number((remainingAtoms * 10_000n) / amountAtoms) / 100
        : 0
  const progressPercent =
    remainingPercent === null ? null : 100 - remainingPercent

  const claimableSwappedAtoms =
    swappedAtoms === null
      ? null
      : swappedAtoms > position.withdrawnAmount
        ? swappedAtoms - position.withdrawnAmount
        : 0n

  const averagePrice = (() => {
    if (swappedAtoms === null || consumedAtoms === null) return null
    const quoteAtoms = isBuy ? consumedAtoms : swappedAtoms
    const baseAtoms = isBuy ? swappedAtoms : consumedAtoms
    return computeAveragePrice(
      quoteAtoms,
      quoteDecimals,
      baseAtoms,
      baseDecimals,
    )
  })()

  return {
    amountAtoms,
    averagePrice,
    claimableSwappedAtoms,
    consumedAtoms,
    depositedDecimals,
    depositedToken,
    flowAtomsPerSlot: flowAtomsPerSlot > 0n ? flowAtomsPerSlot : 0n,
    flowLabel,
    hasPositionEnded,
    isPaused,
    market,
    position,
    positionKey,
    progressPercent,
    remainingAtoms,
    remainingPercent,
    sideLabel,
    swappedAtoms,
    swappedDecimals,
    swappedToken,
  }
}
