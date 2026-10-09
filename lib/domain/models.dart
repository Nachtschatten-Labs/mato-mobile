import 'dart:math' as math;

const endSlotInterval = 11;
const intervalArrayLength = 16;
const slotDurationSeconds = 0.2;
const maxOrderDurationSeconds = 365 * 24 * 60 * 60;
final nativeFeeBufferAtoms = BigInt.from(20000000);
final maintenanceFeeBufferAtoms = BigInt.from(1000000);
final flowPrecision = BigInt.from(1000000000);
final bookkeepingPrecision = BigInt.from(1000000000000000);
final maxU128 = (BigInt.one << 128) - BigInt.one;

class MarketDefinition {
  const MarketDefinition({
    required this.id,
    required this.address,
    required this.name,
    required this.baseSymbol,
    required this.quoteSymbol,
    required this.baseMint,
    required this.quoteMint,
    required this.baseDecimals,
    required this.quoteDecimals,
  });
  static const sol = MarketDefinition(
    id: 1,
    address: 'FUDH6hiwDNjdQKbH7fveFFPoEE3mXk9i1g2WbgnSqob3',
    name: 'Solana',
    baseSymbol: 'SOL',
    quoteSymbol: 'USDC',
    baseMint: 'So11111111111111111111111111111111111111112',
    quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    baseDecimals: 9,
    quoteDecimals: 6,
  );
  final int id;
  final String address, name, baseSymbol, quoteSymbol, baseMint, quoteMint;
  final int baseDecimals, quoteDecimals;
  BigInt get minimumBaseDepositAtoms => BigInt.from(1000000);
  BigInt get minimumQuoteDepositAtoms => BigInt.from(100000);
  String get pair => '$baseSymbol/$quoteSymbol';
}

BigInt bigIntValue(dynamic value) =>
    value is BigInt ? value : BigInt.parse(value.toString());
int intValue(dynamic value) => value is BigInt
    ? value.toInt()
    : value is int
    ? value
    : int.parse(value.toString());

class MarketPriceSnapshot {
  const MarketPriceSnapshot({this.eventTime, this.price, this.slot});
  final DateTime? eventTime;
  final double? price;
  final int? slot;
  int? get eventTimeMs => eventTime?.millisecondsSinceEpoch;
}

class MarketCandle {
  const MarketCandle({
    required this.time,
    required this.open,
    required this.high,
    required this.low,
    required this.close,
    this.volume = 0,
  });
  final int time;
  final double open, high, low, close, volume;
}

class MarketUpdate {
  const MarketUpdate({
    required this.id,
    required this.signature,
    required this.eventIndex,
    required this.slot,
    required this.marketAddress,
    required this.baseFlow,
    required this.quoteFlow,
    required this.createdAt,
  });
  final String id, signature, marketAddress;
  final int eventIndex, slot;
  final BigInt baseFlow, quoteFlow;
  final DateTime createdAt;
  double? get price => marketPriceFromFlows(baseFlow, quoteFlow);
  factory MarketUpdate.fromJson(Map<String, dynamic> json) => MarketUpdate(
    id:
        json['event_uid']?.toString() ??
        '${json['signature']}:${json['event_index']}',
    signature: json['signature'] as String,
    eventIndex: intValue(json['event_index'] ?? 0),
    slot: intValue(json['slot']),
    marketAddress: json['market_address'] as String,
    baseFlow: bigIntValue(json['base_flow']),
    quoteFlow: bigIntValue(json['quote_flow']),
    createdAt: DateTime.parse(json['created_at'] as String),
  );
}

class ClosedPosition {
  const ClosedPosition({
    required this.signature,
    required this.eventIndex,
    required this.slot,
    required this.authority,
    required this.marketAddress,
    required this.depositAmount,
    required this.swappedAmount,
    required this.remainingAmount,
    required this.feeAmount,
    required this.isBuy,
    required this.eventTime,
    this.startSlot,
    this.endSlot,
  });
  final String signature, authority, marketAddress;
  final int eventIndex, slot;
  final int? startSlot, endSlot;
  final BigInt depositAmount, swappedAmount, remainingAmount, feeAmount;
  final bool isBuy;
  final DateTime eventTime;
  String get id => '$signature:$eventIndex';
  BigInt get consumedAmount => depositAmount > remainingAmount
      ? depositAmount - remainingAmount
      : BigInt.zero;
  BigInt get receivedAmount =>
      swappedAmount > feeAmount ? swappedAmount - feeAmount : BigInt.zero;
  int get depositDecimals => isBuy ? 6 : 9;
  int get outputDecimals => isBuy ? 9 : 6;
  String get depositSymbol => isBuy ? 'USDC' : 'SOL';
  String get outputSymbol => isBuy ? 'SOL' : 'USDC';
  double? get averagePrice => computeAveragePrice(
    isBuy ? consumedAmount : swappedAmount,
    6,
    isBuy ? swappedAmount : consumedAmount,
    9,
  );
  factory ClosedPosition.fromJson(
    Map<String, dynamic> json,
    String authority,
  ) => ClosedPosition(
    signature: json['signature'] as String,
    eventIndex: intValue(json['event_index']),
    slot: intValue(json['slot']),
    authority: authority,
    marketAddress: json['market_address'] as String,
    depositAmount: bigIntValue(json['deposit_amount']),
    swappedAmount: bigIntValue(json['swapped_amount']),
    remainingAmount: bigIntValue(json['remaining_amount']),
    feeAmount: bigIntValue(json['fee_amount']),
    isBuy: json['is_buy'] == true || json['is_buy'] == 1,
    eventTime: DateTime.parse(json['event_time'] as String),
    startSlot: json['start_slot'] == null ? null : intValue(json['start_slot']),
    endSlot: json['end_slot'] == null ? null : intValue(json['end_slot']),
  );
}

