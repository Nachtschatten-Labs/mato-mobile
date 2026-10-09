import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'account_codec.dart';
import 'addresses.dart';
import 'bytes.dart';
import 'constants.dart';
import 'close_preview.dart';
import 'generated_layouts.dart';
import 'instructions.dart';

typedef RpcCall = Future<dynamic> Function(String method, List<dynamic> params);
typedef WalletSender =
    Future<String> Function(Uint8List transaction, String expectedAddress);

class ReclaimResult {
  const ReclaimResult(this.signature, this.reclaimedLamports);
  final String signature;
  final BigInt reclaimedLamports;
}

/// Mainnet transaction lifecycle. A wallet result is only successful once the
/// signature is confirmed; ambiguous outcomes are never resubmitted automatically.
class TradingClient {
  TradingClient({
    required this.rpc,
    required this.signAndSend,
    required this.walletAddress,
    this.transactionsEnabled = const bool.fromEnvironment(
      'ENABLE_TRANSACTIONS',
      defaultValue: true,
    ),
    this.verifiedProgramId = const String.fromEnvironment(
      'VERIFIED_PROGRAM_ID',
      defaultValue: programId,
    ),
  });
  final RpcCall rpc;
  final WalletSender signAndSend;
  final String Function() walletAddress;
  final bool transactionsEnabled;
  final String verifiedProgramId;
  static bool _transactionInFlight = false;
  bool get isBusy => _transactionInFlight;
  static const _confirmed = {'commitment': 'confirmed'};
  static const _accountConfig = {
    'commitment': 'confirmed',
    'encoding': 'base64',
  };

  Future<Map<String, dynamic>?> _account(String address) async {
    final response = await rpc('getAccountInfo', [address, _accountConfig]);
    final value = response['value'];
    return value == null ? null : Map<String, dynamic>.from(value as Map);
  }

  Future<Map<String, dynamic>> _programAccount(
    String address,
    String kind,
  ) async {
    final account = await _account(address);
    if (account == null ||
        account['owner'] != programId ||
        account['executable'] == true) {
      throw StateError(
        'The $kind account is missing or is not owned by the verified Mato program.',
      );
    }
    return {
      ...decodeAccount(
        kind,
        base64Decode((account['data'] as List).first as String),
      ),
      '_lamports': asBigInt(account['lamports']),
    };
  }

  Future<int> _slot() async =>
      (await rpc('getSlot', [_confirmed]) as num).toInt();

  Future<void> verifyEnvironment() async {
    if (!transactionsEnabled || verifiedProgramId != programId) {
      throw StateError('Transactions are disabled for this build.');
    }
    final results = await Future.wait<dynamic>([
      rpc('getGenesisHash', []),
      _account(programId),
      _account(marketAddress),
    ]);
    if (results[0] != mainnetGenesisHash) {
      throw StateError(
        'The RPC endpoint is not Solana mainnet. Trading has been stopped.',
      );
    }
    final program = results[1] as Map<String, dynamic>?;
    if (program?['executable'] != true) {
      throw StateError(
        'The verified Mato program is not deployed at this RPC endpoint.',
      );
    }
    final account = results[2] as Map<String, dynamic>?;
    if (account == null ||
        account['owner'] != programId ||
        account['executable'] == true) {
      throw StateError('The market is not owned by the verified Mato program.');
    }
    final market = decodeMarket(base64Decode(account['data'][0] as String));
    if (market['baseMint'] != wrappedSolMint ||
        market['quoteMint'] != usdcMint ||
        market['id'] != 1) {
      throw StateError(
        'The on-chain market does not match the verified SOL/USDC market.',
      );
    }
  }

  Future<String> _tokenProgram(String mint) async {
    final account = await _account(mint);
    final owner = account?['owner'];
    if (owner != tokenProgram && owner != token2022Program) {
      throw StateError('Token mint is not owned by a supported token program.');
    }
    return owner as String;
  }

