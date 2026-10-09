import 'dart:math' as math;
import 'models.dart';

/// Replays scheduled accounting with the program's overflow-safe integer rules.
/// A missing map key means unread, while a null value means a confirmed absent account.
TradeSettlementSnapshot? resolveEndSlotSettlement({
  required int endSlot,
  required int interval,
  required Map<int, Map<String, dynamic>?> intervals,
  required bool isBuy,
  required Map<String, dynamic> market,
}) {
  if (interval <= 0) return null;
  final endIndex = endSlot ~/ interval ~/ intervalArrayLength;
  final snapshotIndex = endSlot ~/ interval % intervalArrayLength;
  final endInterval = intervals[endIndex];
  if (endInterval == null) return null;
  final books = market['bookkeeping'] as Map;
  var slot = intValue(books['lastUpdateSlot']);
  if (slot >= endSlot) {
    final snapshots =
        endInterval[isBuy ? 'basePerQuoteSnapshot' : 'quotePerBaseSnapshot']
            as List;
    final inactive = endInterval['slotsWithoutTradesSnapshot'] as List;
    if (snapshotIndex >= snapshots.length || snapshotIndex >= inactive.length) {
      return null;
    }
    return TradeSettlementSnapshot(
      slot: endSlot,
      bookkeeping: bigIntValue(snapshots[snapshotIndex]),
      slotsWithoutTrades: intValue(inactive[snapshotIndex]),
    );
  }
  var bookkeeping = bigIntValue(books[isBuy ? 'basePerQuote' : 'quotePerBase']);
  var slotsWithoutTrades = intValue(books['slotsWithoutTrade']);
  var baseFlow = bigIntValue(market['baseFlow']);
  var quoteFlow = bigIntValue(market['quoteFlow']);
  for (
    var boundary = (slot ~/ interval + 1) * interval;
    boundary <= endSlot;
    boundary += interval
  ) {
    final index = boundary ~/ interval ~/ intervalArrayLength;
    if (!intervals.containsKey(index)) return null;
    final account = intervals[index];
    final entry = boundary ~/ interval % intervalArrayLength;
    final elapsed = boundary - slot;
    if (baseFlow == BigInt.zero || quoteFlow == BigInt.zero) {
      slotsWithoutTrades += elapsed;
    } else {
      final outputFlow = isBuy ? baseFlow : quoteFlow;
      final inputFlow = isBuy ? quoteFlow : baseFlow;
      final price = outputFlow >= maxU128 ~/ bookkeepingPrecision
          ? (((bookkeepingPrecision ~/ flowPrecision) * outputFlow) ~/
                    inputFlow) *
                flowPrecision
          : (bookkeepingPrecision * outputFlow) ~/ inputFlow;
      bookkeeping += price * BigInt.from(elapsed);
      if (bookkeeping > maxU128) return null;
    }
    slot = boundary;
    if (boundary == endSlot) break;
    baseFlow -= account == null
        ? BigInt.zero
        : bigIntValue((account['baseExits'] as List)[entry]);
    quoteFlow -= account == null
        ? BigInt.zero
        : bigIntValue((account['quoteExits'] as List)[entry]);
    if (baseFlow < BigInt.zero || quoteFlow < BigInt.zero) return null;
  }
  return slot == endSlot
      ? TradeSettlementSnapshot(
          slot: slot,
          bookkeeping: bookkeeping,
          slotsWithoutTrades: slotsWithoutTrades,
        )
      : null;
}

class PositionProgress {
  const PositionProgress({
    required this.amountAtoms,
    required this.remainingAtoms,
    required this.swappedAtoms,
    required this.claimableSwappedAtoms,
    required this.consumedAtoms,
    required this.progressPercent,
    required this.averagePrice,
    required this.isPaused,
    required this.hasPositionEnded,
    required this.flowAtomsPerSlot,
    required this.isBuy,
  });
  final BigInt amountAtoms, flowAtomsPerSlot;
  final BigInt? remainingAtoms,
      swappedAtoms,
      claimableSwappedAtoms,
      consumedAtoms;
  final double? progressPercent, averagePrice;
  final bool isPaused, hasPositionEnded, isBuy;
  double? get remainingPercent =>
      progressPercent == null ? null : 100 - progressPercent!;
  String get depositSymbol => isBuy ? 'USDC' : 'SOL';
  String get outputSymbol => isBuy ? 'SOL' : 'USDC';
  int get depositDecimals => isBuy ? 6 : 9;
  int get outputDecimals => isBuy ? 9 : 6;
}

BigInt _calculateSwappedAmount(BigInt flow, BigInt accumulatedPrices) {
  final scaledFlow = flow ~/ BigInt.from(10000);
  if (scaledFlow == BigInt.zero || accumulatedPrices <= maxU128 ~/ scaledFlow) {
    return (scaledFlow * accumulatedPrices) ~/
        bookkeepingPrecision ~/
        BigInt.from(100000);
  }
  return ((flow ~/ flowPrecision) * accumulatedPrices) ~/ bookkeepingPrecision;
}

