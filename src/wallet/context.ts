import { createContext, useContext } from 'react'
import type { Address, TransactionSigner } from '@solana/kit'

export interface WalletState {
  address: Address | null
  signer: TransactionSigner | null
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnecting: boolean
  error: string | null
  supported: boolean
}

export const WalletContext = createContext<WalletState | null>(null)

export function useWallet(): WalletState {
  const wallet = useContext(WalletContext)
  if (!wallet) throw new Error('useWallet must be used inside WalletProvider')
  return wallet
}