  Future<Map<String, dynamic>> _references(
    Map<String, dynamic> market,
    int slot,
  ) async {
    final index = getApprovalSafeReferenceIndex(
      slot,
      asBigInt(market['bookkeeping']['lastUpdateSlot']),
    );
    return {
      'referenceIndex': index,
      'currentInterval': await deriveMarketIntervalAddress(
        marketAddress,
        index,
      ),
      'previousInterval': await deriveMarketIntervalAddress(
        marketAddress,
        index - BigInt.one,
      ),
    };
  }

  Future<(Map<String, dynamic>, Map<String, dynamic>)> _position(
    String address,
    String wallet, {
    bool authorityOnly = false,
  }) async {
    final values = await Future.wait([
      _programAccount(marketAddress, 'market'),
      _programAccount(address, 'tradePosition'),
    ]);
    final position = values[1];
    if (position['market'] != marketAddress) {
      throw StateError('Trade position belongs to a different market.');
    }
    if (position['authority'] != wallet &&
        (authorityOnly || position['operator'] != wallet)) {
      throw StateError('This wallet is not allowed to control the position.');
    }
    return (values[0], position);
  }

  Future<String> _transact(
    Future<List<ProgramInstruction>> Function(String wallet) prepare, {
    int requiredNativeLamports = 1000000,
  }) async {
    if (_transactionInFlight) {
      throw StateError(
        'Another transaction is still pending. Wait for confirmation before starting a new one.',
      );
    }
    _transactionInFlight = true;
    try {
      final wallet = walletAddress();
      addressBytes(wallet);
      await verifyEnvironment();
      final native = asBigInt(
        (await rpc('getBalance', [wallet, _confirmed]))['value'],
      );
      if (native < BigInt.from(requiredNativeLamports)) {
        final reserve = requiredNativeLamports / 1000000000;
        throw StateError(
          'Keep at least $reserve native SOL for transaction fees and account rent.',
        );
      }
      final instructions = await prepare(wallet);
      if (walletAddress() != wallet) {
        throw StateError(
          'The connected wallet changed. Review this action again.',
        );
      }
      final lifetime = (await rpc('getLatestBlockhash', [_confirmed]))['value'];
      final transaction = compileUnsignedTransaction(
        payer: wallet,
        blockhash: lifetime['blockhash'] as String,
        instructions: instructions,
      );
      await simulate(transaction);
      if (walletAddress() != wallet) {
        throw StateError(
          'The connected wallet changed. Review this action again.',
        );
      }
      final signature = await signAndSend(transaction, wallet);
      if (base58Decode(signature).length != 64) {
        throw StateError(
          'Wallet returned an invalid transaction signature. Check wallet history before retrying.',
        );
      }
      await waitForConfirmation(
        signature,
        lastValidBlockHeight: asBigInt(lifetime['lastValidBlockHeight']),
      );
      return signature;
    } finally {
      _transactionInFlight = false;
    }
  }

  Future<Map<String, dynamic>> simulate(
    Uint8List transaction, {
    List<String>? accounts,
  }) async {
    final response = await rpc('simulateTransaction', [
      base64Encode(transaction),
      {
        'encoding': 'base64',
        'sigVerify': false,
        'replaceRecentBlockhash': true,
        'commitment': 'confirmed',
        if (accounts != null)
          'accounts': {'encoding': 'base64', 'addresses': accounts},
      },
    ]);
    final value = Map<String, dynamic>.from(response['value'] as Map);
    if (response['context'] != null) {
      value['contextSlot'] = response['context']['slot'];
    }
    if (value['err'] != null) {
      throw StateError(
        'Transaction simulation failed: ${jsonEncode(value['err'])}. No transaction was sent.',
      );
    }
    return value;
  }

