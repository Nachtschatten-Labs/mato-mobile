import 'dart:convert';
import 'package:solana/solana.dart' show Ed25519HDPublicKey;
import 'bytes.dart';
import 'constants.dart';

Future<String> deriveAddress(
  List<List<int>> seeds, {
  String program = programId,
}) async => (await Ed25519HDPublicKey.findProgramAddress(
  seeds: seeds,
  programId: Ed25519HDPublicKey.fromBase58(program),
)).toBase58();

Future<String> deriveMarketAddress({
  String baseMint = wrappedSolMint,
  String quoteMint = usdcMint,
  int id = 1,
}) => deriveAddress([
  utf8.encode('market'),
  addressBytes(baseMint),
  addressBytes(quoteMint),
  unsignedLittleEndian(BigInt.from(id), 4),
]);
Future<String> deriveProgramConfigAddress() =>
    deriveAddress([utf8.encode('program_config')]);
Future<String> deriveMarketIntervalAddress(String market, BigInt index) =>
    deriveAddress([
      utf8.encode('market_interval'),
      addressBytes(market),
      unsignedLittleEndian(index, 8),
    ]);
Future<String> deriveTradePositionAddress(
  String market,
  String authority,
  int id,
) => deriveAddress([
  utf8.encode('trade_position'),
  addressBytes(market),
  addressBytes(authority),
  unsignedLittleEndian(BigInt.from(id), 4),
]);
Future<String> deriveAssociatedTokenAddress({
  required String mint,
  required String owner,
  String tokenProgramId = tokenProgram,
}) => deriveAddress([
  addressBytes(owner),
  addressBytes(tokenProgramId),
  addressBytes(mint),
], program: associatedTokenProgram);
Future<String> deriveTemporaryWithdrawTokenAddress(String position) =>
    deriveAddress([addressBytes(position)]);

BigInt getApprovalSafeReferenceIndex(
  int currentSlot,
  BigInt bookkeepingLastUpdateSlot, {
  int interval = endSlotInterval,
}) {
  final current = currentSlot ~/ (arrayLength * interval);
  final updated =
      (bookkeepingLastUpdateSlot ~/ BigInt.from(arrayLength * interval))
          .toInt();
  if (current - updated > 1) {
    throw StateError(
      'Market bookkeeping is behind. Wait for the keeper to catch up and try again.',
    );
  }
  final index = updated == current ? current + 1 : current;
  return BigInt.from(index < 1 ? 1 : index);
}

BigInt getFutureIndex(BigInt slot, {int interval = endSlotInterval}) =>
    slot ~/ BigInt.from(arrayLength * interval);
BigInt alignEndSlot(int slot, int duration, {int interval = endSlotInterval}) =>
    BigInt.from(
      ((slot + duration) * 2 + interval) ~/ (interval * 2) * interval,
    );
BigInt getUnpausedEndSlot(
  int slot,
  int remaining, {
  int interval = endSlotInterval,
}) => BigInt.from(((slot + remaining + interval) ~/ interval) * interval);
BigInt positionEndSlot(Map<String, dynamic> position) =>
    asBigInt(position['lastUpdateSlot']) + asBigInt(position['remainingSlots']);
