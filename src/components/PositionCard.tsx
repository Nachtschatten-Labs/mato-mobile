import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Text, Button } from './ui'
import { Detail, Sparkline } from './positions/Shared'
import { colors } from '../theme'
import { rpc } from '../lib/rpc'
import { mobileKeys, mobileMarket, useForeground } from '../hooks/usePositions'
import { fetchEndSlotBookkeepingSnapshot } from '../features/trading/api/twob-client'
import { fetchClosedPositionMiniChart } from '../features/trading/api/market-repository'
import { getActivePositionMetrics } from '../features/trading/lib/position-progress'
import {
  formatAtoms,
  formatUiAmount,
  shortenAddress,
} from '../features/trading/lib/format'
import {
  getTradePositionEndSlot,
  isBuyTradePosition,
  isPausedTradePosition,
} from '../features/trading/lib/trade-position'
import { formatStreamDuration } from '../features/trading/lib/position-chart'
import { SLOT_DURATION_SECONDS } from '../features/trading/constants'
import type {
  StreamingMarketState,
  TradePositionRecord,
} from '../features/trading/domain/models'

export type PositionAction = 'pause' | 'resume' | 'withdraw' | 'close'

export default function PositionCard({
  position,
  market,
  disabled,
  pending,
  onAction,
}: {
  position: TradePositionRecord
  market: StreamingMarketState | null
  disabled: boolean
  pending: boolean
  onAction: (position: TradePositionRecord, action: PositionAction) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const active = useForeground()
  const endSlot = Number(getTradePositionEndSlot(position.data))
  const ended =
    !isPausedTradePosition(position.data) &&
    market !== null &&
    market.currentSlot >= endSlot
  const snapshot = useQuery({
    queryKey: [
      ...mobileKeys,
      'end-snapshot',
      position.address,
      endSlot,
      isBuyTradePosition(position.data),
    ],
    queryFn: () =>
      fetchEndSlotBookkeepingSnapshot({
        rpcClient: rpc,
        marketAddress: mobileMarket.address,
        bookkeepingLastUpdateSlot: market?.bookkeepingLastUpdateSlot ?? null,
        endSlot,
        endSlotInterval: market?.endSlotInterval ?? null,
        isBuy: isBuyTradePosition(position.data),
      }),
    enabled: active && ended,
    staleTime: Infinity,
    refetchInterval: (query) => (query.state.data ? false : 5_000),
    retry: 1,
  })
  const metrics = getActivePositionMetrics({
    market: mobileMarket.address,
    position: position.data,
    baseTicker: mobileMarket.baseSymbol,
    quoteTicker: mobileMarket.quoteSymbol,
    baseDecimals: mobileMarket.baseDecimals,
    quoteDecimals: mobileMarket.quoteDecimals,
    streamingState: market,
    endSlotBookkeepingSnapshot: snapshot.data ?? null,
  })
  const chart = useQuery({
    queryKey: [
      ...mobileKeys,
      'position-chart',
      position.address,
      Number(position.data.startSlot),
      endSlot,
      ended,
    ],
    queryFn: ({ signal }) =>
      fetchClosedPositionMiniChart({
        signal,
        marketId: 1,
        startSlot: Number(position.data.startSlot),
        endSlot: ended ? endSlot : (market?.currentSlot ?? endSlot),
      }),
    enabled: active && expanded && market !== null,
    staleTime: 30_000,
    // Keep one live cache entry rather than a new entry for every market slot.
    // Expanded charts can catch up with a delayed indexer after execution ends.
    refetchInterval: active && expanded ? 30_000 : false,
    retry: 1,
  })
  const remainingSlots = metrics.isPaused
    ? position.data.remainingSlots
    : Math.max(0, endSlot - (market?.currentSlot ?? endSlot))
  const state = metrics.isPaused ? 'Paused' : ended ? 'Ended' : 'Streaming'
  const unavailable = (value: bigint | null, decimals: number) =>
    value === null ? 'Updating fill…' : formatAtoms(value, decimals)
  const progress = Math.min(100, Math.max(0, metrics.progressPercent ?? 0))
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${metrics.sideLabel} SOL position`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={styles.header}
      >
        <View style={styles.token}>
          <Text style={{ fontSize: 20 }}>◎</Text>
        </View>
        <View style={styles.heading}>
          <Text style={styles.title}>{metrics.sideLabel} SOL</Text>
          <Text style={styles.muted}>{metrics.flowLabel}</Text>
        </View>
        <View style={styles.status}>
          <Text
            style={{
              color: metrics.isPaused ? colors.accent : colors.positive,
              fontSize: 11,
            }}
          >
            {state}
          </Text>
        </View>
        <Text style={styles.muted}>{expanded ? '−' : '+'}</Text>
      </Pressable>
      <View style={styles.amounts}>
        <Text style={styles.label}>Spent / deposited</Text>
        <Text style={styles.amount}>
          {unavailable(metrics.consumedAtoms, metrics.depositedDecimals)}{' '}
          <Text style={styles.muted}>
            / {formatAtoms(metrics.amountAtoms, metrics.depositedDecimals)}{' '}
            {metrics.depositedToken}
          </Text>
        </Text>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={
            metrics.progressPercent === null
              ? { text: 'Updating fill' }
              : { min: 0, max: 100, now: progress }
          }
          style={styles.track}
        >
          <View style={[styles.fill, { width: `${progress}%` }]} />
        </View>
        <View style={styles.line}>
          <Text style={styles.muted}>
            {metrics.progressPercent === null
              ? 'Updating fill…'
              : `${progress.toFixed(1)}% filled`}
          </Text>
          <Text style={styles.muted}>
            {metrics.isPaused ? 'Time remaining: ' : ''}
            {ended
              ? 'Ready to settle'
              : market
                ? formatStreamDuration(remainingSlots * SLOT_DURATION_SECONDS)
                : 'Time unavailable'}
          </Text>
        </View>
      </View>
      <Detail
        label="Received before fees"
        value={`${unavailable(metrics.swappedAtoms, metrics.swappedDecimals)} ${metrics.swappedToken}`}
      />
      <Detail
        label="Average fill"
        value={
          metrics.averagePrice === null
            ? '—'
            : `${formatUiAmount(metrics.averagePrice, 6)} USDC/SOL`
        }
      />
      {expanded && (
        <View style={styles.expanded}>
          <Detail
            label="Refundable input"
            value={`${unavailable(metrics.remainingAtoms, metrics.depositedDecimals)} ${metrics.depositedToken}`}
          />
          <Detail
            label="Available to withdraw before fees"
            value={`${unavailable(metrics.claimableSwappedAtoms, metrics.swappedDecimals)} ${metrics.swappedToken}`}
          />
          <Detail
            label="Position"
            value={shortenAddress(position.address, 6, 6)}
          />
          {chart.isPending ? (
            <Text style={styles.muted}>Loading price history…</Text>
          ) : (
            <Sparkline points={chart.data ?? []} />
          )}
          <Button
            title="Withdraw swapped"
            variant="secondary"
            disabled={
              disabled || pending || (metrics.claimableSwappedAtoms ?? 0n) <= 0n
            }
            onPress={() => onAction(position, 'withdraw')}
          />
        </View>
      )}
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button
            title={metrics.isPaused ? 'Resume' : 'Pause'}
            variant="secondary"
            disabled={
              disabled ||
              pending ||
              (!metrics.isPaused && ended) ||
              (metrics.isPaused && Boolean(market?.isPaused))
            }
            onPress={() =>
              onAction(position, metrics.isPaused ? 'resume' : 'pause')
            }
          />
        </View>
        <View style={styles.action}>
          <Button
            title={pending ? 'Confirming…' : 'Close stream'}
            variant="ghost"
            disabled={disabled || pending}
            onPress={() => onAction(position, 'close')}
          />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
  },
  token: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: { flex: 1, gap: 4 },
  title: { fontSize: 16, fontWeight: '500' },
  status: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: colors.elevated,
  },
  muted: { fontSize: 11, color: colors.muted, lineHeight: 18 },
  label: { fontSize: 11, color: colors.muted },
  amounts: { paddingTop: 14, paddingBottom: 8, gap: 9 },
  amount: { fontSize: 18, fontVariant: ['tabular-nums'] },
  track: {
    height: 5,
    backgroundColor: colors.elevated,
    borderRadius: 5,
    overflow: 'hidden',
  },
  fill: { height: 5, borderRadius: 5, backgroundColor: colors.accent },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  expanded: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
    marginTop: 8,
    gap: 5,
  },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  action: { flex: 1 },
})
