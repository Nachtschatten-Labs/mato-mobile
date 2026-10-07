import { durationToSlots } from '../lib/amounts'
import { computeMarketStats, marketPriceFromFlows } from '../lib/market'
import { computePriceImpactPercent } from '../lib/price-impact'
import {
  formatCrosshairTimeLabel,
  formatPrice,
  formatUiAmount,
  shortenAddress,
} from '../lib/format'
import type {
  MarketConfigRow,
  MarketUpdateEvent,
} from '@/integrations/read-api'
import type { OrderSide } from '../constants'
import type { TradingViewAggregatedCandle } from '../lib/market'
import type {
  StreamingMarketState,
  TradePositionRecord,
} from '../domain/models'

const PRICE_CHANGE_24H_LOOKBACK_SECONDS = 24 * 60 * 60

export interface DashboardChartFocus {
  close: number
  high: number
  low: number
  open: number
  time: number
}

export interface DashboardMarketPrice {
  eventTimeMs?: number | null
  price: number | null
  slot: number | null
}

export interface ReferenceMarketPricingInputs {
  baseDecimals: number
  chartCandles: Array<TradingViewAggregatedCandle>
  crosshairData: DashboardChartFocus | null
  marketPrice?: DashboardMarketPrice
  marketUpdates: Array<MarketUpdateEvent>
  priceChangeHistory: Array<TradingViewAggregatedCandle>
  quoteDecimals: number
}

export interface TradingMarketIdentity {
  baseDecimals: number
  baseMint: string | null
  baseTicker: string
  quoteDecimals: number
  quoteMint: string | null
  quoteTicker: string
}

function resolveTicker(
  mint: string | null | undefined,
  ticker: string | null | undefined,
  fallback: string,
) {
  return (
    ticker?.toUpperCase() ??
    (mint ? shortenAddress(mint, 4, 4).toUpperCase() : fallback)
  )
}

function findPriceAtOrBefore(
  candles: Array<TradingViewAggregatedCandle>,
  targetTime: number,
) {
  let candidate: TradingViewAggregatedCandle | null = null

  for (const candle of candles) {
    if (candle.time > targetTime) {
      break
    }
    candidate = candle
  }

  return candidate?.close ?? null
}

export function calculateRelativePriceChangePercent({
  currentPrice,
  priceHistory,
  referenceTime,
}: {
  currentPrice: number | null
  priceHistory: Array<TradingViewAggregatedCandle>
  referenceTime: number | null
}) {
  if (
    currentPrice === null ||
    referenceTime === null ||
    !Number.isFinite(currentPrice) ||
    !Number.isFinite(referenceTime) ||
    currentPrice <= 0
  ) {
    return null
  }

  const referencePrice = findPriceAtOrBefore(
    priceHistory,
    referenceTime - PRICE_CHANGE_24H_LOOKBACK_SECONDS,
  )

  if (
    referencePrice === null ||
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0
  ) {
    return null
  }

  return ((currentPrice - referencePrice) / referencePrice) * 100
}

export function deriveMarketIdentity(
  marketConfig: MarketConfigRow | null | undefined,
): TradingMarketIdentity {
  const baseMint = marketConfig?.base_mint ?? null
  const quoteMint = marketConfig?.quote_mint ?? null

  return {
    baseDecimals: marketConfig?.base_decimals ?? 0,
    baseMint,
    baseTicker: resolveTicker(baseMint, marketConfig?.base_ticker, 'BASE'),
    quoteDecimals: marketConfig?.quote_decimals ?? 0,
    quoteMint,
    quoteTicker: resolveTicker(quoteMint, marketConfig?.quote_ticker, 'QUOTE'),
  }
}

