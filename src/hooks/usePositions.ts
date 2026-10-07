import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useIsFocused } from '@react-navigation/native'
import type { Address } from '@solana/kit'
import { config } from '../config'
import { rpc } from '../lib/rpc'
import { getMarketDefinition } from '../features/trading/constants'
import {
  deriveAssociatedTokenAddress,
  fetchStreamingMarketState,
  fetchTradePositions,
} from '../features/trading/api/twob-client'
import { getSpendableNativeAtoms } from '../features/trading/lib/amounts'

export const mobileMarket = getMarketDefinition(1)
export const mobileKeys = [
  'mobile',
  config.programId,
  mobileMarket.address,
] as const

export function useForeground() {
  const focused = useIsFocused()
  const [active, setActive] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) =>
      setActive(state === 'active'),
    )
    return () => listener.remove()
  }, [])
  return active && focused
}

export function useNativeMarketState() {
  const active = useForeground()
  return useQuery({
    queryKey: [...mobileKeys, 'market-state'],
    queryFn: () => fetchStreamingMarketState(rpc, mobileMarket.address),
    enabled: active,
    refetchInterval: active ? 5_000 : false,
    refetchIntervalInBackground: false,
  })
}

export function usePositions(authority: Address | null) {
  const active = useForeground()
  return useQuery({
    queryKey: [...mobileKeys, 'positions', authority],
    queryFn: () => fetchTradePositions(rpc, authority!, mobileMarket.address),
    enabled: active && Boolean(authority),
    refetchInterval: active ? 5_000 : false,
    refetchIntervalInBackground: false,
  })
}

type ParsedTokenAccounts = {
  value: ReadonlyArray<{
    pubkey: Address
    account: {
      owner: Address
      data: { parsed: { info: { tokenAmount: { amount: string } } } }
    }
  }>
}

export function useNativeBalances(authority?: Address | null) {
  const active = useForeground()
  return useQuery({
    queryKey: [...mobileKeys, 'balances', authority],
    queryFn: async ({ signal }) => {
      if (!authority) throw new Error('Connect your wallet to load balances.')
      const [native, wrapped, quote] = await Promise.all([
        rpc
          .getBalance(authority, { commitment: 'confirmed' })
          .send({ abortSignal: signal }),
        rpc
          .getTokenAccountsByOwner(
            authority,
            { mint: mobileMarket.baseMint },
            { commitment: 'confirmed', encoding: 'jsonParsed' },
          )
          .send({ abortSignal: signal }),
        rpc
          .getTokenAccountsByOwner(
            authority,
            { mint: mobileMarket.quoteMint },
            { commitment: 'confirmed', encoding: 'jsonParsed' },
          )
          .send({ abortSignal: signal }),
      ])
      // Transactions fund from the associated account. An unrelated token
      // account must not inflate the amount available to the order builder.
      const associatedBalance = async (response: unknown, mint: Address) => {
        const rows = (response as ParsedTokenAccounts).value
        const matching = await Promise.all(
          rows.map(async (row) => {
            const associated = await deriveAssociatedTokenAddress({
              owner: authority,
              mint,
              tokenProgram: row.account.owner,
            })
            return row.pubkey === associated
              ? BigInt(row.account.data.parsed.info.tokenAmount.amount)
              : 0n
          }),
        )
        return matching.reduce((total, value) => total + value, 0n)
      }
      const lamports = native.value
      const [wrappedSolAtoms, usdcAtoms] = await Promise.all([
        associatedBalance(wrapped, mobileMarket.baseMint),
        associatedBalance(quote, mobileMarket.quoteMint),
      ])
      return {
        lamports,
        wrappedSolAtoms,
        solAtoms: lamports + wrappedSolAtoms,
        usdcAtoms,
        spendableSolAtoms: getSpendableNativeAtoms(lamports, wrappedSolAtoms),
      }
    },
    enabled: active && Boolean(authority),
    refetchInterval: active ? 10_000 : false,
    refetchIntervalInBackground: false,
  })
}