  Future<void> waitForConfirmation(
    String signature, {
    BigInt? lastValidBlockHeight,
    Duration timeout = const Duration(seconds: 90),
    Duration pollInterval = const Duration(seconds: 1),
  }) async {
    final watch = Stopwatch()..start();
    while (watch.elapsed < timeout) {
      dynamic status;
      try {
        status = (await rpc('getSignatureStatuses', [
          [signature],
          {'searchTransactionHistory': true},
        ]))['value'][0];
      } catch (_) {
        throw StateError(
          'Unable to verify confirmation. Check signature $signature before retrying.',
        );
      }
      if (status?['err'] != null) {
        throw StateError(
          'Transaction failed during confirmation: ${jsonEncode(status['err'])}. Signature: $signature',
        );
      }
      if (status?['confirmationStatus'] == 'confirmed' ||
          status?['confirmationStatus'] == 'finalized') {
        return;
      }
      if (lastValidBlockHeight != null) {
        BigInt height;
        try {
          height = asBigInt(await rpc('getBlockHeight', [_confirmed]));
        } catch (_) {
          throw StateError(
            'Unable to verify confirmation. Check signature $signature before retrying.',
          );
        }
        if (height > lastValidBlockHeight) {
          throw StateError(
            'Transaction expired before confirmation. Check signature $signature before retrying.',
          );
        }
      }
      await Future<void>.delayed(pollInterval);
    }
    throw StateError(
      'Confirmation is taking longer than expected. Check signature $signature before retrying.',
    );
  }

  Future<BigInt> _wrapShortfall(BigInt amount, String wallet) async {
    final ata = await deriveAssociatedTokenAddress(
      mint: wrappedSolMint,
      owner: wallet,
    );
    final native = asBigInt(
      (await rpc('getBalance', [wallet, _confirmed]))['value'],
    );
    if (native < nativeFeeReserve) {
      throw StateError(
        'Keep at least 0.02 native SOL for fees and account rent.',
      );
    }
    final account = await _account(ata);
    var wrapped = BigInt.zero;
    if (account != null) {
      if (account['owner'] != tokenProgram) {
        throw StateError('Wrapped SOL account has an unexpected owner.');
      }
      wrapped = asBigInt(
        (await rpc('getTokenAccountBalance', [
          ata,
          _confirmed,
        ]))['value']['amount'],
      );
    }
    if (amount > native - nativeFeeReserve + wrapped) {
      throw StateError(
        'Amount exceeds the current SOL balance after reserving 0.02 SOL for fees and rent.',
      );
    }
    return amount > wrapped ? amount - wrapped : BigInt.zero;
  }

  Future<List<ProgramInstruction>> _wrap(String wallet, BigInt amount) async {
    final ata = await deriveAssociatedTokenAddress(
      mint: wrappedSolMint,
      owner: wallet,
    );
    return [
      createAssociatedToken(
        payer: wallet,
        ata: ata,
        mint: wrappedSolMint,
        owner: wallet,
        tokenProgramId: tokenProgram,
      ),
      ProgramInstruction(
        program: systemProgram,
        accounts: [
          AccountMeta(wallet, writable: true, signer: true),
          AccountMeta(ata, writable: true),
        ],
        data: Uint8List.fromList([
          ...unsignedLittleEndian(BigInt.two, 4),
          ...unsignedLittleEndian(amount, 8),
        ]),
      ),
      ProgramInstruction(
        program: tokenProgram,
        accounts: [AccountMeta(ata, writable: true)],
        data: Uint8List.fromList([17]),
      ),
    ];
  }

