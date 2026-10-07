import { describe, expect, it } from 'vitest'
import { validateWalletSignatures } from './signatures'

describe('wallet submission receipts', () => {
  it('preserves one binary signature per transaction for Kit', () => {
    const signatures = [new Uint8Array(64), new Uint8Array(64)]
    expect(validateWalletSignatures(signatures, 2)).toBe(signatures)
  })
  it('rejects missing, malformed or extra receipts instead of claiming submission', () => {
    expect(() => validateWalletSignatures([], 1)).toThrow(
      'invalid transaction receipt',
    )
    expect(() => validateWalletSignatures([new Uint8Array(32)], 1)).toThrow(
      'invalid transaction receipt',
    )
    expect(() =>
      validateWalletSignatures([new Uint8Array(64), new Uint8Array(64)], 1),
    ).toThrow('invalid transaction receipt')
  })
})
