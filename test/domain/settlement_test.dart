import 'package:flutter_test/flutter_test.dart';
import 'package:mato_mobile/domain/models.dart';
import 'package:mato_mobile/domain/settlement.dart';

Map<String, dynamic> interval() => {
  'baseExits': List.filled(16, BigInt.zero),
  'quoteExits': List.filled(16, BigInt.zero),
  'basePerQuoteSnapshot': List.filled(16, BigInt.zero),
  'quotePerBaseSnapshot': List.filled(16, BigInt.zero),
  'slotsWithoutTradesSnapshot': List.filled(16, 0),
};
Map<String, dynamic> market({int slot = 15}) => {
  'baseFlow': BigInt.from(100),
  'quoteFlow': BigInt.from(200),
  'bookkeeping': {
    'lastUpdateSlot': BigInt.from(slot),
    'basePerQuote': BigInt.from(3) * bookkeepingPrecision,
    'quotePerBase': BigInt.from(12) * bookkeepingPrecision,
    'slotsWithoutTrade': 4,
  },
};
PositionRecord position([Map<String, dynamic> overrides = const {}]) =>
    PositionRecord(
      address: 'position',
      data: {
        'amount': BigInt.from(100),
        'flow': BigInt.from(10000000000),
        'bookkeepingSnapshot': BigInt.zero,
        'inactiveRefund': BigInt.zero,
        'lastUpdateSlot': BigInt.zero,
        'remainingSlots': 10,
        'pausedAtSlot': BigInt.zero,
        'swappedAmountAtSnapshot': BigInt.zero,
        'withdrawnAmount': BigInt.zero,
        'slotsWithoutTradesSnapshot': 0,
        'side': 1,
        ...overrides,
      },
    );

void main() {
  test(
    'scheduled exits accrue old flow through boundary before reducing flow',
    () {
      final account = interval();
      account['quoteExits'][2] = BigInt.from(100);
      account['baseExits'][3] = BigInt.from(100);
      final result = resolveEndSlotSettlement(
        endSlot: 30,
        interval: 10,
        intervals: {0: account},
        isBuy: true,
        market: market(),
      );
      expect(result?.bookkeeping, BigInt.parse('15500000000000000'));
      expect(result?.slotsWithoutTrades, 4);
      account['baseExits'][2] = BigInt.from(100);
      final inactive = resolveEndSlotSettlement(
        endSlot: 30,
        interval: 10,
        intervals: {0: account},
        isBuy: true,
        market: market(),
      );
      expect(inactive?.bookkeeping, BigInt.parse('5500000000000000'));
      expect(inactive?.slotsWithoutTrades, 14);
    },
  );
  test('bookkeeping truncates per slot including protocol overflow branch', () {
    final state = market();
    state['baseFlow'] = BigInt.one;
    state['quoteFlow'] = BigInt.from(3);
    expect(
      resolveEndSlotSettlement(
        endSlot: 30,
        interval: 10,
        intervals: {0: interval()},
        isBuy: true,
        market: state,
      )?.bookkeeping,
      BigInt.parse('7999999999999995'),
    );
    state['baseFlow'] = BigInt.one << 100;
    state['quoteFlow'] = BigInt.from(3) << 100;
    expect(
      resolveEndSlotSettlement(
        endSlot: 30,
        interval: 10,
        intervals: {0: interval()},
        isBuy: true,
        market: state,
      )?.bookkeeping,
      BigInt.parse('7999995000000000'),
    );
  });
  test(
    'authoritative zero settlement is preserved and unread history is unknown',
    () {
      final account = interval();
      account['slotsWithoutTradesSnapshot'][3] = 30;
      final result = resolveEndSlotSettlement(
        endSlot: 30,
        interval: 10,
        intervals: {0: account},
        isBuy: true,
        market: market(slot: 35),
      );
      expect(result?.bookkeeping, BigInt.zero);
      expect(result?.slotsWithoutTrades, 30);
      expect(
        resolveEndSlotSettlement(
          endSlot: 170,
          interval: 10,
          intervals: {1: interval()},
          isBuy: true,
          market: market(),
        ),
        isNull,
      );
    },
  );
  test(
    'real 200 USDC incident preserves 31 inactive slots and correct fill',
    () {
      final trade = position({
        'amount': BigInt.from(200000000),
        'flow': BigInt.parse('1315789473684210'),
        'bookkeepingSnapshot': BigInt.parse('177046755476474378541'),
        'lastUpdateSlot': BigInt.from(454047222),
        'remainingSlots': 152,
        'slotsWithoutTradesSnapshot': 163093,
      });
      final result = getActivePositionMetrics(
        position: trade,
        streamingState: StreamingMarketState(
          currentSlot: 454048611,
          market: market(),
        ),
        endSlotBookkeepingSnapshot: TradeSettlementSnapshot(
          slot: 454047374,
          bookkeeping: BigInt.parse('178048803853655046724'),
          slotsWithoutTrades: 163124,
        ),
      );
      expect(result.consumedAtoms, BigInt.from(159210527));
      expect(result.remainingAtoms, BigInt.from(40789473));
      expect(result.swappedAtoms, BigInt.from(1318484706));
      expect(result.progressPercent, closeTo(79.61, 0.00001));
      expect(result.averagePrice, closeTo(120.7526536147777, 0.0000001));
    },
  );
  test(
    'paused funds freeze and ended positions wait for authoritative snapshot',
    () {
      final paused = position({
        'pausedAtSlot': BigInt.from(5),
        'lastUpdateSlot': BigInt.from(5),
        'remainingSlots': 5,
        'swappedAmountAtSnapshot': BigInt.from(40),
        'withdrawnAmount': BigInt.from(10),
      });
      final result = getActivePositionMetrics(
        position: paused,
        streamingState: null,
      );
      expect(result.remainingAtoms, BigInt.from(50));
      expect(result.claimableSwappedAtoms, BigInt.from(30));
      expect(result.hasPositionEnded, isFalse);
      final ended = getActivePositionMetrics(
        position: position(),
        streamingState: StreamingMarketState(
          currentSlot: 20,
          market: market(slot: 20),
        ),
      );
      expect(ended.hasPositionEnded, isTrue);
      expect(ended.swappedAtoms, isNull);
      expect(ended.remainingAtoms, isNull);
    },
  );
}
