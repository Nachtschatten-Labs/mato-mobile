import { MAX_ORDER_DURATION_SECONDS } from '../constants'

/** Keep the protocol's sub-minute durations alongside the design's curve steps. */
export const CUSTOM_DURATION_STEPS = Array.from(
  new Set([
    5,
    10,
    20,
    30,
    ...Array.from({ length: 10 }, (_, index) => (index + 1) * 60),
    15 * 60,
    20 * 60,
    30 * 60,
    ...Array.from({ length: 14 }, (_, index) => (index + 3) * 15 * 60),
    ...Array.from({ length: 20 }, (_, index) => (index + 5) * 3600),
    ...Array.from({ length: 6 }, (_, index) => (index + 2) * 86400),
    ...Array.from({ length: 7 }, (_, index) => (index + 2) * 7 * 86400),
    ...Array.from({ length: 10 }, (_, index) => (index + 3) * 30 * 86400),
    60 * 86400,
    MAX_ORDER_DURATION_SECONDS,
  ]),
).sort((a, b) => a - b)

export function nearestDuration(seconds: number) {
  return CUSTOM_DURATION_STEPS.reduce((nearest, value) =>
    Math.abs(Math.log(value / seconds)) < Math.abs(Math.log(nearest / seconds))
      ? value
      : nearest,
  )
}

export function tradeDuration(seconds: number, afterOver = false): string {
  const total = Math.ceil(seconds)
  if (total < 60) return `${total} second${total === 1 ? '' : 's'}`
  const minutes = Math.ceil(total / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours < 24)
    return remainder
      ? `${hours} h ${remainder} min`
      : `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.ceil(minutes / 1440)
  if (days >= 365) return '1 year'
  if (days % 30 === 0) return `${days / 30} month${days === 30 ? '' : 's'}`
  if (days % 7 === 0) return `${days / 7} week${days === 7 ? '' : 's'}`
  if (days === 1 && afterOver) return '24 hours'
  return `${days} day${days === 1 ? '' : 's'}`
}

export function tradeFinish(seconds: number, now = new Date()) {
  const finish = new Date(now.getTime() + seconds * 1000)
  const time = finish
    .toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .toLowerCase()
  if (finish.toDateString() === now.toDateString()) return `Finishes at ${time}`
  const date = finish.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(finish.getTime() - now.getTime() >= 365 * 86400000
      ? { year: 'numeric' as const }
      : {}),
  })
  return `Finishes ${date} at ${time}`
}

export function groupTradeAmount(value: string) {
  const [whole, fraction] = value.split('.')
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction === undefined ? '' : `.${fraction}`}`
}

export function tradePriceImpact(value: number | null) {
  if (value === null) return '—'
  return value < 0.001 ? '<0.001%' : `−${value.toFixed(3)}%`
}

export function tradeTimeLeft(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.ceil(seconds))} sec`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)
    return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
  const days = Math.floor(hours / 24)
  if (days >= 30) {
    const months = Math.floor(days / 30)
    return `${months} month${months === 1 ? '' : 's'}`
  }
  if (days >= 14) return `${Math.floor(days / 7)} weeks`
  return `${days} day${days === 1 ? '' : 's'}${hours % 24 ? ` ${hours % 24} h` : ''}`
}

const pastedAmountMessage =
  'Amount cleared. Paste the amount without thousands separators and use a dot for decimals.'

function normalizeInsertedAmount(inserted: string): string | null {
  const clean = inserted.replace(/[^\d.,]/g, '')
  if (clean === ',') return '.' // Native decimal pads may emit a comma.
  if (clean.includes(',') && clean.includes('.')) {
    const commaIsDecimal = clean.lastIndexOf(',') > clean.lastIndexOf('.')
    const separator = commaIsDecimal ? ',' : '.'
    const grouping = commaIsDecimal ? '.' : ','
    const parts = clean.split(separator)
    if (parts.length !== 2 || !/^\d*$/.test(parts[1])) return null
    const groups = parts[0].split(grouping)
    if (
      !/^\d{1,3}$/.test(groups[0]) ||
      groups.slice(1).some((group) => !/^\d{3}$/.test(group))
    )
      return null
    return `${groups.join('')}.${parts[1]}`
  }
  if (clean.includes(',')) {
    const parts = clean.split(',')
    if (parts.length > 2) {
      return /^[1-9]\d{0,2}(,\d{3})+$/.test(clean) ? parts.join('') : null
    }
    // A whole pasted "1,000" could mean one or one thousand. Clear it and ask
    // for an unambiguous value instead of silently changing the amount spent.
    if (/^[1-9]\d{0,2}$/.test(parts[0]) && parts[1].length === 3) return null
    return `${parts[0]}.${parts[1]}`
  }
  if ((clean.match(/\./g) ?? []).length > 1) {
    return /^[1-9]\d{0,2}(\.\d{3})+$/.test(clean)
      ? clean.replace(/\./g, '')
      : null
  }
  return clean
}

/** Distinguish newly entered decimal commas from commas already used for grouping. */
export function editTradeAmount(
  previousValue: string,
  entered: string,
  decimals: number,
  selection = {
    start: groupTradeAmount(previousValue).length,
    end: groupTradeAmount(previousValue).length,
  },
) {
  const previous = groupTradeAmount(previousValue)
  let editedEnd = Math.max(
    0,
    entered.length - previous.length + Math.min(selection.end, previous.length),
  )
  // Backspacing a grouping separator should delete its preceding digit too.
  if (previous.length === entered.length + 1 && previous[editedEnd] === ',') {
    entered =
      entered.slice(0, Math.max(0, editedEnd - 1)) + entered.slice(editedEnd)
    editedEnd = Math.max(0, editedEnd - 1)
  }
  const insertedStart = Math.min(selection.start, editedEnd)
  const prefix = entered.slice(0, insertedStart).replace(/,/g, '')
  const inserted = normalizeInsertedAmount(
    entered.slice(insertedStart, editedEnd),
  )
  const suffix = entered.slice(editedEnd).replace(/,/g, '')
  if (inserted === null)
    return { value: '', caret: 0, error: pastedAmountMessage }
  const normalized = `${prefix}${inserted}${suffix}`.replace(/[^\d.]/g, '')
  const [whole, ...parts] = normalized.split('.')
  if (parts.length > 1)
    return { value: '', caret: 0, error: pastedAmountMessage }
  const value = `${whole}${parts.length ? `.${parts[0].slice(0, decimals)}` : ''}`
  const before = `${prefix}${inserted}`.replace(/[^\d.]/g, '').length
  const formatted = groupTradeAmount(value)
  let caret = 0,
    characters = 0
  while (caret < formatted.length && characters < before) {
    if (formatted[caret] !== ',') characters++
    caret++
  }
  return { value, caret }
}
