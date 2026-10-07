import { afterEach, describe, expect, it, vi } from 'vitest'
import { canEnableTransactions, PROGRAM_ID, validateEndpoint } from './config'

describe('release configuration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })
  it.each([true, false])(
    'allows reviewed Android trades with __DEV__=%s',
    async (development) => {
      vi.stubGlobal('__DEV__', development)
      vi.stubEnv('EXPO_PUBLIC_ENABLE_TRANSACTIONS', 'true')
      vi.stubEnv('EXPO_PUBLIC_VERIFIED_PROGRAM_ID', PROGRAM_ID)
      vi.resetModules()
      const { config } = await import('./config')
      expect(config.transactionsEnabled).toBe(true)
      expect(config.programId).toBe(PROGRAM_ID)
    },
  )

  it('enables trading with the built-in pinned program in all build modes', () => {
    expect(canEnableTransactions(undefined, undefined)).toBe(true)
    expect(canEnableTransactions('true', PROGRAM_ID)).toBe(true)
  })
  it('respects an explicit read-only flag and rejects a different program', () => {
    expect(canEnableTransactions('false', PROGRAM_ID)).toBe(false)
    expect(canEnableTransactions('true', 'wrong')).toBe(false)
    expect(canEnableTransactions(undefined, 'wrong')).toBe(false)
    expect(canEnableTransactions('', PROGRAM_ID)).toBe(false)
  })
  it('rejects unsafe endpoint configuration', () => {
    for (const url of [
      'http://example.com',
      'https://user:secret@example.com',
      'https://example.com/#secret',
    ]) {
      expect(() => validateEndpoint(url, 'RPC')).toThrow()
    }
  })
})