PositionProgress getActivePositionMetrics({
  required PositionRecord position,
  required StreamingMarketState? streamingState,
  TradeSettlementSnapshot? endSlotBookkeepingSnapshot,
}) {
  final data = position.data;
  final isBuy = position.isBuy;
  final isPaused = position.isPaused;
  final amount = position.amount;
  final end = position.endSlot;
  final lastUpdate = intValue(data['lastUpdateSlot']);
  final flow = bigIntValue(data['flow']);
  final positionBooks = bigIntValue(data['bookkeepingSnapshot']);
  final positionInactive = intValue(data['slotsWithoutTradesSnapshot']);
  final ended =
      !isPaused &&
      ((streamingState?.currentSlot ?? 0) >= end ||
          endSlotBookkeepingSnapshot?.slot == end);
  TradeSettlementSnapshot? snapshot;
  if (!isPaused) {
    if (ended && endSlotBookkeepingSnapshot?.slot == end) {
      snapshot = endSlotBookkeepingSnapshot;
    } else if (streamingState != null &&
        streamingState.bookkeepingLastUpdateSlot >= lastUpdate &&
        streamingState.bookkeepingLastUpdateSlot <= end &&
        (!ended || streamingState.bookkeepingLastUpdateSlot == end)) {
      final current = math
          .max(
            streamingState.currentSlot,
            streamingState.bookkeepingLastUpdateSlot,
          )
          .clamp(lastUpdate, end);
      final staleSlots = current - streamingState.bookkeepingLastUpdateSlot;
      final hasTrades =
          streamingState.marketBaseFlow > BigInt.zero &&
          streamingState.marketQuoteFlow > BigInt.zero;
      final outputFlow = isBuy
          ? streamingState.marketBaseFlow
          : streamingState.marketQuoteFlow;
      final inputFlow = isBuy
          ? streamingState.marketQuoteFlow
          : streamingState.marketBaseFlow;
      final liveBooks = isBuy
          ? streamingState.bookkeepingBasePerQuote
          : streamingState.bookkeepingQuotePerBase;
      final perSlotPrice = hasTrades
          ? bookkeepingPrecision * outputFlow ~/ inputFlow
          : BigInt.zero;
      snapshot = TradeSettlementSnapshot(
        slot: current,
        bookkeeping: liveBooks + perSlotPrice * BigInt.from(staleSlots),
        slotsWithoutTrades:
            streamingState.bookkeepingSlotsWithoutTrades +
            (hasTrades ? 0 : staleSlots),
      );
    }
  }
  if (snapshot != null &&
      (snapshot.bookkeeping < positionBooks ||
          snapshot.slotsWithoutTrades < positionInactive ||
          snapshot.slotsWithoutTrades - positionInactive >
              snapshot.slot - lastUpdate)) {
    snapshot = null;
  }
  BigInt? remaining, swapped;
  if (isPaused || snapshot != null) {
    final refundableSlots = isPaused
        ? intValue(data['remainingSlots'])
        : end - snapshot!.slot + snapshot.slotsWithoutTrades - positionInactive;
    final refund =
        bigIntValue(data['inactiveRefund']) +
        flow * BigInt.from(refundableSlots) ~/ flowPrecision;
    remaining = refund > amount ? amount : refund;
    swapped =
        bigIntValue(data['swappedAmountAtSnapshot']) +
        (isPaused
            ? BigInt.zero
            : _calculateSwappedAmount(
                flow,
                snapshot!.bookkeeping - positionBooks,
              ));
  }
  final consumed = remaining == null ? null : amount - remaining;
  final progress = remaining == null
      ? null
      : amount > BigInt.zero
      ? 100 - (remaining * BigInt.from(10000) ~/ amount).toDouble() / 100
      : 100.0;
  final withdrawn = bigIntValue(data['withdrawnAmount']);
  final claimable = swapped == null
      ? null
      : swapped > withdrawn
      ? swapped - withdrawn
      : BigInt.zero;
  final average = swapped == null || consumed == null
      ? null
      : computeAveragePrice(
          isBuy ? consumed : swapped,
          6,
          isBuy ? swapped : consumed,
          9,
        );
  return PositionProgress(
    amountAtoms: amount,
    remainingAtoms: remaining,
    swappedAtoms: swapped,
    claimableSwappedAtoms: claimable,
    consumedAtoms: consumed,
    progressPercent: progress,
    averagePrice: average,
    isPaused: isPaused,
    hasPositionEnded: ended,
    flowAtomsPerSlot: flow ~/ flowPrecision,
    isBuy: isBuy,
  );
}
