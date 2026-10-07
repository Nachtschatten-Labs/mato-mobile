import { fetchReadApi } from './http'
import { getMarketDefinition } from '../constants'
import { readApiUrl } from './read-api'
import {
  buildClosedPositionMiniChart,
  normalizeMarketPricePoints,
} from '../lib/mini-chart'
import type {
  MarketConfigRow,
  MarketUpdateEvent,
} from '@/integrations/read-api'
import type { MarketPriceSnapshot } from '../domain/models'
import {
  parseClosePositionEvent,
  parseMarketUpdateEvent,
} from '@/integrations/read-api'

export type CandleInterval = '1m' | '5m' | '1h'
const MAX_LIGHTWEIGHT_CHART_ABS_VALUE = 90_071_992_547_409.91
const DEFAULT_MARKET_HISTORY_MAX_ROWS = 100_000
const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV64_PRIME = 0x100000001b3n
const FNV64_MASK = 0xffffffffffffffffn
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

interface ReadApiPriceResponse {
  market_address: string
  slot: number
  event_time: string
  price: number
}

interface ReadApiCandleItem {
  time: number
  open: number
  high: number
  low: number
  close: number
}

interface ReadApiCandleResponse {
  market_address: string
  interval: string
  from: string
  to: string
  points: number
  items: Array<ReadApiCandleItem>
}

interface ReadApiMarketHistoryItem {
  event_uid: string
  signature: string
  event_index: number
  slot: number
  market_address: string
  base_flow: string
  quote_flow: string
  created_at: string
}

interface ReadApiMarketHistoryResponse {
  market_address: string
  start_slot: number
  end_slot: number
  points: number
  items: Array<ReadApiMarketHistoryItem>
}

interface ReadApiMarketUpdatesResponse {
  market_address: string
  before_slot: number | null
  has_more: boolean
  limit: number
  points: number
  items: Array<ReadApiMarketHistoryItem>
}

interface ReadApiClosedPositionItem {
  signature: string
  event_index: number
  slot: number
  market_address: string
  start_slot: number | null
  end_slot: number | null
  deposit_amount: string
  swapped_amount: string
  remaining_amount: string
  fee_amount: string
  is_buy: boolean
  event_time: string
}

interface ReadApiClosedPositionsResponse {
  authority: string
  market_address: string | null
  before_slot: number | null
  has_more: boolean
  limit: number
  points: number
  items: Array<ReadApiClosedPositionItem>
}

export interface MarketCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function assertMarket(
  payload: { market_address: string | null },
  marketId: number,
) {
  if (payload.market_address !== getMarketDefinition(marketId).address) {
    throw new Error('Market data returned a different market address')
  }
}

const MIN_VALID_UNIX_TIME_SECONDS = 946684800 // 2000-01-01T00:00:00Z
const MAX_VALID_UNIX_TIME_SECONDS = 4102444800 // 2100-01-01T00:00:00Z

function normalizeUnixTimeSeconds(rawTime: number) {
  if (!Number.isFinite(rawTime) || rawTime <= 0) {
    return null
  }

  const candidates = [
    rawTime,
    rawTime / 1_000,
    rawTime / 1_000_000,
    rawTime / 1_000_000_000,
  ]
  for (const candidate of candidates) {
    const normalized = Math.floor(candidate)
    if (
      normalized >= MIN_VALID_UNIX_TIME_SECONDS &&
      normalized <= MAX_VALID_UNIX_TIME_SECONDS
    ) {
      return normalized
    }
  }

  return null
}

function isSafeChartNumber(value: number) {
  return (
    Number.isFinite(value) && Math.abs(value) <= MAX_LIGHTWEIGHT_CHART_ABS_VALUE
  )
}

function stableEventIdFromUid(eventUid: string) {
  let hash = FNV64_OFFSET_BASIS

  for (let index = 0; index < eventUid.length; index += 1) {
    hash ^= BigInt(eventUid.charCodeAt(index))
    hash = (hash * FNV64_PRIME) & FNV64_MASK
  }

  const normalized = hash % MAX_SAFE_INTEGER_BIGINT
  return Number(normalized === 0n ? 1n : normalized)
}

function parseReadApiPrice(data: ReadApiPriceResponse): MarketPriceSnapshot {
  const eventTimeMs = Date.parse(data.event_time)

  return {
    eventTimeMs: Number.isFinite(eventTimeMs) ? eventTimeMs : null,
    price: Number.isFinite(data.price) ? data.price : null,
    slot: Number.isFinite(data.slot) ? data.slot : null,
  }
}

export function sortMarketUpdatesDescending(events: Array<MarketUpdateEvent>) {
  return [...events].sort((left, right) => right.slot - left.slot)
}

