import { verifyTransactionEnvironment } from './verify-network'
import { assertTransactionsEnabled } from '@/integrations/solana/transaction-policy'
import {
  AccountRole,
  appendTransactionMessageInstructions,
  assertAccountExists,
  createTransactionMessage,
  fetchEncodedAccounts,
  getAddressEncoder,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  signature as parseSignature,
  getBytesEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  isTransactionMessageWithSingleSendingSigner,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signAndSendTransactionMessageWithSigners,
  signTransactionMessageWithSigners,
} from '@solana/kit'
import {
  ARRAY_LENGTH,
  getMarketDefinition,
  END_SLOT_INTERVAL,
  MAX_BATCH_CLOSE_POSITIONS_PER_TRANSACTION,
} from '../constants'
import { encodeBase58 } from '../lib/base58'
import { findMarketAddress } from '../lib/pdas'
import { decodeBase64 } from '../lib/bytes'
import { collectCloseableMarketIntervals } from '../lib/rent'
import { resolveEndSlotSettlement } from '../lib/settlement-snapshot'
import {
  getTradePositionEndSlot,
  isBuyTradePosition,
} from '../lib/trade-position'
import { fetchOwnedMarketIntervals } from './rent-accounts'
import { getSolOrderWrapAmount } from './sol-order-funding'
import {
  detectTokenProgram,
  prepareWrapInstructions,
  prepareUnwrapInstructions,
  WRAPPED_SOL_MINT,
} from './token-instructions'
import type {
  Address,
  Instruction,
  TransactionSigner,
  createSolanaRpc,
} from '@solana/kit'
import type {
  StreamingMarketState,
  TradeSettlementSnapshot,
  TradePositionRecord,
} from '../domain/models'
import type { IntervalRentAccount } from '../lib/rent'
import type {
  Market,
  MarketInterval,
  TradePosition,
} from '@/lib/generated/twob/src/generated/accounts'
import {
  fetchMarket,
  fetchMarketInterval,
  fetchTradePosition,
  decodeMarket,
  decodeMarketInterval,
  getTradePositionDecoder,
  getTradePositionDiscriminatorBytes,
} from '@/lib/generated/twob/src/generated/accounts'
import {
  getAuthorityCloseTradePositionInstructionAsync,
  getCloseMarketIntervalInstruction,
  getPauseTradePositionInstruction,
  getSubmitOrderInstructionAsync,
  getUnpauseTradePositionInstructionAsync,
  getWithdrawSwappedInstructionAsync,
} from '@/lib/generated/twob/src/generated/instructions'
import { TWOB_ANCHOR_PROGRAM_ADDRESS } from '@/lib/generated/twob/src/generated/programs'

const textEncoder = new TextEncoder()
const BOOKKEEPING_DELAY_SLOTS = 20
const TRADE_POSITION_MARKET_OFFSET = 40n
const SIGNATURE_POLL_INTERVAL_MS = 1_000
const SIGNATURE_STATUS_TIMEOUT_MS = 90_000
const ASSOCIATED_TOKEN_PROGRAM_ADDRESS =
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' as Address
const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111' as Address

export type TwobRpcClient = ReturnType<typeof createSolanaRpc>

export interface MobileTransactionContext {
  rpc: TwobRpcClient
  signer: TransactionSigner
}
type GetProgramAccountsConfig = NonNullable<
  Parameters<TwobRpcClient['getProgramAccounts']>[1]
>
type GetProgramAccountsFilter = NonNullable<
  GetProgramAccountsConfig['filters']
>[number]

function seed(value: string) {
  return getBytesEncoder().encode(textEncoder.encode(value))
}

export async function waitForConfirmedSignature(
  rpcClient: TwobRpcClient,
  signature: string,
  lastValidBlockHeight?: bigint,
) {
  const normalizedSignature = parseSignature(signature)

  const startTime = Date.now()

  while (Date.now() - startTime < SIGNATURE_STATUS_TIMEOUT_MS) {
    const response = await rpcClient
      .getSignatureStatuses([normalizedSignature])
      .send()
      .catch(() => {
        throw new Error(
          `Unable to verify confirmation. Check signature ${signature} before retrying.`,
        )
      })
    const status = response.value[0] ?? null

    if (status?.err) {
      throw new Error(
        `Transaction failed during confirmation: ${JSON.stringify(status.err)}`,
      )
    }

    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      return
    }

    if (lastValidBlockHeight !== undefined) {
      const blockHeight = await rpcClient
        .getBlockHeight({ commitment: 'confirmed' })
        .send()
        .catch(() => {
          throw new Error(
            `Unable to verify confirmation. Check signature ${signature} before retrying.`,
          )
        })
      if (blockHeight > lastValidBlockHeight) {
        throw new Error(
          `Transaction expired before confirmation. Check signature ${signature} before retrying.`,
        )
      }
    }

    await new Promise((resolve) =>
      setTimeout(resolve, SIGNATURE_POLL_INTERVAL_MS),
    )
  }

  throw new Error(
    `Confirmation is taking longer than expected. Check signature ${signature} before retrying.`,
  )
}

export const deriveMarketAddress = findMarketAddress

