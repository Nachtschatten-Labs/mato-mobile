import { describe, expect, it } from 'vitest'
import {
  isAuthorizationExpired,
  isWalletCancellation,
  walletErrorMessage,
} from './errors'

describe('wallet errors', () => {
  it('distinguishes cancelled signing from expired authorization', () => {
    expect(isWalletCancellation({ code: -3 })).toBe(true)
    expect(isWalletCancellation({ code: 'ERROR_ASSOCIATION_CANCELLED' })).toBe(
      true,
    )
    expect(isAuthorizationExpired({ code: -1 })).toBe(true)
    expect(isAuthorizationExpired({ code: -3 })).toBe(false)
  })
  it('does not surface a raw native error that may contain credentials', () => {
    expect(walletErrorMessage(new Error('auth_token=secret'))).not.toContain(
      'secret',
    )
  })
})
