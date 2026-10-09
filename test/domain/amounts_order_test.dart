import 'package:flutter_test/flutter_test.dart';
import 'package:mato_mobile/domain/amounts.dart';
import 'package:mato_mobile/domain/models.dart';
import 'package:mato_mobile/domain/order.dart';

void main() {
  test('amounts preserve integers above IEEE double precision', () {
    final amount = BigInt.parse('18446744073709551615');
    expect(parseTokenAmount('18446744073.709551615', 9), amount);
    expect(formatAtomsToInput(amount, 9), '18446744073.709551615');
    expect(parseTokenAmount('0.000001', 6), BigInt.one);
    expect(parseTokenAmount('1.0000000', 6), BigInt.from(1000000));
    for (final invalid in ['1,000', '-1', '1.0000001', '1.2.3', '', '.']) {
      expect(parseTokenAmount(invalid, 6), isNull, reason: invalid);
    }
  });
  test('native SOL reserve is never available to the percentage selector', () {
    expect(
      getSpendableNativeAtoms(nativeFeeBufferAtoms + BigInt.one, BigInt.zero),
      BigInt.one,
    );
    expect(
      getSpendableNativeAtoms(BigInt.zero, BigInt.from(7)),
      BigInt.from(7),
    );
    final amount = BigInt.parse('9007199254740991000');
    expect(atomsFromPercent(amount, 25), amount ~/ BigInt.from(4));
    expect(toSliderPercent(amount * BigInt.two, amount), 100);
  });
  test('duration recommendation retains odd interval and exact threshold', () {
    final state = StreamingMarketState(
      currentSlot: 100,
      market: {
        'baseFlow': BigInt.parse('10000000000000000'),
        'quoteFlow': BigInt.parse('10000000000000000'),
      },
    );
    expect(
      recommendDurationSlots(
        amountAtoms: BigInt.from(30000),
        isBuy: true,
        streamingState: state,
      ),
      36,
    );
    expect(
      recommendDurationSlots(
        amountAtoms: BigInt.from(29),
        isBuy: true,
        streamingState: state,
      ),
      isNull,
    );
    expect(
      recommendDurationSlots(
        amountAtoms: BigInt.from(30),
        isBuy: true,
        streamingState: state,
      ),
      25,
    );
    final chosen = recommendDurationSlots(
      amountAtoms: BigInt.from(30000),
      isBuy: true,
      streamingState: state,
    )!;
    expect(
      computePriceImpactPercent(
        amountAtoms: BigInt.from(30000),
        isBuy: true,
        durationSlots: chosen,
        streamingState: state,
      ),
      lessThan(0.01),
    );
    expect(
      computePriceImpactPercent(
        amountAtoms: BigInt.from(30000),
        isBuy: true,
        durationSlots: chosen - 1,
        streamingState: state,
      ),
      greaterThanOrEqualTo(0.01),
    );
  });
  test(
    'review expires when impact is unavailable, grows or crosses warning',
    () {
      expect(requiresNewImpactReview(0.95, 1.01), isTrue);
      expect(requiresNewImpactReview(1.1, 1.21), isTrue);
      expect(requiresNewImpactReview(2, null), isTrue);
      expect(requiresNewImpactReview(1.1, 1.05), isFalse);
    },
  );
}
