import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Wallets retain the keys. Android signs through the native MWA bridge;
/// other platforms expose the application's read-only experience.
class WalletService extends ChangeNotifier {
  WalletService({MethodChannel? channel, bool? supported})
    : _channel = channel ?? const MethodChannel('app.mato/wallet'),
      isSupported =
          supported ??
          (!kIsWeb && defaultTargetPlatform == TargetPlatform.android);

  final MethodChannel _channel;
  final bool isSupported;
  String? _address;
  String? _error;
  bool _isBusy = false;
  bool _disposed = false;
  int _generation = 0;

  String? get address => _address;
  String? get error => _error;
  bool get isBusy => _isBusy;
  bool get isConnected => _address != null;

  /// Reads encrypted authorization without opening the wallet. Every submission
  /// subsequently reauthorizes and checks the account that was reviewed.
  Future<void> restore() async {
    if (!isSupported) return;
    await _run(() async {
      final generation = _generation;
      final value = await _channel.invokeMapMethod<String, dynamic>('restore');
      if (generation == _generation) _address = _readAddress(value?['address']);
    });
  }

  Future<void> connect() => _run(() async {
    final generation = _generation;
    final value = await _channel.invokeMapMethod<String, dynamic>('connect');
    final address = _readAddress(value?['address']);
    if (address == null) throw const WalletException('invalid_response');
    if (generation == _generation) _address = address;
  });

  Future<void> disconnect() async {
    final ownedBusy = !_isBusy;
    if (ownedBusy) _isBusy = true;
    ++_generation;
    _address = null;
    _error = null;
    _notify();
    if (!isSupported) {
      if (ownedBusy) _isBusy = false;
      _notify();
      return;
    }
    // Disconnect must invalidate local credentials even while a wallet request
    // is open. The native bridge prevents that request from signing afterwards.
    try {
      await _channel.invokeMethod<void>('disconnect');
    } on PlatformException catch (failure) {
      final normalized = WalletException.fromPlatform(failure);
      _error = normalized.message;
      _notify();
      throw normalized;
    } finally {
      if (ownedBusy) _isBusy = false;
      _notify();
    }
  }

  /// [transaction] is a serialized Solana transaction, including its signature
  /// slots. The returned Base58 signature identifies an actual wallet submission.
  /// Confirmation belongs to the transaction service, and must finish before a
  /// caller releases its transaction lock or offers to retry.
  Future<String> signAndSend(
    Uint8List transaction, {
    required String expectedAddress,
  }) => _run(() async {
    if (_address == null || _address != expectedAddress) {
      throw const WalletException('account_changed');
    }
    if (transaction.isEmpty || transaction.length > 1232) {
      throw const WalletException('invalid_transaction');
    }
    final value = await _channel.invokeMethod<String>('signAndSend', {
      'transaction': transaction,
      'expectedAddress': expectedAddress,
    });
    if (value == null || !_isBase58Bytes(value, 64)) {
      throw const WalletException('invalid_signature');
    }
    // Preserve a submission receipt even if the user disconnected while the
    // wallet was already sending it. Disconnection cannot undo an on-chain tx.
    return value;
  });

  Future<T> _run<T>(Future<T> Function() operation) async {
    if (!isSupported) throw const WalletException('unsupported');
    if (_isBusy) throw const WalletException('busy');
    _isBusy = true;
    _error = null;
    _notify();
    try {
      return await operation();
    } on PlatformException catch (failure) {
      final normalized = WalletException.fromPlatform(failure);
      _recordFailure(normalized);
      throw normalized;
    } on MissingPluginException {
      const failure = WalletException('unavailable');
      _recordFailure(failure);
      throw failure;
    } on WalletException catch (failure) {
      _recordFailure(failure);
      rethrow;
    } finally {
      _isBusy = false;
      _notify();
    }
  }

  void _recordFailure(WalletException failure) {
    if (failure.code == 'account_changed' ||
        failure.code == 'authorization_expired') {
      ++_generation;
      _address = null;
    }
    if (!failure.isCancellation) _error = failure.message;
  }

  String? _readAddress(dynamic value) {
    if (value == null) return null;
    if (value is! String || !_isBase58Bytes(value, 32)) {
      throw const WalletException('invalid_response');
    }
    return value;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

class WalletException implements Exception {
  const WalletException(this.code);
  factory WalletException.fromPlatform(PlatformException exception) =>
      WalletException(exception.code);

  final String code;
  bool get isCancellation => code == 'cancelled';

  String get message => switch (code) {
    'unsupported' => 'Wallet signing is available in the Android app.',
    'unavailable' => 'Rebuild the Android app to enable wallet connection.',
    'busy' => 'Finish the current wallet request first.',
    'no_wallet' =>
      'Install an Android wallet that supports Mobile Wallet Adapter.',
    'cancelled' => 'Wallet request cancelled.',
    'account_changed' =>
      'The wallet account changed. Reconnect and review the transaction again.',
    'authorization_expired' =>
      'Your wallet connection expired. Reconnect and review the transaction again.',
    'invalid_transaction' =>
      'The transaction could not be prepared for wallet approval.',
    'invalid_signature' =>
      'The wallet returned an invalid receipt. Check wallet activity before retrying.',
    'storage' =>
      'Could not save or remove the wallet connection securely. Try again.',
    'timeout' =>
      'The wallet request timed out. Check wallet activity before retrying.',
    'invalid_response' => 'The wallet returned an invalid account.',
    _ =>
      'Could not complete the wallet request. Check wallet activity before retrying.',
  };

  @override
  String toString() => message;
}

bool _isBase58Bytes(String value, int expectedLength) {
  if (value.isEmpty || value.length > 88) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  var number = BigInt.zero;
  var leadingZeroes = 0;
  for (var index = 0; index < value.length; ++index) {
    final digit = alphabet.indexOf(value[index]);
    if (digit < 0) return false;
    if (index == leadingZeroes && digit == 0) ++leadingZeroes;
    number = number * BigInt.from(58) + BigInt.from(digit);
  }
  final length = (number.bitLength + 7) ~/ 8 + leadingZeroes;
  return length == expectedLength &&
      (expectedLength != 64 || number != BigInt.zero);
}
