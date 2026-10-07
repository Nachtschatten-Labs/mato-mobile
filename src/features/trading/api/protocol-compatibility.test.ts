import mainnetMarket from './fixtures/mainnet-market.json'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AccountRole,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getAddressEncoder,
  getBase58Decoder,
  getTransactionEncoder,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import type {
  Address,
  Blockhash,
  Instruction,
  ReadonlyUint8Array,
} from '@solana/kit'
import type { TwobRpcClient } from './twob-client'
import * as accounts from '@/lib/generated/twob/src/generated/accounts'
import { getMarketUpdateEventEventDecoder } from '@/lib/generated/twob/src/generated/events'
import { Side } from '@/lib/generated/twob/src/generated/types'
import { TWOB_ANCHOR_PROGRAM_ADDRESS } from '@/lib/generated/twob/src/generated/programs'
import {
  deriveMarketIntervalAddress,
  deriveProgramConfigAddress,
  fetchEndSlotBookkeepingSnapshot,
  fetchStreamingMarketState,
  sendClosePositions,
  sendPauseTradePosition,
  sendUnpauseTradePosition,
  sendWithdrawSwapped,
} from './twob-client'

const WALLET = '11111111111111111111111111111111' as Address
const MARKET = 'FUDH6hiwDNjdQKbH7fveFFPoEE3mXk9i1g2WbgnSqob3' as Address
const BASE = 'So11111111111111111111111111111111111111112' as Address
const QUOTE = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' as Address
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address
const SIGNATURE = getBase58Decoder().decode(new Uint8Array(64).fill(1))

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/integrations/solana/transaction-policy', () => ({
  assertTransactionsEnabled: () => {},
}))
vi.mock('./verify-network', () => ({
  verifyTransactionEnvironment: async () => {},
}))
vi.mock('./token-instructions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./token-instructions')>()),
  detectTokenProgram: async () => ({ programAddress: TOKEN_PROGRAM }),
  prepareUnwrapInstructions: async () => [],
}))
vi.mock('@solana/kit', async (importOriginal) => {
  const kit = await importOriginal<typeof import('@solana/kit')>()
  return {
    ...kit,
    signAndSendTransactionMessageWithSigners: async (message: {
      instructions: readonly Instruction[]
    }) => {
      await mocks.send(message)
      return kit.signatureBytes(new Uint8Array(64).fill(1))
    },
  }
})

function createMarket(kind = 0) {
  return accounts.getMarketDecoder().decode(
    accounts.getMarketEncoder().encode({
      baseMint: BASE,
      quoteMint: QUOTE,
      baseFlow: 1_000_000_000n,
      quoteFlow: 2_000_000_000n,
      minimumBaseDepositAtoms: 1n,
      minimumQuoteDepositAtoms: 1n,
      startSlot: 1n,
      openPositions: 2n,
      accumulatedBaseFees: 0n,
      accumulatedQuoteFees: 0n,
      id: 1,
      feeBps: 10,
      unhealthyLiquidityFeeBps: 0,
      slotsUntilDebt: 10,
      liquidityAmplification: 2,
      kind,
      isPaused: 0,
      bump: 255,
      makerAuthority: WALLET,
      pendingMakerAuthority: WALLET,
      padding0: new Uint8Array(5),
      padding1: new Uint8Array(4),
      bookkeeping: {
        basePerQuote: 1n,
        quotePerBase: 2n,
        previousBasePerQuote: 0n,
        previousQuotePerBase: 0n,
        windowBasePerQuote: 0n,
        windowQuotePerBase: 0n,
        lastUpdateSlot: 490n,
        previousUpdateSlot: 480n,
        windowStartSlot: 470n,
        slotsWithoutTrade: 123,
        padding: new Uint8Array(4),
      },
      quoteOperator: WALLET,
      makerBaseInventory: -1n,
      makerQuoteInventory: 10n,
      makerBaseFlowAtoms: 1n,
      makerQuoteFlowAtoms: 2n,
      makerBasePerQuoteSnapshot: 0n,
      makerQuotePerBaseSnapshot: 0n,
      makerSlotsWithoutTradeSnapshot: 0,
      makerLastUpdateSlot: 490n,
    }),
  )
}

