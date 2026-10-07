import { describe, expect, it, vi } from 'vitest'
import type { TwobRpcClient } from './twob-client'
import type { Address } from '@solana/kit'
import { getSolOrderWrapAmount } from './sol-order-funding'

const OWNER = '11111111111111111111111111111111' as Address
const ATA = 'So11111111111111111111111111111111111111112' as Address

function setup(nativeLamports: bigint, wrappedAtoms: bigint | null = null) {
  const fetchBalance = vi.fn(async () => ({ value: nativeLamports }))
  const accountRead = vi.fn(async () => ({
    value: wrappedAtoms === null ? null : { owner: 'token-program' },
  }))
  const wrappedRead = vi.fn(async () => ({
    value: { amount: (wrappedAtoms ?? 0n).toString() },
  }))
  const client = {
    getBalance: () => ({ send: fetchBalance }),
    getAccountInfo: () => ({ send: accountRead }),
    getTokenAccountBalance: () => ({ send: wrappedRead }),
  } as unknown as TwobRpcClient
  const fund = (amount: bigint) =>
    getSolOrderWrapAmount({ amount, rpcClient: client, owner: OWNER })
  return { accountRead, client, fetchBalance, fund, wrappedRead }
}

describe('SOL order funding', () => {
  it.each([100_000_000n, 500_000_000n])(
    'rejects an order of %s lamports against the current balance',
    async (amount) => {
      const { fund } = setup(104_218_717n)
      await expect(fund(amount)).rejects.toThrow(
        'Available to sell: 0.084218717 SOL after reserving 0.02 SOL',
      )
    },
  )

  it.each([10_000_000n, 50_000_000n, 84_218_717n])(
    'allows a funded order of %s lamports',
    async (amount) => {
      const { fund, fetchBalance, wrappedRead } = setup(104_218_717n)
      await expect(fund(amount)).resolves.toBe(amount)
      expect(fetchBalance).toHaveBeenCalledOnce()
      expect(wrappedRead).not.toHaveBeenCalled()
    },
  )

  it('allows 0.5 SOL when the wallet actually holds 0.59 SOL', async () => {
    const { fund } = setup(590_000_000n)
    await expect(fund(500_000_000n)).resolves.toBe(500_000_000n)
  })

  it('wraps only the shortfall after reading existing wrapped SOL', async () => {
    const { fund, wrappedRead } = setup(120_000_000n, 480_000_000n)
    await expect(fund(500_000_000n)).resolves.toBe(20_000_000n)
    expect(wrappedRead).toHaveBeenCalledOnce()
  })

  it('does not wrap when the wrapped balance already covers the order', async () => {
    const { fund } = setup(20_000_000n, 500_000_000n)
    await expect(fund(500_000_000n)).resolves.toBe(0n)
  })

  it('requires native SOL for fees even when enough wrapped SOL exists', async () => {
    const { fund } = setup(19_999_999n, 500_000_000n)
    await expect(fund(500_000_000n)).rejects.toThrow(
      'Not enough native SOL for fees and account rent.',
    )
  })

  it.each(['fetchBalance', 'accountRead', 'wrappedRead'] as const)(
    'stops funding when %s fails instead of assuming a zero balance',
    async (read) => {
      const context = setup(590_000_000n, 100_000_000n)
      const error = new Error('RPC unavailable')
      context[read].mockRejectedValueOnce(error)
      await expect(context.fund(500_000_000n)).rejects.toBe(error)
    },
  )
})
