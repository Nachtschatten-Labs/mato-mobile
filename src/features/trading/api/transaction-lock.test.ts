import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBase58Decoder, signatureBytes } from '@solana/kit'
import type { Address } from '@solana/kit'
import { sendInstructions } from './twob-client'
import type { TwobRpcClient } from './twob-client'

const mocks = vi.hoisted(() => ({ verify: vi.fn() }))
vi.mock('@/integrations/solana/transaction-policy', () => ({
  assertTransactionsEnabled: () => {},
}))
vi.mock('./verify-network', () => ({
  verifyTransactionEnvironment: mocks.verify,
}))
const address = '11111111111111111111111111111111' as Address
const signature = getBase58Decoder().decode(new Uint8Array(64).fill(1))
const confirmed = { value: [{ confirmationStatus: 'confirmed', err: null }] }

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function context() {
  const send = vi.fn(async () => [signatureBytes(new Uint8Array(64).fill(1))])
  const statusSend = vi.fn(async () => confirmed)
  const blockhashSend = vi.fn(async () => ({
    value: { blockhash: address, lastValidBlockHeight: 100n },
  }))
  const rpc = {
    getLatestBlockhash: () => ({ send: blockhashSend }),
    getSignatureStatuses: () => ({ send: statusSend }),
  } as unknown as TwobRpcClient
  return {
    context: { rpc, signer: { address, signAndSendTransactions: send } },
    send,
    statusSend,
    blockhashSend,
  }
}
beforeEach(() => {
  mocks.verify.mockReset().mockResolvedValue(undefined)
})

describe('cross-screen transaction lock', () => {
  it('rejects a second mutation immediately during verification and never queues it', async () => {
    const verification = deferred<void>()
    mocks.verify.mockReturnValueOnce(verification.promise)
    const first = context()
    const second = context()
    const pending = sendInstructions(first.context, [])
    await expect(sendInstructions(second.context, [])).rejects.toThrow(
      'Another transaction is still pending',
    )
    expect(mocks.verify).toHaveBeenCalledTimes(1)
    expect(second.send).not.toHaveBeenCalled()
    verification.resolve()
    await expect(pending).resolves.toBe(signature)
    expect(second.send).not.toHaveBeenCalled()
  })
  it('keeps the lock after wallet submission until confirmed settlement', async () => {
    const confirmation = deferred<typeof confirmed>()
    const started = deferred<void>()
    const first = context()
    const second = context()
    first.statusSend.mockImplementationOnce(() => {
      started.resolve()
      return confirmation.promise
    })
    const pending = sendInstructions(first.context, [])
    await started.promise
    expect(first.send).toHaveBeenCalledOnce()
    await expect(sendInstructions(second.context, [])).rejects.toThrow(
      'Another transaction is still pending',
    )
    expect(second.send).not.toHaveBeenCalled()
    confirmation.resolve(confirmed)
    await expect(pending).resolves.toBe(signature)
    await expect(sendInstructions(second.context, [])).resolves.toBe(signature)
  })
  it('releases the lock when verification fails', async () => {
    mocks.verify.mockRejectedValueOnce(new Error('wrong cluster'))
    const next = context()
    await expect(sendInstructions(context().context, [])).rejects.toThrow(
      'wrong cluster',
    )
    await expect(sendInstructions(next.context, [])).resolves.toBe(signature)
  })
  it('releases the lock when the user declines wallet approval', async () => {
    const first = context()
    first.send.mockRejectedValueOnce(new Error('User declined'))
    await expect(sendInstructions(first.context, [])).rejects.toThrow(
      'User declined',
    )
    await expect(sendInstructions(context().context, [])).resolves.toBe(
      signature,
    )
  })
  it('releases the lock on a confirmation error while retaining the sent signature', async () => {
    const first = context()
    first.statusSend.mockRejectedValueOnce(new Error('offline'))
    await expect(sendInstructions(first.context, [])).rejects.toThrow(signature)
    await expect(sendInstructions(context().context, [])).resolves.toBe(
      signature,
    )
  })
})