export async function deriveProgramConfigAddress() {
  const [address] = await getProgramDerivedAddress({
    programAddress: TWOB_ANCHOR_PROGRAM_ADDRESS,
    seeds: [seed('program_config')],
  })
  return address
}

export async function deriveMarketIntervalAddress(
  marketAddress: Address,
  index: bigint | number,
) {
  const [address] = await getProgramDerivedAddress({
    programAddress: TWOB_ANCHOR_PROGRAM_ADDRESS,
    seeds: [
      seed('market_interval'),
      getAddressEncoder().encode(marketAddress),
      getU64Encoder().encode(BigInt(index)),
    ],
  })
  return address
}

export async function deriveAssociatedTokenAddress({
  mint,
  owner,
  tokenProgram,
}: {
  mint: Address
  owner: Address
  tokenProgram: Address
}) {
  const [address] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    seeds: [
      getAddressEncoder().encode(owner),
      getAddressEncoder().encode(tokenProgram),
      getAddressEncoder().encode(mint),
    ],
  })
  return address
}

export async function deriveTemporaryWithdrawTokenAddress(
  tradePositionAddress: Address,
) {
  const [address] = await getProgramDerivedAddress({
    programAddress: TWOB_ANCHOR_PROGRAM_ADDRESS,
    seeds: [getAddressEncoder().encode(tradePositionAddress)],
  })
  return address
}

export function getReferenceIndex(
  currentSlot: number,
  endSlotInterval: bigint | number,
) {
  return BigInt(
    Math.max(
      1,
      Math.floor(
        (currentSlot + BOOKKEEPING_DELAY_SLOTS) /
          (ARRAY_LENGTH * Number(endSlotInterval)),
      ),
    ),
  )
}

export function getApprovalSafeReferenceIndex(
  currentSlot: number,
  bookkeepingLastUpdateSlot: bigint | number,
  endSlotInterval: bigint | number,
) {
  const slotsPerAccount = ARRAY_LENGTH * Number(endSlotInterval)
  const currentIndex = Math.floor(currentSlot / slotsPerAccount)
  const lastUpdateIndex = Math.floor(
    Number(bookkeepingLastUpdateSlot) / slotsPerAccount,
  )

  if (currentIndex - lastUpdateIndex > 1) {
    throw new Error(
      'Market bookkeeping is behind. Wait for the keeper to catch up and try again.',
    )
  }
  return BigInt(
    Math.max(
      1,
      lastUpdateIndex === currentIndex ? currentIndex + 1 : currentIndex,
    ),
  )
}

export function getPreviousIndex(referenceIndex: bigint) {
  return referenceIndex - 1n
}

export function getFutureIndex(
  endSlot: bigint,
  endSlotInterval: bigint | number,
) {
  return endSlot / BigInt(ARRAY_LENGTH) / BigInt(endSlotInterval)
}

export function alignEndSlot(
  currentSlot: number,
  durationSlots: number,
  endSlotInterval: bigint | number,
) {
  const interval = Number(endSlotInterval)
  return BigInt(
    Math.floor((currentSlot + durationSlots + interval / 2) / interval) *
      interval,
  )
}

export function getUnpausedEndSlot(
  currentSlot: bigint | number,
  remainingSlots: number,
  endSlotInterval: bigint | number,
) {
  const slot = BigInt(currentSlot)
  const interval = BigInt(endSlotInterval)
  return ((slot + BigInt(remainingSlots) + interval) / interval) * interval
}

export function getSwappedPositionAsset(
  market: Pick<Market, 'baseMint' | 'quoteMint'>,
  tradePosition: Pick<TradePosition, 'baseReceiver' | 'quoteReceiver' | 'side'>,
) {
  return isBuyTradePosition(tradePosition)
    ? { mint: market.baseMint, receiver: tradePosition.baseReceiver }
    : { mint: market.quoteMint, receiver: tradePosition.quoteReceiver }
}

export function resolveSnapshotLocation(slot: number, endSlotInterval: number) {
  if (!Number.isFinite(slot) || slot < 0) return null
  if (!Number.isFinite(endSlotInterval) || endSlotInterval <= 0) return null

  const slotsPerInterval = ARRAY_LENGTH * endSlotInterval
  return {
    intervalIndex: Math.floor(slot / slotsPerInterval),
    snapshotIndex: Math.floor(slot / endSlotInterval) % ARRAY_LENGTH,
  }
}

export async function fetchStreamingMarketState(
  rpcClient: TwobRpcClient,
  marketAddress: Address,
): Promise<StreamingMarketState> {
  const [currentSlot, marketAccount] = await Promise.all([
    rpcClient.getSlot({ commitment: 'confirmed' }).send(),
    fetchMarket(rpcClient, marketAddress, { commitment: 'confirmed' }),
  ])

  return {
    baseMint: marketAccount.data.baseMint,
    bookkeepingBasePerQuote: marketAccount.data.bookkeeping.basePerQuote,
    bookkeepingLastUpdateSlot: Number(
      marketAccount.data.bookkeeping.lastUpdateSlot,
    ),
    bookkeepingQuotePerBase: marketAccount.data.bookkeeping.quotePerBase,
    bookkeepingSlotsWithoutTrades:
      marketAccount.data.bookkeeping.slotsWithoutTrade,
    currentSlot: Number(currentSlot),
    endSlotInterval: END_SLOT_INTERVAL,
    isPaused: marketAccount.data.isPaused !== 0,
    marketBaseFlow: marketAccount.data.baseFlow,
    marketId: marketAccount.data.id,
    marketQuoteFlow: marketAccount.data.quoteFlow,
    minimumBaseDepositAtoms: marketAccount.data.minimumBaseDepositAtoms,
    minimumQuoteDepositAtoms: marketAccount.data.minimumQuoteDepositAtoms,
    quoteMint: marketAccount.data.quoteMint,
  }
}