  Future<String> submitOrder({
    required BigInt amount,
    required int durationSlots,
    required int id,
    required bool isBuy,
  }) {
    if (amount <= BigInt.zero || amount >= (BigInt.one << 64)) {
      throw ArgumentError('Amount must be a positive unsigned 64-bit integer.');
    }
    if (id < 0 || id > 0xffffffff) {
      throw ArgumentError('Order id must be an unsigned 32-bit integer.');
    }
    if (durationSlots < endSlotInterval || durationSlots > 160000000) {
      throw ArgumentError(
        'Order duration must be between 11 and 160,000,000 slots.',
      );
    }
    return _transact((wallet) async {
      final market = await _programAccount(marketAddress, 'market');
      if (market['isPaused'] != 0) {
        throw StateError(
          'This market is paused. Try again after trading resumes.',
        );
      }
      if (amount <
          asBigInt(
            market[isBuy
                ? 'minimumQuoteDepositAtoms'
                : 'minimumBaseDepositAtoms'],
          )) {
        throw StateError('Amount is below the market minimum deposit.');
      }
      final mint = market[isBuy ? 'quoteMint' : 'baseMint'] as String;
      final outputMint = market[isBuy ? 'baseMint' : 'quoteMint'] as String;
      final token = await _tokenProgram(mint);
      final instructions = <ProgramInstruction>[];
      if (mint == wrappedSolMint) {
        final shortfall = await _wrapShortfall(amount, wallet);
        if (shortfall > BigInt.zero) {
          instructions.addAll(await _wrap(wallet, shortfall));
        }
      }
      if (outputMint != wrappedSolMint) {
        final outputToken = await _tokenProgram(outputMint);
        final receiver = await deriveAssociatedTokenAddress(
          mint: outputMint,
          owner: wallet,
          tokenProgramId: outputToken,
        );
        instructions.add(
          createAssociatedToken(
            payer: wallet,
            ata: receiver,
            mint: outputMint,
            owner: wallet,
            tokenProgramId: outputToken,
          ),
        );
      }
      final slot = await _slot();
      final references = await _references(market, slot);
      final startSlot = asBigInt(market['startSlot']).toInt();
      final future = getFutureIndex(
        alignEndSlot(slot > startSlot ? slot : startSlot, durationSlots),
      );
      instructions.add(
        twobInstruction(
          'submitOrder',
          {
            'authority': wallet,
            'payer': wallet,
            'operator': wallet,
            'baseReceiver': wallet,
            'quoteReceiver': wallet,
            'authorityAta': await deriveAssociatedTokenAddress(
              mint: mint,
              owner: wallet,
              tokenProgramId: token,
            ),
            'mint': mint,
            'market': marketAddress,
            'tradePosition': await deriveTradePositionAddress(
              marketAddress,
              wallet,
              id,
            ),
            'vault': await deriveAssociatedTokenAddress(
              mint: mint,
              owner: marketAddress,
              tokenProgramId: token,
            ),
            'currentInterval': references['currentInterval'] as String,
            'previousInterval': references['previousInterval'] as String,
            'futureInterval': await deriveMarketIntervalAddress(
              marketAddress,
              future,
            ),
            'tokenProgram': token,
          },
          {
            'id': id,
            'futureIndex': future,
            'referenceIndex': references['referenceIndex'],
            'amount': amount,
            'duration': durationSlots,
          },
        ),
      );
      return instructions;
    }, requiredNativeLamports: 20000000);
  }

  Future<String> pause(String tradePositionAddress) =>
      _changePause(tradePositionAddress, false);
  Future<String> resume(String tradePositionAddress) =>
      _changePause(tradePositionAddress, true);

