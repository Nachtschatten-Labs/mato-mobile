import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import * as SecureStore from 'expo-secure-store'
import {
  createSolanaMainnet,
  MobileWalletProvider,
  transact,
  useMobileWallet,
} from '@wallet-ui/react-native-kit'
import type { TransactionSendingSigner } from '@solana/kit'
import { config } from '../config'
import { WalletContext } from './context'
import { createSecureAuthorizationCache } from './secure-cache'
import { acquireWalletOperation } from './operation-lock'
import { validateWalletSignatures } from './signatures'
import {
  isAuthorizationExpired,
  isWalletCancellation,
  walletErrorMessage,
} from './errors'
export { useWallet } from './context'

const identity = {
  name: 'Mato',
  uri: 'https://mato.markets',
  icon: 'icon-192.png',
}
const cache = createSecureAuthorizationCache(SecureStore)
const cluster = createSolanaMainnet({ url: config.rpcUrl })

function WalletBridge({ children }: PropsWithChildren) {
  const mobile = useMobileWallet()
  const latest = useRef(mobile)
  latest.current = mobile
  const generation = useRef(0)
  const disconnected = useRef(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    disconnected.current = false
    return () => {
      // An old callback must not submit after the provider has been replaced.
      ++generation.current
      disconnected.current = true
    }
  }, [])

  const invalidate = useCallback(async () => {
    disconnected.current = true
    setHidden(true)
    await latest.current.disconnect()
  }, [])

  const connect = useCallback(async () => {
    const release = acquireWalletOperation()
    if (!release) return
    const request = ++generation.current
    setIsConnecting(true)
    setError(null)
    try {
      await latest.current.connect()
      if (request !== generation.current) {
        await invalidate()
        return
      }
      disconnected.current = false
      setHidden(false)
    } catch (failure) {
      if (request !== generation.current) {
        await invalidate()
        return
      }
      if (isAuthorizationExpired(failure)) await invalidate()
      if (!isWalletCancellation(failure)) setError(walletErrorMessage(failure))
      if (!isWalletCancellation(failure))
        throw new Error(walletErrorMessage(failure))
    } finally {
      release()
      setIsConnecting(false)
    }
  }, [invalidate])

  const disconnect = useCallback(async () => {
    ++generation.current
    setIsConnecting(false)
    setError(null)
    const token = latest.current.store.$authToken.get()
    // Acquire before awaiting local storage. Otherwise another screen could
    // begin signing while disconnect is awaiting its SecureStore deletion.
    const release = acquireWalletOperation()
    // Local invalidation happens first and is unconditional. A cancelled or
    // unavailable wallet must never retain an apparently connected UI.
    try {
      await invalidate()
    } catch {
      release?.()
      const message =
        'Could not remove the saved wallet connection. Please disconnect again.'
      setError(message)
      throw new Error(message)
    }
    if (!token || !release) {
      release?.()
      return
    }
    try {
      await transact((wallet) => wallet.deauthorize({ auth_token: token }))
    } catch {
      // Local authorization has already been removed. The user can also revoke
      // the app from the wallet itself if that wallet was unavailable here.
    } finally {
      release()
    }
  }, [invalidate])

  const account = hidden ? undefined : mobile.account
  const signer = useMemo<TransactionSendingSigner | null>(() => {
    if (!account) return null
    const expectedAddress = account.address
    return {
      address: expectedAddress,
      async signAndSendTransactions(transactions, options) {
        const release = acquireWalletOperation()
        if (!release)
          throw new Error('Finish the current wallet request first.')
        const request = generation.current
        setError(null)
        const assertActive = () => {
          options?.abortSignal?.throwIfAborted()
          if (
            request !== generation.current ||
            disconnected.current ||
            latest.current.store.$selectedAccount.get()?.address !==
              expectedAddress
          ) {
            throw Object.assign(new Error('Wallet connection changed.'), {
              code: 'WALLET_ACCOUNT_CHANGED',
            })
          }
        }
        try {
          assertActive()
          return await transact(async (wallet) => {
            assertActive()
            const current = latest.current.store.$selectedAccount.get()!
            const authToken = latest.current.store.$authToken.get()
            if (!authToken)
              throw Object.assign(new Error('Authorization expired.'), {
                code: -1,
              })
            const authorized = await wallet.authorize({
              auth_token: authToken,
              chain: 'solana:mainnet',
              identity,
            })
            assertActive()
            // Reauthorization can return another account. Never submit an
            // already reviewed transaction with a silently substituted signer.
            if (
              !authorized.accounts.some(
                (item) => item.address === current.addressBase64,
              )
            ) {
              throw Object.assign(new Error('Wallet account changed.'), {
                code: 'WALLET_ACCOUNT_CHANGED',
              })
            }
            await latest.current.store.persist({
              accounts: [current],
              selectedAccount: current,
              authToken: authorized.auth_token,
            })
            assertActive()
            const signatures = await wallet.signAndSendTransactions({
              transactions: [...transactions],
              commitment: 'confirmed',
              skipPreflight: false,
            })
            return validateWalletSignatures(signatures, transactions.length)
          })
        } catch (failure) {
          if (isAuthorizationExpired(failure)) await invalidate()
          const message = walletErrorMessage(failure)
          if (!isWalletCancellation(failure)) setError(message)
          throw new Error(message)
        } finally {
          release()
        }
      },
    }
  }, [account, invalidate])

  const value = useMemo(
    () => ({
      address: account?.address ?? null,
      signer,
      connect,
      disconnect,
      isConnecting,
      error,
      supported: true,
    }),
    [account?.address, signer, connect, disconnect, isConnecting, error],
  )

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  )
}

export function WalletProvider({ children }: PropsWithChildren) {
  return (
    <MobileWalletProvider cluster={cluster} identity={identity} cache={cache}>
      <WalletBridge>{children}</WalletBridge>
    </MobileWalletProvider>
  )
}
