import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
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
import type { Address } from '@solana/kit'
import { Text, Button } from '../components/ui'
import PositionCard, {
  type PositionAction,
  type PendingPositionAction,
} from '../components/PositionCard'
import { Drawer } from '../components/Drawer'
import { useToast } from '../components/Toast'
import ClosedPositionCard from '../components/positions/ClosedPositionCard'
import { Detail, Notice, TransactionLink } from '../components/positions/Shared'
import { assertCloseReview } from '../components/positions/close-review'
import { colors } from '../theme'
import { config } from '../config'
import { rpc } from '../lib/rpc'
import { useWallet } from '../wallet/WalletProvider'
import { isWalletCancellation } from '../wallet/errors'
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

export default function PositionsScreen({
  embedded = false,
  onStart,
}: {
  embedded?: boolean
  onStart?: () => void
}) {
  const wallet = useWallet()
  const { showToast } = useToast()
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
  const [pendingAction, setPendingAction] =
    useState<PendingPositionAction>(null)
  const [lastConfirmed, setLastConfirmed] = useState<{
    address: string
    signature: string
  } | null>(null)
  const pending = pendingAction !== null
  const busy = useRef(false)
  const reviewSequence = useRef(0)
  const currentOwner = useRef(wallet.address)
  currentOwner.current = wallet.address
  useEffect(() => {
    setReview(null)
    setError(null)
    setSignature(null)
    setActivePage(0)
    setLastConfirmed(null)
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
    setPendingAction({ address: selected[0].address, action })
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
        setLastConfirmed({ address: selected[0].address, signature: confirmed })
        setReview(null)
        showToast({
          title:
            action === 'pause'
              ? 'Stream paused'
              : action === 'resume'
                ? 'Stream resumed'
                : action === 'withdraw'
                  ? 'Sent to your wallet'
                  : selected.length === 1
                    ? 'Stream closed'
                    : 'Streams closed',
          description:
            action === 'pause'
              ? 'Nothing trades until you resume.'
              : action === 'resume'
                ? 'Trading has resumed for the remaining duration.'
                : action === 'withdraw'
                  ? "The available funds were sent to the stream's receiver. The stream keeps running."
                  : "The remaining funds were sent to the streams' receiver accounts.",
          signature: confirmed,
          tone: 'success',
        })
      }
      await client.invalidateQueries({ queryKey: ['mobile'] })
    } catch (cause) {
      if (currentOwner.current === owner) {
        const message = formatTransactionError(
          cause,
          'The stream could not be updated.',
        )
        const declined =
          isWalletCancellation(cause) || message === 'Wallet request cancelled.'
        setError(declined ? null : message)
        showToast({
          title: declined ? 'Request declined' : 'Could not update stream',
          description: declined
            ? 'You declined it in your wallet. Nothing changed.'
            : message,
          tone: 'error',
        })
      }
    } finally {
      busy.current = false
      setPendingAction(null)
    }
  }

  function onAction(position: TradePositionRecord, action: PositionAction) {
    if (disabled || !wallet.address) return
    setError(null)
    if (action === 'close') {
      openReview([position])
      return
    }
    void run(action, [position])
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
  const Container = embedded ? View : ScrollView
  return (
    <Container
      style={embedded ? styles.embedded : styles.screen}
      {...(!embedded
        ? {
            contentContainerStyle: styles.content,
            refreshControl: (
              <RefreshControl
                tintColor={colors.accent}
                refreshing={refreshing}
                onRefresh={() => {
                  void client.invalidateQueries({ queryKey: ['mobile'] })
                }}
              />
            ),
          }
        : {})}
    >
      <View style={styles.tabs}>
        {(['active', 'closed'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            onPress={() => setTab(value)}
            style={[styles.tab, tab === value && styles.selectedTab]}
          >
            <Text
              style={{
                fontSize: 16,
                color: tab === value ? colors.text : colors.muted,
              }}
            >
              {value === 'active' ? 'Active' : 'Closed'}
            </Text>
          </Pressable>
        ))}
      </View>
      {!wallet.address ? (
        <View style={styles.empty}>
          <Text style={styles.subtitle}>
            Connect a wallet to see your streams.
          </Text>
          <Button
            title={wallet.isConnecting ? 'Connecting…' : 'Connect wallet'}
            variant="ghost"
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
          {pending && <Notice>Approve and confirm in your wallet.</Notice>}
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
                  <Text style={styles.subtitle}>
                    No streams running.{' '}
                    {onStart ? (
                      <Text
                        accessibilityRole="link"
                        onPress={onStart}
                        style={styles.startLink}
                      >
                        Start one
                      </Text>
                    ) : (
                      'Start one'
                    )}{' '}
                    and it shows up here.
                  </Text>
                </View>
              ) : (
                visiblePositions?.map((position) => (
                  <PositionCard
                    key={position.address}
                    position={position}
                    market={market.data ?? null}
                    disabled={disabled}
                    pending={pendingAction}
                    onAction={onAction}
                    signature={
                      lastConfirmed?.address === position.address
                        ? lastConfirmed.signature
                        : undefined
                    }
                    onError={setError}
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
                  <Text style={styles.subtitle}>
                    Finished streams show up here with their receipt.
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
      <Drawer
        visible={review !== null}
        title={
          review?.positions.length === 1
            ? 'Close this stream?'
            : 'Close these streams?'
        }
        dismissible={!pending}
        onClose={() => {
          if (!pending) setReview(null)
        }}
      >
        <Text style={styles.subtitle}>
          This ends the stream. It can't be resumed.
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
                <Text style={styles.subtitle}>
                  You'll get back
                  {review && review.positions.length > 1
                    ? ` · ${buy ? 'Buy' : 'Sell'} SOL`
                    : ''}
                </Text>
                <Detail
                  label={`${buy ? 'SOL' : 'USDC'} received`}
                  value={`${formatAtoms(value.receivedAtoms, buy ? 9 : 6, buy ? 9 : 6)} ${buy ? 'SOL' : 'USDC'}`}
                />
                <Detail
                  label={buy ? 'USDC not spent' : 'SOL not sold'}
                  value={`${formatAtoms(value.remainingDepositAtoms, buy ? 6 : 9, buy ? 6 : 9)} ${buy ? 'USDC' : 'SOL'}`}
                />
                <Detail
                  label="Output fee"
                  value={`${formatAtoms(value.feeAtoms, buy ? 9 : 6, buy ? 9 : 6)} ${buy ? 'SOL' : 'USDC'}`}
                />
                <Detail
                  label="Account rent returned"
                  value={`${formatAtoms(value.positionRentLamports, 9, 9)} SOL`}
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
          These are simulated returns. Amounts can change before confirmation.
          Funds already withdrawn are excluded. Closing ends execution
          permanently.
        </Text>
        {error && <Notice error>{error}</Notice>}
        <Button
          title={
            pending ? 'Approve and confirm in your wallet' : 'Close stream'
          }
          loading={pending}
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
          title={
            review?.positions.length === 1
              ? 'Keep it running'
              : 'Keep them running'
          }
          variant="ghost"
          disabled={pending}
          onPress={() => setReview(null)}
        />
      </Drawer>
    </Container>
  )
}

const styles = StyleSheet.create({
  embedded: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: 12,
    paddingBottom: 40,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  tabs: { flexDirection: 'row', padding: 12, gap: 4 },
  tab: {
    minHeight: 36,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },
  selectedTab: { backgroundColor: colors.elevated },
  empty: {
    paddingHorizontal: 18,
    paddingVertical: 22,
    borderTopWidth: 1,
    borderColor: colors.border,
    alignItems: 'flex-start',
    gap: 4,
  },
  startLink: { color: colors.text, textDecorationLine: 'underline' },
  loader: { padding: 30 },
  reviewCard: {
    backgroundColor: colors.elevated,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
})
