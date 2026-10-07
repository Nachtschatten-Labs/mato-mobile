import { Linking, StyleSheet, View } from 'react-native'
import Svg, { Polyline } from 'react-native-svg'
import { Text, Button } from '../ui'
import { colors } from '../../theme'
import { config } from '../../config'
import { formatExplorerTransactionUrl } from '../../features/trading/lib/format'

export function Notice({
  children,
  error = false,
}: {
  children: string
  error?: boolean
}) {
  return (
    <View
      accessibilityRole={error ? 'alert' : undefined}
      style={[styles.notice, error && styles.error]}
    >
      <Text style={[styles.message, error && { color: colors.negative }]}>
        {children}
      </Text>
    </View>
  )
}

export function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.value}>
        {value}
      </Text>
    </View>
  )
}

export function TransactionLink({
  signature,
  onError,
}: {
  signature: string
  onError: (message: string) => void
}) {
  return (
    <Button
      title="View transaction ↗"
      variant="ghost"
      onPress={() => {
        void Linking.openURL(
          formatExplorerTransactionUrl(signature, config.rpcUrl),
        ).catch(() => onError('Could not open Solana Explorer.'))
      }}
    />
  )
}

export function Sparkline({
  points,
}: {
  points: readonly { slot: number; price: number }[]
}) {
  if (points.length < 2)
    return <Text style={styles.label}>Price history unavailable.</Text>
  const low = Math.min(...points.map((point) => point.price))
  const high = Math.max(...points.map((point) => point.price))
  const firstSlot = points[0].slot
  const slotSpan = Math.max(1, points[points.length - 1].slot - firstSlot)
  const span = high - low || Math.max(high * 0.01, 0.00001)
  const path = points
    .map(
      (point) =>
        `${8 + ((point.slot - firstSlot) / slotSpan) * 304},${82 - ((point.price - low) / span) * 64}`,
    )
    .join(' ')
  return (
    <View
      accessible
      accessibilityLabel={`Historical price chart. Low ${low.toFixed(4)}, high ${high.toFixed(4)} USDC per SOL.`}
      style={{ height: 96, width: '100%' }}
    >
      <Svg width="100%" height="96" viewBox="0 0 320 96">
        <Polyline
          points={path}
          fill="none"
          stroke={colors.accent}
          strokeWidth="2"
        />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  notice: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  error: { borderColor: colors.negative },
  message: { fontSize: 13, lineHeight: 20, color: colors.muted },
  detail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    paddingVertical: 5,
  },
  label: { color: colors.muted, fontSize: 12, lineHeight: 19, flexShrink: 1 },
  value: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'right',
    flexShrink: 1,
    fontVariant: ['tabular-nums'],
  },
})
