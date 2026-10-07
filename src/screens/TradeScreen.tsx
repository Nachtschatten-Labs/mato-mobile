import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, SlidersHorizontal, Zap } from 'lucide-react-native'
import * as Haptics from 'expo-haptics'
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Label,
  Row,
  Screen,
  Text,
} from '@/components/ui'
import PositionsScreen from './PositionsScreen'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PriceChart } from '@/components/PriceChart'
import { colors, fonts } from '@/theme'
import { config } from '@/config'
import { useWallet } from '@/wallet'
import { rpc } from '@/lib/rpc'
import {
  mobileKeys,
  mobileMarket as market,
  useForeground,
  useNativeBalances,
  useNativeMarketState,
} from '@/hooks/usePositions'
import { DURATION_OPTIONS, type OrderSide } from '@/features/trading/constants'
import {
  fetchMarketCandles,
  fetchMarketPrice,
} from '@/features/trading/api/market-repository'
import {
  fetchMarketTradePositions,
  sendSubmitOrder,
} from '@/features/trading/api/twob-client'
import {
  atomsFromPercent,
  durationToSlots,
  formatAtomsToInput,
  parseTokenAmount,
  sanitizeAmountInput,
} from '@/features/trading/lib/amounts'
import { recommendDurationSlots } from '@/features/trading/lib/duration'
import { formatSmartDuration } from '@/features/trading/lib/duration-label'
import {
  computePriceImpactPercent,
  isHighPriceImpact,
} from '@/features/trading/lib/price-impact'
import { marketPriceFromFlows } from '@/features/trading/lib/market'
import {
  formatAtoms,
  formatPrice,
  shortenAddress,
} from '@/features/trading/lib/format'
import {
  getTradePositionEndSlot,
  isBuyTradePosition,
  isPausedTradePosition,
} from '@/features/trading/lib/trade-position'
import { formatTransactionError } from '@/features/trading/lib/transaction-errors'
import {
  requiresNewImpactReview,
  validateOrder,
} from '@/features/orders/validation'

type OrderReview = {
  authority: string
  atoms: bigint
  side: OrderSide
  durationSlots: number
  impact: number | null
}

const ranges = {
  '1H': { ms: 60 * 60_000, interval: '1m' as const },
  '1D': { ms: 24 * 60 * 60_000, interval: '5m' as const },
  '1W': { ms: 7 * 24 * 60 * 60_000, interval: '1h' as const },
}

