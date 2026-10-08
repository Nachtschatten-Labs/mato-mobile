import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { ChevronRight, Download, Pause, Play, X } from 'lucide-react-native'
import { useQuery } from '@tanstack/react-query'
import { Text, Button } from './ui'
import { Drawer } from './Drawer'
import {
  Detail,
  FillSummary,
  ProgressRing,
  SheetRow,
  StreamIdentity,
  TransactionLink,
} from './positions/Shared'
import {
  fillComparison,
  streamAmount,
  streamPrice,
  streamTime,
} from './positions/presentation'
import { colors } from '../theme'
import { rpc } from '../lib/rpc'
import { mobileKeys, mobileMarket, useForeground } from '../hooks/usePositions'
import { fetchEndSlotBookkeepingSnapshot } from '../features/trading/api/twob-client'
import { fetchClosedPositionMiniChart } from '../features/trading/api/market-repository'
import { getActivePositionMetrics } from '../features/trading/lib/position-progress'
import { tradeFeeAtoms } from '../features/trading/lib/close-position-preview'
import { formatAtoms, shortenAddress } from '../features/trading/lib/format'
import {
  getTradePositionEndSlot,
  isBuyTradePosition,
  isPausedTradePosition,
} from '../features/trading/lib/trade-position'
import { SLOT_DURATION_SECONDS } from '../features/trading/constants'
import type {
  StreamingMarketState,
  TradePositionRecord,
} from '../features/trading/domain/models'

export type PositionAction = 'pause' | 'resume' | 'withdraw' | 'close'
export type PendingPositionAction = {
  address: string
  action: PositionAction
} | null

