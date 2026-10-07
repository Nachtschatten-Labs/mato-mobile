import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TwobRpcClient } from './twob-client'
import {
  createNoopSigner,
  getCompiledTransactionMessageDecoder,
  getTransactionEncoder,
  signatureBytes,
} from '@solana/kit'
import type { Address, Transaction } from '@solana/kit'
import * as accounts from '@/lib/generated/twob/src/generated/accounts'
import { TWOB_ANCHOR_PROGRAM_ADDRESS } from '@/lib/generated/twob/src/generated/programs'
import { deriveAssociatedTokenAddress, sendSubmitOrder } from './twob-client'
import mainnetMarket from './fixtures/mainnet-market.json'

const OWNER = '11111111111111111111111111111112' as Address
const SOL = 'So11111111111111111111111111111111111111112' as Address
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' as Address
const OTHER_MINT = '11111111111111111111111111111113' as Address
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address
const TOKEN_2022_PROGRAM =
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' as Address
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const SYSTEM_PROGRAM = '11111111111111111111111111111111'
const mocks = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('@/integrations/solana/transaction-policy', () => ({
  assertTransactionsEnabled: () => {},
}))
vi.mock('./verify-network', () => ({
  verifyTransactionEnvironment: async () => {},
}))

beforeEach(() => {
  mocks.send
    .mockReset()
    .mockResolvedValue([signatureBytes(new Uint8Array(64).fill(1))])
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

async function setup({
  isBuy = false,
  baseMint = SOL,
  quoteMint = USDC,
  outputTokenProgram = TOKEN_PROGRAM,
  receiverExists = false,
}: {
  isBuy?: boolean
  baseMint?: Address
  quoteMint?: Address
  outputTokenProgram?: Address
  receiverExists?: boolean
} = {}) {
  const market = accounts
    .getMarketDecoder()
    .decode(Buffer.from(mainnetMarket.account.data[0], 'base64'))
  vi.spyOn(accounts, 'fetchMarket').mockResolvedValue({
    data: { ...market, baseMint, quoteMint },
  } as Awaited<ReturnType<typeof accounts.fetchMarket>>)
  const inputMint = isBuy ? quoteMint : baseMint
  const outputMint = isBuy ? baseMint : quoteMint
  const receiverAta = await deriveAssociatedTokenAddress({
    mint: outputMint,
    owner: OWNER,
    tokenProgram: outputTokenProgram,
  })
  const receiverRead = vi.fn(async () => ({
    value: receiverExists ? { owner: outputTokenProgram } : null,
  }))
  const getAccountInfo = vi.fn((address: Address) => ({
    send: async () => {
      if (address === inputMint) return { value: { owner: TOKEN_PROGRAM } }
      if (address === outputMint)
        return { value: { owner: outputTokenProgram } }
      if (address === receiverAta) return receiverRead()
      return { value: null }
    },
  }))
  const rpc = {
    getBalance: () => ({ send: async () => ({ value: 1_000_000_000n }) }),
    getAccountInfo,
    getSlot: () => ({ send: async () => BigInt(mainnetMarket.slot) }),
    getLatestBlockhash: () => ({
      send: async () => ({
        value: {
          blockhash: SYSTEM_PROGRAM,
          lastValidBlockHeight: 100n,
        },
      }),
    }),
    getSignatureStatuses: () => ({
      send: async () => ({
        value: [{ confirmationStatus: 'confirmed', err: null }],
      }),
    }),
  } as unknown as TwobRpcClient
  const onBeforeSend = vi.fn()
  const submit = () =>
    sendSubmitOrder({
      context: {
        rpc,
        signer: { address: OWNER, signAndSendTransactions: mocks.send },
      },
      onBeforeSend,
      request: {
        amount: 10_000_000n,
        durationSlots: 120,
        id: 1,
        inputMintAddress: inputMint,
        isBuy,
        marketAddress: mainnetMarket.address as Address,
      },
    })
  return { getAccountInfo, onBeforeSend, receiverAta, receiverRead, submit }
}

function submittedInstructions() {
  expect(mocks.send).toHaveBeenCalledTimes(1)
  const transaction = mocks.send.mock.calls[0][0][0] as Transaction
  // Account creation and SOL wrapping must fit alongside the order.
  expect(
    getTransactionEncoder().encode(transaction).length,
  ).toBeLessThanOrEqual(1232)
  const message = getCompiledTransactionMessageDecoder().decode(
    transaction.messageBytes,
  )
  if (message.version !== 0) throw new Error('Expected a version 0 transaction')
  return message.instructions.map((instruction) => ({
    program: message.staticAccounts[instruction.programAddressIndex],
    accounts: instruction.accountIndices?.map(
      (index) => message.staticAccounts[index],
    ),
    data: instruction.data,
  }))
}

it.each([
  { name: 'selling SOL for USDC', isBuy: false, baseMint: SOL },
  { name: 'buying a non-SOL base token', isBuy: true, baseMint: OTHER_MINT },
  {
    name: 'buying a Token-2022 base token',
    isBuy: true,
    baseMint: OTHER_MINT,
    outputTokenProgram: TOKEN_2022_PROGRAM,
  },
  {
    name: 'selling for a Token-2022 quote token',
    isBuy: false,
    baseMint: SOL,
    quoteMint: OTHER_MINT,
    outputTokenProgram: TOKEN_2022_PROGRAM,
  },
])('creates the missing receiving account when $name', async (options) => {
  const { getAccountInfo, receiverAta, submit } = await setup(options)
  await expect(submit()).resolves.toBeTypeOf('string')

  expect(getAccountInfo).toHaveBeenCalledWith(receiverAta, {
    commitment: 'confirmed',
    encoding: 'base64',
  })
  const instructions = submittedInstructions()
  expect(instructions.at(-1)?.program).toBe(TWOB_ANCHOR_PROGRAM_ADDRESS)
  expect(instructions.at(-2)).toEqual({
    program: ASSOCIATED_TOKEN_PROGRAM,
    accounts: [
      OWNER,
      receiverAta,
      OWNER,
      options.isBuy ? options.baseMint : (options.quoteMint ?? USDC),
      SYSTEM_PROGRAM,
      options.outputTokenProgram ?? TOKEN_PROGRAM,
    ],
    data: new Uint8Array([1]), // CreateIdempotent tolerates concurrent creation.
  })
  expect(instructions).toHaveLength(options.baseMint === SOL ? 5 : 2)
  // The order still deposits through the input mint's own token program.
  expect(instructions.at(-1)?.accounts?.[13]).toBe(TOKEN_PROGRAM)
})

it.each([false, true])(
  'omits creation when the receiving account already exists (buy=%s)',
  async (isBuy) => {
    const { receiverRead, submit } = await setup({
      baseMint: OTHER_MINT,
      isBuy,
      receiverExists: true,
    })
    await submit()
    expect(receiverRead).toHaveBeenCalledOnce()
    expect(submittedInstructions()).toHaveLength(1)
  },
)

it.each([
  { isBuy: true, baseMint: SOL, quoteMint: USDC },
  { isBuy: false, baseMint: OTHER_MINT, quoteMint: SOL },
])(
  'skips receiving-account setup for native SOL (buy=$isBuy)',
  async (options) => {
    const { getAccountInfo, receiverRead, submit } = await setup(options)
    await submit()
    expect(getAccountInfo).toHaveBeenCalledExactlyOnceWith(
      options.isBuy ? options.quoteMint : options.baseMint,
      { commitment: 'confirmed', encoding: 'base64' },
    )
    expect(receiverRead).not.toHaveBeenCalled()
    expect(submittedInstructions()).toHaveLength(1)
  },
)

it('stops before wallet approval if the receiving-account check fails', async () => {
  const { onBeforeSend, receiverRead, submit } = await setup()
  receiverRead.mockRejectedValueOnce(new Error('RPC unavailable'))
  await expect(submit()).rejects.toThrow('RPC unavailable')
  expect(onBeforeSend).not.toHaveBeenCalled()
  expect(mocks.send).not.toHaveBeenCalled()
})
