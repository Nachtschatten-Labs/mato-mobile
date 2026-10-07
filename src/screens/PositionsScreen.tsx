import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { Address } from '@solana/kit'
import { Text, Button } from '../components/ui'
import PositionCard, { type PositionAction } from '../components/PositionCard'
import ClosedPositionCard from '../components/positions/ClosedPositionCard'
import { Detail, Notice, TransactionLink } from '../components/positions/Shared'
import { assertCloseReview } from '../components/positions/close-review'
import { colors } from '../theme'
import { config } from '../config'
import { rpc } from '../lib/rpc'
import { useWallet } from '../wallet/WalletProvider'
import {
  mobileKeys,
  mobileMarket,
  useForeground,
  useNativeBalances,
  useNativeMarketState,
  usePositions,
} from '../hooks/usePositions'
import { fetchClosedPositionEvents } from '../features/trading/api/market-repository'
import { fetchClosePositionsPreview } from '../features/trading/api/close-position-preview'
import {
  sendClosePositions,
  sendPauseTradePosition,
  sendUnpauseTradePosition,
  sendWithdrawSwapped,
} from '../features/trading/api/twob-client'
import { selectBatchClosePositions } from '../features/trading/lib/batch-close-positions'
import { formatAtoms, shortenAddress } from '../features/trading/lib/format'
import { formatTransactionError } from '../features/trading/lib/transaction-errors'
import { isBuyTradePosition } from '../features/trading/lib/trade-position'
import { MAINTENANCE_TRANSACTION_FEE_BUFFER_ATOMS } from '../features/trading/constants'
import type { TradePositionRecord } from '../features/trading/domain/models'

const PAGE_SIZE = 20
type Review = { owner: Address; positions: TradePositionRecord[]; id: number }

