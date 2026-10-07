import { ARRAY_LENGTH } from '../constants'
import type {
  Market,
  MarketInterval,
} from '@/lib/generated/twob/src/generated/accounts'
import type { TradeSettlementSnapshot } from '../domain/models'

const BOOKKEEPING_PRECISION = 1_000_000_000_000_000n
const FLOW_PRECISION = 1_000_000_000n
const MAX_U128 = (1n << 128n) - 1n

/**
 * Replays the program's scheduled bookkeeping using accounts from one bank at
 * or after the end slot. Every flow-changing instruction advances bookkeeping
 * first, so only the recorded exits can change flows in this remaining range.
 */
export function resolveEndSlotSettlement({
  endSlot,
  endSlotInterval,
  intervals,
  isBuy,
  market,
}: {
  endSlot: number
  endSlotInterval: number
  intervals: ReadonlyMap<number, MarketInterval | null>
  isBuy: boolean
  market: Pick<Market, 'baseFlow' | 'quoteFlow'> & {
    bookkeeping: Pick<
      Market['bookkeeping'],
      'basePerQuote' | 'quotePerBase' | 'lastUpdateSlot' | 'slotsWithoutTrade'
    >
  }
}): TradeSettlementSnapshot | null {
  const endIndex = Math.floor(endSlot / endSlotInterval / ARRAY_LENGTH)
  const snapshotIndex = Math.floor(endSlot / endSlotInterval) % ARRAY_LENGTH
  const endInterval = intervals.get(endIndex)
  if (!endInterval) return null

  let slot = Number(market.bookkeeping.lastUpdateSlot)
  if (slot >= endSlot) {
    const bookkeeping = (
      isBuy
        ? endInterval.basePerQuoteSnapshot
        : endInterval.quotePerBaseSnapshot
    )[snapshotIndex]
    const slotsWithoutTrades =
      endInterval.slotsWithoutTradesSnapshot[snapshotIndex]
    if (bookkeeping === undefined || slotsWithoutTrades === undefined)
      return null
    return { slot: endSlot, bookkeeping, slotsWithoutTrades }
  }

  let bookkeeping = isBuy
    ? market.bookkeeping.basePerQuote
    : market.bookkeeping.quotePerBase
  let slotsWithoutTrades = market.bookkeeping.slotsWithoutTrade
  let baseFlow = market.baseFlow
  let quoteFlow = market.quoteFlow
  for (
    let boundary = (Math.floor(slot / endSlotInterval) + 1) * endSlotInterval;
    boundary <= endSlot;
    boundary += endSlotInterval
  ) {
    const index = Math.floor(boundary / endSlotInterval / ARRAY_LENGTH)
    // An absent account has no exits; an account we did not read is unknown.
    if (!intervals.has(index)) return null
    const interval = intervals.get(index)
    const entry = Math.floor(boundary / endSlotInterval) % ARRAY_LENGTH
    const elapsedSlots = boundary - slot
    if (baseFlow === 0n || quoteFlow === 0n) {
      slotsWithoutTrades += elapsedSlots
    } else {
      const outputFlow = isBuy ? baseFlow : quoteFlow
      const inputFlow = isBuy ? quoteFlow : baseFlow
      // Preserve the program's overflow-safe branch and per-slot truncation.
      const price =
        outputFlow >= MAX_U128 / BOOKKEEPING_PRECISION
          ? (((BOOKKEEPING_PRECISION / FLOW_PRECISION) * outputFlow) /
              inputFlow) *
            FLOW_PRECISION
          : (BOOKKEEPING_PRECISION * outputFlow) / inputFlow
      bookkeeping += price * BigInt(elapsedSlots)
      if (bookkeeping > MAX_U128) return null
    }
    slot = boundary
    // The end snapshot accrues with the old flows, before its exits apply.
    if (boundary === endSlot) break
    baseFlow -= interval?.baseExits[entry] ?? 0n
    quoteFlow -= interval?.quoteExits[entry] ?? 0n
    if (baseFlow < 0n || quoteFlow < 0n) return null
  }

  return slot === endSlot ? { slot, bookkeeping, slotsWithoutTrades } : null
}
