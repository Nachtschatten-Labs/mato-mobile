import { config } from '@/config'

const URL_PROTOCOL_PATTERN = /^[a-z][a-z\d+.-]*:\/\//i

export function normalizeReadApiBaseUrl(rawBaseUrl: string) {
  const trimmedBaseUrl = rawBaseUrl.trim()

  if (!trimmedBaseUrl) {
    throw new Error('Market data service is not configured')
  }

  const url = new URL(
    URL_PROTOCOL_PATTERN.test(trimmedBaseUrl)
      ? trimmedBaseUrl
      : `https://${trimmedBaseUrl.replace(/^\/\//, '')}`,
  )
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      'Read API must be an HTTP(S) URL without embedded credentials',
    )
  }
  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = pathname.endsWith('/v1') ? pathname.slice(0, -3) : pathname
  url.hash = ''

  return url.toString().replace(/\/$/, '')
}

function readApiBaseUrl() {
  return normalizeReadApiBaseUrl(config.readApiUrl)
}

export function readApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${readApiBaseUrl()}${normalizedPath}`
}

export function isReadApiConfigured() {
  return Boolean(config.readApiUrl.trim())
}
