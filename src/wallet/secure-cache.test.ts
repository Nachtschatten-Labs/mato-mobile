import { describe, expect, it, vi } from 'vitest'
import { address } from '@solana/kit'
import type { WalletAuthorization } from '@wallet-ui/react-native-kit'
import {
  createSecureAuthorizationCache,
  parseAuthorization,
} from './secure-cache'

const account = {
  address: address('11111111111111111111111111111111'),
  addressBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
}
const authorization: WalletAuthorization = {
  accounts: [account],
  selectedAccount: account,
  authToken: 'opaque-test-token',
}

describe('secure wallet authorization cache', () => {
  it('accepts valid Kit addresses and rejects a mismatched encoded account', () => {
    expect(parseAuthorization(JSON.stringify(authorization))).toEqual(
      authorization,
    )
    expect(
      parseAuthorization(
        JSON.stringify({
          ...authorization,
          selectedAccount: { ...account, addressBase64: 'AQ==' },
        }),
      ),
    ).toBeUndefined()
    expect(
      parseAuthorization(JSON.stringify({ ...authorization, authToken: '' })),
    ).toBeUndefined()
    expect(parseAuthorization('{broken')).toBeUndefined()
  })

  it('deletes corrupt persisted authorization instead of restoring it', async () => {
    const storage = {
      getItemAsync: vi.fn().mockResolvedValue('{broken'),
      setItemAsync: vi.fn(),
      deleteItemAsync: vi.fn().mockResolvedValue(undefined),
    }
    expect(await createSecureAuthorizationCache(storage).get()).toBeUndefined()
    expect(storage.deleteItemAsync).toHaveBeenCalledOnce()
  })

  it('serializes disconnect after an unfinished authorization write', async () => {
    let value: string | null = null
    let finishWrite!: () => void
    const storage = {
      async getItemAsync() {
        return value
      },
      async setItemAsync(_key: string, next: string) {
        await new Promise<void>((resolve) => {
          finishWrite = resolve
        })
        value = next
      },
      async deleteItemAsync() {
        value = null
      },
    }
    const cache = createSecureAuthorizationCache(storage)
    const writing = cache.set(authorization)
    await Promise.resolve()
    const clearing = cache.clear()
    finishWrite()
    await Promise.all([writing, clearing])
    expect(await cache.get()).toBeUndefined()
  })

  it('propagates secure storage failure and never falls back to plaintext', async () => {
    const storage = {
      getItemAsync: vi.fn(),
      setItemAsync: vi
        .fn()
        .mockRejectedValue(new Error('keystore unavailable')),
      deleteItemAsync: vi.fn(),
    }
    await expect(
      createSecureAuthorizationCache(storage).set(authorization),
    ).rejects.toThrow('keystore unavailable')
  })
})
