import {
  parseClosePositionEventEvent,
  parseTradeFeeCollectedEventEvent,
} from '@/lib/generated/twob/src/generated/events'
import { TWOB_ANCHOR_PROGRAM_ADDRESS } from '@/lib/generated/twob/src/generated/programs'
import { decodeBase64 } from './bytes'
import type { Address } from '@solana/kit'
import type { TradePosition } from '@/lib/generated/twob/src/generated/accounts'
import type {
  ClosePositionEventEvent,
  TradeFeeCollectedEventEvent,
} from '@/lib/generated/twob/src/generated/events'

export interface ClosePositionPreview {
  remainingDepositAtoms: bigint
  receivedAtoms: bigint
  feeAtoms: bigint
  positionRentLamports: bigint
  baseReceiver: Address
  quoteReceiver: Address
  rentReceiver: Address
  simulatedAtMs: number
}

export function tradeFeeAtoms(amount: bigint, feeBps: number) {
  // The program rounds each withdrawal's fee up to the next token atom.
  return (amount * BigInt(feeBps) + 9_999n) / 10_000n
}

export function readCloseSimulation({
  logs,
  position,
  positionAddress,
}: {
  logs: readonly string[]
  position: TradePosition
  positionAddress: Address
}) {
  const programStack: string[] = []
  let closed: ClosePositionEventEvent | null = null
  let chargedFee: TradeFeeCollectedEventEvent | null = null
  for (const log of logs) {
    const invoked = /^Program (\w+) invoke \[\d+\]$/.exec(log)
    if (invoked) {
      programStack.push(invoked[1])
      continue
    }
    if (/^Program \w+ (success|failed:)/.test(log)) {
      programStack.pop()
      continue
    }
    if (
      programStack.at(-1) !== TWOB_ANCHOR_PROGRAM_ADDRESS ||
      !log.startsWith('Program data: ')
    )
      continue
    const bytes = decodeBase64(log.slice('Program data: '.length))
    try {
      const event = parseClosePositionEventEvent(bytes)
      if (
        event.positionAddress === positionAddress &&
        event.market === position.market &&
        event.positionAuthority === position.authority &&
        event.side === position.side &&
        event.baseReceiver === position.baseReceiver &&
        event.quoteReceiver === position.quoteReceiver
      )
        closed = event
    } catch {
      /* Other program events have different discriminators. */
    }
    try {
      const event = parseTradeFeeCollectedEventEvent(bytes)
      if (
        event.position === positionAddress &&
        event.market === position.market
      )
        chargedFee = event
    } catch {
      /* Other program events have different discriminators. */
    }
  }
  if (
    !closed ||
    !chargedFee ||
    closed.swappedAmount < position.withdrawnAmount
  ) {
    throw new Error(
      'The close preview did not include a complete settlement. Please refresh it.',
    )
  }
  const claimable = closed.swappedAmount - position.withdrawnAmount
  if (chargedFee.totalFee > claimable)
    throw new Error('The close preview returned an invalid fee.')
  return {
    remainingDepositAtoms: closed.remainingAmount,
    receivedAtoms: claimable - chargedFee.totalFee,
    feeAtoms: chargedFee.totalFee,
  }
}
