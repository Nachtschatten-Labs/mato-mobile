import {
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
} from '@solana/kit'
import { config } from '@/config'
import { withRpcTimeout } from './rpc-transport'

export const rpc = createSolanaRpcFromTransport(
  withRpcTimeout(createDefaultRpcTransport({ url: config.rpcUrl })),
)
