import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMarketUpdateRange } from '../features/trading/api/market-repository'
import { positionHistoryQueryOptions } from './position-history-query'
import type { MarketUpdateEvent } from '../integrations/read-api'

vi.mock('../features/trading/api/market-repository', () => ({
  fetchMarketUpdateRange: vi.fn(),
}))

const defaults = {
  queryKeyRoot: ['history-test'],
  enabled: true,
  startSlot: 1_000,
  endSlot: 1_050,
  includeEndSlot: true,
  live: true,
}

function event(slot: number, price: number): MarketUpdateEvent {
  return {
    id: slot,
    signature: `tx-${slot}`,
    slot,
    base_flow: 1_000_000_000n,
    quote_flow: BigInt(price * 1_000_000),
    market_address: 'market',
    created_at: '2026-10-08T12:00:00Z',
  }
}

afterEach(() => vi.clearAllMocks())

describe('position history requests', () => {
  it('fetches the expanded range and reuses its live cache between clock ticks', async () => {
    const client = new QueryClient()
    const observer = new QueryObserver(
      client,
      positionHistoryQueryOptions(defaults),
    )
    vi.mocked(fetchMarketUpdateRange).mockResolvedValue([
      event(1_000, 120),
      event(1_040, 125),
    ])
    await observer.refetch()
    const fetched = observer.getCurrentResult().data
    expect(fetched).toEqual([
      { slot: 1_000, price: 120 },
      { slot: 1_040, price: 125 },
      { slot: 1_050, price: 125 },
    ])
    expect(fetchMarketUpdateRange).toHaveBeenLastCalledWith({
      signal: expect.any(AbortSignal),
      marketId: 1,
      startSlot: 1_000,
      endSlot: 1_050,
    })

    observer.setOptions(
      positionHistoryQueryOptions({ ...defaults, endSlot: 1_060 }),
    )
    expect(observer.getCurrentResult().data).toBe(fetched)
    expect(client.getQueryCache().getAll()).toHaveLength(1)
    await observer.refetch()
    expect(fetchMarketUpdateRange).toHaveBeenLastCalledWith({
      signal: expect.any(AbortSignal),
      marketId: 1,
      startSlot: 1_000,
      endSlot: 1_060,
    })
    observer.destroy()
    client.clear()
  })

  it('excludes the settlement price jump when a live position completes', async () => {
    const client = new QueryClient()
    const observer = new QueryObserver(
      client,
      positionHistoryQueryOptions(defaults),
    )
    vi.mocked(fetchMarketUpdateRange).mockResolvedValue([
      event(1_000, 120),
      event(1_050, 90),
    ])
    await observer.refetch()
    expect(observer.getCurrentResult().data?.at(-1)?.price).toBe(90)
    observer.setOptions(
      positionHistoryQueryOptions({
        ...defaults,
        includeEndSlot: false,
        live: false,
      }),
    )
    await observer.refetch()
    expect(observer.getCurrentResult().data).toEqual([
      { slot: 1_000, price: 120 },
      { slot: 1_050, price: 120 },
    ])
    observer.destroy()
    client.clear()
  })

  it('does not fetch hidden drawers or invalid ranges, including manual invalid retries', async () => {
    const client = new QueryClient()
    const hidden = new QueryObserver(
      client,
      positionHistoryQueryOptions({
        ...defaults,
        enabled: false,
      }),
    )
    const unsubscribe = hidden.subscribe(() => {})
    expect(fetchMarketUpdateRange).not.toHaveBeenCalled()

    const invalid = new QueryObserver(
      client,
      positionHistoryQueryOptions({
        ...defaults,
        endSlot: null,
      }),
    )
    expect(invalid.options.enabled).toBe(false)
    await invalid.refetch()
    expect(fetchMarketUpdateRange).not.toHaveBeenCalled()
    expect(invalid.getCurrentResult().data).toEqual([])
    unsubscribe()
    hidden.destroy()
    invalid.destroy()
    client.clear()
  })

  it('refreshes empty and partially indexed completed history, stopping when hidden', async () => {
    const client = new QueryClient()
    const completed = { ...defaults, includeEndSlot: false, live: false }
    const options = positionHistoryQueryOptions(completed)
    const observer = new QueryObserver(client, options)
    vi.mocked(fetchMarketUpdateRange)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([event(1_000, 120)])
      .mockResolvedValueOnce([event(1_000, 120), event(1_030, 125)])
    await observer.refetch()
    expect(observer.getCurrentResult().data).toEqual([])
    expect(options.refetchInterval).toBe(5_000)
    expect(
      positionHistoryQueryOptions({ ...completed, enabled: false })
        .refetchInterval,
    ).toBe(false)
    await observer.refetch()
    expect(observer.getCurrentResult().data).toHaveLength(2)
    await observer.refetch()
    expect(observer.getCurrentResult().data).toEqual([
      { slot: 1_000, price: 120 },
      { slot: 1_030, price: 125 },
      { slot: 1_050, price: 125 },
    ])
    expect(options.staleTime).toBe(5_000)
    observer.destroy()
    client.clear()
  })
})
