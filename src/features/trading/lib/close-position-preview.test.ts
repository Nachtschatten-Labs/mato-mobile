import { describe, expect, it } from 'vitest'
import {
  getClosePositionEventEventEncoder,
  getTradeFeeCollectedEventEventEncoder,
} from '@/lib/generated/twob/src/generated/events'
import { TWOB_ANCHOR_PROGRAM_ADDRESS } from '@/lib/generated/twob/src/generated/programs'
import { Side } from '@/lib/generated/twob/src/generated/types'
import { readCloseSimulation, tradeFeeAtoms } from './close-position-preview'
import type { Address, ReadonlyUint8Array } from '@solana/kit'
import type { TradePosition } from '@/lib/generated/twob/src/generated/accounts'

const key = '11111111111111111111111111111111' as Address
const market = 'So11111111111111111111111111111111111111112' as Address
const position = {
  authority: key,
  market,
  baseReceiver: key,
  quoteReceiver: key,
  side: Side.Sell,
  withdrawnAmount: 1n,
} as TradePosition
const closed = getClosePositionEventEventEncoder().encode({
  market,
  positionAddress: key,
  positionAuthority: key,
  baseReceiver: key,
  quoteReceiver: key,
  depositAmount: 1000n,
  swappedAmount: 101n,
  remainingAmount: 333n,
  feeAmount: 2n,
  startSlot: 1n,
  endSlot: 9n,
  side: Side.Sell,
})
const fee = getTradeFeeCollectedEventEventEncoder().encode({
  market,
  position: key,
  mint: market,
  totalFee: 1n,
  makerFee: 0n,
  protocolFee: 1n,
})
const dataLog = (bytes: Uint8Array | ReadonlyUint8Array) =>
  `Program data: ${Buffer.from(bytes).toString('base64')}`
const logs = [
  `Program ${TWOB_ANCHOR_PROGRAM_ADDRESS} invoke [1]`,
  dataLog(closed),
  dataLog(fee),
  `Program ${TWOB_ANCHOR_PROGRAM_ADDRESS} success`,
]

describe('close settlement preview', () => {
  it('subtracts earlier withdrawals and uses the actual fee on this close', () => {
    expect(
      readCloseSimulation({ logs, position, positionAddress: key }),
    ).toEqual({ remainingDepositAtoms: 333n, receivedAtoms: 99n, feeAtoms: 1n })
  })
  it('rejects incomplete or unrelated settlements', () => {
    expect(() =>
      readCloseSimulation({
        logs: logs.filter((log) => log !== dataLog(fee)),
        position,
        positionAddress: key,
      }),
    ).toThrow('complete settlement')
    expect(() =>
      readCloseSimulation({ logs, position, positionAddress: market }),
    ).toThrow('complete settlement')
    expect(() =>
      readCloseSimulation({
        logs,
        position: { ...position, side: Side.Buy },
        positionAddress: key,
      }),
    ).toThrow('complete settlement')
  })
  it('ignores event-shaped logs from other programs, including nested calls', () => {
    const nested = [
      `Program ${TWOB_ANCHOR_PROGRAM_ADDRESS} invoke [1]`,
      `Program ${key} invoke [2]`,
      dataLog(closed),
      dataLog(fee),
      `Program ${key} success`,
      `Program ${TWOB_ANCHOR_PROGRAM_ADDRESS} success`,
    ]
    expect(() =>
      readCloseSimulation({ logs: nested, position, positionAddress: key }),
    ).toThrow('complete settlement')
  })
  it('rounds up each withdrawal fee like the program, without charging zero amounts', () => {
    expect(tradeFeeAtoms(0n, 100)).toBe(0n)
    expect(tradeFeeAtoms(1n, 0)).toBe(0n)
    expect(tradeFeeAtoms(1n, 10)).toBe(1n)
    expect(tradeFeeAtoms(1000n, 10)).toBe(1n)
    expect(tradeFeeAtoms(1001n, 10)).toBe(2n)
  })
})
