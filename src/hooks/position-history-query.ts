import { queryOptions } from '@tanstack/react-query'
import {
  hasPositionHistoryRange,
  positionHistoryRangeKey,
  type PositionHistoryRange,
} from '../components/positions/history'
import { fetchMarketUpdateRange } from '../features/trading/api/market-repository'
import { getMarketDefinition } from '../features/trading/constants'
import { buildPositionChartPoints } from '../features/trading/lib/position-chart'

export interface PositionHistoryOptions extends PositionHistoryRange {
  enabled: boolean
  rangeKey?: string | number
}

export function positionHistoryQueryOptions({
  queryKeyRoot,
  enabled,
  startSlot,
  endSlot,
  includeEndSlot,
  live,
  rangeKey,
}: PositionHistoryOptions & { queryKeyRoot: readonly unknown[] }) {
  const validRange = hasPositionHistoryRange(startSlot, endSlot)
  const requestEnabled = enabled && validRange
  const market = getMarketDefinition(1)
  return queryOptions({
    queryKey: [
      ...queryKeyRoot,
      ...positionHistoryRangeKey({
        startSlot,
        endSlot,
        includeEndSlot,
        live,
        rangeKey,
      }),
    ],
    queryFn: async ({ signal }) => {
      // Explicit refetch bypasses `enabled`, so protect invalid ranges here too.
      if (!validRange) return []
      const events = await fetchMarketUpdateRange({
        signal,
        marketId: 1,
        startSlot: startSlot!,
        endSlot: endSlot!,
      })
      return buildPositionChartPoints({
        events,
        livePrices: [],
        startSlot: startSlot!,
        endSlot: endSlot!,
        includeEndSlot,
        baseDecimals: market.baseDecimals,
        quoteDecimals: market.quoteDecimals,
      })
    },
    enabled: requestEnabled,
    // A successful response can still be partially indexed, including after
    // settlement. Keep refreshing any visible range until the drawer closes.
    staleTime: 5_000,
    refetchInterval: requestEnabled ? 5_000 : false,
    refetchIntervalInBackground: false,
    retry: 1,
  })
}
