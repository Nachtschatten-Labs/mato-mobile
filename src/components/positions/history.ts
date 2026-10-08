import type { TradePosition } from '../../lib/generated/twob/src/generated/accounts'
import type { ClosePositionEvent } from '../../integrations/read-api'
import { getTradePositionEndSlot } from '../../features/trading/lib/trade-position'

export interface PositionHistoryRange {
  startSlot: number | null
  endSlot: number | null
  includeEndSlot: boolean
  live: boolean
}

export function validHistorySlot(slot: number | null) {
  return slot !== null && Number.isSafeInteger(slot) && slot >= 0 ? slot : null
}

export function hasPositionHistoryRange(
  startSlot: number | null,
  endSlot: number | null,
): boolean {
  return (
    validHistorySlot(startSlot) !== null &&
    validHistorySlot(endSlot) !== null &&
    startSlot! <= endSlot!
  )
}

export function getActivePositionHistoryRange(
  position: Pick<
    TradePosition,
    'startSlot' | 'lastUpdateSlot' | 'remainingSlots' | 'pausedAtSlot'
  >,
  currentSlot: number | null,
): PositionHistoryRange {
  const startSlot = validHistorySlot(Number(position.startSlot))
  const paused = position.pausedAtSlot > 0n
  const scheduledEnd =
    Number.isSafeInteger(position.remainingSlots) &&
    position.remainingSlots >= 0
      ? validHistorySlot(Number(getTradePositionEndSlot(position)))
      : null
  const current = validHistorySlot(currentSlot)
  const ended =
    !paused &&
    scheduledEnd !== null &&
    current !== null &&
    current >= scheduledEnd
  // Pausing and settlement accrue with the old flows before removing the
  // position. Their emitted market update is outside this position's history.
  const endSlot = paused
    ? validHistorySlot(Number(position.pausedAtSlot))
    : ended
      ? scheduledEnd
      : current !== null && scheduledEnd !== null
        ? Math.min(current, scheduledEnd)
        : null

  return {
    startSlot,
    endSlot: hasPositionHistoryRange(startSlot, endSlot) ? endSlot : null,
    includeEndSlot: !paused && !ended,
    live: !paused && !ended,
  }
}

export function getClosedPositionHistoryRange(
  event: Pick<ClosePositionEvent, 'slot' | 'start_slot' | 'end_slot'>,
): PositionHistoryRange {
  const startSlot = validHistorySlot(event.start_slot)
  const closeSlot = validHistorySlot(event.slot)
  const reportedEnd = validHistorySlot(event.end_slot)
  const endSlot =
    closeSlot !== null && reportedEnd !== null
      ? Math.min(closeSlot, reportedEnd)
      : null

  return {
    startSlot,
    endSlot: hasPositionHistoryRange(startSlot, endSlot) ? endSlot : null,
    includeEndSlot: false,
    live: false,
  }
}

export function positionHistoryRangeKey({
  startSlot,
  endSlot,
  includeEndSlot,
  live,
  rangeKey,
}: PositionHistoryRange & { rangeKey?: string | number }) {
  // A running stream moves its end on every market tick. Keep one cache entry
  // and let the interval fetch the latest range without discarding its chart.
  return [
    'position-history',
    rangeKey ?? null,
    startSlot,
    live ? 'live' : endSlot,
    includeEndSlot,
  ] as const
}
