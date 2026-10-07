import {
  buildPositionPricePath,
  normalizeMarketPricePoints,
} from './mini-chart'
import type { MarketUpdateEvent } from '@/integrations/read-api'
import type { MarketPriceSnapshot } from '../domain/models'
import type { MiniPriceChartPoint } from './mini-chart'

export type PositionChartPoint = MiniPriceChartPoint

export function buildPositionChartPoints({
  events,
  livePrices,
  startSlot,
  endSlot,
  includeEndSlot,
  baseDecimals,
  quoteDecimals,
}: {
  events: MarketUpdateEvent[]
  livePrices: MarketPriceSnapshot[]
  startSlot: number
  endSlot: number
  includeEndSlot: boolean
  baseDecimals: number
  quoteDecimals: number
}): PositionChartPoint[] {
  const points = normalizeMarketPricePoints(events, baseDecimals, quoteDecimals)
  const lastIndexedSlot = points.at(-1)?.slot ?? -1
  // Indexed history is authoritative; the stream only fills its trailing gap.
  for (const observation of livePrices) {
    if (
      observation.slot !== null &&
      observation.slot > lastIndexedSlot &&
      observation.slot >= startSlot &&
      observation.price !== null &&
      Number.isFinite(observation.price) &&
      observation.price > 0
    ) {
      points.push({ slot: observation.slot, price: observation.price })
    }
  }
  const ordered = [
    ...new Map(
      points
        .sort((a, b) => a.slot - b.slot)
        .map((point) => [point.slot, point]),
    ).values(),
  ]
  return (
    buildPositionPricePath(ordered, startSlot, endSlot, {
      includeEndSlot,
      maxPoints: 1500,
    }) ?? []
  )
}

export function formatStreamDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return '—'
  const rounded = Math.max(0, Math.ceil(seconds))
  if (rounded < 60) return `${rounded}s`
  if (rounded < 3600) return `${Math.ceil(rounded / 60)}m`
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`
  return `${hours}h${minutes ? ` ${minutes}m` : ''}`
}