export default function PositionCard({
  position,
  market,
  disabled,
  pending,
  onAction,
  signature,
  onError,
}: {
  position: TradePositionRecord
  market: StreamingMarketState | null
  disabled: boolean
  pending: PendingPositionAction
  onAction: (position: TradePositionRecord, action: PositionAction) => void
  signature?: string
  onError: (message: string) => void
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
  const startSlot = Number(position.data.startSlot)
  const startPriceQuery = useQuery({
    queryKey: [...mobileKeys, 'stream-start-price', startSlot],
    queryFn: ({ signal }) =>
      fetchClosedPositionMiniChart({
        signal,
        marketId: 1,
        startSlot,
        endSlot: startSlot,
      }),
    enabled: active,
    staleTime: 5 * 60_000,
    retry: 1,
  })
  const startPrice = startPriceQuery.data?.[0]?.price ?? null
  const buy = isBuyTradePosition(position.data)
  const remainingSlots = metrics.isPaused
    ? position.data.remainingSlots
    : Math.max(0, endSlot - (market?.currentSlot ?? endSlot))
  const timeLeft = streamTime(remainingSlots * SLOT_DURATION_SECONDS)
  const status = metrics.isPaused
    ? 'Paused'
    : ended
      ? 'Completed · Ready to settle'
      : market
        ? `${timeLeft} left`
        : 'Updating stream…'
  const totalSlots =
    position.data.flow > 0n
      ? Number((position.data.amount * 1_000_000_000n) / position.data.flow)
      : null
  const comparison = fillComparison(metrics.averagePrice, startPrice, buy)
  const assetAmount = streamAmount(
    buy ? metrics.swappedAtoms : metrics.consumedAtoms,
    9,
    3,
  )
  const outputPlaces = buy ? 3 : 2
  const available =
    metrics.claimableSwappedAtoms === null
      ? null
      : metrics.claimableSwappedAtoms -
        tradeFeeAtoms(
          metrics.claimableSwappedAtoms,
          position.data.feeBpsAtSubmission,
        )
  const ownPending =
    pending?.address === position.address ? pending.action : null
  const busyCopy = 'Approve and confirm in your wallet'
  const marketPrice =
    market && market.marketBaseFlow > 0n
      ? (Number(market.marketQuoteFlow) / Number(market.marketBaseFlow)) * 1000
      : null
  const toggle = metrics.isPaused ? 'resume' : 'pause'
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${metrics.sideLabel} SOL stream, ${status}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(true)}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: colors.elevated },
        ]}
      >
        <ProgressRing progress={metrics.progressPercent} />
        <View style={styles.main}>
          <StreamIdentity side={metrics.sideLabel} />
          <Text style={styles.meta}>{status}</Text>
        </View>
        <View style={styles.side}>
          <Text style={styles.rowAmount}>{assetAmount}</Text>
          <Text style={[styles.meta, comparison.worse && styles.risk]}>
            {comparison.text}
          </Text>
        </View>
        <ChevronRight color={colors.faint} size={16} />
      </Pressable>
      <Drawer
        visible={expanded}
        title={`${metrics.sideLabel} SOL stream`}
        header={<StreamIdentity side={metrics.sideLabel} />}
        dismissible={!ownPending}
        onClose={() => setExpanded(false)}
      >
        <View style={styles.headline}>
          <Text style={styles.status}>{status}</Text>
          <Text style={styles.summary}>
            {assetAmount} SOL
            {metrics.averagePrice !== null && (
              <Text style={styles.status}>
                {' '}
                @ {streamPrice(metrics.averagePrice)} ·{' '}
                <Text style={comparison.worse && styles.risk}>
                  {comparison.text}
                </Text>
              </Text>
            )}
          </Text>
        </View>
        <View style={styles.group}>
          <SheetRow
            label="Received"
            value={`${streamAmount(metrics.swappedAtoms, metrics.swappedDecimals, outputPlaces)} ${metrics.swappedToken}`}
            sub={`${buy ? 'for' : 'from'} ${streamAmount(metrics.consumedAtoms, metrics.depositedDecimals, buy ? 2 : 3)} ${metrics.depositedToken} · before fees`}
          />
          <SheetRow
            label="Available"
            value={`${streamAmount(available, metrics.swappedDecimals, outputPlaces)} ${metrics.swappedToken}`}
            sub={
              position.data.withdrawnAmount > 0n
                ? `${formatAtoms(position.data.withdrawnAmount, metrics.swappedDecimals)} withdrawn before fees`
                : 'After fee'
            }
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled: disabled || ended || (available ?? 0n) <= 0n,
                busy: ownPending === 'withdraw',
              }}
              disabled={disabled || ended || (available ?? 0n) <= 0n}
              onPress={() => onAction(position, 'withdraw')}
              style={[
                styles.send,
                (disabled || ended || (available ?? 0n) <= 0n) && {
                  opacity: 0.45,
                },
              ]}
            >
              {ownPending === 'withdraw' ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Download size={14} color={colors.icon} />
              )}
              <Text style={styles.sendText}>
                {ownPending === 'withdraw' ? busyCopy : 'Send to wallet'}
              </Text>
            </Pressable>
          </SheetRow>
          <SheetRow
            label="Time left"
            value={market || metrics.isPaused ? timeLeft : '—'}
            sub={
              totalSlots === null
                ? undefined
                : `of ${streamTime(totalSlots * SLOT_DURATION_SECONDS, true)}`
            }
          />
        </View>
        <FillSummary
          startPrice={startPrice}
          average={metrics.averagePrice}
          progress={metrics.progressPercent}
          paused={metrics.isPaused}
          marketPrice={marketPrice}
        />
        {ended && (
          <Text style={styles.meta}>
            Close this stream to send the remaining funds to its receiver
            accounts.
          </Text>
        )}
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button
              title={
                ownPending === toggle
                  ? busyCopy
                  : metrics.isPaused
                    ? 'Resume'
                    : 'Pause'
              }
              variant="secondary"
              loading={ownPending === toggle}
              disabled={
                disabled ||
                (!metrics.isPaused && ended) ||
                (metrics.isPaused && Boolean(market?.isPaused))
              }
              onPress={() => onAction(position, toggle)}
            />
            {!ownPending && (
              <View pointerEvents="none" style={styles.actionIcon}>
                {metrics.isPaused ? (
                  <Play size={13} color={colors.icon} />
                ) : (
                  <Pause size={13} color={colors.icon} />
                )}
              </View>
            )}
          </View>
          <View style={styles.action}>
            <Button
              title="Close"
              accessibilityLabel="Close stream"
              variant="secondary"
              disabled={disabled}
              onPress={() => {
                setExpanded(false)
                onAction(position, 'close')
              }}
            />
            <View pointerEvents="none" style={styles.actionIcon}>
              <X size={14} color={colors.icon} />
            </View>
          </View>
        </View>
        {signature && (
          <TransactionLink signature={signature} onError={onError} />
        )}
        <Detail label="Stream" value={shortenAddress(position.address, 6, 6)} />
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
  status: { fontSize: 15, color: colors.muted, lineHeight: 23 },
  headline: { gap: 4, marginTop: -8 },
  summary: { fontSize: 15, fontVariant: ['tabular-nums'], lineHeight: 23 },
  group: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 6 },
  send: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 4,
    maxWidth: 220,
  },
  sendText: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
  risk: { color: colors.negative },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
  actionIcon: { position: 'absolute', left: 18, top: 15 },
})
