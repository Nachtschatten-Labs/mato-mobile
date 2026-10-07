// Codama 2.4 names this type; Kit 6.5 exposes the same return type inline.
// Keep the runtime implementation in Kit and remove this adapter when upgrading it.
export { extendClient } from '@solana/kit'

export type ExtendedClient<TClient extends object, TAdditions extends object> =
  Omit<TClient, keyof TAdditions> & TAdditions
