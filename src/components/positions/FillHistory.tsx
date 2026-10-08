import { Pressable, StyleSheet, View } from 'react-native'
import Svg, { Circle, Line, Path } from 'react-native-svg'
import { Text } from '../ui'
import { colors } from '../../theme'
import type { PositionChartPoint } from '../../features/trading/lib/position-chart'
import { streamPrice } from './presentation'

export function FillHistory({
  points,
  startPrice,
  average,
  paused = false,
  marketPrice,
  isLoading,
  hasError,
  onRetry,
}: {
  points: PositionChartPoint[]
  startPrice: number | null
  average: number | null
  paused?: boolean
  marketPrice?: number | null
  isLoading: boolean
  hasError: boolean
  onRetry: () => void
}) {
  const first = points[0]
  const last = points.at(-1)
  const prices = [
    ...points.map((point) => point.price),
    ...(startPrice === null ? [] : [startPrice]),
    ...(average === null ? [] : [average]),
  ]
  const low = prices.length ? Math.min(...prices) : 0
  const high = prices.length ? Math.max(...prices) : 1
  const span = Math.max(high - low, high * 0.0005, 0.00001)
  const y = (price: number) => 60 - ((price - (high + low) / 2) / span) * 88
  const x = (slot: number) =>
    4 +
    ((slot - (first?.slot ?? 0)) /
      Math.max(1, (last?.slot ?? 0) - (first?.slot ?? 0))) *
      312
  // Flows set the price until the next update; do not interpolate between fills.
  const path = points
    .map((point, index) =>
      index === 0
        ? `M${x(point.slot)},${y(point.price)}`
        : `H${x(point.slot)} V${y(point.price)}`,
    )
    .join(' ')
  const emptyMessage = isLoading
    ? 'Loading price history…'
    : hasError
      ? 'Could not load price history.'
      : 'No price history is available for this stream yet.'

  return (
    <View style={styles.chart}>
      <View style={styles.header}>
        <Text style={styles.label}>
          SOL/USDC{' '}
          <Text style={styles.value}>
            {streamPrice(marketPrice ?? last?.price ?? null)}
          </Text>
          {paused ? ' · Stream paused' : ''}
        </Text>
        <View style={styles.keys}>
          <Text style={styles.label}>
            — Started at{' '}
            <Text style={styles.value}>{streamPrice(startPrice)}</Text>
          </Text>
          <Text style={styles.label}>
            ┄ Avg. fill <Text style={styles.value}>{streamPrice(average)}</Text>
          </Text>
        </View>
      </View>
      <View style={styles.plot}>
        {first && last ? (
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`SOL/USDC market price history during this stream. Started at ${streamPrice(startPrice)}. Latest recorded price ${streamPrice(last.price)}. Average fill ${streamPrice(average)} USDC per SOL.`}
          >
            <Svg width="100%" height={120} viewBox="0 0 320 120">
              {startPrice !== null && (
                <Line
                  x1={4}
                  x2={316}
                  y1={y(startPrice)}
                  y2={y(startPrice)}
                  stroke={colors.grip}
                  strokeWidth={1}
                />
              )}
              {average !== null && (
                <Line
                  x1={4}
                  x2={316}
                  y1={y(average)}
                  y2={y(average)}
                  stroke={colors.muted}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
              )}
              <Path
                d={path}
                stroke={colors.chart}
                strokeWidth={2}
                fill="none"
                strokeLinejoin="round"
              />
              <Circle
                cx={x(last.slot)}
                cy={y(last.price)}
                r={4}
                stroke={colors.chart}
                strokeWidth={1.5}
                fill={paused ? colors.background : colors.chart}
              />
            </Svg>
          </View>
        ) : (
          <View style={styles.empty} accessibilityLiveRegion="polite">
            <Text style={styles.message}>{emptyMessage}</Text>
          </View>
        )}
        {hasError && points.length > 0 && (
          <Text accessibilityRole="alert" style={styles.message}>
            Could not refresh price history. Showing the last loaded prices.
          </Text>
        )}
        {hasError && (
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Retry price history</Text>
          </Pressable>
        )}
        {points.length > 0 && (
          <Text style={styles.note}>
            <Text style={{ color: colors.chart }}>—</Text> Market price during
            this stream · average fill shown separately
          </Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  chart: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  header: {
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  keys: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  label: { color: colors.muted, fontSize: 12, lineHeight: 19, flexShrink: 1 },
  value: { fontSize: 12, color: colors.text, fontVariant: ['tabular-nums'] },
  plot: { paddingHorizontal: 12, paddingBottom: 10 },
  empty: { minHeight: 120, justifyContent: 'center', alignItems: 'center' },
  message: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
  },
  note: { color: colors.faint, fontSize: 12, lineHeight: 18 },
  retry: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  retryText: {
    color: colors.text,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
})
