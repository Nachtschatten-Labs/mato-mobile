const READ_API_TIMEOUT_MS = 15_000

/** Bound reads across headers and body, and release cancelled/background queries. */
export async function fetchReadApi(url: string, init: RequestInit = {}) {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(init.signal?.reason)
  if (init.signal?.aborted) abortFromCaller()
  else init.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Error(
          'Market data request timed out. Pull to refresh to try again.',
        ),
      ),
    READ_API_TIMEOUT_MS,
  )
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const body = await response.text()
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text: async () => body,
      json: async (): Promise<unknown> => JSON.parse(body),
    }
  } finally {
    clearTimeout(timeout)
    init.signal?.removeEventListener('abort', abortFromCaller)
  }
}
