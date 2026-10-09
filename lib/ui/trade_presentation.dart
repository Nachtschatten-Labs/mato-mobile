import 'dart:math' as math;
import '../domain/models.dart';
import '../domain/order.dart';

/// The v1 quote uses the on-chain rate, applies the side's price impact, then
/// deducts the market's actual fee from the received token.
class TradeQuote {
  const TradeQuote({
    this.impact,
    this.executionPrice,
    this.grossReceive,
    this.impactCost,
    this.feePercent,
    this.feeAmount,
    this.netReceive,
  });

  final double? impact, executionPrice, grossReceive, impactCost;
  final double? feePercent, feeAmount, netReceive;

  factory TradeQuote.calculate({
    required BigInt? amount,
    required bool isBuy,
    required int? durationSlots,
    required StreamingMarketState? market,
  }) {
    final impact = durationSlots == null
        ? null
        : computePriceImpactPercent(
            amountAtoms: amount,
            isBuy: isBuy,
            durationSlots: durationSlots,
            streamingState: market,
          );
    final price = market?.price;
    final feeBps = int.tryParse('${market?.market['feeBps']}');
    final feePercent = feeBps == null || feeBps < 0 || feeBps > 10000
        ? null
        : feeBps / 100;
    if (price == null || impact == null || amount == null) {
      return TradeQuote(impact: impact, feePercent: feePercent);
    }
    final execution = price * (1 + (isBuy ? impact : -impact) / 100);
    if (!execution.isFinite || execution <= 0) {
      return TradeQuote(impact: impact, feePercent: feePercent);
    }
    final input = amount.toDouble() / math.pow(10, isBuy ? 6 : 9);
    final gross = isBuy ? input / execution : input * execution;
    final unimpacted = isBuy ? input / price : input * price;
    final fee = feePercent == null ? null : gross * feePercent / 100;
    return TradeQuote(
      impact: impact,
      executionPrice: execution,
      grossReceive: gross,
      impactCost: math.max(0, unimpacted - gross),
      feePercent: feePercent,
      feeAmount: fee,
      netReceive: fee == null ? null : gross - fee,
    );
  }
}

double? signedTradeImpact(double? impact, bool isBuy, {bool inverse = false}) {
  if (impact == null || !impact.isFinite || impact < 0) return null;
  final signed = isBuy ? impact : -impact;
  final ratio = 1 + signed / 100;
  if (ratio <= 0) return null;
  return inverse ? -signed / ratio : signed;
}

String impactLabel(double? impact) {
  if (impact == null || !impact.isFinite) return '—';
  final magnitude = impact.abs();
  final value = magnitude > 0 && magnitude < .001
      ? '<0.001'
      : magnitude.toStringAsFixed(3);
  return '${impact > 0
      ? '+'
      : impact < 0
      ? '−'
      : ''}$value%';
}

String tradeNumber(double? value, [int decimals = 4]) {
  if (value == null || !value.isFinite) return '—';
  if (value > 0 && value < math.pow(10, -decimals)) {
    return '<${math.pow(10, -decimals).toStringAsFixed(decimals)}';
  }
  final raw = value.abs().toStringAsFixed(decimals);
  final parts = raw.split('.');
  final whole = parts.first.replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (_) => ',',
  );
  final fraction = parts.length < 2
      ? ''
      : parts[1].replaceFirst(RegExp(r'0+$'), '');
  return '${value < 0 ? '−' : ''}$whole${fraction.isEmpty ? '' : '.$fraction'}';
}

List<double> tradeDurationSteps([double? current, double? recommended]) {
  final values = <double>{5, 10, 20, 30, 900, 1200, 1800};
  void range(int start, int end, int step) {
    for (var seconds = start; seconds <= end; seconds += step) {
      values.add(seconds.toDouble());
    }
  }

  range(60, 600, 60);
  range(2700, 14400, 900);
  range(18000, 86400, 3600);
  range(172800, 604800, 86400);
  range(1209600, 4838400, 604800);
  range(2592000, 31104000, 2592000);
  values.add(maxOrderDurationSeconds.toDouble());
  for (final extra in [current, recommended]) {
    if (extra != null && extra >= 5 && extra <= maxOrderDurationSeconds) {
      values.add(extra);
    }
  }
  return values.toList()..sort();
}

double durationFraction(double seconds) =>
    math.log(math.max(5, seconds) / 5) / math.log(maxOrderDurationSeconds / 5);

double durationAtFraction(double fraction, List<double> steps) => steps.reduce(
  (closest, seconds) =>
      (durationFraction(seconds) - fraction).abs() <
          (durationFraction(closest) - fraction).abs()
      ? seconds
      : closest,
);

String exactTradeDuration(num seconds) {
  if (seconds >= maxOrderDurationSeconds) return '1 year';
  if (seconds >= 3600 && seconds % 3600 != 0 && seconds % 60 == 0) {
    return '${seconds ~/ 3600} h ${seconds % 3600 ~/ 60} min';
  }
  for (final (size, label) in [
    (2592000, 'month'),
    (604800, 'week'),
    (86400, 'day'),
    (3600, 'hour'),
    (60, 'minute'),
  ]) {
    if (seconds >= size && seconds % size == 0) {
      final value = seconds ~/ size;
      return '$value $label${value == 1 ? '' : 's'}';
    }
  }
  if (seconds >= 60) {
    return '${seconds ~/ 60} min ${tradeNumber((seconds % 60).toDouble(), 1)} s';
  }
  return '${tradeNumber(seconds.toDouble(), 1)} seconds';
}

String orderDuration(num seconds, {required bool custom}) {
  if (custom) {
    return seconds == 86400 ? '24 hours' : exactTradeDuration(seconds);
  }
  if (seconds < 10) return 'few seconds';
  final increment = seconds < 60
      ? 5
      : seconds < 3600
      ? 60
      : seconds < 86400
      ? 1800
      : 86400;
  final rounded = (seconds / increment).ceil() * increment;
  if (rounded >= maxOrderDurationSeconds) return '1 year';
  if (rounded < 86400) {
    if (rounded >= 3600 && rounded % 3600 != 0) {
      final hours = rounded ~/ 3600;
      return '$hours hour${hours == 1 ? '' : 's'} ${rounded % 3600 ~/ 60} minutes';
    }
    return exactTradeDuration(rounded);
  }
  final days = rounded ~/ 86400;
  if (days == 7) return 'week';
  final units = [
    (days ~/ 30, 'month'),
    ((days % 30) ~/ 7, 'week'),
    ((days % 30) % 7, 'day'),
  ];
  return units
      .where((unit) => unit.$1 > 0)
      .map((unit) => '${unit.$1} ${unit.$2}${unit.$1 == 1 ? '' : 's'}')
      .join(' ');
}

String streamFinishTime(num seconds, {DateTime? now}) {
  final today = now ?? DateTime.now();
  final finish = today.add(Duration(milliseconds: (seconds * 1000).round()));
  final time =
      '${finish.hour.toString().padLeft(2, '0')}:${finish.minute.toString().padLeft(2, '0')}';
  if (finish.year == today.year &&
      finish.month == today.month &&
      finish.day == today.day) {
    return 'Finishes at $time';
  }
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return 'Finishes at $time · ${months[finish.month - 1]} ${finish.day}${finish.year == today.year ? '' : ', ${finish.year}'}';
}
