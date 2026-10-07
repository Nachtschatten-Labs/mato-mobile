function codeOf(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error
    ? error.code
    : undefined
}

export function isWalletCancellation(error: unknown): boolean {
  const code = codeOf(error)
  return (
    code === -3 ||
    code === 'ERROR_ASSOCIATION_CANCELLED' ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export function isAuthorizationExpired(error: unknown): boolean {
  return codeOf(error) === -1 || codeOf(error) === 'WALLET_ACCOUNT_CHANGED'
}

export function walletErrorMessage(error: unknown): string {
  if (isWalletCancellation(error)) return 'Wallet request cancelled.'
  if (isAuthorizationExpired(error))
    return 'Your wallet connection changed. Please reconnect and review the transaction again.'
  const code = codeOf(error)
  if (code === 'ERROR_WALLET_NOT_FOUND')
    return 'Install an Android wallet that supports Mobile Wallet Adapter, then try again.'
  if (code === 'ERROR_SESSION_TIMEOUT' || code === 'ERROR_SESSION_CLOSED')
    return 'The wallet session ended. Check your wallet activity before retrying.'
  // Do not display native exception payloads; they can contain cached tokens or
  // full transaction details. The transaction layer handles on-chain errors.
  return 'Could not complete the wallet request. Check your wallet activity before retrying.'
}