export default function TradeScreen() {
  const wallet = useWallet()
  const insets = useSafeAreaInsets()
  const foreground = useForeground()
  const queryClient = useQueryClient()
  const stateQuery = useNativeMarketState()
  const balances = useNativeBalances(wallet.address)
  const [range, setRange] = useState<keyof typeof ranges>('1D')
  const [chartMode, setChartMode] = useState<'line' | 'candles'>('line')
  const [panel, setPanel] = useState<'chart' | 'book'>('chart')
  const [side, setSide] = useState<OrderSide>('buy')
  const [amount, setAmount] = useState('')
  const [smart, setSmart] = useState(true)
  const [seconds, setSeconds] = useState(300)
  const [durationOpen, setDurationOpen] = useState(false)
  const [orderReview, setOrderReview] = useState<OrderReview | null>(null)
  const currentWallet = useRef(wallet.address)
  currentWallet.current = wallet.address
  useEffect(() => {
    setOrderReview(null)
    setAcknowledged(false)
    setSignature(null)
  }, [wallet.address])
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [signature, setSignature] = useState<string | null>(null)
  const price = useQuery({
    queryKey: [...mobileKeys, 'price'],
    queryFn: ({ signal }) => fetchMarketPrice({ marketId: 1, signal }),
    enabled: foreground,
    refetchInterval: 10_000,
  })
  const candles = useQuery({
    queryKey: [...mobileKeys, 'candles', range],
    queryFn: ({ signal }) =>
      fetchMarketCandles({
        marketId: 1,
        from: new Date(Date.now() - ranges[range].ms),
        to: new Date(),
        interval: ranges[range].interval,
        maxPoints: 320,
        signal,
      }),
    enabled: foreground,
    refetchInterval: 60_000,
  })
  const daily = useQuery({
    queryKey: [...mobileKeys, 'daily-price'],
    queryFn: ({ signal }) =>
      fetchMarketCandles({
        marketId: 1,
        from: new Date(Date.now() - 25 * 60 * 60_000),
        to: new Date(),
        interval: '5m',
        maxPoints: 320,
        signal,
      }),
    enabled: foreground,
    refetchInterval: 60_000,
  })
  const book = useQuery({
    queryKey: [...mobileKeys, 'order-book'],
    queryFn: () => fetchMarketTradePositions(rpc, market.address),
    enabled: foreground && panel === 'book',
    refetchInterval: 10_000,
  })
  const isBuy = side === 'buy'
  const decimals = isBuy ? 6 : 9
  const inputToken = isBuy ? 'USDC' : 'SOL'
  const outputToken = isBuy ? 'SOL' : 'USDC'
  const available = balances.data
    ? isBuy
      ? balances.data.usdcAtoms
      : balances.data.spendableSolAtoms
    : null
  const atoms = amount ? parseTokenAmount(amount, decimals) : null
  const state = stateQuery.data
  const recommended = recommendDurationSlots({
    amountAtoms: atoms,
    side,
    streamingState: state,
  })
  const durationSlots = smart ? recommended : durationToSlots(seconds)
  const impact =
    durationSlots === null
      ? null
      : computePriceImpactPercent({
          amountAtoms: atoms,
          side,
          streamingState: state,
          durationSlots,
        })
  const indicative = state
    ? marketPriceFromFlows(state.marketBaseFlow, state.marketQuoteFlow, 9, 6)
    : null
  const execution =
    indicative && impact !== null
      ? indicative * (1 + (isBuy ? impact : -impact) / 100)
      : null
  const receive =
    execution && atoms && durationSlots
      ? isBuy
        ? Number(atoms) / 10 ** decimals / execution
        : (Number(atoms) / 10 ** decimals) * execution
      : null
  const minimum = state
    ? isBuy
      ? state.minimumQuoteDepositAtoms
      : state.minimumBaseDepositAtoms
    : isBuy
      ? market.minimumQuoteDepositAtoms
      : market.minimumBaseDepositAtoms
  const hasLiquidity = Boolean(
    state && state.marketBaseFlow > 0n && state.marketQuoteFlow > 0n,
  )
  const priceValue = price.data?.price ?? null
  const referenceTime = price.data?.eventTimeMs
    ? price.data.eventTimeMs - 24 * 60 * 60_000
    : Date.now() - 24 * 60 * 60_000
  const previousPrice = daily.data
    ?.filter((c) => c.time * 1000 <= referenceTime)
    .at(-1)?.close
  const change =
    priceValue && previousPrice
      ? ((priceValue - previousPrice) / previousPrice) * 100
      : null
  const durationLabel =
    durationSlots === null
      ? 'Waiting for liquidity'
      : formatSmartDuration(durationSlots * 0.2)
  const stale =
    stateQuery.isError || Date.now() - stateQuery.dataUpdatedAt > 20_000
  const validation = validateOrder({
    amount: atoms,
    minimum,
    available,
    lamports: balances.data?.lamports ?? null,
    durationSlots,
    marketPaused: state?.isPaused ?? false,
    hasLiquidity,
  })

  function changeSide(next: OrderSide) {
    setSide(next)
    setAmount('')
    setError(null)
    setSignature(null)
  }
  function review() {
    setError(null)
    if (!wallet.address) {
      void wallet.connect().catch(() => {})
      return
    }
    if (stale) {
      setError('Refresh market data before placing an order.')
      return
    }
    if (validation) {
      setError(validation)
      return
    }
    setAcknowledged(false)
    if (atoms && durationSlots !== null)
      setOrderReview({
        authority: wallet.address,
        atoms,
        side,
        durationSlots,
        impact,
      })
  }
  async function submit() {
    if (pendingRef.current || !wallet.signer || !orderReview || !acknowledged)
      return
    const reviewed = orderReview
    const reviewedBuy = reviewed.side === 'buy'
    const signer = wallet.signer
    const assertReviewedWallet = () => {
      if (
        currentWallet.current !== reviewed.authority ||
        signer.address !== reviewed.authority
      )
        throw new Error('Your wallet changed. Review the order again.')
    }
    pendingRef.current = true
    setPending(true)
    setError(null)
    setSignature(null)
    try {
      assertReviewedWallet()
      const [freshState, freshBalances] = await Promise.all([
        stateQuery.refetch(),
        balances.refetch(),
      ])
      assertReviewedWallet()
      if (
        !freshState.data ||
        !freshBalances.data ||
        freshState.error ||
        freshBalances.error
      )
        throw new Error(
          'Unable to verify current market and wallet balances. Please refresh and try again.',
        )
      const fresh = freshState.data
      const problem = validateOrder({
        amount: reviewed.atoms,
        minimum: reviewedBuy
          ? fresh.minimumQuoteDepositAtoms
          : fresh.minimumBaseDepositAtoms,
        available: reviewedBuy
          ? freshBalances.data.usdcAtoms
          : freshBalances.data.spendableSolAtoms,
        lamports: freshBalances.data.lamports,
        durationSlots: reviewed.durationSlots,
        marketPaused: fresh.isPaused,
        hasLiquidity: fresh.marketBaseFlow > 0n && fresh.marketQuoteFlow > 0n,
      })
      if (problem) throw new Error(problem)
      const freshImpact = computePriceImpactPercent({
        amountAtoms: reviewed.atoms,
        side: reviewed.side,
        streamingState: fresh,
        durationSlots: reviewed.durationSlots,
      })
      if (requiresNewImpactReview(reviewed.impact, freshImpact))
        throw new Error(
          'Market conditions changed. Review the updated price impact before submitting.',
        )
      const result = await sendSubmitOrder({
        context: { rpc, signer },
        request: {
          amount: reviewed.atoms,
          durationSlots: reviewed.durationSlots,
          existingWrappedAtoms: freshBalances.data.wrappedSolAtoms,
          id: globalThis.crypto.getRandomValues(new Uint32Array(1))[0],
          inputMintAddress: reviewedBuy ? market.quoteMint : market.baseMint,
          isBuy: reviewedBuy,
          marketAddress: market.address,
        },
      })
      if (currentWallet.current === reviewed.authority) {
        setSignature(result)
        setAmount('')
      }
      setOrderReview(null)
      void queryClient.invalidateQueries({ queryKey: ['mobile'] })
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {})
    } catch (e) {
      setError(formatTransactionError(e, 'Unable to submit this order.'))
      setOrderReview(null)
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['mobile'] })
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        refreshControl={
          <RefreshControl
            tintColor={colors.accent}
            refreshing={price.isRefetching && candles.isRefetching}
            onRefresh={refresh}
          />
        }
      >
        <Card>
          <View style={s.sideControl}>
            {(['buy', 'sell'] as const).map((value) => (
              <Pressable
                key={value}
                onPress={() => changeSide(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: side === value }}
                style={[
                  s.sideButton,
                  side === value && {
                    backgroundColor: colors.elevated,
                  },
                ]}
              >
                <Text
                  style={{
                    fontFamily: fonts.medium,
                    color: side === value ? colors.text : colors.muted,
                  }}
                >
                  {value === 'buy' ? 'Buy' : 'Sell'}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={s.amountBox}>
            <Row>
              <Label>{isBuy ? 'Buy with' : 'Sell'}</Label>
              {wallet.address && (
                <Label>
                  {available === null
                    ? 'Balance —'
                    : `Available ${formatAtoms(available, decimals, 4)}`}
                </Label>
              )}
            </Row>
            <Row>
              <TextInput
                accessibilityLabel={`Amount to pay in ${inputToken}`}
                keyboardType="decimal-pad"
                inputMode="decimal"
                value={amount}
                onChangeText={(text) => {
                  setAmount(sanitizeAmountInput(text))
                  setError(null)
                }}
                placeholder="0"
                placeholderTextColor="#555651"
                maxLength={24}
                style={s.amountInput}
              />
              <Row style={{ gap: 8 }}>
                <TokenMark token={inputToken} size={24} />
                <Text style={{ fontFamily: fonts.medium }}>{inputToken}</Text>
              </Row>
            </Row>
            {wallet.address && (
              <Row>
                <Label>
                  Min. {formatAtoms(minimum, decimals)} {inputToken}
                </Label>
                <View style={s.inline}>
                  {[25, 50, 100].map((percent) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Use ${percent} percent of available balance`}
                      key={percent}
                      disabled={available === null}
                      onPress={() =>
                        setAmount(
                          formatAtomsToInput(
                            atomsFromPercent(available!, percent),
                            decimals,
                          ),
                        )
                      }
                      style={s.percent}
                    >
                      <Text style={s.percentText}>
                        {percent === 100 ? 'MAX' : `${percent}%`}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </Row>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose order duration"
            onPress={() => setDurationOpen(true)}
          >
            <Row>
              <Row style={{ gap: 10 }}>
                <View style={s.zap}>
                  <Zap size={17} color={colors.accent} />
                </View>
                <View>
                  <Text style={{ fontFamily: fonts.medium }}>Duration</Text>
                  <Label>{durationLabel}</Label>
                </View>
              </Row>
              <ChevronDown size={18} color={colors.muted} />
            </Row>
          </Pressable>
          <View style={s.receiveBox}>
            <Row>
              <View>
                <Label>Est. receive</Label>
                <Text style={s.receive}>
                  {receive === null
                    ? '—'
                    : `≈ ${receive.toLocaleString(undefined, { maximumFractionDigits: isBuy ? 6 : 3 })}`}{' '}
                  <Text style={{ color: colors.muted }}>{outputToken}</Text>
                </Text>
              </View>
              <TokenMark token={outputToken} />
            </Row>
          </View>
          {atoms !== null && atoms > 0n && (
            <View style={{ gap: 8 }}>
              <Row>
                <Label>Price impact</Label>
                <Text
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 12,
                    color: isHighPriceImpact(impact)
                      ? colors.negative
                      : colors.text,
                  }}
                >
                  {impact === null
                    ? '—'
                    : `${impact < 0.001 ? '<0.001' : impact.toFixed(3)}%`}
                </Text>
              </Row>
              <Row>
                <Label>Indicative execution price</Label>
                <Text style={{ fontFamily: fonts.mono, fontSize: 12 }}>
                  {execution === null ? '—' : `$${formatPrice(execution)}`}
                </Text>
              </Row>
            </View>
          )}
          <Label>
            1 SOL ≈ {priceValue === null ? '—' : formatPrice(priceValue)} USDC
          </Label>
          {stateQuery.isError && (
            <ErrorNotice message="On-chain market data is unavailable. Pull to refresh." />
          )}
          {balances.isError && wallet.address && (
            <ErrorNotice
              message="Wallet balances could not be refreshed."
              retry={() => {
                void balances.refetch()
              }}
            />
          )}
          {error && <ErrorNotice message={error} />}
          {signature && (
            <View style={s.success}>
              <Text style={{ color: colors.positive }}>
                Your order is streaming.
              </Text>
              <Button
                title="View transaction ↗"
                variant="ghost"
                onPress={() => {
                  void Linking.openURL(
                    `https://explorer.solana.com/tx/${signature}`,
                  )
                }}
              />
            </View>
          )}
          <Button
            title={
              !wallet.supported
                ? 'Open on Android to connect'
                : !wallet.address
                  ? 'Connect wallet to stream'
                  : !config.transactionsEnabled
                    ? 'Trading disabled in preview'
                    : `Review ${side} order`
            }
            onPress={review}
            loading={pending || wallet.isConnecting}
            disabled={
              !wallet.supported ||
              Boolean(wallet.address && !config.transactionsEnabled)
            }
          />
        </Card>
        <Card style={{ gap: 12 }}>
          <Row>
            <Row style={{ justifyContent: 'flex-start' }}>
              <TokenMark token="SOL" />
              <View>
                <Text style={s.marketName}>
                  SOL <Text style={{ color: colors.muted }}>/ USDC</Text>
                </Text>
              </View>
            </Row>
            <Text style={s.price}>
              {priceValue === null ? '—' : `$${formatPrice(priceValue)}`}
            </Text>
          </Row>
          <Text
            style={[
              s.priceChange,
              {
                color:
                  change === null
                    ? colors.muted
                    : change >= 0
                      ? colors.positive
                      : colors.negative,
              },
            ]}
          >
            {change === null
              ? '24h —'
              : `${change >= 0 ? '+' : ''}${change.toFixed(2)}% 24h`}
          </Text>
          <Row>
            <View style={s.inline}>
              <Chip
                title="Chart"
                selected={panel === 'chart'}
                onPress={() => setPanel('chart')}
              />
              <Chip
                title="Order book"
                selected={panel === 'book'}
                onPress={() => setPanel('book')}
              />
            </View>
            {panel === 'chart' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${chartMode === 'line' ? 'candlestick' : 'line'} chart`}
                onPress={() =>
                  setChartMode(chartMode === 'line' ? 'candles' : 'line')
                }
                style={s.iconButton}
              >
                <SlidersHorizontal size={17} color={colors.muted} />
              </Pressable>
            )}
          </Row>
          {panel === 'chart' ? (
            <>
              {candles.isPending ? (
                <View style={s.chartLoading}>
                  <ActivityIndicator color={colors.accent} />
                  <Label>Loading market history…</Label>
                </View>
              ) : candles.isError ? (
                <ErrorNotice
                  message="Price history is unavailable."
                  retry={() => {
                    void candles.refetch()
                  }}
                />
              ) : (
                <PriceChart candles={candles.data ?? []} mode={chartMode} />
              )}
              <Row>
                <Label>SOL price in USDC</Label>
                <View style={s.inline}>
                  {(Object.keys(ranges) as Array<keyof typeof ranges>).map(
                    (r) => (
                      <Chip
                        key={r}
                        title={r}
                        selected={range === r}
                        onPress={() => setRange(r)}
                      />
                    ),
                  )}
                </View>
              </Row>
            </>
          ) : (
            <OrderBook
              data={book.data ?? []}
              loading={book.isPending}
              error={book.isError}
              currentSlot={state?.currentSlot}
            />
          )}
          {price.isError && (
            <ErrorNotice
              message="Unable to refresh market price."
              retry={() => {
                void price.refetch()
              }}
            />
          )}
        </Card>
        <PositionsScreen embedded />
      </Screen>

      <Modal
        visible={durationOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setDurationOpen(false)}
      >
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Row>
              <Text style={s.sectionTitle}>Duration</Text>
              <Button
                title="Done"
                variant="ghost"
                onPress={() => setDurationOpen(false)}
              />
            </Row>
            <Text style={{ color: colors.muted }}>
              Smart fill targets less than 0.01% price impact using current
              liquidity. Actual execution can change.
            </Text>
            <Button
              title="Use Smart fill"
              variant={smart ? 'primary' : 'secondary'}
              onPress={() => {
                setSmart(true)
                setDurationOpen(false)
              }}
            />
            <Label>OR CHOOSE A DURATION</Label>
            <ScrollView style={{ maxHeight: 260 }}>
              <View style={s.durationGrid}>
                {DURATION_OPTIONS.map((option) => (
                  <Chip
                    key={option.label}
                    title={option.label}
                    selected={!smart && seconds === option.seconds}
                    onPress={() => {
                      setSeconds(option.seconds)
                      setSmart(false)
                      setDurationOpen(false)
                    }}
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal
        visible={orderReview !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!pending) setOrderReview(null)
        }}
      >
        <View style={s.overlay}>
          <ScrollView
            style={s.sheet}
            contentContainerStyle={{ gap: 20, paddingBottom: 20 }}
          >
            <Row>
              <Text style={s.sectionTitle}>
                Review {orderReview?.side} order
              </Text>
              <Button
                title="Cancel"
                variant="ghost"
                disabled={pending}
                onPress={() => setOrderReview(null)}
              />
            </Row>
            <Row>
              <Label>You pay</Label>
              <Text>
                {orderReview
                  ? formatAtomsToInput(
                      orderReview.atoms,
                      orderReview.side === 'buy' ? 6 : 9,
                    )
                  : '—'}{' '}
                {orderReview?.side === 'buy' ? 'USDC' : 'SOL'}
              </Text>
            </Row>
            <Row>
              <Label>Duration</Label>
              <Text>
                {orderReview
                  ? formatSmartDuration(orderReview.durationSlots * 0.2)
                  : '—'}
              </Text>
            </Row>
            <Row>
              <Label>Price impact</Label>
              <Text
                style={{
                  color: isHighPriceImpact(orderReview?.impact ?? null)
                    ? colors.negative
                    : colors.text,
                }}
              >
                {orderReview?.impact?.toFixed(3) ?? '—'}%
              </Text>
            </Row>
            <Label>
              Wallet · {shortenAddress(orderReview?.authority, 8, 6)}
            </Label>
            {isHighPriceImpact(orderReview?.impact ?? null) && (
              <ErrorNotice message="This order has more than 1% estimated price impact. A smaller amount or longer duration may reduce it." />
            )}
            <Text style={{ color: colors.muted }}>
              Mato is experimental. Liquidity is low and the contracts have not
              been fully audited. You can lose some or all of your funds. Orders
              have no guaranteed execution price.
            </Text>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acknowledged }}
              disabled={pending}
              onPress={() => setAcknowledged(!acknowledged)}
              style={s.acknowledge}
            >
              <View
                style={[
                  s.checkbox,
                  acknowledged && { backgroundColor: colors.accent },
                ]}
              >
                <Text style={{ color: colors.background }}>
                  {acknowledged ? '✓' : ''}
                </Text>
              </View>
              <Text style={{ flex: 1 }}>
                I understand the risks and approve this order.
              </Text>
            </Pressable>
            <Button
              title="Confirm in wallet"
              onPress={() => {
                void submit()
              }}
              disabled={!acknowledged || !config.transactionsEnabled}
              loading={pending}
            />
          </ScrollView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  )
}

function Chip({
  title,
  selected,
  onPress,
}: {
  title: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[s.chip, selected && s.selectedChip]}
    >
      <Text style={[s.chipText, selected && { color: colors.text }]}>
        {title}
      </Text>
    </Pressable>
  )
}
function TokenMark({ token, size = 36 }: { token: string; size?: number }) {
  return (
    <View
      style={[
        s.token,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: token === 'SOL' ? '#25232e' : '#203249',
        },
      ]}
    >
      <Text
        style={{
          fontFamily: fonts.medium,
          fontSize: size * 0.48,
          color: token === 'SOL' ? '#b9afda' : '#88baf4',
        }}
      >
        {token === 'SOL' ? '≋' : '$'}
      </Text>
    </View>
  )
}
function OrderBook({
  data,
  loading,
  error,
  currentSlot,
}: {
  data: Awaited<ReturnType<typeof fetchMarketTradePositions>>
  loading: boolean
  error: boolean
  currentSlot?: number
}) {
  const [limit, setLimit] = useState(10)
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell'>('all')
  const rows = data
    .filter(
      (p) =>
        !isPausedTradePosition(p.data) &&
        (currentSlot === undefined ||
          getTradePositionEndSlot(p.data) >= BigInt(currentSlot)) &&
        (filter === 'all' || isBuyTradePosition(p.data) === (filter === 'buy')),
    )
    .sort((a, b) =>
      Number(getTradePositionEndSlot(a.data) - getTradePositionEndSlot(b.data)),
    )
  if (loading)
    return <ActivityIndicator color={colors.accent} style={{ height: 160 }} />
  if (error) return <ErrorNotice message="Unable to load the order book." />
  return (
    <View style={{ gap: 14 }}>
      <Row>
        <Label>{rows.length} active orders</Label>
        <View style={s.inline}>
          {(['all', 'buy', 'sell'] as const).map((f) => (
            <Chip
              key={f}
              title={f}
              selected={filter === f}
              onPress={() => {
                setFilter(f)
                setLimit(10)
              }}
            />
          ))}
        </View>
      </Row>
      {rows.length === 0 ? (
        <EmptyState
          title="No active orders"
          detail="Orders will appear here when traders add flow."
        />
      ) : (
        rows.slice(0, limit).map((p) => {
          const buy = isBuyTradePosition(p.data)
          return (
            <Row key={p.address}>
              <View>
                <Text
                  style={{ color: buy ? colors.positive : colors.negative }}
                >
                  {buy ? 'Buy' : 'Sell'} SOL
                </Text>
                <Label>{shortenAddress(p.address)}</Label>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontFamily: fonts.mono, fontSize: 13 }}>
                  {formatAtoms(p.data.amount, buy ? 6 : 9)}{' '}
                  {buy ? 'USDC' : 'SOL'}
                </Text>
                <Label>
                  Ends at slot {getTradePositionEndSlot(p.data).toString()}
                </Label>
              </View>
            </Row>
          )
        })
      )}
      {rows.length > limit && (
        <Button
          title="Show more"
          variant="ghost"
          onPress={() => setLimit(limit + 10)}
        />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  marketName: { fontSize: 18, fontFamily: fonts.medium },
  price: {
    fontSize: 18,
    lineHeight: 26,
    fontFamily: fonts.mono,
    letterSpacing: -1.2,
  },
  priceChange: { fontSize: 12, fontFamily: fonts.mono },
  inline: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  chip: {
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    minHeight: 40,
    justifyContent: 'center',
  },
  selectedChip: { backgroundColor: colors.elevated },
  chipText: { fontSize: 12, color: colors.muted, fontFamily: fonts.medium },
  iconButton: {
    width: 44,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chartLoading: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  sectionTitle: { fontSize: 18, fontFamily: fonts.medium },
  sideControl: {
    flexDirection: 'row',
    backgroundColor: '#0c0c0c',
    borderRadius: 28,
    padding: 4,
    gap: 4,
  },
  sideButton: {
    flex: 1,
    alignItems: 'center',
    padding: 11,
    borderRadius: 24,
    minHeight: 44,
  },
  amountBox: {
    backgroundColor: '#101010',
    borderColor: '#292929',
    borderWidth: 1,
    padding: 14,
    borderRadius: 14,
    gap: 10,
  },
  amountInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.mono,
    fontSize: 26,
    color: colors.text,
    paddingVertical: 8,
    minHeight: 44,
  },
  percent: {
    paddingVertical: 7,
    paddingHorizontal: 8,
    minHeight: 36,
    justifyContent: 'center',
    backgroundColor: colors.elevated,
    borderRadius: 6,
  },
  percentText: { color: colors.muted, fontSize: 10, fontFamily: fonts.mono },
  receiveBox: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: colors.elevated,
  },
  receive: { fontFamily: fonts.mono, fontSize: 21, lineHeight: 32 },
  zap: { padding: 8, borderRadius: 9, backgroundColor: '#29211b' },
  success: { padding: 12, borderRadius: 10, backgroundColor: '#1d281b' },
  token: { alignItems: 'center', justifyContent: 'center' },
  overlay: {
    flex: 1,
    backgroundColor: '#000000aa',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 24,
    paddingBottom: 40,
    gap: 20,
    maxHeight: '92%',
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  durationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  acknowledge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