export function buildTradingDashboardViewModel({
  amountAtoms,
  amountUiValue,
  baseDecimals,
  baseTicker,
  durationSeconds,
  quoteDecimals,
  quoteTicker,
  referencePricing,
  side,
  streamingState,
  tradePositions,
}: {
  amountAtoms: bigint | null
  amountUiValue: number | null
  baseDecimals: number
  baseTicker: string
  durationSeconds: number | null
  quoteDecimals: number
  quoteTicker: string
  referencePricing: ReferenceMarketPricingInputs
  side: OrderSide
  streamingState: StreamingMarketState | null | undefined
  tradePositions: Array<TradePositionRecord>
}) {
  const {
    chartCandles,
    crosshairData,
    marketPrice,
    marketUpdates,
    priceChangeHistory,
  } = referencePricing
  const latestChartCandle = chartCandles.at(-1) ?? null
  const recentTickPrices = marketUpdates
    .slice(0, 2)
    .map((event) =>
      marketPriceFromFlows(
        event.base_flow,
        event.quote_flow,
        referencePricing.baseDecimals,
        referencePricing.quoteDecimals,
      ),
    )
    .filter((value): value is number => value !== null)

  const latestTickPrice = recentTickPrices.at(0) ?? null
  const previousTickPrice = recentTickPrices.at(1) ?? null
  const onChainIndicativePrice = streamingState
    ? marketPriceFromFlows(
        streamingState.marketBaseFlow,
        streamingState.marketQuoteFlow,
        baseDecimals,
        quoteDecimals,
      )
    : null

  const displayPrice =
    marketPrice?.price ?? latestTickPrice ?? latestChartCandle?.close ?? null

  const priceDelta =
    latestTickPrice !== null && previousTickPrice !== null
      ? latestTickPrice - previousTickPrice
      : latestChartCandle
        ? latestChartCandle.close - latestChartCandle.open
        : null

  const priceDeltaPercent =
    priceDelta !== null && displayPrice !== null && displayPrice > 0
      ? (priceDelta / displayPrice) * 100
      : null
  const priceChangeReferenceTime =
    typeof marketPrice?.eventTimeMs === 'number' &&
    Number.isFinite(marketPrice.eventTimeMs)
      ? Math.floor(marketPrice.eventTimeMs / 1000)
      : (priceChangeHistory.at(-1)?.time ?? latestChartCandle?.time ?? null)
  const priceChange24hPercent = calculateRelativePriceChangePercent({
    currentPrice: displayPrice,
    priceHistory: priceChangeHistory,
    referenceTime: priceChangeReferenceTime,
  })

  const marketStats = computeMarketStats(
    marketUpdates,
    referencePricing.baseDecimals,
    referencePricing.quoteDecimals,
  )

  const priceImpactPercent =
    durationSeconds === null
      ? null
      : computePriceImpactPercent({
          amountAtoms,
          durationSlots: durationToSlots(durationSeconds),
          side,
          streamingState,
        })

  const signedPriceImpactPercent =
    priceImpactPercent === null
      ? null
      : side === 'buy'
        ? priceImpactPercent
        : -priceImpactPercent

  const executionPrice = (() => {
    if (onChainIndicativePrice === null || onChainIndicativePrice <= 0)
      return null
    if (amountAtoms !== null && amountAtoms > 0n && durationSeconds === null)
      return null
    if (signedPriceImpactPercent === null) return onChainIndicativePrice

    const nextPrice =
      onChainIndicativePrice * (1 + signedPriceImpactPercent / 100)
    if (!Number.isFinite(nextPrice) || nextPrice <= 0) return null
    return nextPrice
  })()

  const estimatedConversionText = (() => {
    if (amountUiValue === null) {
      return `0 ${side === 'buy' ? baseTicker : quoteTicker}`
    }
    if (!executionPrice || executionPrice <= 0) {
      return `— ${side === 'buy' ? baseTicker : quoteTicker}`
    }

    if (side === 'buy') {
      return `~${formatUiAmount(amountUiValue / executionPrice)} ${baseTicker}`
    }

    return `~${formatUiAmount(amountUiValue * executionPrice)} ${quoteTicker}`
  })()

  const activeOhlcv = crosshairData ?? latestChartCandle

  return {
    activeOhlcv,
    activeOhlcvTimeLabel: formatCrosshairTimeLabel(
      activeOhlcv === null ? null : activeOhlcv.time,
    ),
    activePositions: tradePositions,
    chartCandles,
    displayPrice,
    estimatedConversionText,
    executionPrice,
    executionPriceDisplay:
      executionPrice === null ? '—' : `$${formatUiAmount(executionPrice)}`,
    latestChartCandle,
    latestTickPrice,
    marketStats,
    onChainIndicativePrice,
    priceDelta,
    priceDeltaPercent,
    priceChange24hDisplay: formatDashboardPriceChangePercent(
      priceChange24hPercent,
    ),
    priceChange24hPercent,
    priceImpactDisplay:
      priceImpactPercent === null
        ? '—'
        : `${priceImpactPercent < 0.001 ? '<0.001' : priceImpactPercent.toFixed(3)}%`,
    priceImpactPercent,
    signedPriceImpactPercent,
  }
}

export function formatDashboardPrice(value: number | null) {
  return value === null ? '—' : `$${formatPrice(value)}`
}

export function formatDashboardPriceChangePercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '24h —'

  const absolute = Math.abs(value)
  const formatted =
    absolute > 0 && absolute < 0.01 ? '<0.01' : absolute.toFixed(2)
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${formatted}% 24h`
}
