import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchClosePositionsPreview } from './close-position-preview'
import { prepareClosePositionInstructions } from './twob-client'
import { readCloseSimulation } from '../lib/close-position-preview'
import type { Address } from '@solana/kit'
import type { TwobRpcClient } from './twob-client'

vi.mock('./twob-client', () => ({ prepareClosePositionInstructions: vi.fn() }))
vi.mock('../lib/close-position-preview', () => ({
  readCloseSimulation: vi.fn(),
}))
const key = '11111111111111111111111111111111' as Address
const second = 'So11111111111111111111111111111111111111112' as Address
const prepared = {
  instructions: [],
  marketAccount: { data: { startSlot: 0n } },
  tradePositionAccounts: [
    {
      lamports: 500n,
      data: {
        amount: 123n,
        authority: key,
        baseReceiver: key,
        quoteReceiver: key,
        payer: key,
      },
    },
    {
      lamports: 700n,
      data: {
        amount: 456n,
        authority: key,
        baseReceiver: key,
        quoteReceiver: key,
        payer: key,
      },
    },
  ],
}
const simulationSend = vi.fn()
const simulateTransaction = vi.fn(() => ({ send: simulationSend }))
const client = {
  runtime: {
    rpc: {
      getLatestBlockhash: () => ({
        send: async () => ({
          value: { blockhash: key, lastValidBlockHeight: 100n },
        }),
      }),
      simulateTransaction,
    },
  },
} as unknown as { runtime: { rpc: TwobRpcClient } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prepareClosePositionInstructions).mockResolvedValue(
    prepared as never,
  )
  vi.mocked(readCloseSimulation).mockReturnValue({
    remainingDepositAtoms: 12n,
    receivedAtoms: 34n,
    feeAtoms: 1n,
  })
  simulationSend.mockResolvedValue({
    context: { slot: 10n },
    value: { err: null, logs: [] },
  })
})
describe('close preview RPC', () => {
  it('simulates a whole batch without requesting signatures and returns each payout separately', async () => {
    const result = await fetchClosePositionsPreview({
      rpcClient: client.runtime.rpc,
      authority: key,
      marketAddress: key,
      positionAddresses: [key, second],
    })
    expect(simulateTransaction).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      expect.objectContaining({
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: 'confirmed',
        encoding: 'base64',
      }),
    )
    expect(result).toHaveLength(2)
    expect(result.map((item) => item.positionRentLamports)).toEqual([
      500n,
      700n,
    ])
    expect(readCloseSimulation).toHaveBeenCalledWith(
      expect.objectContaining({ positionAddress: second }),
    )
    expect(prepareClosePositionInstructions).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: expect.objectContaining({ address: key }),
        request: { marketAddress: key, tradePositionAddresses: [key, second] },
      }),
    )
  })
  it('returns the entire deposit for a successfully simulated close before trading starts', async () => {
    simulationSend.mockResolvedValue({
      context: { slot: 0n },
      value: { err: null, logs: [] },
    })
    const result = await fetchClosePositionsPreview({
      rpcClient: client.runtime.rpc,
      authority: key,
      marketAddress: key,
      positionAddresses: [key, second],
    })
    expect(result[0]).toMatchObject({
      remainingDepositAtoms: 123n,
      receivedAtoms: 0n,
      feeAtoms: 0n,
    })
    expect(readCloseSimulation).not.toHaveBeenCalled()
  })
  it('never exposes a successful preview when the simulation fails', async () => {
    simulationSend.mockResolvedValue({
      context: { slot: 10n },
      value: { err: { InstructionError: [0, 'InsufficientFunds'] }, logs: [] },
    })
    await expect(
      fetchClosePositionsPreview({
        rpcClient: client.runtime.rpc,
        authority: key,
        marketAddress: key,
        positionAddresses: [key, second],
      }),
    ).rejects.toThrow('cannot be closed')
    expect(readCloseSimulation).not.toHaveBeenCalled()
  })
})
