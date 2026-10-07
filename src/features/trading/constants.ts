import type { Address } from '@solana/kit'

const SUPPORTED_MARKET_IDS = [1] as const

export type MarketId = (typeof SUPPORTED_MARKET_IDS)[number]
export type MarketCategory = 'crypto' | 'equities'

export interface MarketDefinition {
  readonly id: MarketId
  readonly address: Address
  readonly name: string
  readonly category: MarketCategory
  readonly baseSymbol: string
  readonly quoteSymbol: string
  readonly baseMint: Address
  readonly quoteMint: Address
  readonly baseDecimals: number
  readonly quoteDecimals: number
  readonly minimumBaseDepositAtoms: bigint
  readonly minimumQuoteDepositAtoms: bigint
}

export const MARKET_DEFINITIONS = [
  {
    id: 1,
    address: 'FUDH6hiwDNjdQKbH7fveFFPoEE3mXk9i1g2WbgnSqob3' as Address,
    name: 'Solana',
    category: 'crypto',
    baseSymbol: 'SOL',
    quoteSymbol: 'USDC',
    baseMint: 'So11111111111111111111111111111111111111112' as Address,
    quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' as Address,
    baseDecimals: 9,
    quoteDecimals: 6,
    minimumBaseDepositAtoms: 1_000_000n,
    minimumQuoteDepositAtoms: 100_000n,
  },
] as const satisfies ReadonlyArray<MarketDefinition>

function parseSupportedMarketId(value: unknown): MarketId | null {
  const marketId =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN

  return SUPPORTED_MARKET_IDS.find((id) => id === marketId) ?? null
}

export const DEFAULT_MARKET_ID: MarketId = 1

export function getMarketDefinition(marketId: number): MarketDefinition {
  const market = MARKET_DEFINITIONS.find(
    (definition) => definition.id === marketId,
  )
  if (!market) throw new Error(`Unsupported market id: ${marketId}`)
  return market
}

export function parseMarketSearch(value: unknown): { market: MarketId } {
  const candidate =
    value instanceof URLSearchParams
      ? value.getAll('market').length === 1
        ? value.get('market')
        : null
      : typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>).market
        : null

  return { market: parseSupportedMarketId(candidate) ?? DEFAULT_MARKET_ID }
}

// Match the Twob mainnet release constants (not emitted in the IDL).
export const ARRAY_LENGTH = 16
export const END_SLOT_INTERVAL = 11
export const SLOT_DURATION_MS = 200
export const SLOT_DURATION_SECONDS = SLOT_DURATION_MS / 1000
export const MAX_ORDER_DURATION_SECONDS = 365 * 24 * 60 * 60
export const NATIVE_SOL_DECIMALS = 9
export const NATIVE_FEE_BUFFER_ATOMS = 20_000_000n
export const MAINTENANCE_TRANSACTION_FEE_BUFFER_ATOMS = 1_000_000n
export const DEFAULT_MARKET_UPDATES_LIMIT = 200
export const CHART_HISTORY_REQUEST_BASE_THRESHOLD_BARS = 20
export const CHART_HISTORY_REQUEST_THRESHOLD_RATIO = 0.35
export const CHART_HISTORY_REQUEST_BUFFER_BARS = 24
export const CHART_HISTORY_REQUEST_MIN_BARS = 72
export const CHART_HISTORY_REQUEST_DEBOUNCE_MS = 450
export const CLOSED_POSITION_BATCH_GAP_SLOTS = 900
// Keep batch closes within the transaction wire limit, including distinct receivers.
export const MAX_BATCH_CLOSE_POSITIONS_PER_TRANSACTION = 2
export const MAX_RECLAIM_RENT_ACCOUNTS_PER_TRANSACTION = 10
export const POSITION_PAGE_SIZE = 10
export const HIGH_PRICE_IMPACT_WARNING_THRESHOLD_PERCENT = 1

export const DURATION_OPTIONS = [
  { label: '5s', seconds: 5 },
  { label: '10s', seconds: 10 },
  { label: '20s', seconds: 20 },
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 1 * 60 },
  { label: '5m', seconds: 5 * 60 },
  { label: '10m', seconds: 10 * 60 },
  { label: '30m', seconds: 30 * 60 },
  { label: '1h', seconds: 60 * 60 },
  { label: '2h', seconds: 2 * 60 * 60 },
  { label: '4h', seconds: 4 * 60 * 60 },
  { label: '12h', seconds: 12 * 60 * 60 },
  { label: '1d', seconds: 24 * 60 * 60 },
  { label: '3d', seconds: 3 * 24 * 60 * 60 },
  { label: '1w', seconds: 7 * 24 * 60 * 60 },
  { label: '1mo', seconds: 30 * 24 * 60 * 60 },
  { label: '3mo', seconds: 90 * 24 * 60 * 60 },
  { label: '6mo', seconds: 180 * 24 * 60 * 60 },
  { label: '1y', seconds: MAX_ORDER_DURATION_SECONDS },
] as const

export const CHART_TIMEFRAMES = [
  { label: '1m', intervalMs: 1 * 60 * 1000 },
  { label: '5m', intervalMs: 5 * 60 * 1000 },
  { label: '1h', intervalMs: 60 * 60 * 1000 },
] as const

export type ChartTimeframe = (typeof CHART_TIMEFRAMES)[number]['label']

export const CHART_RANGES = [
  { label: '1H', timeframe: '1m', visibleBars: 60 },
  { label: '1D', timeframe: '5m', visibleBars: 288 },
  { label: '1W', timeframe: '1h', visibleBars: 168 },
] as const satisfies ReadonlyArray<{
  label: string
  timeframe: ChartTimeframe
  visibleBars: number
}>

export type OrderSide = 'buy' | 'sell'
export type MarketPanelTab = 'chart' | 'trades' | 'order-book'
export type PositionPanelTab = 'active' | 'closed'
