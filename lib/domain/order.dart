import 'models.dart';

const minDurationSlots = 25;
const maxDurationSlots = 157680000;
const durationOptions = <int>[
  5,
  10,
  20,
  30,
  60,
  300,
  600,
  1800,
  3600,
  7200,
  14400,
  43200,
  86400,
  259200,
  604800,
  2592000,
  7776000,
  15552000,
  maxOrderDurationSeconds,
];

double? computePriceImpactPercent({
  required BigInt? amountAtoms,
  required bool isBuy,
  required int durationSlots,
  required StreamingMarketState? streamingState,
}) {
  if (amountAtoms == null ||
      amountAtoms <= BigInt.zero ||
      streamingState == null) {
    return null;
  }
  final marketFlow = isBuy
      ? streamingState.marketQuoteFlow
      : streamingState.marketBaseFlow;
  final effectiveDuration = BigInt.from(
    durationSlots * 2 - streamingState.interval,
  );
  if (marketFlow <= BigInt.zero || effectiveDuration <= BigInt.zero) {
    return null;
  }
  final amountTwice = amountAtoms * flowPrecision * BigInt.two;
  final denominator =
      marketFlow * effectiveDuration + (isBuy ? BigInt.zero : amountTwice);
  final impact = amountTwice.toDouble() / denominator.toDouble() * 100;
  return impact.isFinite ? impact : null;
}

int? recommendDurationSlots({
  required BigInt? amountAtoms,
  required bool isBuy,
  required StreamingMarketState? streamingState,
}) {
  if (amountAtoms == null ||
      amountAtoms <= BigInt.zero ||
      streamingState == null ||
      streamingState.marketBaseFlow <= BigInt.zero ||
      streamingState.marketQuoteFlow <= BigInt.zero) {
    return null;
  }
  final marketFlow = isBuy
      ? streamingState.marketQuoteFlow
      : streamingState.marketBaseFlow;
  final interval = BigInt.from(streamingState.interval);
  final amountTwice = amountAtoms * flowPrecision * BigInt.two;
  final shortest =
      (BigInt.from(isBuy ? 10000 : 9999) * amountTwice +
              marketFlow * interval) ~/
          (marketFlow * BigInt.two) +
      BigInt.one;
  final bounded = shortest < BigInt.from(minDurationSlots)
      ? BigInt.from(minDurationSlots)
      : shortest;
  final minute = BigInt.from(300);
  final target = bounded <= minute
      ? bounded
      : ((bounded + minute - BigInt.one) ~/ minute) * minute;
  final recommended = target > BigInt.from(maxDurationSlots)
      ? BigInt.from(maxDurationSlots)
      : target;
  if (amountAtoms < recommended + interval ~/ BigInt.two) return null;
  return recommended.toInt();
}

/// Returns the first actionable blocker. A null value allows review; submission
/// must repeat these checks with fresh balances and chain state.
String? validateOrder({
  required BigInt? amountAtoms,
  required bool isBuy,
  required int? durationSlots,
  required StreamingMarketState? streamingState,
  required WalletBalances? balances,
  required bool walletConnected,
  required bool transactionsEnabled,
}) {
  if (!walletConnected) return 'Connect a wallet to trade.';
  if (!transactionsEnabled) {
    return 'Transactions are disabled by this build configuration.';
  }
  if (streamingState == null) return 'Waiting for live market state.';
  if (streamingState.isPaused) return 'This market is paused.';
  if (streamingState.marketBaseFlow <= BigInt.zero ||
      streamingState.marketQuoteFlow <= BigInt.zero) {
    return 'Waiting for liquidity on both sides of this market.';
  }
  if (amountAtoms == null || amountAtoms <= BigInt.zero) {
    return 'Enter a valid amount.';
  }
  final maxU64 = (BigInt.one << 64) - BigInt.one;
  if (amountAtoms > maxU64) return 'Amount exceeds the supported token range.';
  final minimum = isBuy
      ? streamingState.minimumQuoteDepositAtoms
      : streamingState.minimumBaseDepositAtoms;
  if (amountAtoms < minimum) return 'Amount is below the market minimum.';
  if (durationSlots == null) return 'Choose a duration.';
  if (durationSlots < minDurationSlots || durationSlots > maxDurationSlots) {
    return 'Choose a duration between 5 seconds and 1 year.';
  }
  if (amountAtoms < BigInt.from(durationSlots + streamingState.interval ~/ 2)) {
    return 'Amount is too small for this duration.';
  }
  if (balances == null) return 'Waiting for wallet balances.';
  if (balances.lamports < nativeFeeBufferAtoms) {
    return 'Keep at least 0.02 SOL available for network fees and account rent.';
  }
  if (amountAtoms > (isBuy ? balances.usdc : balances.spendableSol)) {
    return 'Insufficient ${isBuy ? 'USDC' : 'SOL'} balance.';
  }
  return null;
}

bool requiresNewImpactReview(double? previous, double? current) =>
    current == null ||
    previous == null ||
    (current > 1 && previous <= 1) ||
    current > previous + 0.1;
