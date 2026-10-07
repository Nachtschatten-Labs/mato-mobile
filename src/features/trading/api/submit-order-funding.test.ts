import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TwobRpcClient } from './twob-client'
import * as tokenInstructions from './token-instructions'
import {
  createNoopSigner,
  getCompiledTransactionMessageDecoder,
  signatureBytes,
} from '@solana/kit'
import type { Address, Transaction } from '@solana/kit'
import * as accounts from '@/lib/generated/twob/src/generated/accounts'
import { TWOB_ANCHOR_PROGRAM_ADDRESS } from '@/lib/generated/twob/src/generated/programs'
import { sendSubmitOrder } from './twob-client'
import mainnetMarket from './fixtures/mainnet-market.json'

const OWNER = '11111111111111111111111111111112' as Address
const SOL = 'So11111111111111111111111111111111111111112' as Address
const mocks = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('@/integrations/solana/transaction-policy', () => ({
  assertTransactionsEnabled: () => {},
}))
vi.mock('./verify-network', () => ({
  verifyTransactionEnvironment: async () => {},
}))
vi.mock('./token-instructions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./token-instructions')>()),
  detectTokenProgram: async () => ({
    programAddress: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  }),
}))

beforeEach(() => {
  mocks.send
    .mockReset()
    .mockResolvedValue([signatureBytes(new Uint8Array(64).fill(1))])
  vi.spyOn(accounts, 'fetchMarket').mockResolvedValue({
    data: accounts
      .getMarketDecoder()
      .decode(Buffer.from(mainnetMarket.account.data[0], 'base64')),
  } as Awaited<ReturnType<typeof accounts.fetchMarket>>)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function setup(nativeLamports: bigint, wrappedAtoms: bigint | null = null) {
  const rpc = {
    getBalance: () => ({ send: async () => ({ value: nativeLamports }) }),
    getAccountInfo: () => ({
      send: async () => ({ value: wrappedAtoms === null ? null : {} }),
    }),
    getTokenAccountBalance: () => ({
      send: async () => ({ value: { amount: wrappedAtoms!.toString() } }),
    }),
    getSlot: () => ({ send: async () => BigInt(mainnetMarket.slot) }),
    getLatestBlockhash: () => ({
      send: async () => ({
        value: {
          blockhash: '11111111111111111111111111111111',
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
  const prepareWrap = vi.spyOn(tokenInstructions, 'prepareWrapInstructions')
  const onBeforeSend = vi.fn()
  const submit = (amount: bigint, cachedWrappedAtoms = 0n) =>
    sendSubmitOrder({
      context: {
        rpc,
        signer: { address: OWNER, signAndSendTransactions: mocks.send },
      },
      onBeforeSend,
      request: {
        amount,
        durationSlots: 120,
        existingWrappedAtoms: cachedWrappedAtoms,
        id: 1,
        inputMintAddress: SOL,
        isBuy: false,
        marketAddress: mainnetMarket.address as Address,
      },
    })
  return { submit, prepareWrap, onBeforeSend }
}

it('rejects an unfunded SOL order before wrapping or wallet approval', async () => {
  const { submit, prepareWrap, onBeforeSend } = setup(104_218_717n)
  // An outdated wrapped balance must not make an unfunded order appear viable.
  await expect(submit(500_000_000n, 500_000_000n)).rejects.toThrow(
    'Available to sell: 0.084218717 SOL',
  )
  expect(prepareWrap).not.toHaveBeenCalled()
  expect(onBeforeSend).not.toHaveBeenCalled()
  expect(mocks.send).not.toHaveBeenCalled()
})

it('submits 0.5 SOL with only the current wrapped-balance shortfall', async () => {
  const { submit, prepareWrap } = setup(120_000_000n, 480_000_000n)
  await expect(submit(500_000_000n)).resolves.toBeTypeOf('string')
  expect(prepareWrap).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 20_000_000n }),
  )
  const transaction = mocks.send.mock.calls[0][0][0] as Transaction
  const message = getCompiledTransactionMessageDecoder().decode(
    transaction.messageBytes,
  )
  if (message.version !== 0) throw new Error('Expected a version 0 transaction')
  const transfer = message.instructions[1]
  expect(message.staticAccounts[transfer.programAddressIndex]).toBe(
    '11111111111111111111111111111111',
  )
  expect(Buffer.from(transfer.data!).readBigUInt64LE(4)).toBe(20_000_000n)
})
