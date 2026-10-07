import type { SignatureBytes } from '@solana/kit'

export function validateWalletSignatures(
  values: unknown,
  transactionCount: number,
): readonly SignatureBytes[] {
  if (
    !Array.isArray(values) ||
    values.length !== transactionCount ||
    !values.every((value) => value instanceof Uint8Array && value.length === 64)
  ) {
    throw new Error(
      'The wallet returned an invalid transaction receipt. Check wallet activity before retrying.',
    )
  }
  return values as SignatureBytes[]
}
