import type { TwobRpcClient } from './twob-client'
import { deriveWrappedSolAddress } from './token-instructions'
import type { Address } from '@solana/kit'
import { NATIVE_FEE_BUFFER_ATOMS, NATIVE_SOL_DECIMALS } from '../constants'
import { getSpendableNativeAtoms } from '../lib/amounts'
import { formatAtoms } from '../lib/format'

async function fetchWrappedBalance(rpcClient: TwobRpcClient, owner: Address) {
  const ata = await deriveWrappedSolAddress(owner)
  const account = await rpcClient
    .getAccountInfo(ata, { commitment: 'confirmed', encoding: 'base64' })
    .send()
  if (account.value === null) return 0n

  // The SDK's fetchWsolBalance treats every RPC failure as a zero balance.
  // Only a missing account means zero; propagate failed reads to avoid overwrapping.
  const balance = await rpcClient
    .getTokenAccountBalance(ata, { commitment: 'confirmed' })
    .send()
  return BigInt(balance.value.amount)
}

export async function getSolOrderWrapAmount({
  amount,
  rpcClient,
  owner,
}: {
  amount: bigint
  rpcClient: TwobRpcClient
  owner: Address
}) {
  // Fund from current chain data instead of balances captured when the form rendered.
  const [nativeLamports, wrappedAtoms] = await Promise.all([
    rpcClient
      .getBalance(owner, { commitment: 'confirmed' })
      .send()
      .then((response) => response.value),
    fetchWrappedBalance(rpcClient, owner),
  ])
  const reserve = formatAtoms(NATIVE_FEE_BUFFER_ATOMS, NATIVE_SOL_DECIMALS)
  if (nativeLamports < NATIVE_FEE_BUFFER_ATOMS) {
    throw new Error(
      `Not enough native SOL for fees and account rent. Keep at least ${reserve} SOL in your wallet.`,
    )
  }

  const availableAtoms = getSpendableNativeAtoms(nativeLamports, wrappedAtoms)
  if (amount > availableAtoms) {
    const available = formatAtoms(availableAtoms, NATIVE_SOL_DECIMALS, 9)
    throw new Error(
      `Amount exceeds your current SOL balance. Available to sell: ${available} SOL after reserving ${reserve} SOL for fees and account rent.`,
    )
  }

  return amount > wrappedAtoms ? amount - wrappedAtoms : 0n
}
