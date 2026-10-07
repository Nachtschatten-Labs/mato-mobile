import type { PropsWithChildren } from 'react'
import { WalletContext, type WalletState } from './context'
export { useWallet } from './context'

const unsupportedWallet: WalletState = {
  address: null,
  signer: null,
  isConnecting: false,
  error: null,
  supported: false,
  async connect() {
    throw new Error('Connect a wallet in the Android app.')
  },
  async disconnect() {},
}

// Metro selects WalletProvider.android.tsx on Android. This module intentionally
// never imports MWA or SecureStore so web previews and iOS can render safely.
export function WalletProvider({ children }: PropsWithChildren) {
  return (
    <WalletContext.Provider value={unsupportedWallet}>
      {children}
    </WalletContext.Provider>
  )
}