  Future<String> _changePause(String address, bool resume) => _transact((
    wallet,
  ) async {
    final (market, position) = await _position(address, wallet);
    final paused = asBigInt(position['pausedAtSlot']) > BigInt.zero;
    if (resume && !paused) throw StateError('This position is not paused.');
    if (!resume && paused) throw StateError('This position is already paused.');
    if (resume && market['isPaused'] != 0) {
      throw StateError(
        'The market is paused. Try resuming the position later.',
      );
    }
    final slot = await _slot();
    if (!resume && BigInt.from(slot) >= positionEndSlot(position)) {
      throw StateError('This position has ended and cannot be paused.');
    }
    if (!resume && BigInt.from(slot) <= asBigInt(market['startSlot'])) {
      throw StateError('This market has not started yet.');
    }
    final references = await _references(market, slot);
    final oldIndex = getFutureIndex(positionEndSlot(position));
    final future = resume
        ? getFutureIndex(
            getUnpausedEndSlot(slot, position['remainingSlots'] as int),
          )
        : oldIndex;
    return [
      twobInstruction(
        resume ? 'unpauseTradePosition' : 'pauseTradePosition',
        {
          'signer': wallet,
          'baseMint': market['baseMint'] as String,
          'quoteMint': market['quoteMint'] as String,
          'market': marketAddress,
          'tradePosition': address,
          'baseTokenProgram': await _tokenProgram(market['baseMint'] as String),
          'quoteTokenProgram': await _tokenProgram(
            market['quoteMint'] as String,
          ),
          if (resume)
            'oldInterval': await deriveMarketIntervalAddress(
              marketAddress,
              oldIndex,
            ),
          'futureInterval': await deriveMarketIntervalAddress(
            marketAddress,
            future,
          ),
          'currentInterval': references['currentInterval'] as String,
          'previousInterval': references['previousInterval'] as String,
        },
        {'futureIndex': future, 'referenceIndex': references['referenceIndex']},
      ),
    ];
  });

  Future<String> withdraw(String tradePositionAddress) => _transact((
    wallet,
  ) async {
    final (market, position) = await _position(tradePositionAddress, wallet);
    final isBuy = position['side'] == 1;
    final mint = market[isBuy ? 'baseMint' : 'quoteMint'] as String;
    final receiver =
        position[isBuy ? 'baseReceiver' : 'quoteReceiver'] as String;
    final token = await _tokenProgram(mint);
    final slot = await _slot();
    if (asBigInt(position['pausedAtSlot']) == BigInt.zero &&
        BigInt.from(slot) >= positionEndSlot(position)) {
      throw StateError(
        'This position has ended. Close it to receive the remaining funds.',
      );
    }
    if (BigInt.from(slot) <= asBigInt(market['startSlot'])) {
      throw StateError('This market has not started yet.');
    }
    final references = await _references(market, slot);
    final native = mint == wrappedSolMint;
    final receiverToken = native
        ? await deriveTemporaryWithdrawTokenAddress(tradePositionAddress)
        : await deriveAssociatedTokenAddress(
            mint: mint,
            owner: receiver,
            tokenProgramId: token,
          );
    return [
      if (!native)
        createAssociatedToken(
          payer: wallet,
          ata: receiverToken,
          mint: mint,
          owner: receiver,
          tokenProgramId: token,
        ),
      twobInstruction(
        'withdrawSwapped',
        {
          'signer': wallet,
          'programConfig': await deriveProgramConfigAddress(),
          'receiver': receiver,
          'mint': mint,
          'receiverTokenAccount': receiverToken,
          'market': marketAddress,
          'tradePosition': tradePositionAddress,
          'vault': await deriveAssociatedTokenAddress(
            mint: mint,
            owner: marketAddress,
            tokenProgramId: token,
          ),
          'currentInterval': references['currentInterval'] as String,
          'previousInterval': references['previousInterval'] as String,
          'tokenProgram': token,
        },
        {'referenceIndex': references['referenceIndex']},
      ),
    ];
  });

  Future<List<ProgramInstruction>> prepareClosePositions(
    List<String> addresses,
    String wallet,
  ) async => (await _prepareClosePositions(addresses, wallet)).instructions;