export function dedupeMarketUpdatesById(events: Array<MarketUpdateEvent>) {
  const ids = new Set<number>()
  const deduped: Array<MarketUpdateEvent> = []

  for (const event of events) {
    if (ids.has(event.id)) continue
    ids.add(event.id)
    deduped.push(event)
  }

  return deduped
}

export async function fetchMarketConfig(
  marketId: number,
  signal?: AbortSignal,
) {
  const url = readApiUrl(
    `/v1/markets/${getMarketDefinition(marketId).address}/config`,
  )
  const response = await fetchReadApi(url, {
    signal,
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Failed to fetch market config from ${url} (${response.status}): ${body || response.statusText}`,
    )
  }

  const config = (await response.json()) as MarketConfigRow
  assertMarket(config, marketId)
  const expected = getMarketDefinition(marketId)
  if (
    config.base_mint !== expected.baseMint ||
    config.quote_mint !== expected.quoteMint ||
    config.base_decimals !== expected.baseDecimals ||
    config.quote_decimals !== expected.quoteDecimals
  ) {
    throw new Error(
      'Market data configuration does not match the deployed market',
    )
  }
  return config
}

export async function fetchMarketUpdatesPage({
  signal,
  beforeSlot,
  limit,
  marketId,
}: {
  signal?: AbortSignal
  beforeSlot?: number
  limit: number
  marketId: number
}) {
  const query = new URLSearchParams({
    limit: String(limit),
  })
  if (beforeSlot !== undefined) {
    query.set('before_slot', String(beforeSlot))
  }

  const response = await fetchReadApi(
    readApiUrl(
      `/v1/markets/${getMarketDefinition(marketId).address}/updates?${query.toString()}`,
    ),
    {
      signal,
      headers: {
        Accept: 'application/json',
      },
    },
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Failed to fetch market updates (${response.status}): ${body || response.statusText}`,
    )
  }

  const payload = (await response.json()) as ReadApiMarketUpdatesResponse
  assertMarket(payload, marketId)
  payload.items.forEach((item) => assertMarket(item, marketId))
  return parseReadApiMarketUpdateItems(payload.items)
}

export async function fetchLatestMarketUpdate(
  marketId: number,
  signal?: AbortSignal,
) {
  const rows = await fetchMarketUpdatesPage({
    signal,
    limit: 1,
    marketId,
  })
  return rows[0] ?? null
}

export async function fetchMarketPrice({
  marketId,
  signal,
}: {
  marketId: number
  signal?: AbortSignal
}) {
  const response = await fetchReadApi(
    readApiUrl(`/v1/markets/${getMarketDefinition(marketId).address}/price`),
    {
      signal,
      headers: {
        Accept: 'application/json',
      },
    },
  )

  if (response.status === 404)
    return { eventTimeMs: null, price: null, slot: null }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Failed to fetch market price (${response.status}): ${body || response.statusText}`,
    )
  }

  const data = (await response.json()) as ReadApiPriceResponse

  assertMarket(data, marketId)
  return parseReadApiPrice(data)
}

export async function fetchMarketCandles({
  signal,
  from,
  interval,
  marketId,
  maxPoints = 1500,
  to,
}: {
  signal?: AbortSignal
  from: Date
  interval: CandleInterval
  marketId: number
  maxPoints?: number
  to: Date
}) {
  const query = new URLSearchParams({
    from: from.toISOString(),
    interval,
    max_points: String(maxPoints),
    to: to.toISOString(),
  })

  const response = await fetchReadApi(
    readApiUrl(
      `/v1/markets/${getMarketDefinition(marketId).address}/candles?${query.toString()}`,
    ),
    {
      signal,
      headers: {
        Accept: 'application/json',
      },
    },
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Failed to fetch market candles (${response.status}): ${body || response.statusText}`,
    )
  }

  const payload = (await response.json()) as ReadApiCandleResponse
  assertMarket(payload, marketId)
  const candles = payload.items
    .map<MarketCandle | null>((item) => {
      const time = normalizeUnixTimeSeconds(item.time)
      if (time === null) {
        return null
      }
      if (
        !isSafeChartNumber(item.open) ||
        !isSafeChartNumber(item.high) ||
        !isSafeChartNumber(item.low) ||
        !isSafeChartNumber(item.close)
      ) {
        return null
      }
      if (
        item.open <= 0 ||
        item.high <= 0 ||
        item.low <= 0 ||
        item.close <= 0
      ) {
        return null
      }

      const normalizedHigh = Math.max(
        item.open,
        item.high,
        item.low,
        item.close,
      )
      const normalizedLow = Math.min(item.open, item.high, item.low, item.close)

      return {
        close: item.close,
        high: normalizedHigh,
        low: normalizedLow,
        open: item.open,
        time,
        volume: 0,
      }
    })
    .filter((item): item is MarketCandle => item !== null)
    .sort((left, right) => left.time - right.time)

  const dedupedCandles: Array<MarketCandle> = []
  for (const candle of candles) {
    const previous = dedupedCandles.at(-1)
    if (previous && previous.time === candle.time) {
      dedupedCandles[dedupedCandles.length - 1] = candle
      continue
    }

    dedupedCandles.push(candle)
  }

  return dedupedCandles
}

