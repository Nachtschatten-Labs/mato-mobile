export const PROGRAM_ID = 'TwobwMYkKbT8uMWqgPrEPXTPoyYsKAPmaWun6T2WT4A'
export const MAINNET_GENESIS_HASH =
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'

export function validateEndpoint(raw: string, label: string) {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error(
      `${label} must be an HTTPS URL without embedded credentials or fragments.`,
    )
  }
  return raw.replace(/\/+$/, '')
}

export function canEnableTransactions(
  enabled: string | undefined,
  verifiedProgram: string | undefined,
  development: boolean,
) {
  return !development && enabled === 'true' && verifiedProgram === PROGRAM_ID
}

export const config = Object.freeze({
  cluster: 'mainnet-beta' as const,
  chain: 'solana:mainnet' as const,
  programId: PROGRAM_ID,
  readApiUrl: validateEndpoint(
    process.env.EXPO_PUBLIC_READ_API_URL ||
      'https://read-api-production-f8ea.up.railway.app',
    'Read API',
  ),
  rpcUrl: validateEndpoint(
    process.env.EXPO_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com',
    'RPC',
  ),
  transactionsEnabled: canEnableTransactions(
    process.env.EXPO_PUBLIC_ENABLE_TRANSACTIONS,
    process.env.EXPO_PUBLIC_VERIFIED_PROGRAM_ID,
    typeof __DEV__ !== 'undefined'
      ? __DEV__
      : process.env.NODE_ENV !== 'production',
  ),
})
