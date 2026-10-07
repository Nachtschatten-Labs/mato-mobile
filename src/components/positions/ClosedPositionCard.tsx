import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Text } from '../ui'
import { Detail, Sparkline, TransactionLink } from './Shared'
import { colors } from '../../theme'
import { rpc } from '../../lib/rpc'
import {
  mobileKeys,
  mobileMarket,
  useForeground,
} from '../../hooks/usePositions'
import { fetchClosedPositionMiniChart } from '../../features/trading/api/market-repository'
import { buildClosedPositionSummary } from '../../features/trading/view-models/closed-position'
import { formatAtoms, formatUiAmount } from '../../features/trading/lib/format'
import { SLOT_DURATION_MS } from '../../features/trading/constants'
import type { ClosePositionEvent } from '../../integrations/read-api'

export default function ClosedPositionCard({
  event,
  onError,
}: {
  event: ClosePositionEvent
  onError: (message: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const active = useForeground()
  const summary = buildClosedPositionSummary({
    event,
    baseTicker: mobileMarket.baseSymbol,
    quoteTicker: mobileMarket.quoteSymbol,
    baseDecimals: mobileMarket.baseDecimals,
    quoteDecimals: mobileMarket.quoteDecimals,
  })
  const validSlot = (slot: number | null) =>
    slot !== null && Number.isSafeInteger(slot) && slot >= 0 ? slot : null
  const closeSlot = validSlot(event.slot)
  const scheduledEnd = validSlot(event.end_slot)
  const endSlot =
    closeSlot !== null && scheduledEnd !== null
      ? Math.min(closeSlot, scheduledEnd)
      : null
  const reportedStart = validSlot(event.start_slot)
  const startSlot =
    reportedStart !== null &&
    closeSlot !== null &&
    reportedStart <= closeSlot &&
    (endSlot === null || reportedStart <= endSlot)
      ? reportedStart
      : null
  const time = useQuery({
    queryKey: [
      ...mobileKeys,
      'closed-times',
      event.signature,
      startSlot,
      endSlot,
    ],
    queryFn: async ({ signal }) => {
      const read = async (slot: number | null) => {
        if (slot === null) return null
        try {
          const result = await rpc
            .getBlockTime(BigInt(slot))
            .send({ abortSignal: signal })
          return result === null ? null : Number(result) * 1000
        } catch (error) {
          if (signal.aborted) throw error
          return null
        }
      }
      const [start, end] = await Promise.all([read(startSlot), read(endSlot)])
      return { start, end }
    },
    enabled: active && expanded,
    staleTime: 60_000,
    retry: false,
  })
  const history = useQuery({
    queryKey: [
      ...mobileKeys,
      'closed-chart',
      event.signature,
      startSlot,
      endSlot,
    ],
    queryFn: ({ signal }) =>
      fetchClosedPositionMiniChart({
        signal,
        marketId: 1,
        startSlot: startSlot!,
        endSlot: endSlot!,
      }),
    enabled: active && expanded && startSlot !== null && endSlot !== null,
    staleTime: 5 * 60_000,
    retry: 1,
  })
  const displayTime = (
    slot: number | null,
    actual: number | null | undefined,
  ) => {
    if (slot === null) return 'Unavailable'
    if (time.isFetching && actual === undefined) return 'Loading…'
    const closeTime = Date.parse(event.created_at)
    const estimate =
      Number.isFinite(closeTime) && closeSlot !== null
        ? closeTime - (closeSlot - slot) * SLOT_DURATION_MS
        : null
    const ms = actual ?? estimate
    if (
      ms === null ||
      !Number.isFinite(ms) ||
      !Number.isFinite(new Date(ms).getTime())
    )
      return 'Unavailable'
    return `${actual == null && slot !== closeSlot ? '≈ ' : ''}${new Date(ms).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
  }
  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => setExpanded(!expanded)}
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} closed ${summary.sideLabel} SOL position`}
        accessibilityState={{ expanded }}
        style={styles.header}
      >
        <View>
          <Text style={styles.title}>{summary.sideLabel} SOL</Text>
          <Text style={styles.muted}>Closed stream</Text>
        </View>
        <Text style={styles.muted}>{expanded ? '−' : '+'}</Text>
      </Pressable>
      <Text style={styles.amount}>
        {formatAtoms(summary.consumedAtoms, summary.depositDecimals)}{' '}
        {summary.depositToken} <Text style={styles.muted}>→</Text>{' '}
        {formatAtoms(summary.receivedAtoms, summary.swappedDecimals)}{' '}
        {summary.swappedToken}
      </Text>
      <Detail
        label="Average fill before fees"
        value={
          summary.averageFillPrice === null
            ? '—'
            : `${formatUiAmount(summary.averageFillPrice, 6)} USDC/SOL`
        }
      />
      {expanded && (
        <View style={styles.expanded}>
          <Detail
            label="Output fee"
            value={`${formatAtoms(summary.feeAtoms, summary.swappedDecimals, summary.swappedDecimals)} ${summary.swappedToken}`}
          />
          <Detail
            label="Refunded input"
            value={`${formatAtoms(summary.remainingAtoms, summary.depositDecimals)} ${summary.depositToken}`}
          />
          <Detail
            label="Trading started"
            value={displayTime(startSlot, time.data?.start)}
          />
          <Detail
            label="Trading ended"
            value={displayTime(endSlot, time.data?.end)}
          />
          {history.isFetching ? (
            <Text style={styles.muted}>Loading price history…</Text>
          ) : (
            <Sparkline points={history.data ?? []} />
          )}
          <TransactionLink signature={event.signature} onError={onError} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 16, fontWeight: '500', marginBottom: 5 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  amount: { fontSize: 16, lineHeight: 24, fontVariant: ['tabular-nums'] },
  expanded: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 5,
  },
})
