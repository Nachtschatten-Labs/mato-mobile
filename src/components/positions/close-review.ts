import type { Address } from '@solana/kit'
import type { ClosePositionPreview } from '../../features/trading/lib/close-position-preview'

export type ReviewPosition = {
  address: Address
  data: {
    authority: Address
    market: Address
    baseReceiver: Address
    quoteReceiver: Address
    payer: Address
  }
}

// Keep the simulated amounts tied to the exact wallet, ordered positions and
// recipient accounts the user saw. This runs again immediately before signing.
export function assertCloseReview({
  owner,
  reviewOwner,
  market,
  reviewed,
  selected,
  previews,
  now = Date.now(),
}: {
  owner: Address | null
  reviewOwner: Address | undefined
  market: Address
  reviewed: readonly ReviewPosition[]
  selected: readonly ReviewPosition[]
  previews: readonly ClosePositionPreview[] | undefined
  now?: number
}) {
  if (!owner || owner !== reviewOwner) {
    throw new Error('Your wallet changed. Open a new close review.')
  }
  if (
    !previews ||
    !selected.length ||
    previews.length !== selected.length ||
    reviewed.length !== selected.length
  ) {
    throw new Error('Refresh the close preview before continuing.')
  }
  selected.forEach((position, index) => {
    const preview = previews[index]
    if (
      position.address !== reviewed[index].address ||
      position.data.authority !== owner ||
      position.data.market !== market ||
      preview.baseReceiver !== position.data.baseReceiver ||
      preview.quoteReceiver !== position.data.quoteReceiver ||
      preview.rentReceiver !== position.data.payer
    ) {
      throw new Error(
        'The position or recipient changed. Open a new close review.',
      )
    }
    if (
      !Number.isFinite(preview.simulatedAtMs) ||
      now - preview.simulatedAtMs > 20_000 ||
      preview.simulatedAtMs > now + 1_000 ||
      preview.receivedAtoms < 0n ||
      preview.remainingDepositAtoms < 0n ||
      preview.feeAtoms < 0n ||
      preview.positionRentLamports < 0n
    ) {
      throw new Error('Refresh the close preview before continuing.')
    }
  })
}
