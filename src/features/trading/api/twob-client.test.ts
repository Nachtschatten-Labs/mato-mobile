import { describe, expect, it } from 'vitest'
import {
  alignEndSlot,
  deriveAssociatedTokenAddress,
  deriveMarketAddress,
  deriveProgramConfigAddress,
  deriveTemporaryWithdrawTokenAddress,
  fetchMarketTradePositions,
  fetchTradePositions,
  getApprovalSafeReferenceIndex,
  getFutureIndex,
  getReferenceIndex,
  getSwappedPositionAsset,
  getUnpausedEndSlot,
  resolveSnapshotLocation,
} from './twob-client'
import type { TwobRpcClient } from './twob-client'
import type { Address } from '@solana/kit'
import { createNoopSigner, getAddressDecoder } from '@solana/kit'
import { ARRAY_LENGTH, END_SLOT_INTERVAL } from '../constants'
import { getTradePositionEncoder } from '@/lib/generated/twob/src/generated/accounts'
import { getInitializeProgramConfigInstructionAsync } from '@/lib/generated/twob/src/generated/instructions'
import { findMarketPda } from '@/lib/generated/twob/src/generated/pdas'
import { TWOB_ANCHOR_PROGRAM_ADDRESS } from '@/lib/generated/twob/src/generated/programs'
import { Side } from '@/lib/generated/twob/src/generated/types'

const BASE_MINT = 'So11111111111111111111111111111111111111112' as Address
const QUOTE_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' as Address
const BASE_RECEIVER = '11111111111111111111111111111111' as Address
const QUOTE_RECEIVER = 'CCAd78ZgUBAFNQmCCD5z4oGuFzb8uXLw5kfnBcRvDw16' as Address
const LEGACY_TOKEN_PROGRAM =
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address
const TOKEN_2022_PROGRAM =
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' as Address
const MARKET_ADDRESS = 'FUDH6hiwDNjdQKbH7fveFFPoEE3mXk9i1g2WbgnSqob3' as Address
const PROGRAM_CONFIG_ADDRESS =
  'BKgwxz23KWsrp9BSgAuCngfUCrpQm6jprgYUbwmyNd2X' as Address

type ProgramAccountsConfig = NonNullable<
  Parameters<TwobRpcClient['getProgramAccounts']>[1]
>

function encodeTradePosition(market: Address, id: number) {
  const bytes = getTradePositionEncoder().encode({
    amount: 100n,
    authority: BASE_RECEIVER,
    baseReceiver: BASE_RECEIVER,
    padding: new Uint8Array(9),
    bookkeepingSnapshot: 0n,
    bump: 0,
    flow: 10n,
    id,
    inactiveRefund: 0n,
    lastUpdateSlot: 1n,
    market,
    feeBpsAtSubmission: 25,
    operator: BASE_RECEIVER,
    pausedAtSlot: 0n,
    payer: BASE_RECEIVER,
    quoteReceiver: QUOTE_RECEIVER,
    remainingSlots: 10,
    side: Side.Buy,
    slotsWithoutTradesSnapshot: 0,
    startSlot: 1n,
    swappedAmountAtSnapshot: 0n,
    withdrawnAmount: 0n,
  })

  return Buffer.from(bytes).toString('base64')
}

function createProgramAccountsRpc(
  accounts: Array<{
    account: { data: [string, 'base64'] }
    pubkey: Address
  }> = [],
) {
  let config: ProgramAccountsConfig | null = null
  const rpc = {
    getProgramAccounts: (
      _programAddress: Address,
      nextConfig: ProgramAccountsConfig,
    ) => {
      config = nextConfig
      return { send: () => Promise.resolve(accounts) }
    },
  } as unknown as TwobRpcClient

  return { getConfig: () => config, rpc }
}

