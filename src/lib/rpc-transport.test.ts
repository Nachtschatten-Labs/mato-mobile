import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcTransport } from '@solana/kit'
import { withRpcTimeout } from './rpc-transport'

const pendingTransport: RpcTransport = ({ signal }) =>
  new Promise((_, reject) => {
    if (signal?.aborted) reject(signal.reason)
    else
      signal?.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      })
  })
afterEach(() => vi.useRealTimers())
describe('RPC transport', () => {
  it('ends stalled requests without exposing provider credentials', async () => {
    vi.useFakeTimers()
    const request = withRpcTimeout(pendingTransport, 500)({ payload: {} })
    const result = expect(request).rejects.toThrow('connection timed out')
    await vi.advanceTimersByTimeAsync(500)
    await result
  })
  it('forwards query cancellation', async () => {
    const controller = new AbortController()
    const request = withRpcTimeout(pendingTransport)({
      payload: {},
      signal: controller.signal,
    })
    controller.abort(new Error('cancelled'))
    await expect(request).rejects.toThrow('cancelled')
  })
})
