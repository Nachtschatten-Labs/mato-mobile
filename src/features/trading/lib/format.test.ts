import { describe, expect, it } from 'vitest'
import {
  formatExplorerAddressUrl,
  formatExplorerTransactionUrl,
} from './format'

describe('Explorer links', () => {
  it.each([
    'http://localhost:3000/rpc',
    'http://127.0.0.1:3000/rpc',
    'https://devnet.mato.markets/rpc',
  ])('links to mainnet when using the RPC facade at %s', (endpoint) => {
    expect(formatExplorerTransactionUrl('signature', endpoint)).toBe(
      'https://explorer.solana.com/tx/signature?cluster=mainnet-beta',
    )
    expect(formatExplorerAddressUrl('address', endpoint)).toBe(
      'https://explorer.solana.com/address/address?cluster=mainnet-beta',
    )
  })
})
