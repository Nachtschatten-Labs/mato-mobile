import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftRight,
  ChartNoAxesCombined,
  ChartCandlestick,
  ChevronDown,
  Info,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from 'lucide-react-native'
import * as Haptics from 'expo-haptics'
import {
  Button,
  Card,
  ErrorNotice,
  Label,
  Row,
  Screen,
  Text,
} from '@/components/ui'
import PositionsScreen from './PositionsScreen'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PriceChart } from '@/components/PriceChart'
import { Drawer } from '@/components/Drawer'
import { DesignBackdrop } from '@/components/DesignBackdrop'
import { useToast } from '@/components/Toast'
import { isWalletCancellation } from '@/wallet/errors'
import { PairLogo, TokenLogo } from '@/components/TokenLogo'
import { TradeDurationCurve } from '@/components/TradeDurationCurve'
import {
  groupTradeAmount,
  editTradeAmount,
  tradeDuration,
  tradeFinish,
  tradePriceImpact,
  tradeTimeLeft,
} from '@/features/trading/lib/mobile-trade-presentation'
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
import {
  NATIVE_FEE_BUFFER_ATOMS,
  type OrderSide,
} from '@/features/trading/constants'
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
} from '@/features/trading/lib/amounts'
import { recommendDurationSlots } from '@/features/trading/lib/duration'
import {
  computePriceImpactPercent,
  isHighPriceImpact,
} from '@/features/trading/lib/price-impact'
import { marketPriceFromFlows } from '@/features/trading/lib/market'
import { formatAtoms, shortenAddress } from '@/features/trading/lib/format'
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
  const { showToast } = useToast()
  const screenRef = useRef<ScrollView>(null)
  const amountRef = useRef<TextInput>(null)
  const insets = useSafeAreaInsets()
  const foreground = useForeground()
  const queryClient = useQueryClient()
  const stateQuery = useNativeMarketState()
  const balances = useNativeBalances(wallet.address)
  const [range, setRange] = useState<keyof typeof ranges>('1H')
  const [chartMode, setChartMode] = useState<'line' | 'candles'>('line')
  const [panel, setPanel] = useState<'chart' | 'book'>('chart')
  const [side, setSide] = useState<OrderSide>('buy')
  const [amount, setAmount] = useState('')
  const [smart, setSmart] = useState(true)
  const [seconds, setSeconds] = useState(300)
  const [durationOpen, setDurationOpen] = useState(false)
  const [draftSeconds, setDraftSeconds] = useState(300)
  const [marketsOpen, setMarketsOpen] = useState(false)
  const [marketSearch, setMarketSearch] = useState('')
  const [rateOpen, setRateOpen] = useState(false)
  const [inverseRate, setInverseRate] = useState(false)
  const [durationInfo, setDurationInfo] = useState(false)
  const [amountFocused, setAmountFocused] = useState(false)
  const [orderReview, setOrderReview] = useState<OrderReview | null>(null)
  const currentWallet = useRef(wallet.address)
  currentWallet.current = wallet.address
  useEffect(() => {
    setOrderReview(null)
    setAcknowledged(false)
  }, [wallet.address])
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
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
  const firstPrice = candles.data?.[0]?.open
  const rangePrice = priceValue ?? candles.data?.at(-1)?.close ?? null
  const change =
    rangePrice && firstPrice
      ? ((rangePrice - firstPrice) / firstPrice) * 100
      : null
  const dailyFirst = daily.data
    ?.filter((c) => c.time * 1000 <= Date.now() - 24 * 60 * 60_000)
    .at(-1)?.close
  const dailyChange =
    priceValue && dailyFirst
      ? ((priceValue - dailyFirst) / dailyFirst) * 100
      : null
  const durationLabel =
    durationSlots === null
      ? 'Choose duration'
      : tradeDuration(durationSlots * 0.2, true)
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
    setSmart(true)
    setDurationInfo(false)
    setAmount('')
    setError(null)
  }
  function review() {
    setError(null)
    if (!wallet.address) {
      void wallet.connect().catch(() => {})
      return
    }
    if (stale) {
      setError('Refresh market data before starting a stream.')
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
        throw new Error('Your wallet changed. Review the stream again.')
    }
    pendingRef.current = true
    setPending(true)
    setError(null)
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
        setAmount('')
      }
      showToast({
        title: 'Stream started',
        description: `${reviewedBuy ? 'Buying SOL with' : 'Selling'} ${groupTradeAmount(formatAtomsToInput(reviewed.atoms, reviewedBuy ? 6 : 9))} ${reviewedBuy ? 'USDC' : 'SOL'} over ${tradeDuration(reviewed.durationSlots * 0.2)}. You can send what it ${reviewedBuy ? 'buys' : 'gets'} to your wallet any time.`,
        signature: result,
      })
      setOrderReview(null)
      void queryClient.invalidateQueries({ queryKey: ['mobile'] })
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {})
    } catch (e) {
      const message = formatTransactionError(e, 'Unable to start this stream.')
      const declined =
        isWalletCancellation(e) || message === 'Wallet request cancelled.'
      setError(declined ? null : message)
      showToast({
        title: declined ? 'Request declined' : 'Could not start stream',
        description: declined
          ? 'You declined it in your wallet. Nothing changed.'
          : message,
        tone: 'error',
      })
      setOrderReview(null)
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['mobile'] })
  }

  const hasAmount = atoms !== null && atoms > 0n
  const tooSmall = hasAmount && atoms < minimum
  const tooLarge = atoms !== null && available !== null && atoms > available
  const needsSol =
    wallet.address &&
    balances.data &&
    balances.data.lamports < NATIVE_FEE_BUFFER_ATOMS
  const outputBalance = balances.data
    ? isBuy
      ? balances.data.solAtoms
      : balances.data.usdcAtoms
    : null
  const amountDollars = hasAmount
    ? (Number(atoms) / 10 ** decimals) * (isBuy ? 1 : (priceValue ?? 0))
    : null
  const receiveDollars =
    receive === null ? null : receive * (isBuy ? (priceValue ?? 0) : 1)
  const impactDollars =
    amountDollars !== null && receiveDollars !== null
      ? Math.max(0, amountDollars - receiveDollars)
      : null
  const draftSlots = durationToSlots(draftSeconds)
  const draftImpact = computePriceImpactPercent({
    amountAtoms: atoms,
    side,
    streamingState: state,
    durationSlots: draftSlots,
  })
  const draftExecution =
    indicative && draftImpact !== null
      ? indicative * (1 + (isBuy ? draftImpact : -draftImpact) / 100)
      : null
  const draftReceive =
    draftExecution && atoms
      ? (Number(atoms) / 10 ** decimals) *
        (isBuy ? 1 / draftExecution : draftExecution)
      : null
  const draftValid =
    atoms !== null && atoms >= BigInt(draftSlots + 5) && draftImpact !== null
  const buttonTitle = !wallet.supported
    ? 'Open on Android to connect'
    : !wallet.address
      ? 'Connect wallet to stream'
      : !config.transactionsEnabled
        ? 'Trading disabled in preview'
        : needsSol
          ? 'Add SOL to stream'
          : !hasAmount
            ? 'Enter amount'
            : tooSmall
              ? `Enter at least ${formatAtoms(minimum, decimals)} ${inputToken}`
              : tooLarge
                ? `Not enough ${inputToken}`
                : state?.isPaused
                  ? 'Market paused'
                  : !hasLiquidity
                    ? 'Waiting for liquidity'
                    : available === null
                      ? 'Loading wallet balances'
                      : durationSlots === null
                        ? 'Choose duration'
                        : `${isBuy ? 'Buy' : 'Sell'} over the next ${durationLabel}`
  const openDuration = () => {
    setDraftSeconds(durationSlots === null ? seconds : durationSlots * 0.2)
    setDurationOpen(true)
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen
        ref={screenRef}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) }}
        refreshControl={
          <RefreshControl
            tintColor={colors.accent}
            refreshing={price.isRefetching && candles.isRefetching}
            onRefresh={refresh}
          />
        }
      >
        <View style={{ position: 'relative' }}>
          <DesignBackdrop />
          <Card style={s.tradePanel}>
            <View style={s.sideControl}>
              {(['buy', 'sell'] as const).map((value) => (
                <Pressable
                  key={value}
                  onPress={() => changeSide(value)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: side === value }}
                  style={[s.sideButton, side === value && s.sideSelected]}
                >
                  <Text
                    style={{
                      color: side === value ? colors.text : colors.muted,
                      fontSize: 16,
                    }}
                  >
                    {value === 'buy' ? 'Buy' : 'Sell'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View
              style={[
                s.amountBox,
                amountFocused && { borderColor: colors.controlBorder },
              ]}
            >
              <Row style={s.boxHeader}>
                <Label>{isBuy ? 'Buy with' : 'Sell'}</Label>
                {wallet.address && (
                  <Label>
                    Balance{' '}
                    <Text style={s.balance}>
                      {available === null
                        ? '—'
                        : displayAtoms(available, decimals, isBuy ? 2 : 3)}
                    </Text>
                  </Label>
                )}
              </Row>
              <Row style={{ gap: 8 }}>
                <GroupedAmountInput
                  inputRef={amountRef}
                  onRejected={setError}
                  value={amount}
                  decimals={decimals}
                  onChange={(value) => {
                    setAmount(value)
                    setError(null)
                  }}
                  token={inputToken}
                  over={tooLarge}
                  onFocus={() => setAmountFocused(true)}
                  onBlur={() => setAmountFocused(false)}
                />
                <View style={s.token}>
                  <TokenLogo symbol={inputToken} size={20} />
                  <Text style={{ fontSize: 16 }}>{inputToken}</Text>
                </View>
              </Row>
              {(hasAmount || wallet.address) && (
                <View style={s.amountFooter}>
                  <Text
                    style={[s.dollars, tooSmall && { color: colors.negative }]}
                  >
                    {tooSmall
                      ? `Minimum ${formatAtoms(minimum, decimals)} ${inputToken}`
                      : amountDollars !== null && (isBuy || priceValue !== null)
                        ? `≈$${decimal(amountDollars, 2)}`
                        : ''}
                  </Text>
                  {wallet.address && (
                    <View style={s.inline}>
                      {[25, 50, 75, 100].map((percent) => {
                        const precision =
                          10n ** BigInt(decimals - (isBuy ? 2 : 3))
                        const chipAtoms =
                          available === null
                            ? null
                            : (atomsFromPercent(available, percent) /
                                precision) *
                              precision
                        const selected = hasAmount && atoms === chipAtoms
                        return (
                          <Pressable
                            key={percent}
                            accessibilityRole="button"
                            accessibilityState={{
                              selected,
                              disabled: available === null,
                            }}
                            accessibilityLabel={`Use ${percent} percent of available balance`}
                            disabled={available === null}
                            onPress={() => {
                              setAmount(
                                formatAtomsToInput(chipAtoms!, decimals),
                              )
                              setError(null)
                            }}
                            style={[
                              s.percent,
                              selected && { borderColor: colors.controlBorder },
                            ]}
                          >
                            <Text
                              style={[
                                s.percentText,
                                selected && { color: colors.text },
                              ]}
                            >
                              {percent === 100 ? 'Max' : `${percent}%`}
                            </Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  )}
                </View>
              )}
            </View>
            <View style={s.duration}>
              {hasAmount ? (
                <>
                  <View style={[s.inline, { flexWrap: 'wrap', gap: 8 }]}>
                    <Label>Over the next</Label>
                    <Pressable
                      onPress={openDuration}
                      accessibilityRole="button"
                      accessibilityLabel={`Customize duration, ${durationLabel}`}
                      style={s.durationPill}
                    >
                      <Text style={s.small}>{durationLabel}</Text>
                      <SlidersHorizontal size={14} color={colors.iconStrong} />
                    </Pressable>
                    {!smart && (
                      <Pressable
                        onPress={() => setSmart(true)}
                        accessibilityRole="button"
                        accessibilityLabel="Back to mato's pick"
                        hitSlop={10}
                      >
                        <RotateCcw size={16} color={colors.icon} />
                      </Pressable>
                    )}
                  </View>
                  <View style={[s.inline, { gap: 8 }]}>
                    <Text style={[s.small, { color: colors.secondary }]}>
                      {durationSlots === null
                        ? 'Set a duration to estimate your stream.'
                        : tradeFinish(durationSlots * 0.2)}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="About this duration"
                      onPress={() => setDurationInfo(!durationInfo)}
                      hitSlop={10}
                    >
                      <Info size={16} color={colors.icon} />
                    </Pressable>
                  </View>
                </>
              ) : (
                <View style={s.inline}>
                  <Label>Duration</Label>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="About stream duration"
                    onPress={() => setDurationInfo(!durationInfo)}
                    hitSlop={10}
                  >
                    <Info size={16} color={colors.icon} />
                  </Pressable>
                </View>
              )}
              {durationInfo && (
                <Text style={s.durationExplanation}>
                  {!hasAmount
                    ? `Your ${side} streams over time instead of filling all at once.`
                    : smart
                      ? `Mato keeps ${isBuy ? 'buying' : 'selling'} in small pieces. The duration targets less than 0.01% price impact using current liquidity. Price can move while the stream runs.`
                      : 'The faster it trades, the more it moves the price against you. Slower means less price impact, but more time for the price to move.'}
                </Text>
              )}
            </View>
            <View style={s.receiveBox}>
              <Row style={s.boxHeader}>
                <Label>Est. receive</Label>
                {wallet.address && (
                  <Label>
                    Balance{' '}
                    <Text style={s.balance}>
                      {outputBalance === null
                        ? '—'
                        : displayAtoms(
                            outputBalance,
                            isBuy ? 9 : 6,
                            isBuy ? 3 : 2,
                          )}
                    </Text>
                  </Label>
                )}
              </Row>
              <Row>
                <Text
                  style={[
                    s.receive,
                    receive === null && { color: colors.faint },
                  ]}
                >
                  {receive === null
                    ? hasAmount
                      ? '—'
                      : '0'
                    : decimal(receive, isBuy ? 3 : 2)}
                </Text>
                <View style={s.token}>
                  <TokenLogo symbol={outputToken} size={20} />
                  <Text style={{ fontSize: 16 }}>{outputToken}</Text>
                </View>
              </Row>
              {receiveDollars !== null && (priceValue !== null || !isBuy) && (
                <Text style={s.dollars}>≈${decimal(receiveDollars, 2)}</Text>
              )}
            </View>
            <View style={{ gap: 12 }}>
              <Text style={s.rate}>
                1 SOL ≈{' '}
                <Text style={s.small}>
                  {priceValue === null ? '—' : decimal(priceValue, 2)}
                </Text>{' '}
                USDC
              </Text>
              {hasAmount && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: rateOpen }}
                  onPress={() => setRateOpen(!rateOpen)}
                  style={s.inline}
                >
                  <Label>Impact</Label>
                  <Text
                    style={[
                      s.small,
                      isHighPriceImpact(impact) && { color: colors.negative },
                    ]}
                  >
                    {tradePriceImpact(impact)}
                  </Text>
                  <ChevronDown
                    size={14}
                    color={colors.icon}
                    style={{
                      transform: [{ rotate: rateOpen ? '180deg' : '0deg' }],
                    }}
                  />
                </Pressable>
              )}
              {rateOpen && hasAmount && (
                <View style={s.rateDetails}>
                  <Row style={{ flexWrap: 'wrap' }}>
                    <Label>Rate</Label>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Flip rate"
                      onPress={() => setInverseRate(!inverseRate)}
                      style={[s.inline, { gap: 8 }]}
                    >
                      <Text style={s.small}>
                        {priceValue === null
                          ? '—'
                          : inverseRate
                            ? `1 USDC ≈ ${decimal(1 / priceValue, 6)} SOL`
                            : `1 SOL ≈ ${decimal(priceValue, 4)} USDC`}
                      </Text>
                      <ArrowLeftRight size={14} color={colors.iconStrong} />
                    </Pressable>
                  </Row>
                  <Row style={{ flexWrap: 'wrap' }}>
                    <Label>Price impact</Label>
                    <Text
                      style={[
                        s.small,
                        isHighPriceImpact(impact) && { color: colors.negative },
                      ]}
                    >
                      {tradePriceImpact(impact)}
                      {impactDollars !== null
                        ? ` · ≈$${decimal(impactDollars, 2)}`
                        : ''}
                    </Text>
                  </Row>
                  <Row style={{ flexWrap: 'wrap' }}>
                    <Label>Est. execution price</Label>
                    <Text style={s.small}>
                      {execution === null
                        ? '—'
                        : `${decimal(execution, 4)} USDC`}
                    </Text>
                  </Row>
                </View>
              )}
            </View>
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
            {needsSol && (
              <View style={s.caution}>
                <Text style={s.noticeTitle}>Add SOL for network fees</Text>
                <Text style={s.small}>
                  Your wallet has {formatAtoms(balances.data!.lamports, 9, 4)}{' '}
                  SOL. A stream needs about{' '}
                  {formatAtoms(NATIVE_FEE_BUFFER_ATOMS, 9)} SOL to start.
                </Text>
              </View>
            )}
            {error && <ErrorNotice message={error} />}
            <View style={{ gap: 12 }}>
              <Button
                title={buttonTitle}
                onPress={review}
                loading={pending || wallet.isConnecting}
                disabled={
                  !wallet.supported ||
                  Boolean(
                    wallet.address &&
                    (!config.transactionsEnabled ||
                      !hasAmount ||
                      tooSmall ||
                      tooLarge ||
                      needsSol ||
                      state?.isPaused ||
                      !hasLiquidity ||
                      available === null),
                  )
                }
              />
              {hasAmount && (
                <Text style={s.note}>
                  Estimate from liquidity right now. Price can move while the
                  stream runs.
                </Text>
              )}
            </View>
          </Card>
        </View>
        <Card style={s.chartCard}>
          <Row style={{ justifyContent: 'flex-start', gap: 12 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Select market, SOL / USDC"
              onPress={() => {
                setMarketSearch('')
                setMarketsOpen(true)
              }}
              style={s.marketPicker}
            >
              <PairLogo />
              <Text style={s.marketName}>SOL / USDC</Text>
              <ChevronDown size={15} color={colors.icon} />
            </Pressable>
            <Text style={s.price}>
              {priceValue === null ? '—' : decimal(priceValue, 2)}
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
            {signedChange(change)}{' '}
            <Text style={[s.small, { color: colors.muted }]}>
              {range === '1H' ? '1h' : range === '1D' ? '24h' : '7d'}
            </Text>
          </Text>
          <View style={s.chartControls}>
            {panel === 'chart' && (
              <View style={s.inline}>
                {(Object.keys(ranges) as Array<keyof typeof ranges>).map(
                  (value) => (
                    <Chip
                      key={value}
                      title={value}
                      selected={range === value}
                      onPress={() => setRange(value)}
                    />
                  ),
                )}
              </View>
            )}
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
          </View>
          {panel === 'chart' ? (
            <>
              {candles.isPending ? (
                <View style={s.chartLoading}>
                  <ActivityIndicator color={colors.chart} />
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${chartMode === 'line' ? 'candlestick' : 'line'} chart`}
                onPress={() =>
                  setChartMode(chartMode === 'line' ? 'candles' : 'line')
                }
                style={s.chartMode}
              >
                {chartMode === 'line' ? (
                  <ChartCandlestick size={15} color={colors.icon} />
                ) : (
                  <ChartNoAxesCombined size={15} color={colors.icon} />
                )}
                <Label>{chartMode === 'line' ? 'Candles' : 'Line'}</Label>
              </Pressable>
            </>
          ) : (
            <OrderBook
              data={book.data ?? []}
              loading={book.isPending}
              error={book.isError}
              currentSlot={state?.currentSlot}
              walletAddress={wallet.address}
              price={priceValue}
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
        <PositionsScreen
          embedded
          onStart={() => {
            screenRef.current?.scrollTo({ y: 0, animated: true })
            amountRef.current?.focus()
          }}
        />
      </Screen>
      <Drawer
        visible={durationOpen}
        title="Customize duration"
        onClose={() => setDurationOpen(false)}
      >
        <Row style={{ flexWrap: 'wrap' }}>
          <Text style={s.durationReadout}>{tradeDuration(draftSeconds)}</Text>
          <Text
            style={[
              s.impactReadout,
              isHighPriceImpact(draftImpact) && { color: colors.negative },
            ]}
          >
            {tradePriceImpact(draftImpact)} impact
          </Text>
        </Row>
        {draftImpact !== null ? (
          <TradeDurationCurve
            value={draftSeconds}
            pick={recommended === null ? null : recommended * 0.2}
            onChange={setDraftSeconds}
            amountAtoms={atoms}
            side={side}
            streamingState={state}
          />
        ) : (
          <View style={s.chartLoading}>
            {stateQuery.isPending && <ActivityIndicator color={colors.chart} />}
            <Text style={s.note}>
              {stateQuery.isPending
                ? 'Loading market liquidity…'
                : 'Market liquidity is unavailable. Refresh it before choosing a duration.'}
            </Text>
            {!stateQuery.isPending && (
              <Button
                title="Refresh market"
                variant="ghost"
                onPress={() => {
                  void stateQuery.refetch()
                }}
              />
            )}
          </View>
        )}
        <Text style={s.note}>
          Slower means less price impact, but more time for the price to move.
        </Text>
        <View style={s.ticket}>
          <Row>
            <Label>{isBuy ? 'Buy with' : 'Sell'}</Label>
            <Text style={s.small}>
              {groupTradeAmount(amount || '0')} {inputToken}
            </Text>
          </Row>
          <Row style={{ flexWrap: 'wrap' }}>
            <Label>Est. receive</Label>
            <Text style={s.small}>
              {draftReceive === null
                ? '—'
                : decimal(draftReceive, isBuy ? 3 : 2)}{' '}
              {outputToken}{' '}
              <Text style={s.rate}>({tradePriceImpact(draftImpact)})</Text>
            </Text>
          </Row>
        </View>
        {!draftValid && draftImpact !== null && (
          <Label>This amount is too small for this duration.</Label>
        )}
        <Button
          title={`Use ${tradeDuration(draftSeconds)}`}
          disabled={!draftValid}
          onPress={() => {
            setSeconds(draftSeconds)
            setSmart(recommended !== null && draftSlots === recommended)
            setDurationOpen(false)
          }}
        />
        {recommended !== null && draftSlots !== recommended && (
          <Button
            title={`Reset to ${tradeDuration(recommended * 0.2)}`}
            variant="ghost"
            onPress={() => setDraftSeconds(recommended * 0.2)}
          />
        )}
      </Drawer>
      <Drawer
        visible={marketsOpen}
        title="Markets"
        onClose={() => setMarketsOpen(false)}
      >
        <View style={s.search}>
          <Search size={17} color={colors.icon} />
          <TextInput
            accessibilityLabel="Search markets"
            placeholder="Search markets"
            placeholderTextColor={colors.muted}
            value={marketSearch}
            onChangeText={setMarketSearch}
            autoCapitalize="none"
            style={s.searchInput}
          />
        </View>
        <Row style={{ paddingHorizontal: 10 }}>
          <Label style={{ flex: 1 }}>Market</Label>
          <Label style={{ width: 66, textAlign: 'right' }}>Price</Label>
          <Label style={{ width: 55, textAlign: 'right' }}>24h</Label>
        </Row>
        {'sol solana usdc'.includes(marketSearch.trim().toLowerCase()) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: true }}
            onPress={() => setMarketsOpen(false)}
            style={s.marketResult}
          >
            <PairLogo />
            <View style={{ flex: 1 }}>
              <Text>SOL / USDC</Text>
              <Label>Solana</Label>
            </View>
            <Text style={s.small}>
              {priceValue === null ? '—' : decimal(priceValue, 2)}
            </Text>
            <Text
              style={[
                s.small,
                {
                  width: 55,
                  textAlign: 'right',
                  color:
                    dailyChange === null
                      ? colors.muted
                      : dailyChange >= 0
                        ? colors.positive
                        : colors.negative,
                },
              ]}
            >
              {signedChange(dailyChange)}
            </Text>
          </Pressable>
        ) : (
          <Text style={s.note}>No markets match “{marketSearch}”.</Text>
        )}
      </Drawer>
      <Drawer
        visible={orderReview !== null}
        title={`Review ${orderReview?.side ?? side} stream`}
        dismissible={!pending}
        onClose={() => {
          if (!pending) setOrderReview(null)
        }}
      >
        <View style={s.ticket}>
          <Row>
            <Label>You pay</Label>
            <Text>
              {orderReview
                ? groupTradeAmount(
                    formatAtomsToInput(
                      orderReview.atoms,
                      orderReview.side === 'buy' ? 6 : 9,
                    ),
                  )
                : '—'}{' '}
              {orderReview?.side === 'buy' ? 'USDC' : 'SOL'}
            </Text>
          </Row>
          <Row>
            <Label>Duration</Label>
            <Text>
              {orderReview
                ? tradeDuration(orderReview.durationSlots * 0.2)
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
              {tradePriceImpact(orderReview?.impact ?? null)}
            </Text>
          </Row>
        </View>
        <Label>Wallet · {shortenAddress(orderReview?.authority, 8, 6)}</Label>
        {isHighPriceImpact(orderReview?.impact ?? null) && (
          <ErrorNotice message="This stream has more than 1% estimated price impact. A smaller amount or longer duration may reduce it." />
        )}
        <Text style={{ color: colors.secondary }}>
          Mato is experimental. Liquidity is low and the contracts have not been
          fully audited. You can lose some or all of your funds. Streams have no
          guaranteed execution price.
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
            I understand the risks and approve this stream.
          </Text>
        </Pressable>
        <Button
          title={pending ? 'Approve in wallet' : 'Confirm in wallet'}
          onPress={() => {
            void submit()
          }}
          disabled={!acknowledged || !config.transactionsEnabled}
          loading={pending}
        />
      </Drawer>
    </KeyboardAvoidingView>
  )
}

function decimal(value: number, digits: number) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}
function displayAtoms(value: bigint, decimals: number, digits: number) {
  const [whole, fraction = ''] = formatAtoms(value, decimals, digits).split('.')
  return groupTradeAmount(`${whole}.${fraction.padEnd(digits, '0')}`)
}
function signedChange(value: number | null) {
  return value === null
    ? '—'
    : `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}%`
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
function GroupedAmountInput({
  inputRef,
  value,
  onRejected,
  onChange,
  decimals,
  token,
  over,
  onFocus,
  onBlur,
}: {
  inputRef: RefObject<TextInput | null>
  onRejected: (message: string) => void
  value: string
  onChange: (value: string) => void
  decimals: number
  token: string
  over: boolean
  onFocus: () => void
  onBlur: () => void
}) {
  const selection = useRef({
    start: groupTradeAmount(value).length,
    end: groupTradeAmount(value).length,
  })
  return (
    <TextInput
      ref={inputRef}
      accessibilityLabel={`Amount to pay in ${token}`}
      keyboardType="decimal-pad"
      inputMode="decimal"
      value={groupTradeAmount(value)}
      onChangeText={(text) => {
        const edited = editTradeAmount(value, text, decimals, selection.current)
        onChange(edited.value)
        if (edited.error) onRejected(edited.error)
        requestAnimationFrame(() =>
          inputRef.current?.setNativeProps({
            selection: { start: edited.caret, end: edited.caret },
          }),
        )
      }}
      onSelectionChange={(event) => {
        selection.current = event.nativeEvent.selection
      }}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholder="0"
      placeholderTextColor={colors.faint}
      maxLength={32}
      style={[s.amountInput, over && { color: colors.negative }]}
    />
  )
}
function OrderBook({
  data,
  loading,
  error,
  currentSlot,
  walletAddress,
  price,
}: {
  data: Awaited<ReturnType<typeof fetchMarketTradePositions>>
  loading: boolean
  error: boolean
  currentSlot?: number
  walletAddress: string | null
  price: number | null
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
    return <ActivityIndicator color={colors.chart} style={{ height: 160 }} />
  if (error) return <ErrorNotice message="Unable to load the order book." />
  return (
    <View style={{ gap: 14 }}>
      <View style={s.inline}>
        {(['all', 'buy', 'sell'] as const).map((value) => (
          <Chip
            key={value}
            title={value[0].toUpperCase() + value.slice(1)}
            selected={filter === value}
            onPress={() => {
              setFilter(value)
              setLimit(10)
            }}
          />
        ))}
      </View>
      <Row>
        <Label style={{ width: 48 }}>Side</Label>
        <Label style={{ flex: 1 }}>Size</Label>
        <Label>Ends in</Label>
      </Row>
      {rows.length === 0 ? (
        <Text style={[s.note, { paddingVertical: 28 }]}>
          {filter === 'all'
            ? 'No streams are running in this market yet.'
            : `No ${filter} streams are running in this market.`}
        </Text>
      ) : (
        rows.slice(0, limit).map((p) => {
          const buy = isBuyTradePosition(p.data)
          const dollars =
            (Number(p.data.amount) / 10 ** (buy ? 6 : 9)) *
            (buy ? 1 : (price ?? 0))
          return (
            <Row key={p.address} style={s.bookRow}>
              <View style={{ width: 48 }}>
                <Text
                  style={[
                    s.small,
                    { color: buy ? colors.positive : colors.negative },
                  ]}
                >
                  {buy ? 'Buy' : 'Sell'}
                </Text>
                {walletAddress === p.data.authority && <Label>You</Label>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.small}>
                  {displayAtoms(p.data.amount, buy ? 6 : 9, buy ? 2 : 3)}{' '}
                  {buy ? 'USDC' : 'SOL'}
                </Text>
                {(buy || price !== null) && (
                  <Label>≈${decimal(dollars, 2)}</Label>
                )}
              </View>
              <Text style={s.small}>
                {currentSlot === undefined
                  ? '—'
                  : tradeTimeLeft(
                      Number(
                        getTradePositionEndSlot(p.data) - BigInt(currentSlot),
                      ) * 0.2,
                    )}
              </Text>
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
  tradePanel: { padding: 20, gap: 20 },
  sideControl: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: 28,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sideButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    minHeight: 36,
  },
  sideSelected: {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.controlBorder,
  },
  amountBox: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 15,
    borderRadius: 8,
    gap: 10,
  },
  boxHeader: { flexWrap: 'wrap', gap: 4 },
  balance: { fontSize: 14, color: colors.secondary },
  amountInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.regular,
    fontVariant: ['tabular-nums'],
    fontSize: 26,
    color: colors.text,
    padding: 0,
    minHeight: 34,
  },
  amountFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: -6,
  },
  dollars: { color: colors.secondary, fontSize: 14, lineHeight: 21 },
  inline: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  token: { flexDirection: 'row', gap: 6, alignItems: 'center', flexShrink: 0 },
  percent: {
    paddingVertical: 2,
    paddingHorizontal: 7,
    minHeight: 25,
    justifyContent: 'center',
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
  },
  percentText: { color: colors.secondary, fontSize: 12, lineHeight: 18 },
  duration: { paddingHorizontal: 16, paddingVertical: 4, gap: 12 },
  durationPill: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 2,
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  durationExplanation: {
    fontSize: 14,
    color: colors.secondary,
    lineHeight: 21,
    paddingTop: 4,
  },
  receiveBox: {
    padding: 15,
    borderRadius: 8,
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  receive: { fontFamily: fonts.regular, fontSize: 26, lineHeight: 34, flex: 1 },
  rate: { fontSize: 14, color: colors.muted, lineHeight: 21 },
  small: { fontSize: 14, lineHeight: 21 },
  rateDetails: {
    backgroundColor: colors.elevated,
    borderRadius: 8,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  note: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  caution: {
    borderWidth: 1,
    borderColor: colors.caution,
    padding: 14,
    borderRadius: 8,
    gap: 4,
  },
  noticeTitle: {
    fontFamily: fonts.medium,
    color: colors.caution,
    fontSize: 14,
  },
  success: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  chartCard: { padding: 16, gap: 8 },
  marketPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  marketName: { fontSize: 16 },
  price: { fontSize: 16, lineHeight: 24 },
  priceChange: { fontSize: 14, lineHeight: 21 },
  chartControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 4,
  },
  chartMode: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    alignSelf: 'flex-end',
    paddingVertical: 3,
  },
  chip: {
    borderRadius: 20,
    paddingVertical: 3,
    paddingHorizontal: 10,
    minHeight: 28,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selectedChip: {
    backgroundColor: colors.elevated,
    borderColor: colors.border,
  },
  chipText: { fontSize: 14, color: colors.muted, lineHeight: 21 },
  chartLoading: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  durationReadout: { fontSize: 32, lineHeight: 42 },
  impactReadout: { fontSize: 16, color: colors.secondary },
  ticket: {
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    gap: 12,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    minHeight: 40,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 16,
  },
  marketResult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  bookRow: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
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