export default function PositionsScreen() {
  const wallet = useWallet()
  const client = useQueryClient()
  const active = useForeground()
  const market = useNativeMarketState()
  const positions = usePositions(wallet.address)
  const balances = useNativeBalances(wallet.address)
  const [tab, setTab] = useState<'active' | 'closed'>('active')
  const [activePage, setActivePage] = useState(0)
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signature, setSignature] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const reviewSequence = useRef(0)
  const currentOwner = useRef(wallet.address)
  currentOwner.current = wallet.address
  useEffect(() => {
    setReview(null)
    setError(null)
    setSignature(null)
    setActivePage(0)
  }, [wallet.address])
  const closed = useInfiniteQuery({
    queryKey: [...mobileKeys, 'closed-positions', wallet.address],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      fetchClosedPositionEvents({
        signal,
        beforeSlot: pageParam,
        limit: PAGE_SIZE,
        marketId: 1,
        positionAuthority: wallet.address!,
      }),
    getNextPageParam: (lastPage, _pages, previousCursor) => {
      if (lastPage.length < PAGE_SIZE) return undefined
      const next = Math.min(...lastPage.map((event) => event.slot))
      return Number.isSafeInteger(next) &&
        next >= 0 &&
        (previousCursor === undefined || next < previousCursor)
        ? next
        : undefined
    },
    enabled: active && Boolean(wallet.address) && tab === 'closed',
    staleTime: 30_000,
  })
  const preview = useQuery({
    queryKey: [
      ...mobileKeys,
      'close-preview',
      review?.owner,
      review?.id,
      review?.positions.map((position) => position.address),
    ],
    queryFn: ({ signal }) =>
      fetchClosePositionsPreview({
        rpcClient: rpc,
        marketAddress: mobileMarket.address,
        positionAddresses: review!.positions.map(
          (position) => position.address,
        ),
        authority: review!.owner,
        signal,
      }),
    enabled:
      active && review !== null && review.owner === wallet.address && !pending,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 5_000,
    retry: false,
  })
  const hasFees =
    balances.data !== undefined &&
    balances.data.lamports >= MAINTENANCE_TRANSACTION_FEE_BUFFER_ATOMS
  const disabled =
    !config.transactionsEnabled ||
    !wallet.signer ||
    !hasFees ||
    !market.data ||
    Boolean(market.error || balances.error) ||
    pending
  const ended = selectBatchClosePositions({
    currentSlot: market.data?.currentSlot ?? null,
    positions: positions.data ?? [],
    mode: 'ended',
    maxPositions: 2,
  })
  const closeBatch = selectBatchClosePositions({
    currentSlot: market.data?.currentSlot ?? null,
    positions: positions.data ?? [],
    mode: 'all',
    maxPositions: 2,
  })

  async function run(action: PositionAction, selected: TradePositionRecord[]) {
    if (busy.current || disabled || !wallet.signer || !wallet.address) return
    const owner = wallet.address
    if (currentOwner.current !== owner || !selected.length) return
    if (selected.some((position) => position.data.authority !== owner)) {
      setError(
        'The position belongs to a different wallet. Refresh your positions.',
      )
      return
    }
    busy.current = true
    setPending(true)
    setError(null)
    setSignature(null)
    try {
      const context = { rpc, signer: wallet.signer }
      const request = {
        marketAddress: mobileMarket.address,
        tradePositionAddress: selected[0].address,
      }
      let confirmed: string
      if (action === 'close') {
        if (preview.error || preview.isFetching)
          throw new Error('Refresh the close preview before continuing.')
        assertCloseReview({
          owner: currentOwner.current,
          reviewOwner: review?.owner,
          market: mobileMarket.address,
          reviewed: review?.positions ?? [],
          selected,
          previews: preview.data,
        })
        confirmed = await sendClosePositions({
          context,
          request: {
            marketAddress: mobileMarket.address,
            tradePositionAddresses: selected.map(
              (position) => position.address,
            ),
          },
        })
      } else if (action === 'pause')
        confirmed = await sendPauseTradePosition({ context, request })
      else if (action === 'resume')
        confirmed = await sendUnpauseTradePosition({ context, request })
      else confirmed = await sendWithdrawSwapped({ context, request })
      if (currentOwner.current === owner) {
        setSignature(confirmed)
        setReview(null)
      }
      await client.invalidateQueries({ queryKey: ['mobile'] })
    } catch (cause) {
      if (currentOwner.current === owner)
        setError(
          formatTransactionError(cause, 'The position could not be updated.'),
        )
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  function onAction(position: TradePositionRecord, action: PositionAction) {
    if (disabled || !wallet.address) return
    setError(null)
    if (action === 'close') {
      openReview([position])
      return
    }
    const title =
      action === 'withdraw'
        ? 'Withdraw swapped funds?'
        : action === 'resume'
          ? 'Resume this stream?'
          : 'Pause this stream?'
    const description =
      action === 'withdraw'
        ? 'Claim the amount swapped so far, less the protocol fee. The remaining stream stays open.'
        : action === 'resume'
          ? 'Execution will resume for the remaining duration. Review the transaction in your wallet.'
          : 'Execution stops until you resume. Your remaining input stays in the position.'
    Alert.alert(title, description, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Continue',
        onPress: () => {
          void run(action, [position])
        },
      },
    ])
  }

  function openReview(selected: TradePositionRecord[]) {
    if (disabled || !wallet.address || !selected.length) return
    setError(null)
    setReview({
      owner: wallet.address,
      positions: selected,
      id: ++reviewSequence.current,
    })
  }

  const refreshing =
    positions.isRefetching || (tab === 'closed' && closed.isRefetching)
  const activePages = Math.max(1, Math.ceil((positions.data?.length ?? 0) / 10))
  const safeActivePage = Math.min(activePage, activePages - 1)
  const visiblePositions = positions.data?.slice(
    safeActivePage * 10,
    safeActivePage * 10 + 10,
  )
  const rows = Array.from(
    new Map(
      (closed.data?.pages.flat() ?? []).map((event) => [event.id, event]),
    ).values(),
  )
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          tintColor={colors.accent}
          refreshing={refreshing}
          onRefresh={() => {
            void client.invalidateQueries({ queryKey: ['mobile'] })
          }}
        />
      }
    >
      <Text style={styles.eyebrow}>YOUR ACTIVITY</Text>
      <Text style={styles.title}>Positions</Text>
      <Text style={styles.subtitle}>Every stream, at your pace.</Text>
      <View style={styles.tabs}>
        {(['active', 'closed'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            onPress={() => setTab(value)}
            style={[styles.tab, tab === value && styles.selectedTab]}
          >
            <Text style={{ color: tab === value ? colors.text : colors.muted }}>
              {value === 'active'
                ? `Active${positions.data?.length ? ` · ${positions.data.length}` : ''}`
                : 'History'}
            </Text>
          </Pressable>
        ))}
      </View>
      {!wallet.address ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>↗</Text>
          <Text style={styles.emptyTitle}>Your streams live here</Text>
          <Text style={styles.subtitle}>
            Connect your wallet to follow active trades and see your history.
          </Text>
          <Button
            title={wallet.isConnecting ? 'Connecting…' : 'Connect wallet'}
            disabled={wallet.isConnecting || !wallet.supported}
            onPress={() => {
              void wallet
                .connect()
                .catch((cause: unknown) =>
                  setError(
                    formatTransactionError(cause, 'Could not connect wallet.'),
                  ),
                )
            }}
          />
        </View>
      ) : (
        <>
          {!config.transactionsEnabled && (
            <Notice>
              Read-only build. You can follow your positions; trading is
              disabled.
            </Notice>
          )}
          {balances.data && !hasFees && (
            <Notice>
              Add at least 0.001 SOL to pay network fees before managing
              positions.
            </Notice>
          )}
          {(balances.error || market.error) && (
            <Notice error>
              Network data could not be refreshed. Pull down to retry.
            </Notice>
          )}
          {pending && (
            <Notice>
              Approve the transaction in your wallet. Waiting for confirmation…
            </Notice>
          )}
          {signature && (
            <View>
              <Notice>Transaction confirmed.</Notice>
              <TransactionLink signature={signature} onError={setError} />
            </View>
          )}
          {tab === 'active' ? (
            <>
              {ended.length > 0 && (
                <Button
                  title={`Review ${ended.length} ended stream${ended.length === 1 ? '' : 's'}`}
                  variant="secondary"
                  disabled={disabled}
                  onPress={() => openReview(ended)}
                />
              )}
              {closeBatch.length > 1 && (
                <Button
                  title={`Review closing ${closeBatch.length} streams`}
                  variant="secondary"
                  disabled={disabled}
                  onPress={() => openReview(closeBatch)}
                />
              )}
              {positions.isPending ? (
                <ActivityIndicator
                  color={colors.accent}
                  style={styles.loader}
                />
              ) : positions.error ? (
                <Notice error>
                  Could not load positions. Pull down to try again.
                </Notice>
              ) : positions.data?.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyIcon}>≈</Text>
                  <Text style={styles.emptyTitle}>No active streams</Text>
                  <Text style={styles.subtitle}>
                    Start a trade and watch it fill over time.
                  </Text>
                </View>
              ) : (
                visiblePositions?.map((position) => (
                  <PositionCard
                    key={position.address}
                    position={position}
                    market={market.data ?? null}
                    disabled={disabled}
                    pending={pending}
                    onAction={onAction}
                  />
                ))
              )}
              {activePages > 1 && (
                <View style={styles.pagination}>
                  <Button
                    title="Previous"
                    variant="ghost"
                    disabled={safeActivePage === 0}
                    onPress={() => setActivePage(safeActivePage - 1)}
                  />
                  <Text style={styles.subtitle}>
                    {safeActivePage + 1} / {activePages}
                  </Text>
                  <Button
                    title="Next"
                    variant="ghost"
                    disabled={safeActivePage + 1 >= activePages}
                    onPress={() => setActivePage(safeActivePage + 1)}
                  />
                </View>
              )}
            </>
          ) : (
            <>
              {closed.isPending ? (
                <ActivityIndicator
                  color={colors.accent}
                  style={styles.loader}
                />
              ) : closed.error && !closed.data ? (
                <Notice error>
                  Could not load trade history. Pull down to try again.
                </Notice>
              ) : rows.length === 0 && !closed.error ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>A fresh start</Text>
                  <Text style={styles.subtitle}>
                    Your completed streams will appear here.
                  </Text>
                </View>
              ) : (
                rows.map((event) => (
                  <ClosedPositionCard
                    key={event.id}
                    event={event}
                    onError={setError}
                  />
                ))
              )}
              {closed.error && closed.data && (
                <Notice error>
                  {closed.isFetchNextPageError
                    ? 'Could not load more history. Your loaded trades are still shown.'
                    : 'Could not refresh history. Showing the last loaded trades; pull down to retry.'}
                </Notice>
              )}
              {closed.hasNextPage && (
                <Button
                  title={
                    closed.isFetchingNextPage
                      ? 'Loading…'
                      : closed.isFetchNextPageError
                        ? 'Retry loading more'
                        : 'Load more'
                  }
                  variant="secondary"
                  disabled={closed.isFetchingNextPage}
                  onPress={() => {
                    void closed.fetchNextPage()
                  }}
                />
              )}
            </>
          )}
        </>
      )}
      {error && <Notice error>{error}</Notice>}
      <Modal
        visible={review !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (!pending) setReview(null)
        }}
      >
        <SafeAreaView style={styles.screen}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.eyebrow}>REVIEW RETURNS</Text>
            <Text style={styles.title}>
              Close{' '}
              {review?.positions.length === 1
                ? 'this stream?'
                : 'these streams?'}
            </Text>
            <Text style={styles.subtitle}>
              Your remaining input and swapped output return to the position’s
              receiver accounts.
            </Text>
            {preview.isPending ? (
              <ActivityIndicator color={colors.accent} style={styles.loader} />
            ) : preview.error ? (
              <Notice error>
                {formatTransactionError(
                  preview.error,
                  'Could not simulate this close.',
                )}
              </Notice>
            ) : (
              preview.data?.map((value, index) => {
                const position = review?.positions[index]
                if (!position) return null
                const buy = isBuyTradePosition(position.data)
                return (
                  <View key={position.address} style={styles.reviewCard}>
                    <Text style={styles.emptyTitle}>
                      {buy ? 'Buy' : 'Sell'} SOL
                    </Text>
                    <Detail
                      label="Receive on close, after fee"
                      value={`${formatAtoms(value.receivedAtoms, buy ? 9 : 6)} ${buy ? 'SOL' : 'USDC'}`}
                    />
                    <Detail
                      label="Refunded input"
                      value={`${formatAtoms(value.remainingDepositAtoms, buy ? 6 : 9)} ${buy ? 'USDC' : 'SOL'}`}
                    />
                    <Detail
                      label="Output fee"
                      value={`${formatAtoms(value.feeAtoms, buy ? 9 : 6, buy ? 9 : 6)} ${buy ? 'SOL' : 'USDC'}`}
                    />
                    <Detail
                      label="Account rent returned"
                      value={`${formatAtoms(value.positionRentLamports, 9)} SOL`}
                    />
                    <Detail
                      label="SOL receiver"
                      value={shortenAddress(value.baseReceiver, 6, 6)}
                    />
                    <Detail
                      label="USDC receiver"
                      value={shortenAddress(value.quoteReceiver, 6, 6)}
                    />
                    <Detail
                      label="Rent receiver"
                      value={shortenAddress(value.rentReceiver, 6, 6)}
                    />
                  </View>
                )
              })
            )}
            <Text style={styles.subtitle}>
              These are simulated returns. Amounts can change before
              confirmation. Funds already withdrawn are excluded. Closing ends
              execution permanently.
            </Text>
            {error && <Notice error>{error}</Notice>}
            <Button
              title={pending ? 'Confirming…' : 'Close and settle'}
              disabled={
                disabled ||
                preview.isFetching ||
                !preview.data ||
                Boolean(preview.error)
              }
              onPress={() => {
                if (review) void run('close', review.positions)
              }}
            />
            <Button
              title="Refresh preview"
              variant="secondary"
              disabled={pending || preview.isFetching}
              onPress={() => {
                void preview.refetch()
              }}
            />
            <Button
              title="Keep streams open"
              variant="ghost"
              disabled={pending}
              onPress={() => setReview(null)}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: 20,
    paddingBottom: 40,
    gap: 16,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 2,
    color: colors.accent,
    marginTop: 12,
  },
  title: { fontSize: 32, lineHeight: 40, fontWeight: '500', letterSpacing: -1 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  tabs: {
    flexDirection: 'row',
    padding: 4,
    backgroundColor: colors.card,
    borderRadius: 30,
    borderColor: colors.border,
    borderWidth: 1,
    marginTop: 8,
  },
  tab: {
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 24,
  },
  selectedTab: { backgroundColor: colors.elevated },
  empty: {
    padding: 28,
    gap: 16,
    marginVertical: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  emptyIcon: { color: colors.accent, fontSize: 36, lineHeight: 44 },
  emptyTitle: { fontSize: 18, fontWeight: '500' },
  loader: { padding: 30 },
  reviewCard: {
    backgroundColor: colors.card,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
})