function createPosition(overrides: Partial<accounts.TradePositionArgs> = {}) {
  return accounts.getTradePositionDecoder().decode(
    accounts.getTradePositionEncoder().encode({
      authority: WALLET,
      market: MARKET,
      payer: WALLET,
      operator: WALLET,
      baseReceiver: WALLET,
      quoteReceiver: WALLET,
      amount: 1_000n,
      inactiveRefund: 0n,
      startSlot: 400n,
      lastUpdateSlot: 400n,
      remainingSlots: 300,
      flow: 3_000_000_000n,
      padding: new Uint8Array(9),
      bookkeepingSnapshot: 0n,
      slotsWithoutTradesSnapshot: 0,
      pausedAtSlot: 0n,
      swappedAmountAtSnapshot: 0n,
      withdrawnAmount: 0n,
      id: 1,
      feeBpsAtSubmission: 25,
      side: Side.Sell,
      bump: 255,
      ...overrides,
    }),
  )
}

function createContext(kind = 0) {
  vi.spyOn(accounts, 'fetchMarket').mockResolvedValue({
    data: createMarket(kind),
  } as Awaited<ReturnType<typeof accounts.fetchMarket>>)
  vi.spyOn(accounts, 'fetchTradePosition').mockResolvedValue({
    data: createPosition(),
  } as Awaited<ReturnType<typeof accounts.fetchTradePosition>>)
  vi.spyOn(accounts, 'fetchMarketInterval').mockResolvedValue({
    data: { market: MARKET, index: 3n },
  } as Awaited<ReturnType<typeof accounts.fetchMarketInterval>>)
  const rpc = {
    getSlot: () => ({ send: async () => 500n }),
    getAccountInfo: () => ({ send: async () => ({ value: {} }) }),
    getLatestBlockhash: () => ({
      send: async () => ({
        value: { blockhash: WALLET, lastValidBlockHeight: 1000n },
      }),
    }),
    getSignatureStatuses: () => ({
      send: async () => ({
        value: [{ confirmationStatus: 'confirmed', err: null }],
      }),
    }),
  } as unknown as TwobRpcClient
  const send = vi.fn(
    async (_request: { instructions: readonly Instruction[] }) => SIGNATURE,
  )
  mocks.send = send
  const signer = { address: WALLET, signAndSendTransactions: vi.fn() }
  return { context: { rpc, signer }, rpc, send }
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('v1 protocol compatibility', () => {
  it('decodes the observed mainnet market at slot 453870292', () => {
    expect(mainnetMarket.account.owner).toBe(TWOB_ANCHOR_PROGRAM_ADDRESS)
    const market = accounts
      .getMarketDecoder()
      .decode(Buffer.from(mainnetMarket.account.data[0], 'base64'))
    expect(market).toMatchObject({
      id: 1,
      baseMint: BASE,
      quoteMint: QUOTE,
      kind: 1,
      isPaused: 0,
      minimumBaseDepositAtoms: 1000000n,
      minimumQuoteDepositAtoms: 100000n,
      makerAuthority: 'LPv1AZNbdrL2y516aUofpqZ9xgDaH73h9t6WhB9KWna',
    })
    expect(market.bookkeeping.lastUpdateSlot).toBeGreaterThan(453860000n)
    expect(market.bookkeeping.lastUpdateSlot).toBeLessThanOrEqual(
      BigInt(mainnetMarket.slot),
    )
  })
  it('decodes 16 zero-copy interval entries at their deployed offsets', () => {
    const bytes = Buffer.alloc(1176)
    bytes.set(accounts.getMarketIntervalDiscriminatorBytes())
    bytes.writeUInt32LE(7, 144)
    bytes.writeBigUInt64LE(123n, 152 + 15 * 16)
    bytes.writeBigUInt64LE(456n, 152 + 3 * 16 * 16 + 15 * 16)
    const interval = accounts.getMarketIntervalDecoder().decode(bytes)
    expect(interval.openPositions).toBe(7)
    expect(interval.baseExits).toHaveLength(16)
    expect(interval.baseExits[15]).toBe(123n)
    expect(interval.quotePerBaseSnapshot[15]).toBe(456n)
    expect(accounts.getMarketSize()).toBe(488)
    expect(accounts.getMarketIntervalSize()).toBe(1176)
    expect(accounts.getTradePositionSize()).toBe(312)
  })

  it('decodes market-address events with flows larger than u64', () => {
    const bytes = Buffer.alloc(72)
    bytes.set([114, 70, 57, 176, 187, 142, 113, 145])
    bytes.set(getAddressEncoder().encode(MARKET), 8)
    bytes.writeBigUInt64LE(5n, 40)
    bytes.writeBigUInt64LE(1n, 48)
    bytes.writeBigUInt64LE(7n, 56)
    expect(getMarketUpdateEventEventDecoder().decode(bytes)).toEqual({
      market: MARKET,
      baseFlow: (1n << 64n) + 5n,
      quoteFlow: 7n,
    })
  })

  it.each([0, 1])(
    'reads streaming state for market kind %s with the fixed interval',
    async (kind) => {
      const { rpc } = createContext(kind)
      expect(await fetchStreamingMarketState(rpc, MARKET)).toMatchObject({
        endSlotInterval: 11,
        marketBaseFlow: 1_000_000_000n,
        marketQuoteFlow: 2_000_000_000n,
        bookkeepingSlotsWithoutTrades: 123,
      })
    },
  )

  it.each([true, false])(
    'reads the price and inactive-slot count from the same end snapshot (buy=%s)',
    async (isBuy) => {
      const { rpc } = createContext()
      const basePerQuoteSnapshot = Array<bigint>(16).fill(0n)
      const quotePerBaseSnapshot = Array<bigint>(16).fill(0n)
      const slotsWithoutTradesSnapshot = Array<number>(16).fill(0)
      basePerQuoteSnapshot[12] = 50n
      quotePerBaseSnapshot[12] = 80n
      slotsWithoutTradesSnapshot[12] = 154
      vi.mocked(accounts.fetchMarketInterval).mockResolvedValue({
        data: {
          market: MARKET,
          index: 3n,
          basePerQuoteSnapshot,
          quotePerBaseSnapshot,
          slotsWithoutTradesSnapshot,
        },
      } as Awaited<ReturnType<typeof accounts.fetchMarketInterval>>)

      const request = {
        rpcClient: rpc,
        marketAddress: MARKET,
        endSlot: 660,
        endSlotInterval: 11,
        isBuy,
      }
      await expect(
        fetchEndSlotBookkeepingSnapshot({
          ...request,
          bookkeepingLastUpdateSlot: 700,
        }),
      ).resolves.toEqual({
        slot: 660,
        bookkeeping: isBuy ? 50n : 80n,
        slotsWithoutTrades: 154,
      })
    },
  )

  it('reads market and scheduled exits from one bank to fill a short ended order immediately', async () => {
    const { rpc } = createContext()
    const market = createMarket()
    market.bookkeeping.lastUpdateSlot = 650n
    const exitInterval: accounts.MarketIntervalArgs = {
      market: MARKET,
      index: 3n,
      payer: WALLET,
      openPositions: 1,
      bump: 0,
      padding: new Uint8Array(3),
      baseExits: Array<bigint>(16).fill(0n),
      quoteExits: Array<bigint>(16).fill(0n),
      basePerQuoteSnapshot: Array<bigint>(16).fill(0n),
      quotePerBaseSnapshot: Array<bigint>(16).fill(0n),
      slotsWithoutTradesSnapshot: Array<number>(16).fill(0),
    }
    const account = (bytes: ReadonlyUint8Array) => ({
      data: [Buffer.from(bytes).toString('base64'), 'base64'],
      executable: false,
      lamports: 1n,
      owner: TWOB_ANCHOR_PROGRAM_ADDRESS,
      space: BigInt(bytes.length),
    })
    const getMultipleAccounts = vi.fn(() => ({
      send: async () => ({
        context: { slot: 660n },
        value: [
          account(accounts.getMarketEncoder().encode(market)),
          null,
          account(accounts.getMarketIntervalEncoder().encode(exitInterval)),
        ],
      }),
    }))
    Object.assign(rpc, { getMultipleAccounts })
    await expect(
      fetchEndSlotBookkeepingSnapshot({
        rpcClient: rpc,
        marketAddress: MARKET,
        endSlot: 660,
        endSlotInterval: 11,
        isBuy: true,
        bookkeepingLastUpdateSlot: 650,
      }),
    ).resolves.toEqual({
      slot: 660,
      bookkeeping: 5_000_000_000_000_001n,
      slotsWithoutTrades: 123,
    })
    expect(getMultipleAccounts).toHaveBeenCalledWith(
      [
        MARKET,
        await deriveMarketIntervalAddress(MARKET, 2n),
        await deriveMarketIntervalAddress(MARKET, 3n),
      ],
      expect.objectContaining({
        commitment: 'confirmed',
        minContextSlot: 660n,
      }),
    )
  })

  it('passes canonical interval accounts for pause and resume', async () => {
    const context = createContext()
    const request = { marketAddress: MARKET, tradePositionAddress: QUOTE }
    await sendPauseTradePosition({ ...context, request })
    expect(
      context.send.mock.calls[0][0].instructions[0].accounts?.[5].address,
    ).toBe(await deriveMarketIntervalAddress(MARKET, 3n))
    vi.mocked(accounts.fetchTradePosition).mockResolvedValue({
      data: createPosition({ pausedAtSlot: 490n }),
    } as Awaited<ReturnType<typeof accounts.fetchTradePosition>>)
    await sendUnpauseTradePosition({ ...context, request })
    expect(
      context.send.mock.calls[1][0].instructions[0].accounts?.[5].address,
    ).toBe(await deriveMarketIntervalAddress(MARKET, 3n))
  })

  it('supplies the canonical fee configuration to swapped-fund withdrawals', async () => {
    const context = createContext(1)
    await sendWithdrawSwapped({
      ...context,
      request: { marketAddress: MARKET, tradePositionAddress: BASE },
    })
    const instruction = context.send.mock.calls[0][0].instructions.at(-1)!
    expect(instruction.accounts?.[1]).toEqual({
      address: await deriveProgramConfigAddress(),
      role: AccountRole.READONLY,
    })
    expect(instruction.accounts?.[8].address).toBe(
      await deriveMarketIntervalAddress(MARKET, 3n),
    )
  })

  it('includes fee configuration in both closes and fits two positions in one transaction', async () => {
    const context = createContext()
    await sendClosePositions({
      ...context,
      request: { marketAddress: MARKET, tradePositionAddresses: [BASE, QUOTE] },
    })
    const instructions = context.send.mock.calls[0][0].instructions
    expect(instructions).toHaveLength(2)
    for (const instruction of instructions) {
      expect(instruction.accounts).toHaveLength(20)
      expect(instruction.accounts?.[1]).toEqual({
        address: await deriveProgramConfigAddress(),
        role: AccountRole.READONLY,
      })
      expect(instruction.accounts?.[14].address).toBe(
        await deriveMarketIntervalAddress(MARKET, 3n),
      )
    }
    const message = appendTransactionMessageInstructions(
      instructions,
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: WALLET as string as Blockhash,
          lastValidBlockHeight: 1000n,
        },
        setTransactionMessageFeePayer(
          WALLET,
          createTransactionMessage({ version: 0 }),
        ),
      ),
    )
    expect(
      getTransactionEncoder().encode(compileTransaction(message)).length,
    ).toBeLessThanOrEqual(1232)
  })

  it.each([
    sendPauseTradePosition,
    sendUnpauseTradePosition,
    sendWithdrawSwapped,
  ])(
    'rejects control of a position from another market before sending',
    async (sendPosition) => {
      const context = createContext()
      vi.mocked(accounts.fetchTradePosition).mockResolvedValue({
        data: createPosition({ market: BASE }),
      } as Awaited<ReturnType<typeof accounts.fetchTradePosition>>)
      await expect(
        sendPosition({
          ...context,
          request: { marketAddress: MARKET, tradePositionAddress: QUOTE },
        }),
      ).rejects.toThrow('different market')
      expect(context.send).not.toHaveBeenCalled()
    },
  )
})
