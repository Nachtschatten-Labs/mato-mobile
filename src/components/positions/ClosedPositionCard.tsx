import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import { useQuery } from '@tanstack/react-query'
import { Text } from '../ui'
import { Drawer } from '../Drawer'
import {
  FillSummary,
  SheetRow,
  StreamIdentity,
  TransactionLink,
} from './Shared'
import {
  fillComparison,
  streamAmount,
  streamDate,
  streamPrice,
  streamTime,
} from './presentation'
import { colors } from '../../theme'
import { rpc } from '../../lib/rpc'
import {
  mobileKeys,
  mobileMarket,
  useForeground,
} from '../../hooks/usePositions'
import { fetchClosedPositionMiniChart } from '../../features/trading/api/market-repository'
import { buildClosedPositionSummary } from '../../features/trading/view-models/closed-position'
import { formatAtoms } from '../../features/trading/lib/format'
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
  const baseline = useQuery({
    queryKey: [...mobileKeys, 'stream-start-price', startSlot],
    queryFn: ({ signal }) =>
      fetchClosedPositionMiniChart({
        signal,
        marketId: 1,
        startSlot: startSlot!,
        endSlot: startSlot!,
      }),
    enabled: active && startSlot !== null,
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
    return `${actual == null && slot !== closeSlot ? '≈ ' : ''}${streamDate(ms)}`
  }
  const early =
    closeSlot !== null && scheduledEnd !== null && closeSlot < scheduledEnd
  const startPrice = baseline.data?.[0]?.price ?? null
  const comparison = fillComparison(
    summary.averageFillPrice,
    startPrice,
    summary.isBuy,
  )
  const assetAmount = streamAmount(
    summary.isBuy ? summary.receivedAtoms : summary.consumedAtoms,
    9,
    3,
  )
  const quoteAmount = streamAmount(
    summary.isBuy ? summary.consumedAtoms : summary.receivedAtoms,
    6,
    2,
  )
  const status = streamDate(Date.parse(event.created_at), true)
  const duration =
    startSlot !== null && endSlot !== null
      ? `≈ ${streamTime(((endSlot - startSlot) * SLOT_DURATION_MS) / 1000, true)}`
      : 'Unavailable'
  return (
    <>
      <Pressable
        onPress={() => setExpanded(true)}
        accessibilityRole="button"
        accessibilityLabel={`Open closed ${summary.sideLabel} SOL stream`}
        accessibilityState={{ expanded }}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: colors.elevated },
        ]}
      >
        <View style={styles.main}>
          <StreamIdentity side={summary.isBuy ? 'Buy' : 'Sell'} />
          <Text style={styles.meta}>{early ? 'Closed early' : status}</Text>
        </View>
        <View style={styles.side}>
          <Text style={styles.rowAmount}>{assetAmount}</Text>
          <Text style={styles.meta}>
            @ {streamPrice(summary.averageFillPrice)} ·{' '}
            <Text style={comparison.worse && styles.risk}>
              {comparison.text}
            </Text>
          </Text>
        </View>
        <ChevronRight color={colors.faint} size={16} />
      </Pressable>
      <Drawer
        visible={expanded}
        title={`Closed ${summary.sideLabel.toLowerCase()} SOL stream`}
        header={<StreamIdentity side={summary.isBuy ? 'Buy' : 'Sell'} />}
        onClose={() => setExpanded(false)}
      >
        <View style={styles.headline}>
          <Text style={styles.muted}>
            {status}
            {early ? ' · Closed early' : ''}
          </Text>
          <Text style={styles.amount}>
            {assetAmount} SOL
            <Text style={styles.muted}>
              {' '}
              @ {streamPrice(summary.averageFillPrice)} ·{' '}
              <Text style={comparison.worse && styles.risk}>
                {comparison.text}
              </Text>
            </Text>
          </Text>
          <Text style={styles.muted}>{quoteAmount} USDC</Text>
        </View>
        <View style={styles.group}>
          <SheetRow
            label="Duration"
            value={duration}
            sub={early ? 'Closed early' : undefined}
          />
          <SheetRow
            label="Started"
            value={displayTime(startSlot, time.data?.start)}
          />
          <SheetRow
            label="Fee paid"
            value={`${formatAtoms(summary.feeAtoms, summary.swappedDecimals, summary.swappedDecimals)} ${summary.swappedToken}`}
          />
        </View>
        <FillSummary
          startPrice={startPrice}
          average={summary.averageFillPrice}
          progress={100}
        />
        <View style={styles.group}>
          <SheetRow
            label="Received after fee"
            value={`${formatAtoms(summary.receivedAtoms, summary.swappedDecimals)} ${summary.swappedToken}`}
          />
          <SheetRow
            label="Refunded input"
            value={`${formatAtoms(summary.remainingAtoms, summary.depositDecimals)} ${summary.depositToken}`}
          />
          <SheetRow
            label="Finished"
            value={displayTime(endSlot, time.data?.end)}
          />
        </View>
        <TransactionLink signature={event.signature} onError={onError} />
      </Drawer>
    </>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 80,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  main: { flex: 1, gap: 5 },
  side: { alignItems: 'flex-end', gap: 5 },
  rowAmount: { fontSize: 15, fontVariant: ['tabular-nums'] },
  meta: { fontSize: 12, lineHeight: 18, color: colors.muted },
  headline: { gap: 4, marginTop: -8 },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  amount: { fontSize: 15, lineHeight: 23, fontVariant: ['tabular-nums'] },
  risk: { color: colors.negative },
  group: { borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 6 },
})
