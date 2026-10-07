import { config } from '@/config'

export function transactionsEnabled() {
  return config.transactionsEnabled
}

export function assertTransactionsEnabled() {
  if (!transactionsEnabled())
    throw new Error(
      'Trading is disabled in this build. Check the transaction flag and pinned program configuration.',
    )
}