describe('twob v1 client helpers', () => {
  it('uses the deployed mainnet program and its configuration PDA', async () => {
    expect(TWOB_ANCHOR_PROGRAM_ADDRESS).toBe(
      'TwobwMYkKbT8uMWqgPrEPXTPoyYsKAPmaWun6T2WT4A',
    )
    await expect(deriveProgramConfigAddress()).resolves.toBe(
      PROGRAM_CONFIG_ADDRESS,
    )
    const instruction = await getInitializeProgramConfigInstructionAsync({
      authority: createNoopSigner(BASE_RECEIVER),
      payer: createNoopSigner(BASE_RECEIVER),
      authorityTransferDelaySlots: 100,
    })
    expect(instruction.programAddress).toBe(TWOB_ANCHOR_PROGRAM_ADDRESS)
    expect(instruction.accounts[0].address).toBe(BASE_RECEIVER)
    expect(instruction.accounts[2].address).toBe(PROGRAM_CONFIG_ADDRESS)
  })

  it('derives a market PDA from the ordered mint pair and a u32 id', async () => {
    await expect(
      deriveMarketAddress({
        baseMint: BASE_MINT,
        quoteMint: QUOTE_MINT,
        id: 1,
      }),
    ).resolves.toBe(MARKET_ADDRESS)
    await expect(
      findMarketPda({ baseMint: BASE_MINT, quoteMint: QUOTE_MINT, id: 1 }),
    ).resolves.toEqual([MARKET_ADDRESS, expect.any(Number)])
    await expect(
      deriveMarketAddress({
        baseMint: QUOTE_MINT,
        quoteMint: BASE_MINT,
        id: 1,
      }),
    ).resolves.not.toBe(MARKET_ADDRESS)
    await expect(
      deriveMarketAddress({
        baseMint: BASE_MINT,
        quoteMint: QUOTE_MINT,
        id: 2,
      }),
    ).resolves.not.toBe(MARKET_ADDRESS)
  })

  it('keeps reference index zero reserved', () => {
    expect(getReferenceIndex(0, END_SLOT_INTERVAL)).toBe(1n)
  })

  it('always rounds a resumed position to the next end-slot interval', () => {
    expect(getUnpausedEndSlot(189, 10, 10)).toBe(200n)
    expect(getUnpausedEndSlot(190, 10, 10)).toBe(210n)
    expect(getUnpausedEndSlot(191, 10, 10)).toBe(210n)
  })

  it('includes the token program when deriving an associated token account', async () => {
    const legacyAddress = await deriveAssociatedTokenAddress({
      mint: BASE_MINT,
      owner: BASE_RECEIVER,
      tokenProgram: LEGACY_TOKEN_PROGRAM,
    })
    const token2022Address = await deriveAssociatedTokenAddress({
      mint: BASE_MINT,
      owner: BASE_RECEIVER,
      tokenProgram: TOKEN_2022_PROGRAM,
    })

    expect(token2022Address).not.toBe(legacyAddress)
  })

  it('uses a program-owned temporary token account for native withdrawals', async () => {
    const tradePosition =
      'BMMWpvb3PtMCnWa3uh9ChS2UWufiLLFTV6tkrCJ6DUng' as Address
    const [temporaryAddress, associatedAddress] = await Promise.all([
      deriveTemporaryWithdrawTokenAddress(tradePosition),
      deriveAssociatedTokenAddress({
        mint: BASE_MINT,
        owner: BASE_RECEIVER,
        tokenProgram: LEGACY_TOKEN_PROGRAM,
      }),
    ])

    expect(temporaryAddress).not.toBe(associatedAddress)
  })

  it('routes swapped funds to the side-specific mint and receiver', () => {
    const market = { baseMint: BASE_MINT, quoteMint: QUOTE_MINT }
    const receivers = {
      baseReceiver: BASE_RECEIVER,
      quoteReceiver: QUOTE_RECEIVER,
    }

    expect(
      getSwappedPositionAsset(market, { ...receivers, side: Side.Buy }),
    ).toEqual({ mint: BASE_MINT, receiver: BASE_RECEIVER })
    expect(
      getSwappedPositionAsset(market, { ...receivers, side: Side.Sell }),
    ).toEqual({ mint: QUOTE_MINT, receiver: QUOTE_RECEIVER })
  })

  it('filters authority scans by the stored market address', async () => {
    const { getConfig, rpc } = createProgramAccountsRpc()

    await fetchTradePositions(rpc, BASE_RECEIVER, MARKET_ADDRESS)

    expect(getConfig()?.filters).toContainEqual({
      memcmp: {
        bytes: BASE_RECEIVER,
        encoding: 'base58',
        offset: 8n,
      },
    })
    expect(getConfig()?.filters).toContainEqual({
      memcmp: {
        bytes: MARKET_ADDRESS,
        encoding: 'base58',
        offset: 40n,
      },
    })
  })

  it('filters order-book scans on the server and after decoding', async () => {
    const { getConfig, rpc } = createProgramAccountsRpc([
      {
        account: { data: [encodeTradePosition(MARKET_ADDRESS, 1), 'base64'] },
        pubkey: BASE_RECEIVER,
      },
      {
        account: { data: [encodeTradePosition(QUOTE_RECEIVER, 2), 'base64'] },
        pubkey: QUOTE_RECEIVER,
      },
    ])

    const positions = await fetchMarketTradePositions(rpc, MARKET_ADDRESS)

    expect(getConfig()?.filters).toContainEqual({
      memcmp: {
        bytes: MARKET_ADDRESS,
        encoding: 'base58',
        offset: 40n,
      },
    })
    expect(positions.map((position) => position.data.market)).toEqual([
      MARKET_ADDRESS,
    ])
    expect(positions[0].data.feeBpsAtSubmission).toBe(25)
  })

  it('places the market immediately after authority in serialized positions', () => {
    const bytes = Buffer.from(encodeTradePosition(MARKET_ADDRESS, 1), 'base64')
    expect(bytes.length).toBe(312)
    expect(getAddressDecoder().decode(bytes.subarray(40, 72))).toBe(
      MARKET_ADDRESS,
    )
    expect(bytes[300]).toBe(25)
  })

  it('uses the next interval account when bookkeeping is current', () => {
    expect(getApprovalSafeReferenceIndex(500, 490n, END_SLOT_INTERVAL)).toBe(3n)
  })

  it('keeps the current account when bookkeeping is still in the previous window', () => {
    expect(getApprovalSafeReferenceIndex(500, 300n, END_SLOT_INTERVAL)).toBe(2n)
  })

  it('advances at the account boundary', () => {
    expect(getApprovalSafeReferenceIndex(630, 630n, END_SLOT_INTERVAL)).toBe(4n)
  })

  it('uses 16 eleven-slot snapshots and rolls over at slot 176', () => {
    expect(ARRAY_LENGTH).toBe(16)
    expect(END_SLOT_INTERVAL).toBe(11)
    expect(alignEndSlot(154, 11, END_SLOT_INTERVAL)).toBe(165n)
    expect(alignEndSlot(160, 11, END_SLOT_INTERVAL)).toBe(176n)
    expect(getFutureIndex(165n, END_SLOT_INTERVAL)).toBe(0n)
    expect(getFutureIndex(176n, END_SLOT_INTERVAL)).toBe(1n)
    expect(resolveSnapshotLocation(165, END_SLOT_INTERVAL)).toEqual({
      intervalIndex: 0,
      snapshotIndex: 15,
    })
    expect(resolveSnapshotLocation(176, END_SLOT_INTERVAL)).toEqual({
      intervalIndex: 1,
      snapshotIndex: 0,
    })
  })
})
