import { MARKET_DEFINITIONS } from '../constants'
import type { MarketCategory, MarketDefinition, MarketId } from '../constants'

export type MarketTab = 'favorites' | 'all' | MarketCategory
export type MarketSortKey = 'market' | 'price' | 'change24h' | 'volume24h'
export type MarketSort = { key: MarketSortKey; direction: 'asc' | 'desc' }
export interface MarketStats {
  price: number | null
  change24h: number | null
  volume24h: number | null
}
export type MarketStatsById = Partial<Record<MarketId, MarketStats>>

const normalize = (value: string) => value.toLowerCase().replace(/[\s/]+/g, '')

export function filterAndSortMarkets({
  query,
  tab,
  favorites,
  sort,
  stats,
}: {
  query: string
  tab: MarketTab
  favorites: readonly MarketId[]
  sort: MarketSort
  stats: MarketStatsById
}): MarketDefinition[] {
  const search = normalize(query)
  const markets = MARKET_DEFINITIONS.filter((market) => {
    const inTab =
      tab === 'all' ||
      (tab === 'favorites'
        ? favorites.includes(market.id)
        : market.category === tab)
    return (
      inTab &&
      [
        market.name,
        market.baseSymbol + market.quoteSymbol,
        market.baseMint,
      ].some((value) => normalize(value).includes(search))
    )
  })
  return markets.sort((a, b) => {
    const byName = a.baseSymbol.localeCompare(b.baseSymbol, 'en')
    if (sort.key === 'market')
      return byName * (sort.direction === 'asc' ? 1 : -1)
    const left = stats[a.id]?.[sort.key]
    const right = stats[b.id]?.[sort.key]
    const hasLeft = left != null && Number.isFinite(left)
    const hasRight = right != null && Number.isFinite(right)
    // Unknown values stay last in both directions.
    if (!hasLeft || !hasRight) return hasLeft ? -1 : hasRight ? 1 : byName
    return (left - right) * (sort.direction === 'asc' ? 1 : -1) || byName
  })
}

export function parseMarketFavorites(value: string | null): MarketId[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]')
    if (!Array.isArray(parsed)) return []
    return MARKET_DEFINITIONS.filter((market) =>
      parsed.includes(market.id),
    ).map((market) => market.id)
  } catch {
    return []
  }
}
