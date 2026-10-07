import { getAddressDecoder, getBase64Encoder, isAddress } from '@solana/kit'
import type {
  WalletAuthorization,
  WalletAuthorizationCache,
} from '@wallet-ui/react-native-kit'

export interface SecureStorage {
  getItemAsync(key: string): Promise<string | null>
  setItemAsync(key: string, value: string): Promise<void>
  deleteItemAsync(key: string): Promise<void>
}

const CACHE_KEY = 'mato.mwa.mainnet.authorization.v1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function validAccount(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.address !== 'string' ||
    !isAddress(value.address) ||
    typeof value.addressBase64 !== 'string'
  )
    return false
  try {
    const bytes = getBase64Encoder().encode(value.addressBase64)
    return (
      bytes.length === 32 && getAddressDecoder().decode(bytes) === value.address
    )
  } catch {
    return false
  }
}

export function parseAuthorization(
  raw: string,
): WalletAuthorization | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    if (
      !isRecord(value) ||
      typeof value.authToken !== 'string' ||
      !value.authToken ||
      !Array.isArray(value.accounts) ||
      value.accounts.length === 0 ||
      !value.accounts.every(validAccount) ||
      !validAccount(value.selectedAccount)
    )
      return undefined
    const selected =
      value.selectedAccount as WalletAuthorization['selectedAccount']
    if (!value.accounts.some((account) => account.address === selected.address))
      return undefined
    return value as WalletAuthorization
  } catch {
    return undefined
  }
}

export function createSecureAuthorizationCache(
  storage: SecureStorage,
): WalletAuthorizationCache {
  // Serialize writes so a late authorization write cannot overtake disconnect.
  let pending: Promise<unknown> = Promise.resolve()
  function run<T>(operation: () => Promise<T>): Promise<T> {
    const next = pending.then(operation, operation)
    pending = next.catch(() => undefined)
    return next
  }
  return {
    get: () =>
      run(async () => {
        const raw = await storage.getItemAsync(CACHE_KEY)
        if (!raw) return undefined
        const value = parseAuthorization(raw)
        if (!value) await storage.deleteItemAsync(CACHE_KEY)
        return value
      }),
    set: (value) =>
      run(async () => {
        if (!value) {
          await storage.deleteItemAsync(CACHE_KEY)
          return
        }
        await storage.setItemAsync(CACHE_KEY, JSON.stringify(value))
      }),
    clear: () => run(() => storage.deleteItemAsync(CACHE_KEY)),
  }
}
