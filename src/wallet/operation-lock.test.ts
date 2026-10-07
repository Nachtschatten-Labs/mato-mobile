import { describe, expect, it } from 'vitest'
import { acquireWalletOperation } from './operation-lock'

describe('shared wallet session lock', () => {
  it('rejects a second screen until the active wallet session finishes', () => {
    const release = acquireWalletOperation()
    expect(release).toBeTypeOf('function')
    expect(acquireWalletOperation()).toBeUndefined()
    release!()
    const nextRelease = acquireWalletOperation()
    expect(nextRelease).toBeTypeOf('function')
    // A late cleanup from the previous request must not unlock this session.
    release!()
    expect(acquireWalletOperation()).toBeUndefined()
    nextRelease!()
  })
})
