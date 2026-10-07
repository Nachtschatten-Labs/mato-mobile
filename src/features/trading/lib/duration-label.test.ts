import { describe, expect, it } from 'vitest'
import { formatSmartDuration } from './duration-label'

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatSmartDuration', () => {
  it.each([
    [0.4, 'few seconds'],
    [9.999, 'few seconds'],
    [10, '10 seconds'],
    [10.001, '15 seconds'],
    [12.999, '15 seconds'],
    [13, '15 seconds'],
    [15, '15 seconds'],
    [15.001, '20 seconds'],
    [20, '20 seconds'],
    [54.9, '55 seconds'],
    [55, '55 seconds'],
    [55.001, '1 minute'],
    [59, '1 minute'],
    [MINUTE, '1 minute'],
    [MINUTE + 0.001, '2 minutes'],
    [2 * MINUTE, '2 minutes'],
    [58 * MINUTE + 1, '59 minutes'],
    [59 * MINUTE, '59 minutes'],
    [59 * MINUTE + 1, '1 hour'],
    [HOUR, '1 hour'],
    [HOUR + 0.001, '1 hour 30 minutes'],
    [HOUR + 30 * MINUTE, '1 hour 30 minutes'],
    [HOUR + 30 * MINUTE + 0.001, '2 hours'],
    [2 * HOUR, '2 hours'],
    [2 * HOUR + 1, '2 hours 30 minutes'],
    [23 * HOUR + 30 * MINUTE, '23 hours 30 minutes'],
    [23 * HOUR + 30 * MINUTE + 0.001, '1 day'],
    [23 * HOUR + 59 * MINUTE, '1 day'],
    [DAY, '1 day'],
    [DAY + 0.001, '2 days'],
    [2 * DAY, '2 days'],
  ])('formats %s seconds as %s', (seconds, expected) => {
    expect(formatSmartDuration(seconds)).toBe(expected)
  })

  it.each([
    [6, '6 days'],
    [6.1, 'week'],
    [7, 'week'],
    [7.1, '1 week 1 day'],
    [9, '1 week 2 days'],
    [13.1, '2 weeks'],
    [14, '2 weeks'],
    [15, '2 weeks 1 day'],
    [21, '3 weeks'],
    [28, '4 weeks'],
    [28.1, '4 weeks 1 day'],
    [29, '4 weeks 1 day'],
    [29.1, '1 month'],
    [30, '1 month'],
    [30.1, '1 month 1 day'],
    [37, '1 month 1 week'],
    [39, '1 month 1 week 2 days'],
    [39.1, '1 month 1 week 3 days'],
    [59, '1 month 4 weeks 1 day'],
    [59.1, '2 months'],
    [60, '2 months'],
    [68, '2 months 1 week 1 day'],
    [90, '3 months'],
    [364.1, '1 year'],
    [365, '1 year'],
  ])('formats %s days as %s', (days, expected) => {
    expect(formatSmartDuration(days * DAY)).toBe(expected)
  })

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('uses an unavailable label for invalid duration %s', (seconds) => {
    expect(formatSmartDuration(seconds)).toBe('—')
  })
})