function getTradePositionMarketFilter(
  marketAddress: Address,
): GetProgramAccountsFilter {
  return {
    memcmp: {
      bytes: marketAddress as never,
      encoding: 'base58',
      offset: TRADE_POSITION_MARKET_OFFSET,
    },
  }
}

export async function fetchTradePositions(
  rpcClient: TwobRpcClient,
  authority: string,
  marketAddress: Address,
): Promise<Array<TradePositionRecord>> {
  const positions = await fetchTradePositionAccounts(rpcClient, [
    {
      memcmp: {
        bytes: authority as never,
        encoding: 'base58',
        offset: 8n,
      },
    },
    getTradePositionMarketFilter(marketAddress),
  ])
  return positions.filter((position) => position.data.market === marketAddress)
}

async function fetchTradePositionAccounts(
  rpcClient: TwobRpcClient,
  extraFilters: Array<GetProgramAccountsFilter> = [],
): Promise<Array<TradePositionRecord>> {
  const response = (await rpcClient
    .getProgramAccounts(TWOB_ANCHOR_PROGRAM_ADDRESS, {
      commitment: 'confirmed',
      encoding: 'base64',
      filters: [
        { dataSize: 312n },
        {
          memcmp: {
            bytes: encodeBase58(
              Uint8Array.from(getTradePositionDiscriminatorBytes()),
            ) as never,
            encoding: 'base58',
            offset: 0n,
          },
        },
        ...extraFilters,
      ],
    })
    .send()) as any

  const accounts = (
    Array.isArray(response) ? response : response.value
  ) as Array<{
    account: { data: [string, string] }
    pubkey: Address
  }>

  return accounts
    .map(({ account, pubkey }) => ({
      address: pubkey,
      data: getTradePositionDecoder().decode(decodeBase64(account.data[0])),
    }))
    .sort((left, right) => {
      if (left.data.id === right.data.id) return 0
      return left.data.id > right.data.id ? -1 : 1
    })
}

export async function fetchMarketTradePositions(
  rpcClient: TwobRpcClient,
  marketAddress: Address,
): Promise<Array<TradePositionRecord>> {
  const positions = await fetchTradePositionAccounts(rpcClient, [
    getTradePositionMarketFilter(marketAddress),
  ])
  return positions.filter((position) => position.data.market === marketAddress)
}

export async function fetchEndSlotBookkeepingSnapshot({
  bookkeepingLastUpdateSlot,
  endSlot,
  endSlotInterval,
  isBuy,
  marketAddress,
  rpcClient,
}: {
  bookkeepingLastUpdateSlot: number | null
  endSlot: number
  endSlotInterval: number | null
  isBuy: boolean
  marketAddress: Address
  rpcClient: TwobRpcClient
}): Promise<TradeSettlementSnapshot | null> {
  const snapshotLocation =
    endSlotInterval === null
      ? null
      : resolveSnapshotLocation(endSlot, endSlotInterval)

  if (!snapshotLocation) return null

  if (
    bookkeepingLastUpdateSlot === null ||
    bookkeepingLastUpdateSlot < endSlot
  ) {
    // Fetch all accounting from the same confirmed bank after the order ended.
    // This lets short orders settle in the UI before the keeper persists books.
    const firstIndex = Math.max(0, snapshotLocation.intervalIndex - 1)
    const intervalIndexes = Array.from(
      { length: snapshotLocation.intervalIndex - firstIndex + 1 },
      (_, offset) => firstIndex + offset,
    )
    const addresses = await Promise.all(
      intervalIndexes.map((index) =>
        deriveMarketIntervalAddress(marketAddress, BigInt(index)),
      ),
    )
    const [encodedMarket, ...encodedIntervals] = await fetchEncodedAccounts(
      rpcClient,
      [marketAddress, ...addresses],
      { commitment: 'confirmed', minContextSlot: BigInt(endSlot) },
    )
    assertAccountExists(encodedMarket)
    const intervals = new Map<number, MarketInterval | null>()
    for (const [offset, account] of encodedIntervals.entries()) {
      const index = intervalIndexes[offset]
      if (!account.exists) {
        intervals.set(index, null)
        continue
      }
      const interval = decodeMarketInterval(account).data
      if (
        interval.market !== marketAddress ||
        interval.index !== BigInt(index)
      ) {
        throw new Error(
          'The settlement snapshot does not match its market interval.',
        )
      }
      intervals.set(index, interval)
    }
    return resolveEndSlotSettlement({
      endSlot,
      endSlotInterval: endSlotInterval!,
      intervals,
      isBuy,
      market: decodeMarket(encodedMarket).data,
    })
  }

  const intervalAddress = await deriveMarketIntervalAddress(
    marketAddress,
    BigInt(snapshotLocation.intervalIndex),
  )
  const interval = await fetchMarketInterval(rpcClient, intervalAddress, {
    commitment: 'confirmed',
    minContextSlot: BigInt(bookkeepingLastUpdateSlot),
  })
  if (
    interval.data.market !== marketAddress ||
    interval.data.index !== BigInt(snapshotLocation.intervalIndex)
  ) {
    throw new Error(
      'The settlement snapshot does not match its market interval.',
    )
  }
  const snapshots = isBuy
    ? interval.data.basePerQuoteSnapshot
    : interval.data.quotePerBaseSnapshot
  const bookkeeping = snapshots[snapshotLocation.snapshotIndex]
  const slotsWithoutTrades =
    interval.data.slotsWithoutTradesSnapshot[snapshotLocation.snapshotIndex]
  if (bookkeeping === undefined || slotsWithoutTrades === undefined) return null
  return { slot: endSlot, bookkeeping, slotsWithoutTrades }
}

