import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:solana/encoder.dart' as solana;
import 'package:mato_mobile/protocol/protocol.dart';

void main() {
  final fixture =
      jsonDecode(
            File(
              'test/protocol/fixtures/codama-reference.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;
  final mainnet =
      jsonDecode(
            File(
              'test/protocol/fixtures/mainnet-market.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;
  final wallet = fixture['wallet'] as String;
  final marketBytes = base64Decode(mainnet['account']['data'][0] as String);

  test('decodes observed mainnet account and rejects corrupt ABI', () {
    final market = decodeMarket(marketBytes);
    expect(market['baseMint'], wrappedSolMint);
    expect(market['quoteMint'], usdcMint);
    expect(market['id'], 1);
    expect(market['minimumBaseDepositAtoms'], BigInt.from(1000000));
    expect(market['minimumQuoteDepositAtoms'], BigInt.from(100000));
    expect(market['bookkeeping']['lastUpdateSlot'], BigInt.from(453870216));
    expect(
      () => decodeMarket(Uint8List.sublistView(marketBytes, 1)),
      throwsFormatException,
    );
    final corrupt = Uint8List.fromList(marketBytes)..[0] = 0;
    expect(() => decodeMarket(corrupt), throwsFormatException);
  });

  test(
    'decodes independent Codama u64/u128 position and interval fixtures exactly',
    () {
      final position = decodeTradePosition(
        base64Decode(fixture['position'] as String),
      );
      expect(position['authority'], wallet);
      expect(position['market'], marketAddress);
      expect(position['flow'], BigInt.parse('123456789012345678901234567890'));
      expect(position['amount'], BigInt.parse('18446744073709551615'));
      expect(position['feeBpsAtSubmission'], 25);
      expect(position['side'], 1);
      expect(positionEndSlot(position), BigInt.from(17776));
      final interval = decodeMarketInterval(
        base64Decode(fixture['interval'] as String),
      );
      expect(interval['index'], BigInt.from(101));
      expect(
        interval['slotsWithoutTradesSnapshot'],
        List.generate(16, (i) => i),
      );
      expect(interval['baseExits'][15], BigInt.from(15 * 12345));
      expect(
        interval['basePerQuoteSnapshot'][0],
        BigInt.parse('1234567890123456789012345'),
      );
    },
  );

  test('PDA derivation agrees with the deployed program and Codama', () async {
    expect(await deriveMarketAddress(), marketAddress);
    expect(
      await deriveProgramConfigAddress(),
      'BKgwxz23KWsrp9BSgAuCngfUCrpQm6jprgYUbwmyNd2X',
    );
    expect(
      await deriveTradePositionAddress(marketAddress, wallet, 42),
      fixture['tradePosition'],
    );
    expect(
      await deriveMarketIntervalAddress(marketAddress, BigInt.from(101)),
      fixture['futureInterval'],
    );
    expect(
      await deriveAssociatedTokenAddress(mint: wrappedSolMint, owner: wallet),
      isNot(
        await deriveAssociatedTokenAddress(
          mint: wrappedSolMint,
          owner: wallet,
          tokenProgramId: token2022Program,
        ),
      ),
    );
  });

  test(
    'every transaction ABI matches independent original Codama output',
    () async {
      final accounts = <String, String>{
        'authority': wallet,
        'payer': wallet,
        'signer': wallet,
        'operator': wallet,
        'baseReceiver': wallet,
        'quoteReceiver': wallet,
        'receiver': wallet,
        'market': marketAddress,
        'baseMint': wrappedSolMint,
        'quoteMint': usdcMint,
        'mint': usdcMint,
        'tradePosition': fixture['tradePosition'] as String,
        'currentInterval': fixture['currentInterval'] as String,
        'previousInterval': fixture['previousInterval'] as String,
        'futureInterval': fixture['futureInterval'] as String,
        'oldInterval': fixture['futureInterval'] as String,
        'marketInterval': fixture['futureInterval'] as String,
        'tokenProgram': tokenProgram,
        'baseTokenProgram': tokenProgram,
        'quoteTokenProgram': tokenProgram,
        'authorityAta': await deriveAssociatedTokenAddress(
          mint: usdcMint,
          owner: wallet,
        ),
        'receiverTokenAccount': await deriveAssociatedTokenAddress(
          mint: usdcMint,
          owner: wallet,
        ),
        'receiverBaseTokenAccount': await deriveAssociatedTokenAddress(
          mint: wrappedSolMint,
          owner: wallet,
        ),
        'receiverQuoteTokenAccount': await deriveAssociatedTokenAddress(
          mint: usdcMint,
          owner: wallet,
        ),
        'vault': await deriveAssociatedTokenAddress(
          mint: usdcMint,
          owner: marketAddress,
        ),
        'baseVault': await deriveAssociatedTokenAddress(
          mint: wrappedSolMint,
          owner: marketAddress,
        ),
        'quoteVault': await deriveAssociatedTokenAddress(
          mint: usdcMint,
          owner: marketAddress,
        ),
        'programConfig': await deriveProgramConfigAddress(),
      };
      final args = <String, dynamic>{
        'id': 42,
        'futureIndex': BigInt.from(101),
        'referenceIndex': BigInt.from(100),
        'amount': BigInt.parse('123456789012345'),
        'duration': 186,
      };
      for (final entry
          in (fixture['instructions'] as Map<String, dynamic>).entries) {
        final instruction = twobInstruction(entry.key, accounts, args);
        expect(
          base64Encode(instruction.data),
          entry.value['data'],
          reason: '${entry.key} data',
        );
        expect(instruction.program, entry.value['program']);
        expect(
          instruction.accounts
              .map(
                (account) => {
                  'address': account.address,
                  'role': (account.writable ? 1 : 0) + (account.signer ? 2 : 0),
                },
              )
              .toList(),
          entry.value['accounts'],
          reason: '${entry.key} account order and privileges',
        );
        final wire = compileUnsignedTransaction(
          payer: wallet,
          blockhash: marketAddress,
          instructions: [instruction],
        );
        final decoded = solana.SignedTx.fromBytes(wire);
        expect(decoded.blockhash, marketAddress);
        expect(decoded.signatures.length, 1);
        expect(decoded.compiledMessage.accountKeys.first.toBase58(), wallet);
        expect(
          decoded.decompileMessage().instructions.single.data.toList(),
          instruction.data,
        );
        expect(decoded.toByteArray().toList(), wire);
      }
    },
  );

  test('approval interval logic matches original rollover edge cases', () {
    expect(getApprovalSafeReferenceIndex(175, BigInt.from(170)), BigInt.one);
    expect(getApprovalSafeReferenceIndex(176, BigInt.from(175)), BigInt.one);
    expect(getApprovalSafeReferenceIndex(176, BigInt.from(176)), BigInt.two);
    expect(
      () => getApprovalSafeReferenceIndex(528, BigInt.from(175)),
      throwsStateError,
    );
    expect(getUnpausedEndSlot(189, 10, interval: 10), BigInt.from(200));
    expect(getUnpausedEndSlot(190, 10, interval: 10), BigInt.from(210));
    expect(alignEndSlot(175, 11), BigInt.from(187));
  });

  test('base58 and integer boundaries never pass through floating point', () {
    final value = BigInt.parse('18446744073709551615');
    expect(unsignedLittleEndian(value, 8), List.filled(8, 255));
    expect(() => unsignedLittleEndian(value + BigInt.one, 8), throwsRangeError);
    expect(base58Encode(base58Decode(wallet)), wallet);
    expect(base58Decode(systemProgram), List.filled(32, 0));
    expect(() => addressBytes('0'), throwsFormatException);
  });

  group('exact close settlement review', () {
    late Map<String, dynamic> position;
    late List<String> logs;
    setUp(() {
      position = decodeTradePosition(
        base64Decode(fixture['position'] as String),
      );
      logs = [
        'Program $programId invoke [1]',
        'Program data: ${fixture['closeEvent']}',
        'Program data: ${fixture['feeEvent']}',
        'Program $programId success',
      ];
    });
    test('subtracts earlier withdrawals and actual close fee', () {
      expect(
        readCloseSimulation(
          logs: logs,
          position: position,
          positionAddress: fixture['tradePosition'] as String,
        ),
        {
          'remainingDepositAtoms': BigInt.from(333),
          'receivedAtoms': BigInt.from(93),
          'feeAtoms': BigInt.one,
        },
      );
    });
    test('rejects missing settlement events and wrong position identities', () {
      expect(
        () => readCloseSimulation(
          logs: logs.take(2).toList(),
          position: position,
          positionAddress: fixture['tradePosition'] as String,
        ),
        throwsStateError,
      );
      expect(
        () => readCloseSimulation(
          logs: logs,
          position: {...position, 'side': 0},
          positionAddress: fixture['tradePosition'] as String,
        ),
        throwsStateError,
      );
    });
    test('ignores event-shaped logs in another program invocation', () {
      logs.insert(1, 'Program $systemProgram invoke [2]');
      logs.insert(logs.length - 1, 'Program $systemProgram success');
      expect(
        () => readCloseSimulation(
          logs: logs,
          position: position,
          positionAddress: fixture['tradePosition'] as String,
        ),
        throwsStateError,
      );
    });
  });

  group('transaction lifecycle', () {
    late TradingClient client;
    late String connected;
    late List<String> methods;
    late int sends;
    String? genesis;
    dynamic simulationError;
    bool changeWallet = false;
    bool confirmationOffline = false;
    int nativeBalance = 1000000000;
    late Uint8List approved;
    late Uint8List simulated;
    setUp(() {
      connected = wallet;
      methods = [];
      sends = 0;
      genesis = mainnetGenesisHash;
      simulationError = null;
      changeWallet = false;
      confirmationOffline = false;
      nativeBalance = 1000000000;
      client = TradingClient(
        walletAddress: () => connected,
        signAndSend: (transaction, expected) async {
          expect(expected, wallet);
          expect(client.isBusy, true);
          await expectLater(
            client.submitOrder(
              amount: BigInt.from(100000),
              durationSlots: 50,
              id: 41,
              isBuy: true,
            ),
            throwsStateError,
          );
          sends++;
          approved = transaction;
          return base58Encode(List.filled(64, 1));
        },
        rpc: (method, params) async {
          methods.add(method);
          switch (method) {
            case 'getGenesisHash':
              return genesis;
            case 'getAccountInfo':
              if (params[0] == programId) {
                return {
                  'value': {'executable': true},
                };
              }
              if (params[0] == marketAddress) {
                return {'value': mainnet['account']};
              }
              if (params[0] == fixture['tradePosition']) {
                return {
                  'value': {
                    'owner': programId,
                    'executable': false,
                    'lamports': 2180000,
                    'data': [fixture['position'], 'base64'],
                  },
                };
              }
              if (params[0] == fixture['futureInterval']) {
                return {
                  'value': {
                    'owner': programId,
                    'executable': false,
                    'lamports': 9990000,
                    'data': [fixture['interval'], 'base64'],
                  },
                };
              }
              if (params[0] == usdcMint || params[0] == wrappedSolMint) {
                return {
                  'value': {'owner': tokenProgram},
                };
              }
              return {'value': null};
            case 'getBalance':
              return {'value': nativeBalance};
            case 'getSlot':
              return mainnet['slot'];
            case 'getLatestBlockhash':
              return {
                'value': {'blockhash': wallet, 'lastValidBlockHeight': 1000},
              };
            case 'simulateTransaction':
              expect(params[1]['sigVerify'], false);
              simulated = base64Decode(params[0] as String);
              if (changeWallet) connected = systemProgram;
              return {
                'context': {'slot': mainnet['slot']},
                'value': {
                  'err': simulationError,
                  'logs': [
                    'Program $programId invoke [1]',
                    'Program data: ${fixture['closeEvent']}',
                    'Program data: ${fixture['feeEvent']}',
                    'Program $programId success',
                  ],
                },
              };
            case 'getSignatureStatuses':
              if (confirmationOffline) throw StateError('offline');
              return {
                'value': [
                  {'err': null, 'confirmationStatus': 'confirmed'},
                ],
              };
            default:
              throw StateError('Unexpected method $method');
          }
        },
      );
    });
    Future<String> submit() => client.submitOrder(
      amount: BigInt.from(100000),
      durationSlots: 50,
      id: 42,
      isBuy: true,
    );
    test(
      'verifies, simulates, approves and confirms while holding global lock',
      () async {
        await submit();
        expect(sends, 1);
        expect(
          methods.indexOf('simulateTransaction'),
          lessThan(methods.indexOf('getSignatureStatuses')),
        );
        expect(
          solana.SignedTx.fromBytes(
            approved,
          ).decompileMessage().instructions.length,
          1,
        );
        expect(client.isBusy, false);
      },
    );
    test(
      'close review returns exact receipts and includes native unwrap without approval',
      () async {
        final result = await client.simulateClosePositions([
          fixture['tradePosition'] as String,
        ]);
        final receipt = (result['positions'] as List).single;
        expect(receipt['remainingDepositAtoms'], BigInt.from(333));
        expect(receipt['receivedAtoms'], BigInt.from(93));
        expect(receipt['feeAtoms'], BigInt.one);
        expect(receipt['positionRentLamports'], BigInt.from(2180000));
        expect(receipt['rentReceiver'], wallet);
        expect(receipt['isBuy'], true);
        final instructions = solana.SignedTx.fromBytes(
          simulated,
        ).decompileMessage().instructions;
        expect(instructions.length, 2);
        expect(instructions.last.programId.toBase58(), tokenProgram);
        expect(instructions.last.data.toList(), [9]);
        expect(sends, 0);
      },
    );
    test(
      'close submission preserves review instructions and native unwrap',
      () async {
        await client.closePositions([fixture['tradePosition'] as String]);
        final instructions = solana.SignedTx.fromBytes(
          approved,
        ).decompileMessage().instructions;
        expect(instructions.length, 2);
        expect(instructions.last.data.toList(), [9]);
        expect(sends, 1);
      },
    );
    test(
      'insufficient native reserve blocks submit and maintenance before approval',
      () async {
        nativeBalance = 500000;
        await expectLater(submit(), throwsStateError);
        await expectLater(
          client.closePositions([fixture['tradePosition'] as String]),
          throwsStateError,
        );
        expect(sends, 0);
        expect(methods, isNot(contains('simulateTransaction')));
      },
    );
    test('wrong cluster blocks wallet approval', () async {
      genesis = 'devnet';
      await expectLater(submit(), throwsStateError);
      expect(sends, 0);
      expect(methods, isNot(contains('simulateTransaction')));
    });
    test(
      'failed simulation blocks wallet approval and releases lock',
      () async {
        simulationError = {
          'InstructionError': [0, 'InsufficientFunds'],
        };
        await expectLater(submit(), throwsStateError);
        expect(sends, 0);
        expect(client.isBusy, false);
      },
    );
    test('wallet changing during review blocks approval', () async {
      changeWallet = true;
      await expectLater(submit(), throwsStateError);
      expect(sends, 0);
    });
    test(
      'unknown confirmation is reported with signature and never resubmitted',
      () async {
        confirmationOffline = true;
        await expectLater(
          submit(),
          throwsA(
            isA<StateError>().having(
              (e) => e.message,
              'message',
              contains('before retrying'),
            ),
          ),
        );
        expect(sends, 1);
        expect(client.isBusy, false);
      },
    );
    test('disabled build blocks any RPC or wallet request', () async {
      final disabled = TradingClient(
        rpc: client.rpc,
        signAndSend: client.signAndSend,
        walletAddress: () => wallet,
        transactionsEnabled: false,
      );
      await expectLater(
        disabled.submitOrder(
          amount: BigInt.from(100000),
          durationSlots: 50,
          id: 42,
          isBuy: true,
        ),
        throwsStateError,
      );
      expect(methods, isEmpty);
      expect(sends, 0);
    });
  });
}
