import { createRequire } from 'node:module'
import { createElement, type PropsWithChildren, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FillHistory } from './FillHistory'

const { renderToStaticMarkup } = createRequire(import.meta.url)(
  'react-dom/server',
) as { renderToStaticMarkup: (element: ReactNode) => string }

const { retryHandlers } = vi.hoisted(() => ({
  retryHandlers: [] as Array<() => void>,
}))

vi.mock('react-native', async () => {
  const { createElement } = await import('react')
  return {
    StyleSheet: { create: <T>(styles: T) => styles },
    View: ({
      children,
      accessibilityLabel,
    }: PropsWithChildren<{ accessibilityLabel?: string }>) =>
      createElement('div', { 'aria-label': accessibilityLabel }, children),
    Pressable: ({
      children,
      onPress,
    }: PropsWithChildren<{ onPress: () => void }>) => {
      retryHandlers.push(onPress)
      return createElement('button', null, children)
    },
  }
})

vi.mock('react-native-svg', () => ({
  default: 'svg',
  Circle: 'circle',
  Line: 'line',
  Path: 'path',
}))

vi.mock('../ui', async () => {
  const { createElement } = await import('react')
  return {
    Text: ({
      children,
      accessibilityRole,
    }: PropsWithChildren<{ accessibilityRole?: string }>) =>
      createElement('span', { role: accessibilityRole }, children),
  }
})

type FillHistoryProps = Parameters<typeof FillHistory>[0]

function renderHistory(props: Partial<FillHistoryProps> = {}) {
  return renderToStaticMarkup(
    createElement(FillHistory, {
      points: [],
      startPrice: 100,
      average: 105,
      isLoading: false,
      hasError: false,
      onRetry: vi.fn(),
      ...props,
    }),
  )
}

const points = [
  { slot: 100, price: 100 },
  { slot: 110, price: 120 },
  { slot: 140, price: 110 },
]

describe('FillHistory', () => {
  beforeEach(() => {
    retryHandlers.length = 0
  })

  it('renders slot-spaced market prices as steps with a separate average guide', () => {
    const markup = renderHistory({ points })

    expect(markup).toContain('d="M4,104 H82 V16 H316 V60"')
    expect(markup).toMatch(
      /<line[^>]+y1="82"[^>]+y2="82"[^>]+stroke-dasharray="4 4"/,
    )
    expect(markup).toContain('Latest recorded price 110.00')
    expect(markup).toContain('Average fill 105.00 USDC per SOL.')
    expect(markup).toContain('average fill shown separately')
    expect(markup).not.toContain('<button')
  })

  it.each([
    [{ isLoading: true }, 'Loading price history…'],
    [{}, 'No price history is available for this stream yet.'],
    [{ hasError: true }, 'Could not load price history.'],
  ])(
    'shows the appropriate empty state without fabricating a price path',
    (props, message) => {
      const markup = renderHistory(props)

      expect(markup).toContain(message)
      expect(markup).not.toContain('<svg')
      expect(markup).not.toContain('<path')
    },
  )

  it('retries a failed initial history request', () => {
    const onRetry = vi.fn()
    const markup = renderHistory({ hasError: true, onRetry })

    expect(markup).toContain('Retry price history')
    expect(retryHandlers).toEqual([onRetry])
    retryHandlers[0]()
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('keeps the loaded path and retry action when refreshing history fails', () => {
    const onRetry = vi.fn()
    const markup = renderHistory({ points, hasError: true, onRetry })

    expect(markup).toContain('d="M4,104 H82 V16 H316 V60"')
    expect(markup).toContain(
      'Could not refresh price history. Showing the last loaded prices.',
    )
    expect(markup).toContain('role="alert"')
    expect(markup).not.toContain('Could not load price history.')
    expect(retryHandlers).toEqual([onRetry])
  })

  it('keeps loaded history visible during a refresh and labels a paused stream', () => {
    const markup = renderHistory({ points, isLoading: true, paused: true })

    expect(markup).toContain('<path')
    expect(markup).toContain('Stream paused')
    expect(markup).not.toContain('Loading price history…')
  })
})