export async function sendSubmitOrder({
  context,
  onBeforeSend,
  request,
}: {
  context: MobileTransactionContext
  onBeforeSend?: () => void
  request: {
    amount: bigint
    durationSlots: number
    existingWrappedAtoms?: bigint
    id: number
    inputMintAddress: string
    isBuy: boolean
    marketAddress: Address
  }
}) {
  assertTransactionsEnabled()
  const { amount, durationSlots, id, inputMintAddress, isBuy, marketAddress } =
    request
  assertSupportedMarketAddress(marketAddress)

  if (amount <= 0n || amount > 0xffffffffffffffffn) {
    throw new Error('Order amount must be a positive unsigned 64-bit integer.')
  }
  if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) {
    throw new Error('Order id must be an unsigned 32-bit integer.')
  }
  if (
    !Number.isInteger(durationSlots) ||
    durationSlots < END_SLOT_INTERVAL ||
    durationSlots > 160_000_000
  ) {
    throw new Error('Order duration must be between 11 and 160,000,000 slots.')
  }

  const walletSigner = context.signer
  const wrapShortfall =
    inputMintAddress === WRAPPED_SOL_MINT
      ? await getSolOrderWrapAmount({
          amount,
          rpcClient: context.rpc,
          owner: context.signer.address,
        })
      : 0n
  const marketAccount = await fetchMarket(context.rpc, marketAddress, {
    commitment: 'confirmed',
  })
  if (marketAccount.data.isPaused !== 0) {
    throw new Error('This market is paused. Try again after trading resumes.')
  }
  const minimumAmount = isBuy
    ? marketAccount.data.minimumQuoteDepositAtoms
    : marketAccount.data.minimumBaseDepositAtoms
  if (amount < minimumAmount)
    throw new Error('Amount is below the market minimum deposit.')
  const mint = isBuy
    ? marketAccount.data.quoteMint
    : marketAccount.data.baseMint
  if (inputMintAddress !== mint)
    throw new Error('Input mint does not match the selected market side.')
  const outputMint = isBuy
    ? marketAccount.data.baseMint
    : marketAccount.data.quoteMint
  const [tokenProgram, createReceiverInstruction] = await Promise.all([
    detectTokenProgram(context.rpc, mint),
    getCreateMissingReceiverTokenInstruction({
      context,
      mint: outputMint,
      owner: context.signer.address,
      payer: walletSigner,
    }),
  ])

  const wrapInstructions =
    wrapShortfall > 0n
      ? await prepareWrapInstructions({
          amount: wrapShortfall,
          signer: walletSigner,
        })
      : []

  const currentSlotResponse = await context.rpc
    .getSlot({ commitment: 'confirmed' })
    .send()
  const currentSlot = Number(currentSlotResponse)
  const referenceIndex = getApprovalSafeReferenceIndex(
    currentSlot,
    marketAccount.data.bookkeeping.lastUpdateSlot,
    END_SLOT_INTERVAL,
  )
  const previousIndex = getPreviousIndex(referenceIndex)
  const positionStartSlot = Math.max(
    currentSlot,
    Number(marketAccount.data.startSlot),
  )
  const endSlot = alignEndSlot(
    positionStartSlot,
    durationSlots,
    END_SLOT_INTERVAL,
  )
  const futureIndex = getFutureIndex(endSlot, END_SLOT_INTERVAL)

  const [currentInterval, previousInterval] = await Promise.all([
    deriveMarketIntervalAddress(marketAddress, referenceIndex),
    deriveMarketIntervalAddress(marketAddress, previousIndex),
  ])

  const instruction = await getSubmitOrderInstructionAsync({
    amount,
    authority: walletSigner,
    baseReceiver: context.signer.address,

    currentInterval,

    duration: durationSlots,
    futureIndex,
    id,
    market: marketAddress,
    mint,
    operator: context.signer.address,
    payer: walletSigner,
    previousInterval,

    quoteReceiver: context.signer.address,
    referenceIndex,
    tokenProgram: tokenProgram.programAddress,
  })

  return sendInstructions(
    context,
    [
      ...wrapInstructions,
      ...(createReceiverInstruction ? [createReceiverInstruction] : []),
      instruction,
    ],
    onBeforeSend,
  )
}

