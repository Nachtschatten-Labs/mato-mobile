import { config, MAINNET_GENESIS_HASH } from '@/config'
import { getMarketDefinition } from '../constants'
import { getMarketDecoder } from '@/lib/generated/twob/src/generated/accounts'
import { TWOB_ANCHOR_PROGRAM_ADDRESS } from '@/lib/generated/twob/src/generated/programs'
import { decodeBase64 } from '../lib/bytes'
import type { TwobRpcClient } from './twob-client'

/** Recheck the live cluster and deployed accounts before every wallet prompt. */
export async function verifyTransactionEnvironment(rpc: TwobRpcClient) {
  if (config.programId !== TWOB_ANCHOR_PROGRAM_ADDRESS) {
    throw new Error(
      'The configured program does not match the verified Mato release.',
    )
  }
  const market = getMarketDefinition(1)
  const [genesis, program, account] = await Promise.all([
    rpc.getGenesisHash().send(),
    rpc
      .getAccountInfo(TWOB_ANCHOR_PROGRAM_ADDRESS, {
        commitment: 'confirmed',
        encoding: 'base64',
      })
      .send(),
    rpc
      .getAccountInfo(market.address, {
        commitment: 'confirmed',
        encoding: 'base64',
      })
      .send(),
  ])
  if (genesis !== MAINNET_GENESIS_HASH) {
    throw new Error(
      'The RPC endpoint is not Solana mainnet. Trading has been stopped.',
    )
  }
  if (!program.value?.executable) {
    throw new Error(
      'The verified Mato program is not deployed at this RPC endpoint.',
    )
  }
  if (
    !account.value ||
    account.value.owner !== TWOB_ANCHOR_PROGRAM_ADDRESS ||
    account.value.executable
  ) {
    throw new Error(
      'The selected market is not owned by the verified Mato program.',
    )
  }
  const decoded = getMarketDecoder().decode(decodeBase64(account.value.data[0]))
  if (
    decoded.baseMint !== market.baseMint ||
    decoded.quoteMint !== market.quoteMint ||
    decoded.id !== market.id
  ) {
    throw new Error(
      'The on-chain market does not match the verified SOL/USDC market.',
    )
  }
}
