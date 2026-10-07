import { config as target } from '@/config'
import { getMarketDefinition } from './constants'

export const tradingQueryRoot = [
  'trading',
  target.cluster,
  target.programId,
] as const

function normalizeKeyPart(value: bigint | number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return 'none'
  return typeof value === 'bigint' ? value.toString() : String(value)
}

export const tradingQueryKeys = {
  marketAddress: ({
    baseMint,
    quoteMint,
    id,
  }: {
    baseMint: string
    quoteMint: string
    id: number
  }) =>
    [...tradingQueryRoot, 'market-address', baseMint, quoteMint, id] as const,
  marketConfig: (marketId: number) =>
    [
      ...tradingQueryRoot,
      'market-config',
      getMarketDefinition(marketId).address,
    ] as const,
  marketUpdates: (marketId: number, limit: number) =>
    [
      ...tradingQueryRoot,
      'market-updates',
      getMarketDefinition(marketId).address,
      limit,
    ] as const,
  marketUpdateRange: (
    marketId: number,
    startSlot: number | null,
    endSlot: number | null,
  ) =>
    [
      ...tradingQueryRoot,
      'market-updates',
      'range',
      getMarketDefinition(marketId).address,
      normalizeKeyPart(startSlot),
      normalizeKeyPart(endSlot),
    ] as const,
  marketPrice: (marketId: number) =>
    [
      ...tradingQueryRoot,
      'market-price',
      getMarketDefinition(marketId).address,
    ] as const,
  marketPriceChange24h: (marketId: number) =>
    [
      ...tradingQueryRoot,
      'market-price-change-24h',
      getMarketDefinition(marketId).address,
    ] as const,
  tradePositions: (
    authority: string | null | undefined,
    marketAddress: string | undefined,
  ) =>
    [
      ...tradingQueryRoot,
      'trade-positions',
      normalizeKeyPart(authority),
      normalizeKeyPart(marketAddress),
    ] as const,
  tradePositionsForAuthority: (authority: string | null | undefined) =>
    [
      ...tradingQueryRoot,
      'trade-positions',
      normalizeKeyPart(authority),
    ] as const,
  marketTradePositions: (marketAddress: string | null | undefined) =>
    [
      ...tradingQueryRoot,
      'market-trade-positions',
      normalizeKeyPart(marketAddress),
    ] as const,
  ownedMarketIntervals: (authority: string | null | undefined) =>
    [
      ...tradingQueryRoot,
      'owned-market-intervals',
      normalizeKeyPart(authority),
    ] as const,
  closedPositions: (
    authority: string | null | undefined,
    marketId: number | undefined,
    limit: number,
    beforeSlot?: number,
  ) =>
    [
      ...tradingQueryRoot,
      'closed-positions',
      normalizeKeyPart(authority),
      normalizeKeyPart(
        marketId === undefined
          ? undefined
          : getMarketDefinition(marketId).address,
      ),
      limit,
      normalizeKeyPart(beforeSlot),
    ] as const,
  closedPositionsForAuthority: (authority: string | null | undefined) =>
    [
      ...tradingQueryRoot,
      'closed-positions',
      normalizeKeyPart(authority),
    ] as const,
  streamingMarket: (marketAddress: string | null | undefined) =>
    [
      ...tradingQueryRoot,
      'streaming-market',
      normalizeKeyPart(marketAddress),
    ] as const,
  endSlotSnapshot: (
    marketAddress: string,
    intervalIndex: number | null,
    snapshotIndex: number | null,
    isBuy: boolean,
  ) =>
    [
      ...tradingQueryRoot,
      'end-slot-snapshot',
      marketAddress,
      normalizeKeyPart(intervalIndex),
      normalizeKeyPart(snapshotIndex),
      isBuy ? 'buy' : 'sell',
    ] as const,
}
