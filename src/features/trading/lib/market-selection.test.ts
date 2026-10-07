import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MARKET_ID,
  MARKET_DEFINITIONS,
  getMarketDefinition,
  parseMarketSearch,
} from '../constants'
import { findMarketAddress } from './pdas'

describe('market selection', () => {
  it('derives the verified mainnet SOL/USDC market address', async () => {
    const market = getMarketDefinition(1)
    expect(await findMarketAddress(market)).toBe(market.address)
    expect(MARKET_DEFINITIONS).toHaveLength(1)
    expect(market.quoteMint).toBe(
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    )
    expect(() => getMarketDefinition(2)).toThrow('Unsupported market')
  })
  it.each([{ market: 1 }, { market: '1' }, new URLSearchParams('market=1')])(
    'accepts the deployed market from %o',
    (search) => {
      expect(parseMarketSearch(search)).toEqual({ market: 1 })
    },
  )
  it.each([
    undefined,
    null,
    {},
    { market: '' },
    { market: '2.0' },
    { market: '1e0' },
    { market: 2.5 },
    { market: 0 },
    { market: 5 },
    { market: 2 },
    { market: 3 },
    { market: 4 },
    { market: ['1', '2'] },
    new URLSearchParams('market=1&market=2'),
  ])('falls back to the default for invalid search input %o', (search) => {
    expect(parseMarketSearch(search)).toEqual({ market: DEFAULT_MARKET_ID })
  })
})
