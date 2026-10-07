import { MAX_ORDER_DURATION_SECONDS } from '../constants'

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR

function unitLabel(amount: number, unit: string) {
  return `${amount} ${unit}${amount === 1 ? '' : 's'}`
}

function formatDays(days: number) {
  if (days === 7) return 'week'

  const months = Math.floor(days / 30)
  const weeks = Math.floor((days % 30) / 7)
  const remainingDays = (days % 30) % 7

  return [
    months > 0 ? unitLabel(months, 'month') : null,
    weeks > 0 ? unitLabel(weeks, 'week') : null,
    remainingDays > 0 ? unitLabel(remainingDays, 'day') : null,
  ]
    .filter(Boolean)
    .join(' ')
}

/** The duration suffix in “Over the next …”, rounded upward for display. */
export function formatSmartDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 10) return 'few seconds'

  const increment =
    seconds < SECONDS_PER_MINUTE
      ? 5
      : seconds < SECONDS_PER_HOUR
        ? SECONDS_PER_MINUTE
        : seconds < SECONDS_PER_DAY
          ? 30 * SECONDS_PER_MINUTE
          : SECONDS_PER_DAY
  const roundedSeconds = Math.ceil(seconds / increment) * increment
  if (roundedSeconds === MAX_ORDER_DURATION_SECONDS) return '1 year'

  // Format after rounding so a boundary displays “1 hour”, not “60 minutes”.
  if (roundedSeconds < SECONDS_PER_MINUTE) {
    return unitLabel(roundedSeconds, 'second')
  }
  if (roundedSeconds < SECONDS_PER_HOUR) {
    return unitLabel(roundedSeconds / SECONDS_PER_MINUTE, 'minute')
  }
  if (roundedSeconds < SECONDS_PER_DAY) {
    const hours = Math.floor(roundedSeconds / SECONDS_PER_HOUR)
    const minutes = (roundedSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
    return [
      unitLabel(hours, 'hour'),
      minutes ? unitLabel(minutes, 'minute') : null,
    ]
      .filter(Boolean)
      .join(' ')
  }

  return formatDays(roundedSeconds / SECONDS_PER_DAY)
}
