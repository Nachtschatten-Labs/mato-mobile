import {
  ARRAY_LENGTH,
  MAX_RECLAIM_RENT_ACCOUNTS_PER_TRANSACTION,
} from '../constants'
import type { Address } from '@solana/kit'

export type IntervalRentAccount = {
  address: Address
  index: bigint
  lamports: bigint
  market: Address
  openPositions: number
  payer: Address
}

function toBigInt(value: bigint | number) {
  return typeof value === 'bigint' ? value : BigInt(Math.floor(value))
}

function getClosableAfterSlot(index: bigint, endSlotInterval: bigint) {
  return (index + 1n) * BigInt(ARRAY_LENGTH) * endSlotInterval
}

export function isRentAccountIndexStale({
  currentSlot,
  endSlotInterval,
  index,
}: {
  currentSlot: bigint | number
  endSlotInterval: bigint | number
  index: bigint
}) {
  return (
    toBigInt(currentSlot) >
    getClosableAfterSlot(index, toBigInt(endSlotInterval))
  )
}

export function collectCloseableMarketIntervals({
  currentSlot,
  endSlotInterval,
  intervalAccounts,
  market,
  maxAccounts = MAX_RECLAIM_RENT_ACCOUNTS_PER_TRANSACTION,
  payer,
}: {
  currentSlot: bigint | number
  endSlotInterval: bigint | number
  intervalAccounts: Array<IntervalRentAccount>
  market: Address
  maxAccounts?: number
  payer: Address
}): Array<IntervalRentAccount> {
  return intervalAccounts
    .filter(
      (account) =>
        account.market === market &&
        account.payer === payer &&
        account.openPositions === 0 &&
        isRentAccountIndexStale({
          currentSlot,
          endSlotInterval,
          index: account.index,
        }),
    )
    .sort((left, right) =>
      left.index === right.index ? 0 : left.index < right.index ? -1 : 1,
    )
    .slice(0, Math.max(0, Math.floor(maxAccounts)))
}