async function getCreateMissingReceiverTokenInstruction({
  context,
  mint,
  owner,
  payer,
}: {
  context: MobileTransactionContext
  mint: Address
  owner: Address
  payer: TransactionSigner
}) {
  if (mint === WRAPPED_SOL_MINT) return null

  const tokenProgram = await detectTokenProgram(context.rpc, mint)
  const ata = await deriveAssociatedTokenAddress({
    mint,
    owner,
    tokenProgram: tokenProgram.programAddress,
  })
  const account = await context.rpc
    .getAccountInfo(ata, { commitment: 'confirmed', encoding: 'base64' })
    .send()
  if (account.value !== null) return null

  // Creation may race with another transaction while the wallet is approving.
  return getCreateAssociatedTokenIdempotentInstruction({
    ata,
    mint,
    owner,
    payer,
    tokenProgram: tokenProgram.programAddress,
  })
}

function getCreateAssociatedTokenIdempotentInstruction({
  ata,
  mint,
  owner,
  payer,
  tokenProgram,
}: {
  ata: Address
  mint: Address
  owner: Address
  payer: TransactionSigner
  tokenProgram: Address
}) {
  return Object.freeze({
    accounts: [
      {
        address: payer.address,
        role: AccountRole.WRITABLE_SIGNER,
        signer: payer,
      },
      { address: ata, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: tokenProgram, role: AccountRole.READONLY },
    ] as const,
    data: new Uint8Array([1]),
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  })
}

async function getPositionControlContext({
  context,
  marketAddress,
  tradePositionAddress,
}: {
  context: MobileTransactionContext
  marketAddress: Address
  tradePositionAddress: Address
}) {
  assertSupportedMarketAddress(marketAddress)
  const [marketAccount, tradePositionAccount] = await Promise.all([
    fetchMarket(context.rpc, marketAddress, {
      commitment: 'confirmed',
    }),
    fetchTradePosition(context.rpc, tradePositionAddress, {
      commitment: 'confirmed',
    }),
  ])
  const tradePosition = tradePositionAccount.data
  const walletAddress = context.signer.address.toString()

  if (tradePosition.market !== marketAddress) {
    throw new Error('Trade position belongs to a different market.')
  }
  if (
    tradePosition.authority.toString() !== walletAddress &&
    tradePosition.operator.toString() !== walletAddress
  ) {
    throw new Error('This wallet is not allowed to control the position.')
  }

  return {
    market: marketAccount.data,
    tradePosition,
  }
}

async function derivePositionReferenceAccounts({
  bookkeepingLastUpdateSlot,
  currentSlot,
  endSlotInterval,
  marketAddress,
}: {
  bookkeepingLastUpdateSlot: bigint
  currentSlot: number
  endSlotInterval: number
  marketAddress: Address
}) {
  const referenceIndex = getApprovalSafeReferenceIndex(
    currentSlot,
    bookkeepingLastUpdateSlot,
    endSlotInterval,
  )
  const previousIndex = getPreviousIndex(referenceIndex)
  const [currentInterval, previousInterval] = await Promise.all([
    deriveMarketIntervalAddress(marketAddress, referenceIndex),
    deriveMarketIntervalAddress(marketAddress, previousIndex),
  ])

  return {
    currentInterval,

    previousInterval,

    referenceIndex,
  }
}

export async function sendPauseTradePosition({
  context,
  request,
}: {
  context: MobileTransactionContext
  request: {
    marketAddress: Address
    tradePositionAddress: Address
  }
}) {
  assertTransactionsEnabled()
  const { marketAddress, tradePositionAddress } = request
  const walletSigner = context.signer
  const { market, tradePosition } = await getPositionControlContext({
    context,
    marketAddress,
    tradePositionAddress,
  })

  if (tradePosition.pausedAtSlot > 0n) {
    throw new Error('This position is already paused.')
  }

  const [baseTokenProgram, quoteTokenProgram] = await Promise.all([
    detectTokenProgram(context.rpc, market.baseMint),
    detectTokenProgram(context.rpc, market.quoteMint),
  ])
  const currentSlot = Number(
    await context.rpc.getSlot({ commitment: 'confirmed' }).send(),
  )
  if (BigInt(currentSlot) >= getTradePositionEndSlot(tradePosition)) {
    throw new Error('This position has already ended and cannot be paused.')
  }
  if (BigInt(currentSlot) <= market.startSlot) {
    throw new Error('This market has not started yet.')
  }

  const referenceAccounts = await derivePositionReferenceAccounts({
    bookkeepingLastUpdateSlot: market.bookkeeping.lastUpdateSlot,
    currentSlot,
    endSlotInterval: END_SLOT_INTERVAL,
    marketAddress,
  })
  const futureIndex = getFutureIndex(
    getTradePositionEndSlot(tradePosition),
    END_SLOT_INTERVAL,
  )
  const futureInterval = await deriveMarketIntervalAddress(
    marketAddress,
    futureIndex,
  )
  const instruction = await getPauseTradePositionInstruction({
    baseMint: market.baseMint,
    baseTokenProgram: baseTokenProgram.programAddress,
    currentInterval: referenceAccounts.currentInterval,

    futureInterval,
    market: marketAddress,
    previousInterval: referenceAccounts.previousInterval,

    quoteMint: market.quoteMint,
    quoteTokenProgram: quoteTokenProgram.programAddress,
    referenceIndex: referenceAccounts.referenceIndex,
    signer: walletSigner,
    tradePosition: tradePositionAddress,
  })

  return sendInstructions(context, [instruction])
}

