import { describe, expect, it, vi } from 'vitest'
import {
  getMarketDecoder,
  getMarketEncoder,
} from '@/lib/generated/twob/src/generated/accounts'
import { TWOB_ANCHOR_PROGRAM_ADDRESS } from '@/lib/generated/twob/src/generated/programs'
import { MAINNET_GENESIS_HASH } from '@/config'
import { verifyTransactionEnvironment } from './verify-network'
import type { TwobRpcClient } from './twob-client'
import marketFixture from './fixtures/mainnet-market.json'

function setup({
  genesis = MAINNET_GENESIS_HASH,
  executable = true,
  owner = TWOB_ANCHOR_PROGRAM_ADDRESS as string,
  marketData = marketFixture.account.data[0],
} = {}) {
  const account = vi.fn((address: string) => ({
    send: async () => ({
      value:
        address === TWOB_ANCHOR_PROGRAM_ADDRESS
          ? { executable }
          : { executable: false, owner, data: [marketData, 'base64'] },
    }),
  }))
  const rpc = {
    getGenesisHash: () => ({ send: async () => genesis }),
    getAccountInfo: account,
  } as unknown as TwobRpcClient
  return { rpc, account }
}

describe('live transaction environment verification', () => {
  it('accepts the pinned executable and observed mainnet market', async () => {
    const { rpc, account } = setup()
    await expect(verifyTransactionEnvironment(rpc)).resolves.toBeUndefined()
    expect(account).toHaveBeenCalledTimes(2)
  })
  it('rejects a different cluster before requesting approval', async () => {
    await expect(
      verifyTransactionEnvironment(setup({ genesis: 'devnet' }).rpc),
    ).rejects.toThrow('not Solana mainnet')
  })
  it('rejects a non-executable program address', async () => {
    await expect(
      verifyTransactionEnvironment(setup({ executable: false }).rpc),
    ).rejects.toThrow('not deployed')
  })
  it('rejects a market account owned by another program', async () => {
    await expect(
      verifyTransactionEnvironment(
        setup({ owner: '11111111111111111111111111111111' }).rpc,
      ),
    ).rejects.toThrow('not owned')
  })
  it('rejects a structurally valid market with mismatched mints', async () => {
    const decoded = getMarketDecoder().decode(
      Buffer.from(marketFixture.account.data[0], 'base64'),
    )
    const marketData = Buffer.from(
      getMarketEncoder().encode({ ...decoded, baseMint: decoded.quoteMint }),
    ).toString('base64')
    await expect(
      verifyTransactionEnvironment(setup({ marketData }).rpc),
    ).rejects.toThrow('does not match')
  })
  it('propagates a failed RPC instead of approving from cached verification', async () => {
    const { rpc, account } = setup()
    account.mockImplementationOnce(() => ({
      send: async () => {
        throw new Error('offline')
      },
    }))
    await expect(verifyTransactionEnvironment(rpc)).rejects.toThrow('offline')
  })
})
