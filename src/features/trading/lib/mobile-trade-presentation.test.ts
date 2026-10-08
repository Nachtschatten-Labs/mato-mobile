import { describe, expect, it } from 'vitest'
import {
  CUSTOM_DURATION_STEPS,
  editTradeAmount,
  groupTradeAmount,
  nearestDuration,
  tradeDuration,
  tradeFinish,
  tradePriceImpact,
  tradeTimeLeft,
} from './mobile-trade-presentation'

describe('mobile stream presentation', () => {
  it.each([
    [null, '—'],
    [0, '<0.001%'],
    [0.000001, '<0.001%'],
    [0.000999, '<0.001%'],
    [0.001, '−0.001%'],
    [0.012345, '−0.012%'],
    [0.012678, '−0.013%'],
    [1, '−1.000%'],
  ])(
    'shows price impact %s with three-decimal precision (%s)',
    (value, label) => {
      expect(tradePriceImpact(value)).toBe(label)
    },
  )

  it('keeps grouped inputs and fractional token precision exact', () => {
    expect(groupTradeAmount('123456789012345.00100')).toBe(
      '123,456,789,012,345.00100',
    )
    expect(editTradeAmount('999', '9999', 6)).toEqual({
      value: '9999',
      caret: 5,
    })
    expect(editTradeAmount('1000', '12,000', 6, { start: 1, end: 1 })).toEqual({
      value: '12000',
      caret: 2,
    })
    expect(editTradeAmount('0.123456', '0.1234567', 6).value).toBe('0.123456')
    expect(editTradeAmount('1', '1.', 6).value).toBe('1.')
  })
  it('accepts decimal commas from a native keyboard without changing magnitude', () => {
    expect(editTradeAmount('1', '1,', 6)).toEqual({ value: '1.', caret: 2 })
    expect(editTradeAmount('1.', '1.5', 6)).toEqual({ value: '1.5', caret: 3 })
    expect(editTradeAmount('', '1,5', 6)).toEqual({ value: '1.5', caret: 3 })
    expect(editTradeAmount('1000', '1,000,', 6)).toEqual({
      value: '1000.',
      caret: 6,
    })
    expect(editTradeAmount('1234', '1,,234', 6, { start: 1, end: 1 })).toEqual({
      value: '1.234',
      caret: 2,
    })
  })
  it('preserves precise unambiguous pasted amounts from either locale', () => {
    expect(editTradeAmount('', '1,234.567890', 6).value).toBe('1234.567890')
    expect(editTradeAmount('', '1.234,567890', 6).value).toBe('1234.567890')
    expect(editTradeAmount('', '1,234,567', 6).value).toBe('1234567')
    expect(editTradeAmount('', '0,001', 9).value).toBe('0.001')
    expect(editTradeAmount('', '1,123456789', 9).value).toBe('1.123456789')
  })
  it('clears an ambiguous paste rather than keeping a stale payable amount', () => {
    const result = editTradeAmount('25', '1,000', 6, { start: 0, end: 2 })
    expect(result.value).toBe('')
    expect(result.error).toContain('Amount cleared')
    expect(editTradeAmount('', '1,234', 6).value).toBe('')
  })
  it('allows backspace through a thousands separator', () => {
    expect(editTradeAmount('1234', '1234', 6, { start: 2, end: 2 })).toEqual({
      value: '234',
      caret: 0,
    })
  })
  it('uses actual custom durations without rounding 75 minutes to 90', () => {
    expect(tradeDuration(5)).toBe('5 seconds')
    expect(tradeDuration(75 * 60)).toBe('1 h 15 min')
    expect(tradeDuration(86400, true)).toBe('24 hours')
    expect(tradeDuration(7 * 86400)).toBe('1 week')
    expect(tradeDuration(365 * 86400)).toBe('1 year')
  })
  it('keeps every selectable duration within protocol bounds and includes native short durations', () => {
    expect(CUSTOM_DURATION_STEPS[0]).toBe(5)
    expect(CUSTOM_DURATION_STEPS.at(-1)).toBe(365 * 86400)
    expect(nearestDuration(76 * 60)).toBe(75 * 60)
    expect(nearestDuration(1000 * 86400)).toBe(365 * 86400)
  })
  it('shows a date when a stream finishes after midnight', () => {
    const now = new Date(2026, 9, 8, 23, 30)
    expect(tradeFinish(3600, now)).toBe('Finishes Oct 9 at 12:30 am')
    expect(tradeFinish(60, now)).toBe('Finishes at 11:31 pm')
  })
  it('shows time remaining instead of slots', () => {
    expect(tradeTimeLeft(200)).toBe('4 min')
    expect(tradeTimeLeft(3600 + 20 * 60)).toBe('1 h 20 min')
    expect(tradeTimeLeft(2 * 86400 + 4 * 3600)).toBe('2 days 4 h')
  })
})
