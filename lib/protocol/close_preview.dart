import 'dart:convert';
import 'account_codec.dart';
import 'bytes.dart';
import 'constants.dart';

/// Only verified program events matching every position identity field count.
/// A close's fee event is authoritative because prior withdrawals already paid
/// their fees and must not be charged a second time in the review.
Map<String, BigInt> readCloseSimulation({
  required List<String> logs,
  required Map<String, dynamic> position,
  required String positionAddress,
}) {
  final stack = <String>[];
  Map<String, dynamic>? closed;
  Map<String, dynamic>? chargedFee;
  for (final log in logs) {
    final invoked = RegExp(r'^Program (\w+) invoke \[\d+\]$').firstMatch(log);
    if (invoked != null) {
      stack.add(invoked[1]!);
      continue;
    }
    if (RegExp(r'^Program \w+ (success|failed:)').hasMatch(log)) {
      if (stack.isNotEmpty) stack.removeLast();
      continue;
    }
    if (stack.isEmpty ||
        stack.last != programId ||
        !log.startsWith('Program data: ')) {
      continue;
    }
    try {
      final bytes = base64Decode(log.substring('Program data: '.length));
      try {
        final event = decodeAccount('closePositionEvent', bytes);
        if (event['positionAddress'] == positionAddress &&
            event['market'] == position['market'] &&
            event['positionAuthority'] == position['authority'] &&
            event['side'] == position['side'] &&
            event['baseReceiver'] == position['baseReceiver'] &&
            event['quoteReceiver'] == position['quoteReceiver']) {
          closed = event;
        }
      } on FormatException {
        /* Other events use different discriminators. */
      }
      try {
        final event = decodeAccount('tradeFeeCollectedEvent', bytes);
        final expectedMint = position['side'] == 1 ? wrappedSolMint : usdcMint;
        if (event['position'] == positionAddress &&
            event['market'] == position['market'] &&
            event['mint'] == expectedMint) {
          chargedFee = event;
        }
      } on FormatException {
        /* Other events use different discriminators. */
      }
    } on FormatException {
      /* Ignore malformed data from unrelated log entries. */
    }
  }
  if (closed == null ||
      chargedFee == null ||
      asBigInt(closed['swappedAmount']) <
          asBigInt(position['withdrawnAmount'])) {
    throw StateError(
      'The close preview did not include a complete settlement. Please refresh it.',
    );
  }
  final claimable =
      asBigInt(closed['swappedAmount']) - asBigInt(position['withdrawnAmount']);
  final fee = asBigInt(chargedFee['totalFee']);
  if (fee > claimable) {
    throw StateError('The close preview returned an invalid fee.');
  }
  return {
    'remainingDepositAtoms': asBigInt(closed['remainingAmount']),
    'receivedAtoms': claimable - fee,
    'feeAtoms': fee,
  };
}