  Future<
    ({
      List<ProgramInstruction> instructions,
      Map<String, dynamic> market,
      List<Map<String, dynamic>> positions,
    })
  >
  _prepareClosePositions(List<String> addresses, String wallet) async {
    if (addresses.isEmpty || addresses.length > maxBatchClosePositions) {
      throw ArgumentError(
        'Close between 1 and $maxBatchClosePositions positions at once.',
      );
    }
    if (addresses.toSet().length != addresses.length) {
      throw ArgumentError(
        'A position can only be closed once in a transaction.',
      );
    }
    final market = await _programAccount(marketAddress, 'market');
    final positions = await Future.wait(
      addresses.map((address) => _programAccount(address, 'tradePosition')),
    );
    final baseMint = market['baseMint'] as String;
    final quoteMint = market['quoteMint'] as String;
    final baseToken = await _tokenProgram(baseMint);
    final quoteToken = await _tokenProgram(quoteMint);
    final references = await _references(market, await _slot());
    final instructions = <ProgramInstruction>[];
    var receivesNative = false;
    for (var i = 0; i < positions.length; i++) {
      final position = positions[i];
      if (position['market'] != marketAddress ||
          position['authority'] != wallet) {
        throw StateError(
          'This wallet does not control the selected market position.',
        );
      }
      final futureIndex = getFutureIndex(positionEndSlot(position));
      final futureInterval = await deriveMarketIntervalAddress(
        marketAddress,
        futureIndex,
      );
      final interval = await _programAccount(futureInterval, 'marketInterval');
      if (interval['market'] != marketAddress ||
          interval['index'] != futureIndex) {
        throw StateError(
          'The position settlement interval does not match its market.',
        );
      }
      final baseReceiver = position['baseReceiver'] as String;
      final quoteReceiver = position['quoteReceiver'] as String;
      receivesNative |=
          (baseMint == wrappedSolMint && baseReceiver == wallet) ||
          (quoteMint == wrappedSolMint && quoteReceiver == wallet);
      instructions.add(
        twobInstruction(
          'authorityCloseTradePosition',
          {
            'authority': wallet,
            'programConfig': await deriveProgramConfigAddress(),
            'payer': position['payer'] as String,
            'baseReceiver': baseReceiver,
            'quoteReceiver': quoteReceiver,
            'baseMint': baseMint,
            'quoteMint': quoteMint,
            'receiverBaseTokenAccount': await deriveAssociatedTokenAddress(
              mint: baseMint,
              owner: baseReceiver,
              tokenProgramId: baseToken,
            ),
            'receiverQuoteTokenAccount': await deriveAssociatedTokenAddress(
              mint: quoteMint,
              owner: quoteReceiver,
              tokenProgramId: quoteToken,
            ),
            'market': marketAddress,
            'tradePosition': addresses[i],
            'baseVault': await deriveAssociatedTokenAddress(
              mint: baseMint,
              owner: marketAddress,
              tokenProgramId: baseToken,
            ),
            'quoteVault': await deriveAssociatedTokenAddress(
              mint: quoteMint,
              owner: marketAddress,
              tokenProgramId: quoteToken,
            ),
            'futureInterval': futureInterval,
            'currentInterval': references['currentInterval'] as String,
            'previousInterval': references['previousInterval'] as String,
            'baseTokenProgram': baseToken,
            'quoteTokenProgram': quoteToken,
          },
          {'referenceIndex': references['referenceIndex']},
        ),
      );
    }
    if (receivesNative) {
      instructions.add(
        ProgramInstruction(
          program: tokenProgram,
          accounts: [
            AccountMeta(
              await deriveAssociatedTokenAddress(
                mint: wrappedSolMint,
                owner: wallet,
              ),
              writable: true,
            ),
            AccountMeta(wallet, writable: true),
            AccountMeta(wallet, signer: true),
          ],
          data: Uint8List.fromList([9]),
        ),
      );
    }
    return (instructions: instructions, market: market, positions: positions);
  }

  Future<String> closePositions(List<String> addresses) =>
      _transact((wallet) => prepareClosePositions(addresses, wallet));

