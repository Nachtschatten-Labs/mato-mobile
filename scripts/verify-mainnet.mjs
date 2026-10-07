// Read-only deployment health check. Never accesses wallets or sends transactions.
import { createSolanaRpc } from '@solana/kit'

const program = 'TwobwMYkKbT8uMWqgPrEPXTPoyYsKAPmaWun6T2WT4A'
const market = 'FUDH6hiwDNjdQKbH7fveFFPoEE3mXk9i1g2WbgnSqob3'
const rpc = createSolanaRpc(
  process.env.EXPO_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com',
)
const api = (
  process.env.EXPO_PUBLIC_READ_API_URL ||
  'https://read-api-production-f8ea.up.railway.app'
).replace(/\/$/, '')
const signal = AbortSignal.timeout(20_000)
const checks = await Promise.allSettled([
  rpc
    .getGenesisHash()
    .send({ abortSignal: signal })
    .then((hash) => {
      if (hash !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
        throw new Error('Incorrect cluster')
      return 'Mainnet genesis verified'
    }),
  rpc
    .getAccountInfo(program, { encoding: 'base64', commitment: 'confirmed' })
    .send({ abortSignal: signal })
    .then(({ value }) => {
      if (!value?.executable)
        throw new Error('Program unavailable or not executable')
      return 'Pinned executable program found'
    }),
  rpc
    .getAccountInfo(market, { encoding: 'base64', commitment: 'confirmed' })
    .send({ abortSignal: signal })
    .then(({ value }) => {
      if (!value || value.owner !== program)
        throw new Error('Market owner mismatch')
      return 'Pinned market owner verified'
    }),
  fetch(`${api}/v1/markets/${market}/config`, { signal }).then(
    async (response) => {
      if (!response.ok)
        throw new Error(`Read API unavailable (${response.status})`)
      const data = await response.json()
      if (
        data.market_address !== market ||
        data.base_mint !== 'So11111111111111111111111111111111111111112' ||
        data.quote_mint !== 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ||
        data.base_decimals !== 9 ||
        data.quote_decimals !== 6
      )
        throw new Error('Read API market identity mismatch')
      return 'Read API SOL/USDC configuration verified'
    },
  ),
])
for (const [index, check] of checks.entries()) {
  if (check.status === 'fulfilled') console.log(`PASS ${check.value}`)
  else {
    // Do not log transport errors containing a configured provider URL.
    console.error(
      `FAIL backend check ${index + 1}: endpoint unavailable or deployment identity mismatch`,
    )
    process.exitCode = 1
  }
}
