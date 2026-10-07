// One lock per JS runtime, shared by all screens and provider instances. A
// remount must not open a second MWA session while the old session is pending.
let active: symbol | undefined

export function acquireWalletOperation(): (() => void) | undefined {
  if (active) return undefined
  const token = Symbol('wallet-operation')
  active = token
  return () => {
    // Cleanup may be called twice; it must not release somebody else's lock.
    if (active === token) active = undefined
  }
}
