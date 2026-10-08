import { useQuery } from '@tanstack/react-query'
import { hasPositionHistoryRange } from '../components/positions/history'
import { mobileKeys, useForeground } from './usePositions'
import {
  positionHistoryQueryOptions,
  type PositionHistoryOptions,
} from './position-history-query'

export function usePositionHistory({
  enabled,
  startSlot,
  endSlot,
  includeEndSlot,
  live,
  rangeKey,
}: PositionHistoryOptions) {
  const foreground = useForeground()
  const validRange = hasPositionHistoryRange(startSlot, endSlot)
  const requestEnabled = enabled && foreground && validRange
  const history = useQuery(
    positionHistoryQueryOptions({
      queryKeyRoot: mobileKeys,
      enabled: requestEnabled,
      startSlot,
      endSlot,
      includeEndSlot,
      live,
      rangeKey,
    }),
  )

  return {
    points: validRange ? (history.data ?? []) : [],
    isLoading: requestEnabled && history.isLoading,
    hasError: validRange && history.isError,
    refetch: history.refetch,
  }
}
