import { describe, expect, it } from 'vitest'
import { canEnableTransactions, PROGRAM_ID, validateEndpoint } from './config'

describe('release configuration', () => {
  it('never enables mainnet transactions in development', () => {
    expect(canEnableTransactions('true', PROGRAM_ID, true)).toBe(false)
  })
  it('requires both an explicit flag and the pinned program', () => {
    expect(canEnableTransactions('true', PROGRAM_ID, false)).toBe(true)
    expect(canEnableTransactions(undefined, PROGRAM_ID, false)).toBe(false)
    expect(canEnableTransactions('true', 'wrong', false)).toBe(false)
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
