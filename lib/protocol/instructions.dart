import 'dart:typed_data';
import 'bytes.dart';
import 'constants.dart';
import 'generated_layouts.dart';

class AccountMeta {
  const AccountMeta(this.address, {this.writable = false, this.signer = false});
  final String address;
  final bool writable;
  final bool signer;
}

class ProgramInstruction {
  const ProgramInstruction({
    required this.program,
    required this.accounts,
    required this.data,
  });
  final String program;
  final List<AccountMeta> accounts;
  final Uint8List data;
}

ProgramInstruction twobInstruction(
  String name,
  Map<String, String> accounts,
  Map<String, dynamic> args,
) {
  final defaults = {
    'systemProgram': systemProgram,
    'associatedTokenProgram': associatedTokenProgram,
    ...accounts,
  };
  final signerNames = name == 'submitOrder'
      ? {'authority', 'payer'}
      : name == 'authorityCloseTradePosition'
      ? {'authority'}
      : {'signer'};
  return ProgramInstruction(
    program: programId,
    accounts: [
      for (final (key, writable) in instructionAccounts[name]!)
        AccountMeta(
          defaults[key] ?? (throw ArgumentError('Missing $name account $key.')),
          writable: writable,
          signer: signerNames.contains(key),
        ),
    ],
    data: Uint8List.fromList([
      ...instructionDiscriminators[name]!,
      for (final (key, size) in instructionLayouts[name]!)
        ...unsignedLittleEndian(asBigInt(args[key]), size),
    ]),
  );
}

ProgramInstruction createAssociatedToken({
  required String payer,
  required String ata,
  required String mint,
  required String owner,
  required String tokenProgramId,
}) => ProgramInstruction(
  program: associatedTokenProgram,
  accounts: [
    AccountMeta(payer, writable: true, signer: true),
    AccountMeta(ata, writable: true),
    AccountMeta(owner),
    AccountMeta(mint),
    const AccountMeta(systemProgram),
    AccountMeta(tokenProgramId),
  ],
  data: Uint8List.fromList([1]),
);

/// Legacy messages support every instruction used here, with no address lookups.
/// The single zeroed signature is replaced by the connected wallet through MWA.
Uint8List compileUnsignedTransaction({
  required String payer,
  required String blockhash,
  required List<ProgramInstruction> instructions,
}) {
  final merged = <String, AccountMeta>{
    payer: AccountMeta(payer, writable: true, signer: true),
  };
  void merge(AccountMeta meta) {
    addressBytes(meta.address);
    final old = merged[meta.address];
    merged[meta.address] = AccountMeta(
      meta.address,
      writable: meta.writable || (old?.writable ?? false),
      signer: meta.signer || (old?.signer ?? false),
    );
  }

  for (final instruction in instructions) {
    for (final account in instruction.accounts) {
      merge(account);
    }
    merge(AccountMeta(instruction.program));
  }
  final metas = [
    merged.remove(payer)!,
    ...merged.values.where((m) => m.signer && m.writable),
    ...merged.values.where((m) => m.signer && !m.writable),
    ...merged.values.where((m) => !m.signer && m.writable),
    ...merged.values.where((m) => !m.signer && !m.writable),
  ];
  if (metas.length > 256) {
    throw StateError('Transaction has too many accounts.');
  }
  if (metas.where((m) => m.signer).length != 1) {
    throw StateError('Only the connected wallet may sign this transaction.');
  }
  final indexes = {for (var i = 0; i < metas.length; i++) metas[i].address: i};
  final bytes = Uint8List.fromList([
    1,
    ...List.filled(64, 0),
    1,
    0,
    metas.where((m) => !m.signer && !m.writable).length,
    ...compactLength(metas.length),
    for (final meta in metas) ...addressBytes(meta.address),
    ...addressBytes(blockhash),
    ...compactLength(instructions.length),
    for (final instruction in instructions) ...[
      indexes[instruction.program]!,
      ...compactLength(instruction.accounts.length),
      for (final account in instruction.accounts) indexes[account.address]!,
      ...compactLength(instruction.data.length),
      ...instruction.data,
    ],
  ]);
  if (bytes.length > 1232) {
    throw StateError(
      'Transaction exceeds the Solana wire limit. Select fewer accounts.',
    );
  }
  return bytes;
}
