import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchReadApi } from './http'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe('mobile market data transport', () => {
  it('forwards caller cancellation while reading data', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () =>
            reject(new Error('cancelled')),
          ),
        ),
    )
    vi.stubGlobal('fetch', fetcher)
    const request = fetchReadApi('https://example.com', {
      signal: controller.signal,
    })
    const result = expect(request).rejects.toThrow('cancelled')
    controller.abort()
    await result
  })
  it('aborts stalled reads after fifteen seconds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener('abort', () =>
              reject(init.signal.reason),
            ),
          ),
      ),
    )
    const result = expect(fetchReadApi('https://example.com')).rejects.toThrow(
      'timed out',
    )
    await vi.advanceTimersByTimeAsync(15_000)
    await result
  })
  it('consumes the body inside the timeout and releases its timer on success', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"price":150}')),
    )
    const response = await fetchReadApi('https://example.com')
    expect(await response.json()).toEqual({ price: 150 })
    expect(vi.getTimerCount()).toBe(0)
  })
})
