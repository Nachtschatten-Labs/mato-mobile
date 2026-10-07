import {
  AccountRole,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU32Encoder,
  getU64Encoder,
} from '@solana/kit'
import type { Address, TransactionSigner } from '@solana/kit'
import type { TwobRpcClient } from './twob-client'

export const WRAPPED_SOL_MINT =
  'So11111111111111111111111111111111111111112' as Address
export const TOKEN_PROGRAM =
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address
export const TOKEN_2022_PROGRAM =
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' as Address
const ASSOCIATED_TOKEN_PROGRAM =
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' as Address
const SYSTEM_PROGRAM = '11111111111111111111111111111111' as Address

export async function detectTokenProgram(rpc: TwobRpcClient, mint: Address) {
  const account = await rpc
    .getAccountInfo(mint, { commitment: 'confirmed', encoding: 'base64' })
    .send()
  if (!account.value) throw new Error('The token mint account does not exist.')
  if (
    account.value.owner !== TOKEN_PROGRAM &&
    account.value.owner !== TOKEN_2022_PROGRAM
  ) {
    throw new Error('The token mint is not owned by a supported token program.')
  }
  return { programAddress: account.value.owner }
}

export async function deriveWrappedSolAddress(owner: Address) {
  const [address] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [owner, TOKEN_PROGRAM, WRAPPED_SOL_MINT].map((value) =>
      getAddressEncoder().encode(value),
    ),
  })
  return address
}

export async function prepareWrapInstructions({
  amount,
  signer,
}: {
  amount: bigint
  signer: TransactionSigner
}) {
  if (amount <= 0n || amount > 0xffffffffffffffffn)
    throw new Error('Invalid SOL wrap amount.')
  const ata = await deriveWrappedSolAddress(signer.address)
  return [
    // Idempotent ATA creation allows the account to be created while approval is open.
    {
      programAddress: ASSOCIATED_TOKEN_PROGRAM,
      accounts: [
        { address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer },
        { address: ata, role: AccountRole.WRITABLE },
        { address: signer.address, role: AccountRole.READONLY },
        { address: WRAPPED_SOL_MINT, role: AccountRole.READONLY },
        { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
        { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      ],
      data: new Uint8Array([1]),
    },
    {
      programAddress: SYSTEM_PROGRAM,
      accounts: [
        { address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer },
        { address: ata, role: AccountRole.WRITABLE },
      ],
      data: new Uint8Array([
        ...getU32Encoder().encode(2),
        ...getU64Encoder().encode(amount),
      ]),
    },
    // SPL Token SyncNative credits the deposited lamports as wrapped SOL.
    {
      programAddress: TOKEN_PROGRAM,
      accounts: [{ address: ata, role: AccountRole.WRITABLE }],
      data: new Uint8Array([17]),
    },
  ]
}

export async function prepareUnwrapInstructions(signer: TransactionSigner) {
  const ata = await deriveWrappedSolAddress(signer.address)
  // A successful close-position instruction creates/funds this ATA before this
  // instruction executes. Return native SOL and account rent to the owner.
  return [
    {
      programAddress: TOKEN_PROGRAM,
      accounts: [
        { address: ata, role: AccountRole.WRITABLE },
        { address: signer.address, role: AccountRole.WRITABLE },
        { address: signer.address, role: AccountRole.READONLY_SIGNER, signer },
      ],
      data: new Uint8Array([9]),
    },
  ]
}
