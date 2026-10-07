import { describe, expect, it } from 'vitest'
import { MARKET_DEFINITIONS } from '../constants'
import { filterAndSortMarkets, parseMarketFavorites } from './market-catalog'
const defaults = {
  query: '',
  tab: 'all' as const,
  favorites: [],
  sort: { key: 'market' as const, direction: 'asc' as const },
  stats: {},
}
describe('mainnet market catalog', () => {
  it('finds the deployed market by pair, name, or mint', () => {
    for (const query of [
      'sOl / uSdC',
      'Solana',
      MARKET_DEFINITIONS[0].baseMint,
    ])
      expect(
        filterAndSortMarkets({ ...defaults, query }).map((m) => m.id),
      ).toEqual([1])
    expect(filterAndSortMarkets({ ...defaults, query: 'MATO' })).toEqual([])
  })
  it('discards favorites for markets absent from mainnet', () => {
    expect(parseMarketFavorites('[4,2,4,1,1,99,"1",null]')).toEqual([1])
    for (const value of [null, 'invalid', '{}', 'null'])
      expect(parseMarketFavorites(value)).toEqual([])
  })
})