  /// Review uses the same close/unwrap instructions as the eventual submission.
  Future<Map<String, dynamic>> simulateClosePositions(
    List<String> addresses,
  ) async {
    final wallet = walletAddress();
    await verifyEnvironment();
    final prepared = await _prepareClosePositions(addresses, wallet);
    final blockhash =
        (await rpc('getLatestBlockhash', [_confirmed]))['value']['blockhash']
            as String;
    final result = await simulate(
      compileUnsignedTransaction(
        payer: wallet,
        blockhash: blockhash,
        instructions: prepared.instructions,
      ),
      accounts: [wallet],
    );
    if (walletAddress() != wallet) {
      throw StateError(
        'The connected wallet changed. Refresh the close preview.',
      );
    }
    final slot = result['contextSlot'];
    if (slot == null) {
      throw StateError(
        'The close preview did not include its simulation slot.',
      );
    }
    return {
      ...result,
      'positions': [
        for (var i = 0; i < prepared.positions.length; i++)
          (() {
            final position = prepared.positions[i];
            final settlement =
                asBigInt(slot) <= asBigInt(prepared.market['startSlot'])
                ? {
                    'remainingDepositAtoms': asBigInt(position['amount']),
                    'receivedAtoms': BigInt.zero,
                    'feeAtoms': BigInt.zero,
                  }
                : readCloseSimulation(
                    logs: List<String>.from(result['logs'] as List? ?? []),
                    position: position,
                    positionAddress: addresses[i],
                  );
            return {
              ...settlement,
              'positionAddress': addresses[i],
              'isBuy': position['side'] == 1,
              'positionRentLamports': position['_lamports'],
              'baseReceiver': position['baseReceiver'],
              'quoteReceiver': position['quoteReceiver'],
              'rentReceiver': position['payer'],
              'simulatedAtMs': DateTime.now().millisecondsSinceEpoch,
            };
          })(),
      ],
    };
  }

  Future<ReclaimResult> reclaimRent({int maxAccounts = 10}) async {
    if (maxAccounts < 1 || maxAccounts > 10) {
      throw ArgumentError('Reclaim between 1 and 10 rent accounts at once.');
    }
    var reclaimed = BigInt.zero;
    final signature = await _transact((wallet) async {
      final market = await _programAccount(marketAddress, 'market');
      final slot = await _slot();
      final references = await _references(market, slot);
      final response = await rpc('getProgramAccounts', [
        programId,
        {
          ..._accountConfig,
          'filters': [
            {'dataSize': 1176},
            {
              'memcmp': {
                'offset': 0,
                'bytes': base58Encode(accountDiscriminators['marketInterval']!),
              },
            },
            {
              'memcmp': {'offset': 48, 'bytes': wallet},
            },
          ],
        },
      ]);
      final accounts = response is List ? response : response['value'] as List;
      final closeable = <Map<String, dynamic>>[];
      for (final entry in accounts) {
        final account = entry['account'];
        if (account['owner'] != programId || account['executable'] == true) {
          continue;
        }
        final interval = decodeMarketInterval(
          base64Decode(account['data'][0] as String),
        );
        if (interval['market'] != marketAddress ||
            interval['payer'] != wallet ||
            interval['openPositions'] != 0) {
          continue;
        }
        if (BigInt.from(slot) <=
            (asBigInt(interval['index']) + BigInt.one) *
                BigInt.from(arrayLength * endSlotInterval)) {
          continue;
        }
        closeable.add({
          ...interval,
          'address': entry['pubkey'],
          'lamports': asBigInt(account['lamports']),
        });
      }
      closeable.sort(
        (a, b) => asBigInt(a['index']).compareTo(asBigInt(b['index'])),
      );
      if (closeable.isEmpty) {
        throw StateError('No reclaimable rent accounts available.');
      }
      return [
        for (final interval in closeable.take(maxAccounts))
          (() {
            reclaimed += asBigInt(interval['lamports']);
            return twobInstruction(
              'closeMarketInterval',
              {
                'signer': wallet,
                'payer': wallet,
                'marketInterval': interval['address'] as String,
                'market': marketAddress,
                'currentInterval': references['currentInterval'] as String,
                'previousInterval': references['previousInterval'] as String,
              },
              {'referenceIndex': references['referenceIndex']},
            );
          })(),
      ];
    });
    return ReclaimResult(signature, reclaimed);
  }
}
