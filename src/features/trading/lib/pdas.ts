import {
  address,
  getAddressEncoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  getU32Encoder,
  getU64Encoder,
} from '@solana/kit'
import { ARRAY_LENGTH } from '../constants'
import type { Address } from '@solana/kit'
import { TWOB_ANCHOR_PROGRAM_ADDRESS } from '@/lib/generated/twob/src/generated/programs'

const textEncoder = new TextEncoder()

function seed(value: string) {
  return getBytesEncoder().encode(textEncoder.encode(value))
}

export async function findMarketAddress({
  baseMint,
  quoteMint,
  id,
}: {
  baseMint: Address
  quoteMint: Address
  id: number
}) {
  const [address] = await getProgramDerivedAddress({
    programAddress: TWOB_ANCHOR_PROGRAM_ADDRESS,
    seeds: [
      seed('market'),
      getAddressEncoder().encode(baseMint),
      getAddressEncoder().encode(quoteMint),
      getU32Encoder().encode(id),
    ],
  })
  return address
}

export async function findMarketIntervalAddress(
  marketAddress: Address,
  index: bigint | number,
) {
  const [address] = await getProgramDerivedAddress({
    programAddress: TWOB_ANCHOR_PROGRAM_ADDRESS,
    seeds: [
      seed('market_interval'),
      getAddressEncoder().encode(marketAddress),
      getU64Encoder().encode(BigInt(index)),
    ],
  })
  return address
}

export function getReferenceIndex(
  currentSlot: number,
  endSlotInterval: bigint | number,
) {
  return BigInt(
    Math.max(
      1,
      Math.floor((currentSlot + 20) / (ARRAY_LENGTH * Number(endSlotInterval))),
    ),
  )
}

export function getPreviousIndex(referenceIndex: bigint) {
  return referenceIndex - 1n
}

export function getFutureIndex(
  endSlot: bigint,
  endSlotInterval: bigint | number,
) {
  return endSlot / BigInt(ARRAY_LENGTH) / BigInt(endSlotInterval)
}

export function alignEndSlot(
  currentSlot: number,
  durationSlots: number,
  endSlotInterval: bigint | number,
) {
  const interval = Number(endSlotInterval)
  return BigInt(
    Math.floor((currentSlot + durationSlots + interval / 2) / interval) *
      interval,
  )
}

export function resolveSnapshotLocation(slot: number, endSlotInterval: number) {
  if (!Number.isFinite(slot) || slot < 0) return null
  if (!Number.isFinite(endSlotInterval) || endSlotInterval <= 0) return null

  const slotsPerInterval = ARRAY_LENGTH * endSlotInterval
  return {
    intervalIndex: Math.floor(slot / slotsPerInterval),
    snapshotIndex: Math.floor(slot / endSlotInterval) % ARRAY_LENGTH,
  }
}

export function toTwobAddress(value: string) {
  return address(value)
}