export async function sendUnpauseTradePosition({
  context,
  request,
}: {
  context: MobileTransactionContext
  request: {
    marketAddress: Address
    tradePositionAddress: Address
  }
}) {
  assertTransactionsEnabled()
  const { marketAddress, tradePositionAddress } = request
  const walletSigner = context.signer
  const { market, tradePosition } = await getPositionControlContext({
    context,
    marketAddress,
    tradePositionAddress,
  })

  if (tradePosition.pausedAtSlot === 0n) {
    throw new Error('This position is not paused.')
  }
  if (market.isPaused !== 0) {
    throw new Error('The market is paused. Try resuming the position later.')
  }

  const [baseTokenProgram, quoteTokenProgram] = await Promise.all([
    detectTokenProgram(context.rpc, market.baseMint),
    detectTokenProgram(context.rpc, market.quoteMint),
  ])
  const currentSlot = Number(
    await context.rpc.getSlot({ commitment: 'confirmed' }).send(),
  )
  const referenceAccounts = await derivePositionReferenceAccounts({
    bookkeepingLastUpdateSlot: market.bookkeeping.lastUpdateSlot,
    currentSlot,
    endSlotInterval: END_SLOT_INTERVAL,
    marketAddress,
  })
  const oldIndex = getFutureIndex(
    getTradePositionEndSlot(tradePosition),
    END_SLOT_INTERVAL,
  )
  const unpausedEndSlot = getUnpausedEndSlot(
    currentSlot,
    tradePosition.remainingSlots,
    END_SLOT_INTERVAL,
  )
  const futureIndex = getFutureIndex(unpausedEndSlot, END_SLOT_INTERVAL)
  const [oldInterval, futureInterval] = await Promise.all([
    deriveMarketIntervalAddress(marketAddress, oldIndex),
    deriveMarketIntervalAddress(marketAddress, futureIndex),
  ])
  const instruction = await getUnpauseTradePositionInstructionAsync({
    baseMint: market.baseMint,
    baseTokenProgram: baseTokenProgram.programAddress,
    currentInterval: referenceAccounts.currentInterval,

    futureInterval,
    futureIndex,

    market: marketAddress,
    oldInterval,
    previousInterval: referenceAccounts.previousInterval,

    quoteMint: market.quoteMint,
    quoteTokenProgram: quoteTokenProgram.programAddress,
    referenceIndex: referenceAccounts.referenceIndex,
    signer: walletSigner,
    tradePosition: tradePositionAddress,
  })

  return sendInstructions(context, [instruction])
}

export async function sendWithdrawSwapped({
  context,
  request,
}: {
  context: MobileTransactionContext
  request: {
    marketAddress: Address
    tradePositionAddress: Address
  }
}) {
  assertTransactionsEnabled()
  const { marketAddress, tradePositionAddress } = request
  const walletSigner = context.signer
  const { market, tradePosition } = await getPositionControlContext({
    context,
    marketAddress,
    tradePositionAddress,
  })

  const { mint, receiver } = getSwappedPositionAsset(market, tradePosition)
  const tokenProgram = await detectTokenProgram(context.rpc, mint)
  const currentSlot = Number(
    await context.rpc.getSlot({ commitment: 'confirmed' }).send(),
  )
  if (
    tradePosition.pausedAtSlot === 0n &&
    BigInt(currentSlot) >= getTradePositionEndSlot(tradePosition)
  ) {
    throw new Error(
      'This position has already ended. Close it to receive the remaining funds.',
    )
  }
  if (BigInt(currentSlot) <= market.startSlot) {
    throw new Error('This market has not started yet.')
  }
  const referenceAccounts = await derivePositionReferenceAccounts({
    bookkeepingLastUpdateSlot: market.bookkeeping.lastUpdateSlot,
    currentSlot,
    endSlotInterval: END_SLOT_INTERVAL,
    marketAddress,
  })
  const isNative = mint.toString() === WRAPPED_SOL_MINT
  const receiverTokenAccount = isNative
    ? await deriveTemporaryWithdrawTokenAddress(tradePositionAddress)
    : await deriveAssociatedTokenAddress({
        mint,
        owner: receiver,
        tokenProgram: tokenProgram.programAddress,
      })
  const withdrawInstruction = await getWithdrawSwappedInstructionAsync({
    programConfig: await deriveProgramConfigAddress(),
    currentInterval: referenceAccounts.currentInterval,

    market: marketAddress,
    mint,
    previousInterval: referenceAccounts.previousInterval,

    receiver,
    receiverTokenAccount,
    referenceIndex: referenceAccounts.referenceIndex,
    signer: walletSigner,
    tokenProgram: tokenProgram.programAddress,
    tradePosition: tradePositionAddress,
  })
  const createReceiverInstruction = isNative
    ? null
    : getCreateAssociatedTokenIdempotentInstruction({
        ata: receiverTokenAccount,
        mint,
        owner: receiver,
        payer: walletSigner,
        tokenProgram: tokenProgram.programAddress,
      })
  const instructions = createReceiverInstruction
    ? [createReceiverInstruction, withdrawInstruction]
    : [withdrawInstruction]

  return sendInstructions(context, instructions)
}

