import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Text, Button } from '../components/ui'
import { Detail, Notice, TransactionLink } from '../components/positions/Shared'
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
} from '../hooks/usePositions'
import { fetchOwnedMarketIntervals } from '../features/trading/api/rent-accounts'
import { sendReclaimRent } from '../features/trading/api/twob-client'
import { collectCloseableMarketIntervals } from '../features/trading/lib/rent'
import {
  formatAtoms,
  formatExplorerAddressUrl,
  shortenAddress,
} from '../features/trading/lib/format'
import { formatTransactionError } from '../features/trading/lib/transaction-errors'
import {
  MAINTENANCE_TRANSACTION_FEE_BUFFER_ATOMS,
  MAX_RECLAIM_RENT_ACCOUNTS_PER_TRANSACTION,
} from '../features/trading/constants'

export default function AccountScreen() {
  const wallet = useWallet()
  const client = useQueryClient()
  const active = useForeground()
  const balances = useNativeBalances(wallet.address)
  const market = useNativeMarketState()
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const [showAccounts, setShowAccounts] = useState(false)
  const [accountLimit, setAccountLimit] = useState(10)
  const [result, setResult] = useState<{
    signature: string
    reclaimedLamports: bigint
  } | null>(null)
  const busy = useRef(false)
  const ownerRef = useRef(wallet.address)
  ownerRef.current = wallet.address
  useEffect(() => {
    setError(null)
    setCopied(false)
    setResult(null)
    setShowAccounts(false)
    setAccountLimit(10)
  }, [wallet.address])
  const intervals = useQuery({
    queryKey: [...mobileKeys, 'rent-accounts', wallet.address],
    queryFn: () => fetchOwnedMarketIntervals(rpc, wallet.address!),
    enabled: active && Boolean(wallet.address),
    refetchInterval: active ? 15_000 : false,
    refetchIntervalInBackground: false,
  })
  const eligible =
    wallet.address && market.data
      ? collectCloseableMarketIntervals({
          currentSlot: market.data.currentSlot,
          endSlotInterval: market.data.endSlotInterval,
          intervalAccounts: (intervals.data ?? []).map((account) => ({
            address: account.address,
            index: account.data.index,
            lamports: account.lamports,
            market: account.data.market,
            openPositions: account.data.openPositions,
            payer: account.data.payer,
          })),
          market: mobileMarket.address,
          payer: wallet.address,
          maxAccounts: MAX_RECLAIM_RENT_ACCOUNTS_PER_TRANSACTION,
        })
      : []
  const reclaimable = eligible.reduce(
    (sum, account) => sum + account.lamports,
    0n,
  )
  const hasFees =
    balances.data !== undefined &&
    balances.data.lamports >= MAINTENANCE_TRANSACTION_FEE_BUFFER_ATOMS
  const canReclaim =
    config.transactionsEnabled &&
    Boolean(wallet.signer) &&
    hasFees &&
    eligible.length > 0 &&
    !intervals.error &&
    !market.error &&
    !balances.error &&
    !pending

  async function reclaim() {
    if (busy.current || !canReclaim || !wallet.signer || !wallet.address) return
    const owner = wallet.address
    if (ownerRef.current !== owner) return
    busy.current = true
    setPending(true)
    setError(null)
    setResult(null)
    try {
      const receipt = await sendReclaimRent({
        context: { rpc, signer: wallet.signer },
        request: {
          marketAddress: mobileMarket.address,
          maxAccounts: MAX_RECLAIM_RENT_ACCOUNTS_PER_TRANSACTION,
        },
      })
      if (ownerRef.current === owner) setResult(receipt)
      await client.invalidateQueries({ queryKey: ['mobile'] })
    } catch (cause) {
      if (ownerRef.current === owner)
        setError(formatTransactionError(cause, 'Could not reclaim rent.'))
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  async function copyAddress() {
    if (!wallet.address) return
    try {
      await Clipboard.setStringAsync(wallet.address)
      setCopied(true)
    } catch {
      setError('Could not copy your wallet address.')
    }
  }

  function openAddress(address: string) {
    void Linking.openURL(
      formatExplorerAddressUrl(address, config.rpcUrl),
    ).catch(() => setError('Could not open Solana Explorer.'))
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          tintColor={colors.accent}
          refreshing={balances.isRefetching || intervals.isRefetching}
          onRefresh={() => {
            void client.invalidateQueries({ queryKey: ['mobile'] })
          }}
        />
      }
    >
      <Text style={styles.title}>Account</Text>
      <View style={styles.card}>
        <View style={styles.walletMark}>
          <Text style={{ fontSize: 30, lineHeight: 36, color: colors.accent }}>
            ◈
          </Text>
        </View>
        {wallet.address ? (
          <>
            <Text style={styles.walletAddress} selectable>
              {shortenAddress(wallet.address, 6, 6)}
            </Text>
            <Text style={styles.small}>
              Connected with Mobile Wallet Adapter
            </Text>
            <View style={styles.row}>
              <View style={styles.half}>
                <Button
                  title={copied ? 'Address copied' : 'Copy address'}
                  variant="secondary"
                  onPress={() => {
                    void copyAddress()
                  }}
                />
              </View>
              <View style={styles.half}>
                <Button
                  title="Explorer ↗"
                  variant="ghost"
                  onPress={() => openAddress(wallet.address!)}
                />
              </View>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>
              Connect your wallet to manage balances and account rent.
            </Text>
            {!wallet.supported && (
              <Notice>
                Native wallet connections are available on Android. You can
                still explore market data on this device.
              </Notice>
            )}
            <Button
              title={wallet.isConnecting ? 'Connecting…' : 'Connect wallet'}
              disabled={wallet.isConnecting || !wallet.supported}
              onPress={() => {
                void wallet
                  .connect()
                  .catch((cause: unknown) =>
                    setError(
                      formatTransactionError(
                        cause,
                        'Could not connect wallet.',
                      ),
                    ),
                  )
              }}
            />
          </>
        )}
      </View>
      {wallet.address && (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Balances</Text>
            {balances.isPending ? (
              <ActivityIndicator color={colors.accent} />
            ) : balances.error ? (
              <Notice error>
                Could not load balances. Pull down to retry.
              </Notice>
            ) : (
              <>
                <View style={styles.balanceRow}>
                  <View style={styles.coin}>
                    <Text>◎</Text>
                  </View>
                  <View style={styles.half}>
                    <Text style={styles.asset}>Solana</Text>
                    <Text style={styles.small}>SOL</Text>
                  </View>
                  <Text style={styles.balance}>
                    {formatAtoms(balances.data?.solAtoms ?? 0n, 9)}
                  </Text>
                </View>
                <View style={styles.balanceRow}>
                  <View style={[styles.coin, { backgroundColor: '#2775ca' }]}>
                    <Text>$</Text>
                  </View>
                  <View style={styles.half}>
                    <Text style={styles.asset}>USD Coin</Text>
                    <Text style={styles.small}>USDC</Text>
                  </View>
                  <Text style={styles.balance}>
                    {formatAtoms(balances.data?.usdcAtoms ?? 0n, 6)}
                  </Text>
                </View>
                {(balances.data?.wrappedSolAtoms ?? 0n) > 0n && (
                  <Detail
                    label="Wrapped SOL included"
                    value={`${formatAtoms(balances.data!.wrappedSolAtoms, 9)} SOL`}
                  />
                )}
                <Text style={styles.small}>
                  SOL includes your associated wrapped balance. Trading reserves
                  0.02 SOL for network fees and account rent.
                </Text>
              </>
            )}
          </View>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Reclaim account rent</Text>
            <Text style={styles.subtitle}>
              Unused market interval accounts can be closed to return their SOL
              deposit to your wallet.
            </Text>
            {intervals.isPending || market.isPending ? (
              <ActivityIndicator color={colors.accent} />
            ) : intervals.error || market.error ? (
              <Notice error>
                Could not check account rent. Pull down to retry.
              </Notice>
            ) : (
              <>
                <Text style={styles.rentAmount}>
                  {formatAtoms(reclaimable, 9)}{' '}
                  <Text style={styles.small}>SOL available</Text>
                </Text>
                <Detail
                  label="Eligible accounts in this batch"
                  value={String(eligible.length)}
                />
                <Detail
                  label="Total funded accounts"
                  value={String(intervals.data?.length ?? 0)}
                />
                {!hasFees && balances.data && (
                  <Notice>
                    At least 0.001 SOL is required to pay the reclaim
                    transaction fee.
                  </Notice>
                )}
                <Button
                  title={
                    pending
                      ? 'Confirming…'
                      : eligible.length
                        ? 'Reclaim rent'
                        : 'No rent to reclaim'
                  }
                  disabled={!canReclaim}
                  onPress={() =>
                    Alert.alert(
                      'Reclaim account rent?',
                      `Close ${eligible.length} unused account${eligible.length === 1 ? '' : 's'} and reclaim approximately ${formatAtoms(reclaimable, 9)} SOL, less the network fee.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Continue',
                          onPress: () => {
                            void reclaim()
                          },
                        },
                      ],
                    )
                  }
                />
                <Button
                  title={
                    showAccounts
                      ? 'Hide funded accounts'
                      : 'View funded accounts'
                  }
                  variant="ghost"
                  onPress={() => setShowAccounts(!showAccounts)}
                />
                {showAccounts && (
                  <View style={styles.accountList}>
                    {intervals.data?.length === 0 ? (
                      <Text style={styles.small}>
                        No funded market interval accounts.
                      </Text>
                    ) : (
                      intervals.data?.slice(0, accountLimit).map((account) => (
                        <View key={account.address} style={styles.rentAccount}>
                          <Text selectable style={styles.asset}>
                            {shortenAddress(account.address, 7, 7)}
                          </Text>
                          <Detail
                            label="Interval index"
                            value={account.data.index.toString()}
                          />
                          <Detail
                            label="Open positions"
                            value={String(account.data.openPositions)}
                          />
                          <Detail
                            label="Deposit"
                            value={`${formatAtoms(account.lamports, 9)} SOL`}
                          />
                          <Detail
                            label="Market"
                            value={shortenAddress(account.data.market, 5, 5)}
                          />
                          <Button
                            title="View account ↗"
                            variant="ghost"
                            onPress={() => openAddress(account.address)}
                          />
                        </View>
                      ))
                    )}
                    {(intervals.data?.length ?? 0) > accountLimit && (
                      <Button
                        title="Show more accounts"
                        variant="secondary"
                        onPress={() => setAccountLimit(accountLimit + 10)}
                      />
                    )}
                  </View>
                )}
              </>
            )}
            {result && (
              <>
                <Notice>{`Reclaimed ${formatAtoms(result.reclaimedLamports, 9)} SOL. Transaction confirmed.`}</Notice>
                <TransactionLink
                  signature={result.signature}
                  onError={setError}
                />
              </>
            )}
          </View>
        </>
      )}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>About Mato</Text>
        <Detail label="Network" value="Solana mainnet" />
        <Detail label="Market" value="SOL / USDC" />
        <Detail
          label="Trading"
          value={config.transactionsEnabled ? 'Enabled' : 'Read-only'}
        />
        <Detail label="Wallet protocol" value="Solana Mobile Wallet Adapter" />
        <Text style={styles.small}>
          Continuous clearing auctions. Orders stream over time, with execution
          depending on opposing liquidity.
        </Text>
        <Button
          title="View program ↗"
          variant="ghost"
          onPress={() => openAddress(config.programId)}
        />
      </View>
      {wallet.address && (
        <Button
          title="Disconnect wallet"
          variant="danger"
          disabled={pending}
          onPress={() => {
            void wallet
              .disconnect()
              .catch((cause: unknown) =>
                setError(
                  formatTransactionError(cause, 'Could not disconnect wallet.'),
                ),
              )
          }}
        />
      )}
      {error && <Notice error>{error}</Notice>}
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
    color: colors.accent,
    fontSize: 10,
    letterSpacing: 2,
    marginTop: 12,
  },
  title: { fontSize: 32, lineHeight: 40, fontWeight: '500', letterSpacing: -1 },
  subtitle: { fontSize: 13, color: colors.muted, lineHeight: 21 },
  small: { fontSize: 11, color: colors.muted, lineHeight: 18 },
  card: {
    padding: 20,
    gap: 16,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
  },
  walletMark: {
    backgroundColor: colors.elevated,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletAddress: {
    fontSize: 23,
    lineHeight: 30,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  sectionTitle: { fontSize: 18, fontWeight: '500' },
  row: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 5,
  },
  coin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#282331',
  },
  asset: { fontSize: 14, fontWeight: '500' },
  balance: { fontSize: 20, fontVariant: ['tabular-nums'] },
  rentAmount: {
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  accountList: { gap: 12 },
  rentAccount: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 14,
    gap: 4,
  },
  footer: {
    color: colors.muted,
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: 16,
  },
})
