import { describe, expect, it } from 'vitest'
import { tradingQueryKeys } from './query-keys'

describe('tradingQueryKeys.tradePositions', () => {
  it('isolates exact queries by authority and market', () => {
    expect(
      tradingQueryKeys.tradePositions('wallet-address', 'market-a'),
    ).not.toEqual(tradingQueryKeys.tradePositions('wallet-address', 'market-b'))
  })

  it('provides an authority prefix that matches every market', () => {
    const prefix = tradingQueryKeys.tradePositionsForAuthority('wallet-address')

    for (const marketAddress of ['market-a', 'market-b', 'market-c']) {
      expect(
        tradingQueryKeys
          .tradePositions('wallet-address', marketAddress)
          .slice(0, prefix.length),
      ).toEqual(prefix)
    }
  })
})

describe('tradingQueryKeys.closedPositionsForAuthority', () => {
  it('matches every closed-position query variant for the wallet', () => {
    const authority = 'wallet-address'
    const prefix = tradingQueryKeys.closedPositionsForAuthority(authority)
    const chartQueryKey = tradingQueryKeys.closedPositions(
      authority,
      1,
      1000,
      450000000,
    )
    const listQueryKey = tradingQueryKeys.closedPositions(
      authority,
      undefined,
      50,
    )

    expect(chartQueryKey.slice(0, prefix.length)).toEqual(prefix)
    expect(listQueryKey.slice(0, prefix.length)).toEqual(prefix)
  })
})
