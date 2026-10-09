import 'package:flutter_test/flutter_test.dart';
import 'package:mato_mobile/domain/models.dart';
import 'package:mato_mobile/ui/trade_presentation.dart';

StreamingMarketState market({int? fee = 25, bool liquid = true}) =>
    StreamingMarketState(
      currentSlot: 100,
      market: {
        'baseFlow': BigInt.parse(liquid ? '1000000000000000000' : '0'),
        'quoteFlow': BigInt.parse('150000000000000000000'),
        'feeBps': ?fee,
      },
    );

void main() {
  test('buy quote deducts the on-chain fee from received SOL', () {
    final state = market();
    final quote = TradeQuote.calculate(
      amount: BigInt.from(100000000),
      isBuy: true,
      durationSlots: 3000,
      market: state,
    );
    expect(quote.feePercent, .25);
    expect(quote.executionPrice, greaterThan(state.price!));
    expect(quote.grossReceive, closeTo(100 / quote.executionPrice!, 1e-12));
    expect(quote.feeAmount, closeTo(quote.grossReceive! * .0025, 1e-12));
    expect(quote.netReceive, closeTo(quote.grossReceive! * .9975, 1e-12));
    expect(
      quote.impactCost,
      closeTo(100 / state.price! - quote.grossReceive!, 1e-12),
    );
  });

  test('sell quote deducts fee in USDC after the downward price impact', () {
    final state = market();
    final quote = TradeQuote.calculate(
      amount: BigInt.from(1000000000),
      isBuy: false,
      durationSlots: 3000,
      market: state,
    );
    expect(quote.executionPrice, lessThan(state.price!));
    expect(quote.grossReceive, quote.executionPrice);
    expect(quote.netReceive, closeTo(quote.executionPrice! * .9975, 1e-9));
    expect(quote.impactCost, closeTo(state.price! - quote.grossReceive!, 1e-9));
  });

  test('missing fee or liquidity never fabricates a net receive quote', () {
    for (final state in [market(fee: null), market(liquid: false)]) {
      final quote = TradeQuote.calculate(
        amount: BigInt.from(100000000),
        isBuy: true,
        durationSlots: 3000,
        market: state,
      );
      expect(quote.netReceive, isNull);
    }
  });

  test('inverse prices also invert the magnitude of the displayed impact', () {
    expect(signedTradeImpact(25, true, inverse: true), -20);
    expect(signedTradeImpact(20, false, inverse: true), 25);
    expect(signedTradeImpact(100, false, inverse: true), isNull);
    expect(impactLabel(.0001), '+<0.001%');
    expect(impactLabel(-.125), '−0.125%');
  });

  test(
    'duration slider preserves exact custom and recommended slot durations',
    () {
      final steps = tradeDurationSteps(5.2, 137);
      expect(steps, containsAll([5.0, 5.2, 137.0, 4500.0, 31536000.0]));
      expect(durationAtFraction(durationFraction(5.2), steps), 5.2);
      expect(durationAtFraction(durationFraction(137), steps), 137);
      expect(exactTradeDuration(5.2), '5.2 seconds');
      expect(exactTradeDuration(4500), '1 h 15 min');
      expect(orderDuration(4500, custom: true), '1 h 15 min');
      expect(orderDuration(4500, custom: false), '1 hour 30 minutes');
      expect(orderDuration(86400, custom: true), '24 hours');
      expect(orderDuration(38 * 86400, custom: false), '1 month 1 week 1 day');
    },
  );

  test('finish time includes the calendar date after midnight', () {
    expect(
      streamFinishTime(120, now: DateTime(2026, 10, 9, 23, 59)),
      'Finishes at 00:01 · Oct 10',
    );
    expect(
      streamFinishTime(120, now: DateTime(2026, 12, 31, 23, 59)),
      'Finishes at 00:01 · Jan 1, 2027',
    );
  });
}
