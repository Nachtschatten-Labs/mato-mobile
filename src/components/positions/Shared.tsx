import type { ReactNode } from 'react'
import { Linking, Pressable, StyleSheet, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { Text } from '../ui'
import { TokenLogo } from '../TokenLogo'
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

export function StreamIdentity({ side }: { side: 'Buy' | 'Sell' }) {
  return (
    <View style={styles.identity}>
      <TokenLogo symbol="SOL" size={20} />
      <Text style={styles.asset}>SOL</Text>
      <Text style={styles.side}>{side}</Text>
    </View>
  )
}

export function ProgressRing({ progress }: { progress: number | null }) {
  const value = Math.min(100, Math.max(0, progress ?? 0))
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Stream filled"
      accessibilityValue={
        progress === null
          ? { text: 'Updating fill' }
          : { min: 0, max: 100, now: value }
      }
    >
      <Svg width={28} height={28} viewBox="0 0 24 24">
        <Circle
          cx={12}
          cy={12}
          r={10}
          stroke={colors.track}
          strokeWidth={3}
          fill="none"
        />
        <Circle
          cx={12}
          cy={12}
          r={10}
          stroke={colors.chart}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(value / 100) * 62.83} 62.83`}
          transform="rotate(-90 12 12)"
        />
      </Svg>
    </View>
  )
}

export function SheetRow({
  label,
  value,
  sub,
  children,
}: {
  label: string
  value: string
  sub?: string
  children?: ReactNode
}) {
  return (
    <View style={styles.sheetRow}>
      <Text style={styles.sheetLabel}>{label}</Text>
      <View style={styles.sheetValue}>
        <Text selectable style={styles.sheetAmount}>
          {value}
        </Text>
        {sub && <Text style={styles.sheetSub}>{sub}</Text>}
        {children}
      </View>
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
    <Pressable
      accessibilityRole="link"
      onPress={() => {
        void Linking.openURL(
          formatExplorerTransactionUrl(signature, config.rpcUrl),
        ).catch(() => onError('Could not open Solana Explorer.'))
      }}
      style={styles.transaction}
    >
      <Text style={styles.transactionText}>View tx</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  notice: {
    padding: 14,
    borderRadius: 8,
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    marginVertical: 8,
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
  identity: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  asset: { fontSize: 16 },
  side: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.secondary,
    backgroundColor: colors.track,
    borderRadius: 3,
    paddingHorizontal: 6,
  },
  sheetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    paddingVertical: 10,
  },
  sheetLabel: {
    color: colors.muted,
    fontSize: 15,
    paddingTop: 1,
    flexShrink: 1,
  },
  sheetValue: { alignItems: 'flex-end', gap: 4, flexShrink: 1 },
  sheetAmount: {
    fontSize: 15,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  sheetSub: { fontSize: 14, color: colors.muted, textAlign: 'right' },
  transaction: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  transactionText: {
    color: colors.muted,
    fontSize: 14,
    textDecorationLine: 'underline',
  },
})