export async function sendClosePosition({
  context,
  request,
}: {
  context: MobileTransactionContext
  request: {
    marketAddress: Address
    tradePositionAddress: Address
  }
}) {
  assertTransactionsEnabled()
  return sendClosePositions({
    context,
    request: {
      marketAddress: request.marketAddress,
      tradePositionAddresses: [request.tradePositionAddress],
    },
  })
}

// Share the exact close instructions between the review simulation and submission.
export async function prepareClosePositionInstructions({
  rpcClient,
  request,
  authority,
}: {
  rpcClient: TwobRpcClient
  request: { marketAddress: Address; tradePositionAddresses: Array<Address> }
  authority: TransactionSigner
}) {
  const { marketAddress, tradePositionAddresses } = request
  assertSupportedMarketAddress(marketAddress)
  if (new Set(tradePositionAddresses).size !== tradePositionAddresses.length) {
    throw new Error('A position can only be closed once in a transaction.')
  }
  if (tradePositionAddresses.length === 0) {
    throw new Error('Select at least one position to close.')
  }
  if (
    tradePositionAddresses.length > MAX_BATCH_CLOSE_POSITIONS_PER_TRANSACTION
  ) {
    throw new Error(
      `Close up to ${MAX_BATCH_CLOSE_POSITIONS_PER_TRANSACTION} positions at once.`,
    )
  }

  const [marketAccount, tradePositionAccounts, currentSlot] = await Promise.all(
    [
      fetchMarket(rpcClient, marketAddress, {
        commitment: 'confirmed',
      }),
      Promise.all(
        tradePositionAddresses.map((tradePositionAddress) =>
          fetchTradePosition(rpcClient, tradePositionAddress, {
            commitment: 'confirmed',
          }),
        ),
      ),
      rpcClient.getSlot({ commitment: 'confirmed' }).send(),
    ],
  )

  const [baseTokenProgram, quoteTokenProgram] = await Promise.all([
    detectTokenProgram(rpcClient, marketAccount.data.baseMint),
    detectTokenProgram(rpcClient, marketAccount.data.quoteMint),
  ])

  const referenceIndex = getApprovalSafeReferenceIndex(
    Number(currentSlot),
    marketAccount.data.bookkeeping.lastUpdateSlot,
    END_SLOT_INTERVAL,
  )
  const previousIndex = getPreviousIndex(referenceIndex)

  const [currentInterval, previousInterval] = await Promise.all([
    deriveMarketIntervalAddress(marketAddress, referenceIndex),
    deriveMarketIntervalAddress(marketAddress, previousIndex),
  ])

  const closeInstructions = await Promise.all(
    tradePositionAccounts.map(async (tradePositionAccount, index) => {
      const tradePositionAddress = tradePositionAddresses[index]
      if (!tradePositionAddress) {
        throw new Error('Failed to resolve position address.')
      }

      const tradePosition = tradePositionAccount.data
      if (tradePosition.authority !== authority.address) {
        throw new Error('This wallet does not control the position.')
      }
      if (tradePosition.market !== marketAddress) {
        throw new Error('Trade position belongs to a different market.')
      }
      const futureIndex = getFutureIndex(
        getTradePositionEndSlot(tradePosition),
        END_SLOT_INTERVAL,
      )
      const futureInterval = await deriveMarketIntervalAddress(
        marketAddress,
        futureIndex,
      )
      const interval = await fetchMarketInterval(rpcClient, futureInterval, {
        commitment: 'confirmed',
      })
      if (
        interval.data.market !== marketAddress ||
        interval.data.index !== futureIndex
      ) {
        throw new Error(
          'The position settlement interval does not match its market.',
        )
      }

      return getAuthorityCloseTradePositionInstructionAsync({
        programConfig: await deriveProgramConfigAddress(),
        authority,
        baseMint: marketAccount.data.baseMint,
        baseReceiver: tradePosition.baseReceiver,
        baseTokenProgram: baseTokenProgram.programAddress,
        currentInterval,

        futureInterval,

        market: marketAddress,
        payer: tradePosition.payer,
        previousInterval,

        quoteMint: marketAccount.data.quoteMint,
        quoteReceiver: tradePosition.quoteReceiver,
        quoteTokenProgram: quoteTokenProgram.programAddress,
        referenceIndex,
        tradePosition: tradePositionAddress,
      })
    }),
  )

  return {
    instructions: closeInstructions,
    marketAccount,
    tradePositionAccounts,
    currentSlot,
  }
}

