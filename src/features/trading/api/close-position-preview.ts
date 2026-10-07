import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import { prepareClosePositionInstructions } from './twob-client'
import { readCloseSimulation } from '../lib/close-position-preview'
import type { Address } from '@solana/kit'
import type { TwobRpcClient } from './twob-client'
import type { ClosePositionPreview } from '../lib/close-position-preview'

export async function fetchClosePositionsPreview({
  rpcClient,
  marketAddress,
  positionAddresses,
  authority,
  signal,
}: {
  rpcClient: TwobRpcClient
  marketAddress: Address
  positionAddresses: Address[]
  authority: Address
  signal?: AbortSignal
}): Promise<ClosePositionPreview[]> {
  const [{ instructions, marketAccount, tradePositionAccounts }, blockhash] =
    await Promise.all([
      prepareClosePositionInstructions({
        rpcClient,
        request: { marketAddress, tradePositionAddresses: positionAddresses },
        authority: createNoopSigner(authority),
      }),
      rpcClient
        .getLatestBlockhash({ commitment: 'confirmed' })
        .send({ abortSignal: signal }),
    ])
  const transaction = pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayer(authority, message),
    (message) =>
      setTransactionMessageLifetimeUsingBlockhash(blockhash.value, message),
    (message) => appendTransactionMessageInstructions(instructions, message),
    compileTransaction,
  )
  // No wallet signature or transaction submission is involved in this preview.
  const simulation = await rpcClient
    .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
      encoding: 'base64',
      commitment: 'confirmed',
      sigVerify: false,
      replaceRecentBlockhash: true,
    })
    .send({ abortSignal: signal })
  if (simulation.value.err)
    throw new Error(
      'The position cannot be closed right now. Check your SOL balance and refresh the preview.',
    )
  return tradePositionAccounts.map((account, index) => {
    const positionAddress = positionAddresses[index]
    const position = account.data
    const settlement =
      simulation.context.slot <= marketAccount.data.startSlot
        ? {
            remainingDepositAtoms: position.amount,
            receivedAtoms: 0n,
            feeAtoms: 0n,
          }
        : readCloseSimulation({
            logs: simulation.value.logs ?? [],
            position,
            positionAddress,
          })
    return {
      ...settlement,
      positionRentLamports: account.lamports,
      baseReceiver: position.baseReceiver,
      quoteReceiver: position.quoteReceiver,
      rentReceiver: position.payer,
      simulatedAtMs: Date.now(),
    }
  })
}

export async function fetchClosePositionPreview(args: {
  rpcClient: TwobRpcClient
  marketAddress: Address
  positionAddress: Address
  authority: Address
  signal?: AbortSignal
}) {
  const previews = await fetchClosePositionsPreview({
    ...args,
    positionAddresses: [args.positionAddress],
  })
  return previews[0]
}
