import type { MarketUpdateEvent } from '@/integrations/read-api'

export interface MarketPricePoint {
  slot: number
  price: number
}

export interface MiniPriceChartPoint {
  slot: number
  price: number
}

export interface MarketPriceRangeStats {
  maxPrice: number | null
  minPrice: number | null
  observedPoints: number
  uniquePrices: number
}

function toFinitePositivePrice(
  event: MarketUpdateEvent,
  baseScale: number,
  quoteScale: number,
) {
  if (event.base_flow === 0n) return null

  const base = Number(event.base_flow) / baseScale
  const quote = Number(event.quote_flow) / quoteScale
  if (!Number.isFinite(base) || !Number.isFinite(quote) || base === 0)
    return null

  const price = Math.abs(quote) / Math.abs(base)
  if (!Number.isFinite(price) || price <= 0) return null

  return price
}

export function normalizeMarketPricePoints(
  events: Array<MarketUpdateEvent>,
  baseDecimals: number,
  quoteDecimals: number,
) {
  const baseScale = 10 ** baseDecimals
  const quoteScale = 10 ** quoteDecimals
  const latestPerSlot = new Map<
    number,
    {
      slot: number
      price: number
      createdAtMs: number
      eventIndex: number
      signature: string
    }
  >()

  for (const event of events) {
    const price = toFinitePositivePrice(event, baseScale, quoteScale)
    const createdAtMs = new Date(event.created_at).getTime()
    if (price === null || !Number.isFinite(createdAtMs)) continue
    const eventIndex = event.event_index ?? 0

    const previous = latestPerSlot.get(event.slot)
    if (
      !previous ||
      createdAtMs > previous.createdAtMs ||
      (createdAtMs === previous.createdAtMs &&
        (event.signature !== previous.signature ||
          eventIndex >= previous.eventIndex))
    ) {
      latestPerSlot.set(event.slot, {
        slot: event.slot,
        price,
        createdAtMs,
        eventIndex,
        signature: event.signature,
      })
    }
  }

  return Array.from(latestPerSlot.values())
    .sort((left, right) => left.slot - right.slot)
    .map(({ slot, price }) => ({ slot, price }))
}

function findLastPointAtOrBefore(
  points: Array<MarketPricePoint>,
  slot: number,
) {
  let low = 0
  let high = points.length - 1
  let result = -1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (points[mid].slot <= slot) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return result
}

function findFirstPointAfter(points: Array<MarketPricePoint>, slot: number) {
  let low = 0
  let high = points.length

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (points[mid].slot <= slot) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  return low
}

function findFirstPointAtOrAfter(
  points: Array<MarketPricePoint>,
  slot: number,
) {
  let low = 0
  let high = points.length

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (points[mid].slot < slot) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  return low
}

export function getMarketPriceRangeStats(
  points: Array<MarketPricePoint>,
  startSlot: number | null,
  endSlot: number | null,
): MarketPriceRangeStats {
  if (
    points.length === 0 ||
    startSlot === null ||
    endSlot === null ||
    startSlot > endSlot
  ) {
    return {
      maxPrice: null,
      minPrice: null,
      observedPoints: 0,
      uniquePrices: 0,
    }
  }

  const startIndex = findFirstPointAtOrAfter(points, startSlot)
  if (startIndex >= points.length) {
    return {
      maxPrice: null,
      minPrice: null,
      observedPoints: 0,
      uniquePrices: 0,
    }
  }

  const endIndex = findLastPointAtOrBefore(points, endSlot)
  if (endIndex < startIndex) {
    return {
      maxPrice: null,
      minPrice: null,
      observedPoints: 0,
      uniquePrices: 0,
    }
  }

  let minPrice = Number.POSITIVE_INFINITY
  let maxPrice = Number.NEGATIVE_INFINITY
  const uniquePrices = new Set<number>()

  for (let index = startIndex; index <= endIndex; index += 1) {
    const price = points[index].price
    minPrice = Math.min(minPrice, price)
    maxPrice = Math.max(maxPrice, price)
    uniquePrices.add(price)
  }

  return {
    maxPrice: Number.isFinite(maxPrice) ? maxPrice : null,
    minPrice: Number.isFinite(minPrice) ? minPrice : null,
    observedPoints: endIndex - startIndex + 1,
    uniquePrices: uniquePrices.size,
  }
}

export function buildPositionPricePath(
  points: Array<MarketPricePoint>,
  startSlot: number | null,
  endSlot: number | null,
  {
    includeEndSlot = false,
    maxPoints = 240,
  }: { includeEndSlot?: boolean; maxPoints?: number } = {},
) {
  if (
    points.length === 0 ||
    startSlot === null ||
    endSlot === null ||
    startSlot > endSlot
  ) {
    return null
  }

  const startIndex = findLastPointAtOrBefore(points, startSlot)
  // A later observation cannot establish the price when the order began.
  if (startIndex < 0) return null

  const chartPoints: Array<MiniPriceChartPoint> = [
    { slot: startSlot, price: points[startIndex].price },
  ]
  const afterEndIndex = includeEndSlot
    ? findFirstPointAfter(points, endSlot)
    : findFirstPointAtOrAfter(points, endSlot)

  for (let index = startIndex + 1; index < afterEndIndex; index += 1) {
    const point = points[index]
    if (point.price !== chartPoints.at(-1)!.price) chartPoints.push(point)
  }

  // Settlement accrues up to the end with the old flows, then removes exits.
  // Keep the final earned price through that boundary, excluding the exit jump.
  if (chartPoints.at(-1)!.slot !== endSlot || chartPoints.length === 1) {
    chartPoints.push({ slot: endSlot, price: chartPoints.at(-1)!.price })
  }

  const pointLimit = Math.max(2, Math.floor(maxPoints))
  if (chartPoints.length <= pointLimit) return chartPoints

  // Preserve actual observations and extrema instead of inventing bucket means.
  const bucketCount = Math.floor((pointLimit - 2) / 2)
  const sampled = [chartPoints[0]]
  const interiorCount = chartPoints.length - 2
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = 1 + Math.floor((bucket * interiorCount) / bucketCount)
    const end = 1 + Math.floor(((bucket + 1) * interiorCount) / bucketCount)
    let minIndex = start
    let maxIndex = start
    for (let index = start + 1; index < end; index += 1) {
      if (chartPoints[index].price < chartPoints[minIndex].price)
        minIndex = index
      if (chartPoints[index].price > chartPoints[maxIndex].price)
        maxIndex = index
    }
    for (const index of [...new Set([minIndex, maxIndex])].sort(
      (a, b) => a - b,
    )) {
      sampled.push(chartPoints[index])
    }
  }
  sampled.push(chartPoints.at(-1)!)
  return sampled
}

export function buildClosedPositionMiniChart(
  points: Array<MarketPricePoint>,
  startSlot: number | null,
  endSlot: number | null,
  maxPoints = 240,
) {
  return buildPositionPricePath(points, startSlot, endSlot, { maxPoints })
}
