import 'dart:math' as math;
import 'models.dart';

String sanitizeAmountInput(String raw) {
  final parts = raw
      .replaceAll(',', '.')
      .replaceAll(RegExp(r'[^\d.]'), '')
      .split('.');
  return parts.length == 1
      ? parts.first
      : '${parts.first}.${parts.skip(1).join()}';
}

/// Decimal amounts are parsed with integer arithmetic, never floating point.
/// Ambiguous/grouped/negative input is rejected so displayed and spent amounts agree.
BigInt? parseTokenAmount(String input, int decimals) {
  if (decimals < 0 ||
      decimals > 18 ||
      !RegExp(r'^\d*(\.\d*)?$').hasMatch(input) ||
      !RegExp(r'\d').hasMatch(input)) {
    return null;
  }
  final parts = input.split('.');
  final whole = parts.first.isEmpty ? '0' : parts.first;
  final fraction = parts.length == 1 ? '' : parts[1];
  if (fraction.length > decimals &&
      RegExp(r'[1-9]').hasMatch(fraction.substring(decimals))) {
    return null;
  }
  return BigInt.tryParse(
    '$whole${fraction.padRight(decimals, '0').substring(0, decimals)}',
  );
}

String formatAtomsToInput(BigInt atoms, int decimals) {
  if (atoms <= BigInt.zero) return '';
  if (decimals <= 0) return atoms.toString();
  final divisor = BigInt.from(10).pow(decimals);
  final whole = atoms ~/ divisor;
  final fraction = (atoms % divisor)
      .toString()
      .padLeft(decimals, '0')
      .replaceFirst(RegExp(r'0+$'), '');
  return fraction.isEmpty ? '$whole' : '$whole.$fraction';
}

String formatAmount(BigInt? atoms, int decimals, {int precision = 6}) {
  if (atoms == null) return '—';
  if (atoms == BigInt.zero) return '0';
  final sign = atoms.isNegative ? '-' : '';
  final raw = formatAtomsToInput(atoms.abs(), decimals);
  final parts = raw.split('.');
  if (parts.length == 1) return '$sign$raw';
  final fraction = parts[1]
      .substring(0, math.min(parts[1].length, precision))
      .replaceFirst(RegExp(r'0+$'), '');
  return '$sign${parts.first}${fraction.isEmpty ? '' : '.$fraction'}';
}

BigInt getSpendableNativeAtoms(BigInt? lamports, BigInt? wrappedAmount) =>
    ((lamports ?? BigInt.zero) > nativeFeeBufferAtoms
        ? lamports! - nativeFeeBufferAtoms
        : BigInt.zero) +
    (wrappedAmount ?? BigInt.zero);
bool isNativeBalanceBelowTransactionMinimum(
  BigInt? lamports, [
  BigInt? minimum,
]) => lamports != null && lamports < (minimum ?? nativeFeeBufferAtoms);
BigInt atomsFromPercent(BigInt available, double percent) =>
    available *
    BigInt.from((percent.clamp(0, 100) * 100).round()) ~/
    BigInt.from(10000);
double toSliderPercent(BigInt? amount, BigInt? available) =>
    amount == null ||
        available == null ||
        amount <= BigInt.zero ||
        available <= BigInt.zero
    ? 0
    : ((amount > available ? available : amount) *
                  BigInt.from(10000) ~/
                  available)
              .toDouble() /
          100;
int durationToSlots(num seconds) =>
    math.max(1, (seconds / slotDurationSeconds).round());

String tradeDuration(num seconds) {
  final total = seconds.ceil();
  if (total < 60) return '$total second${total == 1 ? '' : 's'}';
  final minutes = (total / 60).ceil();
  if (minutes < 60) return '$minutes minute${minutes == 1 ? '' : 's'}';
  final hours = minutes ~/ 60;
  if (hours < 24) {
    return minutes % 60 == 0
        ? '$hours hour${hours == 1 ? '' : 's'}'
        : '$hours h ${minutes % 60} min';
  }
  final days = (minutes / 1440).ceil();
  if (days >= 365) return '1 year';
  if (days % 30 == 0) return '${days ~/ 30} month${days == 30 ? '' : 's'}';
  if (days % 7 == 0) return '${days ~/ 7} week${days == 7 ? '' : 's'}';
  return '$days day${days == 1 ? '' : 's'}';
}
