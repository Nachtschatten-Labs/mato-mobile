import { getBase64Encoder } from '@solana/kit'

export function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(getBase64Encoder().encode(value))
}
