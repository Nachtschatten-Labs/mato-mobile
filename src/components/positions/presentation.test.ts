import { describe, expect, it } from 'vitest'
import { fillComparison, streamAmount, streamTime } from './presentation'

describe('stream amount presentation', () => {
  it('keeps large token values exact while grouping the displayed amount', () => {
    expect(streamAmount(9007199254740993123456789n, 9, 3)).toBe(
      '9,007,199,254,740,993.123',
    )
    expect(streamAmount(1825000000n, 6, 2)).toBe('1,825.00')
  })
  it('distinguishes unknown and tiny balances from zero', () => {
    expect(streamAmount(null, 9, 3)).toBe('—')
    expect(streamAmount(0n, 9, 3)).toBe('0.000')
    expect(streamAmount(1n, 9, 3)).toBe('<0.001')
  })
})

describe('fill comparison', () => {
  it('marks a worse price with the right sign for both trade directions', () => {
    expect(fillComparison(101, 100, true)).toEqual({
      text: '+1.00%',
      worse: true,
    })
    expect(fillComparison(99, 100, false)).toEqual({
      text: '−1.00%',
      worse: true,
    })
    expect(fillComparison(99, 100, true)).toEqual({
      text: '−1.00%',
      worse: false,
    })
    expect(fillComparison(100.5, 100, true)).toEqual({
      text: '+0.50%',
      worse: false,
    })
  })
  it('does not fabricate a comparison before the first fill or without a start price', () => {
    expect(fillComparison(null, 100, true).text).toBe('—')
    expect(fillComparison(100, null, false).text).toBe('—')
  })
})

it('formats running and receipt durations with the design vocabulary', () => {
  expect(streamTime(37 * 60)).toBe('37 min')
  expect(streamTime(3600, true)).toBe('1 hour')
  expect(streamTime(4500, true)).toBe('1 h 15 min')
  expect(streamTime(52 * 3600)).toBe('2 days 4 h')
  expect(streamTime(14 * 86400)).toBe('2 weeks')
  expect(streamTime(90 * 86400)).toBe('3 months')
})