export async function sendClosePositions({
  context,
  request,
}: {
  context: MobileTransactionContext
  request: {
    marketAddress: Address
    tradePositionAddresses: Array<Address>
  }
}) {
  assertTransactionsEnabled()
  const walletSigner = context.signer
  const {
    instructions: closeInstructions,
    marketAccount,
    tradePositionAccounts,
  } = await prepareClosePositionInstructions({
    rpcClient: context.rpc,
    request,
    authority: walletSigner,
  })

  const receivesNative = tradePositionAccounts.some(
    ({ data }) =>
      (marketAccount.data.baseMint === WRAPPED_SOL_MINT &&
        data.baseReceiver === walletSigner.address) ||
      (marketAccount.data.quoteMint === WRAPPED_SOL_MINT &&
        data.quoteReceiver === walletSigner.address),
  )
  const unwrapInstructions = receivesNative
    ? await prepareUnwrapInstructions(walletSigner)
    : []
  return sendInstructions(context, [
    ...closeInstructions,
    ...unwrapInstructions,
  ])
}

export async function sendReclaimRent({
  context,
  request,
}: {
  context: MobileTransactionContext
  request: {
    marketAddress: Address
    maxAccounts: number
  }
}) {
  assertTransactionsEnabled()
  const { marketAddress, maxAccounts } = request
  assertSupportedMarketAddress(marketAddress)
  if (!Number.isInteger(maxAccounts) || maxAccounts < 1 || maxAccounts > 10) {
    throw new Error('Reclaim between 1 and 10 rent accounts at once.')
  }
  const walletSigner = context.signer
  const ownerAddress = context.signer.address
  const owner = ownerAddress.toString()

  const [currentSlot, marketAccount, ownedIntervals] = await Promise.all([
    context.rpc.getSlot({ commitment: 'confirmed' }).send(),
    fetchMarket(context.rpc, marketAddress, { commitment: 'confirmed' }),
    fetchOwnedMarketIntervals(context.rpc, owner),
  ])
  const intervalAccounts: Array<IntervalRentAccount> = ownedIntervals.map(
    (account) => ({
      address: account.address,
      index: account.data.index,
      lamports: account.lamports,
      market: account.data.market,
      openPositions: account.data.openPositions,
      payer: account.data.payer,
    }),
  )
  const { currentInterval, previousInterval, referenceIndex } =
    await derivePositionReferenceAccounts({
      currentSlot: Number(currentSlot),
      endSlotInterval: END_SLOT_INTERVAL,
      marketAddress,
      bookkeepingLastUpdateSlot: marketAccount.data.bookkeeping.lastUpdateSlot,
    })
  const closeableIntervals = collectCloseableMarketIntervals({
    currentSlot,
    endSlotInterval: END_SLOT_INTERVAL,
    intervalAccounts,
    maxAccounts,
    market: marketAddress,
    payer: ownerAddress,
  })
  if (!closeableIntervals.length)
    throw new Error('No reclaimable rent accounts available.')
  const reclaimedLamports = closeableIntervals.reduce(
    (sum, account) => sum + account.lamports,
    0n,
  )
  const instructions = closeableIntervals.map((account) =>
    getCloseMarketIntervalInstruction({
      signer: walletSigner,
      payer: account.payer,
      marketInterval: account.address,
      market: marketAddress,
      currentInterval,
      previousInterval,
      referenceIndex,
    }),
  )

  const serializedSignature = await sendInstructions(context, instructions)

  return {
    reclaimedLamports,
    signature: serializedSignature,
  }
}

// Shared by every screen and every mutation path. Wallet approval finishing
// does not release the lock: balances remain unsettled until confirmation.
let transactionInFlight = false

/** Use a fresh blockhash, wallet approval, RPC preflight and confirmed finality.
 * Never automatically retry a signed transaction with a new blockhash: doing so
 * could submit the user's order twice when a confirmation RPC is unavailable.
 */
export async function sendInstructions(
  context: MobileTransactionContext,
  instructions: readonly Instruction[],
  onBeforeSend?: () => void,
) {
  if (transactionInFlight) {
    throw new Error(
      'Another transaction is still pending. Wait for it to finish before starting a new one.',
    )
  }
  transactionInFlight = true
  try {
    assertTransactionsEnabled()
    await verifyTransactionEnvironment(context.rpc)
    const { value: lifetime } = await context.rpc
      .getLatestBlockhash({ commitment: 'confirmed' })
      .send()
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (message) => setTransactionMessageFeePayerSigner(context.signer, message),
      (message) =>
        setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
      (message) => appendTransactionMessageInstructions(instructions, message),
    )
    onBeforeSend?.()
    let signature: string
    if (isTransactionMessageWithSingleSendingSigner(message)) {
      signature = getBase58Decoder().decode(
        await signAndSendTransactionMessageWithSigners(message),
      )
    } else {
      const transaction = await signTransactionMessageWithSigners(message)
      signature = await context.rpc
        .sendTransaction(getBase64EncodedWireTransaction(transaction), {
          encoding: 'base64',
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3n,
        })
        .send()
    }
    await waitForConfirmedSignature(
      context.rpc,
      signature,
      lifetime.lastValidBlockHeight,
    )
    return signature
  } finally {
    transactionInFlight = false
  }
}

function assertSupportedMarketAddress(marketAddress: Address) {
  if (marketAddress !== getMarketDefinition(1).address) {
    throw new Error(
      'Only the verified SOL/USDC market is supported in this release.',
    )
  }
}
