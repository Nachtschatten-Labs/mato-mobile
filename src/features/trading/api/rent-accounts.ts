import { decodeBase64 } from '../lib/bytes'
import { encodeBase58 } from '../lib/base58'
import type { Address } from '@solana/kit'
import type { TwobRpcClient } from './twob-client'
import type { MarketInterval } from '@/lib/generated/twob/src/generated/accounts'
import {
  getMarketIntervalDecoder,
  getMarketIntervalDiscriminatorBytes,
} from '@/lib/generated/twob/src/generated/accounts'
import { TWOB_ANCHOR_PROGRAM_ADDRESS } from '@/lib/generated/twob/src/generated/programs'

type ProgramAccountResponse = {
  account: { data: [string, string]; lamports: bigint | number | string }
  pubkey: Address
}

type ProgramAccountsResponse =
  | Array<ProgramAccountResponse>
  | {
      value: Array<ProgramAccountResponse>
    }

function asProgramAccounts(response: ProgramAccountsResponse) {
  return Array.isArray(response) ? response : response.value
}

function toLamports(value: bigint | number | string) {
  return typeof value === 'bigint' ? value : BigInt(value)
}

export type OwnedMarketInterval = {
  address: Address
  data: MarketInterval
  lamports: bigint
}

export async function fetchOwnedMarketIntervals(
  rpcClient: TwobRpcClient,
  payer: string,
): Promise<Array<OwnedMarketInterval>> {
  const response = (await rpcClient
    .getProgramAccounts(TWOB_ANCHOR_PROGRAM_ADDRESS, {
      commitment: 'confirmed',
      encoding: 'base64',
      filters: [
        { dataSize: 1176n },
        {
          memcmp: {
            bytes: encodeBase58(
              Uint8Array.from(getMarketIntervalDiscriminatorBytes()),
            ) as never,
            encoding: 'base58',
            offset: 0n,
          },
        },
        {
          memcmp: {
            bytes: payer as never,
            encoding: 'base58',
            offset: 48n,
          },
        },
      ],
    })
    .send()) as ProgramAccountsResponse

  const decoder = getMarketIntervalDecoder()
  return asProgramAccounts(response)
    .map(({ account, pubkey }) => ({
      address: pubkey,
      data: decoder.decode(decodeBase64(account.data[0])),
      lamports: toLamports(account.lamports),
    }))
    .sort((left, right) => {
      if (left.data.index === right.data.index) return 0
      return left.data.index > right.data.index ? -1 : 1
    })
}
