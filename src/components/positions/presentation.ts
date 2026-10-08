/** Display-only formatting. All settlement calculations remain in token atoms. */
export function streamAmount(
  atoms: bigint | null,
  decimals: number,
  places: number,
) {
  if (atoms === null) return '—'
  const scale = 10n ** BigInt(decimals)
  const whole = atoms / scale
  const fraction = (atoms % scale)
    .toString()
    .padStart(decimals, '0')
    .slice(0, places)
    .padEnd(places, '0')
  if (atoms > 0n && whole === 0n && /^0+$/.test(fraction))
    return `<0.${'0'.repeat(places - 1)}1`
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${places ? `.${fraction}` : ''}`
}

export function streamTime(seconds: number, full = false) {
  if (!Number.isFinite(seconds)) return '—'
  const n = Math.max(0, Math.ceil(seconds))
  if (n < 60) return `${n} ${full ? (n === 1 ? 'second' : 'seconds') : 'sec'}`
  if (n < 3600) {
    const minutes = Math.ceil(n / 60)
    return `${minutes} ${full ? (minutes === 1 ? 'minute' : 'minutes') : 'min'}`
  }
  const hours = Math.floor(n / 3600)
  const minutes = Math.floor((n % 3600) / 60)
  if (hours < 24)
    return minutes
      ? `${hours} h ${minutes} min`
      : `${hours} ${full ? (hours === 1 ? 'hour' : 'hours') : 'h'}`
  const days = Math.floor(hours / 24)
  if (days >= 365) {
    const years = Math.floor(days / 365)
    return `${years} ${years === 1 ? 'year' : 'years'}`
  }
  if (days >= 60) return `${Math.floor(days / 30)} months`
  if (days >= 14) return `${Math.floor(days / 7)} weeks`
  return `${days} ${days === 1 ? 'day' : 'days'}${hours % 24 ? ` ${hours % 24} h` : ''}`
}

export function streamDate(ms: number, compact = false) {
  const date = new Date(ms)
  if (!Number.isFinite(date.getTime())) return 'Unavailable'
  const day = compact
    ? `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = date
    .toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .toLowerCase()
  return `${day}, ${time}`
}

export function fillComparison(
  average: number | null,
  start: number | null,
  buy: boolean,
) {
  if (
    average === null ||
    start === null ||
    !Number.isFinite(average) ||
    !Number.isFinite(start) ||
    start <= 0
  )
    return { text: '—', worse: false }
  // Show the price move versus start; whether it is adverse depends on side.
  const percent = ((average - start) / start) * 100
  return {
    text: `${percent < 0 ? '−' : '+'}${Math.abs(percent).toFixed(2)}%`,
    worse: buy ? percent >= 1 : percent <= -1,
  }
}

export function streamPrice(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? '—'
    : value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
}
