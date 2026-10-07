import type { RpcTransport } from '@solana/kit'

/** Bound every RPC read, including confirmation polls, and honor query cancellation. */
export function withRpcTimeout(
  transport: RpcTransport,
  timeoutMs = 20_000,
): RpcTransport {
  return async (request) => {
    const controller = new AbortController()
    const forwardAbort = () => controller.abort(request.signal?.reason)
    if (request.signal?.aborted) forwardAbort()
    else request.signal?.addEventListener('abort', forwardAbort, { once: true })
    const timeout = setTimeout(
      () =>
        controller.abort(
          new Error('The Solana connection timed out. Please try again.'),
        ),
      timeoutMs,
    )
    try {
      return await transport({ ...request, signal: controller.signal })
    } finally {
      clearTimeout(timeout)
      request.signal?.removeEventListener('abort', forwardAbort)
    }
  }
}