class PageResult<T> {
  const PageResult({
    required this.items,
    required this.hasMore,
    this.beforeSlot,
  });
  final List<T> items;
  final bool hasMore;
  final int? beforeSlot;
}

class PositionRecord {
  const PositionRecord({required this.address, required this.data});
  final String address;
  final Map<String, dynamic> data;
  int get id => intValue(data['id']);
  bool get isBuy => intValue(data['side']) == 1;
  bool get isPaused => bigIntValue(data['pausedAtSlot']) > BigInt.zero;
  int get endSlot =>
      intValue(data['lastUpdateSlot']) + intValue(data['remainingSlots']);
  BigInt get amount => bigIntValue(data['amount']);
}

class WalletBalances {
  const WalletBalances({
    required this.lamports,
    required this.wrappedSol,
    required this.usdc,
  });
  final BigInt lamports, wrappedSol, usdc;
  BigInt get spendableSol =>
      (lamports > nativeFeeBufferAtoms
          ? lamports - nativeFeeBufferAtoms
          : BigInt.zero) +
      wrappedSol;
  BigInt get totalSol => lamports + wrappedSol;
}

class IntervalAccount {
  const IntervalAccount({
    required this.address,
    required this.data,
    required this.lamports,
  });
  final String address;
  final Map<String, dynamic> data;
  final BigInt lamports;
  int get index => intValue(data['index']);
  bool isReclaimable(int currentSlot, String authority) =>
      data['payer'] == authority &&
      data['market'] == MarketDefinition.sol.address &&
      intValue(data['openPositions']) == 0 &&
      currentSlot > (index + 1) * intervalArrayLength * endSlotInterval;
}

class StreamingMarketState {
  const StreamingMarketState({required this.currentSlot, required this.market});
  final int currentSlot;
  final Map<String, dynamic> market;
  int get marketId => intValue(market['id']);
  bool get isPaused => market['isPaused'] == true || market['isPaused'] == 1;
  int get interval => endSlotInterval;
  BigInt get marketBaseFlow => bigIntValue(market['baseFlow']);
  BigInt get marketQuoteFlow => bigIntValue(market['quoteFlow']);
  Map<String, dynamic> get bookkeeping =>
      Map<String, dynamic>.from(market['bookkeeping'] as Map);
  BigInt get bookkeepingBasePerQuote =>
      bigIntValue(bookkeeping['basePerQuote']);
  BigInt get bookkeepingQuotePerBase =>
      bigIntValue(bookkeeping['quotePerBase']);
  int get bookkeepingLastUpdateSlot => intValue(bookkeeping['lastUpdateSlot']);
  int get bookkeepingSlotsWithoutTrades =>
      intValue(bookkeeping['slotsWithoutTrade']);
  BigInt get minimumBaseDepositAtoms =>
      bigIntValue(market['minimumBaseDepositAtoms']);
  BigInt get minimumQuoteDepositAtoms =>
      bigIntValue(market['minimumQuoteDepositAtoms']);
  double? get price => marketPriceFromFlows(marketBaseFlow, marketQuoteFlow);
}

class TradeSettlementSnapshot {
  const TradeSettlementSnapshot({
    required this.slot,
    required this.bookkeeping,
    required this.slotsWithoutTrades,
  });
  final int slot, slotsWithoutTrades;
  final BigInt bookkeeping;
}

double? marketPriceFromFlows(
  BigInt baseFlow,
  BigInt quoteFlow, [
  int baseDecimals = 9,
  int quoteDecimals = 6,
]) => computeAveragePrice(
  quoteFlow.abs(),
  quoteDecimals,
  baseFlow.abs(),
  baseDecimals,
);
double? computeAveragePrice(
  BigInt quoteAtoms,
  int quoteDecimals,
  BigInt baseAtoms,
  int baseDecimals,
) {
  if (baseAtoms <= BigInt.zero) return null;
  final price =
      (quoteAtoms.toDouble() / math.pow(10, quoteDecimals)) /
      (baseAtoms.toDouble() / math.pow(10, baseDecimals));
  return price.isFinite && price > 0 ? price : null;
}
