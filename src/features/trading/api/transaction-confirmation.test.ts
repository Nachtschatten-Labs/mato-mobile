import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBase58Decoder } from '@solana/kit'
import { waitForConfirmedSignature } from './twob-client'
import type { TwobRpcClient } from './twob-client'

const signature = getBase58Decoder().decode(new Uint8Array(64).fill(1))
function setup(status: unknown = null, height = 90n) {
  const statusSend = vi.fn(async () => ({ value: [status] }))
  const blockSend = vi.fn(async () => height)
  const rpc = {
    getSignatureStatuses: () => ({ send: statusSend }),
    getBlockHeight: () => ({ send: blockSend }),
  } as unknown as TwobRpcClient
  return { rpc, statusSend, blockSend }
}
afterEach(() => vi.useRealTimers())

describe('transaction confirmation', () => {
  it.each(['confirmed', 'finalized'])(
    'accepts %s success',
    async (confirmationStatus) => {
      const { rpc, blockSend } = setup({ confirmationStatus, err: null })
      await expect(
        waitForConfirmedSignature(rpc, signature, 100n),
      ).resolves.toBeUndefined()
      expect(blockSend).not.toHaveBeenCalled()
    },
  )
  it('rejects an on-chain error even if the transaction is confirmed', async () => {
    const { rpc } = setup({
      confirmationStatus: 'confirmed',
      err: { InstructionError: [0, { Custom: 6007 }] },
    })
    await expect(waitForConfirmedSignature(rpc, signature)).rejects.toThrow(
      '6007',
    )
  })
  it('expires a missing signature and preserves the signature for investigation', async () => {
    const { rpc } = setup(null, 101n)
    await expect(
      waitForConfirmedSignature(rpc, signature, 100n),
    ).rejects.toThrow(`Check signature ${signature} before retrying`)
  })
  it('does not report processed transactions as successful', async () => {
    vi.useFakeTimers()
    const { rpc, statusSend } = setup({
      confirmationStatus: 'processed',
      err: null,
    })
    statusSend
      .mockResolvedValueOnce({
        value: [{ confirmationStatus: 'processed', err: null }],
      })
      .mockResolvedValueOnce({
        value: [{ confirmationStatus: 'confirmed', err: null }],
      })
    const pending = waitForConfirmedSignature(rpc, signature, 100n)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(pending).resolves.toBeUndefined()
    expect(statusSend).toHaveBeenCalledTimes(2)
  })
  it('retains the sent signature when confirmation RPC goes offline', async () => {
    const { rpc, statusSend } = setup()
    statusSend.mockRejectedValueOnce(new Error('offline'))
    await expect(waitForConfirmedSignature(rpc, signature)).rejects.toThrow(
      `Check signature ${signature} before retrying`,
    )
  })
})