export async function fetchMarketUpdateRange({
  signal,
  endSlot,
  marketId,
  startSlot,
}: {
  signal?: AbortSignal
  endSlot: number
  marketId: number
  startSlot: number
}) {
  if (startSlot > endSlot) return []

  return fetchMarketUpdateRangeFromReadApi({
    signal,
    endSlot,
    marketId,
    startSlot,
  })
}

export async function fetchClosedPositionMiniChart({
  signal,
  endSlot,
  marketId,
  maxPoints = 240,
  startSlot,
}: {
  signal?: AbortSignal
  endSlot: number
  marketId: number
  maxPoints?: number
  startSlot: number
}) {
  if (startSlot > endSlot) return []

  // The mini-chart endpoint samples the first event in each bucket and includes
  // an earlier anchor. Raw history retains the post-order event at startSlot.
  const events = await fetchMarketUpdateRange({
    endSlot,
    marketId,
    startSlot,
    signal,
  })
  const market = getMarketDefinition(marketId)
  const points = normalizeMarketPricePoints(
    events,
    market.baseDecimals,
    market.quoteDecimals,
  )
  return (
    buildClosedPositionMiniChart(points, startSlot, endSlot, maxPoints) ?? []
  )
}

async function fetchMarketUpdateRangeFromReadApi({
  signal,
  endSlot,
  marketId,
  startSlot,
}: {
  signal?: AbortSignal
  endSlot: number
  marketId: number
  startSlot: number
}) {
  const query = new URLSearchParams({
    end_slot: String(endSlot),
    max_rows: String(DEFAULT_MARKET_HISTORY_MAX_ROWS),
    start_slot: String(startSlot),
  })

  const response = await fetchReadApi(
    readApiUrl(
      `/v1/markets/${getMarketDefinition(marketId).address}/history?${query.toString()}`,
    ),
    {
      signal,
      headers: {
        Accept: 'application/json',
      },
    },
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Failed to fetch market history (${response.status}): ${body || response.statusText}`,
    )
  }

  const payload = (await response.json()) as ReadApiMarketHistoryResponse
  assertMarket(payload, marketId)
  payload.items.forEach((item) => assertMarket(item, marketId))
  return parseReadApiMarketUpdateItems(payload.items)
}

export async function fetchClosedPositionEvents({
  signal,
  beforeSlot,
  limit = 50,
  marketId,
  positionAuthority,
}: {
  signal?: AbortSignal
  beforeSlot?: number
  limit?: number
  marketId?: number
  positionAuthority: string
}) {
  const query = new URLSearchParams({ limit: String(limit) })
  if (marketId !== undefined) {
    query.set('market_address', getMarketDefinition(marketId).address)
  }
  if (beforeSlot !== undefined) {
    query.set('before_slot', String(beforeSlot))
  }

  const response = await fetchReadApi(
    readApiUrl(
      `/v1/authorities/${positionAuthority}/closed-positions?${query.toString()}`,
    ),
    {
      signal,
      headers: {
        Accept: 'application/json',
      },
    },
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Failed to fetch closed positions (${response.status}): ${body || response.statusText}`,
    )
  }

  const payload = (await response.json()) as ReadApiClosedPositionsResponse
  if (payload.authority !== positionAuthority)
    throw new Error('Market data returned a different authority')
  if (marketId !== undefined) {
    assertMarket(payload, marketId)
    payload.items.forEach((item) => assertMarket(item, marketId))
  }
  return payload.items.map((item) =>
    parseClosePositionEvent({
      created_at: item.event_time,
      deposit_amount: item.deposit_amount,
      end_slot: item.end_slot,
      fee_amount: item.fee_amount,
      id: stableEventIdFromUid(`${item.signature}:${item.event_index}`),
      is_buy: item.is_buy ? 1 : 0,
      market_address: item.market_address,
      position_authority: payload.authority,
      remaining_amount: item.remaining_amount,
      signature: item.signature,
      slot: item.slot,
      start_slot: item.start_slot,
      swapped_amount: item.swapped_amount,
    }),
  )
}

function parseReadApiMarketUpdateItems(items: Array<ReadApiMarketHistoryItem>) {
  return items.map((item) =>
    parseMarketUpdateEvent({
      base_flow: item.base_flow,
      created_at: item.created_at,
      event_index: item.event_index,
      id: stableEventIdFromUid(item.event_uid),
      market_address: item.market_address,
      quote_flow: item.quote_flow,
      signature: item.signature,
      slot: item.slot,
    }),
  )
}
